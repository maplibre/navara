use bevy_ecs::prelude::*;

use navara_camera::{CameraFrustum, CameraMarker};
use navara_component::{Deleted, Ignored, Order, OrderByDistance, Priority, Requested};
use navara_core::{TileXYZ, TilingScheme, WGS84_64};
use navara_fog::{DynamicSse, Fog};
use navara_frame::FrameManager;
use navara_math::Transform;
use navara_memory::{MemoryLedger, RetainedEntry, SseDegrade, SsePressure, TileCost};
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;
use navara_texture_fragment::TextureFragment;
use navara_tile_component::{
    ChangedTileTextureFragmentQuery, RasterTile, RasterTileQuadtree, TerrainTileQuadtree,
    TileHandle, TileTextureFragmentMarker, TileTextureFragmentQuery,
};
use navara_window::Window;

use navara_layer::{TerrainLayer, TilesLayer};

use super::tile_cache_manager::RasterTileCacheManager;
use super::traverse::traverse_raster;

/// Rate-limit raster texture fragment requests. Regular textures belong to the
/// raster quadtree, so the rejected slot is cleared against `RasterTileQuadtree`
/// (using the fragment's `TileTextureFragmentMarker`, whose handle indexes the
/// raster quadtree for these entities).
///
/// No dispatch-time `ReservedCost` is attached here (unlike terrain / vector /
/// 3D Tiles): a raster fragment's actual `TileCost` (`raster_tile_bytes`) is
/// pre-charged to the ledger EAGERLY at spawn by `attach_texture_fragment_cost`
/// (on `Added<TextureFragment>`), so its in-flight cost is already visible to
/// the load gate before the fetch resolves. Adding a reservation on the same
/// entity would systematically double-count that fragment against its own
/// `TileCost` for the fragment's whole life.
#[allow(clippy::type_complexity)]
pub fn filter_requestable_raster_texture_fragment(
    mut commands: Commands,
    mut qt: ResMut<RasterTileQuadtree>,
    fragments: Query<
        (
            Entity,
            &TileTextureFragmentMarker,
            &OrderByDistance,
            &Priority,
        ),
        (
            With<TextureFragment>,
            Added<TileTextureFragmentMarker>,
            Without<Deleted>,
        ),
    >,
    requested_fragments: Query<Entity, (With<TextureFragment>, With<Requested>, Without<Deleted>)>,
    limits: Res<navara_data_requester::RequestLimits>,
    pressure: Res<SsePressure>,
) {
    let pendings = requested_fragments.iter().count();
    // Load gate: when the memory budget is exhausted, start ZERO new fetches
    // and settle on the already-loaded tiles instead of evicting → refetching
    // in an endless loop. In-flight requests proceed; forcing `num_skip == 0`
    // rejects every newly-Added fragment this frame so none is dispatched.
    let num_skip = if pressure.load_gate_closed {
        0
    } else {
        (limits.max_pendings as i32 - pendings as i32).max(0)
    };

    for (e, marker, _, _) in fragments
        .iter()
        .sort::<(&Priority, &OrderByDistance)>()
        .skip(num_skip as usize)
    {
        let handle = marker.0;
        if let Some(tile) = qt.qt.get_mut(handle) {
            commands.entity(e).insert((Deleted, Ignored));

            // Clear the rejected slot to None so the next request pass can
            // re-spawn an entity for the same layer index.
            if let Some(tex_ids) = tile.texture_fragment_entity_ids.as_mut()
                && let Some(slot) = tex_ids
                    .iter_mut()
                    .find(|id| matches!(id, Some(id) if *id == e))
            {
                *slot = None;
            }
        }
    }
}

