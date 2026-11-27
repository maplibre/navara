use bevy_ecs::prelude::*;
use navara_component::Priority;
use std::ops::Range;

use navara_core::{Aabb, Ellipsoid};

use navara_buffer_store::BufferStore;
use navara_feature_component::{id::FeatureId, render::RenderableFeature};
use navara_fog::{DynamicSseTerm, Fog};
use navara_frame::FrameManager;
use navara_globe::Globe;
use navara_math::{FloatType, Transform};
use navara_memory::SseDegrade;

use navara_layer::TerrainLayer;
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;
use navara_tile_component::{
    TerrainExaggeration, TerrainTileQuadtree, Tile, TileHandle, VectorTile, VectorTileQuadtree,
    terrain_height_for_tile,
};
use navara_window::Window;

use crate::{
    component::VectorTileFeatureMarker, data_requester::VectorTileDataRequesterQuery,
    layer::tile_cache_manager::TileCacheManager, source::ReadyState, source_cache::SourceId,
};

use super::render::RenderedTile;

// This process works in the following steps.
// 1. Check horizon culling.
// 2. Check if the AABB of the tile, raised by how high its features are drawn, is within the camera's
//    frustum. A tile outside it is neither requested nor drawn, except for texturized layers.
// 3. Check SSE is within max SSE.
// 4. If SSE works and the tile is ready, the tile should be rendered.
// 5. On the other hand, if SSE works but the tile isn't loaded, the tile should be requested, not rendered.
// 6. If above steps aren't matched, traverse children.
// 7. If children couldn't be rendered completely and this tile is on screen, keep this tile until they are.
//    If it isn't on screen, it is neither requested nor drawn while a child is loading: each ready child is
//    drawn on its own and the missing children's area stays empty until they load.
// 8. If all children is rendered, use children.
// 9. If no child in view has data (each is past `max_zoom`, failed or culled), this tile is the finest data
//    there, so it is requested and drawn like a leaf.
// 10. If the tile is overscaled, it's leaf is marked just in quadtree, but it isn't actually rendered. It reuses a parent tile.

/// How far above its terrain the features of a non-texturized tile are at least assumed to reach
/// when it is tested against the frustum: data-driven heights, such as building extrusions, stand
/// above the ground the tile's AABB covers and are not known before the tile loads. A source whose
/// layer materials draw higher raises it (`TileCacheManager::feature_height_margin`).
pub const FEATURE_HEIGHT_MARGIN: FloatType = 500.;

