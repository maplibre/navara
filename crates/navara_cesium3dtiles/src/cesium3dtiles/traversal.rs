//! Tile Selection and Traversal Module
//!
//! This module implements the core tile selection algorithm for Cesium 3D Tiles.
//! It determines which tiles should be rendered based on camera position, frustum,
//! and screen-space error (SSE) calculations.
//!
//! # Traversal Algorithm
//!
//! The traversal uses a two-phase approach:
//!
//! 1. **Mark Leaves Phase** ([`mark_leaves`]): Recursively traverses the tile tree,
//!    calculating SSE and determining which tiles are "leaves" (should be rendered).
//!
//! 2. **Mark Rendered Tiles Phase** ([`mark_rendered_tiles`]): Walks the tree again,
//!    spawning/updating `RenderedCesium3dTileContent` entities for selected tiles
//!    and requesting data for tiles that need loading.
//!
//! # Refinement Strategies
//!
//! The algorithm supports two refinement strategies from 3D Tiles spec:
//!
//! - **REPLACE**: Parent tile is replaced by children when they're all ready.
//!   The parent remains visible until all children are loaded.
//!
//! - **ADD**: Children are added on top of parent (additive refinement).
//!   Both parent and children can be visible simultaneously.
//!
//! # Screen-Space Error (SSE)
//!
//! SSE is calculated as:
//! ```text
//! sse = geometric_error / (distance * sse_denominator / window_height)
//! ```
//!
//! When SSE > max_sse, the tile needs more detail (traverse to children).
//! When SSE <= max_sse, the tile is sufficient detail (render this tile).
//!
//! # Continuous Traversal Across Nested Tilesets
//!
//! When a tile's content is a nested `tileset.json`, its parsed metadata is
//! cached in [`Cesium3dTilesNestedTreeMap`] keyed by the tile's
//! `data_requester_id`. During traversal a JSON tile whose tileset has loaded
//! acts as a transparent grouping node: its `tile_meta.children` is replaced
//! by a single synthetic child built from the loaded tileset's root tile, and
//! recursion proceeds normally. Runtime state for the nested tiles lives
//! inline as `tile.children` of the JSON parent.

use std::{collections::HashMap, sync::Arc};

use bevy_ecs::{
    entity::Entity,
    system::{Commands, Query, ResMut},
};
use bevy_log::warn;

use navara_buffer_store::BufferStore;
use navara_camera::CameraFrustum;
use navara_component::{Deleted, Priority};
use navara_data_requester::DataRequesterStatus;
use navara_feature_component::{id::FeatureId, render::RenderableFeature};
use navara_fog::{DynamicSseTerm, Fog};
use navara_math::Vec3;
use navara_memory::SseDegrade;
use navara_parser::cesium3dtiles::tileset::Refine;
use navara_window::Window;
use url::Url;

use crate::{
    Cesium3dTileContentDataRequesterMarker, Cesium3dTilesNestedTreeMap, Cesium3dTilesRetentionPool,
    RenderedCesium3dTileContent, TileOrderByDistance, b3dm::RenderedCesium3dTileContentB3dmMarker,
    cesium3dtiles::Cesium3dTilesNestedMetadataDataRequesterMarker,
    glb::RenderedCesium3dTileContentGlbMarker,
    gltf_features::RenderedCesium3dTileContentGltfFeaturesMarker,
    pnts::RenderedCesium3dTileContentPntsMarker,
};

use super::{
    Cesium3dTileContent, Cesium3dTileContentMetadata, Cesium3dTilesMetadataDataRequesterMarker,
    request_tile_content, types::Cesium3dTileContentRequesterQuery,
};

use navara_data_requester::{DataRequester, DataRequesterExtension, RequestOrder};

/// Result of traversing a single tile in the tree.
///
/// This enum indicates what happened during the traversal of a tile,
/// which affects how parent tiles handle their visibility.
#[derive(Debug, Clone, Copy)]
pub enum TraversalResult {
    /// This tile was selected for rendering (it's a leaf node).
    /// The tile meets SSE requirements or has no suitable children.
    Selected,
    /// This tile's children were selected instead (REPLACE refinement).
    /// All children are loaded and ready, so parent can be hidden.
    ChildrenSelected,
}