/// Initialize the WebMercator root of the raster quadtree once raster (texture)
/// layers exist. Raster tiles are always WebMercator (single root).
pub fn init_raster_tiling(tiles: Query<(&TilesLayer, &Order)>, mut qt: ResMut<RasterTileQuadtree>) {
    let has_raster_layers = tiles.iter().any(|(t, _)| t.hillshade_config.is_none());
    if !has_raster_layers {
        return;
    }

    for root in (TilingScheme::WebMercator { tms: false }).root_tiles() {
        let coords = (root.x, root.y, root.z);
        if qt.qt.leaf(coords).is_none() {
            qt.qt.initialize_leaf(coords, &|(x, y, z)| {
                RasterTile::new(TileXYZ { x, y, z }, 0., 0.)
            });
        }
    }
}

/// Groups the raster resolve revision with its layer-change trigger query (bevy
/// caps systems at 16 parameters; `update_raster_tiles` is at the limit).
#[derive(bevy_ecs::system::SystemParam)]
pub struct RasterRevisionParams<'w, 's> {
    revision: ResMut<'w, super::RasterResolveRevision>,
    changed_layers: Query<'w, 's, (), Changed<TilesLayer>>,
}

/// The bake-relevant slice of a layer's config: whether it bakes at all
/// (hillshade excluded), how it pairs with the baked-slot ordinals and what the
/// resolve reads (the source's max zoom). A `Changed<TilesLayer>` event that
/// leaves these untouched — an appearance-only mutation — must not bump the
/// resolve revision.
fn bake_config_entry(layer: &TilesLayer) -> (bool, bool, Option<&str>) {
    (
        layer.hillshade_config.is_some(),
        layer.elevation_heatmap_config.is_some(),
        layer.source_id.as_deref(),
    )
}

