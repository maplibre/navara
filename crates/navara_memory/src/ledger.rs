//! The engine-wide [`MemoryLedger`] resource and the JS-supplied [`CostHints`]
//! it uses to seed reservation estimates.

use bevy_ecs::prelude::Resource;

use crate::{
    DEFAULT_ATLAS_TILE_BYTES, DEFAULT_RASTER_TILE_BYTES, HYSTERESIS_RATIO, MAX_SSE_MULTIPLIER,
    ReserveKey, TileCost,
};

/// GPU cost constants that only the JS side knows precisely (e.g. composite
/// atlas dimensions depend on device options). Overridable via
/// `setMemoryCostHints`.
#[derive(Debug, Clone, Copy)]
pub struct CostHints {
    /// Composite atlas cost per terrain tile, held by every terrain tile that
    /// has been rendered (raster-only scenes included). The ledger charges it
    /// when JS reports the tile's drape term; this hint feeds only the terrain
    /// reservation estimate.
    pub atlas_tile_bytes: u64,
    /// Raster texture cost per fragment (w×h×4 plus mipmap overhead).
    pub raster_tile_bytes: u64,
}

impl CostHints {
    /// Cold-start reservation seed for a hillshade DEM fetch.
    ///
    /// Derivation from the hillshade pipeline's actual allocations: the
    /// resident cost of a landed hillshade tile is the decoded RGBA DEM
    /// payload (`tile_size² × 4` bytes — `raster_tile_bytes` covers this and
    /// already carries a ~33% mipmap margin) plus the four boundary edge
    /// strips `store_extracted_edges` keeps in `BufferStore` for neighbor
    /// backfill (`4 strips × tile_size px × 4 B/px = 16·tile_size` bytes,
    /// i.e. `4/tile_size` ≈ 1/64 of the payload at the standard 256). The
    /// `+ 1/64` term folds that edge overhead into the seed.
    pub fn hillshade_reserve_seed(&self) -> u64 {
        self.raster_tile_bytes + self.raster_tile_bytes / 64
    }

    /// Cold-start reservation seed for a terrain (RasterDEM / quantized-mesh)
    /// fetch, used until [`ReserveKey::Terrain`] has recorded its first
    /// [`RESERVE_MIN_SAMPLES`](crate::RESERVE_MIN_SAMPLES) landed mesh costs.
    ///
    /// Derivation from what a landed terrain tile actually costs the ledger:
    /// the decoded DEM / mesh-geometry buffers (a RasterDEM decode is on the
    /// order of one raster tile; quantized-mesh varies with vertex count —
    /// the EMA takes over for that) plus the composite atlas a terrain tile
    /// allocates once rendered (`atlas_tile_bytes`, ~3 MB — the dominant
    /// term). Seeding only the raster hint here, as this used to, undercounts
    /// the eventual resident cost by roughly an order of magnitude and lets a
    /// camera-move terrain burst slip past the load gate.
    pub fn terrain_reserve_seed(&self) -> u64 {
        self.raster_tile_bytes + self.atlas_tile_bytes
    }
}

impl Default for CostHints {
    fn default() -> Self {
        Self {
            atlas_tile_bytes: DEFAULT_ATLAS_TILE_BYTES,
            raster_tile_bytes: DEFAULT_RASTER_TILE_BYTES,
        }
    }
}