#[allow(clippy::too_many_arguments)]
pub fn traverse_tile(
    command: &mut Commands,
    source_id: &SourceId,
    handle: TileHandle,
    qt: &mut VectorTileQuadtree,
    tc: &mut TileCacheManager,
    frame: &FrameManager,
    camera: &Transform,
    frustum: &navara_camera::CameraFrustum,
    window: &Window,
    ellipsoid: &Ellipsoid<FloatType>,
    occluder: &EllipsoidalOccluder,
    data_requesters: &VectorTileDataRequesterQuery,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
    activations: &mut PendingActivations,
    fog: &Fog,
    dynamic_sse: DynamicSseTerm,
    degrade: SseDegrade,
    is_ancestor_rendered: bool,
    // This is used to keep rendering current children when parent tile isn't ready after you zoomed out.
    meets_sse_ancestors: bool,
    terrain_layer: &Option<&TerrainLayer>,
    terrain_tile_qt: &TerrainTileQuadtree,
    terrain_exaggeration: &TerrainExaggeration,
    ready_parent_tile_handle: Option<TileHandle>,
    globe: &Globe,
    source: &mut dyn crate::source::VectorTileSource,
    buf: &mut BufferStore,
    // The parent's node in `activations`; `None` for the root.
    parent_node: Option<NodeId>,
) -> TraversalResult {
    let tile = qt.qt.get_mut(handle).unwrap();
    tile.is_rendered = false;
    let coords_z = tile.coords.z;

    let traversal_config = source_id.traversal_config();

    // Clamped to ground polygon need to be overscaled, since it is rendered as texture.
    let is_texturized = traversal_config.has_clamp_to_ground;

    // Scale the horizon dynamic-SSE relaxation per layer instead of the global
    // raster strength: clamp-to-ground polylines/polygons drape as a texture
    // like raster but still carry geometry, so they take a reduced share;
    // points and non-clamped geometry render as discrete features that vanish
    // when over-coarsened, so they take only a slight share (never zero, so far
    // tiles still relax a little). Strengths come from `TraversalConfig`
    // (content-based defaults, per-layer overridable). The `min_zoom` gate
    // below still bounds how far any of it can coarsen. (#697)
    //
    // If it is texturized, max SSE need to be same with Globe.
    let max_sse = if is_texturized {
        globe.max_sse
    } else {
        traversal_config.max_sse()
    } as f64;
    let dynamic_sse = dynamic_sse
        .scaled(traversal_config.dynamic_sse_scale() as f64)
        .for_max_sse(max_sse);

    if tile.coords.z > traversal_config.max_zoom && !is_texturized {
        return TraversalResult::NoData;
    }

    let is_overscaled = ready_parent_tile_handle.is_some()
        && tile.coords.z > traversal_config.max_zoom
        && tile.coords.z <= traversal_config.overscaled_max_zoom;

    // Before the culling: a culled child past `max_zoom` would read as hidden
    // in view, and its parent would draw nothing there.
    if tile.coords.z > traversal_config.max_zoom && !is_overscaled {
        // Record the inherited drape source even on this early exit: the vector
        // draping resolve reads the field, and a node that never records one (e.g.
        // past `overscaled_max_zoom` on deeply subdivided/upsampled terrain) would
        // otherwise sit in the quadtree with a stale value forever.
        let drape_source = if source.should_upscale(tile) {
            ready_parent_tile_handle
        } else {
            None
        };
        record_drape_source(tile, tc, drape_source);
        return TraversalResult::NotFound;
    }

    // Borrow the terrain elevation so the SSE matches the terrain's subdivision
    // depth instead of treating the tile as flat at sea level.
    let (max_height, min_height) =
        terrain_height_for_tile(terrain_tile_qt, terrain_exaggeration, tile.coords);
    begin_traverse_tile(ellipsoid, occluder, camera, tile, max_height, min_height);

    let is_culled_by_occlusion = tile.is_occluded_by_horizon(occluder);
    if is_culled_by_occlusion {
        return TraversalResult::Culled;
    }

    // A texturized tile backs the drape of the terrain tiles in its area, and
    // terrain tiles outside the frustum are drawn too, so it is still selected.
    let is_culled_by_frustum = if is_texturized {
        !tile.intersect_with_camera_frustum(frustum)
    } else {
        let aabb = raise_aabb(tile.aabb(), tc.feature_height_margin);
        if !tile.is_root() && !frustum.intersection_with_aabb(&aabb) {
            return TraversalResult::Culled;
        }
        false
    };

    let ready_state = source.ready_state(tile, data_requesters);
    let is_tile_ready = matches!(ready_state, ReadyState::Success);
    let is_tile_failed = matches!(ready_state, ReadyState::Failed);

    let activation = get_renderable_feature_activation_state(
        tc,
        &handle,
        rendered_tiles,
        features,
        renderable_features,
    );
    // An empty tile reads as all active, but it is never on screen: it
    // neither takes over from the tiles under it as one already drawn nor
    // counts as drawn.
    let is_activated = activation.is_some_and(|state| state.all_active && !state.is_empty);
    // On screen.
    let is_drawn = activation.is_some_and(|state| state.any_active);

    let is_rendered_last_frame = is_activated;

    let distance_from_camera = tile.calc_distance_from_camera(camera, ellipsoid);
    let sse = tile.calc_sse(
        frustum,
        window,
        ellipsoid,
        if terrain_layer.is_some() { 65. } else { 64. },
        distance_from_camera,
        fog,
        dynamic_sse,
    );

    tile.sse = sse;
    tile.distance_from_camera = distance_from_camera;
    tile.visited_at = frame.rendered_frame();

    // Self-inclusive nearest bakeable drape source: `Some(self)` when this tile's draped
    // features are all active (and it isn't a reused/overscaled tile), else the inherited
    // nearest-active ancestor (gated by `should_upscale`, as the old field write was). The
    // vector draping resolve reads this; the same value is threaded to children below.
    let inherited_drape_source = if source.should_upscale(tile) {
        ready_parent_tile_handle
    } else {
        None
    };

    // Bake-readiness for the drape source. Texturized (clamp-to-ground) layers
    // bake offscreen and are composited by the drape resolve, so a tile's source
    // readiness is the STABLE "scene built" signal (JS-reported `is_rendered`),
    // NOT the flickering LOD `active` flag: a built offscreen scene stays bakeable
    // until eviction (its draped meshes are kept visible regardless of activation,
    // JS-side), so every built tile is a valid drape source and the resolve picks
    // the finest per region — raster-like, gap-free across LOD swaps. Tying it to
    // `active` instead made the drape flicker: on a swap the old tile deactivated
    // before the new one turned visible, leaving a frame with no bakeable source.
    // Non-texturized layers render directly, so their `active` state is correct.
    let bakeable = if is_texturized {
        are_all_renderable_features_rendered(
            tc,
            &handle,
            rendered_tiles,
            features,
            renderable_features,
        )
    } else {
        is_activated
    };
    let drape_source = if bakeable && !is_overscaled {
        Some(handle)
    } else {
        inherited_drape_source
    };
    record_drape_source(tile, tc, drape_source);

    // Clamp LOD selection to the source's data-available floor: a tile below
    // `min_zoom` never counts as a leaf, so dynamic-SSE relaxation can coarsen
    // down to — but not past — where the source has data. Without this, a
    // horizon-tilted view relaxes far tiles below `min_zoom` and their
    // features vanish.
    let meets_error = sse <= degrade.effective_max_sse(max_sse, distance_from_camera);
    let meets_sse = coords_z >= traversal_config.min_zoom && meets_error;

    // The descent toward `min_zoom` ends once the traversal's budget is
    // spent. The tile has no data to show, so it is left out like a culled
    // one. A frustum-culled tile does not descend and takes no budget.
    if meets_error && !meets_sse && !is_culled_by_frustum && !tc.min_zoom_descent.try_spend() {
        return TraversalResult::Culled;
    }

    // Set again by `PendingActivations::apply` while a tile under this one is
    // drawn.
    let were_children_rendered = std::mem::take(&mut tile.were_children_rendered);

    let is_renderable = is_rendered_last_frame || is_tile_ready;
    // Frustum-culled (texturized) tiles still request but demoted, so in-view
    // tiles win the pending-request slots.
    let request_priority = if is_culled_by_frustum {
        Priority::Medium.demote()
    } else {
        Priority::Medium
    };

    if meets_sse || meets_sse_ancestors {
        // The overscaled tile means that the tiles reached the max zoom level,
        // so there is no next tile.
        // The tile itself is upscaled without fetching new tile.
        if is_overscaled {
            return TraversalResult::Overscaled;
        }

        if is_renderable
            // Keep rendering children while preparing the tile if it's available, because rendering tile takes some time.
            && !were_children_rendered
        {
            return TraversalResult::TileRendered;
        }

        // A tile that isn't loaded and keeps its children drawn is requested
        // once, below, after its children.
        let is_requested_below = were_children_rendered && !is_renderable;
        if !meets_sse_ancestors && !is_requested_below {
            request_tile_data(
                command,
                source,
                qt,
                tc,
                handle,
                buf,
                data_requesters,
                request_priority,
            );
        }

        if !were_children_rendered {
            // A failed request is never retried: report it as such, or the
            // parent waits on this tile forever and never hands over to its
            // other children.
            return if is_tile_failed {
                TraversalResult::NoData
            } else {
                TraversalResult::NotFound
            };
        }
    }

    // A frustum-culled (texturized) tile is drawn without descending. The
    // tiles drawn under it are queued as if it had: they are taken back once
    // an ancestor draws this tile, and stay drawn and flagged until then.
    if is_culled_by_frustum && (were_children_rendered || was_descended_last_pass(qt, tc, handle)) {
        let node = activations.enter(handle, parent_node);
        let horizon = Horizon {
            ellipsoid,
            occluder,
            terrain_tile_qt,
            terrain_exaggeration,
        };
        queue_drawn_descendants(
            qt,
            tc,
            &horizon,
            handle,
            node,
            activations,
            rendered_tiles,
            features,
            renderable_features,
        );
    }

    if !is_culled_by_frustum && let Some(children) = VectorTile::traversable_children(qt, handle) {
        let node = activations.enter(handle, parent_node);
        let mut any_children_rendered = false;

        // Tile has several states to switch LOD smoothly.
        // 1. RenderedTile component is spawned if a tile is selected.
        // 2. Rendering engine needs to do some preparations, so the selected tile is marked as it's prepared after these preparations.
        // 3. The selected tile is activated if all other same level children are activated as well.
        // 4. When the selected tile is activated, the tile will be visible.
        let mut are_all_children_rendered = true;
        let mut are_all_children_mesh_prepared = true;

        let mut rendered_children_indices = vec![];
        let mut hidden_children_indices = vec![];
        let mut prepared_children_indices = vec![];
        // Each child's run in `activations`: the tiles its subtree queued active.
        let mut queued_descendants: Vec<Range<usize>> = Vec::with_capacity(children.len());
        // Children that can be drawn as they are: selected, with every mesh built.
        let mut ready_children = vec![false; children.len()];
        // Children on screen.
        let mut drawn_children = vec![false; children.len()];
        // Children hidden with what is drawn under them, being culled.
        let mut culled_children = vec![false; children.len()];
        // Whether a child is past `max_zoom` or failed, and whether one is
        // neither that nor culled: drawn, ready or loading.
        let mut any_child_without_data = false;
        let mut any_child_with_data = false;

        // Overscaled tile is actually not rendered, since parent tile is reused in the rendering engine side.
        let mut overscaled_children_indices = vec![];

        for (i, child) in children.iter().enumerate() {
            let queued_start = activations.mark();
            let traversal_result = traverse_tile(
                command,
                source_id,
                *child,
                qt,
                tc,
                frame,
                camera,
                frustum,
                window,
                ellipsoid,
                occluder,
                data_requesters,
                rendered_tiles,
                features,
                renderable_features,
                activations,
                fog,
                dynamic_sse,
                degrade,
                if meets_sse_ancestors {
                    is_ancestor_rendered
                } else {
                    is_rendered_last_frame
                },
                meets_sse,
                terrain_layer,
                terrain_tile_qt,
                terrain_exaggeration,
                drape_source,
                globe,
                source,
                buf,
                Some(node),
            );
            queued_descendants.push(queued_start..activations.mark());

            // A child that left the view in this pass is hidden with what is
            // drawn under it. One the `min_zoom` descent budget leaves out is
            // in view (visited in this pass), so it is not. The child keeps
            // its own flag: back in view while it loads, its pooled children
            // fill its area again.
            if matches!(traversal_result, TraversalResult::Culled)
                && qt.qt.get(*child).unwrap().visited_at == tc.previous_pass_frame
            {
                culled_children[i] = true;
                write_activation(
                    tc,
                    child,
                    rendered_tiles,
                    features,
                    renderable_features,
                    false,
                );
                hide_descendants(
                    qt,
                    tc,
                    *child,
                    rendered_tiles,
                    features,
                    renderable_features,
                );
            }

            match traversal_result {
                TraversalResult::NoData => any_child_without_data = true,
                TraversalResult::Culled => {}
                _ => any_child_with_data = true,
            }

            if matches!(
                traversal_result,
                TraversalResult::NotFound | TraversalResult::DescendantsKept
            ) {
                are_all_children_rendered = false;
                are_all_children_mesh_prepared = false;
            }

            if matches!(
                traversal_result,
                TraversalResult::NotFound | TraversalResult::Culled | TraversalResult::NoData
            ) {
                hidden_children_indices.push(i);
            }

            if matches!(traversal_result, TraversalResult::Overscaled) {
                overscaled_children_indices.push(i);
            }

            // If there is one child at least, trigger the rendering children process.
            if matches!(
                traversal_result,
                TraversalResult::TileRendered
                    | TraversalResult::ChildrenRendered
                    | TraversalResult::ChildrenMeshPrepared
                    | TraversalResult::DescendantsKept
                    | TraversalResult::Culled
            ) {
                any_children_rendered = true;
            }

            if matches!(traversal_result, TraversalResult::TileRendered) {
                ready_children[i] = are_all_features_rendered(get_renderable_feature(
                    tc,
                    child,
                    rendered_tiles,
                    features,
                    renderable_features,
                ));
                if !ready_children[i] {
                    are_all_children_mesh_prepared = false;
                    are_all_children_rendered = false;
                }

                let activation = get_renderable_feature_activation_state(
                    tc,
                    child,
                    rendered_tiles,
                    features,
                    renderable_features,
                );
                drawn_children[i] = activation.is_some_and(|state| state.any_active);
            }

            // Skip rendering children in this tile.
            if matches!(
                traversal_result,
                TraversalResult::ChildrenRendered
                    | TraversalResult::ChildrenMeshPrepared
                    | TraversalResult::DescendantsKept
            ) {
                rendered_children_indices.push(i);
            }

            if matches!(traversal_result, TraversalResult::ChildrenRendered) {
                are_all_children_mesh_prepared = false;
            }

            if matches!(
                traversal_result,
                TraversalResult::ChildrenMeshPrepared | TraversalResult::DescendantsKept
            ) {
                prepared_children_indices.push(i);
            }
        }

        // No child in view has data, so this tile is the finest data there.
        let is_finest_data = any_child_without_data && !any_child_with_data;
        // While a child is missing and this tile isn't on screen, each ready
        // child is drawn on its own instead of this tile, and the missing
        // children's area stays empty until they load. Falling back to this
        // tile would trade them for a coarser tile: low zoom tiles often drop
        // most features or have none, and while the memory load gate is
        // closed nothing new loads to replace it, so the working set stays
        // frozen rather than coarsened. A texturized tile still falls back
        // unless tiles under it are on screen: the drape takes the nearest
        // built ancestor where a finer tile is missing.
        let leaves_missing_children_empty = !is_drawn && !is_texturized;

        // This condition should be avoided when overscaled children are selected.
        // We assume vector tiles is continuous data, so a tile that is over `max_zoom` is assumed an overscaled tile.
        if any_children_rendered && !is_finest_data && overscaled_children_indices.is_empty() {
            // If the children are rendered to fill the parent, the parent tile replaces them when it is ready.
            let hide_children = (meets_sse_ancestors && is_ancestor_rendered)
                || (meets_sse && is_rendered_last_frame);

            let is_child_missing = !hide_children && !are_all_children_mesh_prepared;
            let has_drawn_descendants = is_child_missing
                && !is_drawn
                && queued_descendants
                    .iter()
                    .enumerate()
                    .any(|(i, range)| drawn_children[i] || activations.any_drawn(range.clone()));
            let draws_children_alone =
                is_child_missing && (leaves_missing_children_empty || has_drawn_descendants);

            if !meets_sse && !meets_sse_ancestors {
                for (i, child) in children.iter().enumerate() {
                    // If this child is not renderable, skip rendering this child.
                    if hidden_children_indices.contains(&i) {
                        continue;
                    }

                    // If this child's children are rendered, skip rendering this child.
                    if rendered_children_indices.contains(&i) {
                        continue;
                    }

                    let handle = *child;
                    let tile = match qt.qt.get_mut(handle) {
                        Some(t) => t,
                        None => unreachable!(),
                    };
                    spawn_tile_entity(command, tc, tile, frame, handle);
                }
            }

            // Reversed, so taking a child's queued descendants leaves the
            // earlier children's runs in place.
            for (i, child) in children.iter().enumerate().rev() {
                let tile = qt.qt.get_mut(*child).unwrap();
                if culled_children[i] {
                    tile.is_rendered = false;
                    continue;
                }
                tile.is_rendered = are_all_children_mesh_prepared;

                // If this child is not renderable, skip rendering this child.
                if prepared_children_indices.contains(&i) || hidden_children_indices.contains(&i) {
                    let state = write_activation(
                        tc,
                        child,
                        rendered_tiles,
                        features,
                        renderable_features,
                        false,
                    );
                    if state.is_some_and(|state| state.any_active) {
                        tile.is_rendered = false;
                    }
                    continue;
                }

                let draws_child = if draws_children_alone {
                    ready_children[i]
                } else {
                    are_all_children_mesh_prepared && !hide_children
                };
                if draws_child {
                    for descendant in activations.activate(
                        *child,
                        Some(node),
                        drawn_children[i],
                        queued_descendants[i].clone(),
                    ) {
                        tc.kept_off_view.remove(&descendant);
                        write_activation(
                            tc,
                            &descendant,
                            rendered_tiles,
                            features,
                            renderable_features,
                            false,
                        );
                    }
                } else {
                    write_activation(
                        tc,
                        child,
                        rendered_tiles,
                        features,
                        renderable_features,
                        false,
                    );
                }
            }

            if !meets_sse && !meets_sse_ancestors {
                if are_all_children_mesh_prepared {
                    return TraversalResult::ChildrenMeshPrepared;
                }

                if draws_children_alone {
                    return TraversalResult::DescendantsKept;
                }

                if are_all_children_rendered {
                    // This tile's children are rendered completely, so parent tile isn't rendered.
                    return TraversalResult::ChildrenRendered;
                }
            }
        }

        // The children are loading and none is ready yet: as above, this
        // tile stays out.
        if leaves_missing_children_empty && !meets_sse && !meets_sse_ancestors && !is_finest_data {
            return TraversalResult::NotFound;
        }
    }

    if is_overscaled {
        return TraversalResult::Overscaled;
    }

    if is_tile_failed {
        return TraversalResult::NoData;
    }

    if !is_renderable {
        // Avoid to request or render new tile while waiting for parent tile is activated.
        if meets_sse_ancestors {
            return TraversalResult::NotFound;
        }

        // Below the source's data floor there is nothing to fetch; like the
        // raster traverse, only request at or above `min_zoom` (traversal still
        // descends toward it above).
        if coords_z >= traversal_config.min_zoom {
            request_tile_data(
                command,
                source,
                qt,
                tc,
                handle,
                buf,
                data_requesters,
                request_priority,
            );
        }

        return TraversalResult::NotFound;
    }

    // Avoid to return an inactivated tile when meets SSE from ancestors.
    if meets_sse_ancestors && !is_activated {
        return TraversalResult::NotFound;
    }

    TraversalResult::TileRendered
}