/// Entry point for tile selection algorithm.
///
/// Drives [`mark_leaves`] and [`mark_rendered_tiles`] for one root tree.
/// Nested tilesets are descended in-line via the
/// [`Cesium3dTilesNestedTreeMap`] pivot inside both phases.
#[allow(clippy::too_many_arguments)]
pub fn select_tiles(
    commands: &mut Commands,
    buf: &mut ResMut<BufferStore>,
    nested_map: &mut ResMut<Cesium3dTilesNestedTreeMap>,
    layer_id: Entity,
    max_sse: f32,
    base_url: &Arc<Url>,
    tile_meta: &Cesium3dTileContentMetadata,
    tile: &mut Cesium3dTileContent,
    camera_position: Vec3,
    frustum: &CameraFrustum,
    requesters: &Cesium3dTileContentRequesterQuery,
    rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
    features: &Query<&FeatureId>,
    renderable_features: &Query<&RenderableFeature>,
    pool: &Cesium3dTilesRetentionPool,
    window: &Window,
    fog: &Fog,
    dynamic_sse: DynamicSseTerm,
    degrade: SseDegrade,
    is_v1_1: bool,
) {
    let mut rendered_tiles_count = 0;
    let dynamic_sse = dynamic_sse.for_max_sse(max_sse as f64);

    let traversal_result = mark_leaves(
        nested_map.as_ref(),
        max_sse,
        base_url,
        tile_meta,
        tile,
        camera_position,
        frustum,
        requesters,
        window,
        fog,
        dynamic_sse,
        degrade,
        rendered_tiles,
        features,
        renderable_features,
        f64::MAX, // Root tile has no parent
        is_v1_1,
        false,
        false,
    );

    if matches!(traversal_result, TraversalResult::Selected) {
        tile.state.leaf = true;
    }

    mark_rendered_tiles(
        commands,
        buf,
        layer_id,
        base_url,
        nested_map,
        tile,
        requesters,
        rendered_tiles,
        pool,
        &mut rendered_tiles_count,
        is_v1_1,
    );
}