#[derive(Resource, Debug)]
pub struct MemoryLedger {
    /// Total budget (CPU + GPU estimate). `None` disables budgeting and
    /// retention entirely, preserving the original lifecycle.
    pub budget_bytes: Option<u64>,
    /// Mirror of `BufferStore::total_bytes`, refreshed each frame for stats.
    pub cpu_bytes: u64,
    /// Incrementally maintained sum of `TileCost::gpu_est` for live tiles.
    pub gpu_bytes_est: u64,
    /// CPU bytes held outside `BufferStore` (plain `Vec`s/`HashMap`s the
    /// store can't see — chiefly the MVT feature attribute tables in
    /// `BatchTable`). Synced each frame by contributor systems in
    /// [`MemoryAccountingSet`](crate::MemoryAccountingSet). For attribute-rich
    /// data (e.g. Overture) this dominates, so counting it is what makes the
    /// budget/eviction/SSE-degrade actually bind.
    pub external_cpu_bytes: u64,
    /// Sum of every layer's fully-evictable retention pool cost (terrain /
    /// raster / vector / 3D Tiles), synced each frame in
    /// [`MemoryAccountingSet`](crate::MemoryAccountingSet). Subtracted from
    /// [`Self::usage`] to form [`Self::hard_usage`], the *resident* footprint
    /// the load gate and pressure react to. Without this, a healthy *full* LRU
    /// cache (retained tiles eviction can reclaim on demand) is
    /// indistinguishable from genuine memory exhaustion: the gate closes at
    /// `usage >= budget`, stops all new loads, and terrain never descends to
    /// its overscale/upsample band.
    pub retained_evictable_bytes: u64,
    /// Sum of every live [`ReservedCost`](crate::ReservedCost): the estimated
    /// cost of tiles whose fetch has been dispatched but whose actual
    /// [`TileCost`] has not yet landed. Folded into [`Self::usage`] (and thus
    /// [`Self::hard_usage`]) so the load gate closes *before* in-flight
    /// decode/upload peaks blow the budget, and so reserving drives eviction of
    /// old pooled tiles to make room. Maintained incrementally by the
    /// [`ReservedCost`](crate::ReservedCost) component hooks.
    pub reserved_bytes: u64,
    /// GPU bytes of tiles evicted THIS frame whose `TileCost` hook has not yet
    /// fired (the destroy defers the despawn — meshes to next frame's
    /// `remove_removed_mesh`, 3D Tiles content to the end of this `Update`), so
    /// `gpu_bytes_est` still contains them. Each pipeline's `enforce_memory_budget`
    /// adds an evicted candidate's `gpu_est` here at destroy time; [`Self::usage`]
    /// and [`Self::hard_usage`] subtract it (saturating). Without this, the four
    /// pipelines' eviction loops each read the *same* stale `usage` in the same
    /// frame (their `EvictBudget` credit is stack-local), so a single overage
    /// gets evicted up to four times over. Zeroed once per frame by
    /// [`reset_pending_evicted_gpu_bytes`](crate::reset_pending_evicted_gpu_bytes)
    /// in `PreUpdate` after `remove_removed_mesh` has applied the deferred
    /// despawns — at which point `gpu_bytes_est` already reflects them and the
    /// credit must not persist.
    pub pending_evicted_gpu_bytes: u64,
    /// Continuous memory-pressure SSE multiplier, maintained by
    /// [`update_sse_pressure`](crate::update_sse_pressure); traversals read the
    /// quantized [`SsePressure`](crate::SsePressure) instead.
    pub sse_multiplier: f32,
    /// Resting/base SSE multiplier: the value pressure decays to (a floor). A
    /// value above 1 makes far tiles permanently coarser regardless of memory
    /// pressure — set above 1 on mobile to shrink the working set from the start.
    pub min_sse_multiplier: f32,
    /// Ceiling the memory-pressure multiplier may rise to. Larger on mobile
    /// so the degrade can shed more of the visible set before the tab is
    /// killed.
    pub max_sse_multiplier: f32,
    pub cost_hints: CostHints,
    /// Estimated GPU bytes of fixed, screen-sized allocations that exist for
    /// the whole session regardless of tile streaming — chiefly the
    /// postprocessing render-target stack (composer ping-pong buffers, gbuffer
    /// MRT attachments, depth textures). Reported by the JS side (which owns
    /// the Three.js render targets) at init, on resize, and when the pass list
    /// changes. Folded into [`Self::usage`] (and thus [`Self::hard_usage`]) so
    /// the tile budget binds against the memory that is actually left over:
    /// unlike tiles this term is not evictable — it shrinks only when the
    /// drawing buffer does.
    pub fixed_gpu_bytes: u64,
    /// Cumulative number of tiles evicted by budget enforcement (stats).
    pub evicted_count: u64,
}

