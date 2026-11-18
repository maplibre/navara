//! Generic cleanup system for all tile content formats.
//!
//! This system removes tiles that are no longer visible AND no longer
//! touched. Touched tiles (e.g., parents in REPLACE refinement waiting
//! for children to load) are preserved to avoid unnecessary reconstruction.
//! When a memory budget is set, untouched invisible tiles are also
//! preserved (deactivated) in a retention pool until the budget forces
//! eviction — see [`enforce_memory_budget`].

use bevy_ecs::{
    entity::Entity,
    prelude::Resource,
    query::{With, Without},
    system::{Commands, Query, Res, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::Deleted;
use navara_data_requester::DataRequester;
use navara_feature_component::{id::FeatureId, model::ModelGeometry, render::RenderableFeature};
use navara_frame::FrameManager;
use navara_layer::LayerId;
use navara_material::ModelMaterial;
use navara_math::Transform;
use navara_memory::{MemoryLedger, RetainedEntry, TileCost};
use rustc_hash::FxHashMap;

use crate::{
    Cesium3dTileContentDataRequesterMarker, RenderedCesium3dTileContent, TileOrderByDistance,
    cesium3dtiles::Cesium3dTilesTree, tile_content_parser::TileContentParser,
};

/// Retention pool for 3D Tiles: rendered-content entities that are neither
/// visible nor touched but are kept alive (feature deactivated) until the
/// memory budget forces eviction. Keyed by the rendered-content entity —
/// 3D Tiles have no quadtree handle.
#[derive(Default, Resource)]
pub struct Cesium3dTilesRetentionPool {
    pub entries: FxHashMap<Entity, RetainedEntry>,
}

/// Reverse index `ModelGeometry entity → RenderedCesium3dTileContent entity`,
/// so `App::report_feature_gpu_bytes` can find the content that owns a reported
/// model in O(1) instead of scanning every rendered content. Populated by
/// `construct_model_by_cesium3dtiles_layer` when it links `tile.feature_id` to
/// the spawned `ModelGeometry` entity, and removed on the single destroy path
/// (`destroy_rendered_tile_content`) so it never leaks evicted entities.
#[derive(Default, Resource)]
pub struct ModelContentIndex {
    pub content_by_model: FxHashMap<Entity, Entity>,
}

type FeatureQueryFilter = (
    With<LayerId>,
    With<ModelGeometry>,
    With<ModelMaterial>,
    With<Transform>,
);

/// Syncs the tile's `RenderableFeature::Model.active` flag with the tile's
/// visibility, avoiding writes (and the change-detection they trigger) when
/// nothing changed.
fn sync_tile_feature_active(
    tile: &RenderedCesium3dTileContent,
    features: &Query<&FeatureId, FeatureQueryFilter>,
    renderable_features: &mut Query<&mut RenderableFeature>,
) {
    let mut renderable_feature = match tile
        .feature_id
        .and_then(|id| features.get(id).ok())
        .and_then(|renderable_feature_id| renderable_feature_id.0)
        .and_then(|renderable_feature_id| renderable_features.get_mut(renderable_feature_id).ok())
    {
        Some(renderable_feature) => renderable_feature,
        None => return,
    };
    // Avoid updating `RenderableFeature`, because it trigger some processes.
    let RenderableFeature::Model { active, .. } = renderable_feature.as_ref() else {
        return;
    };
    if *active != tile.is_visible
        && let RenderableFeature::Model { active, .. } = renderable_feature.as_mut()
    {
        *active = tile.is_visible;
    }
}

/// Destroys a rendered tile content entity and everything hanging off it:
/// the feature entities, the data requester (and its BufferStore payload —
/// this `buf.remove` is part of the pre-existing destroy path), and the
/// entity itself. Shared by `remove_invisible_rendered_tiles` (budget
/// disabled) and `enforce_memory_budget` (eviction).
#[allow(clippy::too_many_arguments)]
pub(crate) fn destroy_rendered_tile_content(
    commands: &mut Commands,
    buf: &mut BufferStore,
    pool: &mut Cesium3dTilesRetentionPool,
    model_index: &mut ModelContentIndex,
    entity: Entity,
    tile: &RenderedCesium3dTileContent,
    requester_handle: Option<navara_buffer_store::Handle>,
    features: &Query<&FeatureId, FeatureQueryFilter>,
) {
    pool.entries.remove(&entity);

    if let Some(feature_id) = tile.feature_id {
        // `feature_id` is the `ModelGeometry` entity; drop its reverse-index
        // entry so it does not leak past the content's destruction.
        model_index.content_by_model.remove(&feature_id);
        commands.entity(feature_id).insert(Deleted);
        if let Ok(rendered_feature_id) = features.get(feature_id)
            && let Some(rendered_feature_id) = rendered_feature_id.0
        {
            commands.entity(rendered_feature_id).insert(Deleted);
        }
    }

    // Remove data requester
    if let Some(handle) = requester_handle {
        buf.remove(&handle);
        commands.entity(tile.data_requester_id).insert(Deleted);
    }

    commands.entity(entity).despawn();
}

/// Generic cleanup for all tile content formats.
///
/// Deletes all associated entities when the tile is no longer visible
/// and no longer touched. Touched tiles are preserved during REPLACE
/// refinement to avoid reconstruction when they become visible again.
/// When a memory budget is set, untouched invisible tiles move to the
/// retention pool (feature hidden, requester and buffers kept) instead.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn remove_invisible_rendered_tiles<T: TileContentParser>(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    ledger: Res<MemoryLedger>,
    frame: Res<FrameManager>,
    mut pool: ResMut<Cesium3dTilesRetentionPool>,
    mut model_index: ResMut<ModelContentIndex>,
    requesters: Query<
        &DataRequester,
        (
            With<Cesium3dTileContentDataRequesterMarker>,
            With<T::RequesterMarker>,
            Without<Deleted>,
        ),
    >,
    rendered_tiles: Query<
        (
            Entity,
            &RenderedCesium3dTileContent,
            &TileOrderByDistance,
            Option<&TileCost>,
        ),
        With<T::RenderedMarker>,
    >,
    features: Query<&FeatureId, FeatureQueryFilter>,
    mut renderable_features: Query<&mut RenderableFeature>,
) {
    for (entity, tile, _, cost) in &rendered_tiles {
        // Touched tiles are preserved — toggle visibility instead of deleting.
        // Visible tiles get the same sync so a tile revived from the
        // retention pool reactivates its feature.
        // TODO: Disabling this reduce memory usage, so we can provide an API to do it,
        //       but we don't implement it to follow the specification.
        if (tile.touched || tile.is_visible) && tile.feature_id.is_some() {
            sync_tile_feature_active(tile, &features, &mut renderable_features);
            continue;
        }

        if tile.is_visible || tile.touched {
            continue;
        }

        if ledger.enabled() {
            // Retain: hide the feature but keep the entity, the requester,
            // and the payload buffers alive so a revisit reactivates the
            // tile without refetching.
            match pool.entries.entry(entity) {
                std::collections::hash_map::Entry::Vacant(vacant) => {
                    vacant.insert(RetainedEntry {
                        retained_at: frame.rendered_frame(),
                        cost: cost.copied().unwrap_or_default(),
                    });
                }
                std::collections::hash_map::Entry::Occupied(mut occupied) => {
                    // This system re-runs every frame, so refresh the snapshot
                    // from the current `TileCost` (keeping `retained_at`): the
                    // Draco decode reported via `report_feature_gpu_bytes` lands a
                    // larger cost on the still-pooled entity a frame later, and a
                    // Vacant-only insert would leave the pool crediting the stale
                    // compressed-payload estimate for the pool total / eviction.
                    occupied.get_mut().cost = cost.copied().unwrap_or_default();
                }
            }
            // Re-sync every frame the tile is pooled: a `RenderableFeature`
            // that spawns a frame after the tile was pooled (its `feature_id`
            // was `None` on insertion) would otherwise render as a permanent
            // ghost, since the deactivation above no-ops until it exists.
            sync_tile_feature_active(tile, &features, &mut renderable_features);
            continue;
        }

        let requester_handle = requesters
            .get(tile.data_requester_id)
            .ok()
            .map(|r| r.handle);
        destroy_rendered_tile_content(
            &mut commands,
            &mut buf,
            &mut pool,
            &mut model_index,
            entity,
            tile,
            requester_handle,
            &features,
        );
    }
}

/// Evicts retained 3D Tiles, oldest-retained first, until usage drops to the
/// hysteresis target, and enforces each tree's `max_num_rendered_tiles` as a
/// count cap over the RETAINED POOL only (pooled = non-visible, non-touched).
/// Visible and touched tiles are never evicted and never counted against the
/// cap; if they alone exceed the budget nothing is evicted here (the
/// memory-pressure SSE degrade path is the follow-up for that case). Counting
/// visible tiles against the cap would drain every pooled tile the instant it
/// left the view for any city-scale tileset, so the cap bounds only the pool.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn enforce_memory_budget(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    mut ledger: ResMut<MemoryLedger>,
    frame: Res<FrameManager>,
    mut pool: ResMut<Cesium3dTilesRetentionPool>,
    mut model_index: ResMut<ModelContentIndex>,
    requesters: Query<
        &DataRequester,
        (
            With<Cesium3dTileContentDataRequesterMarker>,
            Without<Deleted>,
        ),
    >,
    rendered_tiles: Query<(Entity, &RenderedCesium3dTileContent, &TileOrderByDistance)>,
    features: Query<&FeatureId, FeatureQueryFilter>,
    mut trees: Query<&mut Cesium3dTilesTree>,
    pressure: Res<navara_memory::SsePressure>,
) {
    // Purge entries whose entity is gone or that became visible/touched
    // again (the traversal revived them).
    pool.entries.retain(|entity, _| {
        rendered_tiles
            .get(*entity)
            .map(|(_, tile, _)| !tile.is_visible && !tile.touched)
            .unwrap_or(false)
    });

    if !ledger.enabled() {
        return;
    }

    let current_frame = frame.rendered_frame();

    // Total rendered-tile count per layer (visible + touched + pooled), for the
    // `num_rendered_tiles` stat only.
    let mut live_counts: FxHashMap<Entity, u32> = FxHashMap::default();
    // Pooled (non-visible, non-touched) count per layer. The
    // `max_num_rendered_tiles` cap constrains ONLY this evictable pool, never
    // the visible/touched set: a city-scale tileset can hold far more visible
    // contents than the cap, and counting those would drain every pooled tile
    // the instant it left the view (the cache would never work). We bound the
    // retained pool instead — the pool's whole purpose is bounding it.
    let mut pooled_counts: FxHashMap<Entity, u32> = FxHashMap::default();
    for (entity, tile, _) in &rendered_tiles {
        *live_counts.entry(tile.layer_id).or_default() += 1;
        if pool.entries.contains_key(&entity) && !tile.is_visible && !tile.touched {
            *pooled_counts.entry(tile.layer_id).or_default() += 1;
        }
    }

    // Per-layer cap lookup, precomputed so the eviction loop is O(candidates)
    // instead of O(candidates × trees).
    let max_pooled_per_layer: FxHashMap<Entity, u32> = trees
        .iter()
        .map(|tree| (tree.layer_id, tree.max_num_rendered_tiles))
        .collect();

    let mut candidates: Vec<(Entity, Entity, usize, f32, u64)> = pool
        .entries
        .iter()
        .filter(|(_, entry)| {
            navara_memory::eviction::is_evictable(entry.retained_at, current_frame)
        })
        .filter_map(|(entity, entry)| {
            let (_, tile, order) = rendered_tiles.get(*entity).ok()?;
            Some((
                *entity,
                tile.layer_id,
                entry.retained_at,
                order.distance_from_camera,
                entry.cost.gpu_est,
            ))
        })
        .collect();

    // Oldest retained first; evict the farthest tiles first among equals.
    // 3D Tiles keys the pool by `retained_at` (there is no per-tile
    // `visited_at`), so it stands in for the visited-time term of the shared
    // ordering. Distance widens to f64 for the comparison.
    candidates.sort_by(|a, b| navara_memory::eviction::order((a.2, a.3 as f64), (b.2, b.3 as f64)));

    let usage_est = ledger.usage(buf.total_bytes() as u64);
    // While the load gate is closed, start evicting down to the reopen target
    // even when not over budget, or usage stranded in the hysteresis band
    // would keep the gate closed (and all new tile loads blocked) forever.
    let byte_eviction_started = ledger.needs_eviction(usage_est, pressure.load_gate_closed);
    let mut budget = navara_memory::eviction::EvictBudget::new(usage_est, ledger.evict_target());

    for (entity, layer_id, _, _, gpu_est) in candidates {
        // The cap bounds the retained pool: evict while the layer holds more
        // pooled tiles than the cap allows.
        let over_count_cap = max_pooled_per_layer
            .get(&layer_id)
            .is_some_and(|cap| pooled_counts.get(&layer_id).copied().unwrap_or(0) > *cap);
        let needs_byte_eviction = byte_eviction_started && budget.over_target();

        if !needs_byte_eviction && !over_count_cap {
            continue;
        }

        let Ok((_, tile, _)) = rendered_tiles.get(entity) else {
            continue;
        };
        let requester_handle = requesters
            .get(tile.data_requester_id)
            .ok()
            .map(|r| r.handle);

        // `destroy_rendered_tile_content` frees the tile's payload from
        // `BufferStore` synchronously (`buf.remove`). `usage_est` folds that
        // CPU total in (`ledger.usage(buf.total_bytes())`), so we must subtract
        // the *actual* freed CPU bytes in addition to `gpu_est`, or the loop
        // over-estimates remaining usage and keeps evicting far past the
        // hysteresis target — flushing the whole retention pool in one frame.
        // `external_cpu_bytes` is synced elsewhere and untouched here, so this
        // mirrors `MemoryLedger::usage()` without double counting.
        let cpu_before = buf.total_bytes() as u64;
        destroy_rendered_tile_content(
            &mut commands,
            &mut buf,
            &mut pool,
            &mut model_index,
            entity,
            tile,
            requester_handle,
            &features,
        );
        let cpu_freed = cpu_before.saturating_sub(buf.total_bytes() as u64);

        budget.credit(gpu_est, cpu_freed);
        // Credit the ledger so the other pipelines' enforce systems this frame
        // exclude this eviction (their `EvictBudget` is stack-local). The content
        // entity's despawn (which subtracts `gpu_est` from `gpu_bytes_est` via the
        // `TileCost` hook) is a deferred command; the credit is cleared next frame.
        ledger.credit_pending_eviction(gpu_est);
        if let Some(count) = live_counts.get_mut(&layer_id) {
            *count = count.saturating_sub(1);
        }
        if let Some(count) = pooled_counts.get_mut(&layer_id) {
            *count = count.saturating_sub(1);
        }
        ledger.evicted_count += 1;
    }

    // Publish live counts for stats.
    for mut tree in trees.iter_mut() {
        let count = live_counts.get(&tree.layer_id).copied().unwrap_or(0);
        if tree.num_rendered_tiles != count {
            tree.num_rendered_tiles = count;
        }
    }
}

