use bevy_ecs::{
    entity::Entity,
    prelude::{Query, Res, ResMut},
    query::Without,
};
use navara_buffer_store::BufferStore;
use navara_cesium3dtiles::ModelContentIndex;
use navara_component::Deleted;
use navara_feature_component::render::RenderableFeature;
use navara_fog::{DynamicSse, DynamicSseConfig, Fog, LodFogConfig};
use navara_memory::{MemoryLedger, TileCost};
use navara_tile_component::{TerrainTileGpuCost, TileHandle, TileMeshMarker};
use navara_vector_tile::{OwningVectorTile, VectorTileGpuCost};

use crate::App;

/// Snapshot of engine memory usage for diagnostics (surfaced to JS via
/// `Core.getMemoryStats`).
#[derive(Debug, Clone, Copy)]
pub struct MemoryStatsData {
    /// WASM-resident `BufferStore` bytes (`total - external`); the JS-side
    /// `InMemoryBufferStore` bytes are reported separately as
    /// `external_buffer_bytes`.
    pub buffer_total_bytes: u64,
    /// Bytes held by `External` `BufferStore` entries — the real data lives in
    /// the JS `InMemoryBufferStore`, not in WASM linear memory.
    pub external_buffer_bytes: u64,
    pub buffer_count: u32,
    pub gpu_bytes_est: u64,
    /// CPU bytes held outside `BufferStore` (attribute tables); dominant for
    /// attribute-rich data like Overture.
    pub external_cpu_bytes: u64,
    /// Estimated cost of in-flight fetches reserved at dispatch time
    /// (`ReservedCost`); folded into the gate/pressure usage until the tile
    /// lands or the request aborts.
    pub reserved_bytes: u64,
    /// Estimated GPU bytes of fixed screen-sized allocations (the
    /// postprocessing render-target stack), reported from the JS side.
    pub fixed_gpu_bytes: u64,
    pub budget_bytes: Option<u64>,
    pub evicted_count: u64,
    pub sse_multiplier: f32,
    pub retained_vector: u32,
    pub retained_terrain: u32,
    pub retained_raster: u32,
    pub retained_tiles3d: u32,
}

