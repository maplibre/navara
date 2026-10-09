use bevy_ecs::prelude::*;
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, OrderByDistance, Priority, Rendered};
use navara_core::{TileXYZ, WGS84_64};
use navara_feature_component::{
    batch::BatchTable, batch::BatchedFeature, id::FeatureId, render::RenderableFeature,
};
use navara_fog::{DynamicSse, Fog};
use navara_frame::FrameManager;
use navara_globe::Globe;
use navara_math::Transform;

use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;

use navara_camera::{CameraFrustum, CameraMarker};
use navara_layer::{LayerId, LayerStore, TerrainLayer};
use navara_memory::{
    GPU_GEOMETRY_RESIDENCY_FACTOR, MemoryLedger, RetainedEntry, SseDegrade, SsePressure, TileCost,
};
use navara_tile_component::{
    TerrainExaggeration, TerrainInformationQuadtree, TerrainTileQuadtree, VectorTile,
    VectorTileQuadtree,
};
use navara_window::Window;
use rustc_hash::FxHashSet;

use crate::{
    ReloadSourceTiles, VectorResolveRevision, VectorTileFeatureMarker, VectorTileSourceResources,
    data_requester::{ChangedVectorTileDataRequesterQuery, VectorTileDataRequesterQuery},
    layer::{resource::LayerResources, tile_cache_manager::TileCacheManager},
    source::TileSource,
};

use super::render::{OwningVectorTile, RenderedTile, VectorTileGpuCost};
use super::traverse::{
    TraversalResult, activate_all_renderable_features, are_all_renderable_features_active,
    spawn_tile_entity, traverse_tile,
};

/// Generic tile update system that delegates to `TileSource::prepare_tile`.
///
/// Iterates all sources with a `TileSource` component, performing quadtree traversal
/// and tile preparation via the source's trait implementation.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn update_tiles(
    mut commands: Commands,
    // `.0` (TerrainInformationQuadtree) is kept only as the re-traversal change-detection
    // trigger (see `needs_update`); `.1` (the real TerrainTileQuadtree) supplies terrain
    // heights read by extent — the scheme-agnostic source the raster traverse uses, so the
    // vector SSE follows the terrain's subdivision depth. `.2` is bumped whenever a traverse
    // actually runs so the web side can skip its per-tile `getVectorTileStates` FFI when the
    // resolution is unchanged. `.3` maps those heights onto the rendered surface. Bundled
    // as one tuple param to stay within Bevy's per-system parameter limit.
    mut terrain: (
        Res<TerrainInformationQuadtree>,
        Res<TerrainTileQuadtree>,
        ResMut<VectorResolveRevision>,
        Res<TerrainExaggeration>,
    ),
    mut qts: Query<&mut VectorTileQuadtree>,
    mut tcs: Query<&mut TileCacheManager>,
    mut buf: ResMut<BufferStore>,
    frame: Res<FrameManager>,
    window: Res<Window>,
    mut source_query: Query<(Ref<VectorTileSourceResources>, &mut TileSource), Without<Deleted>>,
    mut camera_set: ParamSet<(
        Query<(&CameraMarker, Ref<Transform>, &CameraFrustum)>,
        Query<(Ref<Fog>, Ref<DynamicSse>)>,
    )>,
    mut data_requester: ParamSet<(
        VectorTileDataRequesterQuery,
        ChangedVectorTileDataRequesterQuery,
    )>,
    occluder: Query<&EllipsoidalOccluder>,
    rendered_tiles: Query<&RenderedTile>,
    mut features: ParamSet<(
        Query<&FeatureId, With<VectorTileFeatureMarker>>,
        Query<&FeatureId, (With<VectorTileFeatureMarker>, Changed<FeatureId>)>,
    )>,
    mut renderable_features: ParamSet<(
        Query<&mut RenderableFeature>,
        // TODO: This detects all `RenderableFeature` that has `Rendered`, but this isn't efficient.
        //       We should use another marker to detect if it is MVT's RenderableFeature.
        Query<(), (With<RenderableFeature>, Changed<Rendered>)>,
    )>,
    terrain_layer: Query<&TerrainLayer>,
    // Bundled to stay within Bevy's per-system parameter limit.
    globe: (Res<Globe>, Res<SsePressure>),
) {
    let (globe, pressure) = globe;
    let is_data_requester_changed = !data_requester.p1().is_empty();
    let are_features_changed = !features.p1().is_empty();
    let are_renderable_features_rendered = !renderable_features.p1().is_empty();

    let occluder = occluder.iter().next().unwrap();

    let (fog, dynamic_sse, is_fog_changed) = {
        let fog_query = camera_set.p1();
        let (fog, dynamic_sse) = fog_query.single().unwrap();
        (
            Fog::clone(&fog),
            DynamicSse::clone(&dynamic_sse),
            fog.is_changed() || dynamic_sse.is_changed(),
        )
    };
    let camera = camera_set.p0();

    // TODO: Think how to support multiple terrain layer.(Is it possible?)
    let terrain_layer = terrain_layer.iter().next();

    let mut renderable_features = renderable_features.p0();
    let data_requester = data_requester.p0();
    let features = features.p0();

    for (source, mut tile_source) in &mut source_query {
        let Ok(mut qt) = qts.get_mut(source.quadtree) else {
            continue;
        };
        let Ok(mut tc) = tcs.get_mut(source.tile_cache_manager) else {
            continue;
        };

        for (_, camera, frustum) in &camera {
            let needs_update = is_data_requester_changed
                || tc.needs_update
                || camera.is_added()
                || camera.is_changed()
                || are_features_changed
                || are_renderable_features_rendered
                || source.is_added()
                || terrain.0.is_changed()
                || terrain.3.is_changed()
                || is_fog_changed
                || pressure.is_changed();
            if !needs_update {
                continue;
            }

            // A traverse is about to run, so the resolved vector tiles for some terrain
            // tiles may change — signal the web side to re-fetch this frame.
            terrain.2.bump();

            tc.needs_update = false;

            tc.is_updated_in_this_frame = true;
            tc.last_rendered_frame = frame.rendered_frame();

            // Memory-pressure LOD degrade, same factor shape as terrain so
            // texturized-vector subdivision stays aligned for draping.
            let camera_pos = camera.transform_point(navara_math::Vec3::ZERO);
            let camera_height = WGS84_64
                .xyz_to_lle(navara_core::vec3_to_xyz(camera_pos))
                .height
                .val();
            let degrade = SseDegrade::new(
                pressure.multiplier,
                camera_height,
                pressure.min,
                pressure.max,
            );
            let dynamic_sse = dynamic_sse.term(camera_pos, camera.forward(), camera_height);

            // TODO: Use `root_handles` to cover geographic tiles.
            let zero_tile = match qt.qt.zero() {
                Some(z) => z,
                None => {
                    qt.qt
                        .initialize_zero(&|(x, y, z)| VectorTile::new(TileXYZ { x, y, z }, 0., 0.));
                    qt.qt
                        .zero()
                        .expect("Failed to initialize a level zero tile unexpectedly")
                }
            };
            let zero_tile_handle = zero_tile.handle();
            let is_rendered = matches!(
                are_all_renderable_features_active(
                    &tc,
                    &zero_tile_handle,
                    &rendered_tiles,
                    &features,
                    &mut renderable_features,
                ),
                Some(true)
            );

            qt.qt.get_mut(zero_tile_handle).unwrap().is_rendered = false;

            match traverse_tile(
                &mut commands,
                &source.source_id,
                zero_tile_handle,
                &mut qt,
                &mut tc,
                &frame,
                &camera,
                frustum,
                &window,
                &WGS84_64,
                occluder,
                &data_requester,
                &rendered_tiles,
                &features,
                &mut renderable_features,
                &fog,
                dynamic_sse,
                degrade,
                false,
                false,
                &terrain_layer,
                &terrain.1,
                &terrain.3,
                is_rendered.then_some(zero_tile_handle),
                &globe,
                &mut *tile_source.0,
                &mut buf,
            ) {
                TraversalResult::TileRendered => {
                    spawn_tile_entity(
                        &mut commands,
                        &mut tc,
                        qt.qt.get_mut(zero_tile_handle).unwrap(),
                        &frame,
                        zero_tile_handle,
                    );
                    activate_all_renderable_features(
                        &tc,
                        &zero_tile_handle,
                        &rendered_tiles,
                        &features,
                        &mut renderable_features,
                        true,
                    );

                    qt.qt.get_mut(zero_tile_handle).unwrap().is_rendered = is_rendered;
                }
                TraversalResult::NotFound => {
                    let tile = qt.qt.get_mut(zero_tile_handle).unwrap();
                    tile_source.0.prepare_tile(
                        &mut commands,
                        tile,
                        zero_tile_handle,
                        &mut tc,
                        &mut buf,
                        &data_requester,
                        Priority::Medium,
                    );
                }
                TraversalResult::ChildrenMeshPrepared => {
                    activate_all_renderable_features(
                        &tc,
                        &zero_tile_handle,
                        &rendered_tiles,
                        &features,
                        &mut renderable_features,
                        false,
                    );
                }
                _ => {}
            };
        }
    }
}