impl Default for MemoryLedger {
    fn default() -> Self {
        Self {
            budget_bytes: None,
            cpu_bytes: 0,
            gpu_bytes_est: 0,
            external_cpu_bytes: 0,
            retained_evictable_bytes: 0,
            reserved_bytes: 0,
            pending_evicted_gpu_bytes: 0,
            sse_multiplier: 1.0,
            min_sse_multiplier: 1.0,
            max_sse_multiplier: MAX_SSE_MULTIPLIER,
            cost_hints: CostHints::default(),
            fixed_gpu_bytes: 0,
            evicted_count: 0,
        }
    }
}

impl MemoryLedger {
    pub fn enabled(&self) -> bool {
        self.budget_bytes.is_some()
    }

    pub fn add_gpu(&mut self, cost: TileCost) {
        self.gpu_bytes_est += cost.gpu_est;
    }

    pub fn sub_gpu(&mut self, cost: TileCost) {
        debug_assert!(
            self.gpu_bytes_est >= cost.gpu_est,
            "gpu_bytes_est underflow: {} - {}",
            self.gpu_bytes_est,
            cost.gpu_est
        );
        self.gpu_bytes_est = self.gpu_bytes_est.saturating_sub(cost.gpu_est);
    }

    /// Current total usage: exact `BufferStore` CPU bytes + externally
    /// accounted CPU bytes (attribute tables) + estimated GPU bytes + fixed
    /// screen-sized GPU allocations ([`Self::fixed_gpu_bytes`]) +
    /// dispatch-time reservations for in-flight fetches
    /// ([`ReservedCost`](crate::ReservedCost)). Including reservations here
    /// means both the load gate/pressure ([`Self::hard_usage`]) *and* eviction
    /// ([`Self::needs_eviction`]) react to them: the gate closes before
    /// in-flight peaks land, and reserving evicts old pooled tiles to make room
    /// for the incoming ones.
    pub fn usage(&self, cpu_total: u64) -> u64 {
        (cpu_total
            + self.external_cpu_bytes
            + self.gpu_bytes_est
            + self.fixed_gpu_bytes
            + self.reserved_bytes)
            .saturating_sub(self.pending_evicted_gpu_bytes)
    }

    /// Record that a tile evicted this frame (whose deferred despawn has not yet
    /// fired its `TileCost` hook) has freed `gpu_est` GPU bytes, so every
    /// pipeline's later [`Self::usage`] read this frame excludes it and does not
    /// re-evict the same overage. See [`Self::pending_evicted_gpu_bytes`].
    pub fn credit_pending_eviction(&mut self, gpu_est: u64) {
        self.pending_evicted_gpu_bytes += gpu_est;
    }

    /// Cold-start seed for a [`ReserveKey`]'s reservation estimate — the value
    /// [`ReserveEstimates::estimate`](crate::ReserveEstimates::estimate)
    /// returns until the key's EMA has enough samples. Centralized here (keyed
    /// by the reservation key alone) so the `ReservedCost` `on_insert` hook can
    /// resolve a reservation without each dispatch system duplicating the seed
    /// choice.
    pub fn reserve_seed(&self, key: ReserveKey) -> u64 {
        match key {
            ReserveKey::VectorLayer(_) => crate::DEFAULT_VECTOR_TILE_RESERVE_BYTES,
            ReserveKey::Tiles3dLayer(_) => crate::DEFAULT_TILES3D_RESERVE_BYTES,
            ReserveKey::Hillshade => self.cost_hints.hillshade_reserve_seed(),
            ReserveKey::Terrain => self.cost_hints.terrain_reserve_seed(),
        }
    }