impl App {
    /// Replaces the owning tile's `TileCost.gpu_est` with the actual GPU byte
    /// size a rendered feature was measured at on the JS side, where the final
    /// GPU-resident form is materialized (decode/expansion happens there, so
    /// Rust-side payload estimates can badly undercount). `feature_bits` is the
    /// `RenderableFeature` entity from the render event (the one
    /// `renderable_feature_added` delivers to JS). No-op if the owner was
    /// already evicted before the report arrived.
    ///
    /// Resolution is per feature kind; a kind without a wired-up owner lookup
    /// is a no-op. Currently wired (two O(1) hops each, no scans — JS reports
    /// per feature, so a scan made tileset load O(N²)):
    ///
    /// **3D Tiles models (glTF/Draco)** — the report *replaces* `gpu_est` on
    /// the owning `RenderedCesium3dTileContent` (decode happens JS-side, so
    /// the payload estimate can badly undercount):
    /// 1. RenderableFeature → ModelGeometry: `transfer_mesh` embeds the
    ///    `ModelGeometry` entity in the `RenderableFeature::Model.feature_id`
    ///    field, so we read it straight off the reported entity.
    /// 2. ModelGeometry → content: `construct_system` records the link in
    ///    [`ModelContentIndex`] (removed on the content's destroy path).
    ///
    /// **Billboards** — the report is the measured texture-atlas footprint of
    /// the feature's JS mesh (CPU pixel buffer + GPU texture, allocated and
    /// grown lazily as images load); it is *folded into* the owning vector
    /// tile's cost next to the geometry term, replacing this feature's
    /// previous atlas report (`0` clears it — the mesh was disposed):
    /// 1. RenderableFeature → batched feature: `transfer_batched_mesh` embeds
    ///    the batched feature entity in `RenderableFeature::Billboard.feature_id`.
    /// 2. Batched feature → tile: the [`OwningVectorTile`] component inserted
    ///    at tile finalize points back at the `RenderedTile` entity, whose
    ///    [`VectorTileGpuCost`] carries the per-feature atlas terms.
    pub fn report_feature_gpu_bytes(&mut self, feature_bits: u64, gpu_bytes: u64) {
        let renderable_feature = Entity::from_bits(feature_bits);
        let world = self.app.world_mut();

        match world.get::<RenderableFeature>(renderable_feature) {
            // Hop 1: the `Model` variant carries the owning `ModelGeometry` entity.
            Some(RenderableFeature::Model { feature_id, .. }) => {
                let model_geometry = *feature_id;

                // Hop 2: invert ModelGeometry → content via the reverse index.
                let Some(rendered) = world
                    .get_resource::<ModelContentIndex>()
                    .and_then(|idx| idx.content_by_model.get(&model_geometry).copied())
                else {
                    return;
                };
                // Preserve cpu; re-inserting TileCost fires on_discard (subtract old)
                // then on_insert (add new), so the ledger auto-corrects.
                let cpu = world.get::<TileCost>(rendered).map(|t| t.cpu).unwrap_or(0);
                world.entity_mut(rendered).insert(TileCost {
                    cpu,
                    gpu_est: gpu_bytes,
                });
            }
            // Hop 1: the `Billboard` variant carries the batched feature entity.
            Some(RenderableFeature::Billboard { feature_id, .. }) => {
                let batched_feature = *feature_id;

                // Hop 2: batched feature → owning rendered tile. Non-tiled
                // billboards (no `OwningVectorTile`) are a no-op — they are
                // user-managed layers outside the tile budget's reach.
                let Some(tile) = world
                    .get::<OwningVectorTile>(batched_feature)
                    .map(|owner| owner.0)
                else {
                    return;
                };
                let Some(mut gpu_cost) = world.get_mut::<VectorTileGpuCost>(tile) else {
                    return;
                };
                gpu_cost.set_billboard_atlas(batched_feature, gpu_bytes);
                let gpu_est = gpu_cost.total();
                // Preserve cpu; re-inserting TileCost auto-corrects the ledger.
                let cpu = world.get::<TileCost>(tile).map(|t| t.cpu).unwrap_or(0);
                world.entity_mut(tile).insert(TileCost { cpu, gpu_est });
            }
            _ => {}
        }
    }

    /// Updates a terrain tile's drape render-target GPU footprint, measured on
    /// the JS side where the `WebGLRenderTarget`s are lazily allocated (one per
    /// live clamp-to-ground vector layer draped onto this tile). Preserves the
    /// mesh geometry estimate and re-derives `TileCost.gpu_est = geometry +
    /// drape`, so the memory ledger tracks drape memory that scales with terrain
    /// subdivision past the vector `maxZoom`. No-op if the tile was already
    /// evicted before the report arrived.
    pub fn report_terrain_drape_gpu_bytes(&mut self, handle: TileHandle, gpu_bytes: u64) {
        let world = self.app.world_mut();
        // Exclude meshes marked `Deleted` (deferred despawn): during a mesh
        // replacement the old entity survives a frame while a new mesh reuses
        // the same position-stable handle. Landing the report on the doomed
        // entity would drop the drape cost from the ledger when it despawns,
        // leaving the live tile's drape memory uncounted.
        let mut query = world.query_filtered::<(Entity, &TileMeshMarker), Without<Deleted>>();
        let Some(entity) = query
            .iter(world)
            .find(|(_, marker)| marker.handle == handle)
            .map(|(e, _)| e)
        else {
            return;
        };
        let mut cost = world
            .get::<TerrainTileGpuCost>(entity)
            .copied()
            .unwrap_or_default();
        cost.drape = gpu_bytes;
        // Re-inserting TileCost fires on_discard (subtract old) then on_insert
        // (add new), so the ledger auto-corrects.
        world.entity_mut(entity).insert((
            cost,
            TileCost {
                cpu: 0,
                gpu_est: cost.total(),
            },
        ));
    }

