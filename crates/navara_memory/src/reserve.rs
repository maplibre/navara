//! Dispatch-time reservation accounting: the [`ReservedCost`] component (whose
//! amount is resolved by the per-key adaptive estimator [`ReserveEstimates`])
//! and the [`ReserveKey`] pools that keep landed-cost statistics per layer.

use std::collections::HashMap;

use bevy_ecs::entity::Entity;
use bevy_ecs::lifecycle::HookContext;
use bevy_ecs::prelude::{Component, Resource};
use bevy_ecs::world::DeferredWorld;

use crate::{
    MemoryLedger, RESERVE_EMA_ALPHA, RESERVE_K_STDDEV, RESERVE_MAX_BYTES, RESERVE_MIN_BYTES,
    RESERVE_MIN_SAMPLES,
};

/// A dispatch-time *reservation* of a tile's estimated cost, attached to the
/// data-requester entity the moment a fetch is actually dispatched (not for
/// requesters rejected by the load gate / pending cap). While it exists the
/// reserved bytes count toward [`MemoryLedger::hard_usage`] (so the load gate
/// and pressure controller see in-flight work *before* it lands) and toward
/// [`MemoryLedger::usage`] (so reserving proactively drives eviction of old
/// pooled tiles to make room — "evict old to load new").
///
/// The reserved amount is resolved centrally by the `on_insert` hook: insert
/// [`ReservedCost::for_key`] and the hook computes
/// `ReserveEstimates::estimate(key, MemoryLedger::reserve_seed(key))` at apply
/// time, so the dispatch systems don't each duplicate the estimate/seed dance
/// (the resolved amount is stored on the component so `on_discard` releases
/// exactly what was added). [`ReservedCost::fixed`] bypasses the estimator for
/// callers that already know the amount (tests, no-layer fallbacks).
///
/// Component hooks keep [`MemoryLedger::reserved_bytes`] leak-free across every
/// exit path: `on_insert` adds the estimate, `on_discard` subtracts it. Bevy
/// fires `on_discard` on replace, remove, AND despawn, so this single hook
/// covers all three — an aborted request (requester despawned while still
/// `Pending`) releases its reservation automatically. Registering `on_remove`
/// too would double-subtract on every removal/despawn (Bevy fires `on_discard`
/// then `on_remove`). The `release_landed_reservations` system removes the
/// component the frame the fetch resolves (status leaves `Pending`), *before*
/// the actual `TileCost` lands a frame later, so a reservation and its measured
/// cost never systematically double-count.
#[derive(Clone, Copy, Default, Debug, Component)]
#[component(on_insert = on_reserved_cost_insert, on_discard = on_reserved_cost_remove)]
pub struct ReservedCost {
    /// `Some` until the `on_insert` hook resolves it into `bytes`.
    key: Option<ReserveKey>,
    bytes: u64,
}

impl ReservedCost {
    /// Reservation whose amount the `on_insert` hook resolves from the per-key
    /// EMA (seeded by [`MemoryLedger::reserve_seed`]) at command-apply time.
    pub fn for_key(key: ReserveKey) -> Self {
        Self {
            key: Some(key),
            bytes: 0,
        }
    }

    /// Reservation of a known, fixed amount (no estimator lookup).
    pub fn fixed(bytes: u64) -> Self {
        Self { key: None, bytes }
    }

    /// The reserved amount; 0 for a `for_key` reservation whose hook has not
    /// applied yet.
    pub fn bytes(&self) -> u64 {
        self.bytes
    }
}

fn on_reserved_cost_insert(mut world: DeferredWorld, ctx: HookContext) {
    let Some(reserved) = world.get::<ReservedCost>(ctx.entity).copied() else {
        return;
    };
    let bytes = match reserved.key {
        None => reserved.bytes,
        Some(key) => {
            let Some(ledger) = world.get_resource::<MemoryLedger>() else {
                return;
            };
            let seed = ledger.reserve_seed(key);
            let bytes = world
                .get_resource::<ReserveEstimates>()
                .map_or(seed, |estimates| estimates.estimate(key, seed));
            // Store the resolved amount so `on_discard` releases exactly what
            // was added (the EMA may have moved by then). Plain mutation — no
            // hook re-fires.
            if let Some(mut reserved) = world.get_mut::<ReservedCost>(ctx.entity) {
                reserved.bytes = bytes;
            }
            bytes
        }
    };
    if let Some(mut ledger) = world.get_resource_mut::<MemoryLedger>() {
        ledger.reserved_bytes += bytes;
    }
}