    /// [`Self::usage`] minus the fully-evictable retention pool: the resident
    /// footprint that cannot be freed without evicting *visible / protected /
    /// in-flight* tiles. The load gate and memory-pressure controller key off
    /// this — a full-but-healthy LRU cache (reclaimable on demand) must not
    /// read as memory exhaustion and stall new loads. Eviction itself still
    /// uses the full [`Self::usage`] to cap the cache at the budget.
    pub fn hard_usage(&self, cpu_total: u64) -> u64 {
        self.usage(cpu_total)
            .saturating_sub(self.retained_evictable_bytes)
    }

    /// Whether an eviction pass should run: always when over budget, and —
    /// while the load gate is closed — anywhere above the gate-reopen target.
    /// Without the second arm, usage stranded in the hysteresis band
    /// (target < usage <= budget, e.g. from in-loop estimate drift) would keep
    /// the gate closed forever with eviction dormant: nothing could pull usage
    /// down to the reopen threshold and no new tile would ever load again.
    pub fn needs_eviction(&self, usage: u64, load_gate_closed: bool) -> bool {
        match self.budget_bytes {
            Some(budget) => usage > budget || (load_gate_closed && usage > self.evict_target()),
            None => false,
        }
    }

    pub fn over_budget(&self, usage: u64) -> bool {
        self.budget_bytes.is_some_and(|budget| usage > budget)
    }