/// Recursively marks tiles as leaves (to be rendered) based on SSE calculations.
///
/// This is the first phase of the traversal algorithm. It determines which tiles
/// in the hierarchy should be rendered by calculating screen-space error and
/// checking against the threshold.
///
/// # Algorithm
///
/// For each tile:
/// 1. Reset tile state from previous frame
/// 2. Check frustum visibility
/// 3. Calculate distance and SSE
/// 4. If SSE <= max_sse, mark as leaf (Selected)
/// 5. If SSE > max_sse and has children, recurse into children
/// 6. Handle REPLACE vs ADD refinement
///
/// # JSON-tile pivot
///
/// When this tile is a non-renderable JSON tile whose nested tileset has
/// finished loading (i.e. its `data_requester_id` is a key in
/// [`Cesium3dTilesNestedTreeMap`]), the children iteration uses the loaded
/// tileset's root tile as a single synthetic child instead of the empty
/// `tile_meta.children`. This is what makes traversal continuous across the
/// nested-tileset boundary.
#[allow(clippy::too_many_arguments)]
fn mark_leaves(
    nested_map: &Cesium3dTilesNestedTreeMap,
    max_sse: f32,
    base_url: &Arc<Url>,
    tile_meta: &Cesium3dTileContentMetadata,
    tile: &mut Cesium3dTileContent,
    camera_position: Vec3,
    frustum: &CameraFrustum,
    requesters: &Cesium3dTileContentRequesterQuery,
    window: &Window,
    fog: &Fog,
    dynamic_sse: DynamicSseTerm,
    degrade: SseDegrade,
    rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
    features: &Query<&FeatureId>,
    renderable_features: &Query<&RenderableFeature>,
    parent_geometric_error: f64,
    is_v1_1: bool,
    is_ancestor_activated: bool,
    meets_sse_ancestors: bool,
) -> TraversalResult {
    let were_children_loaded = tile.state.are_all_children_loaded;

    tile.reset_state();

    let within_frustum = matches!(
        &tile.bounding_volume,
        Some(bv) if frustum.intersection_with_bounding_volume(bv)
    );

    tile.state.is_visible = within_frustum;

    // Memory-pressure degrade: raise the effective threshold for far tiles
    // (computed from the f64 distance, before the f32 casts below).
    let mut effective_max_sse = max_sse as f64;
    let (distance_from_camera, sse) = match &tile.bounding_volume {
        Some(bv) => {
            // Tight bounding volumes (OBB for region/box) let us go back to
            // the standard point-to-volume Euclidean metric without the
            // off-axis ordering bias that an axis-aligned hull would have
            // produced. `.max(1.0)` only guards against the camera-inside-
            // volume case where distance collapses to 0.
            let distance_from_camera = bv.distance_to_point(camera_position).max(1.0);
            let mut sse = (tile_meta.geometric_error)
                / (distance_from_camera * (frustum.sse_denominator / window.height));
            // Distance-weighted LOD fog relaxation, mirroring
            // `Tile::calc_sse`: far tiles tolerate a larger error and stay
            // coarser. Negative values simply always meet the threshold.
            if fog.enabled {
                sse -= navara_fog::fog(distance_from_camera, fog.density) * fog.sse_factor;
            }
            // Tilt-scaled relaxation for horizon views (no-op when disabled).
            // Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTile.js#L950-L954
            sse -= dynamic_sse.relaxation(distance_from_camera);
            effective_max_sse = degrade.effective_max_sse(max_sse as f64, distance_from_camera);
            (distance_from_camera as f32, sse as f32)
        }
        None => (0., 0.),
    };

    tile.state.distance_from_camera = distance_from_camera;
    tile.state.sse = sse;

    // Pivot to the loaded nested tileset's metadata when this is a JSON tile
    // and its tileset has been parsed into the resource map.
    let nested = if !tile.is_renderable_content {
        tile.data_requester_id.and_then(|id| nested_map.get(&id))
    } else {
        None
    };

    let is_data_ready = if tile.is_renderable_content {
        let data_requester = match tile.data_requester_id {
            Some(id) => requesters.get(id).ok().map(
                |d: (
                    &super::Cesium3dTileContentDataRequesterMarker,
                    &navara_data_requester::DataRequester,
                )| d.1,
            ),
            None => None,
        };
        data_requester.is_some_and(|d| matches!(d.status, DataRequesterStatus::Success))
    } else {
        // A JSON tile is "data ready" the moment its tileset metadata is in the map.
        nested.is_some()
    };

    tile.state.is_data_loaded = is_data_ready;
    tile.state.touched = true;

    // Tiles with unrenderable content (JSON tilesets) should always be traversed through to find actual renderable content faster.
    let can_unconditionally_refine = matches!(tile.refine, Refine::Replace)
        && (!tile.is_renderable_content || parent_geometric_error < tile_meta.geometric_error);

    if !within_frustum && !can_unconditionally_refine {
        // To avoid showing an unexpected parent tile, select the direct culled tile.
        return TraversalResult::Selected;
    }

    let meets_sse = (sse as f64) <= effective_max_sse;

    if meets_sse && !can_unconditionally_refine && !were_children_loaded {
        return TraversalResult::Selected;
    }

    let is_activated = tile.is_active(rendered_tiles, features, renderable_features);

    // Choose the children metadata source. For loaded JSON tiles, treat the
    // nested tileset's root as a single synthetic child of this tile.
    let (child_meta_slice, child_base_url, child_is_v1_1) = match nested {
        Some(sub) => (
            std::slice::from_ref(&sub.metadata.root),
            &sub.base_url,
            sub.is_v1_1,
        ),
        None => (
            tile_meta.children.as_deref().unwrap_or(&[]),
            base_url,
            is_v1_1,
        ),
    };

    // If the children are rendered to fill the parent, the parent tile replaces them when it is ready.
    let hide_children =
        (meets_sse && is_activated) || (meets_sse_ancestors && is_ancestor_activated);

    if !child_meta_slice.is_empty() {
        if tile.children.is_none() {
            tile.children = Some(Vec::with_capacity(child_meta_slice.len()));
        }

        let mut all_children_rendered = true;
        let mut any_child_in_frustum = false;
        for (i, child_tile_meta) in child_meta_slice.iter().enumerate() {
            match tile.children.as_ref().unwrap().get(i) {
                Some(_) => {}
                None => {
                    let c = Cesium3dTileContent::new(child_tile_meta, Some(tile));
                    let tile_children = tile.children.as_mut().unwrap();
                    tile_children.push(c);
                }
            };

            let tile_children = tile.children.as_mut().unwrap();
            let child_tile = tile_children.get_mut(i).unwrap();

            match mark_leaves(
                nested_map,
                max_sse,
                child_base_url,
                child_tile_meta,
                child_tile,
                camera_position,
                frustum,
                requesters,
                window,
                fog,
                dynamic_sse,
                degrade,
                rendered_tiles,
                features,
                renderable_features,
                tile_meta.geometric_error,
                child_is_v1_1,
                if meets_sse_ancestors {
                    is_ancestor_activated
                } else {
                    is_activated
                },
                meets_sse,
            ) {
                TraversalResult::Selected => {
                    if hide_children {
                        child_tile.state.leaf = false;
                        child_tile.state.is_visible = false;
                        all_children_rendered = false;
                    } else {
                        any_child_in_frustum = true;
                        child_tile.state.leaf = true;
                    }

                    if !child_tile.is_renderable_content
                        || !child_tile.is_rendered(rendered_tiles, features, renderable_features)
                    {
                        all_children_rendered = false;
                    }
                }
                TraversalResult::ChildrenSelected => {
                    any_child_in_frustum = true;
                }
            }
        }

        // For REPLACE refinement, preload culled siblings when any sibling is in frustum.
        if matches!(tile.refine, Refine::Replace)
            && any_child_in_frustum
            && let Some(children) = &mut tile.children
            && !were_children_loaded
        {
            for child in children.iter_mut() {
                mark_for_preload(child);
            }
        }

        tile.state.are_all_children_loaded = all_children_rendered;

        if matches!(tile.refine, Refine::Add) {
            return TraversalResult::Selected;
        }

        if matches!(tile.refine, Refine::Replace) && all_children_rendered {
            // Mark this parent tile as leaf if children are rendered instead of this tile.
            if meets_sse && were_children_loaded {
                tile.state.leaf = true;
            }
            return TraversalResult::ChildrenSelected;
        }
    }

    TraversalResult::Selected
}