pub fn get_renderable_feature<'a>(
    tc: &TileCacheManager,
    handle: &TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &'a mut Query<&mut RenderableFeature>,
) -> Option<Vec<&'a RenderableFeature>> {
    tc.rendered_tile_caches
        .get(handle)
        .and_then(|e| rendered_tiles.get(*e).ok())
        .and_then(|v| v.feature_ids.as_ref())
        .and_then(|es| {
            es.iter()
                .map(|e| features.get(*e).ok())
                .collect::<Option<Vec<_>>>()
        })
        .and_then(|fs| fs.iter().map(|f| f.0).collect::<Option<Vec<_>>>())
        .and_then(|ids| {
            ids.into_iter()
                .map(|id| renderable_features.get(id).ok())
                .collect::<Option<Vec<_>>>()
        })
}

pub fn activate_all_renderable_features(
    tc: &TileCacheManager,
    handle: &TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
    active: bool,
) {
    let _ = tc
        .rendered_tile_caches
        .get(handle)
        .and_then(|e| rendered_tiles.get(*e).ok())
        .and_then(|v| v.feature_ids.as_ref())
        .and_then(|es| {
            es.iter()
                .map(|e| features.get(*e).ok())
                .collect::<Option<Vec<_>>>()
        })
        .and_then(|fs| fs.iter().map(|f| f.0).collect::<Option<Vec<_>>>())
        .map(|ids| {
            for id in ids {
                if let Ok(r) = renderable_features.get_mut(id) {
                    activate_if_changed(r, active);
                };
            }
        });
}