#[cfg(test)]
mod memory_budget_tests {
    use super::*;
    use crate::b3dm::RenderedCesium3dTileContentB3dmMarker;
    use crate::b3dm::parser::B3dmParser;
    use bevy_app::{App, Update};
    use navara_frame::FramePlugin;
    use navara_memory::MIN_RETAIN_FRAMES;

    fn new_app(budget_bytes: Option<u64>) -> App {
        let mut app = App::new();
        app.add_plugins(FramePlugin);
        app.init_resource::<BufferStore>();
        app.init_resource::<Cesium3dTilesRetentionPool>();
        app.init_resource::<ModelContentIndex>();
        app.init_resource::<navara_memory::SsePressure>();
        app.insert_resource(MemoryLedger {
            budget_bytes,
            ..Default::default()
        });
        app
    }

    fn spawn_tile(app: &mut App, is_visible: bool, touched: bool, gpu_est: u64) -> Entity {
        let layer_id = app.world_mut().spawn_empty().id();
        let data_requester_id = app.world_mut().spawn_empty().id();
        app.world_mut()
            .spawn((
                RenderedCesium3dTileContent {
                    layer_id,
                    feature_id: None,
                    data_requester_id,
                    is_visible,
                    touched,
                },
                TileOrderByDistance {
                    distance_from_camera: 0.,
                    sse: 0.,
                },
                RenderedCesium3dTileContentB3dmMarker,
                TileCost { cpu: 0, gpu_est },
            ))
            .id()
    }