    /// Updates the LOD fog parameters (distance-based SSE relaxation used by
    /// the tile traversals). This does not affect any visual fog rendering.
    ///
    /// The value is buffered into [`LodFogConfig`] (`init_resource`'d at build)
    /// so a call that arrives BEFORE the first `App::update()` — when the `Fog`
    /// entity has not been spawned yet by the `Startup` system — is not dropped:
    /// the startup spawn reads the resource, and `apply_lod_fog_config` applies
    /// later changes to the live entity. The direct write below keeps the
    /// entity in step the same frame when it already exists.
    pub fn set_lod_fog(&mut self, enabled: bool, density: f64, sse_factor: f64) {
        let world = self.app.world_mut();
        if let Some(mut config) = world.get_resource_mut::<LodFogConfig>() {
            config.enabled = enabled;
            config.density = density;
            config.sse_factor = sse_factor;
        }
        let mut query = world.query::<&mut Fog>();
        for mut fog in query.iter_mut(world) {
            fog.enabled = enabled;
            fog.density = density;
            fog.sse_factor = sse_factor;
        }
    }

    /// Sets the dynamic screen-space-error relaxation (CesiumJS
    /// `dynamicScreenSpaceError` equivalent) applied by every tile traversal
    /// (3D Tiles, terrain, raster, vector), each scaling it by its own max SSE
    /// (`DynamicSseTerm::for_max_sse`).
    /// Buffered into [`DynamicSseConfig`] so a call before the first
    /// `App::update()` is honored, and applied to the live entity directly —
    /// same two-path shape as [`App::set_lod_fog`].
    #[allow(clippy::too_many_arguments)]
    pub fn set_dynamic_sse(
        &mut self,
        enabled: bool,
        density: f64,
        sse_factor: f64,
        height_falloff: f64,
        min_height: f64,
        max_height: f64,
    ) {
        let value = DynamicSse {
            enabled,
            density,
            sse_factor,
            height_falloff,
            min_height,
            max_height,
        };
        let world = self.app.world_mut();
        if let Some(mut config) = world.get_resource_mut::<DynamicSseConfig>() {
            config.0 = value.clone();
        }
        let mut query = world.query::<&mut DynamicSse>();
        for mut dynamic_sse in query.iter_mut(world) {
            *dynamic_sse = value.clone();
        }
    }

    /// Sets the memory-pressure SSE multiplier range: `min` is the resting
    /// base (far tiles are always this much coarser — >1 on mobile), `max`
    /// the ceiling the degrade may rise to under memory pressure.
    pub fn set_sse_multiplier_range(&mut self, min: f32, max: f32) {
        if let Some(mut ledger) = self.app.world_mut().get_resource_mut::<MemoryLedger>() {
            ledger.min_sse_multiplier = min.max(1.0);
            ledger.max_sse_multiplier = max.max(min.max(1.0));
        }
    }

    /// Caps the number of in-flight data fetches per tile pipeline. Mobile
    /// presets lower this to shrink the decode/upload burst on camera moves.
    pub fn set_max_pending_requests(&mut self, value: u32) {
        if let Some(mut limits) = self
            .app
            .world_mut()
            .get_resource_mut::<navara_data_requester::RequestLimits>()
        {
            limits.max_pendings = value;
        }
    }

    // === Memory budget ===

    pub fn set_cache_bytes(&mut self, bytes: Option<f64>) {
        if let Some(mut ledger) = self.app.world_mut().get_resource_mut::<MemoryLedger>() {
            ledger.budget_bytes = bytes.map(|b| b as u64);
        }
    }

    pub fn set_memory_cost_hints(&mut self, atlas_tile_bytes: f64, raster_tile_bytes: f64) {
        if let Some(mut ledger) = self.app.world_mut().get_resource_mut::<MemoryLedger>() {
            ledger.cost_hints.atlas_tile_bytes = atlas_tile_bytes as u64;
            ledger.cost_hints.raster_tile_bytes = raster_tile_bytes as u64;
        }
    }

    /// Sets the estimated GPU bytes of the fixed, screen-sized render-target
    /// stack (postprocessing ping-pong buffers, gbuffer MRT, depth textures).
    /// The JS side owns those allocations and re-reports on init, resize, and
    /// pass-list changes; see [`MemoryLedger::fixed_gpu_bytes`].
    pub fn set_fixed_gpu_bytes(&mut self, bytes: f64) {
        if let Some(mut ledger) = self.app.world_mut().get_resource_mut::<MemoryLedger>() {
            ledger.fixed_gpu_bytes = bytes as u64;
        }
    }