/// Flip `active` only when it differs: a write through `Mut` marks the
/// feature changed and the frontend re-applies the whole feature per change.
/// A flip the frontend does not draw (see
/// [`RenderableFeature::is_drawn_regardless_of_activation`]) is not marked,
/// since a draped feature's change re-bakes every terrain tile it backs.
pub fn activate_if_changed(mut feature: Mut<RenderableFeature>, active: bool) {
    if feature.is_active() == active {
        return;
    }
    if feature.is_drawn_regardless_of_activation() {
        feature.bypass_change_detection().activate(active);
    } else {
        feature.activate(active);
    }
}

/// The tiles a traversal targets active, written by [`Self::apply`] once no
/// ancestor can take over from them any more. Inactive targets are final, so
/// they are written right away.
///
/// A tile's child loop targets its children active before its own parent
/// decides whether to hand over to it. A parent that falls back to drawing
/// itself (a sibling is not ready) must not leave those descendants active
/// beside it. The traversal is post-order, so everything a child's subtree
/// queues sits in one contiguous run, which [`Self::activate`] drops.
#[derive(Default)]
pub struct PendingActivations {
    queued: Vec<QueuedTile>,
    /// The tiles the traversal descended through, each with its parent's
    /// node, so [`Self::apply`] reaches the ancestors of a queued tile.
    nodes: Vec<Node>,
}