/// Generic mesh transfer system that delegates to `TileSource::construct_geometry`.
///
/// For each newly-rendered tile, calls the source's `construct_geometry` to create
/// feature entities, then inserts the `Rendered` marker.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn transfer_mesh(
    mut commands: Commands,
    mut batch_table: ResMut<BatchTable>,
    mut buf: ResMut<BufferStore>,
    qts: Query<&VectorTileQuadtree>,
    tcs: Query<&TileCacheManager>,
    mut source_query: Query<
        (Entity, &VectorTileSourceResources, &mut TileSource),
        Without<Deleted>,
    >,
    mut rendered_tiles: Query<(Entity, &mut RenderedTile, &OrderByDistance), Without<Rendered>>,
    data_requester: VectorTileDataRequesterQuery,
    mut estimates: ResMut<navara_memory::ReserveEstimates>,
) {
    for (source_entity, source, mut tile_source) in &mut source_query {
        let Ok(qt) = qts.get(source.quadtree) else {
            continue;
        };
        let Ok(tc) = tcs.get(source.tile_cache_manager) else {
            continue;
        };

        if !tc.is_updated_in_this_frame {
            continue;
        }

        for (rendered_tile_id, mut rendered_tile, order) in
            rendered_tiles.iter_mut().sort::<&OrderByDistance>()
        {
            let needs_update = rendered_tile.is_added();
            if !needs_update {
                continue;
            }

            if !tc.has_same_rendered_tile(&rendered_tile.tile_handle, &rendered_tile_id) {
                continue;
            }

            let tile = qt.qt.get(rendered_tile.tile_handle).unwrap();

            commands.entity(rendered_tile_id).insert(Rendered);

            let data_req = tile
                .data_requester_entity_id
                .and_then(|e| data_requester.get(e).ok())
                .map(|(_, dr)| dr);

            // The geometry buffers `construct_geometry` writes into the store
            // are handed to Three.js and removed from `BufferStore` a frame
            // later, so they leave the CPU byte count but persist on the GPU.
            // Measure their size here to charge the real per-tile GPU cost
            // rather than a flat guess.
            //
            // The store total alone is not a clean proxy: the synchronous MVT
            // path removes its source pbf from the store *inside*
            // `construct_geometry` (see `MvtSource::construct_geometry`), so the
            // net delta would be `geometry − pbf` and saturate toward zero when
            // the pbf is larger than the built geometry. Capture the pbf's byte
            // length up front (it is still resident here) and add it back so we
            // recover the geometry bytes alone. Sources with no store-resident
            // pbf (e.g. GeoJSON) contribute 0, leaving a plain additive delta.
            let pbf_bytes_before = data_req
                .and_then(|dr| buf.get(&dr.handle).map(|b| b.byte_len()))
                .unwrap_or(0) as u64;
            let buf_before = buf.total_bytes() as u64;

            if let Some(feature_ids) = tile_source.0.construct_geometry(
                &mut commands,
                &mut batch_table,
                &mut buf,
                tile,
                rendered_tile.tile_handle,
                rendered_tile_id,
                order,
                data_req,
            ) {
                if rendered_tile.feature_ids.is_some() {
                    panic!("It should be cleaned before new feature is added");
                }
                // Point each feature back at its owning tile so JS-side
                // per-feature memory reports (billboard atlases) can land on
                // this tile's cost (see `App::report_feature_gpu_bytes`).
                for feature_entity in &feature_ids {
                    commands
                        .entity(*feature_entity)
                        .insert(OwningVectorTile(rendered_tile_id));
                }
                rendered_tile.feature_ids = Some(feature_ids);

                // geometry = (total_after + pbf_removed) − total_before.
                let geometry_bytes =
                    (buf.total_bytes() as u64 + pbf_bytes_before).saturating_sub(buf_before);
                commands.entity(rendered_tile_id).insert((
                    estimate_vector_tile_cost(geometry_bytes),
                    VectorTileGpuCost::new(geometry_bytes),
                ));
                // Feed the per-layer reservation estimator with the landed
                // actual cost — this is the finalize point the dispatch-time
                // `ReservedCost` was protecting until. Failed fetches never
                // reach here (no geometry is constructed), and an
                // evicted-then-refetched tile simply records again.
                estimates.record(
                    navara_memory::ReserveKey::VectorLayer(source_entity),
                    geometry_bytes,
                );
            }
        }
    }
}