    pub fn memory_stats(&mut self) -> Option<MemoryStatsData> {
        let retained_vector: u32 = {
            let world = self.app.world_mut();
            let mut query = world.query::<&navara_vector_tile::TileCacheManager>();
            query.iter(world).map(|tc| tc.retained.len() as u32).sum()
        };

        let world = self.app.world();
        let store = world.get_resource::<BufferStore>()?;
        let ledger = world.get_resource::<MemoryLedger>();
        Some(MemoryStatsData {
            // WASM-resident only; the `External` entries' bytes live JS-side
            // (reported separately) so they don't inflate the WASM heap figure.
            buffer_total_bytes: (store.total_bytes() - store.external_bytes()) as u64,
            external_buffer_bytes: store.external_bytes() as u64,
            buffer_count: store.len() as u32,
            gpu_bytes_est: ledger.map(|l| l.gpu_bytes_est).unwrap_or(0),
            external_cpu_bytes: ledger.map(|l| l.external_cpu_bytes).unwrap_or(0),
            reserved_bytes: ledger.map(|l| l.reserved_bytes).unwrap_or(0),
            fixed_gpu_bytes: ledger.map(|l| l.fixed_gpu_bytes).unwrap_or(0),
            budget_bytes: ledger.and_then(|l| l.budget_bytes),
            evicted_count: ledger.map(|l| l.evicted_count).unwrap_or(0),
            sse_multiplier: ledger.map(|l| l.sse_multiplier).unwrap_or(1.0),
            retained_vector,
            retained_terrain: world
                .get_resource::<navara_tile::tile::tile_cache_manager::TileCacheManager>()
                .map(|tc| tc.retained.len() as u32)
                .unwrap_or(0),
            retained_raster: world
                .get_resource::<navara_tile::raster::RasterTileCacheManager>()
                .map(|tc| tc.retained.len() as u32)
                .unwrap_or(0),
            retained_tiles3d: world
                .get_resource::<navara_cesium3dtiles::Cesium3dTilesRetentionPool>()
                .map(|pool| pool.entries.len() as u32)
                .unwrap_or(0),
        })
    }
}

/// Sums every layer's fully-evictable retention pool into
/// [`MemoryLedger::retained_evictable_bytes`], so [`MemoryLedger::hard_usage`]
/// (which the load gate and pressure controller read) can exclude the
/// reclaimable cache. Runs in `MemoryAccountingSet` — before `update_sse_pressure`
/// — alongside the other ledger contributors.
///
/// Terrain / raster / 3D Tiles keep a single retention pool as a resource;
/// vector keeps one `TileCacheManager` per layer (a component), so it is summed
/// across the query.
pub fn sync_retained_bytes(
    terrain: Option<Res<navara_tile::tile::tile_cache_manager::TileCacheManager>>,
    raster: Option<Res<navara_tile::raster::RasterTileCacheManager>>,
    tiles3d: Option<Res<navara_cesium3dtiles::Cesium3dTilesRetentionPool>>,
    vector: Query<&navara_vector_tile::TileCacheManager>,
    mut ledger: ResMut<MemoryLedger>,
) {
    let mut total: u64 = 0;
    if let Some(t) = terrain {
        total += t.retained.values().map(|e| e.cost.total()).sum::<u64>();
    }
    if let Some(r) = raster {
        total += r.retained.values().map(|e| e.cost.total()).sum::<u64>();
    }
    if let Some(p) = tiles3d {
        total += p.entries.values().map(|e| e.cost.total()).sum::<u64>();
    }
    for tc in &vector {
        total += tc.retained.values().map(|e| e.cost.total()).sum::<u64>();
    }
    ledger.retained_evictable_bytes = total;
}

#[cfg(test)]
mod lod_fog_tests {
    use super::*;

    #[test]
    fn set_lod_fog_updates_the_fog_entity() {
        let mut app = App::new();
        // First update runs the startup schedule that spawns the Fog entity.
        app.update(0.);

        app.set_lod_fog(false, 4.0e-4, 6.0);

        let world = app.app.world_mut();
        let mut query = world.query::<&Fog>();
        let fog = query
            .iter(world)
            .next()
            .expect("Fog entity should be spawned at startup");
        assert!(!fog.enabled);
        assert_eq!(fog.density, 4.0e-4);
        assert_eq!(fog.sse_factor, 6.0);
    }