/// A tile's index in [`PendingActivations`]'s descended tiles.
pub type NodeId = usize;

struct Node {
    handle: TileHandle,
    parent: Option<NodeId>,
    /// Whether [`PendingActivations::apply`] set its flag.
    is_marked: bool,
}

/// A tile queued active, and whether it was on screen when it was queued. A
/// queued tile is not written until [`PendingActivations::apply`], so that
/// stays true while it is queued.
struct QueuedTile {
    handle: TileHandle,
    parent: Option<NodeId>,
    drawn: bool,
}

impl PendingActivations {
    /// Records that the traversal descends through `handle`, under
    /// `parent`, and returns its node for its children.
    pub fn enter(&mut self, handle: TileHandle, parent: Option<NodeId>) -> NodeId {
        self.nodes.push(Node {
            handle,
            parent,
            is_marked: false,
        });
        self.nodes.len() - 1
    }

    /// Where the tiles queued from now on start.
    pub fn mark(&self) -> usize {
        self.queued.len()
    }

    /// Queues `handle` (under the node `parent`) active; `drawn`: whether it
    /// is on screen now.
    pub fn queue(&mut self, handle: TileHandle, parent: Option<NodeId>, drawn: bool) {
        self.queued.push(QueuedTile {
            handle,
            parent,
            drawn,
        });
    }

    /// Queues `handle` (under the node `parent`) active (`drawn`: whether it
    /// is on screen now) and takes back the tiles queued under it
    /// (`descendants`, a run between two [`Self::mark`]s), to deactivate.
    pub fn activate(
        &mut self,
        handle: TileHandle,
        parent: Option<NodeId>,
        drawn: bool,
        descendants: Range<usize>,
    ) -> impl Iterator<Item = TileHandle> + '_ {
        self.queue(handle, parent, drawn);
        self.queued.drain(descendants).map(|tile| tile.handle)
    }

    /// Whether a tile queued in `range` (between two [`Self::mark`]s) is on
    /// screen.
    pub fn any_drawn(&self, range: Range<usize>) -> bool {
        self.queued[range].iter().any(|tile| tile.drawn)
    }

    /// Writes the tiles still queued: no ancestor took over from them. Every
    /// tile above one that is built records that tiles under it are drawn
    /// ([`VectorTile::were_children_rendered`]), so the next pass keeps
    /// visiting them on a zoom-out, or the cache would drop them before the
    /// tile replacing them is ready, and hides them when that tile takes
    /// over.
    pub fn apply(
        mut self,
        qt: &mut VectorTileQuadtree,
        tc: &mut TileCacheManager,
        rendered_tiles: &Query<&RenderedTile>,
        features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
        renderable_features: &mut Query<&mut RenderableFeature>,
    ) {
        let mut marked = vec![];
        for tile in &self.queued {
            let state = write_activation(
                tc,
                &tile.handle,
                rendered_tiles,
                features,
                renderable_features,
                true,
            );
            // A tile with no features draws nothing to keep.
            if state.is_some_and(|state| !state.is_empty) {
                marked.push(tile.parent);
            }
        }
        // Every node was descended through in this pass, which cleared its
        // flag: a marked node has its ancestors marked too.
        for mut node in marked {
            while let Some(id) = node {
                let entry = &mut self.nodes[id];
                if entry.is_marked {
                    break;
                }
                entry.is_marked = true;
                qt.qt
                    .get_mut(entry.handle)
                    .expect("a tile the traversal descended through")
                    .were_children_rendered = true;
                node = entry.parent;
            }
        }
    }
}

/// Whether the traversal descended through the tile in the last pass: a
/// child of it was reached then.
fn was_descended_last_pass(
    qt: &VectorTileQuadtree,
    tc: &TileCacheManager,
    handle: TileHandle,
) -> bool {
    qt.qt.get(handle).unwrap().children.iter().any(|child| {
        qt.qt
            .get(*child)
            .is_some_and(|child| child.visited_at == tc.previous_pass_frame)
    })
}