/// Drives raster tile traversal: select the LOD tiles by screen-space error and
/// request their textures. The resolved textures are later pulled into terrain
/// tiles by extent (see `update_mesh_material`).
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn update_raster_tiles(
    mut commands: Commands,
    mut qt: ResMut<RasterTileQuadtree>,
    mut tc: ResMut<RasterTileCacheManager>,
    terrain_qt: Res<TerrainTileQuadtree>,
    frame: Res<FrameManager>,
    window: Res<Window>,
    globe: Res<navara_globe::Globe>,
    source_store: Res<navara_source::SourceStore>,
    tiles: Query<(&TilesLayer, &Order)>,
    terrain_layer: Query<&TerrainLayer>,
    texture_fragment: TileTextureFragmentQuery,
    changed_texture_fragment: ChangedTileTextureFragmentQuery,
    mut camera_set: ParamSet<(
        Query<(Ref<Transform>, Ref<CameraFrustum>), With<CameraMarker>>,
        Query<(Ref<Fog>, Ref<DynamicSse>)>,
    )>,
    occluder: Query<Ref<EllipsoidalOccluder>>,
    pressure: Res<SsePressure>,
    mut revision_params: RasterRevisionParams,
) {
    let tiles_len = tiles.iter().len();
    let has_raster_layers = tiles.iter().any(|(t, _)| t.hillshade_config.is_none());
    if !has_raster_layers {
        tc.prev_layers_len = tiles_len;
        // The fingerprint must not outlive the last raster layer: a later
        // re-add with an identical bake config would match the stale entry,
        // never re-trigger the traversal or bump the revision, and render
        // nothing until the camera happens to move. Bump so draped tiles also
        // drop the removed layer's slots.
        if !tc.bake_config_fingerprint.is_empty() {
            tc.bake_config_fingerprint.clear();
            tc.pending_layers_changed = false;
            revision_params.revision.bump();
        }
        return;
    }

    let is_texture_fragment_changed = !changed_texture_fragment.is_empty();
    let is_layers_len_changed = tiles_len != tc.prev_layers_len;
    // In-place layer mutations too (`updateLayer` toggling hillshade/heatmap config):
    // they change which layers bake and therefore the baked-slot ordinal pairing.
    // `Changed` includes `Added`, so this also covers new layers. `Changed` also
    // fires on appearance-only mutations (opacity/show/color), which cannot affect
    // the resolve — the fingerprint comparison filters those out, or a per-frame
    // opacity animation would re-resolve every visible tile's drape every frame
    // (the FPS killer the revision gate exists to avoid).
    let is_layers_changed = (is_layers_len_changed
        || tc.pending_layers_changed
        || !revision_params.changed_layers.is_empty())
        && (tiles_len != tc.bake_config_fingerprint.len()
            || !tiles
                .iter()
                .sort::<&Order>()
                .zip(tc.bake_config_fingerprint.iter())
                .all(|((l, _), (hillshade, heatmap, source_id))| {
                    bake_config_entry(l) == (*hillshade, *heatmap, source_id.as_deref())
                }));
    // `Changed` fires only once, but the returns below (no occluder/camera yet)
    // can cut this run short before the change is committed — carry it so the
    // fingerprint mismatch is re-examined until the commit block runs.
    tc.pending_layers_changed = is_layers_changed;

    let occluder = match occluder.iter().next() {
        Some(o) => o,
        None => return,
    };

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
    let (camera, frustum) = match camera.single() {
        Ok(c) => c,
        Err(_) => return,
    };

    let needs_update = is_texture_fragment_changed
        // Terrain heights feed the raster SSE, so a terrain change must
        // re-traverse even when the camera is static (matches the vector pipeline).
        || terrain_qt.is_changed()
        || camera.is_added()
        || camera.is_changed()
        || frustum.is_changed()
        || occluder.is_changed()
        || is_layers_changed
        || is_fog_changed
        || pressure.is_changed();
    if !needs_update {
        return;
    }

    tc.last_rendered_frame = frame.rendered_frame();
    tc.prev_layers_len = tiles_len;
    tc.is_updated_in_this_frame = true;
    tc.pending_layers_changed = false;
    if is_layers_changed {
        tc.bake_config_fingerprint = tiles
            .iter()
            .sort::<&Order>()
            .map(|(l, _)| {
                let (hillshade, heatmap, source_id) = bake_config_entry(l);
                (hillshade, heatmap, source_id.map(str::to_owned))
            })
            .collect();
    }
    // Only fragment LOAD COMPLETIONS and layer changes can alter an existing terrain
    // tile's baked-drape resolution — the resolve walks loaded fragments only, so a
    // request being spawned (`Added`, which fires every frame while the camera pans
    // into unloaded area) or failing changes nothing. Camera movement alone must not
    // bump either: forcing every visible tile to re-resolve per frame was an FPS
    // killer. Layer changes include in-place mutations (hillshade/heatmap toggles),
    // which re-pair the baked-slot ordinals. Tile destruction bumps separately (see
    // `destroy_raster_tile` callers); brand-new terrain tiles fetch on their first
    // frame regardless.
    let any_fragment_loaded = changed_texture_fragment
        .iter()
        .any(|(_, f)| f.is_succeeded());
    if any_fragment_loaded || is_layers_changed {
        revision_params.revision.bump();
    }

    // Memory-pressure LOD degrade, shared shape with the terrain traversal so
    // raster texture depth stays aligned with terrain subdivision.
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
    let dynamic_sse = dynamic_sse
        .term(camera_pos, camera.forward(), camera_height)
        .for_max_sse(globe.max_sse as f64);

    let terrain_present = terrain_layer.iter().next().is_some();

    // Sort the layer list once per run; the traversal touches every visited tile.
    let sorted_layers: Vec<_> = tiles.iter().sort::<&Order>().collect();

    let root_coords = (TilingScheme::WebMercator { tms: false }).root_tiles();
    for root in &root_coords {
        let coords = (root.x, root.y, root.z);
        let Some(root_handle) = qt.qt.leaf(coords).map(|n| n.handle()) else {
            continue;
        };

        traverse_raster(
            &mut commands,
            &sorted_layers,
            &source_store,
            root_handle,
            &mut qt,
            &mut tc,
            &terrain_qt,
            &frame,
            &camera,
            &frustum,
            &window,
            &WGS84_64,
            &occluder,
            &texture_fragment,
            &fog,
            dynamic_sse,
            globe.max_sse as f64,
            degrade,
            terrain_present,
        );
    }
}