    /// Eviction stops once usage drops to this target (hysteresis).
    pub fn evict_target(&self) -> u64 {
        self.budget_bytes
            .map(|budget| (budget as f64 * HYSTERESIS_RATIO) as u64)
            .unwrap_or(u64::MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_by_default() {
        let ledger = MemoryLedger::default();
        assert!(!ledger.enabled());
        assert!(!ledger.over_budget(u64::MAX - 1));
        assert_eq!(ledger.evict_target(), u64::MAX);
    }

    #[test]
    fn needs_eviction_drains_the_hysteresis_band_while_the_gate_is_closed() {
        let ledger = MemoryLedger {
            budget_bytes: Some(1000), // evict target = 850
            ..Default::default()
        };
        // Over budget: always evict, gate or not.
        assert!(ledger.needs_eviction(1001, false));
        // In the band with the gate open: dormant (normal hysteresis).
        assert!(!ledger.needs_eviction(900, false));
        // In the band with the gate closed: must drain to the reopen target,
        // or the gate (and all new tile loads) would stay blocked forever.
        assert!(ledger.needs_eviction(900, true));
        // At/below the target the gate can reopen: stop.
        assert!(!ledger.needs_eviction(850, true));
        // No budget: never evict.
        let disabled = MemoryLedger::default();
        assert!(!disabled.needs_eviction(u64::MAX - 1, true));
    }

    #[test]
    fn tracks_gpu_estimate() {
        let mut ledger = MemoryLedger::default();
        let cost = TileCost {
            cpu: 0,
            gpu_est: 100,
        };
        ledger.add_gpu(cost);
        ledger.add_gpu(cost);
        assert_eq!(ledger.gpu_bytes_est, 200);
        ledger.sub_gpu(cost);
        assert_eq!(ledger.gpu_bytes_est, 100);
        assert_eq!(ledger.usage(50), 150);
    }

    #[test]
    fn usage_includes_external_cpu_bytes() {
        let ledger = MemoryLedger {
            gpu_bytes_est: 100,
            external_cpu_bytes: 300,
            ..Default::default()
        };
        // BufferStore cpu (50) + external (300) + gpu (100).
        assert_eq!(ledger.usage(50), 450);
    }

    #[test]
    fn reservations_count_toward_usage_and_hard_usage() {
        let ledger = MemoryLedger {
            gpu_bytes_est: 100,
            reserved_bytes: 300,
            ..Default::default()
        };
        // usage = cpu(50) + external(0) + gpu(100) + reserved(300).
        assert_eq!(ledger.usage(50), 450);
        // No retention pool, so hard_usage == usage: the gate sees reservations.
        assert_eq!(ledger.hard_usage(50), 450);
    }

    #[test]
    fn reservation_closes_the_gate_while_resident_usage_alone_is_under_budget() {
        // Resident footprint (gpu) is under budget, but a large in-flight
        // reservation pushes hard_usage over it — the gate must react so
        // in-flight work fits under the budget.
        let ledger = MemoryLedger {
            budget_bytes: Some(1000),
            gpu_bytes_est: 800,
            reserved_bytes: 300,
            ..Default::default()
        };
        // Without reservations hard_usage would be 800 < 1000 (gate open); with
        // them it is 1100 >= 1000.
        assert!(ledger.hard_usage(0) >= 1000);
        // usage(0) = 1100 > budget → eviction is driven by the reservation too.
        assert!(ledger.needs_eviction(ledger.usage(0), false));
    }

    #[test]
    fn pending_eviction_credit_lowers_usage_and_hard_usage() {
        let mut ledger = MemoryLedger {
            gpu_bytes_est: 1000,
            ..Default::default()
        };
        // usage = cpu(50) + gpu(1000) = 1050.
        assert_eq!(ledger.usage(50), 1050);
        // An eviction whose deferred despawn has not fired yet: gpu_bytes_est
        // still holds the 300, but usage must already exclude it so the next
        // pipeline's enforce pass this frame does not re-evict the same overage.
        ledger.credit_pending_eviction(300);
        assert_eq!(ledger.usage(50), 750);
        assert_eq!(ledger.hard_usage(50), 750);
        // Saturates rather than underflowing if the credit exceeds usage.
        ledger.credit_pending_eviction(10_000);
        assert_eq!(ledger.usage(50), 0);
    }

    #[test]
    fn hard_usage_excludes_the_evictable_retention_pool() {
        let ledger = MemoryLedger {
            gpu_bytes_est: 900,
            external_cpu_bytes: 0,
            retained_evictable_bytes: 700,
            ..Default::default()
        };
        // usage = cpu(50) + external(0) + gpu(900) = 950.
        assert_eq!(ledger.usage(50), 950);
        // hard usage subtracts the fully-evictable retention pool.
        assert_eq!(ledger.hard_usage(50), 250);
        // Saturates instead of underflowing when the pool exceeds usage.
        let over = MemoryLedger {
            gpu_bytes_est: 100,
            retained_evictable_bytes: 10_000,
            ..Default::default()
        };
        assert_eq!(over.hard_usage(0), 0);
    }

    #[test]
    fn budget_and_hysteresis() {
        let ledger = MemoryLedger {
            budget_bytes: Some(1000),
            ..Default::default()
        };
        assert!(ledger.enabled());
        assert!(ledger.over_budget(1001));
        assert!(!ledger.over_budget(1000));
        assert_eq!(ledger.evict_target(), 850);
    }

    #[test]
    fn hillshade_seed_folds_edge_overhead_into_the_raster_hint() {
        let hints = CostHints::default();
        assert_eq!(
            hints.hillshade_reserve_seed(),
            hints.raster_tile_bytes + hints.raster_tile_bytes / 64
        );
        assert!(hints.hillshade_reserve_seed() > hints.raster_tile_bytes);
    }

    #[test]
    fn terrain_seed_folds_the_atlas_into_the_raster_hint() {
        let hints = CostHints::default();
        assert_eq!(
            hints.terrain_reserve_seed(),
            hints.raster_tile_bytes + hints.atlas_tile_bytes
        );
        // The atlas dominates: the seed must be atlas-scale, not raster-scale.
        assert!(hints.terrain_reserve_seed() > hints.atlas_tile_bytes);
    }
}