/// What [`queue_drawn_descendants`] tests the tiles it reaches against.
struct Horizon<'a> {
    ellipsoid: &'a Ellipsoid<FloatType>,
    occluder: &'a EllipsoidalOccluder,
    terrain_tile_qt: &'a TerrainTileQuadtree,
    terrain_exaggeration: &'a TerrainExaggeration,
}

/// Queues active every tile drawn under `handle` (whose node is `node`), as
/// a traversal through them would: it goes down through the flagged tiles,
/// recording them as nodes and clearing their flags (which
/// [`PendingActivations::apply`] sets again while tiles under them stay
/// drawn), and stops at the drawn ones. Both are stamped visited so the
/// cache keeps them, and the drawn ones are recorded as kept outside the
/// view, which the memory budget evicts after the pooled tiles. A tile behind the horizon is
/// hidden with what is under it instead.
#[allow(clippy::too_many_arguments)]
fn queue_drawn_descendants(
    qt: &mut VectorTileQuadtree,
    tc: &mut TileCacheManager,
    horizon: &Horizon,
    handle: TileHandle,
    node: NodeId,
    activations: &mut PendingActivations,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
) {
    let child_count = qt.qt.get(handle).unwrap().children.len();
    for i in 0..child_count {
        let child = qt.qt.get(handle).unwrap().children[i];
        let Some(tile) = qt.qt.get_mut(child) else {
            continue;
        };
        // As `begin_traverse_tile` sets a tile up for the horizon test.
        let (max_height, min_height) = terrain_height_for_tile(
            horizon.terrain_tile_qt,
            horizon.terrain_exaggeration,
            tile.coords,
        );
        tile.update_heights(max_height, min_height);
        tile.update_tile_occludee_point(horizon.ellipsoid, horizon.occluder);
        if tile.is_occluded_by_horizon(horizon.occluder) {
            tile.were_children_rendered = false;
            write_activation(
                tc,
                &child,
                rendered_tiles,
                features,
                renderable_features,
                false,
            );
            hide_descendants(qt, tc, child, rendered_tiles, features, renderable_features);
            continue;
        }
        let is_drawn = get_renderable_feature_activation_state(
            tc,
            &child,
            rendered_tiles,
            features,
            renderable_features,
        )
        .is_some_and(|state| state.any_active);
        if is_drawn {
            // Nothing is drawn under a drawn tile.
            tile.were_children_rendered = false;
            tile.visited_at = tc.last_rendered_frame;
            tc.kept_off_view.insert(child);
            activations.queue(child, Some(node), true);
        } else if std::mem::take(&mut tile.were_children_rendered) {
            tile.visited_at = tc.last_rendered_frame;
            let child_node = activations.enter(child, Some(node));
            queue_drawn_descendants(
                qt,
                tc,
                horizon,
                child,
                child_node,
                activations,
                rendered_tiles,
                features,
                renderable_features,
            );
        }
    }
}

/// Deactivates every tile under `handle` still in the quadtree, whatever
/// their flags say, and clears their flags: nothing stays drawn under it.
fn hide_descendants(
    qt: &mut VectorTileQuadtree,
    tc: &mut TileCacheManager,
    handle: TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
) {
    let child_count = qt.qt.get(handle).unwrap().children.len();
    for i in 0..child_count {
        let child = qt.qt.get(handle).unwrap().children[i];
        let Some(tile) = qt.qt.get_mut(child) else {
            continue;
        };
        tile.were_children_rendered = false;
        write_activation(
            tc,
            &child,
            rendered_tiles,
            features,
            renderable_features,
            false,
        );
        hide_descendants(qt, tc, child, rendered_tiles, features, renderable_features);
    }
}

/// Writes `active` to the tile's features when it changes their state,
/// flagging `tc` for another pass, because the parents' decisions read it.
/// Returns the state before the write.
pub(crate) fn write_activation(
    tc: &mut TileCacheManager,
    handle: &TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
    active: bool,
) -> Option<RenderableFeatureActivationState> {
    let state = get_renderable_feature_activation_state(
        tc,
        handle,
        rendered_tiles,
        features,
        renderable_features,
    )?;
    // An empty tile reads as all active whatever it is set to, so it must not
    // ask for another pass, or the traversal would re-run every frame.
    let changed = !state.is_empty
        && if active {
            !state.all_active
        } else {
            state.any_active
        };
    if changed {
        tc.needs_update = true;
        activate_all_renderable_features(
            tc,
            handle,
            rendered_tiles,
            features,
            renderable_features,
            active,
        );
    }
    Some(state)
}

/// Asks the source for the tile's data, and records that this pass wants it
/// (see [`TileCacheManager::wanted_data`]).
#[allow(clippy::too_many_arguments)]
fn request_tile_data(
    command: &mut Commands,
    source: &mut dyn crate::source::VectorTileSource,
    qt: &mut VectorTileQuadtree,
    tc: &mut TileCacheManager,
    handle: TileHandle,
    buf: &mut BufferStore,
    data_requesters: &VectorTileDataRequesterQuery,
    priority: Priority,
) {
    // Another camera's pass may have asked first: keep the more urgent.
    tc.wanted_data
        .entry(handle)
        .and_modify(|wanted| *wanted = (*wanted).min(priority))
        .or_insert(priority);
    let tile = qt.qt.get_mut(handle).unwrap();
    source.prepare_tile(command, tile, handle, tc, buf, data_requesters, priority);
}

pub fn are_all_renderable_features_active(
    tc: &TileCacheManager,
    handle: &TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
) -> Option<bool> {
    get_renderable_feature_activation_state(
        tc,
        handle,
        rendered_tiles,
        features,
        renderable_features,
    )
    .map(|state| state.all_active)
}

#[derive(Clone, Copy)]
pub(crate) struct RenderableFeatureActivationState {
    all_active: bool,
    any_active: bool,
    /// The tile parsed to no features: vacuously all active and none active,
    /// and activating it changes nothing.
    is_empty: bool,
}