/// GPU cost estimate for a rendered vector tile: the geometry buffer bytes,
/// scaled by [`GPU_GEOMETRY_RESIDENCY_FACTOR`] (now 1). Three.js releases the
/// handed-off geometry's CPU-side typed array via `onUpload` after the first
/// upload (see the web `releaseGeometryArraysAfterUpload`), so only the GPU
/// copy stays resident (the WASM `BufferStore` copy is freed a frame after
/// upload, so unlike terrain it is not in `cpu_bytes`).
///
/// Neither the composite atlas nor the drape render targets are charged here:
/// both are owned per *terrain* tile (not per vector tile) and scale with
/// terrain subdivision past the vector `maxZoom`, which per-vector-tile
/// accounting cannot see. The atlas is charged on the terrain tile in
/// `attach_terrain_mesh_cost`; the drape render targets are reported from JS
/// against `TerrainTileGpuCost.drape` (see `report_terrain_drape_gpu_bytes`).
///
/// Billboard image atlases are also not charged here — they are allocated
/// lazily on the JS side (images load after the tile finalizes) and are folded
/// into this tile's cost later via [`VectorTileGpuCost`] when JS reports the
/// measured footprint (see `App::report_feature_gpu_bytes`).
pub fn estimate_vector_tile_cost(geometry_bytes: u64) -> TileCost {
    TileCost {
        cpu: 0,
        gpu_est: geometry_bytes.saturating_mul(GPU_GEOMETRY_RESIDENCY_FACTOR),
    }
}

/// Destroys a rendered tile and everything hanging off it: the entity, its
/// features, the quadtree node (which despawns the data requester), the
/// source's internal cache entry, and the layer-store features. This is the
/// single destroy path shared by `clear_caches` (budget disabled) and
/// `enforce_memory_budget` (eviction).
#[allow(clippy::too_many_arguments)]
fn destroy_rendered_tile(
    commands: &mut Commands,
    layer_store: &mut LayerStore,
    qt: &mut VectorTileQuadtree,
    tc: &mut TileCacheManager,
    tile_sources: &mut Query<&mut TileSource>,
    source_entity: Entity,
    rendered_tile_entity_id: Entity,
    rendered_tile: &mut RenderedTile,
    features: &Query<(&FeatureId, &LayerId)>,
    batched_features: &Query<&BatchedFeature>,
) {
    commands.entity(rendered_tile_entity_id).despawn();
    tc.rendered_tile_caches.remove(&rendered_tile.tile_handle);
    tc.requested_tile_caches.remove(&rendered_tile.tile_handle);
    tc.retained.remove(&rendered_tile.tile_handle);

    let removed_by_layer = rendered_tile.destroy(commands, features, batched_features);
    qt.qt
        .remove(rendered_tile.tile_handle)
        .unwrap()
        .destroy(commands);

    if let Ok(mut ts) = tile_sources.get_mut(source_entity) {
        ts.0.evict_tile(rendered_tile.tile_handle);
    }

    // Remove features from each layer's store
    for (layer_id, removed_features) in removed_by_layer {
        layer_store.remove_features(&layer_id, &removed_features);
    }
}

