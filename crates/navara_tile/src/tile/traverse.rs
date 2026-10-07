use std::sync::Arc;

use bevy_ecs::prelude::*;
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, Order, OrderByDistance, Priority};
use navara_core::Ellipsoid;
use navara_data_requester::DataManager;

use navara_fog::{DynamicSseTerm, Fog};
use navara_frame::FrameManager;
use navara_math::{FloatType, Transform};
use navara_memory::SseDegrade;

use navara_mesh::Mesh;
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;

use navara_camera::CameraFrustum;
use navara_tile_component::{
    ChildrenTakeOver, QuantizedMeshData, RasterDEMData, TerrainTile, TerrainTileQuadtree, Tile,
    TileHandle, TileMeshMarker, TileTerrainDataRequesterQuery, UpsampleAncestors,
};
use navara_window::Window;

use crate::data_requester::request_terrain_data;
use crate::texture_fragment::request_hillshade_data_requester;

use super::{
    render::{RemeshPending, RenderedTile},
    tile_cache_manager::{LayerParent, RenderedTileCache, TileCacheManager},
};

use navara_layer::{TerrainDataType, TerrainLayer, TilesLayer};
use navara_source::SourceStore;

/// Maximum number of consecutive not-yet-renderable levels the traversal may
/// descend past before it must wait for one of them to become renderable.
/// Without this bound the traversal descends straight to the SSE-satisfying
/// level; once those deep tiles swap in, their ancestors stop being requested,
/// so on a slow source the levels in between never finish loading. A later
/// tilt/zoom-out that reveals frustum-culled tiles then falls back to an
/// ancestor many levels up, flashing a huge low-res parent. Bounding the
/// descent keeps a renderable ancestor within this many levels of every
/// traversed tile.
const MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR: u8 = 3;

// This process works in the following steps.
// 1. Check if the AABB of the tile is within the camera's frustum.(Frustum culling)
// 2. Check horizon culling because the frustum culling isn't enough.
// 3. Check SSE is within max SSE.
// 4. If SSE works and the tile is ready, the tile should be rendered.
// 5. On the other hand, if SSE works but the tile isn't loaded, the tile should be requested, not rendered.
// 6. If above steps aren't matched, traverse children.
// 7. If children couldn't be rendered completely, use this tile instead.
#[allow(clippy::too_many_arguments)]
pub fn traverse_terrain(
    command: &mut Commands,
    // The layer list sorted by `Order`, collected once per system run — this
    // function runs per traversed tile, so it must not sort per call.
    sorted_layers: &[(&TilesLayer, &Order)],
    terrain_layer: &Option<&TerrainLayer>,
    source_store: &SourceStore,
    handle: TileHandle,
    tc: &mut TileCacheManager,
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    data_manager: &mut DataManager,
    frame: &FrameManager,
    camera: &Transform,
    frustum: &CameraFrustum,
    data_requesters: &Query<&navara_data_requester::DataRequester>,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
    window: &Window,
    ellipsoid: &Ellipsoid<FloatType>,
    occluder: &EllipsoidalOccluder,
    meshes: &mut Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    fog: &Fog,
    dynamic_sse: DynamicSseTerm,
    max_sse: f64,
    degrade: SseDegrade,
    is_ancestor_rendered: bool,
    // This is used to keep rendering current children when parent tile isn't ready after you zoomed out.
    meets_sse_ancestors: bool,
    // This is used to show parent's texture if child's texture isn't ready.
    ready_parent_tile_handle: Option<TileHandle>,
    // This tracks the nearest ready hillshade parent for each layer.
    // Shared (Arc) because every child of every visited tile receives a copy.
    ready_layer_parents: Option<Arc<Vec<Option<LayerParent>>>>,
    // The nearest ancestors this tile can be upsampled from, extended by one
    // level per recursion instead of walking the quadtree per tile.
    upsample_ancestors: UpsampleAncestors,
    // How many consecutive ancestor levels above this tile are not renderable
    // (0 when the parent is renderable). See
    // `MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR`.
    levels_without_renderable_ancestor: u8,
    // Beyond-the-horizon prefetching is paused while the memory load gate is
    // closed: its requests would be rejected anyway (churning requester
    // entities every frame) and its meshes are the first spend to cut.
    allow_occlusion_prefetch: bool,
) -> TraversalResult {
    let has_regular_tiles = sorted_layers
        .iter()
        .any(|(t, _)| t.hillshade_config.is_none());

    match qt.qt.get(handle) {
        Some(tile) => {
            let tile_overmax = has_regular_tiles
                && sorted_layers
                    .iter()
                    .filter(|(t, _)| t.hillshade_config.is_none())
                    .filter_map(|(t, _)| t.source_id.as_deref().and_then(|id| source_store.get(id)))
                    .all(|s| s.is_over_max_zoom(tile.coords.z));

            // Hillshade layers: allow overscaling - stop at overscaled_max_zoom
            let has_hillshade_tiles = sorted_layers
                .iter()
                .any(|(t, _)| t.hillshade_config.is_some());
            let hillshade_overmax = has_hillshade_tiles
                && sorted_layers
                    .iter()
                    .filter(|(t, _)| t.hillshade_config.is_some())
                    .filter_map(|(t, _)| t.source_id.as_deref().and_then(|id| source_store.get(id)))
                    .all(|s| s.is_over_overscaled_max_zoom(tile.coords.z));

            // Terrain: allow upsampling - stop at overscaled_max_zoom
            let terrain_overmax = terrain_layer
                .and_then(|l| l.source_id.as_deref())
                .and_then(|id| source_store.get(id))
                .is_some_and(|s| s.is_over_overscaled_max_zoom(tile.coords.z));

            // Only stop if ALL active sources are beyond their limits
            if (!has_regular_tiles || tile_overmax)
                && (!has_hillshade_tiles || hillshade_overmax)
                && (terrain_layer.is_none() || terrain_overmax)
            {
                return TraversalResult::NotFound;
            }
        }
        None => unreachable!(),
    };

    match qt.qt.get_mut(handle) {
        Some(tile) => begin_traverse_terrain(ellipsoid, occluder, camera, frame, tile),
        None => unreachable!(),
    };

    let tile = match qt.qt.get(handle) {
        Some(tile) => tile,
        None => unreachable!(),
    };

    let is_culled_by_occlusion = !tile
        .occludee_point_in_scaled_space
        .map(|p| occluder.is_scaled_space_point_visible(p))
        .unwrap_or(true);

    // SSE and camera distance are computed once, up front — even for
    // horizon-occluded tiles, so the occlusion prefetch orders its requests
    // and mesh builds by `OrderByDistance` (nearest hidden tiles first).
    let distance_from_camera = tile.calc_distance_from_camera(camera, ellipsoid).abs();
    let sse = tile.calc_sse(
        frustum,
        window,
        ellipsoid,
        if terrain_layer.is_some() { 65. } else { 64. },
        distance_from_camera,
        fog,
        dynamic_sse,
    );
    let tile = qt.qt.get_mut(handle).unwrap();
    tile.sse = sse;
    tile.distance_from_camera = distance_from_camera;

    if is_culled_by_occlusion {
        if !allow_occlusion_prefetch {
            return TraversalResult::Culled;
        }
        prefetch_occluded_tile(
            command,
            qt,
            tc,
            buf,
            data_manager,
            frame,
            terrain_layer,
            sorted_layers,
            source_store,
            handle,
            data_requesters,
            terrain_data_requester,
            ready_parent_tile_handle,
            &ready_layer_parents,
            upsample_ancestors,
        );
        return TraversalResult::Culled;
    }

    let tile = qt.qt.get(handle).unwrap();
    let is_culled_by_frustum = !tile.intersect_with_camera_frustum(frustum);

    let tile_ready_state = tile.is_ready(
        upsample_ancestors,
        data_requesters,
        terrain_data_requester,
        terrain_layer,
        sorted_layers,
        source_store,
    );
    let is_tile_ready = tile_ready_state.is_tile_ready;
    let use_terrain = tile_ready_state.use_terrain;

    let is_activated = tc.is_rendered_tile_activated(&handle, meshes);
    let is_rendered_last_frame = is_activated;
    // Whether the tile is on screen if it renders itself this frame: shown,
    // in view, and not about to give way to an ancestor that meets SSE.
    let is_on_screen = is_activated && !is_culled_by_frustum && !meets_sse_ancestors;

    let tile = qt.qt.get_mut(handle).unwrap();
    let were_children_rendered = tile.were_children_rendered;
    tile.were_children_rendered = false;
    tile.children_take_over = None;

    let is_over_min_z = if has_regular_tiles {
        sorted_layers
            .iter()
            .filter(|(t, _)| t.hillshade_config.is_none())
            .filter_map(|(t, _)| t.source_id.as_deref().and_then(|id| source_store.get(id)))
            .any(|s| s.is_over_min_zoom(tile.coords.z))
    } else {
        true
    };

    let meets_sse =
        sse <= degrade.effective_max_sse(max_sse, distance_from_camera) && is_over_min_z;

    let is_renderable = is_rendered_last_frame || is_tile_ready;

    // If this tile has a terrain and it's prepared, request its hillshade
    // textures lazily. Regular raster textures are draped from the raster
    // pipeline (see `update_mesh_material`).
    // Frustum-culled tiles are requested at the SAME priority as in-view
    // tiles: a culled sibling is part of the same swap group (the parent can
    // only hand off once ALL children are prepared), so demoting it just
    // delays the swap and keeps the low-res parent on screen longer.
    if terrain_layer.is_some() && is_renderable {
        let tile = qt.qt.get_mut(handle).unwrap();
        request_hillshade_data_requester(
            command,
            tile,
            sorted_layers,
            source_store,
            handle,
            data_requesters,
            Priority::High,
            buf,
            data_manager,
        );
    }

    if meets_sse || meets_sse_ancestors {
        // The SSE leaf fetches its own DEM right away, even while it is
        // still being upsampled: the upsampled mesh is only a stand-in until
        // the real one lands, and waiting for the leaf to be activated (the
        // whole upsample chain above it swapped in first) would only delay
        // the replacement. Intermediate levels never meet SSE, so they still
        // fetch nothing (see the activated-only fetch at the end); a fast
        // zoom-in's transient leaves are dropped with their tiles.
        if !meets_sse_ancestors {
            prepare_tile_resource(
                command,
                qt,
                buf,
                data_manager,
                terrain_layer,
                handle,
                tc,
                sorted_layers,
                source_store,
                data_requesters,
                terrain_data_requester,
                if is_renderable {
                    Priority::Medium
                } else {
                    Priority::High
                },
            );
        }

        if is_renderable
            // Keep rendering children while preparing the tile if it's available, because rendering tile takes some time.
            && !were_children_rendered
        {
            if is_on_screen {
                flag_stale_upsample(
                    command,
                    tc,
                    qt,
                    terrain_layer,
                    source_store,
                    terrain_data_requester,
                    handle,
                    upsample_ancestors,
                );
            }
            return TraversalResult::TileRendered;
        }

        if !were_children_rendered {
            return TraversalResult::NotFound;
        }
    }

    // The not-yet-renderable chain from the nearest renderable ancestor down
    // to (and including) this tile.
    let unrenderable_chain_len = if is_renderable {
        0
    } else {
        levels_without_renderable_ancestor.saturating_add(1)
    };

    // Ladder refinement: once the chain of not-yet-renderable levels reaches
    // the bound, request this tile and wait for it to load instead of
    // descending further. The frontier advances as each level becomes
    // renderable, so deep target tiles are reached in bounded steps and every
    // traversed tile keeps a renderable ancestor nearby as fallback cover.
    // Already-swapped subtrees (`were_children_rendered`) are exempt: their
    // children are on screen and must keep being traversed. Descendants of an
    // SSE-satisfying tile (`meets_sse_ancestors`) are exempt as well — that
    // path intentionally avoids new requests while the parent activates.
    if !meets_sse_ancestors
        && !were_children_rendered
        && unrenderable_chain_len >= MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR
    {
        if is_over_min_z {
            prepare_tile_resource(
                command,
                qt,
                buf,
                data_manager,
                terrain_layer,
                handle,
                tc,
                sorted_layers,
                source_store,
                data_requesters,
                terrain_data_requester,
                Priority::Extreme,
            );
        }
        return TraversalResult::NotFound;
    }

    // Frustum-culled tiles keep traversing an already-swapped subtree
    // (`were_children_rendered`): the recursion stamps `visited_at` so
    // `clear_caches` doesn't destroy the subtree within two frames, and the
    // group re-enters the frustum fully prepared instead of collapsing to the
    // low-res parent (flicker while rotating a tilted camera). This mirrors
    // the 3D Tiles REPLACE handling, which preserves touched culled tiles.
    // Never-rendered subtrees are still not expanded while culled, so being
    // out of the frustum never starts deeper refinement on its own.
    // Whether this tile's prepared children cover its whole region this frame
    // (see the `!is_renderable` return below), and the take-over masks that
    // go with it (some of those children may be held: hidden and filled by
    // this tile's mesh until they can render).
    let mut children_cover = false;
    let mut cover_masks: Option<ChildrenTakeOver> = None;

    if (!is_culled_by_frustum || were_children_rendered)
        && let Some(children) = TerrainTile::traversable_children(qt, handle)
    {
        let mut any_children_rendered = false;

        let ready_parent_tile_handle = if tile_ready_state.is_texture_ready {
            Some(handle)
        } else {
            ready_parent_tile_handle
        };

        // Update hillshade parents - track nearest ready parent for each layer
        let ready_layer_parents = update_ready_layer_parents(
            qt,
            handle,
            sorted_layers,
            data_requesters,
            ready_layer_parents,
        );

        let resamples_dem =
            terrain_layer.is_some_and(|l| matches!(l.terrain_type, TerrainDataType::RasterDEM));
        let child_upsample_ancestors = upsample_ancestors.extend_with(
            qt.qt.get(handle).unwrap(),
            handle,
            resamples_dem && tile_ready_state.is_terrain_ready,
        );

        // Tile has several states to switch LOD smoothly.
        // 1. RenderedTile component is spawned if a tile is selected.
        // 2. Rendering engine needs to do some preparations, so the selected tile is marked as it's prepared after these preparations.
        // 3. The selected tile is activated if all other same level children are activated as well.
        // 4. When the selected tile is activated, the tile will be visible.
        let mut are_all_children_rendered = true;
        let mut are_all_children_prepared = true;
        let mut are_all_children_activated = true;

        // Bitmasks over the (at most 4) child slots; avoids per-tile Vec
        // allocations in this per-frame hot path.
        let mut rendered_children_mask = 0u8;
        let mut activated_children_mask = 0u8;
        let mut hidden_children_mask = 0u8;
        // Children of an already-shown group that only now came into view
        // (past the horizon, never spawned) and have no prepared mesh yet:
        // kept hidden until prepared, without collapsing the group.
        let mut held_children_mask = 0u8;
        for (i, child) in children.iter().enumerate() {
            let traversal_result = traverse_terrain(
                command,
                sorted_layers,
                terrain_layer,
                source_store,
                *child,
                tc,
                qt,
                buf,
                data_manager,
                frame,
                camera,
                frustum,
                data_requesters,
                terrain_data_requester,
                window,
                ellipsoid,
                occluder,
                meshes,
                fog,
                dynamic_sse,
                max_sse,
                degrade,
                if meets_sse_ancestors {
                    is_ancestor_rendered
                } else {
                    is_rendered_last_frame
                },
                meets_sse,
                ready_parent_tile_handle,
                ready_layer_parents.clone(),
                child_upsample_ancestors,
                unrenderable_chain_len,
                allow_occlusion_prefetch,
            );

            if matches!(traversal_result, TraversalResult::NotFound) {
                are_all_children_rendered = false;
                are_all_children_prepared = false;
                are_all_children_activated = false;
            }

            if matches!(
                traversal_result,
                TraversalResult::NotFound | TraversalResult::Culled
            ) {
                hidden_children_mask |= 1 << i;
            }

            // If there is one child at least, trigger the rendering children process.
            if matches!(
                traversal_result,
                TraversalResult::TileRendered
                    | TraversalResult::ChildrenRendered
                    | TraversalResult::ChildrenMeshesPrepared
                    | TraversalResult::Culled
            ) {
                any_children_rendered = true;
            }

            // If tile's mesh isn't ready, render the parent tile — unless the
            // group is already on screen: then a member that only now came
            // into view stays hidden until its mesh is prepared. Collapsing
            // the whole shown group back to this tile for that would flash a
            // far coarser mesh over everything the group already shows.
            if (matches!(traversal_result, TraversalResult::TileRendered)
                && !tc.is_rendered_tile_prepared(child))
            {
                if were_children_rendered {
                    held_children_mask |= 1 << i;
                } else {
                    are_all_children_prepared = false;
                    are_all_children_rendered = false;
                }
            }

            // If tile's mesh isn't ready, render the parent tile.
            if (matches!(traversal_result, TraversalResult::TileRendered)
                && held_children_mask & (1 << i) == 0
                && !tc.is_rendered_tile_activated(child, meshes))
            {
                are_all_children_activated = false;
            }

            // Skip rendering children in this tile.
            if matches!(
                traversal_result,
                TraversalResult::ChildrenRendered | TraversalResult::ChildrenMeshesPrepared
            ) {
                rendered_children_mask |= 1 << i;
            }

            if matches!(traversal_result, TraversalResult::ChildrenMeshesPrepared) {
                activated_children_mask |= 1 << i;
            }
        }

        // Avoid rendering children if children were rendered at last frame.
        let allow_updating_state_of_children = !meets_sse && !meets_sse_ancestors;

        if any_children_rendered {
            // If the children are rendered to fill the parent, the parent tile replaces them when it is ready.
            let hide_children = (meets_sse_ancestors && is_ancestor_rendered)
                || (meets_sse && is_rendered_last_frame);

            let tile = qt.qt.get_mut(handle).unwrap();
            tile.were_children_rendered = are_all_children_activated && !hide_children;
            let parent_mesh_ready = tile.cached_mesh_handle.is_some();

            if allow_updating_state_of_children {
                for (i, child) in children.iter().enumerate() {
                    // If this child is not renderable, skip rendering this child.
                    if hidden_children_mask & (1 << i) != 0 {
                        continue;
                    }

                    // A child the view traverses is no longer speculative,
                    // whether or not it is re-spawned below (a child whose own
                    // subtree is on screen is skipped there): a stale
                    // `prefetched` flag would let the eviction pass destroy it
                    // the moment its mesh is hidden, and a group member lost
                    // that way collapses the whole group to a coarse ancestor.
                    if let Some(cache) = tc.rendered_tile_caches.get_mut(child) {
                        cache.prefetched = false;
                    }

                    // If this child's children are rendered, skip rendering
                    // this child — unless they need it built (see
                    // `prepare_covered_anchor`); it stays hidden under them.
                    if rendered_children_mask & (1 << i) != 0
                        && !prepare_covered_anchor(
                            command,
                            qt,
                            buf,
                            data_manager,
                            terrain_layer,
                            *child,
                            tc,
                            sorted_layers,
                            source_store,
                            data_requesters,
                            terrain_data_requester,
                        )
                    {
                        continue;
                    }

                    let handle = *child;

                    // A child needs something to build its mesh from: its own
                    // ready DEM, or an ancestor mesh with real heights to
                    // upsample — any ancestor, not just this tile (see
                    // `TerrainTile::find_upsample_source`). Hold back only
                    // children with neither: a terrain-failed child would
                    // render an unexpected flat last-resort mesh (#601). Not
                    // waiting for this tile's own mesh spawns every level
                    // below a ready ancestor in one traversal, so a region
                    // revealed by a zoom-out (or a deep zoom-in target) builds
                    // all its levels in parallel instead of one level per
                    // parent mesh, and the coarse ancestor covering it is
                    // replaced after one round trip rather than one per level.
                    if use_terrain
                        && !parent_mesh_ready
                        && !tc.rendered_tile_caches.contains_key(&handle)
                        && !qt.qt.get(handle).is_some_and(|t| {
                            t.is_terrain_ready(terrain_data_requester)
                                || t.is_upsamplable(
                                    child_upsample_ancestors,
                                    terrain_layer,
                                    t.is_upsample_depth_bounded(
                                        terrain_layer,
                                        source_store,
                                        terrain_data_requester,
                                    ),
                                )
                        })
                    {
                        continue;
                    }

                    let tile = match qt.qt.get_mut(handle) {
                        Some(t) => t,
                        None => unreachable!(),
                    };
                    spawn_tile_entity(
                        command,
                        tc,
                        frame,
                        tile,
                        handle,
                        ready_parent_tile_handle,
                        ready_layer_parents.clone(),
                        false,
                    );
                }
            }

            let children_take_over = are_all_children_prepared && !hide_children;
            children_cover = children_take_over;
            cover_masks = Some(ChildrenTakeOver {
                activated: activated_children_mask,
                hidden: hidden_children_mask | held_children_mask,
                held: held_children_mask,
                covered: rendered_children_mask & !activated_children_mask,
            });

            // A completed group is not shown here: the swap is applied by the
            // nearest ancestor whose own group is still incomplete (or by the
            // root), see `activate_selected_subtree`. Activating it now would
            // draw it on top of that ancestor, which stays on screen until
            // its whole group is prepared.
            if allow_updating_state_of_children && children_take_over {
                qt.qt.get_mut(handle).unwrap().children_take_over = cover_masks;
                return TraversalResult::ChildrenMeshesPrepared;
            }

            for (i, child) in children.iter().enumerate() {
                if (hidden_children_mask | held_children_mask) & (1 << i) != 0 {
                    tc.activate_rendered_tile(child, meshes, false);
                } else if activated_children_mask & (1 << i) != 0 {
                    activate_selected_subtree(qt, tc, meshes, *child, children_take_over);
                } else if rendered_children_mask & (1 << i) != 0 {
                    // Its own children are on screen; the child itself stays
                    // hidden until it takes over from them.
                    tc.activate_rendered_tile(child, meshes, false);
                } else if children_take_over {
                    show_tile_over_descendants(qt, tc, meshes, *child);
                } else {
                    tc.activate_rendered_tile(child, meshes, false);
                }
            }

            if allow_updating_state_of_children && are_all_children_rendered {
                // This tile's children are rendered completely, so parent tile isn't rendered.
                return TraversalResult::ChildrenRendered;
            }
        }
    }

    if !is_renderable {
        // Avoid to request or render new tile while waiting for parent tile is activated.
        if meets_sse_ancestors {
            return TraversalResult::NotFound;
        }
        if is_over_min_z {
            prepare_tile_resource(
                command,
                qt,
                buf,
                data_manager,
                terrain_layer,
                handle,
                tc,
                sorted_layers,
                source_store,
                data_requesters,
                terrain_data_requester,
                Priority::Extreme,
            );
        }
        // Zoom-out hold: a tile whose children are on screen waits for its
        // own DEM instead of upsampling (see `TerrainTile::is_ready`), so it
        // is not renderable yet — but its region is fully covered by those
        // prepared children. Reporting `NotFound` would make the nearest
        // renderable ancestor take over and hide them, replacing fine terrain
        // with a much coarser mesh; keep the children as cover until the DEM
        // lands and this tile can take over itself.
        if children_cover {
            // Held members need this tile's mesh to fill their quadrants: hand
            // the masks up so the swap applies them (fill mode) even though
            // this tile itself cannot take over yet.
            if let Some(masks) = cover_masks
                && masks.held != 0
            {
                qt.qt.get_mut(handle).unwrap().children_take_over = Some(masks);
                return TraversalResult::ChildrenMeshesPrepared;
            }
            return TraversalResult::ChildrenRendered;
        }
        return TraversalResult::NotFound;
    }

    // Avoid to return an inactivated tile when meets SSE from ancestors.
    if meets_sse_ancestors && !is_activated {
        return TraversalResult::NotFound;
    }

    // This tile is on screen here without meeting SSE: its children cannot
    // render (beyond the source's max zoom), or are still building. Only an
    // activated tile fetches its own DEM from here, so the intermediate
    // levels of an upsample chain, each briefly on screen while its children
    // build, do not all fetch. `prepare_tile_resource` skips the overscale
    // band itself.
    if is_activated
        && !meets_sse_ancestors
        && tile_ready_state.is_upsamplable
        && !tile_ready_state.is_terrain_ready
    {
        prepare_tile_resource(
            command,
            qt,
            buf,
            data_manager,
            terrain_layer,
            handle,
            tc,
            sorted_layers,
            source_store,
            data_requesters,
            terrain_data_requester,
            Priority::Medium,
        );
    }

    if is_on_screen {
        flag_stale_upsample(
            command,
            tc,
            qt,
            terrain_layer,
            source_store,
            terrain_data_requester,
            handle,
            upsample_ancestors,
        );
    }

    TraversalResult::TileRendered
}