fn on_reserved_cost_remove(mut world: DeferredWorld, ctx: HookContext) {
    let Some(reserved) = world.get::<ReservedCost>(ctx.entity).copied() else {
        return;
    };
    if let Some(mut ledger) = world.get_resource_mut::<MemoryLedger>() {
        ledger.reserved_bytes = ledger.reserved_bytes.saturating_sub(reserved.bytes);
    }
}

/// Key for one reservation-estimator pool: landed-cost statistics must not be
/// pooled across layers (different MVT sources / 3D tilesets have wildly
/// different tile sizes), so each layer entity gets its own EMA.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReserveKey {
    /// Per-layer pool keyed by the vector MVT source layer entity. Split from
    /// [`Self::Tiles3dLayer`] (rather than one generic layer variant) so the
    /// cold-start seed is derivable from the key alone — see
    /// [`MemoryLedger::reserve_seed`].
    VectorLayer(Entity),
    /// Per-tileset pool keyed by the 3D Tiles layer (tileset) entity —
    /// b3dm/pnts/glb sizes vary wildly ACROSS tilesets, so pools are never
    /// merged.
    Tiles3dLayer(Entity),
    /// Single pipeline-wide pool for hillshade DEM tiles. Their payload is a
    /// per-source constant (`tile_size² × 4` RGBA plus fixed edge strips), so
    /// a per-layer split would buy no accuracy and only slow the cold start.
    Hillshade,
    /// Single pipeline-wide pool for terrain tiles (RasterDEM and quantized
    /// mesh alike — one terrain source per session, so a per-source split
    /// would buy nothing). Unlike hillshade the landed cost is NOT a
    /// per-source constant: quantized-mesh payloads vary with vertex count
    /// (terrain roughness), and the resident cost is dominated by the mesh
    /// geometry plus the composite atlas. Fed the per-tile mesh geometry plus
    /// the atlas hint from `attach_terrain_mesh_cost`.
    Terrain,
}

/// Exponentially-weighted running mean and variance of landed tile costs.
#[derive(Debug, Clone, Copy, Default)]
pub struct EmaStats {
    mean: f64,
    var: f64,
    samples: u32,
}

impl EmaStats {
    /// Folds one (pre-clamped) sample into the EW statistics using the
    /// standard stable formulation:
    /// `mean += α·(x − mean)`; `var += α·((x − mean_old)·(x − mean_new) − var)`.
    fn record(&mut self, x: f64) {
        if self.samples == 0 {
            self.mean = x;
            self.var = 0.0;
        } else {
            let mean_old = self.mean;
            self.mean += RESERVE_EMA_ALPHA * (x - mean_old);
            self.var += RESERVE_EMA_ALPHA * ((x - mean_old) * (x - self.mean) - self.var);
        }
        self.samples = self.samples.saturating_add(1);
    }

    fn estimate(&self) -> f64 {
        self.mean + RESERVE_K_STDDEV * self.var.max(0.0).sqrt()
    }
}

/// Per-layer adaptive reservation estimator: running EMA mean + variance of
/// the ACTUAL costs of previously landed tiles, fed from each pipeline's
/// cost-attach point (vector `transfer_mesh` geometry bytes, 3D Tiles
/// `construct_system` payload bytes, hillshade DEM payload + edge strips).
/// [`Self::estimate`] returns `mean + K·stddev` (see [`RESERVE_K_STDDEV`]),
/// clamped to `[RESERVE_MIN_BYTES, RESERVE_MAX_BYTES]`; until a key has
/// [`RESERVE_MIN_SAMPLES`] samples it returns the caller's seed unchanged.
///
/// Entries are never explicitly dropped on layer removal: none of the
/// pipelines has a single cheap teardown choke point that still sees the layer
/// entity, and each entry is ~40 bytes keyed by layer entity — bounded by the
/// number of layers created over the session, which is negligible next to a
/// single tile payload.
#[derive(Resource, Debug, Default)]
pub struct ReserveEstimates {
    stats: HashMap<ReserveKey, EmaStats>,
}