    #[test]
    fn cleanup_destroys_when_budget_disabled() {
        let mut app = new_app(None);
        let entity = spawn_tile(&mut app, false, false, 100);
        app.add_systems(Update, remove_invisible_rendered_tiles::<B3dmParser>);

        app.update();

        assert!(app.world().get_entity(entity).is_err());
        assert!(
            app.world()
                .resource::<Cesium3dTilesRetentionPool>()
                .entries
                .is_empty()
        );
    }

    #[test]
    fn cleanup_retains_when_budget_enabled() {
        let mut app = new_app(Some(u64::MAX));
        let entity = spawn_tile(&mut app, false, false, 100);
        app.add_systems(Update, remove_invisible_rendered_tiles::<B3dmParser>);

        app.update();

        assert!(app.world().get_entity(entity).is_ok());
        let pool = app.world().resource::<Cesium3dTilesRetentionPool>();
        assert!(pool.entries.contains_key(&entity));
        assert_eq!(pool.entries[&entity].cost.gpu_est, 100);
    }

    #[test]
    fn cleanup_leaves_visible_and_touched_tiles_alone() {
        let mut app = new_app(Some(u64::MAX));
        let visible = spawn_tile(&mut app, true, false, 100);
        let touched = spawn_tile(&mut app, false, true, 100);
        app.add_systems(Update, remove_invisible_rendered_tiles::<B3dmParser>);

        app.update();

        assert!(app.world().get_entity(visible).is_ok());
        assert!(app.world().get_entity(touched).is_ok());
        assert!(
            app.world()
                .resource::<Cesium3dTilesRetentionPool>()
                .entries
                .is_empty()
        );
    }