/// Destroys every resident tile of sources marked with [`ReloadSourceTiles`].
///
/// A layer that attaches to an already-cached source finds tiles that were
/// rendered without it; nothing re-parses a resident tile, so the layer would
/// stay invisible until natural eviction. Dropping the rendered tiles (and
/// flagging a re-traversal) rebuilds each tile with the source's current layer
/// list; worker parses in flight for the destroyed tiles are cancelled by the
/// existing eviction handling.
#[allow(clippy::too_many_arguments)]
pub fn reload_source_tiles(
    mut commands: Commands,
    mut layer_store: ResMut<LayerStore>,
    marked: Query<(Entity, &VectorTileSourceResources), With<ReloadSourceTiles>>,
    mut qts: Query<&mut VectorTileQuadtree>,
    mut tcs: Query<&mut TileCacheManager>,
    mut rendered_tiles: Query<&mut RenderedTile>,
    features: Query<(&FeatureId, &LayerId)>,
    batched_features: Query<&BatchedFeature>,
    mut tile_sources: Query<&mut TileSource>,
) {
    for (source_entity, resources) in &marked {
        if let (Ok(mut qt), Ok(mut tc)) = (
            qts.get_mut(resources.quadtree),
            tcs.get_mut(resources.tile_cache_manager),
        ) {
            let cached: Vec<Entity> = tc.rendered_tile_caches.values().copied().collect();
            for entity in cached {
                let Ok(mut rendered_tile) = rendered_tiles.get_mut(entity) else {
                    continue;
                };
                destroy_rendered_tile(
                    &mut commands,
                    &mut layer_store,
                    &mut qt,
                    &mut tc,
                    &mut tile_sources,
                    source_entity,
                    entity,
                    &mut rendered_tile,
                    &features,
                    &batched_features,
                );
            }
            tc.needs_update = true;
        }
        commands.entity(source_entity).remove::<ReloadSourceTiles>();
    }
}

/// Toggles the `RenderableFeature.active` flag for every feature of a
/// rendered tile. Used to hide retained tiles without despawning them.
fn set_rendered_tile_features_active(
    rendered_tile: &RenderedTile,
    features: &Query<(&FeatureId, &LayerId)>,
    renderable_features: &mut Query<&mut RenderableFeature>,
    active: bool,
) {
    let Some(feature_ids) = rendered_tile.feature_ids.as_ref() else {
        return;
    };
    for feature_entity in feature_ids {
        if let Ok((feature_id, _)) = features.get(*feature_entity)
            && let Some(renderable_entity) = feature_id.0
            && let Ok(mut renderable) = renderable_features.get_mut(renderable_entity)
        {
            renderable.activate(active);
        }
    }
}

/// Clears tile caches for tiles that are no longer visible.
///
/// When a memory budget is set, non-visited tiles are deactivated and moved
/// to the retention pool instead of being destroyed; `enforce_memory_budget`
/// evicts them later if the budget is exceeded.
#[allow(clippy::too_many_arguments)]
pub fn clear_caches(
    mut commands: Commands,
    mut layer_store: ResMut<LayerStore>,
    ledger: Res<MemoryLedger>,
    mut qts: Query<&mut VectorTileQuadtree>,
    mut tcs: Query<&mut TileCacheManager>,
    layers: Query<&LayerResources>,
    mut rendered_tiles: Query<(Entity, &mut RenderedTile, &OrderByDistance)>,
    tile_costs: Query<&TileCost>,
    batched_features: Query<&BatchedFeature>,
    features: Query<(&FeatureId, &LayerId)>,
    mut renderable_features: Query<&mut RenderableFeature>,
    mut tile_sources: Query<&mut TileSource>,
) {
    // Track which sources we've already processed to avoid duplicate work.
    let mut processed_sources = FxHashSet::default();

    for resources in &layers {
        // Skip if we've already processed this source
        if !processed_sources.insert(resources.source) {
            continue;
        }

        let Ok(mut qt) = qts.get_mut(resources.quadtree) else {
            continue;
        };
        let Ok(mut tc) = tcs.get_mut(resources.tile_cache_manager) else {
            continue;
        };

        // If the budget was disabled at runtime (`setCacheBytes(undefined)`),
        // retained tiles would otherwise leak forever: the loop below only runs
        // for tiles the latest traversal touched, and `enforce_memory_budget`
        // returns early with no budget. Destroy the whole retention pool so the
        // original destroy-on-unvisited behavior is restored. Mirrors the raster
        // layer's drain in `clear_raster_caches`; runs regardless of
        // `is_updated_in_this_frame` so an idle page is not left holding the pool
        // until the next traversal. (Kept per-layer per project convention
        // rather than sharing a cross-layer abstraction.)
        if !ledger.enabled() && !tc.retained.is_empty() {
            let retained: Vec<navara_tile_component::TileHandle> =
                tc.retained.keys().copied().collect();
            for handle in retained {
                let Some(entity) = tc.rendered_tile_caches.get(&handle).copied() else {
                    tc.retained.remove(&handle);
                    continue;
                };
                let Ok((_, mut rendered_tile, _)) = rendered_tiles.get_mut(entity) else {
                    tc.retained.remove(&handle);
                    continue;
                };
                destroy_rendered_tile(
                    &mut commands,
                    &mut layer_store,
                    &mut qt,
                    &mut tc,
                    &mut tile_sources,
                    resources.source,
                    entity,
                    &mut rendered_tile,
                    &features,
                    &batched_features,
                );
            }
        }

        if !tc.is_updated_in_this_frame {
            continue;
        }

        // Clean up rendered tiles that are no longer visited
        for (rendered_tile_entity_id, mut rendered_tile, _) in
            rendered_tiles.iter_mut().sort::<&OrderByDistance>().rev()
        {
            if !tc.has_same_rendered_tile(&rendered_tile.tile_handle, &rendered_tile_entity_id) {
                continue;
            }

            let visited_at = {
                let tile = qt.qt.get(rendered_tile.tile_handle).unwrap();
                tile.visited_at
            };

            if ledger.enabled() {
                // One-frame revisit grace, unified with terrain
                // (`survives_purge`): a tile visited as recently as
                // last_rendered_frame-1 stays active rather than entering the
                // retention pool, so an immediate pan-back never refetches.
                // Scoped to the budget path: it only defers entry into the
                // retention pool, which exists solely when a budget is set.
                if tc.last_rendered_frame <= visited_at + 1 {
                    continue;
                }
                // Retain: hide the tile's features but keep the entity, the
                // quadtree node, and the data requester alive so a revisit
                // reactivates it without refetching.
                if !tc.retained.contains_key(&rendered_tile.tile_handle) {
                    set_rendered_tile_features_active(
                        &rendered_tile,
                        &features,
                        &mut renderable_features,
                        false,
                    );
                    let cost = tile_costs
                        .get(rendered_tile_entity_id)
                        .copied()
                        .unwrap_or_default();
                    let retained_at = tc.last_rendered_frame;
                    tc.retained.insert(
                        rendered_tile.tile_handle,
                        RetainedEntry { retained_at, cost },
                    );
                }
                continue;
            }

            // Budget disabled: restore the original strict destroy-on-unvisited
            // behavior (no retention pool, so no revisit grace), matching the
            // requested-tile cleanup below and `clear_raster_caches`.
            if tc.last_rendered_frame <= visited_at {
                continue;
            }

            destroy_rendered_tile(
                &mut commands,
                &mut layer_store,
                &mut qt,
                &mut tc,
                &mut tile_sources,
                resources.source,
                rendered_tile_entity_id,
                &mut rendered_tile,
                &features,
                &batched_features,
            );
        }

        // Clean up requested tiles that are no longer visited
        let mut removed_handles = vec![];
        for handle in tc.requested_tile_caches.keys() {
            let tile_handle = *handle;

            // A retained tile keeps its `requested_tile_caches` entry; its
            // quadtree node must stay alive until eviction.
            if tc.retained.contains_key(&tile_handle) {
                continue;
            }

            let visited_at = {
                let tile = qt.qt.get(tile_handle).unwrap();
                tile.visited_at
            };

            if tc.last_rendered_frame <= visited_at {
                continue;
            }

            // Rendered tiles are handled (retained or destroyed) by the loop
            // above; destroying their quadtree node here would corrupt them.
            if tc.rendered_tile_caches.contains_key(&tile_handle) {
                continue;
            }

            qt.qt.remove(tile_handle).unwrap().destroy(&mut commands);
            if let Ok(mut ts) = tile_sources.get_mut(resources.source) {
                ts.0.evict_tile(tile_handle);
            }

            removed_handles.push(tile_handle);
        }

        for removed in removed_handles {
            tc.requested_tile_caches.remove(&removed);
        }
    }

    // Reset the update flag for all sources - need to iterate again since
    // we may have skipped some sources above due to !is_updated_in_this_frame
    let mut reset_sources = FxHashSet::default();
    for resources in &layers {
        if reset_sources.insert(resources.source)
            && let Ok(mut tc) = tcs.get_mut(resources.tile_cache_manager)
        {
            tc.is_updated_in_this_frame = false;
        }
    }
}