/// Snapshot the baked-drape resolve inputs (sorted baked layer list + loaded
/// fragment set) into [`RasterBakeSnapshot`](super::RasterBakeSnapshot) whenever the
/// raster resolve revision changed. `get_raster_tiles` (per visible terrain tile) then
/// only reads resources and walks the quadtree — re-scanning every fragment and
/// re-sorting the layers per tile per frame was an FPS killer during camera motion.
/// Runs at the end of the raster chain so same-frame bumps (traverse, prune,
/// eviction) are all captured.
#[allow(clippy::type_complexity)]
pub fn snapshot_raster_bake_inputs(
    revision: Res<super::RasterResolveRevision>,
    globe: Res<navara_globe::Globe>,
    source_store: Res<navara_source::SourceStore>,
    tiles: Query<(&TilesLayer, &Order)>,
    fragments: Query<
        (Entity, &TextureFragment),
        (With<TileTextureFragmentMarker>, Without<Deleted>),
    >,
    mut snapshot: ResMut<super::RasterBakeSnapshot>,
) {
    if !revision.is_changed() {
        return;
    }

    snapshot.layers.clear();
    snapshot.loaded.clear();

    // Only Geographic terrain bakes; keep the snapshot empty otherwise so
    // `get_raster_tiles` resolves nothing without scanning.
    if !globe.tiling_scheme.is_geographic() {
        return;
    }

    // The sort and the non-hillshade filter MUST match `update_mesh_material`,
    // which emits the k-th baked composite slot from the same list — the web
    // pairs slots and states by that ordinal.
    for (layer_index, (l, _)) in tiles.iter().sort::<&Order>().enumerate() {
        if l.hillshade_config.is_some() {
            continue;
        }
        snapshot.layers.push(super::RasterBakeLayer {
            layer_index,
            // Max zoom lives on the referenced source; the fallback mirrors
            // `update_mesh_material`.
            max_zoom: l
                .source_id
                .as_deref()
                .and_then(|id| source_store.get(id))
                .map(|s| s.max_zoom())
                .unwrap_or(20),
        });
    }

    for (entity, fragment) in fragments.iter() {
        if fragment.is_succeeded() {
            snapshot.loaded.insert(entity);
        }
    }
}

/// Attaches a [`TileCost`] to newly spawned texture fragments so the memory
/// ledger tracks the JS-side texture they will hold. Fragment dimensions are
/// only known on the JS side, so the per-fragment hint is used.
pub fn attach_texture_fragment_cost(
    mut commands: Commands,
    ledger: Res<MemoryLedger>,
    fragments: Query<Entity, Added<TextureFragment>>,
) {
    for entity in &fragments {
        commands.entity(entity).insert(TileCost {
            cpu: 0,
            gpu_est: ledger.cost_hints.raster_tile_bytes,
        });
    }
}

/// Destroys a raster tile: removes its quadtree node and marks its texture
/// fragments `Deleted` (which drives the JS-side texture disposal). This is
/// the single destroy path shared by `clear_raster_caches` (budget disabled)
/// and `enforce_memory_budget` (eviction).
fn destroy_raster_tile(
    commands: &mut Commands,
    qt: &mut RasterTileQuadtree,
    tc: &mut RasterTileCacheManager,
    handle: TileHandle,
) {
    tc.active_handles.remove(&handle);
    tc.retained.remove(&handle);
    if let Some(mut tile) = qt.qt.remove(handle) {
        tile.destroy(commands);
    }
}