/// Flag an on-screen tile for a rebuild once its upsampled mesh has a better
/// source (see `TerrainTile::has_stale_upsample_source`); `transfer_mesh`
/// picks the flag up. Tiles nothing shows — covered by their children or out
/// of view — are left alone: rebuilding them spends a worker task on a mesh
/// no one looks at, and they are flagged once they are on screen again.
#[allow(clippy::too_many_arguments)]
fn flag_stale_upsample(
    command: &mut Commands,
    tc: &TileCacheManager,
    qt: &TerrainTileQuadtree,
    terrain_layer: &Option<&TerrainLayer>,
    source_store: &SourceStore,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
    handle: TileHandle,
    upsample_ancestors: UpsampleAncestors,
) {
    let tile = qt.qt.get(handle).unwrap();
    // The real ancestor at `real_z` is the last this tile will get when no
    // tile between them can still hold real data: each is in the overscale
    // band or its DEM request failed, and neither is ever retried.
    let is_final = |real_z: usize| {
        let coords = (tile.coords.x, tile.coords.y, tile.coords.z);
        (real_z + 1..tile.coords.z).all(|z| {
            qt.qt
                .ancestor(coords, z)
                .and_then(|a| qt.qt.get(a.handle()))
                .is_some_and(|t| {
                    !t.is_upsample_depth_bounded(
                        terrain_layer,
                        source_store,
                        terrain_data_requester,
                    )
                })
        })
    };
    if tile.has_stale_upsample_source(upsample_ancestors, is_final)
        && !tile.is_upsample_depth_bounded(terrain_layer, source_store, terrain_data_requester)
    {
        command
            .entity(tc.rendered_tile_caches[&handle].rendered_tile_entity)
            .try_insert(RemeshPending);
    }
}