struct EvictionCandidate {
    source: Entity,
    quadtree: Entity,
    tile_cache_manager: Entity,
    entity: Entity,
    visited_at: usize,
    distance: f64,
    gpu_est: u64,
}

/// Evicts retained vector tiles, oldest-visited first, until usage drops to
/// the hysteresis target. Runs right after `clear_caches`.
#[allow(clippy::too_many_arguments)]
pub fn enforce_memory_budget(
    mut commands: Commands,
    mut ledger: ResMut<MemoryLedger>,
    pressure: Res<navara_memory::SsePressure>,
    buf: Res<BufferStore>,
    frame: Res<FrameManager>,
    mut layer_store: ResMut<LayerStore>,
    mut qts: Query<&mut VectorTileQuadtree>,
    mut tcs: Query<&mut TileCacheManager>,
    layers: Query<&LayerResources>,
    mut rendered_tiles: Query<(Entity, &mut RenderedTile, &OrderByDistance)>,
    batched_features: Query<&BatchedFeature>,
    features: Query<(&FeatureId, &LayerId)>,
    mut tile_sources: Query<&mut TileSource>,
) {
    let current_frame = frame.rendered_frame();

    // Purge entries that were revisited (traversal reactivated them) or whose
    // tile no longer exists. This must run for every layer regardless of the
    // budget, so it precedes the under-budget early-out below.
    let mut purged_sources = FxHashSet::default();
    for resources in &layers {
        if !purged_sources.insert(resources.source) {
            continue;
        }

        let Ok(qt) = qts.get(resources.quadtree) else {
            continue;
        };
        let Ok(mut tc) = tcs.get_mut(resources.tile_cache_manager) else {
            continue;
        };

        let last_rendered_frame = tc.last_rendered_frame;
        let rendered_tile_caches = std::mem::take(&mut tc.rendered_tile_caches);
        tc.retained.retain(|handle, _| {
            let Some(tile) = qt.qt.get(*handle) else {
                return false;
            };
            // Unified with terrain via `survives_purge`: this now grants the
            // one-frame revisit grace vector previously lacked (it used a strict
            // `visited_at < last_rendered_frame`), so a tile keeps its retention
            // slot for one extra frame after leaving view — matching terrain.
            rendered_tile_caches.contains_key(handle)
                && navara_memory::eviction::survives_purge(tile.visited_at, last_rendered_frame)
        });
        tc.rendered_tile_caches = rendered_tile_caches;
    }

    if ledger.budget_bytes.is_none() {
        return;
    }

    // While the load gate is closed, evict down to the reopen target even when
    // not over budget, or usage stranded in the hysteresis band would keep the
    // gate closed (and all new tile loads blocked) forever.
    let cpu_total = buf.total_bytes() as u64;
    let usage_est = ledger.usage(cpu_total);
    if !ledger.needs_eviction(usage_est, pressure.load_gate_closed) {
        return;
    }

    // Collect eviction candidates only now that we know we are over budget.
    let mut candidates: Vec<EvictionCandidate> = vec![];
    let mut processed_sources = FxHashSet::default();
    for resources in &layers {
        if !processed_sources.insert(resources.source) {
            continue;
        }

        let Ok(qt) = qts.get(resources.quadtree) else {
            continue;
        };
        let Ok(tc) = tcs.get(resources.tile_cache_manager) else {
            continue;
        };

        for (handle, entry) in tc.retained.iter() {
            // Never evict tiles that were only just retained; an immediate
            // pan-back must not refetch.
            if !navara_memory::eviction::is_evictable(entry.retained_at, current_frame) {
                continue;
            }
            let Some(entity) = tc.rendered_tile_caches.get(handle).copied() else {
                continue;
            };
            let Some(tile) = qt.qt.get(*handle) else {
                continue;
            };
            let distance = rendered_tiles
                .get(entity)
                .map(|(_, _, order)| order.distance)
                .unwrap_or(0.);
            candidates.push(EvictionCandidate {
                source: resources.source,
                quadtree: resources.quadtree,
                tile_cache_manager: resources.tile_cache_manager,
                entity,
                visited_at: tile.visited_at,
                distance,
                gpu_est: entry.cost.gpu_est,
            });
        }
    }

    // Oldest visit first; evict the farthest tiles first among equals.
    candidates.sort_by(|a, b| {
        navara_memory::eviction::order((a.visited_at, a.distance), (b.visited_at, b.distance))
    });

    let mut budget = navara_memory::eviction::EvictBudget::new(usage_est, ledger.evict_target());
    for candidate in candidates {
        if !budget.over_target() {
            break;
        }

        let Ok(mut qt) = qts.get_mut(candidate.quadtree) else {
            continue;
        };
        let Ok(mut tc) = tcs.get_mut(candidate.tile_cache_manager) else {
            continue;
        };
        let Ok((_, mut rendered_tile, _)) = rendered_tiles.get_mut(candidate.entity) else {
            continue;
        };

        // Snapshot the exact store total around the destroy so we can credit
        // whatever CPU bytes it frees *synchronously*. In practice a rendered
        // vector tile's geometry buffers were already handed to Three.js and
        // removed from the store a frame after upload, and its feature/batch
        // buffers are torn down through deferred commands — so this delta is
        // usually ~0 and the tile's lasting cost is its GPU geometry estimate
        // (`candidate.gpu_est`, made real by the finalize/transfer accounting).
        // The exact `BufferStore` total re-reads next frame and corrects any
        // deferred frees that land later.
        let store_before = buf.total_bytes() as u64;

        destroy_rendered_tile(
            &mut commands,
            &mut layer_store,
            &mut qt,
            &mut tc,
            &mut tile_sources,
            candidate.source,
            candidate.entity,
            &mut rendered_tile,
            &features,
            &batched_features,
        );

        // Credit each evicted tile with its OWN cost: its real GPU estimate plus
        // any bytes its destroy freed synchronously from the store. Never a
        // BufferStore-wide share — in a mixed scene the store is dominated by
        // terrain/DEM/3D Tiles payloads, so a share would over-credit each
        // vector eviction, stop the loop early while real memory stayed over
        // budget, and (by advancing `evicted_count` every frame) keep resetting
        // the SSE-pressure stall window so the degrade never fired.
        let freed_cpu = store_before.saturating_sub(buf.total_bytes() as u64);
        budget.credit(candidate.gpu_est, freed_cpu);
        // Credit the ledger so the other pipelines' enforce systems this frame
        // exclude this eviction (their `EvictBudget` is stack-local); the feature
        // despawn subtracting `gpu_est` from `gpu_bytes_est` is deferred.
        ledger.credit_pending_eviction(candidate.gpu_est);
        ledger.evicted_count += 1;
    }
}