    #[test]
    fn enforce_evicts_over_budget_and_purges_revived() {
        let mut app = new_app(Some(50));
        let stale = spawn_tile(&mut app, false, false, 100);
        let revived = spawn_tile(&mut app, true, false, 100);
        {
            let mut pool = app.world_mut().resource_mut::<Cesium3dTilesRetentionPool>();
            for entity in [stale, revived] {
                pool.entries.insert(
                    entity,
                    RetainedEntry {
                        retained_at: 0,
                        cost: TileCost {
                            cpu: 0,
                            gpu_est: 100,
                        },
                    },
                );
            }
        }
        app.add_systems(Update, enforce_memory_budget);

        for _ in 0..MIN_RETAIN_FRAMES {
            app.update();
        }

        // The revived (visible) tile was purged from the pool and survives;
        // the stale one is evicted for the budget.
        assert!(app.world().get_entity(stale).is_err());
        assert!(app.world().get_entity(revived).is_ok());
        let pool = app.world().resource::<Cesium3dTilesRetentionPool>();
        assert!(pool.entries.is_empty());
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 1);
    }

    /// Spawns a rendered tile whose data requester owns `cpu_bytes` of payload
    /// in the `BufferStore`, and pools it. Returns the rendered entity.
    fn spawn_pooled_tile_with_buffer(app: &mut App, cpu_bytes: usize) -> Entity {
        use navara_data_requester::{DataRequester, DataRequesterExtension};

        let layer_id = app.world_mut().spawn_empty().id();
        let handle = app
            .world_mut()
            .resource_mut::<BufferStore>()
            .new_u8(vec![0u8; cpu_bytes]);
        let data_requester_id = app
            .world_mut()
            .spawn((
                Cesium3dTileContentDataRequesterMarker,
                DataRequester::new(
                    handle,
                    "https://x/t.b3dm".to_string(),
                    DataRequesterExtension::B3dm,
                ),
            ))
            .id();
        let entity = app
            .world_mut()
            .spawn((
                RenderedCesium3dTileContent {
                    layer_id,
                    feature_id: None,
                    data_requester_id,
                    is_visible: false,
                    touched: false,
                },
                TileOrderByDistance {
                    distance_from_camera: 0.,
                    sse: 0.,
                },
                RenderedCesium3dTileContentB3dmMarker,
                TileCost { cpu: 0, gpu_est: 0 },
            ))
            .id();
        app.world_mut()
            .resource_mut::<Cesium3dTilesRetentionPool>()
            .entries
            .insert(
                entity,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost::default(),
                },
            );
        entity
    }

    #[test]
    fn enforce_stops_at_target_using_real_freed_cpu_bytes() {
        // FIX 2: each destroy frees CPU bytes from BufferStore synchronously.
        // The eviction loop must subtract the *actual* freed bytes (not just
        // gpu_est, which is 0 here) so it stops once usage drops to the
        // hysteresis target — instead of over-evicting the whole pool.
        //
        // 3 pooled tiles × 100 CPU bytes = 300 usage; budget 250 → target 212.
        // Freeing one tile drops usage to 200 ≤ 212, so exactly one is evicted.
        let mut app = new_app(Some(250));
        let a = spawn_pooled_tile_with_buffer(&mut app, 100);
        let b = spawn_pooled_tile_with_buffer(&mut app, 100);
        let c = spawn_pooled_tile_with_buffer(&mut app, 100);

        app.add_systems(Update, enforce_memory_budget);
        for _ in 0..MIN_RETAIN_FRAMES {
            app.update();
        }

        let survivors = [a, b, c]
            .iter()
            .filter(|e| app.world().get_entity(**e).is_ok())
            .count();
        assert_eq!(
            survivors, 2,
            "only one tile should be evicted once real freed CPU bytes reach the target"
        );
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 1);
        // 200 bytes of payload remain resident in the store.
        assert_eq!(app.world().resource::<BufferStore>().total_bytes(), 200);
    }

    /// Spawns a `Cesium3dTilesTree` capping rendered tiles at `cap` for `layer_id`.
    fn spawn_tree(app: &mut App, layer_id: Entity, cap: u32) {
        let tree = Cesium3dTilesTree {
            layer_id,
            base_url: std::sync::Arc::new(url::Url::parse("https://example.com/t.json").unwrap()),
            root: crate::cesium3dtiles::Cesium3dTileContent {
                uri: None,
                data_requester_id: None,
                rendered_tile_id: None,
                children: None,
                refine: navara_parser::cesium3dtiles::tileset::Refine::Replace,
                kind: None,
                bounding_volume: None,
                transform: None,
                state: Default::default(),
            },
            max_sse: 2.,
            max_num_rendered_tiles: cap,
            num_rendered_tiles: 0,
            is_v1_1: false,
            schema: None,
        };
        app.world_mut().spawn(tree);
    }

    fn pool_insert(app: &mut App, entity: Entity) {
        app.world_mut()
            .resource_mut::<Cesium3dTilesRetentionPool>()
            .entries
            .insert(
                entity,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost::default(),
                },
            );
    }

    #[test]
    fn enforce_applies_rendered_tile_count_cap() {
        // Budget is huge (no byte pressure), but the tree caps rendered tiles
        // at 1 while 2 are POOLED — the cap bounds the pool, so exactly one
        // pooled tile is evicted (down to the cap). A visible tile in the same
        // layer never counts against the cap.
        let mut app = new_app(Some(u64::MAX));
        let visible = spawn_tile(&mut app, true, false, 0);
        let pooled_a = spawn_tile(&mut app, false, false, 0);
        let pooled_b = spawn_tile(&mut app, false, false, 0);

        let layer_id = app
            .world()
            .get::<RenderedCesium3dTileContent>(visible)
            .unwrap()
            .layer_id;
        // Point every tile at the same layer.
        for e in [pooled_a, pooled_b] {
            app.world_mut()
                .get_mut::<RenderedCesium3dTileContent>(e)
                .unwrap()
                .layer_id = layer_id;
        }

        spawn_tree(&mut app, layer_id, 1);
        pool_insert(&mut app, pooled_a);
        pool_insert(&mut app, pooled_b);
        app.add_systems(Update, enforce_memory_budget);

        for _ in 0..MIN_RETAIN_FRAMES {
            app.update();
        }

        // One of the two pooled tiles is evicted down to the cap of 1; the
        // visible tile always survives.
        let pooled_survivors = [pooled_a, pooled_b]
            .iter()
            .filter(|e| app.world().get_entity(**e).is_ok())
            .count();
        assert_eq!(pooled_survivors, 1);
        assert!(app.world().get_entity(visible).is_ok());
    }

    #[test]
    fn count_cap_does_not_drain_pool_when_visible_exceeds_cap() {
        // FIX 3: a city-scale tileset routinely renders far more VISIBLE tiles
        // than `max_num_rendered_tiles`. That must NOT force the pool empty:
        // the cap bounds the pool only. Here 3 visible + 1 pooled with cap 1
        // and generous budget headroom → nothing is evicted (pooled count 1 is
        // not over the cap of 1, and there is no byte pressure).
        let mut app = new_app(Some(u64::MAX));
        let visible_a = spawn_tile(&mut app, true, false, 0);
        let visible_b = spawn_tile(&mut app, true, false, 0);
        let visible_c = spawn_tile(&mut app, true, false, 0);
        let pooled = spawn_tile(&mut app, false, false, 0);

        let layer_id = app
            .world()
            .get::<RenderedCesium3dTileContent>(pooled)
            .unwrap()
            .layer_id;
        for e in [visible_a, visible_b, visible_c] {
            app.world_mut()
                .get_mut::<RenderedCesium3dTileContent>(e)
                .unwrap()
                .layer_id = layer_id;
        }

        spawn_tree(&mut app, layer_id, 1);
        pool_insert(&mut app, pooled);
        app.add_systems(Update, enforce_memory_budget);

        for _ in 0..MIN_RETAIN_FRAMES {
            app.update();
        }

        // Pooled tile survives despite 3 visible tiles exceeding the cap of 1.
        assert!(app.world().get_entity(pooled).is_ok());
        assert!(
            app.world()
                .resource::<Cesium3dTilesRetentionPool>()
                .entries
                .contains_key(&pooled)
        );
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 0);
    }
}