    #[test]
    fn set_lod_fog_before_first_update_takes_effect() {
        // `ThreeView.init()` calls `setLodFog` before the render loop's first
        // `App::update()`, so the `Fog` entity does not exist yet: the value must
        // be buffered into `LodFogConfig` and applied once the entity spawns.
        let mut app = App::new();
        // No update yet — the Startup system has not run, so no Fog entity.
        app.set_lod_fog(false, 1.0e-1, 12.0);

        // First update: the Startup spawn seeds from the buffered config.
        app.update(0.);

        let world = app.app.world_mut();
        let mut query = world.query::<&Fog>();
        let fog = query
            .iter(world)
            .next()
            .expect("Fog entity should be spawned at startup");
        assert!(!fog.enabled);
        assert_eq!(fog.density, 1.0e-1);
        assert_eq!(fog.sse_factor, 12.0);
    }
}

#[cfg(test)]
mod report_feature_gpu_bytes_tests {
    use super::*;
    use bevy_ecs::entity::Entity;
    use navara_cesium3dtiles::RenderedCesium3dTileContent;
    use navara_feature_component::model::ModelGeometry;

    /// Spawns a `RenderableFeature::Model` whose `feature_id` points at
    /// `model_geometry` — the same embed `transfer_mesh` builds — so
    /// `report_feature_gpu_bytes` can read the ModelGeometry entity off it (hop 1).
    fn spawn_model_renderable(
        world: &mut bevy_ecs::world::World,
        model_geometry: Entity,
    ) -> Entity {
        world
            .spawn(RenderableFeature::Model {
                coordinates: navara_math::Vec3::ZERO,
                crs: navara_core::CRS::Geocentric,
                active: true,
                material: navara_material::ModelMaterial::default(),
                transform: navara_math::Transform::default(),
                feature_id: model_geometry,
                render_info: Default::default(),
                bin: None,
                geometry: Default::default(),
                aabb: navara_core::Aabb::default(),
                feature_batch_id: 0,
                batch_length: 0,
            })
            .id()
    }

    #[test]
    fn replaces_tile_cost_and_corrects_ledger() {
        let mut app = App::new();
        app.update(0.);
        let world = app.app.world_mut();

        // Reproduce the real topology two-hop link: the tile's `feature_id`
        // points at the `ModelGeometry` entity, `ModelContentIndex` maps that
        // entity back to the content, and the reported `RenderableFeature::Model`
        // embeds the `ModelGeometry` entity in its `feature_id` field.
        let model_geometry = world
            .spawn(ModelGeometry {
                coords: navara_math::Vec3::ZERO,
                crs: navara_core::CRS::Geocentric,
            })
            .id();
        let renderable_feature = spawn_model_renderable(world, model_geometry);
        let layer = world.spawn_empty().id();
        let requester = world.spawn_empty().id();

        let content = world
            .spawn((
                RenderedCesium3dTileContent {
                    layer_id: layer,
                    feature_id: Some(model_geometry),
                    data_requester_id: requester,
                    is_visible: true,
                    touched: true,
                },
                TileCost {
                    cpu: 0,
                    gpu_est: 100,
                },
            ))
            .id();
        world
            .resource_mut::<ModelContentIndex>()
            .content_by_model
            .insert(model_geometry, content);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            100
        );

        // JS reports the real decoded size using the `RenderableFeature` id,
        // exactly as the `renderable_feature_added` event delivers it.
        app.report_feature_gpu_bytes(renderable_feature.to_bits(), 5000);

        let rendered_cost = app.app.world().get::<TileCost>(content).copied().unwrap();
        assert_eq!(rendered_cost.gpu_est, 5000);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            5000
        );
    }

    #[test]
    fn unknown_feature_is_a_noop() {
        let mut app = App::new();
        app.update(0.);
        // A bits value with no matching RenderableFeature must not panic.
        app.report_feature_gpu_bytes(Entity::from_bits(123).to_bits(), 5000);
    }

    #[test]
    fn feature_without_owning_tile_is_a_noop() {
        let mut app = App::new();
        app.update(0.);
        // A `RenderableFeature::Model` exists but its `ModelGeometry` is not in
        // the content index (no tile owns it) — the report must not panic.
        let model_geometry = app.app.world_mut().spawn_empty().id();
        let renderable_feature = spawn_model_renderable(app.app.world_mut(), model_geometry);
        app.report_feature_gpu_bytes(renderable_feature.to_bits(), 5000);
    }
}