fn get_renderable_feature_activation_state(
    tc: &TileCacheManager,
    handle: &TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &Query<&mut RenderableFeature>,
) -> Option<RenderableFeatureActivationState> {
    let rendered_tile_entity = tc.rendered_tile_caches.get(handle)?;
    let rendered_tile = rendered_tiles.get(*rendered_tile_entity).ok()?;
    let tile_feature_ids = rendered_tile.feature_ids.as_ref()?;

    let mut all_active = true;
    let mut any_active = false;

    for feature_id in tile_feature_ids {
        let feature = features.get(*feature_id).ok()?;
        let renderable_feature = renderable_features.get(feature.0?).ok()?;
        let active = renderable_feature.is_active();
        all_active = all_active && active;
        any_active = any_active || active;
        if any_active && !all_active {
            break;
        }
    }

    Some(RenderableFeatureActivationState {
        all_active,
        any_active,
        is_empty: tile_feature_ids.is_empty(),
    })
}

pub fn are_all_features_rendered(renderable_features: Option<Vec<&RenderableFeature>>) -> bool {
    renderable_features
        .map(|rs| rs.iter().all(|r| r.is_rendered()))
        .unwrap_or(false)
}

/// Whether every feature of this tile has been BUILT in the rendering engine
/// (JS-reported `is_rendered`). Unlike activation this is stable — true from
/// build until the tile is destroyed — so it is the drape-source readiness
/// signal for texturized (clamp-to-ground) layers: a built offscreen scene is
/// bakeable regardless of the LOD `active` flag (draped meshes are kept visible
/// JS-side), the vector twin of a loaded raster texture. `false` when the tile
/// has no rendered entity / features yet.
pub fn are_all_renderable_features_rendered(
    tc: &TileCacheManager,
    handle: &TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
) -> bool {
    are_all_features_rendered(get_renderable_feature(
        tc,
        handle,
        rendered_tiles,
        features,
        renderable_features,
    ))
}

// We should use entity to store the rendered tile, because the Bevy's entity is extensible.
pub fn spawn_tile_entity(
    commands: &mut Commands,
    tc: &mut TileCacheManager,
    tile: &mut VectorTile,
    frame: &FrameManager,
    tile_handle: TileHandle,
) {
    tile.rendered_at = frame.rendered_frame();
    tc.is_updated_in_this_frame = true;

    if tc.rendered_tile_caches.contains_key(&tile_handle) {
        return;
    }

    let e = commands.spawn((
        RenderedTile {
            tile_handle,
            ..Default::default()
        },
        tile.load_order(),
    ));
    tc.rendered_tile_caches.insert(tile_handle, e.id());
}

/// Record `tile`'s drape source, flagging `tc` when it changed: the drape
/// source hand-over re-resolves the shown terrain tiles only then.
fn record_drape_source(
    tile: &mut VectorTile,
    tc: &mut TileCacheManager,
    drape_source: Option<TileHandle>,
) {
    if tile.ready_parent_tile_handle != drape_source {
        tile.ready_parent_tile_handle = drape_source;
        tc.drape_sources_changed = true;
    }
}

fn begin_traverse_tile(
    ellipsoid: &Ellipsoid<FloatType>,
    occluder: &EllipsoidalOccluder,
    _camera: &Transform,
    tile: &mut VectorTile,
    max_height: f64,
    min_height: f64,
) {
    tile.update_heights(max_height, min_height);
    tile.update_tile_occludee_point(ellipsoid, occluder);
}

/// `aabb` extended by `height` along the up direction at its center.
pub(crate) fn raise_aabb(aabb: &Aabb, height: FloatType) -> Aabb {
    let up = aabb.center.normalize() * height;
    let min = aabb.min().min(aabb.min() + up);
    let max = aabb.max().max(aabb.max() + up);
    Aabb {
        center: (min + max) * 0.5,
        extents: (max - min) * 0.5,
    }
}

pub enum TraversalResult {
    TileRendered,
    ChildrenRendered,
    ChildrenMeshPrepared,
    /// A child is missing and this tile is not drawn: the ready tiles under
    /// it are drawn around the missing child's empty area.
    DescendantsKept,
    Culled,
    NotFound,
    /// Nothing is drawn for this tile and nothing waits for it: it is past
    /// `max_zoom`, or its request failed (a failed request is not retried).
    NoData,
    Overscaled,
}

#[cfg(test)]
mod test {
    use super::*;
    use navara_feature_component::render::PolygonRenderInformation;

    fn point(active: bool) -> RenderableFeature {
        RenderableFeature::Point {
            coordinates: Default::default(),
            crs: Default::default(),
            active,
            material: Default::default(),
            transform: Default::default(),
            feature_id: Entity::PLACEHOLDER,
            render_info: Default::default(),
            geometry: Default::default(),
            feature_batch_id: 0,
            batch_length: 0,
        }
    }

    /// Setting the flag it already has leaves the feature unchanged for
    /// change detection; a real flip marks it.
    #[test]
    fn it_should_mark_a_feature_changed_only_when_active_flips() {
        let mut world = World::new();
        let same = world.spawn(point(true)).id();
        let flipped = world.spawn(point(true)).id();
        world.clear_trackers();

        let mut query = world.query::<&mut RenderableFeature>();
        activate_if_changed(query.get_mut(&mut world, same).unwrap(), true);
        activate_if_changed(query.get_mut(&mut world, flipped).unwrap(), false);

        let mut changed = world.query_filtered::<Entity, Changed<RenderableFeature>>();
        let changed: Vec<Entity> = changed.iter(&world).collect();
        assert_eq!(changed, vec![flipped]);
        assert!(!world.get::<RenderableFeature>(flipped).unwrap().is_active());
    }

    fn polygon(texturized: bool, outlined: bool) -> RenderableFeature {
        RenderableFeature::Polygon {
            coordinates: Default::default(),
            crs: Default::default(),
            active: true,
            material: Default::default(),
            geometry: Default::default(),
            outline_geometry: outlined.then(Default::default),
            transform: Default::default(),
            feature_id: Entity::PLACEHOLDER,
            render_info: PolygonRenderInformation {
                should_be_texturized: texturized,
                ..Default::default()
            },
            extent: None,
            bounding_sphere: None,
            feature_batch_id: 0,
            batch_length: 0,
        }
    }