impl ReserveEstimates {
    /// Records the actual landed cost of one tile for `key`. The sample is
    /// clamped to `[RESERVE_MIN_BYTES, RESERVE_MAX_BYTES]` BEFORE the EMA
    /// update, so a heavy-tail outlier cannot inflate (nor an empty tile
    /// deflate) future reservations through the statistics.
    pub fn record(&mut self, key: ReserveKey, sample_bytes: u64) {
        let clamped = sample_bytes.clamp(RESERVE_MIN_BYTES, RESERVE_MAX_BYTES);
        self.stats.entry(key).or_default().record(clamped as f64);
    }

    /// Reservation estimate for the next fetch of `key`: `mean + K·stddev`
    /// clamped to the sane range, or `seed_bytes` while the key is cold
    /// (fewer than [`RESERVE_MIN_SAMPLES`] samples).
    pub fn estimate(&self, key: ReserveKey, seed_bytes: u64) -> u64 {
        match self.stats.get(&key) {
            Some(s) if s.samples >= RESERVE_MIN_SAMPLES => {
                (s.estimate() as u64).clamp(RESERVE_MIN_BYTES, RESERVE_MAX_BYTES)
            }
            _ => seed_bytes,
        }
    }
}

#[cfg(test)]
mod hook_tests {
    use super::*;

    #[test]
    fn reserved_cost_hook_releases_on_despawn() {
        let mut world = bevy_ecs::world::World::new();
        world.init_resource::<MemoryLedger>();

        let e = world.spawn(ReservedCost::fixed(500)).id();
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, 500);

        // Replacing accounts the delta (on_discard subtract + on_insert add).
        world.entity_mut(e).insert(ReservedCost::fixed(200));
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, 200);

        // Explicit remove releases it.
        world.entity_mut(e).remove::<ReservedCost>();
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, 0);

        // Hold TWO live reservations and release one: the released bytes must be
        // subtracted EXACTLY once. Bevy fires `on_discard` then `on_remove` on
        // every removal/despawn, so a stray `on_remove` registration would
        // subtract twice here — leaving 700 - 500 = 200 instead of 700. A single
        // live reservation saturates at 0 and cannot catch this.
        let a = world.spawn(ReservedCost::fixed(500)).id();
        let _b = world.spawn(ReservedCost::fixed(700)).id();
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, 1200);
        // Despawn `a` (abort path): only its 500 bytes are released, `b`'s 700
        // remain — a double subtract would leave 200.
        world.despawn(a);
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, 700);
    }

    #[test]
    fn reserved_cost_for_key_resolves_via_hook() {
        let mut world = bevy_ecs::world::World::new();
        world.init_resource::<MemoryLedger>();
        world.init_resource::<ReserveEstimates>();

        // Cold estimator → the hook resolves to the key's seed.
        let seed = world
            .resource::<MemoryLedger>()
            .reserve_seed(ReserveKey::Terrain);
        let e = world.spawn(ReservedCost::for_key(ReserveKey::Terrain)).id();
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, seed);
        assert_eq!(world.get::<ReservedCost>(e).unwrap().bytes(), seed);

        // Warm the EMA past RESERVE_MIN_SAMPLES with a distinct landed cost:
        // a new reservation resolves to the EMA estimate, and releasing the
        // old one still subtracts the amount IT was resolved at.
        let landed = 4 * 1024 * 1024;
        for _ in 0..RESERVE_MIN_SAMPLES {
            world
                .resource_mut::<ReserveEstimates>()
                .record(ReserveKey::Terrain, landed);
        }
        let estimate = world
            .resource::<ReserveEstimates>()
            .estimate(ReserveKey::Terrain, seed);
        assert_ne!(estimate, seed, "test must distinguish EMA from seed");
        let e2 = world.spawn(ReservedCost::for_key(ReserveKey::Terrain)).id();
        assert_eq!(
            world.resource::<MemoryLedger>().reserved_bytes,
            seed + estimate
        );
        world.despawn(e);
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, estimate);
        world.despawn(e2);
        assert_eq!(world.resource::<MemoryLedger>().reserved_bytes, 0);
    }
}