#[cfg(test)]
mod report_billboard_atlas_bytes_tests {
    use super::*;
    use bevy_ecs::entity::Entity;

    /// Spawns a `RenderableFeature::Billboard` whose `feature_id` points at
    /// `batched_feature` — the same embed `transfer_batched_mesh` builds — so
    /// `report_feature_gpu_bytes` can read the batched entity off it (hop 1).
    fn spawn_billboard_renderable(
        world: &mut bevy_ecs::world::World,
        batched_feature: Entity,
    ) -> Entity {
        world
            .spawn(RenderableFeature::Billboard {
                coordinates: navara_math::Vec3::ZERO,
                crs: navara_core::CRS::Geocentric,
                active: true,
                material: navara_material::BillboardMaterial::default(),
                transform: navara_math::Transform::default(),
                feature_id: batched_feature,
                render_info: Default::default(),
                geometry: Default::default(),
                feature_batch_id: 0,
                batch_length: 0,
            })
            .id()
    }

    /// Spawns a rendered-tile entity with a geometry-only cost and one owned
    /// batched feature, reproducing the topology the finalize point in
    /// `navara_vector_tile` builds (`OwningVectorTile` + `VectorTileGpuCost`).
    fn spawn_tile_with_feature(app: &mut App, geometry: u64) -> (Entity, Entity, Entity) {
        let world = app.app.world_mut();
        let tile = world
            .spawn((
                VectorTileGpuCost::new(geometry),
                TileCost {
                    cpu: 0,
                    gpu_est: geometry,
                },
            ))
            .id();
        let batched_feature = world.spawn(OwningVectorTile(tile)).id();
        let renderable = spawn_billboard_renderable(world, batched_feature);
        (tile, batched_feature, renderable)
    }

    #[test]
    fn folds_atlas_into_owning_tile_and_corrects_ledger() {
        let mut app = App::new();
        app.update(0.);
        let (tile, _, renderable) = spawn_tile_with_feature(&mut app, 1000);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            1000
        );

        // JS reports the measured atlas footprint using the RenderableFeature
        // id, exactly as the `renderable_feature_added` event delivers it.
        app.report_feature_gpu_bytes(renderable.to_bits(), 500);

        let cost = app.app.world().get::<TileCost>(tile).copied().unwrap();
        assert_eq!(cost.gpu_est, 1500);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            1500
        );

        // A later report replaces (not accumulates) this feature's atlas term.
        app.report_feature_gpu_bytes(renderable.to_bits(), 200);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            1200
        );

        // A zero report clears the term (the JS mesh was disposed).
        app.report_feature_gpu_bytes(renderable.to_bits(), 0);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            1000
        );
    }

    #[test]
    fn sums_atlases_across_features_of_one_tile() {
        // One tile can own several billboard meshes (one per layer sharing the
        // source); each reports independently and the terms must sum.
        let mut app = App::new();
        app.update(0.);
        let (tile, _, renderable_a) = spawn_tile_with_feature(&mut app, 1000);
        let world = app.app.world_mut();
        let batched_b = world.spawn(OwningVectorTile(tile)).id();
        let renderable_b = spawn_billboard_renderable(world, batched_b);

        app.report_feature_gpu_bytes(renderable_a.to_bits(), 500);
        app.report_feature_gpu_bytes(renderable_b.to_bits(), 300);

        let cost = app.app.world().get::<TileCost>(tile).copied().unwrap();
        assert_eq!(cost.gpu_est, 1800);
    }

    #[test]
    fn feature_without_owning_tile_is_a_noop() {
        // GeoJSON-style billboards have no `OwningVectorTile`; the report must
        // not panic and must leave the ledger untouched.
        let mut app = App::new();
        app.update(0.);
        let batched_feature = app.app.world_mut().spawn_empty().id();
        let renderable = spawn_billboard_renderable(app.app.world_mut(), batched_feature);
        app.report_feature_gpu_bytes(renderable.to_bits(), 500);
        assert_eq!(app.app.world().resource::<MemoryLedger>().gpu_bytes_est, 0);
    }
}