    /// A draped polygon's flip is applied without marking it changed; a
    /// direct one, or a draped one with a directly drawn outline, is marked.
    #[test]
    fn it_should_not_mark_a_draped_feature_changed_on_an_activation_flip() {
        let mut world = World::new();
        let draped = world.spawn(polygon(true, false)).id();
        let outlined = world.spawn(polygon(true, true)).id();
        let direct = world.spawn(polygon(false, false)).id();
        world.clear_trackers();

        let mut query = world.query::<&mut RenderableFeature>();
        for e in [draped, outlined, direct] {
            activate_if_changed(query.get_mut(&mut world, e).unwrap(), false);
        }

        let mut changed = world.query_filtered::<Entity, Changed<RenderableFeature>>();
        let mut changed: Vec<Entity> = changed.iter(&world).collect();
        changed.sort();
        let mut expected = vec![outlined, direct];
        expected.sort();
        assert_eq!(changed, expected);
        assert!(!world.get::<RenderableFeature>(draped).unwrap().is_active());
    }

    /// A parent that falls back to drawing itself while a child's own loop
    /// queued the grandchildren under it: activating the parent drops them,
    /// and a sibling queued before keeps its target.
    fn queued(handles: &[TileHandle]) -> PendingActivations {
        PendingActivations {
            queued: handles
                .iter()
                .map(|&handle| QueuedTile {
                    handle,
                    parent: None,
                    drawn: false,
                })
                .collect(),
            nodes: vec![],
        }
    }

    fn handles(pending: &PendingActivations) -> Vec<TileHandle> {
        pending.queued.iter().map(|tile| tile.handle).collect()
    }

    #[test]
    fn it_should_drop_the_descendants_of_an_activated_tile() {
        let mut pending = PendingActivations::default();
        assert_eq!(pending.activate(1, None, false, 0..0).count(), 0);

        let start = pending.mark();
        for grandchild in 10..14 {
            let at = pending.mark();
            assert_eq!(pending.activate(grandchild, None, false, at..at).count(), 0);
        }
        let end = pending.mark();

        let dropped: Vec<TileHandle> = pending.activate(2, None, false, start..end).collect();
        assert_eq!(dropped, vec![10, 11, 12, 13]);
        assert_eq!(handles(&pending), vec![1, 2]);
    }

    /// A run is drawn while a tile still queued in it is: one taken back by
    /// an ancestor no longer counts.
    #[test]
    fn it_should_tell_whether_a_tile_queued_in_a_run_is_drawn() {
        let mut pending = PendingActivations::default();
        let start = pending.mark();
        let at = pending.mark();
        assert_eq!(pending.activate(10, None, true, at..at).count(), 0);
        let at = pending.mark();
        assert_eq!(pending.activate(11, None, false, at..at).count(), 0);
        assert!(pending.any_drawn(start..pending.mark()));
        assert!(!pending.any_drawn(1..2));

        let end = pending.mark();
        assert_eq!(pending.activate(1, None, false, start..end).count(), 2);
        assert!(!pending.any_drawn(0..pending.mark()));
    }

    /// Siblings are activated last to first, so taking a later child's
    /// descendants leaves an earlier child's run in place, and a child that
    /// hands over keeps its descendants queued.
    #[test]
    fn it_should_keep_earlier_sibling_runs_when_activating_in_reverse() {
        let mut pending = queued(&[10, 11, 12]);
        let (first, second) = (0..2, 2..3);

        let dropped: Vec<TileHandle> = pending.activate(2, None, false, second).collect();
        assert_eq!(dropped, vec![12]);
        assert_eq!(handles(&pending), vec![10, 11, 2]);

        let dropped: Vec<TileHandle> = pending.activate(1, None, false, first).collect();
        assert_eq!(dropped, vec![10, 11]);
        assert_eq!(handles(&pending), vec![2, 1]);
    }

    #[test]
    fn it_should_flag_only_a_changed_drape_source() {
        let mut tile = VectorTile::new(navara_core::TileXYZ { x: 0, y: 0, z: 0 }, 0., 0.);
        let mut tc = TileCacheManager::default();

        record_drape_source(&mut tile, &mut tc, None);
        assert!(!tc.drape_sources_changed);

        record_drape_source(&mut tile, &mut tc, Some(1));
        assert!(tc.drape_sources_changed);
        assert_eq!(tile.ready_parent_tile_handle, Some(1));
    }

    /// The camera stands 10 m above the equator at lng 0° and looks north,
    /// 10° up, through a 10° wide view. The z16 tile about 5 km north lies
    /// below the view, but its features up to `FEATURE_HEIGHT_MARGIN` reach
    /// into it.
    #[test]
    fn it_should_raise_the_tile_aabb_by_the_feature_height() {
        use navara_core::{Angle, LLE, Meters, TileXYZ, WGS84_64, xyz_to_vec3};

        let at = |lat: FloatType, height: FloatType| {
            xyz_to_vec3(WGS84_64.lle_to_xyz(LLE {
                lng: Angle::new(0.),
                lat: Angle::new(lat.to_radians()),
                height: Meters::new(height),
            }))
        };
        let position = at(0., 10.);
        let target = at(0.045, 10. + 5000. * 10f64.to_radians().tan());
        let camera = Transform::from_translation(position).looking_at(target, position.normalize());
        let frustum = navara_camera::CameraFrustum::new(&camera, 0.1, 1e6, 10f64.to_radians(), 1.);
        let tile = VectorTile::new(
            TileXYZ {
                x: 32768,
                y: 32759,
                z: 16,
            },
            0.,
            0.,
        );

        assert!(!frustum.intersection_with_aabb(tile.aabb()));
        assert!(frustum.intersection_with_aabb(&raise_aabb(tile.aabb(), FEATURE_HEIGHT_MARGIN)));
    }
}