/// Marks a culled-but-touched sibling as a leaf so it is preloaded/rendered
/// alongside its in-frustum siblings (smooth REPLACE-refinement transitions).
///
/// Non-renderable JSON tiles have no geometry, so the mark must descend into
/// their synthetic-pivot subtree until it reaches the first renderable layer.
/// The recursion terminates at renderable tiles, at tiles with no children
/// (e.g. a JSON tile whose tileset hasn't been loaded yet), or at any tile
/// the current frame's traversal didn't visit (`!touched`).
fn mark_for_preload(tile: &mut Cesium3dTileContent) {
    if !tile.state.touched || tile.state.is_visible {
        return;
    }

    if !tile.is_renderable_content
        && let Some(children) = tile.children.as_mut()
    {
        for child in children.iter_mut() {
            mark_for_preload(child);
        }
    } else {
        tile.state.leaf = true;
        tile.state.is_visible = true;
    }
}

/// Second phase: spawns/updates rendered tile entities and requests tile data.
///
/// After [`mark_leaves`] determines which tiles should be rendered, this function
/// walks the tree and:
/// 1. Spawns [`RenderedCesium3dTileContent`] entities for visible leaf tiles
/// 2. Updates visibility state for existing rendered tiles
/// 3. Requests data for tiles that need loading
/// 4. Cleans up resources for tiles that are no longer needed
///
/// The same JSON-tile pivot used in [`mark_leaves`] applies here: when this
/// tile is a JSON tile with a loaded nested tileset, the children iterated
/// below are the synthetic single-element list rooted at the loaded
/// tileset's root.
///
/// Returns whether this tile's subtree still holds an *active* rendered-tile
/// entity — one that is visible, touched (in-frustum, or a REPLACE parent
/// mid-refinement), OR retained in the memory-budget pool. Pooled descendants
/// count as active so the subtree (and every `rendered_tile_id` link down to
/// them) is kept resident: a pan-back then reactivates the pooled tiles in
/// place without re-parsing the subtree or refetching content — the retention
/// pool's core guarantee. Only a subtree with NO visible/touched/pooled
/// rendered entity is pruned, so pruning never orphans a pool entry.
#[allow(clippy::too_many_arguments)]
fn mark_rendered_tiles(
    commands: &mut Commands,
    buf: &mut ResMut<BufferStore>,
    layer_id: Entity,
    base_url: &Arc<Url>,
    nested_map: &mut Cesium3dTilesNestedTreeMap,
    tile: &mut Cesium3dTileContent,
    requesters: &Cesium3dTileContentRequesterQuery,
    rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
    pool: &Cesium3dTilesRetentionPool,
    rendered_tiles_count: &mut u32,
    is_v1_1: bool,
) -> bool {
    let touched_last_frame = tile.state.touched_last_frame;
    tile.state.touched_last_frame = tile.state.touched;

    let state = &tile.state;

    let touched = state.touched || touched_last_frame;
    let leaf = state.leaf;

    let mut is_rendered = touched && state.is_rendered_last_frame;

    let priority = Priority::High;

    if tile.is_renderable_content {
        if touched && leaf {
            if state.is_data_loaded {
                let is_visible = state.is_visible;
                update_or_spawn_rendered_tile(
                    commands,
                    layer_id,
                    rendered_tiles,
                    tile,
                    is_visible,
                    touched,
                    is_v1_1,
                );
                if is_visible {
                    *rendered_tiles_count += 1;
                    is_rendered = true;
                }
            } else if state.is_visible {
                request_tile_content(
                    commands, buf, base_url, tile, requesters, priority, is_v1_1, layer_id,
                );
            } else {
                toggle_rendered_tile_visible(rendered_tiles, tile, false, touched);
            }
        } else {
            toggle_rendered_tile_visible(rendered_tiles, tile, false, touched);
        }
    } else if touched && leaf {
        // JSON tile. Spawn the metadata DataRequester when there is no live
        // in-flight request AND the subtree isn't already cached. The
        // "loaded and recurse into nested" case is handled by the
        // children-pivot below; there's nothing to do here when the
        // tileset is already loaded.
        let alive_requester = tile
            .data_requester_id
            .and_then(|id| requesters.get(id).ok())
            .is_some();
        let subtree_loaded = tile
            .data_requester_id
            .is_some_and(|id| nested_map.contains(&id));
        if !alive_requester
            && !subtree_loaded
            && let Some(uri) = tile.uri.as_ref()
        {
            let url = construct_child_tile_url(base_url, uri.as_str())
                .as_str()
                .to_string();

            let e = commands
                .spawn((
                    Cesium3dTilesMetadataDataRequesterMarker(layer_id),
                    Cesium3dTilesNestedMetadataDataRequesterMarker,
                    Cesium3dTileContentDataRequesterMarker,
                    priority,
                    RequestOrder(TileOrderByDistance {
                        distance_from_camera: tile.state.distance_from_camera,
                        sse: tile.state.sse,
                    }),
                    DataRequester::from_store(url, buf, DataRequesterExtension::Json),
                ))
                .id();
            tile.data_requester_id = Some(e);
        }
    }

    if !touched {
        remove_resources_if_no_rendered_tile(commands, tile, rendered_tiles, nested_map);
    }

    tile.reset_state();
    tile.state.is_rendered_last_frame = is_rendered;

    // Pivot for child base_url / is_v1_1 when descending into a loaded nested tileset.
    let (child_base_url, child_is_v1_1) = if !tile.is_renderable_content
        && let Some(id) = tile.data_requester_id
        && let Some(sub) = nested_map.get(&id)
    {
        (Arc::clone(&sub.base_url), sub.is_v1_1)
    } else {
        (Arc::clone(base_url), is_v1_1)
    };

    // "Active" = this tile owns a rendered entity that is visible or touched
    // (in-frustum, or a REPLACE parent mid-refinement), OR is retained in the
    // memory-budget pool. Pooled entities MUST keep the subtree alive: pruning
    // `children` would sever their `rendered_tile_id` link and strand them as
    // unrevivable orphans (the pool purge keeps `!is_visible && !touched`
    // entries forever, so a revisit would re-parse and refetch the whole
    // subtree, and each pan cycle would leak one dead orphaned copy into the
    // budget). Keeping the subtree resident is exactly the retention pool's
    // guarantee: a pan-back reactivates in place without refetching.
    let self_active = tile.rendered_tile_id.is_some_and(|id| {
        rendered_tiles
            .get(id)
            .is_ok_and(|t| t.is_visible || t.touched)
            || pool.entries.contains_key(&id)
    });

    let children = match tile.children.as_mut() {
        Some(c) => c,
        None => return self_active,
    };

    let mut children_active = false;
    for child_tile in children.iter_mut() {
        children_active |= mark_rendered_tiles(
            commands,
            buf,
            layer_id,
            &child_base_url,
            nested_map,
            child_tile,
            requesters,
            rendered_tiles,
            pool,
            rendered_tiles_count,
            child_is_v1_1,
        );
    }

    // Reset the reconstructable `children` runtime tree only once this tile is
    // out of touch AND its subtree holds no active rendered entity — where
    // "active" now includes pooled (retained) descendants (see `self_active`
    // above). A subtree that still owns any visible / touched / pooled rendered
    // tile is kept resident so its `rendered_tile_id` links survive: pruning it
    // would orphan those entities. Only a subtree with nothing rendered left is
    // dropped, so this can never strand a pool entry. The metadata is still
    // reclaimed for genuinely empty subtrees, and a revisit re-parses them from
    // the resident `tile_meta` / nested-tileset metadata.
    if !touched && !children_active {
        tile.state.are_all_children_loaded = false;
        tile.children = None;
    }

    self_active || children_active
}

