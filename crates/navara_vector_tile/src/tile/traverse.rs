use bevy_ecs::prelude::*;
use navara_component::{OrderByDistance, Priority};
use navara_core::Ellipsoid;

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
    TerrainTileQuadtree, Tile, TileHandle, VectorTile, VectorTileQuadtree,
    terrain_height_for_extent,
};
use navara_window::Window;

use crate::{
    component::VectorTileFeatureMarker, data_requester::VectorTileDataRequesterQuery,
    layer::tile_cache_manager::TileCacheManager, source::ReadyState, source_cache::SourceId,
};

use super::render::RenderedTile;

// This process works in the following steps.
// 1. Check if the AABB of the tile is within the camera's frustum.(Frustum culling)
// 2. Check horizon culling because the frustum culling isn't enough.
// 3. Check SSE is within max SSE.
// 4. If SSE works and the tile is ready, the tile should be rendered.
// 5. On the other hand, if SSE works but the tile isn't loaded, the tile should be requested, not rendered.
// 6. If above steps aren't matched, traverse children.
// 7. If children couldn't be rendered completely, use this tile instead.
// 8. If all children is rendered, use children.
// 9. If the tile is overscaled, it's leaf is marked just in quadtree, but it isn't actually rendered. It reuses a parent tile.

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
    fog: &Fog,
    dynamic_sse: DynamicSseTerm,
    degrade: SseDegrade,
    is_ancestor_rendered: bool,
    // This is used to keep rendering current children when parent tile isn't ready after you zoomed out.
    meets_sse_ancestors: bool,
    terrain_layer: &Option<&TerrainLayer>,
    terrain_tile_qt: &TerrainTileQuadtree,
    ready_parent_tile_handle: Option<TileHandle>,
    globe: &Globe,
    source: &mut dyn crate::source::VectorTileSource,
    buf: &mut BufferStore,
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
        return TraversalResult::NotFound;
    }

    // Borrow the terrain elevation by EXTENT (scheme-agnostic point-in-tile walk),
    // exactly like the raster traverse, so the SSE matches the terrain's subdivision
    // depth instead of treating the tile as flat at sea level. A by-handle lookup
    // would miss when the vector tile is WebMercator and the terrain is Geographic
    // (quantized-mesh), which is what kept the drape coarse.
    let extent = tile.extent;
    let (max_height, min_height) =
        terrain_height_for_extent(terrain_tile_qt, &extent).unwrap_or((0., 0.));
    begin_traverse_tile(ellipsoid, occluder, camera, tile, max_height, min_height);

    let is_culled_by_occlusion = !tile
        .occludee_point_in_scaled_space
        .map(|p| occluder.is_scaled_space_point_visible(p))
        .unwrap_or(true);
    if is_culled_by_occlusion {
        return TraversalResult::Culled;
    }

    let is_culled_by_frustum = !tile.intersect_with_camera_frustum(frustum);

    let is_overscaled = ready_parent_tile_handle.is_some()
        && tile.coords.z > traversal_config.max_zoom
        && tile.coords.z <= traversal_config.overscaled_max_zoom;

    if tile.coords.z > traversal_config.max_zoom && !is_overscaled {
        // Record the inherited drape source even on this early exit: the vector
        // draping resolve reads the field, and a node that never records one (e.g.
        // past `overscaled_max_zoom` on deeply subdivided/upsampled terrain) would
        // otherwise sit in the quadtree with a stale value forever.
        tile.ready_parent_tile_handle = if source.should_upscale(tile) {
            ready_parent_tile_handle
        } else {
            None
        };
        return TraversalResult::NotFound;
    }

    let ready_state = source.ready_state(tile, data_requesters);
    let is_tile_ready = matches!(ready_state, ReadyState::Success);
    let is_tile_failed = matches!(ready_state, ReadyState::Failed);

    let is_activated = matches!(
        are_all_renderable_features_active(
            tc,
            &handle,
            rendered_tiles,
            features,
            renderable_features
        ),
        Some(true)
    );

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
    tile.ready_parent_tile_handle = drape_source;

    let were_children_rendered = tile.were_children_rendered;
    tile.were_children_rendered = false;

    // Clamp LOD selection to the source's data-available floor: a tile below
    // `min_zoom` never counts as a leaf, so dynamic-SSE relaxation can coarsen
    // down to — but not past — where the source has data. Without this, a
    // horizon-tilted view relaxes far tiles below `min_zoom` and their
    // features vanish.
    let meets_sse = coords_z >= traversal_config.min_zoom
        && sse <= degrade.effective_max_sse(max_sse, distance_from_camera);

    let is_renderable = is_rendered_last_frame || is_tile_ready;

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

        if !meets_sse_ancestors {
            let tile = qt.qt.get_mut(handle).unwrap();
            // Frustum-culled tiles still request (parent backfill) but
            // demoted, so in-view tiles win the pending-request slots.
            source.prepare_tile(
                command,
                tile,
                handle,
                tc,
                buf,
                data_requesters,
                if is_culled_by_frustum {
                    Priority::Low.demote()
                } else {
                    Priority::Low
                },
            );
        }

        if !were_children_rendered {
            return TraversalResult::NotFound;
        }
    }

    // Culled tiles do not traverse children, but they are rendered to prevent parent tiles from flickering.
    if !is_culled_by_frustum && let Some(children) = VectorTile::traversable_children(qt, handle) {
        let mut any_children_rendered = false;

        // Tile has several states to switch LOD smoothly.
        // 1. RenderedTile component is spawned if a tile is selected.
        // 2. Rendering engine needs to do some preparations, so the selected tile is marked as it's prepared after these preparations.
        // 3. The selected tile is activated if all other same level children are activated as well.
        // 4. When the selected tile is activated, the tile will be visible.
        let mut are_all_children_rendered = true;
        let mut are_all_children_mesh_prepared = true;
        let mut are_all_children_activated = true;

        let mut rendered_children_indices = vec![];
        let mut hidden_children_indices = vec![];
        let mut prepared_children_indices = vec![];

        // Overscaled tile is actually not rendered, since parent tile is reused in the rendering engine side.
        let mut overscaled_children_indices = vec![];

        for (i, child) in children.iter().enumerate() {
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
                drape_source,
                globe,
                source,
                buf,
            );

            if matches!(traversal_result, TraversalResult::NotFound) {
                are_all_children_rendered = false;
                are_all_children_mesh_prepared = false;
                are_all_children_activated = false;
            }

            if matches!(
                traversal_result,
                TraversalResult::NotFound | TraversalResult::Culled | TraversalResult::Failed
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
                    | TraversalResult::Culled
            ) {
                any_children_rendered = true;
            }

            if matches!(traversal_result, TraversalResult::TileRendered)
                && !are_all_features_rendered(get_renderable_feature(
                    tc,
                    child,
                    rendered_tiles,
                    features,
                    renderable_features,
                ))
            {
                are_all_children_mesh_prepared = false;
                are_all_children_rendered = false;
                are_all_children_activated = false;
            }

            // If tile's mesh isn't ready, render the parent tile.
            if (matches!(traversal_result, TraversalResult::TileRendered)
                && !matches!(
                    are_all_renderable_features_active(
                        tc,
                        child,
                        rendered_tiles,
                        features,
                        renderable_features
                    ),
                    Some(true)
                ))
            {
                are_all_children_activated = false;
            }

            // Skip rendering children in this tile.
            if matches!(
                traversal_result,
                TraversalResult::ChildrenRendered | TraversalResult::ChildrenMeshPrepared
            ) {
                rendered_children_indices.push(i);
            }

            if matches!(traversal_result, TraversalResult::ChildrenRendered) {
                are_all_children_mesh_prepared = false;
            }

            if matches!(traversal_result, TraversalResult::ChildrenMeshPrepared) {
                prepared_children_indices.push(i);
            }
        }

        // This condition should be avoided when overscaled children are selected.
        // We assume vector tiles is continuous data, so a tile that is over `max_zoom` is assumed an overscaled tile.
        if any_children_rendered && overscaled_children_indices.is_empty() {
            // If the children are rendered to fill the parent, the parent tile replaces them when it is ready.
            let hide_children = (meets_sse_ancestors && is_ancestor_rendered)
                || (meets_sse && is_rendered_last_frame);

            let tile = qt.qt.get_mut(handle).unwrap();
            tile.were_children_rendered = are_all_children_activated && !hide_children;

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

            for (i, child) in children.iter().enumerate() {
                let activation_state = get_renderable_feature_activation_state(
                    tc,
                    child,
                    rendered_tiles,
                    features,
                    renderable_features,
                );

                let tile = qt.qt.get_mut(*child).unwrap();
                tile.is_rendered = are_all_children_mesh_prepared;

                // If this child is not renderable, skip rendering this child.
                if prepared_children_indices.contains(&i) || hidden_children_indices.contains(&i) {
                    if activation_state.is_some_and(|state| state.any_active) {
                        tile.is_rendered = false;
                        activate_all_renderable_features(
                            tc,
                            child,
                            rendered_tiles,
                            features,
                            renderable_features,
                            false,
                        );
                    }
                    continue;
                }

                let target_active = are_all_children_mesh_prepared && !hide_children;
                let needs_activation_update =
                    activation_state.is_some_and(|state| state.all_active != target_active);

                if needs_activation_update {
                    // Re-run this traverse if `active` is updated, because the child tiles are updated depending on the parent state.
                    tc.needs_update = true;

                    activate_all_renderable_features(
                        tc,
                        child,
                        rendered_tiles,
                        features,
                        renderable_features,
                        target_active,
                    );
                }
            }

            if !meets_sse && !meets_sse_ancestors {
                if are_all_children_mesh_prepared {
                    return TraversalResult::ChildrenMeshPrepared;
                }

                if are_all_children_rendered {
                    // This tile's children are rendered completely, so parent tile isn't rendered.
                    return TraversalResult::ChildrenRendered;
                }
            }
        }
    }

    if is_overscaled {
        return TraversalResult::Overscaled;
    }

    if is_tile_failed {
        return TraversalResult::Failed;
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
            let tile = qt.qt.get_mut(handle).unwrap();
            source.prepare_tile(
                command,
                tile,
                handle,
                tc,
                buf,
                data_requesters,
                if is_culled_by_frustum {
                    Priority::Medium.demote()
                } else {
                    Priority::Medium
                },
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
                if let Ok(mut r) = renderable_features.get_mut(id) {
                    r.activate(active);
                };
            }
        });
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
struct RenderableFeatureActivationState {
    all_active: bool,
    any_active: bool,
}

fn get_renderable_feature_activation_state(
    tc: &TileCacheManager,
    handle: &TileHandle,
    rendered_tiles: &Query<&RenderedTile>,
    features: &Query<&FeatureId, With<VectorTileFeatureMarker>>,
    renderable_features: &mut Query<&mut RenderableFeature>,
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
        OrderByDistance {
            sse: tile.sse,
            distance: tile.distance_from_camera,
        },
    ));
    tc.rendered_tile_caches.insert(tile_handle, e.id());
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

pub enum TraversalResult {
    TileRendered,
    ChildrenRendered,
    ChildrenMeshPrepared,
    Culled,
    NotFound,
    Failed,
    Overscaled,
}