#[cfg(test)]
mod memory_budget_tests {
    use super::*;
    use crate::source::{ReadyState, VectorTileSource};
    use bevy_app::{App, Update};
    use navara_frame::FramePlugin;
    use navara_memory::MIN_RETAIN_FRAMES;
    use std::any::Any;

    struct MockSource;

    impl VectorTileSource for MockSource {
        fn as_any_mut(&mut self) -> &mut dyn Any {
            self
        }

        fn prepare_tile(
            &mut self,
            _commands: &mut Commands,
            _tile: &mut VectorTile,
            _handle: navara_tile_component::TileHandle,
            _tc: &mut TileCacheManager,
            _buf: &mut BufferStore,
            _data_requesters: &VectorTileDataRequesterQuery,
            _priority: Priority,
        ) -> bool {
            false
        }

        fn construct_geometry(
            &mut self,
            _commands: &mut Commands,
            _batch_table: &mut BatchTable,
            _buf: &mut BufferStore,
            _tile: &VectorTile,
            _tile_handle: navara_tile_component::TileHandle,
            _rendered_tile: Entity,
            _order: &OrderByDistance,
            _data_requester: Option<&navara_data_requester::DataRequester>,
        ) -> Option<Vec<Entity>> {
            None
        }

        fn ready_state(
            &self,
            _tile: &VectorTile,
            _data_requesters: &VectorTileDataRequesterQuery,
        ) -> ReadyState {
            ReadyState::Pending
        }
    }

    struct Setup {
        rendered_tile_entity: Entity,
        tile_cache_manager: Entity,
        quadtree: Entity,
        handle: navara_tile_component::TileHandle,
    }

    /// One source with one rendered, non-visited tile (`visited_at == 0`,
    /// `last_rendered_frame == 2` to clear the +1 revisit grace).
    fn setup(app: &mut App, gpu_est: u64) -> Setup {
        let mut qt = VectorTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| VectorTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        let quadtree = app.world_mut().spawn(qt).id();

        let rendered_tile_entity = app
            .world_mut()
            .spawn((
                RenderedTile {
                    tile_handle: handle,
                    feature_ids: None,
                },
                OrderByDistance {
                    sse: 0.,
                    distance: 0.,
                },
                TileCost { cpu: 0, gpu_est },
            ))
            .id();

        let mut tc = TileCacheManager::default();
        tc.rendered_tile_caches.insert(handle, rendered_tile_entity);
        tc.last_rendered_frame = 2;
        tc.is_updated_in_this_frame = true;
        let tile_cache_manager = app.world_mut().spawn(tc).id();

        let source = app.world_mut().spawn(TileSource(Box::new(MockSource))).id();

        app.world_mut().spawn(LayerResources {
            layer_id: "test".to_string(),
            source,
            quadtree,
            tile_cache_manager,
        });

        Setup {
            rendered_tile_entity,
            tile_cache_manager,
            quadtree,
            handle,
        }
    }