#[cfg(test)]
mod report_terrain_drape_gpu_bytes_tests {
    use super::*;

    #[test]
    fn adds_drape_to_geometry_and_corrects_ledger() {
        let mut app = App::new();
        app.update(0.);
        let world = app.app.world_mut();

        // A terrain mesh tile with a geometry-only cost, keyed by its handle.
        let handle: TileHandle = 42;
        world.spawn((
            TileMeshMarker {
                handle,
                ready_parent_tile_handle: None,
            },
            TerrainTileGpuCost {
                geometry: 1000,
                drape: 0,
            },
            TileCost {
                cpu: 0,
                gpu_est: 1000,
            },
        ));
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            1000
        );

        // JS reports the drape render-target footprint.
        app.report_terrain_drape_gpu_bytes(handle, 500);

        let cost = app
            .app
            .world_mut()
            .query::<&TileCost>()
            .iter(app.app.world())
            .next()
            .copied()
            .unwrap();
        assert_eq!(cost.gpu_est, 1500);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            1500
        );

        // A later report replaces (not accumulates) the drape term.
        app.report_terrain_drape_gpu_bytes(handle, 200);
        assert_eq!(
            app.app.world().resource::<MemoryLedger>().gpu_bytes_est,
            1200
        );
    }

    #[test]
    fn unknown_handle_is_a_noop() {
        let mut app = App::new();
        app.update(0.);
        // A handle with no matching terrain tile must not panic.
        app.report_terrain_drape_gpu_bytes(999, 500);
    }

    #[test]
    fn skips_deleted_mesh_and_lands_on_live_tile() {
        let mut app = App::new();
        app.update(0.);
        let world = app.app.world_mut();

        // Mid mesh-replacement: an old mesh entity for this handle is marked
        // `Deleted` (deferred despawn) while a new live mesh reuses the same
        // position-stable handle. The drape report must skip the `Deleted` one.
        let handle: TileHandle = 42;
        let deleted_mesh = world
            .spawn((
                TileMeshMarker {
                    handle,
                    ready_parent_tile_handle: None,
                },
                TerrainTileGpuCost {
                    geometry: 1000,
                    drape: 0,
                },
                TileCost {
                    cpu: 0,
                    gpu_est: 1000,
                },
                Deleted,
            ))
            .id();
        let live_mesh = world
            .spawn((
                TileMeshMarker {
                    handle,
                    ready_parent_tile_handle: None,
                },
                TerrainTileGpuCost {
                    geometry: 2000,
                    drape: 0,
                },
                TileCost {
                    cpu: 0,
                    gpu_est: 2000,
                },
            ))
            .id();

        app.report_terrain_drape_gpu_bytes(handle, 500);

        // The drape lands on the live tile; the deleted one is untouched.
        let live_cost = app.app.world().get::<TileCost>(live_mesh).copied().unwrap();
        assert_eq!(live_cost.gpu_est, 2500);
        let deleted_cost = app
            .app
            .world()
            .get::<TileCost>(deleted_mesh)
            .copied()
            .unwrap();
        assert_eq!(deleted_cost.gpu_est, 1000);
    }
}

#[cfg(test)]
mod sse_multiplier_range_tests {
    use super::*;

    #[test]
    fn sets_min_and_max_on_ledger() {
        let mut app = App::new();
        app.update(0.);
        app.set_sse_multiplier_range(2.0, 12.0);
        let ledger = app.app.world().resource::<MemoryLedger>();
        assert_eq!(ledger.min_sse_multiplier, 2.0);
        assert_eq!(ledger.max_sse_multiplier, 12.0);
    }

    #[test]
    fn guards_min_ge_one_and_max_ge_min() {
        let mut app = App::new();
        app.update(0.);
        app.set_sse_multiplier_range(0.5, 0.2);
        let ledger = app.app.world().resource::<MemoryLedger>();
        assert_eq!(ledger.min_sse_multiplier, 1.0);
        assert_eq!(ledger.max_sse_multiplier, 1.0);
    }
}