/// Prune raster tiles not visited in the latest traversal. Mirrors the terrain
/// `clear_caches` lifetime rule (kept for one extra frame to avoid thrashing).
///
/// When a memory budget is set, stale tiles move to the retention pool
/// instead: the quadtree node and texture fragments stay alive, so a revisit
/// needs no refetch and the JS-side texture disposal is deferred with them.
pub fn clear_raster_caches(
    mut commands: Commands,
    ledger: Res<MemoryLedger>,
    mut qt: ResMut<RasterTileQuadtree>,
    mut tc: ResMut<RasterTileCacheManager>,
    mut revision: ResMut<super::RasterResolveRevision>,
) {
    let mut destroyed_any = false;
    // If the budget was disabled at runtime (`setCacheBytes(undefined)`),
    // retained tiles would otherwise leak forever: the loop below only scans
    // `active_handles`, and `enforce_memory_budget` returns early with no
    // budget. Destroy the whole retention pool so the original
    // destroy-on-unvisited behavior is restored. Runs regardless of
    // `is_updated_in_this_frame` so the drain is not deferred to the next
    // traversal.
    if !ledger.enabled() && !tc.retained.is_empty() {
        let retained: Vec<TileHandle> = tc.retained.keys().copied().collect();
        for handle in retained {
            destroy_raster_tile(&mut commands, &mut qt, &mut tc, handle);
            destroyed_any = true;
        }
    }

    if !tc.is_updated_in_this_frame {
        // A destroyed tile may have backed a terrain tile's baked drape.
        if destroyed_any {
            revision.bump();
        }
        return;
    }
    tc.is_updated_in_this_frame = false;

    let last_frame = tc.last_rendered_frame;
    let mut stale = vec![];
    for handle in tc.active_handles.iter() {
        let visited_at = match qt.qt.get(*handle) {
            Some(t) => t.visited_at,
            None => {
                stale.push(*handle);
                continue;
            }
        };
        if last_frame > visited_at + 1 {
            stale.push(*handle);
        }
    }

    for handle in stale {
        if ledger.enabled() && qt.qt.get(handle).is_some() {
            tc.active_handles.remove(&handle);
            let fragments = qt
                .qt
                .get(handle)
                .and_then(|t| t.texture_fragment_entity_ids.as_ref())
                .map(|ids| ids.iter().flatten().count() as u64)
                .unwrap_or(0);
            tc.retained.insert(
                handle,
                RetainedEntry {
                    retained_at: last_frame,
                    cost: TileCost {
                        cpu: 0,
                        gpu_est: fragments * ledger.cost_hints.raster_tile_bytes,
                    },
                },
            );
            continue;
        }

        destroy_raster_tile(&mut commands, &mut qt, &mut tc, handle);
        destroyed_any = true;
    }

    // A destroyed tile may have backed a terrain tile's baked drape; retention-pool
    // moves keep the quadtree node + fragments alive, so they need no bump.
    if destroyed_any {
        revision.bump();
    }
}