    fn new_app(budget_bytes: Option<u64>) -> App {
        let mut app = App::new();
        app.add_plugins(FramePlugin);
        app.init_resource::<LayerStore>();
        app.init_resource::<BufferStore>();
        app.init_resource::<navara_memory::SsePressure>();
        app.insert_resource(MemoryLedger {
            budget_bytes,
            ..Default::default()
        });
        app
    }

    #[test]
    fn reload_source_tiles_rebuilds_marked_source() {
        use crate::source_cache::{SourceId, TraversalConfig};

        let mut app = new_app(None);
        let setup = setup(&mut app, 100);

        // Attach the shared resources + reload marker to a source entity, as
        // `prepare_layer_resource` does when a layer joins a cached source.
        let source_entity = app
            .world_mut()
            .query_filtered::<Entity, With<TileSource>>()
            .single(app.world())
            .unwrap();
        app.world_mut().entity_mut(source_entity).insert((
            VectorTileSourceResources::new(
                SourceId::new(
                    "https://example.com/tiles".to_string(),
                    TraversalConfig::default(),
                ),
                setup.quadtree,
                setup.tile_cache_manager,
                vec![],
            ),
            ReloadSourceTiles,
        ));

        app.add_systems(Update, reload_source_tiles);
        app.update();

        // The resident tile is destroyed so the next traversal re-renders it
        // with the source's current layer list, and the marker is consumed.
        assert!(app.world().get_entity(setup.rendered_tile_entity).is_err());
        let tc = app
            .world()
            .get::<TileCacheManager>(setup.tile_cache_manager)
            .unwrap();
        assert!(tc.rendered_tile_caches.is_empty());
        assert!(tc.needs_update);
        assert!(
            app.world()
                .get::<ReloadSourceTiles>(source_entity)
                .is_none()
        );
    }

    #[test]
    fn clear_caches_destroys_when_budget_disabled() {
        let mut app = new_app(None);
        let setup = setup(&mut app, 100);
        app.add_systems(Update, clear_caches);

        app.update();

        assert!(
            app.world().get_entity(setup.rendered_tile_entity).is_err(),
            "rendered tile entity should be despawned without a budget"
        );
        let tc = app
            .world()
            .get::<TileCacheManager>(setup.tile_cache_manager)
            .unwrap();
        assert!(tc.rendered_tile_caches.is_empty());
        assert!(tc.retained.is_empty());
        let qt = app
            .world()
            .get::<VectorTileQuadtree>(setup.quadtree)
            .unwrap();
        assert!(qt.qt.get(setup.handle).is_none());
        // The TileCost hook must have subtracted the despawned tile.
        assert_eq!(app.world().resource::<MemoryLedger>().gpu_bytes_est, 0);
    }

    #[test]
    fn clear_caches_retains_when_budget_enabled() {
        let mut app = new_app(Some(u64::MAX));
        let setup = setup(&mut app, 100);
        app.add_systems(Update, clear_caches);

        app.update();

        assert!(
            app.world().get_entity(setup.rendered_tile_entity).is_ok(),
            "rendered tile entity should stay alive under a budget"
        );
        let tc = app
            .world()
            .get::<TileCacheManager>(setup.tile_cache_manager)
            .unwrap();
        assert!(tc.rendered_tile_caches.contains_key(&setup.handle));
        assert!(tc.retained.contains_key(&setup.handle));
        let qt = app
            .world()
            .get::<VectorTileQuadtree>(setup.quadtree)
            .unwrap();
        assert!(qt.qt.get(setup.handle).is_some());
    }

    /// FIX 3: when the budget is disabled at runtime (`setCacheBytes(undefined)`)
    /// after tiles were already retained, `clear_caches` must drain the whole
    /// retention pool — otherwise those tiles leak forever (the eviction system
    /// returns early with no budget, and the unvisited-cleanup loop no longer
    /// sees them). The drain runs even on an idle page.
    #[test]
    fn clear_caches_drains_retention_pool_when_budget_disabled_at_runtime() {
        // Budget disabled, but a tile is already sitting in the retention pool
        // (retained under a previous budget). It must be destroyed.
        let mut app = new_app(None);
        let setup = setup(&mut app, 100);
        {
            let mut tc = app
                .world_mut()
                .get_mut::<TileCacheManager>(setup.tile_cache_manager)
                .unwrap();
            tc.retained.insert(
                setup.handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost {
                        cpu: 0,
                        gpu_est: 100,
                    },
                },
            );
            // Idle page: nothing traversed this frame. The drain must still run.
            tc.is_updated_in_this_frame = false;
        }
        app.add_systems(Update, clear_caches);

        app.update();