/// A tile whose children cover it is normally left alone: nothing shows it.
/// The exception is a tile with a child that will never hold real data of
/// its own (the overscale band, or a failed DEM request): that child and
/// everything below it are upsampled from the nearest real data above, and
/// this tile is the nearest level that can still provide it. Covered, it is
/// never activated or an SSE leaf, so its DEM is fetched here. A raster-DEM
/// upsample resamples the landed DEM itself; a quantized-mesh one clips the
/// mesh, so once the data lands this returns `true` for the caller to spawn
/// the tile and have it built.
#[allow(clippy::too_many_arguments)]
fn prepare_covered_anchor(
    command: &mut Commands,
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    data_manager: &mut DataManager,
    terrain_layer: &Option<&TerrainLayer>,
    handle: TileHandle,
    tc: &mut TileCacheManager,
    sorted_layers: &[(&TilesLayer, &Order)],
    source_store: &SourceStore,
    data_requesters: &Query<&navara_data_requester::DataRequester>,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
) -> bool {
    let Some(layer) = terrain_layer else {
        return false;
    };
    let Some(source) = layer
        .source_id
        .as_deref()
        .and_then(|id| source_store.get(id))
    else {
        return false;
    };
    let never_real = |t: &TerrainTile| {
        source.should_overscale(t.coords.z) || t.is_terrain_failed(terrain_data_requester)
    };
    let is_quantized_mesh = matches!(layer.terrain_type, TerrainDataType::QuantizedMesh);

    let tile = qt.qt.get(handle).unwrap();
    let dem_landed = tile.is_terrain_ready(terrain_data_requester);
    let holds_real_data = if is_quantized_mesh {
        !tile.upsampled
            && tile
                .cached_mesh_handle
                .as_ref()
                .is_some_and(|m| m.heights.is_some())
    } else {
        dem_landed
    };
    if holds_real_data
        || !tile
            .children
            .iter()
            .any(|c| qt.qt.get(*c).is_some_and(never_real))
        || never_real(tile)
    {
        return false;
    }

    if !dem_landed {
        // Not requested yet, or rejected by the rate limiter (which drops the
        // requester): a pending request is left to land.
        let is_requested = tile
            .terrain_data
            .as_ref()
            .and_then(|t| t.data_requester_entity_id())
            .is_some();
        if !is_requested {
            prepare_tile_resource(
                command,
                qt,
                buf,
                data_manager,
                terrain_layer,
                handle,
                tc,
                sorted_layers,
                source_store,
                data_requesters,
                terrain_data_requester,
                Priority::Medium,
            );
        }
        return false;
    }
    // A rendered tile is re-meshed by `mark_landed_dem_for_remesh` instead.
    !tc.rendered_tile_caches.contains_key(&handle)
}

/// Apply a completed swap recorded by `traverse_terrain`: hide `handle` and
/// show the descendants it hands off to, following the take-over masks down
/// the subtree. `active == false` keeps the whole subtree hidden while the
/// ancestor that owns the swap stays on screen.
pub(super) fn activate_selected_subtree(
    qt: &TerrainTileQuadtree,
    tc: &TileCacheManager,
    meshes: &mut Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    handle: TileHandle,
    active: bool,
) {
    let tile = qt.qt.get(handle).unwrap();
    let take_over = tile
        .children_take_over
        .expect("a tile handing off to its children recorded its take-over masks");
    // A member that only now came into view has no mesh yet: fill its
    // quadrant with this tile's own mesh instead of leaving a hole, without
    // drawing over the prepared children. Such members are always at the far
    // edge of the view (revealed past the horizon), outside the shadow
    // cascades, so the shadow material needs no matching cut.
    if active && take_over.held != 0 {
        tc.fill_rendered_tile(&handle, meshes, take_over.held);
    } else {
        tc.activate_rendered_tile(&handle, meshes, false);
    }
    for (i, child) in tile.children.iter().enumerate() {
        if take_over.hidden & (1 << i) != 0 {
            tc.activate_rendered_tile(child, meshes, false);
        } else if take_over.activated & (1 << i) != 0 {
            activate_selected_subtree(qt, tc, meshes, *child, active);
        } else if take_over.covered & (1 << i) != 0 {
            // Its shown descendants are the cover; never draw it over them.
            tc.activate_rendered_tile(child, meshes, false);
        } else if active {
            show_tile_over_descendants(qt, tc, meshes, *child);
        } else {
            tc.activate_rendered_tile(child, meshes, false);
        }
    }
}

/// Show `handle` and, the moment it comes on screen, hide every rendered
/// descendant in the same frame. A tile that takes over from its shown
/// children (zoom-out) must not be drawn on top of them for even one frame
/// (z-fighting), and the deeper descendants are not visited by a traversal
/// that stops at this tile, so leaving them to `clear_caches` would keep them
/// on screen for another frame or two. The walk only runs on the
/// hidden→shown transition, never for a tile that is already on screen.
pub(super) fn show_tile_over_descendants(
    qt: &TerrainTileQuadtree,
    tc: &TileCacheManager,
    meshes: &mut Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    handle: TileHandle,
) {
    if tc.activate_rendered_tile(&handle, meshes, true) {
        hide_descendants(qt, tc, meshes, handle);
    }
}

fn hide_descendants(
    qt: &TerrainTileQuadtree,
    tc: &TileCacheManager,
    meshes: &mut Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    handle: TileHandle,
) {
    let Some(tile) = qt.qt.get(handle) else {
        return;
    };
    for child in tile.children.iter() {
        tc.activate_rendered_tile(child, meshes, false);
        hide_descendants(qt, tc, meshes, *child);
    }
}

// We should use entity to store the rendered tile, because the Bevy's entity is extensible.
#[allow(clippy::too_many_arguments)]
pub fn spawn_tile_entity(
    commands: &mut Commands,
    tc: &mut TileCacheManager,
    frame: &FrameManager,
    tile: &mut TerrainTile,
    tile_handle: TileHandle,
    ready_parent_tile_handle: Option<TileHandle>,
    layer_parents: Option<Arc<Vec<Option<LayerParent>>>>,
    // `true` only when spawned speculatively for a hidden tile (see
    // `prefetch_occluded_tile`); any visible-path spawn clears the flag so
    // the eviction pass never touches a tile the view relies on.
    prefetched: bool,
) {
    tile.rendered_at = frame.rendered_frame();
    tc.is_updated_in_this_frame = true;

    if let Some(tile) = tc.rendered_tile_caches.get_mut(&tile_handle) {
        tile.ready_parent_tile_handle = ready_parent_tile_handle;
        tile.layer_parents = layer_parents;
        tile.prefetched &= prefetched;
        return;
    }

    let e = commands.spawn((
        RenderedTile {
            tile_handle,
            ..Default::default()
        },
        OrderByDistance {
            sse: tile.sse,
            distance: tile.distance_from_camera,
        },
    ));
    tc.rendered_tile_caches.insert(
        tile_handle,
        RenderedTileCache {
            rendered_tile_entity: e.id(),
            ready_parent_tile_handle,
            layer_parents,
            mesh_entity: None,
            mesh_prepared: false,
            needs_material_update: true,
            prefetched,
        },
    );
}

/// Prefetch a horizon-occluded tile so the area beyond the horizon has usable
/// cover when it is revealed: zooming out (or pitching up) raises the horizon
/// and exposes that area all at once, and without prefetch the only cover
/// there is an ancestor many levels up — a huge low-zoom parent takes over
/// the whole view until the gap reloads.
///
/// Two stages, both invisible while the tile stays culled:
/// 1. Request the DEM at `Low` priority, so visible tiles always win the
///    pending-request slots (see `prefetch_max_pendings`).
/// 2. Once the data lands, spawn the tile (inactive) so its mesh is built
///    ahead of time — the strict swap can only fall back to an ancestor with
///    a PREPARED mesh, so data alone would still climb to a low-zoom parent.
#[allow(clippy::too_many_arguments)]
fn prefetch_occluded_tile(
    command: &mut Commands,
    qt: &mut TerrainTileQuadtree,
    tc: &mut TileCacheManager,
    buf: &mut BufferStore,
    data_manager: &mut DataManager,
    frame: &FrameManager,
    terrain_layer: &Option<&TerrainLayer>,
    sorted_layers: &[(&TilesLayer, &Order)],
    source_store: &SourceStore,
    handle: TileHandle,
    data_requesters: &Query<&navara_data_requester::DataRequester>,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
    ready_parent_tile_handle: Option<TileHandle>,
    ready_layer_parents: &Option<Arc<Vec<Option<LayerParent>>>>,
    upsample_ancestors: UpsampleAncestors,
) {
    // Raster-only maps drape textures with the raster pipeline's own ancestor
    // fallback; there is no terrain geometry to prefetch.
    if terrain_layer.is_none() {
        return;
    }

    // Already prefetched: the data landed and the mesh is building or built.
    if tc.rendered_tile_caches.contains_key(&handle) {
        return;
    }

    // Terrain/hillshade zoom bounds are enforced inside the request helpers.
    prepare_tile_resource(
        command,
        qt,
        buf,
        data_manager,
        terrain_layer,
        handle,
        tc,
        sorted_layers,
        source_store,
        data_requesters,
        terrain_data_requester,
        Priority::Low,
    );

    let tile = qt.qt.get(handle).unwrap();
    let ready = tile.is_ready(
        upsample_ancestors,
        data_requesters,
        terrain_data_requester,
        terrain_layer,
        sorted_layers,
        source_store,
    );
    // Only mesh while hidden what needs no upsample, or what no DEM will ever
    // replace — the overscale band never fetches and a failed request is
    // never retried. Upsampling a tile whose Low-priority DEM is still on its
    // way would spend a worker task now and a second one when it lands.
    let in_overscale_band = terrain_layer
        .and_then(|l| l.source_id.as_deref())
        .and_then(|id| source_store.get(id))
        .is_some_and(|s| s.should_overscale(tile.coords.z));
    let no_dem_will_land = in_overscale_band || tile.is_terrain_failed(terrain_data_requester);
    if ready.is_tile_ready && (!ready.is_upsamplable || no_dem_will_land) {
        spawn_tile_entity(
            command,
            tc,
            frame,
            qt.qt.get_mut(handle).unwrap(),
            handle,
            ready_parent_tile_handle,
            ready_layer_parents.clone(),
            true,
        );
    }
}

/// Update the per-layer hillshade ancestor fallback by tracking the nearest
/// ready hillshade entity for each layer. Regular raster layers are resolved by
/// the raster pull (see `update_mesh_material`) and keep a `None` slot here, so
/// only hillshade layers carry a terrain-side parent.
fn update_ready_layer_parents(
    qt: &TerrainTileQuadtree,
    handle: TileHandle,
    sorted_layers: &[(&TilesLayer, &Order)],
    data_requesters: &Query<&navara_data_requester::DataRequester>,
    ready_layer_parents: Option<Arc<Vec<Option<LayerParent>>>>,
) -> Option<Arc<Vec<Option<LayerParent>>>> {
    // Without hillshade layers every slot stays `None`; skip the per-tile
    // Vec + Arc allocation (this runs for every traversed tile every frame).
    if sorted_layers
        .iter()
        .all(|(layer, _)| layer.hillshade_config.is_none())
    {
        return ready_layer_parents;
    }

    let tile = qt.qt.get(handle)?;
    let mut updated_parents = Vec::with_capacity(sorted_layers.len());

    for (i, (layer, _)) in sorted_layers.iter().enumerate() {
        // Regular raster layers are draped via the raster pull, not the
        // terrain-side ancestor fallback, so they keep an empty slot here.
        if layer.hillshade_config.is_none() {
            updated_parents.push(None);
            continue;
        }

        let own_entity = tile
            .hillshade_entity_ids
            .as_ref()
            .and_then(|ids| ids.get(i).copied().flatten());

        let parent = if let Some(entity) = own_entity
            && TerrainTile::is_hillshade_entity_ready(entity, data_requesters)
        {
            Some(LayerParent {
                entity,
                zoom: tile.coords.z,
            })
        } else {
            ready_layer_parents
                .as_ref()
                .and_then(|parents| parents.get(i).cloned())
                .flatten()
        };
        updated_parents.push(parent);
    }

    Some(Arc::new(updated_parents))
}

/// Prepare some resource that is necessary to render the tile.
/// This returns whether the resource is requested or not.
#[allow(clippy::too_many_arguments)]
pub fn prepare_tile_resource(
    commands: &mut Commands,
    qt: &mut TerrainTileQuadtree,
    buf: &mut BufferStore,
    data_manager: &mut DataManager,
    terrain_layer: &Option<&TerrainLayer>,
    handle: TileHandle,
    tc: &mut TileCacheManager,
    sorted_layers: &[(&TilesLayer, &Order)],
    source_store: &SourceStore,
    data_requesters: &Query<&navara_data_requester::DataRequester>,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
    priority: Priority,
) {
    let tile = qt.qt.get_mut(handle).unwrap();

    let terrain_source = terrain_layer
        .and_then(|l| l.source_id.as_deref())
        .and_then(|id| source_store.get(id));

    let should_upsample = terrain_source.is_some_and(|s| s.should_overscale(tile.coords.z));
    if should_upsample {
        return;
    }

    if matches!(terrain_source, Some(s) if s.is_over_min_zoom(tile.coords.z)) {
        request_terrain_data(
            commands,
            tile,
            buf,
            data_manager,
            terrain_layer,
            source_store,
            handle,
            terrain_data_requester,
            priority,
        );
    } else {
        // If this tile doesn't have terrain, request its hillshade textures.
        // Regular raster textures are draped from the raster pipeline.
        request_hillshade_data_requester(
            commands,
            tile,
            sorted_layers,
            source_store,
            handle,
            data_requesters,
            priority,
            buf,
            data_manager,
        );
    }

    if !tc.requested_tile_caches.contains(&handle) {
        tc.requested_tile_caches.insert(handle);
    }
}

pub(crate) fn prepare_upsamplable_terrain_data(
    qt: &mut TerrainTileQuadtree,
    terrain_layer: &Option<&TerrainLayer>,
    source_store: &SourceStore,
    handle: TileHandle,
) {
    if qt.qt.get(handle).is_some_and(|t| t.terrain_data.is_some()) {
        return;
    }

    let Some(layer) = terrain_layer else {
        return;
    };
    let Some(source) = layer
        .source_id
        .as_deref()
        .and_then(|id| source_store.get(id))
    else {
        return;
    };

    let terrain_data: Box<dyn navara_tile_component::TerrainData> = match &layer.terrain_type {
        TerrainDataType::RasterDEM => {
            let Some(elevation_decoder) = source.elevation_decoder() else {
                return;
            };
            Box::new(RasterDEMData::new(*elevation_decoder))
        }
        TerrainDataType::QuantizedMesh => Box::new(QuantizedMeshData::new_with_tiling_scheme(
            source.tiling_scheme(),
        )),
        TerrainDataType::Ellipsoid | TerrainDataType::Unknown => unreachable!(),
    };

    let tile = qt.qt.get_mut(handle).unwrap();

    tile.terrain_data = Some(terrain_data);
}