#[cfg(test)]
mod reserve_estimator_tests {
    use super::*;

    const SEED: u64 = 512 * 1024;

    fn key_a() -> ReserveKey {
        ReserveKey::VectorLayer(Entity::from_raw_u32(1).unwrap())
    }

    fn key_b() -> ReserveKey {
        ReserveKey::VectorLayer(Entity::from_raw_u32(2).unwrap())
    }

    #[test]
    fn falls_back_to_the_seed_until_min_samples() {
        let mut est = ReserveEstimates::default();
        // No samples at all: seed.
        assert_eq!(est.estimate(key_a(), SEED), SEED);
        // One fewer than the minimum: still the seed.
        for _ in 0..RESERVE_MIN_SAMPLES - 1 {
            est.record(key_a(), 1024 * 1024);
        }
        assert_eq!(est.estimate(key_a(), SEED), SEED);
        // At the minimum the statistics take over.
        est.record(key_a(), 1024 * 1024);
        assert_ne!(est.estimate(key_a(), SEED), SEED);
    }

    #[test]
    fn ema_mean_and_variance_update_correctly() {
        // Constant samples: mean converges to the value, variance stays 0, so
        // the estimate equals the value exactly (K·0 adds nothing).
        let mut est = ReserveEstimates::default();
        let x = 2 * 1024 * 1024;
        for _ in 0..RESERVE_MIN_SAMPLES {
            est.record(key_a(), x);
        }
        assert_eq!(est.estimate(key_a(), SEED), x);

        // Reference-check the incremental formulas against a hand-rolled
        // computation over a varying sequence.
        let samples = [1_000_000u64, 3_000_000, 2_000_000, 5_000_000, 1_500_000];
        let mut est2 = ReserveEstimates::default();
        let (mut mean, mut var) = (samples[0] as f64, 0.0f64);
        for &s in &samples {
            est2.record(key_b(), s);
        }
        for &s in &samples[1..] {
            let x = s as f64;
            let mean_old = mean;
            mean += RESERVE_EMA_ALPHA * (x - mean_old);
            var += RESERVE_EMA_ALPHA * ((x - mean_old) * (x - mean) - var);
        }
        let expected = ((mean + RESERVE_K_STDDEV * var.max(0.0).sqrt()) as u64)
            .clamp(RESERVE_MIN_BYTES, RESERVE_MAX_BYTES);
        assert_eq!(est2.estimate(key_b(), SEED), expected);
        // Varying samples must produce a positive variance (estimate > mean).
        assert!(var > 0.0);
        assert!(expected as f64 > mean);
    }

    #[test]
    fn estimate_is_clamped_both_ways() {
        // Huge samples: both the sample clamp and the estimate clamp cap at
        // the ceiling, so one freak tile cannot inflate future reservations.
        let mut hi = ReserveEstimates::default();
        for _ in 0..RESERVE_MIN_SAMPLES {
            hi.record(key_a(), u64::MAX);
        }
        assert_eq!(hi.estimate(key_a(), SEED), RESERVE_MAX_BYTES);

        // Tiny samples: the floor stops a degenerate run from zeroing the
        // reservation.
        let mut lo = ReserveEstimates::default();
        for _ in 0..RESERVE_MIN_SAMPLES {
            lo.record(key_a(), 1);
        }
        assert_eq!(lo.estimate(key_a(), SEED), RESERVE_MIN_BYTES);
    }

    #[test]
    fn per_layer_pools_do_not_cross_contaminate() {
        let mut est = ReserveEstimates::default();
        for _ in 0..RESERVE_MIN_SAMPLES {
            est.record(key_a(), 128 * 1024);
            est.record(key_b(), 8 * 1024 * 1024);
        }
        let a = est.estimate(key_a(), SEED);
        let b = est.estimate(key_b(), SEED);
        assert_eq!(a, 128 * 1024);
        assert_eq!(b, 8 * 1024 * 1024);
        // A third, untouched key still gets the seed.
        assert_eq!(est.estimate(ReserveKey::Hillshade, SEED), SEED);
    }
}