/// Cleans up tile resources when no rendered tile exists.
///
/// Called when a tile is no longer touched during traversal. This function:
/// 1. Marks the data requester for deletion
/// 2. For nested JSON tiles, removes the cached metadata from
///    [`Cesium3dTilesNestedTreeMap`].
///
/// Runtime state for nested tiles (their `Cesium3dTileContent` subtree) is
/// stored as `tile.children` and is dropped by `mark_rendered_tiles` via its
/// out-of-touch prune (`!touched && !children_active`) — no extra work here.
fn remove_resources_if_no_rendered_tile(
    commands: &mut Commands,
    tile: &mut Cesium3dTileContent,
    rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
    nested_map: &mut Cesium3dTilesNestedTreeMap,
) {
    if tile
        .rendered_tile_id
        .and_then(|id| rendered_tiles.get(id).ok())
        .is_some()
    {
        return;
    }
    let Some(data_requester_id) = tile.data_requester_id.take() else {
        return;
    };
    let _ = commands
        .get_entity(data_requester_id)
        .as_mut()
        .map(|e| e.insert(Deleted));
    if !tile.is_renderable_content {
        let _ = nested_map.remove(&data_requester_id);
    }
}

/// Recursively marks all rendered tiles in a tree as invisible.
///
/// Used when an entire tile tree needs to be hidden, such as:
/// - Layer deletion
///
/// This triggers the cleanup chain:
/// 1. `is_visible = false` on rendered tiles
/// 2. `remove_invisible_rendered_tiles` system marks features as `Deleted`
/// 3. `remove_batched_feature` system cleans up buffers and batch table entries
///
/// Because nested-tile runtime state is stored as `tile.children`, the
/// recursion below already descends into nested tiles transparently.
pub fn mark_rendered_tiles_invisible(
    commands: &mut Commands,
    tile: &mut Cesium3dTileContent,
    rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
    nested_map: &mut Cesium3dTilesNestedTreeMap,
) {
    toggle_rendered_tile_visible(rendered_tiles, tile, false, false);
    remove_resources_if_no_rendered_tile(commands, tile, rendered_tiles, nested_map);

    let children = match &mut tile.children {
        Some(c) => c,
        None => return,
    };

    for child_tile in children {
        mark_rendered_tiles_invisible(commands, child_tile, rendered_tiles, nested_map);
    }
}