/// Evicts retained raster tiles, oldest-visited first, until usage drops to
/// the hysteresis target. Runs right after `clear_raster_caches`.
#[allow(clippy::too_many_arguments)]
pub fn enforce_memory_budget(
    mut commands: Commands,
    mut ledger: ResMut<MemoryLedger>,
    pressure: Res<navara_memory::SsePressure>,
    buf: Res<navara_buffer_store::BufferStore>,
    frame: Res<FrameManager>,
    mut qt: ResMut<RasterTileQuadtree>,
    mut tc: ResMut<RasterTileCacheManager>,
    mut revision: ResMut<super::RasterResolveRevision>,
) {
    // Purge entries that were revisited (traversal moved them back to
    // `active_handles`) or whose tile no longer exists.
    let active_handles = std::mem::take(&mut tc.active_handles);
    tc.retained
        .retain(|handle, _| !active_handles.contains(handle) && qt.qt.get(*handle).is_some());
    tc.active_handles = active_handles;

    if ledger.budget_bytes.is_none() {
        return;
    }

    // While the load gate is closed, evict down to the reopen target even when
    // not over budget, or usage stranded in the hysteresis band would keep the
    // gate closed (and all new tile loads blocked) forever.
    let usage_est = ledger.usage(buf.total_bytes() as u64);
    if !ledger.needs_eviction(usage_est, pressure.load_gate_closed) {
        return;
    }

    let current_frame = frame.rendered_frame();
    let mut candidates: Vec<(TileHandle, usize, u64)> = tc
        .retained
        .iter()
        .filter(|(_, entry)| {
            navara_memory::eviction::is_evictable(entry.retained_at, current_frame)
        })
        .filter_map(|(handle, entry)| {
            let tile = qt.qt.get(*handle)?;
            Some((*handle, tile.visited_at, entry.cost.gpu_est))
        })
        .collect();

    // Oldest visit first (shared `order`). Raster tiles carry no per-entity
    // distance, so the distance tiebreak is fed 0.0 and the sort reduces to
    // `visited_at` asc — the same head-of-queue policy as the other layers.
    candidates.sort_by(|a, b| navara_memory::eviction::order((a.1, 0.0), (b.1, 0.0)));

    let mut budget = navara_memory::eviction::EvictBudget::new(usage_est, ledger.evict_target());
    let mut destroyed_any = false;
    for (handle, _, gpu_est) in candidates {
        if !budget.over_target() {
            break;
        }

        // `destroy_raster_tile` frees no store bytes synchronously (raster
        // texture payloads are handed to Three.js and dropped a frame after
        // upload), so only the GPU estimate is credited here; the exact
        // `BufferStore` total re-reads next frame.
        destroy_raster_tile(&mut commands, &mut qt, &mut tc, handle);
        destroyed_any = true;
        budget.credit(gpu_est, 0);
        // Credit the ledger so the other pipelines' enforce systems this frame
        // exclude this eviction (their `EvictBudget` is stack-local); the
        // fragment despawn subtracting `gpu_est` from `gpu_bytes_est` is deferred.
        ledger.credit_pending_eviction(gpu_est);
        ledger.evicted_count += 1;
    }

    // An evicted tile may have backed a terrain tile's baked drape.
    if destroyed_any {
        revision.bump();
    }
}

#[cfg(test)]
mod memory_budget_tests {
    use super::*;
    use bevy_app::App;
    use bevy_app::Update;
    use navara_buffer_store::BufferStore;
    use navara_frame::FramePlugin;

    fn setup_app(budget_bytes: Option<u64>) -> (App, TileHandle) {
        let mut app = App::new();
        app.add_plugins(FramePlugin);
        app.init_resource::<BufferStore>();
        app.init_resource::<crate::raster::RasterResolveRevision>();
        app.init_resource::<navara_memory::SsePressure>();
        app.insert_resource(MemoryLedger {
            budget_bytes,
            ..Default::default()
        });

        let fragment = app.world_mut().spawn_empty().id();

        let mut qt = RasterTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        qt.qt.get_mut(handle).unwrap().texture_fragment_entity_ids = Some(vec![Some(fragment)]);
        app.insert_resource(qt);

        let mut tc = RasterTileCacheManager::default();
        tc.active_handles.insert(handle);
        // Past the +1 grace: visited_at == 0, last frame == 2.
        tc.last_rendered_frame = 2;
        tc.is_updated_in_this_frame = true;
        app.insert_resource(tc);

        (app, handle)
    }

    #[test]
    fn clear_raster_caches_destroys_when_budget_disabled() {
        let (mut app, handle) = setup_app(None);
        app.add_systems(Update, clear_raster_caches);

        app.update();

        let tc = app.world().resource::<RasterTileCacheManager>();
        assert!(tc.active_handles.is_empty());
        assert!(tc.retained.is_empty());
        let qt = app.world().resource::<RasterTileQuadtree>();
        assert!(qt.qt.get(handle).is_none());
    }