fn begin_traverse_terrain(
    ellipsoid: &Ellipsoid<FloatType>,
    occluder: &EllipsoidalOccluder,
    _camera: &Transform,
    frame: &FrameManager,
    tile: &mut TerrainTile,
) {
    tile.visited_at = frame.rendered_frame();
    tile.update_tile_occludee_point(ellipsoid, occluder);
}

pub(super) enum TraversalResult {
    TileRendered,
    ChildrenRendered,
    ChildrenMeshesPrepared,
    Culled,
    NotFound,
}

#[cfg(test)]
mod tests {
    use super::*;

    use bevy_app::{App, Update};

    use navara_core::{Aabb, Angle, TileXYZ, WGS84_64, WGS84_A_64};
    use navara_material::{Appearance, RasterMaterial};
    use navara_math::Vec3;

    /// Camera placed at twice the Earth radius above (lng 0, lat 0), looking at
    /// the globe centre. The horizon half-angle is `acos(R / 2R) = 60°`, so any
    /// tile centred more than ~60° away in longitude/latitude is occluded.
    /// `fov_deg` narrows the frustum: with the default 60° the whole near
    /// hemisphere is in view, while e.g. 10° frustum-culls off-centre tiles
    /// that are still inside the horizon (not occluded).
    fn test_camera(fov_deg: f64) -> (Transform, CameraFrustum, EllipsoidalOccluder) {
        let camera_ecef = Vec3::new(WGS84_A_64 * 2.0, 0.0, 0.0);
        let camera = Transform::from_translation(camera_ecef).looking_at(Vec3::ZERO, Vec3::Y);
        let frustum = CameraFrustum::new(&camera, 0.1, 1e9, Angle::new(fov_deg).rad().val(), 1.0);
        let occluder = EllipsoidalOccluder::new(&camera_ecef, WGS84_64);
        (camera, frustum, occluder)
    }

    // ----- begin_traverse_terrain --------------------------------------------

    #[test]
    fn begin_traverse_terrain_stamps_visit_and_computes_occludee() {
        let (camera, _frustum, occluder) = test_camera(60.0);
        let frame = FrameManager::default(); // rendered_frame() == 0

        // A small tile near (lng 0, lat 0) so the occludee point is well defined.
        let mut tile = TerrainTile::new(TileXYZ { x: 8, y: 8, z: 4 }, 0., 0.);
        tile.visited_at = 42; // sentinel that must be overwritten
        assert!(tile.occludee_point_in_scaled_space.is_none());

        begin_traverse_terrain(&WGS84_64, &occluder, &camera, &frame, &mut tile);

        // The visit frame is recorded (here 0, overwriting the sentinel)...
        assert_eq!(tile.visited_at, frame.rendered_frame());
        assert_ne!(tile.visited_at, 42);
        // ...and the horizon-culling point is computed.
        assert!(tile.occludee_point_in_scaled_space.is_some());
    }

    // ----- traverse_terrain ---------------------------------------------------

    #[derive(bevy_ecs::prelude::Resource)]
    struct TargetHandle(TileHandle);

    #[derive(bevy_ecs::prelude::Resource)]
    struct TraverseConfig {
        max_sse: f64,
        /// Vertical field of view (degrees) used by `run_terrain_traverse`,
        /// overridable per test to frustum-cull specific tiles.
        fov: f64,
    }

    #[derive(bevy_ecs::prelude::Resource, Default)]
    struct LastResult(String);