/// Toggles visibility of an existing rendered tile entity.
///
/// Returns `true` if the tile entity exists and was updated, `false` otherwise.
///
/// # Parameters
/// - `visible`: New visibility state
/// - `touched`: Whether the tile is still being touched (for REPLACE refinement)
fn toggle_rendered_tile_visible(
    rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
    tile: &mut Cesium3dTileContent,
    visible: bool,
    touched: bool,
) -> bool {
    let mut rendered_tile = tile
        .rendered_tile_id
        .and_then(|id| rendered_tiles.get_mut(id).ok());
    match &mut rendered_tile {
        Some(t) => {
            // Keep touching if the refine type is `Replace`.
            let touched = matches!(tile.refine, Refine::Replace) && touched;
            // Skip the write when nothing changed: a `DerefMut` here marks the
            // component `Changed`, which re-triggers the traversal system every
            // frame even with a static camera.
            if t.is_visible != visible || t.touched != touched {
                t.is_visible = visible;
                t.touched = touched;
            }
            true
        }
        None => false,
    }
}

/// Updates an existing rendered tile or spawns a new one.
///
/// This is the main function for creating [`RenderedCesium3dTileContent`] entities.
/// It first tries to update an existing entity; if none exists and the tile
/// should be visible, it spawns a new entity with the appropriate format marker:
///
/// - `.pnts` → [`RenderedCesium3dTileContentPntsMarker`] + [`TileTransform`] + [`Aabb`]
/// - `.b3dm` → [`RenderedCesium3dTileContentB3dmMarker`]
/// - `.glb`  → [`RenderedCesium3dTileContentGlbMarker`]
/// - `.glb` 3D Tiles 1.1 → [`RenderedCesium3dTileContentGltfFeaturesMarker`]
///
/// # Important
///
/// The spawned `RenderedCesium3dTileContent` entity triggers the corresponding
/// `construct_model_by_cesium3dtiles_layer` system via the `Added` query filter.
fn update_or_spawn_rendered_tile(
    commands: &mut Commands,
    layer_id: Entity,
    rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
    tile: &mut Cesium3dTileContent,
    visible: bool,
    touched: bool,
    is_v1_1: bool,
) {
    if toggle_rendered_tile_visible(rendered_tiles, tile, visible, touched) {
        return;
    }

    if visible {
        if tile.uri.as_ref().unwrap().ends_with("pnts") {
            let mut entity = commands.spawn((
                RenderedCesium3dTileContentPntsMarker,
                TileOrderByDistance {
                    distance_from_camera: tile.state.distance_from_camera,
                    sse: tile.state.sse,
                },
                RenderedCesium3dTileContent {
                    layer_id,
                    feature_id: None,
                    data_requester_id: tile.data_requester_id.unwrap(),
                    is_visible: true,
                    touched: true,
                },
                super::TileTransform {
                    transform: tile.transform.unwrap_or_default(),
                },
            ));

            let aabb = tile.bounding_volume.as_ref();
            if let Some(aabb) = aabb {
                entity.insert(aabb.clone());
            }

            tile.rendered_tile_id = Some(entity.id());
        } else if tile.uri.as_ref().unwrap().ends_with("b3dm") {
            tile.rendered_tile_id = Some(
                commands
                    .spawn((
                        RenderedCesium3dTileContentB3dmMarker,
                        TileOrderByDistance {
                            distance_from_camera: tile.state.distance_from_camera,
                            sse: tile.state.sse,
                        },
                        RenderedCesium3dTileContent {
                            layer_id,
                            feature_id: None,
                            data_requester_id: tile.data_requester_id.unwrap(),
                            is_visible: true,
                            touched: true,
                        },
                    ))
                    .id(),
            );
        } else if tile.uri.as_ref().unwrap().contains("glb") && is_v1_1 {
            let mut entity = commands.spawn((
                RenderedCesium3dTileContentGltfFeaturesMarker,
                TileOrderByDistance {
                    distance_from_camera: tile.state.distance_from_camera,
                    sse: tile.state.sse,
                },
                RenderedCesium3dTileContent {
                    layer_id,
                    feature_id: None,
                    data_requester_id: tile.data_requester_id.unwrap(),
                    is_visible: true,
                    touched: true,
                },
                super::TileTransform {
                    transform: tile.transform.unwrap_or_default(),
                },
            ));

            let aabb = tile.bounding_volume.as_ref();
            if let Some(aabb) = aabb {
                entity.insert(aabb.clone());
            }

            tile.rendered_tile_id = Some(entity.id());
        } else if tile.uri.as_ref().unwrap().contains("glb") {
            tile.rendered_tile_id = Some(
                commands
                    .spawn((
                        RenderedCesium3dTileContentGlbMarker,
                        TileOrderByDistance {
                            distance_from_camera: tile.state.distance_from_camera,
                            sse: tile.state.sse,
                        },
                        RenderedCesium3dTileContent {
                            layer_id,
                            feature_id: None,
                            data_requester_id: tile.data_requester_id.unwrap(),
                            is_visible: true,
                            touched: true,
                        },
                    ))
                    .id(),
            );
        } else if tile.uri.as_ref().unwrap().ends_with("gltf") {
            // Plain .gltf files (JSON + external .bin buffers) are not yet supported.
            // Only GLB (binary glTF container) is supported.
            warn!(
                "Plain .gltf format is not yet supported, only .glb is supported. Skipping tile: {:?}",
                tile.uri
            );
        } else {
            // TODO: support other formats like i3dm, cmpt, etc.
            unimplemented!("The tile format of {:?} isn't supported yet", tile.uri);
        }
    }
}