    #[test]
    fn clear_raster_caches_retains_when_budget_enabled() {
        let (mut app, handle) = setup_app(Some(u64::MAX));
        app.add_systems(Update, clear_raster_caches);

        app.update();

        let tc = app.world().resource::<RasterTileCacheManager>();
        assert!(!tc.active_handles.contains(&handle));
        let entry = tc.retained.get(&handle).expect("tile should be retained");
        // One fragment worth of texture bytes.
        assert_eq!(
            entry.cost.gpu_est,
            app.world()
                .resource::<MemoryLedger>()
                .cost_hints
                .raster_tile_bytes
        );
        let qt = app.world().resource::<RasterTileQuadtree>();
        assert!(qt.qt.get(handle).is_some());
    }

    #[test]
    fn enforce_memory_budget_evicts_and_purges() {
        let (mut app, handle) = setup_app(Some(10));
        {
            // Force usage over budget via the ledger's GPU estimate.
            let mut ledger = app.world_mut().resource_mut::<MemoryLedger>();
            ledger.gpu_bytes_est = 100;
            let mut tc = app.world_mut().resource_mut::<RasterTileCacheManager>();
            tc.active_handles.remove(&handle);
            tc.retained.insert(
                handle,
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

        for _ in 0..navara_memory::MIN_RETAIN_FRAMES {
            app.update();
        }

        let tc = app.world().resource::<RasterTileCacheManager>();
        assert!(tc.retained.is_empty());
        let qt = app.world().resource::<RasterTileQuadtree>();
        assert!(qt.qt.get(handle).is_none());
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 1);
    }

    #[test]
    fn enforce_memory_budget_purges_revisited_entries() {
        let (mut app, handle) = setup_app(Some(0));
        {
            // The handle is back in `active_handles` (revisited) but a stale
            // retained entry remains.
            let mut tc = app.world_mut().resource_mut::<RasterTileCacheManager>();
            tc.retained.insert(
                handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost::default(),
                },
            );
        }
        app.add_systems(Update, enforce_memory_budget);

        for _ in 0..navara_memory::MIN_RETAIN_FRAMES {
            app.update();
        }

        let tc = app.world().resource::<RasterTileCacheManager>();
        assert!(tc.retained.is_empty(), "revisited entry should be purged");
        let qt = app.world().resource::<RasterTileQuadtree>();
        assert!(qt.qt.get(handle).is_some(), "revisited tile must survive");
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 0);
    }
}

#[cfg(test)]
mod load_gate_tests {
    use super::*;
    use bevy_app::{App, Update};
    use navara_data_requester::RequestLimits;

    fn setup(gate_closed: bool) -> (App, Entity) {
        let mut app = App::new();
        app.init_resource::<RequestLimits>();
        app.insert_resource(SsePressure {
            multiplier: 1.0,
            load_gate_closed: gate_closed,
            ..Default::default()
        });

        let mut qt = RasterTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();

        let e = app
            .world_mut()
            .spawn((
                TextureFragment::default(),
                TileTextureFragmentMarker(handle),
                OrderByDistance {
                    sse: 0.0,
                    distance: 0.0,
                },
                Priority::High,
            ))
            .id();
        qt.qt.get_mut(handle).unwrap().texture_fragment_entity_ids = Some(vec![Some(e)]);
        app.insert_resource(qt);

        app.add_systems(Update, filter_requestable_raster_texture_fragment);
        (app, e)
    }

    #[test]
    fn closed_gate_rejects_new_fragment() {
        let (mut app, e) = setup(true);
        // `Added` sees the previous frame; two ticks so the filter observes it.
        app.update();
        app.update();
        assert!(app.world().get::<Deleted>(e).is_some());
    }

    #[test]
    fn open_gate_admits_new_fragment() {
        let (mut app, e) = setup(false);
        app.update();
        app.update();
        assert!(app.world().get::<Deleted>(e).is_none());
    }
}