        assert!(
            app.world().get_entity(setup.rendered_tile_entity).is_err(),
            "retained tile must be destroyed when the budget is disabled"
        );
        let tc = app
            .world()
            .get::<TileCacheManager>(setup.tile_cache_manager)
            .unwrap();
        assert!(tc.retained.is_empty(), "retention pool must be drained");
        assert!(tc.rendered_tile_caches.is_empty());
        let qt = app
            .world()
            .get::<VectorTileQuadtree>(setup.quadtree)
            .unwrap();
        assert!(qt.qt.get(setup.handle).is_none());
        // The TileCost hook must have credited the ledger back to zero.
        assert_eq!(app.world().resource::<MemoryLedger>().gpu_bytes_est, 0);
    }

    /// FIX 2: each evicted tile is credited only with its OWN cost, never a
    /// BufferStore-wide share. A large unrelated store total (terrain / DEM /
    /// 3D Tiles payloads in a mixed scene) must NOT be attributed to vector
    /// evictions — otherwise a single eviction appears to free enormous memory,
    /// the loop stops while real memory stays over budget, and the per-frame
    /// `evicted_count` bump keeps resetting the SSE-pressure stall window.
    #[test]
    fn enforce_memory_budget_credits_only_own_cost_in_mixed_scene() {
        // Two retained vector tiles of 100 GPU bytes each (ledger gpu 200), plus
        // a large unrelated BufferStore payload (10_000 CPU bytes) standing in
        // for terrain/DEM/3D Tiles. Budget 6_100 (target ~5_185) is far above a
        // single tile's real cost, so a correct loop must evict *both* retained
        // tiles. The old share heuristic credited ~5_000 CPU per eviction and
        // stopped after one, leaving ~10_000 bytes resident and over budget.
        let mut app = new_app(Some(6_100));
        // Unrelated store payload not owned by any vector tile.
        app.world_mut()
            .resource_mut::<BufferStore>()
            .new_u8(vec![0u8; 10_000]);

        let old = setup(&mut app, 100);
        let new = setup(&mut app, 100);
        {
            let mut qt = app
                .world_mut()
                .get_mut::<VectorTileQuadtree>(new.quadtree)
                .unwrap();
            qt.qt.get_mut(new.handle).unwrap().visited_at = 1;
            let mut tc = app
                .world_mut()
                .get_mut::<TileCacheManager>(new.tile_cache_manager)
                .unwrap();
            // last_rendered_frame = 3 clears the +1 grace for visited_at == 1
            // (1 + 1 < 3), so this newer tile is still an eviction candidate.
            tc.last_rendered_frame = 3;
        }
        for s in [&old, &new] {
            let mut tc = app
                .world_mut()
                .get_mut::<TileCacheManager>(s.tile_cache_manager)
                .unwrap();
            tc.retained.insert(
                s.handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost {
                        cpu: 0,
                        gpu_est: 100,
                    },
                },
            );
        }
        app.add_systems(Update, enforce_memory_budget);

        for _ in 0..MIN_RETAIN_FRAMES {
            app.update();
        }

        assert!(
            app.world().get_entity(old.rendered_tile_entity).is_err(),
            "older retained tile must be evicted"
        );
        assert!(
            app.world().get_entity(new.rendered_tile_entity).is_err(),
            "the second retained tile must also be evicted — a single eviction \
             must not appear to free the whole store"
        );
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 2);
        assert_eq!(app.world().resource::<MemoryLedger>().gpu_bytes_est, 0);
    }

    #[test]
    fn enforce_memory_budget_evicts_oldest_down_to_target() {
        // Two retained tiles of 100 GPU bytes each; budget 150 forces one
        // eviction (target 127), and the older visit goes first.
        let mut app = new_app(Some(150));
        let old = setup(&mut app, 100);
        let new = setup(&mut app, 100);
        {
            let mut qt = app
                .world_mut()
                .get_mut::<VectorTileQuadtree>(new.quadtree)
                .unwrap();
            qt.qt.get_mut(new.handle).unwrap().visited_at = 1;
            let mut tc = app
                .world_mut()
                .get_mut::<TileCacheManager>(new.tile_cache_manager)
                .unwrap();
            // last_rendered_frame = 3 clears the +1 grace for visited_at == 1
            // (1 + 1 < 3), so this newer tile is still an eviction candidate.
            tc.last_rendered_frame = 3;
        }
        for s in [&old, &new] {
            let mut tc = app
                .world_mut()
                .get_mut::<TileCacheManager>(s.tile_cache_manager)
                .unwrap();
            tc.retained.insert(
                s.handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost {
                        cpu: 0,
                        gpu_est: 100,
                    },
                },
            );
        }
        app.add_systems(Update, enforce_memory_budget);

        // Advance past MIN_RETAIN_FRAMES; earlier frames must not evict.
        for _ in 0..MIN_RETAIN_FRAMES - 1 {
            app.update();
            assert!(app.world().get_entity(old.rendered_tile_entity).is_ok());
        }
        app.update();

        assert!(
            app.world().get_entity(old.rendered_tile_entity).is_err(),
            "older tile should be evicted"
        );
        assert!(
            app.world().get_entity(new.rendered_tile_entity).is_ok(),
            "newer tile should survive"
        );
        let ledger = app.world().resource::<MemoryLedger>();
        assert_eq!(ledger.evicted_count, 1);
        assert_eq!(ledger.gpu_bytes_est, 100);
    }

    #[test]
    fn enforce_memory_budget_purges_revisited_entries() {
        let mut app = new_app(Some(0));
        let setup = setup(&mut app, 100);
        {
            // Mark the tile as visited in the current frame.
            let mut qt = app
                .world_mut()
                .get_mut::<VectorTileQuadtree>(setup.quadtree)
                .unwrap();
            qt.qt.get_mut(setup.handle).unwrap().visited_at = 1;
            let mut tc = app
                .world_mut()
                .get_mut::<TileCacheManager>(setup.tile_cache_manager)
                .unwrap();
            tc.retained.insert(
                setup.handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost::default(),
                },
            );
        }
        app.add_systems(Update, enforce_memory_budget);

        for _ in 0..MIN_RETAIN_FRAMES + 1 {
            app.update();
        }

        // Revisited tiles leave the pool and are never evicted, even when
        // the budget is exceeded.
        assert!(app.world().get_entity(setup.rendered_tile_entity).is_ok());
        let tc = app
            .world()
            .get::<TileCacheManager>(setup.tile_cache_manager)
            .unwrap();
        assert!(tc.retained.is_empty());
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 0);
    }
}