/// Constructs the full URL for a child tile content.
///
/// Handles relative URL resolution and query parameter inheritance from
/// the parent tileset URL.
fn construct_child_tile_url(base_url: &Url, child_url: &str) -> Url {
    let mut new_url: Url = base_url.clone().join(child_url).unwrap();
    let base_query = base_url.query_pairs().into_owned();
    let new_query: HashMap<String, String> = new_url.query_pairs().into_owned().collect();
    for (key, value) in base_query {
        if new_query.contains_key(&key) {
            continue;
        }
        new_url
            .query_pairs_mut()
            .append_pair(key.as_ref(), value.as_ref());
    }
    new_url
}

#[cfg(test)]
mod prune_tests {
    use super::*;
    use crate::Cesium3dTilesNestedTreeMap;
    use bevy_app::App;
    use bevy_ecs::system::{ResMut, SystemState};
    use navara_math::Transform;
    use navara_parser::cesium3dtiles::tileset::Refine;

    /// A renderable tile node whose `rendered_tile_id` points at `rendered`.
    fn renderable_child(rendered: Entity) -> Cesium3dTileContent {
        Cesium3dTileContent {
            uri: Some("a.b3dm".to_string()),
            data_requester_id: None,
            rendered_tile_id: Some(rendered),
            children: None,
            refine: Refine::Replace,
            is_renderable_content: true,
            bounding_volume: None,
            transform: Some(Transform::IDENTITY),
            state: Default::default(),
        }
    }

    /// An out-of-touch renderable parent holding a single `child`.
    fn untouched_parent(child: Cesium3dTileContent) -> Cesium3dTileContent {
        Cesium3dTileContent {
            uri: Some("p.b3dm".to_string()),
            data_requester_id: None,
            rendered_tile_id: None,
            children: Some(vec![child]),
            refine: Refine::Replace,
            is_renderable_content: true,
            bounding_volume: None,
            transform: Some(Transform::IDENTITY),
            state: Default::default(),
        }
    }

    fn spawn_rendered(app: &mut App, is_visible: bool, touched: bool) -> Entity {
        let layer_id = app.world_mut().spawn_empty().id();
        let data_requester_id = app.world_mut().spawn_empty().id();
        app.world_mut()
            .spawn(RenderedCesium3dTileContent {
                layer_id,
                feature_id: None,
                data_requester_id,
                is_visible,
                touched,
            })
            .id()
    }