    fn result_label(r: &TraversalResult) -> &'static str {
        match r {
            TraversalResult::TileRendered => "rendered",
            TraversalResult::ChildrenRendered => "children_rendered",
            TraversalResult::ChildrenMeshesPrepared => "children_prepared",
            TraversalResult::Culled => "culled",
            TraversalResult::NotFound => "notfound",
        }
    }

    /// Drive `traverse_terrain` from a Bevy system so its `Commands`/`Query`
    /// system-params are supplied. No terrain layer is present, so a fresh tile is
    /// "ready" (renders as flat geometry) — this keeps the readiness deterministic
    /// without standing up the async mesh-construction worker.
    #[allow(clippy::too_many_arguments)]
    fn run_terrain_traverse(
        mut commands: Commands,
        tiles: Query<(&TilesLayer, &Order)>,
        terrain_layers: Query<&TerrainLayer>,
        mut qt: ResMut<TerrainTileQuadtree>,
        mut tc: ResMut<TileCacheManager>,
        mut buf: ResMut<BufferStore>,
        mut data_manager: ResMut<DataManager>,
        frame: Res<FrameManager>,
        window: Res<Window>,
        data_requesters: Query<&navara_data_requester::DataRequester>,
        terrain_data_requester: TileTerrainDataRequesterQuery,
        mut meshes: Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
        target: Res<TargetHandle>,
        config: Res<TraverseConfig>,
        source_store: Res<SourceStore>,
        mut out: ResMut<LastResult>,
    ) {
        let (camera, frustum, occluder) = test_camera(config.fov);
        let fog = Fog {
            enabled: false,
            density: 0.,
            sse_factor: 1.0,
        };
        let terrain_layer: Option<&TerrainLayer> = terrain_layers.iter().next();

        let sorted_layers: Vec<_> = tiles.iter().sort::<&Order>().collect();
        let result = traverse_terrain(
            &mut commands,
            &sorted_layers,
            &terrain_layer,
            &source_store,
            target.0,
            &mut tc,
            &mut qt,
            &mut buf,
            &mut data_manager,
            &frame,
            &camera,
            &frustum,
            &data_requesters,
            &terrain_data_requester,
            &window,
            &WGS84_64,
            &occluder,
            &mut meshes,
            &fog,
            DynamicSseTerm::NONE,
            config.max_sse,
            SseDegrade::NONE,
            false,
            false,
            None,
            None,
            UpsampleAncestors::default(),
            0,
            true,
        );
        out.0 = result_label(&result).to_string();

        // Mirror the relevant arms of `update_terrain`'s root handling so a test
        // can observe the parent being shown (TileRendered) or hidden once its
        // children take over (ChildrenMeshesPrepared). For tiles without a seeded
        // render cache these calls are no-ops.
        match &result {
            TraversalResult::TileRendered => {
                if tc.is_rendered_tile_prepared(&target.0) {
                    show_tile_over_descendants(&qt, &tc, &mut meshes, target.0);
                }
            }
            TraversalResult::ChildrenMeshesPrepared => {
                activate_selected_subtree(&qt, &tc, &mut meshes, target.0, true);
            }
            _ => {}
        }
    }

    /// A regular (non-hillshade) raster layer with the given zoom range, paired
    /// with the source carrying that zoom range (zoom lives on the source now).
    fn raster_layer(
        layer_id: &str,
        min_zoom: usize,
        max_zoom: usize,
    ) -> (TilesLayer, navara_source::Source) {
        let layer = TilesLayer {
            layer_id: layer_id.to_string(),
            source_id: Some(layer_id.to_string()),
            appearance: Some(Appearance::TerrainTile(RasterMaterial::default())),
            elevation_heatmap_config: None,
            hillshade_config: None,
        };
        let source = navara_source::Source::RasterTile(navara_source::RasterTileSource {
            source_id: layer_id.to_string(),
            url: "https://example.com/{z}/{x}/{y}.png".to_string(),
            tms: false,
            min_zoom,
            max_zoom,
            overscaled_max_zoom: max_zoom,
        });
        (layer, source)
    }

    /// Register the layer's source in the store and spawn the layer entity.
    fn spawn_layer(app: &mut App, layer: (TilesLayer, navara_source::Source), order: Order) {
        let (layer, source) = layer;
        app.world_mut()
            .resource_mut::<SourceStore>()
            .add(source.source_id().to_string(), source);
        app.world_mut().spawn((layer, order));
    }

    /// App holding the terrain quadtree root and the resources `traverse_terrain`
    /// reads. `FramePlugin` advances the frame so `visited_at` is meaningful.
    fn terrain_app_with_root() -> (App, TileHandle) {
        let mut app = App::new();
        app.add_plugins(navara_frame::FramePlugin);

        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt.initialize_zero(&new_tile);
        let handle = qt.qt.zero().unwrap().handle();
        app.insert_resource(qt);

        app.insert_resource(TileCacheManager::default());
        app.insert_resource(BufferStore::default());
        app.insert_resource(DataManager::default());
        app.insert_resource(Window {
            width: 800.,
            height: 600.,
            pixel_ratio: 1.,
        });
        app.insert_resource(LastResult::default());
        app.insert_resource(TraverseConfig {
            max_sse: 1e30,
            fov: 60.0,
        });
        app.insert_resource(SourceStore::default());

        (app, handle)
    }

    #[test]
    fn traverse_terrain_stops_at_max_zoom_with_not_found() {
        let (mut app, _root) = terrain_app_with_root();
        // Layer maxes out at zoom 0, so a z1 tile is past every source's limit
        // and the traversal bails before visiting it.
        let handle = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((0, 0, 1), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(handle));
        spawn_layer(&mut app, raster_layer("a", 0, 0), Order(0));

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        assert_eq!(app.world().resource::<LastResult>().0, "notfound");

        // The over-max early-out happens before `begin_traverse_terrain`, so the
        // tile is never stamped with the current frame.
        let frame = app.world().resource::<FrameManager>().rendered_frame();
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert_ne!(qt.qt.get(handle).unwrap().visited_at, frame);
    }

    #[test]
    fn traverse_terrain_renders_ready_tile_when_sse_satisfied() {
        let (mut app, handle) = terrain_app_with_root();
        app.insert_resource(TargetHandle(handle));
        spawn_layer(&mut app, raster_layer("a", 0, 20), Order(0));
        // Huge threshold: the root's error is acceptable. With no terrain layer the
        // tile is ready (flat geometry), so geometry-first rendering selects it.
        app.insert_resource(TraverseConfig {
            max_sse: 1e30,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        assert_eq!(app.world().resource::<LastResult>().0, "rendered");

        let frame = app.world().resource::<FrameManager>().rendered_frame();
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert_eq!(qt.qt.get(handle).unwrap().visited_at, frame);

        // The tile's resource was requested while it renders.
        let tc = app.world().resource::<TileCacheManager>();
        assert!(tc.requested_tile_caches.contains(&handle));
    }

    #[test]
    fn traverse_terrain_subdivides_but_keeps_parent_until_children_ready() {
        let (mut app, handle) = terrain_app_with_root();
        app.insert_resource(TargetHandle(handle));
        // max_zoom=1 bounds the forced subdivision to a single level.
        spawn_layer(&mut app, raster_layer("a", 0, 1), Order(0));
        // Zero threshold: the root error is never satisfied, so it subdivides.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        // The root was subdivided into its 4 children...
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(qt.qt.leaf((0, 0, 1)).is_some(), "root should subdivide");

        // ...but since the children have no prepared mesh, the strict swap keeps
        // the (ready) parent visible instead of hiding it behind holes.
        assert_eq!(app.world().resource::<LastResult>().0, "rendered");
    }

    #[test]
    fn traverse_terrain_culls_occluded_tile() {
        let (mut app, _root) = terrain_app_with_root();
        spawn_layer(&mut app, raster_layer("a", 0, 20), Order(0));

        // A tile on the far side of the globe (centre ~lng 146°, > 60° from the
        // camera), so its horizon-culling point is occluded.
        let occluded = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((7, 4, 3), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(occluded));

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        assert_eq!(app.world().resource::<LastResult>().0, "culled");
    }

    /// A minimal renderable `Mesh` whose only meaningful field for traversal is
    /// `active` (drives `is_rendered_tile_activated`).
    fn dummy_mesh(active: bool) -> Mesh {
        Mesh {
            fill_quadrants: 0,
            vertices: 0,
            uvs: 0,
            indices: 0,
            active,
            render_order: 0,
            aabb: Aabb::from_vec3(&[Vec3::ZERO]),
            normals: None,
            skirt_vertices: None,
            skirt_uvs: None,
            skirt_indices: None,
            skirt_normals: None,
            watermask: None,
        }
    }

    fn spawn_mesh(app: &mut App, active: bool) -> Entity {
        app.world_mut()
            .spawn((dummy_mesh(active), TileMeshMarker::default()))
            .id()
    }

    /// Insert a render cache entry pointing at a (prepared) mesh, as if the tile
    /// had already been selected and its mesh built.
    fn seed_rendered(app: &mut App, handle: TileHandle, mesh_entity: Entity, prepared: bool) {
        let dummy = app.world_mut().spawn_empty().id();
        let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
        tc.rendered_tile_caches.insert(
            handle,
            RenderedTileCache {
                mesh_entity: Some(mesh_entity),
                ready_parent_tile_handle: None,
                layer_parents: None,
                rendered_tile_entity: dummy,
                mesh_prepared: prepared,
                needs_material_update: false,
                prefetched: false,
            },
        );
    }

    fn mesh_active(app: &App, e: Entity) -> bool {
        app.world().get::<Mesh>(e).unwrap().active
    }

    #[test]
    fn traverse_terrain_swaps_parent_for_children_once_prepared() {
        let (mut app, root) = terrain_app_with_root();
        app.insert_resource(TargetHandle(root));
        // max_zoom=1 bounds the forced subdivision: the z=1 children render, their
        // z=2 grandchildren are over max → NotFound, so each child resolves at z=1.
        spawn_layer(&mut app, raster_layer("a", 0, 1), Order(0));
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        // The parent begins visible: a prepared, active mesh.
        let root_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, root, root_mesh, true);

        app.add_systems(Update, run_terrain_traverse);

        // --- Phase A: children selected but their meshes are not built yet ---
        app.update();
        assert_eq!(
            app.world().resource::<LastResult>().0,
            "rendered",
            "parent stays visible while children load"
        );
        assert!(mesh_active(&app, root_mesh), "parent mesh still shown");

        // The visible children now have render caches (no mesh yet). Far-side
        // children may be occlusion-culled and have none — only seed the rest.
        let rendered_children: Vec<TileHandle> = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            let tc = app.world().resource::<TileCacheManager>();
            qt.qt
                .children((0, 0, 0))
                .unwrap()
                .iter()
                .map(|c| c.handle())
                .filter(|h| tc.rendered_tile_caches.contains_key(h))
                .collect()
        };
        assert!(
            !rendered_children.is_empty(),
            "at least one child should be rendered while the parent waits"
        );

        // --- Simulate the worker finishing every selected child's mesh ---
        let child_meshes: Vec<Entity> = rendered_children
            .iter()
            .map(|&child| {
                let e = spawn_mesh(&mut app, true);
                let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
                let cache = tc.rendered_tile_caches.get_mut(&child).unwrap();
                cache.mesh_entity = Some(e);
                cache.mesh_prepared = true;
                e
            })
            .collect();

        // --- Phase B: all children prepared → strict swap ---
        app.update();
        assert_eq!(
            app.world().resource::<LastResult>().0,
            "children_prepared",
            "all children prepared → parent hands off to them"
        );
        assert!(
            !mesh_active(&app, root_mesh),
            "parent mesh hidden once children take over"
        );
        for e in child_meshes {
            assert!(mesh_active(&app, e), "child mesh shown after swap");
        }
    }

    /// A raster-DEM terrain layer whose fetches never resolve: every spawned
    /// `DataRequester` stays `Pending`, so no tile becomes renderable until a
    /// test flips the status.
    /// A tile at `coords` with an empty height range, for the quadtree
    /// initializers.
    fn new_tile((x, y, z): (usize, usize, usize)) -> TerrainTile {
        TerrainTile::new(TileXYZ { x, y, z }, 0., 0.)
    }

    /// A cached mesh carrying heights: what makes a tile an upsample source.
    /// The buffer handles are never dereferenced by the traversal.
    fn mesh_with_heights() -> navara_mesh::CachedMeshHandle {
        navara_mesh::CachedMeshHandle {
            vertices: 0,
            indices: 0,
            uvs: 0,
            heights: Some(0),
            normals: None,
            watermask: None,
        }
    }

    /// Register a raster-DEM terrain source fetchable up to `max_zoom`
    /// (inclusive, with no overscale band beyond it) and spawn the terrain
    /// layer that uses it.
    fn spawn_raster_dem_terrain(app: &mut App, max_zoom: usize) {
        spawn_raster_dem_terrain_with_band(app, max_zoom, max_zoom);
    }

    /// As `spawn_raster_dem_terrain`, but with an overscale band: the levels
    /// past `max_zoom`, down to `overscaled_max_zoom`, are upsampled and never
    /// fetch a DEM of their own.
    fn spawn_raster_dem_terrain_with_band(
        app: &mut App,
        max_zoom: usize,
        overscaled_max_zoom: usize,
    ) {
        app.world_mut().resource_mut::<SourceStore>().add(
            "dem".to_string(),
            navara_source::Source::RasterDem(navara_source::RasterDemSource {
                source_id: "dem".to_string(),
                url: "https://example.com/{z}/{x}/{y}.png".to_string(),
                tms: false,
                elevation_decoder: navara_core::ElevationDecoder::default(),
                tile_size: 256,
                min_zoom: 0,
                max_zoom,
                overscaled_max_zoom,
            }),
        );
        app.world_mut().spawn(TerrainLayer {
            layer_id: "terrain".to_string(),
            source_id: Some("dem".to_string()),
            terrain_type: TerrainDataType::RasterDEM,
            appearance: None,
        });
    }

    /// As `spawn_raster_dem_terrain_with_band`, for quantized-mesh terrain.
    fn spawn_quantized_mesh_terrain_with_band(
        app: &mut App,
        max_zoom: usize,
        overscaled_max_zoom: usize,
    ) {
        app.world_mut().resource_mut::<SourceStore>().add(
            "qm".to_string(),
            navara_source::Source::QuantizedMesh(navara_source::QuantizedMeshSource {
                source_id: "qm".to_string(),
                url: "https://example.com/{z}/{x}/{y}.terrain".to_string(),
                tiling_scheme: navara_core::TilingScheme::WebMercator { tms: false },
                request_vertex_normals: false,
                request_water_mask: false,
                token: None,
                min_zoom: 0,
                max_zoom,
                overscaled_max_zoom,
            }),
        );
        app.world_mut().spawn(TerrainLayer {
            layer_id: "terrain".to_string(),
            source_id: Some("qm".to_string()),
            terrain_type: TerrainDataType::QuantizedMesh,
            appearance: None,
        });
    }

    /// A rendered tile two levels below the one the test camera looks at,
    /// showing a mesh clipped from level `source_z`. The camera's tile holds
    /// real DEM data; the two levels below it are in the overscale band, so
    /// they never fetch a DEM of their own. Returns the leaf's rendered-tile
    /// entity.
    fn band_chain_with_stale_leaf(app: &mut App, source_z: usize) -> Entity {
        chain_with_stale_leaf(app, (4, 4, 3), source_z, 1)
    }

    /// As above for the on-screen tile `leaf` (a descendant of the camera's
    /// tile `(1, 1, 1)`, and the deepest level the terrain goes to), with the
    /// terrain's `max_zoom` spelled out: past it the levels down to the leaf
    /// are in the overscale band.
    fn chain_with_stale_leaf(
        app: &mut App,
        leaf: (usize, usize, usize),
        source_z: usize,
        max_zoom: usize,
    ) -> Entity {
        spawn_raster_dem_terrain_with_band(app, max_zoom, leaf.2);

        let mid = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((1, 1, 1), &new_tile).unwrap()
        };
        seed_real_terrain(app, mid);
        let mid_mesh = spawn_mesh(app, true);
        seed_rendered(app, mid, mid_mesh, true);

        app.insert_resource(TargetHandle(mid));
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });
        app.add_systems(Update, run_terrain_traverse);
        // The traversal owns the nodes it creates, so the leaf's state is
        // written after this first pass.
        app.update();

        let leaf = handle_of(app, leaf);
        let mesh = spawn_mesh(app, true);
        seed_rendered(app, leaf, mesh, true);
        {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            let tile = qt.qt.get_mut(leaf).unwrap();
            tile.upsampled = true;
            tile.upsample_source_z = Some(source_z);
            tile.cached_mesh_handle = Some(mesh_with_heights());
        }
        app.world()
            .resource::<TileCacheManager>()
            .rendered_tile_caches
            .get(&leaf)
            .unwrap()
            .rendered_tile_entity
    }

    fn handle_of(app: &mut App, coords: (usize, usize, usize)) -> TileHandle {
        app.world()
            .resource::<TerrainTileQuadtree>()
            .qt
            .leaf(coords)
            .unwrap()
            .handle()
    }

    /// A raster-DEM terrain whose max zoom (8) bounds runaway subdivision if
    /// the ladder gate regresses: the traversal bails out past it.
    fn spawn_pending_terrain_layer(app: &mut App) {
        spawn_raster_dem_terrain(app, 8);
    }

    /// The traversal-created children of `handle` (empty until it descends).
    fn children_of(app: &App, handle: TileHandle) -> Vec<TileHandle> {
        let qt = app.world().resource::<TerrainTileQuadtree>();
        let c = qt.qt.get(handle).unwrap().coords;
        qt.qt
            .children((c.x, c.y, c.z))
            .map(|cs| cs.iter().map(|c| c.handle()).collect())
            .unwrap_or_default()
    }

    /// Whether the traversal selected `handle` (spawned its rendered tile).
    fn selected(app: &App, handle: TileHandle) -> bool {
        app.world()
            .resource::<TileCacheManager>()
            .rendered_tile_caches
            .contains_key(&handle)
    }

    /// The tile's mesh was built: prepared but still hidden.
    fn land_mesh(app: &mut App, handle: TileHandle) -> Entity {
        let e = spawn_mesh(app, false);
        let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
        let cache = tc.rendered_tile_caches.get_mut(&handle).unwrap();
        cache.mesh_entity = Some(e);
        cache.mesh_prepared = true;
        e
    }

    /// `land_mesh` for a mesh built from the tile's own DEM: it carries
    /// heights, so its descendants can upsample from it.
    fn land_real_mesh(app: &mut App, handle: TileHandle) -> Entity {
        let e = land_mesh(app, handle);
        let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
        qt.qt.get_mut(handle).unwrap().cached_mesh_handle = Some(mesh_with_heights());
        e
    }

    /// Pretend the tile's upsample landed: a prepared (hidden) mesh that
    /// carries heights, so its descendants can upsample from it in turn.
    fn land_upsample(app: &mut App, handle: TileHandle) -> Entity {
        let e = land_real_mesh(app, handle);
        let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
        qt.qt.get_mut(handle).unwrap().upsampled = true;
        e
    }

    /// Give a tile a DEM request in `status`.
    fn seed_dem(
        app: &mut App,
        handle: TileHandle,
        status: navara_data_requester::DataRequesterStatus,
    ) {
        use navara_data_requester::{DataRequester, DataRequesterExtension};
        use navara_tile_component::TerrainDataRequesterMarker;

        let mut requester = DataRequester::new(
            0,
            "https://example.com/0/0/0.png".to_string(),
            DataRequesterExtension::Png,
        );
        requester.status = status;
        let requester = app
            .world_mut()
            .spawn((TerrainDataRequesterMarker(handle), requester))
            .id();

        let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
        let tile = qt.qt.get_mut(handle).unwrap();
        let mut data = RasterDEMData::new(navara_core::ElevationDecoder::default());
        data.data_requester_entity_id = Some(requester);
        tile.terrain_data = Some(Box::new(data));
    }

    /// Give a tile a mesh built from real DEM data: a `Success` requester plus
    /// a cached mesh carrying heights, i.e. a valid upsample source.
    fn seed_real_terrain(app: &mut App, handle: TileHandle) {
        seed_dem(
            app,
            handle,
            navara_data_requester::DataRequesterStatus::Success,
        );
        let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
        qt.qt.get_mut(handle).unwrap().cached_mesh_handle = Some(mesh_with_heights());
    }

    fn terrain_requester_handles(app: &mut App) -> Vec<TileHandle> {
        use navara_tile_component::TerrainDataRequesterMarker;
        let mut q = app.world_mut().query::<(
            &TerrainDataRequesterMarker,
            &navara_data_requester::DataRequester,
        )>();
        q.iter(app.world()).map(|(m, _)| m.0).collect()
    }

    /// A tile covered by its four children, which are built and on screen. It
    /// left the render caches when they took the screen, and its own DEM was
    /// never requested: covered, it is never an SSE leaf or activated.
    /// `max_zoom` 2 puts the children in the overscale band, so the covered
    /// tile is the nearest level that can hold real data for them; a higher
    /// `max_zoom` leaves them fetching DEMs of their own. Returns the covered
    /// tile.
    fn covered_tile(app: &mut App, terrain_type: TerrainDataType, max_zoom: usize) -> TileHandle {
        match terrain_type {
            TerrainDataType::RasterDEM => spawn_raster_dem_terrain_with_band(app, max_zoom, 3),
            TerrainDataType::QuantizedMesh => {
                spawn_quantized_mesh_terrain_with_band(app, max_zoom, 3)
            }
            _ => unreachable!(),
        }

        let mid = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((1, 1, 1), &new_tile).unwrap()
        };
        // The camera's tile carries real terrain: the children's upsample source.
        seed_real_terrain(app, mid);
        let mid_mesh = spawn_mesh(app, true);
        seed_rendered(app, mid, mid_mesh, true);

        app.insert_resource(TargetHandle(mid));
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });
        app.add_systems(Update, run_terrain_traverse);
        app.update();

        let covered = handle_of(app, (2, 2, 2));
        for coords in [(4, 4, 3), (5, 4, 3), (4, 5, 3), (5, 5, 3)] {
            let child = handle_of(app, coords);
            let mesh = spawn_mesh(app, true);
            seed_rendered(app, child, mesh, true);
            let e = land_upsample(app, child);
            app.world_mut().get_mut::<Mesh>(e).unwrap().active = true;
        }
        app.world_mut()
            .resource_mut::<TileCacheManager>()
            .rendered_tile_caches
            .remove(&covered);
        assert!(
            !terrain_requester_handles(app).contains(&covered),
            "precondition: the covered tile's DEM was never requested"
        );
        covered
    }

    /// Overscale-band children never fetch a DEM, so the tile they cover is
    /// the nearest level that can hold real data for them: its DEM is fetched
    /// though nothing shows the tile. A raster-DEM upsample resamples that DEM
    /// once it lands, so the tile itself is not built.
    #[test]
    fn traverse_terrain_fetches_the_dem_of_a_covered_band_anchor() {
        let (mut app, _root) = terrain_app_with_root();
        let anchor = covered_tile(&mut app, TerrainDataType::RasterDEM, 2);

        app.update();

        assert!(terrain_requester_handles(&mut app).contains(&anchor));
        assert!(!selected(&app, anchor));
    }

    /// Children whose DEM requests failed never hold real data either (a
    /// failed request is never retried), so the tile they cover is fetched
    /// just as above the overscale band — wherever real data happens to end.
    #[test]
    fn traverse_terrain_fetches_the_dem_of_a_tile_covered_by_failed_children() {
        let (mut app, _root) = terrain_app_with_root();
        // Fetchable far past these levels.
        let covered = covered_tile(&mut app, TerrainDataType::RasterDEM, 8);
        for coords in [(4, 4, 3), (5, 4, 3), (4, 5, 3), (5, 5, 3)] {
            let child = handle_of(&mut app, coords);
            seed_dem(
                &mut app,
                child,
                navara_data_requester::DataRequesterStatus::Fail,
            );
        }

        app.update();

        assert!(terrain_requester_handles(&mut app).contains(&covered));
    }

    /// A covered tile whose children get DEMs of their own is left alone:
    /// nothing needs its data.
    #[test]
    fn traverse_terrain_leaves_a_covered_tile_above_the_band_alone() {
        let (mut app, _root) = terrain_app_with_root();
        let covered = covered_tile(&mut app, TerrainDataType::RasterDEM, 8);

        app.update();

        assert!(!terrain_requester_handles(&mut app).contains(&covered));
        assert!(!selected(&app, covered));
    }

    /// A quantized-mesh upsample clips the source's mesh, so once the covered
    /// anchor's data lands it is selected — hidden under its children — for
    /// `transfer_mesh` to build that mesh.
    #[test]
    fn traverse_terrain_selects_a_covered_quantized_mesh_anchor_once_its_data_lands() {
        let (mut app, _root) = terrain_app_with_root();
        let anchor = covered_tile(&mut app, TerrainDataType::QuantizedMesh, 2);
        seed_dem(
            &mut app,
            anchor,
            navara_data_requester::DataRequesterStatus::Success,
        );

        app.update();

        assert!(selected(&app, anchor));
    }

    /// The raster-DEM counterpart: the landed DEM is all its children need,
    /// so the anchor stays unbuilt.
    #[test]
    fn traverse_terrain_leaves_a_landed_raster_dem_anchor_unbuilt() {
        let (mut app, _root) = terrain_app_with_root();
        let anchor = covered_tile(&mut app, TerrainDataType::RasterDEM, 2);
        seed_dem(
            &mut app,
            anchor,
            navara_data_requester::DataRequesterStatus::Success,
        );

        app.update();

        assert!(!selected(&app, anchor));
    }

    /// Whether the traversal flagged the rendered tile `entity` for a rebuild.
    fn flagged(app: &App, entity: Entity) -> bool {
        app.world().get::<RemeshPending>(entity).is_some()
    }

    /// An overscale-band tile never fetches a DEM of its own, so the mesh it
    /// first upsampled from is all it will ever show. Once a nearer real-data
    /// ancestor is on the path, the traversal flags the tile so
    /// `transfer_mesh` rebuilds it from that one.
    #[test]
    fn traverse_terrain_flags_a_stale_band_upsample() {
        let (mut app, _root) = terrain_app_with_root();
        // The leaf shows a clip of the root: three levels up, past the bound.
        let rendered_tile_entity = band_chain_with_stale_leaf(&mut app, 0);

        app.update();

        assert!(flagged(&app, rendered_tile_entity));
    }

    /// A tile nothing shows is not flagged: rebuilding it spends a worker task
    /// on a mesh no one looks at. It is flagged once it is on screen again.
    #[test]
    fn traverse_terrain_leaves_a_hidden_stale_upsample_alone() {
        let (mut app, _root) = terrain_app_with_root();
        let rendered_tile_entity = band_chain_with_stale_leaf(&mut app, 0);
        let leaf = handle_of(&mut app, (4, 4, 3));
        let mesh = app
            .world()
            .resource::<TileCacheManager>()
            .rendered_tile_caches
            .get(&leaf)
            .unwrap()
            .mesh_entity
            .unwrap();
        app.world_mut().get_mut::<Mesh>(mesh).unwrap().active = false;

        app.update();

        assert!(!flagged(&app, rendered_tile_entity));
    }

    /// A band tile already within the bound still takes a nearer source: it
    /// never fetches a DEM of its own, so that level would separate its
    /// surface from the real one for as long as it lives.
    #[test]
    fn traverse_terrain_flags_a_band_upsample_within_the_bound_for_a_nearer_source() {
        let (mut app, _root) = terrain_app_with_root();
        // Clipped from z1, two levels up; z2 is the deepest real level.
        let rendered_tile_entity = chain_with_stale_leaf(&mut app, (4, 4, 3), 1, 2);
        let deepest = handle_of(&mut app, (2, 2, 2));
        seed_real_terrain(&mut app, deepest);

        app.update();

        assert!(flagged(&app, rendered_tile_entity));
    }

    /// One level nearer, out of bound either way, is a rebuild only when it is
    /// the last source the tile will ever get: every tile between them is in
    /// the overscale band, or its DEM request failed.
    #[test]
    fn traverse_terrain_flags_a_one_level_improvement_only_when_it_is_final() {
        use navara_data_requester::DataRequesterStatus;

        // The leaf (z4) is clipped from the root; the nearest real level is
        // z1, three levels up from it and one below its source.
        let leaf = (8, 8, 4);
        let path = [(2, 2, 2), (4, 4, 3)];

        // Below max_zoom 1 the levels in between are all in the band.
        let (mut app, _root) = terrain_app_with_root();
        let rendered_tile_entity = chain_with_stale_leaf(&mut app, leaf, 0, 1);
        app.update();
        assert!(flagged(&app, rendered_tile_entity), "band in between");

        // With max_zoom 3 they can still fetch real data of their own...
        let (mut app, _root) = terrain_app_with_root();
        let rendered_tile_entity = chain_with_stale_leaf(&mut app, leaf, 0, 3);
        app.update();
        assert!(
            !flagged(&app, rendered_tile_entity),
            "real data may still land in between"
        );

        // ...unless their requests failed.
        let (mut app, _root) = terrain_app_with_root();
        let rendered_tile_entity = chain_with_stale_leaf(&mut app, leaf, 0, 3);
        for coords in path {
            let handle = handle_of(&mut app, coords);
            seed_dem(&mut app, handle, DataRequesterStatus::Fail);
        }
        app.update();
        assert!(flagged(&app, rendered_tile_entity), "failed in between");
    }

    /// A tile the depth bound still applies to is never flagged, however far
    /// its source is: its own DEM is on the way and replaces the mesh
    /// outright, and a rebuild would spend a worker task on a surface that
    /// is about to be thrown away.
    #[test]
    fn traverse_terrain_leaves_a_bounded_stale_upsample_to_its_own_dem() {
        let (mut app, _root) = terrain_app_with_root();
        // Fetchable down to the leaf: its own DEM is still coming.
        let rendered_tile_entity = chain_with_stale_leaf(&mut app, (4, 4, 3), 0, 3);

        app.update();

        assert!(!flagged(&app, rendered_tile_entity));
    }

    /// A band tile already clipped from the nearest real level is left alone:
    /// there is nothing better to rebuild it from.
    #[test]
    fn traverse_terrain_leaves_a_band_upsample_on_the_best_source_alone() {
        let (mut app, _root) = terrain_app_with_root();
        // The leaf is clipped from the deepest real level there is.
        let rendered_tile_entity = band_chain_with_stale_leaf(&mut app, 1);

        app.update();

        assert!(!flagged(&app, rendered_tile_entity));
    }

    /// Upsample-first: children of a tile with real terrain render upsampled
    /// right away. A child that is on screen only because its own children
    /// cannot render (z2 is over max zoom here) — not because it meets SSE —
    /// does NOT fetch its own DEM until it is actually on screen; then the
    /// deferred fetch is issued. (The SSE leaf fetches at once, see
    /// `traverse_terrain_sse_leaf_fetches_dem_while_still_upsampling`.)
    #[test]
    fn traverse_terrain_defers_dem_fetch_of_a_non_sse_leaf_until_it_is_on_screen() {
        let (mut app, root) = terrain_app_with_root();
        app.insert_resource(TargetHandle(root));
        // z=2 is beyond the overscaled max zoom, so the z=1 tiles are the
        // leaves and still fetchable — not in the overscale band.
        spawn_raster_dem_terrain(&mut app, 1);
        seed_real_terrain(&mut app, root);
        let root_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, root, root_mesh, true);
        // Zero threshold: the root subdivides into its z=1 children.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        // --- Phase A: children selected, upsampled from the root, no fetch ---
        let children: Vec<TileHandle> = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            let tc = app.world().resource::<TileCacheManager>();
            qt.qt
                .children((0, 0, 0))
                .unwrap()
                .iter()
                .map(|c| c.handle())
                .filter(|h| tc.rendered_tile_caches.contains_key(h))
                .collect()
        };
        assert!(
            !children.is_empty(),
            "children upsampled from the root are renderable and get selected"
        );
        {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            for &child in &children {
                let tile = qt.qt.get(child).unwrap();
                assert_eq!(
                    tile.find_upsample_source(qt, |_| false, false, true),
                    Some(root)
                );
                assert!(
                    tile.terrain_data.is_none(),
                    "the traversal allocates no terrain data; the upsample task does"
                );
            }
        }
        let requested = terrain_requester_handles(&mut app);
        assert_eq!(
            requested,
            vec![root],
            "only the root's (pre-seeded) requester exists: children defer the fetch"
        );

        // --- Phase B: the upsampled children are on screen and still the leaves ---
        for &child in &children {
            let e = land_upsample(&mut app, child);
            app.world_mut().get_mut::<Mesh>(e).unwrap().active = true;
        }
        app.update();

        let requested = terrain_requester_handles(&mut app);
        for &child in &children {
            assert!(
                requested.contains(&child),
                "an activated upsampled leaf fetches its own DEM"
            );
        }
    }

    /// The SSE leaf does not wait to be activated before fetching its own
    /// DEM: the fetch goes out in the traversal that selects it, in parallel
    /// with its upsample, so the real mesh replaces the stand-in as early as
    /// possible. Levels that do not meet SSE still fetch nothing.
    #[test]
    fn traverse_terrain_sse_leaf_fetches_dem_while_still_upsampling() {
        let (mut app, root) = terrain_app_with_root();
        app.insert_resource(TargetHandle(root));
        // The z=1 tiles are the deepest fetchable level and all four straddle
        // the horizon, so none is prefetched as occluded.
        spawn_raster_dem_terrain(&mut app, 1);
        seed_real_terrain(&mut app, root);
        let root_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, root, root_mesh, true);
        // Zero threshold first: nothing meets SSE, the root subdivides and
        // its z=1 children are selected as upsampled (non-SSE) tiles.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        let children: Vec<TileHandle> = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            let tc = app.world().resource::<TileCacheManager>();
            qt.qt
                .children((0, 0, 0))
                .unwrap()
                .iter()
                .map(|c| c.handle())
                .filter(|h| tc.rendered_tile_caches.contains_key(h))
                .collect()
        };
        assert!(!children.is_empty(), "upsampled children are selected");
        assert_eq!(
            terrain_requester_handles(&mut app),
            vec![root],
            "levels that do not meet SSE fetch nothing while upsampling"
        );

        // Raise the threshold so the z=1 children meet SSE but the root does
        // not: the children become the SSE leaves.
        let (root_sse, children_sse) = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            let root_sse = qt.qt.get(root).unwrap().sse;
            let children_sse = children
                .iter()
                .map(|h| qt.qt.get(*h).unwrap().sse)
                .fold(0.0_f64, f64::max);
            (root_sse, children_sse)
        };
        assert!(
            root_sse > children_sse,
            "the root's SSE ({root_sse}) must exceed its children's ({children_sse})"
        );
        app.insert_resource(TraverseConfig {
            max_sse: children_sse,
            fov: 60.0,
        });
        app.update();

        // Nothing has activated the children between the two traversals (no
        // mesh system runs here, so they are as un-activated as in the first
        // update, where they fetched nothing): the only difference is that
        // they now meet SSE.
        let requested = terrain_requester_handles(&mut app);
        for &child in &children {
            assert!(
                requested.contains(&child),
                "an SSE leaf fetches its own DEM before it is activated"
            );
        }
    }

    /// A child's subtree must not take over the screen while its parent's
    /// swap group is still incomplete. With terrain, grandchildren are
    /// spawned in the same traversal as their parents (any ancestor mesh
    /// with real heights is an upsample source) and can be prepared before
    /// their uncles; activating them while the grandparent is still shown
    /// draws both surfaces at once (z-fighting parent flicker).
    #[test]
    fn traverse_terrain_holds_grandchildren_until_parent_group_is_prepared() {
        let (mut app, _root) = terrain_app_with_root();
        // (8, 8, 4) sits just south-east of (lng 0, lat 0): the whole subtree is
        // in view and inside the horizon.
        let target = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((8, 8, 4), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(target));
        // z=5 children, z=6 grandchildren (the leaves), z=7 over max.
        spawn_raster_dem_terrain(&mut app, 6);
        seed_real_terrain(&mut app, target);
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        let target_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, target, target_mesh, true);

        /// The tile's own DEM fetch resolved: a `Success` requester, no mesh yet.
        fn land_dem(app: &mut App, handle: TileHandle) {
            use navara_data_requester::{DataRequester, DataRequesterExtension};
            use navara_tile_component::TerrainDataRequesterMarker;

            let mut requester = DataRequester::new(
                0,
                "https://example.com/0/0/0.png".to_string(),
                DataRequesterExtension::Png,
            );
            requester.status = navara_data_requester::DataRequesterStatus::Success;
            let requester = app
                .world_mut()
                .spawn((TerrainDataRequesterMarker(handle), requester))
                .id();
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            let tile = qt.qt.get_mut(handle).unwrap();
            let mut data = RasterDEMData::new(navara_core::ElevationDecoder::default());
            data.data_requester_entity_id = Some(requester);
            tile.terrain_data = Some(Box::new(data));
        }

        app.add_systems(Update, run_terrain_traverse);

        // --- Phase A: children and grandchildren selected in one traversal ---
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "rendered");
        let children = children_of(&app, target);
        assert_eq!(children.len(), 4);
        for &c in &children {
            assert!(selected(&app, c));
            for g in children_of(&app, c) {
                assert!(
                    selected(&app, g),
                    "a grandchild upsamples from the target and is spawned at once"
                );
            }
        }
        let first_child = children[0];
        let grandchildren = children_of(&app, first_child);
        assert_eq!(grandchildren.len(), 4);

        // --- The first child's grandchildren get their own DEM first ---
        for &g in &grandchildren {
            land_dem(&mut app, g);
        }
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "rendered");

        // --- Only those grandchildren finish (nearest first) ---
        let grandchild_meshes: Vec<Entity> = grandchildren
            .iter()
            .map(|&g| land_real_mesh(&mut app, g))
            .collect();

        // --- Phase B: the other three children are still unprepared ---
        app.update();
        assert_eq!(
            app.world().resource::<LastResult>().0,
            "rendered",
            "the target keeps covering its region while its group loads"
        );
        assert!(mesh_active(&app, target_mesh), "target stays on screen");
        for &e in &grandchild_meshes {
            assert!(
                !mesh_active(&app, e),
                "grandchildren must stay hidden while the target is on screen"
            );
        }

        // --- Phase C: the rest of the group finishes → one swap, top down ---
        let sibling_meshes: Vec<Entity> = children[1..]
            .iter()
            .map(|&c| land_real_mesh(&mut app, c))
            .collect();
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "children_prepared");
        assert!(!mesh_active(&app, target_mesh), "target hands off");
        for e in grandchild_meshes {
            assert!(mesh_active(&app, e), "the finished subtree shows");
        }
        for e in sibling_meshes {
            assert!(mesh_active(&app, e), "the siblings show");
        }
    }

    /// With a terrain layer, every level below a shown tile with real
    /// terrain is spawned in the same traversal: a child needs an ancestor
    /// mesh with real heights to upsample from, not its parent's mesh. The
    /// swap still happens group by group, top down, as each group of four
    /// is prepared, and the upsample *source* of every level is the nearest
    /// real-data ancestor.
    #[test]
    fn traverse_terrain_with_terrain_spawns_every_level_under_a_ready_ancestor() {
        let (mut app, _root) = terrain_app_with_root();
        // (8, 8, 4) sits just south-east of (lng 0, lat 0): the whole subtree is
        // in view and inside the horizon, so nothing below it is culled.
        let root = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((8, 8, 4), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(root));
        // z=7 tiles are the leaves (fetchable); z=8 is over max.
        spawn_raster_dem_terrain(&mut app, 7);
        seed_real_terrain(&mut app, root);
        let root_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, root, root_mesh, true);
        // Zero threshold: every tile subdivides down to the z=7 leaves.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);

        // --- Phase A: one traversal selects z5, z6 and z7 alike ---
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "rendered");
        let z5 = children_of(&app, root);
        let z6: Vec<TileHandle> = z5.iter().flat_map(|&c| children_of(&app, c)).collect();
        let z7: Vec<TileHandle> = z6.iter().flat_map(|&c| children_of(&app, c)).collect();
        assert_eq!((z5.len(), z6.len(), z7.len()), (4, 16, 64));
        {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            for &h in z5.iter().chain(&z6) {
                assert!(
                    selected(&app, h),
                    "every level under the shown target is spawned at once"
                );
                assert_eq!(
                    qt.qt
                        .get(h)
                        .unwrap()
                        .find_upsample_source(qt, |_| false, false, true),
                    Some(root),
                    "each level upsamples from the real target, not an upsampled parent"
                );
            }
        }

        // --- Phase B: the z5 group lands → the target hands off to it ---
        let z5_meshes: Vec<Entity> = z5.iter().map(|&c| land_upsample(&mut app, c)).collect();
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "children_prepared");
        assert!(!mesh_active(&app, root_mesh), "target hands off");
        for &e in &z5_meshes {
            assert!(
                mesh_active(&app, e),
                "the z5 group shows as soon as it is prepared"
            );
        }

        // --- Phase C: only the first z5's four z6 land → that subtree advances ---
        let first_z6 = children_of(&app, z5[0]);
        let z6_meshes: Vec<Entity> = first_z6
            .iter()
            .map(|&g| land_upsample(&mut app, g))
            .collect();
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "children_prepared");
        assert!(
            !mesh_active(&app, z5_meshes[0]),
            "the finished z5 hands off to its z6"
        );
        for &e in &z6_meshes {
            assert!(mesh_active(&app, e), "its z6 group shows");
        }
        for &e in &z5_meshes[1..] {
            assert!(mesh_active(&app, e), "the other z5 stay on screen");
        }
    }

    /// The upsample source is bounded (`MAX_UPSAMPLE_DEPTH`): under a shown
    /// target with real terrain, the levels within the bound upsample from it,
    /// but the first level past it is neither renderable nor spawned. The
    /// ladder then takes over below it: that level and the ones beneath form
    /// the not-yet-renderable chain, whose real DEMs are requested down to
    /// the rung, instead of the whole subtree being built from the target's
    /// mesh. Every level here is derived from the two constants.
    #[test]
    fn traverse_terrain_bounds_the_upsample_depth() {
        use navara_tile_component::MAX_UPSAMPLE_DEPTH;

        const ROOT_Z: usize = 4;
        // The deepest level that may still upsample from the target.
        let last_in_bound = ROOT_Z + MAX_UPSAMPLE_DEPTH;
        // The first level past the bound: not renderable, top of the chain.
        let first_out_of_bound = last_in_bound + 1;
        // The chain's last level, where the ladder requests a real DEM.
        let rung = first_out_of_bound + MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR as usize - 1;

        let (mut app, _root) = terrain_app_with_root();
        // (8, 8, 4) sits just south-east of (lng 0, lat 0): the whole subtree
        // is in view and inside the horizon, so nothing below it is culled or
        // prefetched as occluded.
        let root = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((8, 8, ROOT_Z), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(root));
        // Every level down past the rung is fetchable: nothing sits in the
        // overscale band, so the bound applies everywhere below the target.
        spawn_raster_dem_terrain(&mut app, rung + 2);
        seed_real_terrain(&mut app, root);
        let root_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, root, root_mesh, true);
        // Zero threshold: every tile subdivides as deep as the source allows.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        let requested = terrain_requester_handles(&mut app);
        let qt = app.world().resource::<TerrainTileQuadtree>();
        let tc = app.world().resource::<TileCacheManager>();
        let level_of = |h: &TileHandle| qt.qt.get(*h).unwrap().coords.z;

        let mut spawned_levels: Vec<usize> = tc.rendered_tile_caches.keys().map(level_of).collect();
        spawned_levels.sort_unstable();
        spawned_levels.dedup();
        assert_eq!(
            spawned_levels,
            (ROOT_Z..=last_in_bound).collect::<Vec<_>>(),
            "only levels within MAX_UPSAMPLE_DEPTH of the real target are spawned"
        );
        for handle in tc.rendered_tile_caches.keys() {
            if *handle == root {
                continue;
            }
            assert_eq!(
                qt.qt
                    .get(*handle)
                    .unwrap()
                    .find_upsample_source(qt, |_| false, false, true),
                Some(root),
                "spawned levels upsample from the real target"
            );
        }

        // The target's north-west-most descendant at the first level past
        // the bound.
        let shift = first_out_of_bound - ROOT_Z;
        let out_of_bound = qt
            .qt
            .ancestor(
                (8 << shift, 8 << shift, first_out_of_bound),
                first_out_of_bound,
            )
            .expect("the traversal reached the first level past the bound")
            .handle();
        let out_of_bound_tile = qt.qt.get(out_of_bound).unwrap();
        assert_eq!(
            out_of_bound_tile.find_upsample_source(qt, |_| false, false, true),
            None,
            "one level past the bound has no source while bounded"
        );
        assert_eq!(
            out_of_bound_tile.find_upsample_source(qt, |_| false, false, false),
            Some(root),
            "the same ancestor serves once the bound is lifted"
        );

        let mut requested_levels: Vec<usize> = requested
            .iter()
            .filter(|h| **h != root)
            .map(level_of)
            .collect();
        requested_levels.sort_unstable();
        requested_levels.dedup();
        assert_eq!(
            requested_levels,
            (first_out_of_bound..=rung).collect::<Vec<_>>(),
            "real DEMs are fetched for the unrenderable chain down to the ladder rung, \
             not for the upsampled levels above it nor for anything deeper"
        );
    }

    /// Zoom-out: when an ancestor takes over from its shown descendants, every
    /// one of them is hidden in the same frame the ancestor comes on screen —
    /// including grandchildren the traversal no longer visits. Leaving them
    /// on screen for even a frame draws both surfaces at once (z-fighting).
    #[test]
    fn traverse_terrain_hides_shown_descendants_when_ancestor_takes_over() {
        let (mut app, _root) = terrain_app_with_root();
        let target = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((8, 8, 4), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(target));
        // z=5 children, z=6 grandchildren (the leaves), z=7 over max.
        spawn_layer(&mut app, raster_layer("a", 0, 6), Order(0));
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });
        let target_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, target, target_mesh, true);

        app.add_systems(Update, run_terrain_traverse);

        // Subdivide: the children take over, then the first child's
        // grandchildren take over from it.
        app.update();
        let children = children_of(&app, target);
        let child_meshes: Vec<Entity> = children.iter().map(|&c| land_mesh(&mut app, c)).collect();
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "children_prepared");
        let grandchildren = children_of(&app, children[0]);
        let grandchild_meshes: Vec<Entity> = grandchildren
            .iter()
            .map(|&g| land_mesh(&mut app, g))
            .collect();
        app.update();
        assert!(!mesh_active(&app, target_mesh));
        assert!(
            !mesh_active(&app, child_meshes[0]),
            "the first child handed off"
        );
        for &e in &grandchild_meshes {
            assert!(mesh_active(&app, e));
        }
        for &e in &child_meshes[1..] {
            assert!(mesh_active(&app, e));
        }

        // Zoom out: the target meets SSE again and is prepared, so it comes
        // back on screen — and nothing below it may stay visible.
        app.insert_resource(TraverseConfig {
            max_sse: 1e30,
            fov: 60.0,
        });
        app.update();
        assert_eq!(app.world().resource::<LastResult>().0, "rendered");
        assert!(mesh_active(&app, target_mesh), "the target takes over");
        for &e in &child_meshes {
            assert!(!mesh_active(&app, e), "children hidden in the same frame");
        }
        for &e in &grandchild_meshes {
            assert!(
                !mesh_active(&app, e),
                "unvisited grandchildren hidden in the same frame"
            );
        }
    }

    /// Zoom-out onto an ancestor that is not renderable yet (upsampled, no
    /// own DEM, children on screen — the zoom-out hold in `is_ready`): its
    /// shown descendants must stay on screen as cover. Reporting `NotFound`
    /// would let the next renderable ancestor take over and replace fine
    /// terrain with a far coarser mesh.
    #[test]
    fn traverse_terrain_keeps_shown_children_while_unrenderable_parent_waits_for_dem() {
        let (mut app, _root) = terrain_app_with_root();
        let target = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((8, 8, 4), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(target));
        spawn_raster_dem_terrain(&mut app, 8);
        seed_real_terrain(&mut app, target);
        let target_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, target, target_mesh, true);
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);

        // Zoom in: z5 upsampled group takes over, then the first z5's z6 group.
        app.update();
        let z5 = children_of(&app, target);
        let z5_meshes: Vec<Entity> = z5.iter().map(|&c| land_upsample(&mut app, c)).collect();
        app.update();
        let z6 = children_of(&app, z5[0]);
        let z6_meshes: Vec<Entity> = z6.iter().map(|&g| land_upsample(&mut app, g)).collect();
        app.update();
        // One settled frame so the z5 records that its children are on screen.
        app.update();
        assert!(!mesh_active(&app, target_mesh));
        assert!(!mesh_active(&app, z5_meshes[0]));
        for &e in &z6_meshes {
            assert!(mesh_active(&app, e));
        }

        // Zoom out to where z5 meets SSE but z4 does not.
        let (sse4, sse5) = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            (
                qt.qt.get(target).unwrap().sse,
                qt.qt.get(z5[0]).unwrap().sse,
            )
        };
        assert!(sse5 < sse4);
        app.insert_resource(TraverseConfig {
            max_sse: (sse4 + sse5) / 2.,
            fov: 60.0,
        });
        app.update();

        // The first z5 has no DEM of its own and its children are on screen,
        // so it is not renderable yet: its z6 keep covering it, and the target
        // must not take over from them.
        assert_eq!(app.world().resource::<LastResult>().0, "children_prepared");
        assert!(
            !mesh_active(&app, target_mesh),
            "coarse target stays hidden"
        );
        assert!(
            !mesh_active(&app, z5_meshes[0]),
            "the waiting z5 stays hidden"
        );
        for &e in &z6_meshes {
            assert!(mesh_active(&app, e), "its shown z6 stay on screen");
        }
        for &e in &z5_meshes[1..] {
            assert!(mesh_active(&app, e), "the other z5 keep showing");
        }
    }

    /// A group that is already on screen must not collapse back to its parent
    /// because one member only now came into view without a prepared mesh
    /// (revealed past the horizon, never spawned): that member stays hidden
    /// until it is prepared, the shown siblings keep the screen, and the
    /// parent fills just that member's quadrant so there is no hole.
    #[test]
    fn traverse_terrain_holds_shown_group_when_a_revealed_member_is_unprepared() {
        let (mut app, _root) = terrain_app_with_root();
        let target = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((8, 8, 4), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(target));
        // z=5 children are the leaves, z=6 over max.
        spawn_layer(&mut app, raster_layer("a", 0, 5), Order(0));
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });
        let target_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, target, target_mesh, true);

        app.add_systems(Update, run_terrain_traverse);

        // The group takes over and settles on screen.
        app.update();
        let children = children_of(&app, target);
        let child_meshes: Vec<Entity> = children.iter().map(|&c| land_mesh(&mut app, c)).collect();
        app.update();
        app.update();
        assert!(!mesh_active(&app, target_mesh));
        for &e in &child_meshes {
            assert!(mesh_active(&app, e));
        }

        // The last child is "revealed" without ever having been spawned: no
        // render cache, no mesh.
        {
            let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
            tc.rendered_tile_caches.remove(&children[3]);
            tc.requested_tile_caches.remove(&children[3]);
        }
        app.world_mut().despawn(child_meshes[3]);
        app.update();

        assert_eq!(app.world().resource::<LastResult>().0, "children_prepared");
        {
            let mesh = app.world().get::<Mesh>(target_mesh).unwrap();
            assert!(
                mesh.active && mesh.fill_quadrants == 1 << 3,
                "the parent fills only the revealed member's quadrant: active={} fill={:#b}",
                mesh.active,
                mesh.fill_quadrants
            );
        }
        for &e in &child_meshes[..3] {
            assert!(mesh_active(&app, e), "the shown siblings keep the screen");
        }
        assert!(
            app.world()
                .resource::<TileCacheManager>()
                .rendered_tile_caches
                .contains_key(&children[3]),
            "the revealed member is spawned so it can be prepared"
        );
    }

    /// A parent that filled a held member's quadrant and now takes over its
    /// whole region (its DEM landed) must hide the shown descendants in the
    /// same frame, exactly like a hidden parent coming on screen.
    #[test]
    fn show_tile_over_descendants_hides_them_when_leaving_fill_mode() {
        let (mut app, root) = terrain_app_with_root();
        let children = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            TerrainTile::traversable_children(&mut qt, root).unwrap()
        };
        let root_mesh = spawn_mesh(&mut app, true);
        seed_rendered(&mut app, root, root_mesh, true);
        let child_meshes: Vec<Entity> = children
            .iter()
            .map(|&c| {
                let e = spawn_mesh(&mut app, true);
                seed_rendered(&mut app, c, e, true);
                e
            })
            .collect();

        fn fill_then_show(
            qt: Res<TerrainTileQuadtree>,
            tc: Res<TileCacheManager>,
            mut meshes: Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
            target: Res<TargetHandle>,
        ) {
            tc.fill_rendered_tile(&target.0, &mut meshes, 1 << 3);
            show_tile_over_descendants(&qt, &tc, &mut meshes, target.0);
        }
        app.insert_resource(TargetHandle(root));
        app.add_systems(Update, fill_then_show);
        app.update();

        let mesh = app.world().get::<Mesh>(root_mesh).unwrap();
        assert!(
            mesh.active && mesh.fill_quadrants == 0,
            "the parent shows in full"
        );
        for &e in &child_meshes {
            assert!(
                !mesh_active(&app, e),
                "the descendants are hidden in the same frame"
            );
        }
    }

    fn deepest_initialized_level(app: &App) -> usize {
        let qt = app.world().resource::<TerrainTileQuadtree>();
        (0..=8usize)
            .filter(|&z| {
                let n = 1usize << z;
                (0..n).any(|x| (0..n).any(|y| qt.qt.leaf((x, y, z)).is_some()))
            })
            .max()
            .unwrap()
    }

    /// With nothing loaded, the traversal must not descend past
    /// `MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR` unrenderable levels: it
    /// requests that ladder rung and waits, so every deeper region always has
    /// a nearby loaded ancestor as fallback cover. The frontier advances only
    /// as levels finish loading.
    #[test]
    fn traverse_terrain_bounds_descent_below_renderable_ancestor() {
        let (mut app, root) = terrain_app_with_root();
        app.insert_resource(TargetHandle(root));
        spawn_pending_terrain_layer(&mut app);
        // Zero threshold: every tile subdivides toward deeper levels.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);
        app.update();
        app.update();

        // The chain z0..z2 is unrenderable and z2 hits the bound: z2 exists
        // (created while z1 descended) but z3 was never initialized.
        let gated = MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR as usize - 1;
        assert_eq!(
            deepest_initialized_level(&app),
            gated,
            "descent must stop at the ladder bound while nothing is loaded"
        );
        assert_eq!(
            app.world().resource::<LastResult>().0,
            "notfound",
            "nothing is renderable yet"
        );

        // The gated rung (and the levels above it) were still requested.
        let tc = app.world().resource::<TileCacheManager>();
        assert!(tc.requested_tile_caches.contains(&root));

        // --- All pending fetches resolve → the frontier advances ---
        let pending: Vec<Entity> = {
            let mut q = app
                .world_mut()
                .query::<(Entity, &navara_data_requester::DataRequester)>();
            q.iter(app.world()).map(|(e, _)| e).collect()
        };
        assert!(!pending.is_empty(), "the ladder rungs were requested");
        for e in pending {
            app.world_mut()
                .get_mut::<navara_data_requester::DataRequester>(e)
                .unwrap()
                .status = navara_data_requester::DataRequesterStatus::Success;
        }

        app.update();

        // z0..z2 are now renderable, and z2's landed DEM is an upsample source
        // for the levels within the bound below it. The traversal descends
        // past them and creates the next rungs, but is gated again before
        // creating the level after those.
        use navara_tile_component::MAX_UPSAMPLE_DEPTH;
        assert_eq!(
            deepest_initialized_level(&app),
            gated + MAX_UPSAMPLE_DEPTH + MAX_LEVELS_WITHOUT_RENDERABLE_ANCESTOR as usize,
            "the frontier advances by the ladder stride once a rung loads"
        );
    }

    /// A horizon-occluded tile is not rendered or descended, but its terrain
    /// data must still be prefetched: zooming out reveals the area beyond the
    /// old horizon at once, and prefetched tiles are the only nearby cover
    /// that prevents a many-levels-up ancestor from flashing.
    #[test]
    fn traverse_terrain_prefetches_occluded_tile_data() {
        let (mut app, _root) = terrain_app_with_root();
        spawn_pending_terrain_layer(&mut app);

        // A tile on the far side of the globe (same setup as
        // `traverse_terrain_culls_occluded_tile`), so it is horizon-occluded.
        let occluded = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((7, 4, 3), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(occluded));

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        assert_eq!(app.world().resource::<LastResult>().0, "culled");

        // The occluded tile's DEM was requested even though it is not shown.
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(
            qt.qt
                .get(occluded)
                .unwrap()
                .terrain_data
                .as_ref()
                .is_some_and(|t| t.data_requester_entity_id().is_some()),
            "occluded tile must hold a terrain data request"
        );
        let tc = app.world().resource::<TileCacheManager>();
        assert!(tc.requested_tile_caches.contains(&occluded));
        assert!(
            !tc.rendered_tile_caches.contains_key(&occluded),
            "no mesh is prepared while the DEM is still pending"
        );

        // --- The DEM lands → the tile is spawned (inactive) so its mesh is
        // built ahead of time; a later reveal can fall back to it instead of
        // climbing to a huge low-zoom ancestor.
        let requester = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            qt.qt
                .get(occluded)
                .unwrap()
                .terrain_data
                .as_ref()
                .and_then(|t| t.data_requester_entity_id())
                .unwrap()
        };
        app.world_mut()
            .get_mut::<navara_data_requester::DataRequester>(requester)
            .unwrap()
            .status = navara_data_requester::DataRequesterStatus::Success;

        app.update();

        let tc = app.world().resource::<TileCacheManager>();
        assert!(
            tc.rendered_tile_caches.contains_key(&occluded),
            "a loaded occluded tile prepares its mesh while staying culled"
        );
    }

    /// An occluded tile that could only be upsampled is not spawned: meshing
    /// it hidden would cost an upsample task now and a construct task when
    /// its Low-priority DEM lands. It is spawned once its own DEM is there.
    #[test]
    fn traverse_terrain_does_not_prefetch_an_upsample_for_an_occluded_tile() {
        let (mut app, root) = terrain_app_with_root();
        spawn_pending_terrain_layer(&mut app);
        seed_real_terrain(&mut app, root);

        let occluded = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((7, 4, 3), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(occluded));

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        assert_eq!(app.world().resource::<LastResult>().0, "culled");
        let requester = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            let tile = qt.qt.get(occluded).unwrap();
            assert!(
                tile.find_upsample_source(qt, |_| false, false, false)
                    .is_some(),
                "precondition: the occluded tile is upsamplable from the root"
            );
            tile.terrain_data
                .as_ref()
                .and_then(|t| t.data_requester_entity_id())
                .expect("the occluded tile's DEM is requested")
        };
        let tc = app.world().resource::<TileCacheManager>();
        assert!(
            !tc.rendered_tile_caches.contains_key(&occluded),
            "an upsamplable occluded tile is not meshed while its DEM is pending"
        );

        app.world_mut()
            .get_mut::<navara_data_requester::DataRequester>(requester)
            .unwrap()
            .status = navara_data_requester::DataRequesterStatus::Success;
        app.update();

        let tc = app.world().resource::<TileCacheManager>();
        assert!(
            tc.rendered_tile_caches.contains_key(&occluded),
            "the occluded tile is meshed once its own DEM landed"
        );
    }

    /// An occluded tile whose own DEM request failed is never going to get a
    /// DEM, so the double-construct argument does not apply: it is meshed
    /// while hidden by upsampling from its ancestor, as before upsample-first.
    #[test]
    fn traverse_terrain_prefetches_an_upsample_for_an_occluded_tile_with_failed_dem() {
        let (mut app, root) = terrain_app_with_root();
        spawn_pending_terrain_layer(&mut app);
        seed_real_terrain(&mut app, root);

        let occluded = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((7, 4, 3), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(occluded));

        app.add_systems(Update, run_terrain_traverse);
        app.update();

        assert_eq!(app.world().resource::<LastResult>().0, "culled");
        let requester = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            qt.qt
                .get(occluded)
                .unwrap()
                .terrain_data
                .as_ref()
                .and_then(|t| t.data_requester_entity_id())
                .expect("the occluded tile's DEM is requested")
        };
        assert!(
            !app.world()
                .resource::<TileCacheManager>()
                .rendered_tile_caches
                .contains_key(&occluded),
            "precondition: not meshed while the DEM is pending"
        );

        app.world_mut()
            .get_mut::<navara_data_requester::DataRequester>(requester)
            .unwrap()
            .status = navara_data_requester::DataRequesterStatus::Fail;
        app.update();

        let tc = app.world().resource::<TileCacheManager>();
        assert!(
            tc.rendered_tile_caches.contains_key(&occluded),
            "a failed DEM never lands: the occluded tile is meshed from its ancestor"
        );
    }

    /// A subtree that already swapped to its children must survive leaving the
    /// frustum: the traversal keeps visiting it (stamping `visited_at`, which
    /// `clear_caches` uses as the liveness signal) and keeps the children
    /// active, so rotating a tilted camera doesn't collapse the group back to
    /// the low-res parent when the tile re-enters the frustum.
    #[test]
    fn traverse_terrain_keeps_culled_swapped_subtree_alive() {
        let (mut app, _root) = terrain_app_with_root();
        // (9, 8, 4) covers lng [22.5°, 45°]: inside the horizon (< 60°, never
        // occluded) but well off the view axis, so a narrow frustum culls it.
        let target = {
            let mut qt = app.world_mut().resource_mut::<TerrainTileQuadtree>();
            qt.qt.initialize_leaf((9, 8, 4), &new_tile).unwrap()
        };
        app.insert_resource(TargetHandle(target));
        // max_zoom=5 bounds the forced subdivision: the z=5 children render,
        // their z=6 grandchildren are over max → NotFound.
        spawn_layer(&mut app, raster_layer("a", 0, 5), Order(0));
        // Zero threshold: the target never meets SSE, so it always subdivides.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            fov: 60.0,
        });

        app.add_systems(Update, run_terrain_traverse);

        // --- Phase A: wide frustum, subdivide and swap to the children ---
        app.update();
        let children: Vec<TileHandle> = {
            let qt = app.world().resource::<TerrainTileQuadtree>();
            let tc = app.world().resource::<TileCacheManager>();
            qt.qt
                .children((9, 8, 4))
                .unwrap()
                .iter()
                .map(|c| c.handle())
                .filter(|h| tc.rendered_tile_caches.contains_key(h))
                .collect()
        };
        assert_eq!(children.len(), 4, "all 4 children rendered while in view");

        let child_meshes: Vec<Entity> = children
            .iter()
            .map(|&child| {
                let e = spawn_mesh(&mut app, true);
                let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
                let cache = tc.rendered_tile_caches.get_mut(&child).unwrap();
                cache.mesh_entity = Some(e);
                cache.mesh_prepared = true;
                e
            })
            .collect();

        app.update();
        assert_eq!(
            app.world().resource::<LastResult>().0,
            "children_prepared",
            "children take over once all meshes are prepared"
        );

        // --- Phase B: narrow frustum culls the target (still not occluded) ---
        app.world_mut().resource_mut::<TraverseConfig>().fov = 10.0;
        {
            let (_, frustum, occluder) = test_camera(10.0);
            let qt = app.world().resource::<TerrainTileQuadtree>();
            let tile = qt.qt.get(target).unwrap();
            assert!(
                !tile.intersect_with_camera_frustum(&frustum),
                "precondition: the target must be outside the narrow frustum"
            );
            let occludee_point = tile
                .occludee_point_in_scaled_space
                .expect("precondition: phase A traversal computed the occludee point");
            assert!(
                occluder.is_scaled_space_point_visible(occludee_point),
                "precondition: the target must not be horizon-occluded"
            );
        }

        app.update();

        // The swapped subtree is preserved, not handed back to the parent.
        assert_eq!(
            app.world().resource::<LastResult>().0,
            "children_prepared",
            "culled swapped subtree keeps its children selected"
        );
        let frame = app.world().resource::<FrameManager>().rendered_frame();
        let qt = app.world().resource::<TerrainTileQuadtree>();
        for child in &children {
            assert_eq!(
                qt.qt.get(*child).unwrap().visited_at,
                frame,
                "culled children stay visited so clear_caches keeps them"
            );
        }
        for e in child_meshes {
            assert!(mesh_active(&app, e), "child mesh stays active while culled");
        }
    }
}