    /// Runs `mark_rendered_tiles` on `root`, returning `root` afterward.
    /// `pooled` lists rendered entities to seed into the retention pool.
    #[allow(clippy::type_complexity)]
    fn run_mark(
        app: &mut App,
        mut root: Cesium3dTileContent,
        pooled: &[Entity],
    ) -> Cesium3dTileContent {
        let layer_id = app.world_mut().spawn_empty().id();
        let base_url = Arc::new(Url::parse("https://example.com/t.json").unwrap());
        let mut pool = Cesium3dTilesRetentionPool::default();
        for e in pooled {
            pool.entries.insert(
                *e,
                navara_memory::RetainedEntry {
                    retained_at: 0,
                    cost: navara_memory::TileCost::default(),
                },
            );
        }
        let mut state: SystemState<(
            Commands,
            ResMut<BufferStore>,
            ResMut<Cesium3dTilesNestedTreeMap>,
            Cesium3dTileContentRequesterQuery,
            Query<&mut RenderedCesium3dTileContent>,
        )> = SystemState::new(app.world_mut());
        {
            let (mut commands, mut buf, mut nested_map, requesters, mut rendered_tiles) =
                state.get_mut(app.world_mut()).unwrap();
            let mut count = 0;
            mark_rendered_tiles(
                &mut commands,
                &mut buf,
                layer_id,
                &base_url,
                &mut nested_map,
                &mut root,
                &requesters,
                &mut rendered_tiles,
                &pool,
                &mut count,
                false,
            );
        }
        state.apply(app.world_mut());
        root
    }

    fn new_app() -> App {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<Cesium3dTilesNestedTreeMap>();
        app
    }

    #[test]
    fn keeps_children_when_only_pooled_descendant() {
        // FIX 5: an out-of-touch parent whose sole descendant is a *pooled*
        // (invisible + untouched, but retention-pool member) rendered tile MUST
        // keep its `children` subtree resident. Pruning would sever the pooled
        // tile's `rendered_tile_id` link and strand it as an unrevivable orphan
        // (the pool purge keeps `!is_visible && !touched` entries forever), so a
        // pan-back would re-parse and refetch the whole subtree and each pan
        // cycle would leak one dead orphaned copy into the budget. Keeping the
        // subtree alive lets the pool reactivate the tile in place on revisit.
        let mut app = new_app();
        let pooled = spawn_rendered(&mut app, false, false);
        let root = untouched_parent(renderable_child(pooled));

        let root = run_mark(&mut app, root, &[pooled]);

        assert!(
            root.children.is_some(),
            "a pooled descendant must keep the subtree resident so it is not orphaned"
        );
        assert!(app.world().get_entity(pooled).is_ok());
    }

    #[test]
    fn prunes_children_when_no_rendered_descendant() {
        // A subtree with NO rendered entity at all (not visible, not touched,
        // not pooled) is safely pruned — there is no `rendered_tile_id` to
        // orphan — so its reconstructable metadata heap is reclaimed.
        let mut app = new_app();
        let orphaned = spawn_rendered(&mut app, false, false);
        // The rendered entity exists but is NOT in the retention pool.
        let root = untouched_parent(renderable_child(orphaned));

        let root = run_mark(&mut app, root, &[]);

        assert!(
            root.children.is_none(),
            "a subtree with no visible/touched/pooled rendered tile is pruned"
        );
    }

    #[test]
    fn keeps_children_when_descendant_active() {
        // Converse: a visible descendant is *active*, so pruning would orphan
        // its `rendered_tile_id`; `children` must be retained.
        let mut app = new_app();
        let visible = spawn_rendered(&mut app, true, false);
        let mut child = renderable_child(visible);
        // Drive the child down the "keep visible" branch of mark_rendered_tiles.
        child.state.touched = true;
        child.state.leaf = true;
        child.state.is_data_loaded = true;
        child.state.is_visible = true;
        let root = untouched_parent(child);

        let root = run_mark(&mut app, root, &[]);

        assert!(
            root.children.is_some(),
            "an active (visible) descendant must keep the subtree resident"
        );
    }

    #[test]
    fn keeps_children_when_descendant_touched() {
        // A touched (REPLACE parent mid-refinement) descendant is active too.
        let mut app = new_app();
        let touched_entity = spawn_rendered(&mut app, false, true);
        let mut child = renderable_child(touched_entity);
        child.state.touched = true;
        child.state.leaf = true;
        child.state.is_data_loaded = true;
        // Not visible, but its rendered entity carries `touched = true`.
        let root = untouched_parent(child);

        let root = run_mark(&mut app, root, &[]);

        assert!(
            root.children.is_some(),
            "a touched descendant must keep the subtree resident"
        );
    }
}
