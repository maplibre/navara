//! Cesium 3D Tiles System Module
//!
//! This module contains the core ECS systems for loading, traversing, and managing
//! Cesium 3D Tiles datasets. The systems work together to implement a hierarchical
//! level-of-detail (LOD) rendering system based on screen-space error (SSE).
//!
//! # System Execution Order
//!
//! The systems are executed in an order (Check `lib.rs`):
//!
//! # Data Flow
//!
//! ```text
//! Cesium3dTilesLayer (added)
//!     ↓ request_metadata
//! DataRequester (for tileset.json)
//!     ↓ construct_cesium_3d_tiles_tree
//! Cesium3dTilesTree + Cesium3dTilesMetadata
//!     ↓ traverse_cesium_3d_tiles_tree → select_tiles (in traversal.rs)
//! RenderedCesium3dTileContent + marker (B3DM/PNTS/GLB)
//!     ↓ construct_model_by_cesium3dtiles_layer
//! ModelGeometry + ModelBin + other components
//!     ↓ navara_feature::model::system::transfer_mesh
//! RenderableFeature::Model (sent to renderer)
//! ```
//!
//! # Memory Management
//!
//! When a tile is no longer visible:
//! 1. `RenderedCesium3dTileContent.is_visible` is set to `false`
//! 2. `remove_invisible_rendered_tiles` marks related entities with `Deleted`
//! 3. `navara_feature::model::system::remove_batched_feature` cleans up:
//!    - Buffer data (`ModelBin`, `GlobalBatchIds`)
//!    - Batch table entries
//!    - Feature batch ID mappings

use crate::{
    Cesium3dTilesNestedSubtreeMetadata, Cesium3dTilesNestedTreeMap, RenderedCesium3dTileContent,
    TileOrderByDistance, b3dm::RenderedCesium3dTileContentB3dmMarker,
    cesium3dtiles::Cesium3dTilesNestedMetadataDataRequesterMarker,
    cesium3dtiles::traversal::select_tiles, glb::RenderedCesium3dTileContentGlbMarker,
    gltf_features::RenderedCesium3dTileContentGltfFeaturesMarker,
    pnts::RenderedCesium3dTileContentPntsMarker,
};
use bevy_ecs::{
    change_detection::DetectChanges,
    entity::Entity,
    query::{Added, Changed, Or, With, Without},
    system::{Commands, ParamSet, Query, Res, ResMut},
    world::Ref,
};
use bevy_log::{error, warn};
use navara_buffer_store::BufferStore;
use navara_camera::{CameraFrustum, CameraMarker};
use navara_component::{Deleted, Priority};

use navara_data_requester::{
    DataRequester, DataRequesterExtension, DataRequesterStatus, RequestOrder,
};
use navara_event_store::{EventStore, TilesetLoaded};
use navara_feature_component::{
    id::FeatureId,
    model::{ModelBin, ModelGeometry, ModelMarker},
    render::RenderableFeature,
};
use navara_fog::{DynamicSse, Fog};
use navara_layer::{
    Cesium3dTilesLayer, DeleteCesium3dTilesLayerMarker, LayerId, LayerStore,
    UpdateCesium3dTilesLayerMarker,
};
use navara_material::{Appearance, ModelMaterial};
use navara_math::{Transform, Vec3};
use navara_memory::{SseDegrade, SsePressure};
use navara_parser::cesium3dtiles::{self, metadata_entity::resolve_metadata_entity};
use navara_window::Window;
use std::sync::Arc;
use url::Url;

use super::{
    Cesium3dTilesMetadata, Cesium3dTilesMetadataDataRequesterMarker, Cesium3dTilesTree,
    traversal::mark_rendered_tiles_invisible,
    types::{Cesium3dTileContentRequesterQuery, ChangedCesium3dTileContentRequesterQuery},
};

/// Spawns a data requester to fetch the root tileset.json for newly added Cesium 3D Tiles layers.
///
/// This is the entry point for loading a 3D Tiles dataset. When a [`Cesium3dTilesLayer`]
/// component is added to an entity, this system spawns a [`DataRequester`] to fetch
/// the tileset.json metadata file.
///
/// # Spawned Components
///
/// - [`Cesium3dTilesMetadataDataRequesterMarker`] - Links the requester to the layer
/// - [`Priority::Medium`] - Request priority for the data fetcher
/// - [`DataRequester`] - Handles the actual HTTP request
/// - [`RequestOrder<TileOrderByDistance>`] - Secondary sort key for the request queue
pub fn request_metadata(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    source_store: Res<navara_source::SourceStore>,
    layers: Query<(Entity, &Cesium3dTilesLayer), Added<Cesium3dTilesLayer>>,
) {
    for (e, layer) in &layers {
        // Resolve the tileset.json URL live from the referenced source.
        let Some(base_url) = layer
            .source_id
            .as_deref()
            .and_then(|id| source_store.get(id))
            .and_then(|s| s.url())
        else {
            continue;
        };
        commands.spawn((
            Cesium3dTilesMetadataDataRequesterMarker(e),
            Priority::Medium,
            DataRequester::from_store(base_url.to_owned(), &mut buf, DataRequesterExtension::Json),
            RequestOrder(TileOrderByDistance::default()),
        ));
    }
}

/// Parses loaded tileset.json and constructs the tile tree structure.
///
/// When a [`DataRequester`] successfully fetches a tileset.json file, this system:
///
/// - **Root tilesets** (no [`Cesium3dTilesNestedMetadataDataRequesterMarker`])
///   are parsed into a [`Cesium3dTilesMetadata`] + [`Cesium3dTilesTree`] entity,
///   then the requester is marked [`Deleted`].
/// - **Nested tilesets** (with the marker) are parsed into a
///   [`Cesium3dTilesNestedSubtreeMetadata`] and inserted into
///   [`Cesium3dTilesNestedTreeMap`] keyed by the requester entity id.
///   The requester entity is **kept alive** so the parent JSON tile's
///   `data_requester_id` continues to resolve to a valid key for cleanup.
#[allow(clippy::type_complexity)]
pub fn construct_cesium_3d_tiles_tree(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    mut nested_map: ResMut<Cesium3dTilesNestedTreeMap>,
    requesters: Query<
        (
            Entity,
            &Cesium3dTilesMetadataDataRequesterMarker,
            &DataRequester,
            Option<&Cesium3dTilesNestedMetadataDataRequesterMarker>,
        ),
        (Changed<DataRequester>, Without<Deleted>),
    >,
    layers: Query<&Cesium3dTilesLayer>,
    mut events: ResMut<EventStore>,
) {
    for (e, marker, req, is_nested) in &requesters {
        // TODO: Handle fail
        if !matches!(req.status, DataRequesterStatus::Success) {
            continue;
        }

        let json_bin = buf.get_u8(&req.handle).unwrap();
        let tileset_json = match cesium3dtiles::tileset::Tileset::from_slice(json_bin) {
            Ok(d) => d,
            Err(e) => {
                error!("tileset.json is incorrect: {}", e);
                continue;
            }
        };
        buf.remove(&req.handle);

        let layer = match layers.get(marker.0) {
            Ok(l) => l,
            Err(_) => continue,
        };

        if is_nested.is_some() {
            let base_url = match Url::parse(&req.url) {
                Ok(u) => Arc::new(u),
                Err(err) => {
                    error!("nested tileset url is invalid: {}", err);
                    continue;
                }
            };
            if tileset_json.schema.is_some() || tileset_json.groups.is_some() {
                warn!(
                    "The schema and groups of a nested tileset are ignored; define them in the root tileset: {}",
                    req.url
                );
            }
            let is_v1_1 = tileset_json.asset.version == "1.1";
            nested_map.insert(
                e,
                Cesium3dTilesNestedSubtreeMetadata {
                    base_url,
                    metadata: tileset_json,
                    is_v1_1,
                },
            );
        } else {
            // Root tileset: requester is no longer needed after parse.
            commands.entity(e).insert(Deleted);

            let metadata = Cesium3dTilesMetadata(tileset_json);
            let tree = match Cesium3dTilesTree::new(&req.url, marker.0, layer, &metadata.0) {
                Ok(t) => t,
                Err(e) => {
                    error!("tileset.json might be incorrect: {}", e);
                    continue;
                }
            };

            events.tileset_loaded.push(TilesetLoaded {
                layer_id: layer.layer_id.clone(),
                metadata: metadata.0.metadata.as_ref().map(|m| {
                    resolve_metadata_entity(
                        tree.scope.schema.as_deref(),
                        &m.class_,
                        m.properties.as_ref(),
                    )
                    .to_string()
                }),
                schema: tree.scope.schema.as_ref().map(|s| s.to_string()),
            });
            commands.spawn((LayerId(layer.layer_id.clone()), metadata, tree));
        }
    }
}

/// Main traversal system that selects which tiles to render based on camera position.
///
/// This is the core system that implements the hierarchical LOD algorithm for 3D Tiles.
/// It traverses all tile trees, determining which tiles should be visible based on:
/// - Camera frustum culling (tiles outside view are culled)
/// - Screen-space error (SSE) threshold (determines LOD level)
/// - Tile data loading state
///
/// # Algorithm Overview
///
/// The traversal uses a depth-first approach with the following logic:
/// 1. Start from root tile of each tree
/// 2. Check if tile is within camera frustum
/// 3. Calculate SSE based on distance and geometric error
/// 4. If SSE > max_sse, traverse children (higher detail needed)
/// 5. If SSE <= max_sse, select this tile as leaf
/// 6. Handle REPLACE vs ADD refinement strategies
///
/// # Update Conditions
///
/// The system only runs when one of these conditions is true:
/// - Camera position/orientation changed
/// - Data requesters changed (new data loaded)
/// - Rendered tiles changed
/// - Renderable features changed
/// - New tree was added
/// - Nested tileset state changed
///
/// # Children Traversal
///
/// Children are only traversed after the parent tile's data is loaded.
/// This ensures proper LOD transitions and prevents "popping" artifacts.
///
/// # See Also
///
/// - [`select_tiles`](super::traversal::select_tiles) - The recursive tile selection function
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn traverse_cesium_3d_tiles_tree(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    mut nested_map: ResMut<Cesium3dTilesNestedTreeMap>,
    window: Res<Window>,
    mut tiles: Query<(&Cesium3dTilesMetadata, &mut Cesium3dTilesTree)>,
    camera: Query<(&CameraMarker, Ref<Transform>, Ref<CameraFrustum>)>,
    requesters: Cesium3dTileContentRequesterQuery,
    changed_requesters: ChangedCesium3dTileContentRequesterQuery,
    mut rendered_tiles: ParamSet<(
        Query<&mut RenderedCesium3dTileContent>,
        Query<
            (),
            Or<(
                Added<RenderedCesium3dTileContent>,
                Changed<RenderedCesium3dTileContent>,
            )>,
        >,
    )>,
    features: Query<&FeatureId>,
    mut renderable_features: ParamSet<(
        Query<&RenderableFeature>,
        Query<(), (Changed<RenderableFeature>, With<ModelMarker>)>,
    )>,
    fog_query: Query<(Ref<Fog>, Ref<DynamicSse>)>,
    pressure: Res<SsePressure>,
    pool: Res<crate::Cesium3dTilesRetentionPool>,
) {
    let is_data_requesters_changed = !changed_requesters.is_empty();
    let changed_rendered_tiles = !rendered_tiles.p1().is_empty();
    let changed_renderable_features = !renderable_features.p1().is_empty();

    let mut rendered_tiles = rendered_tiles.p0();
    let renderable_features = renderable_features.p0();

    let (fog, dynamic_sse, is_fog_changed) = match fog_query.single() {
        Ok((fog, dynamic_sse)) => (
            Fog::clone(&fog),
            DynamicSse::clone(&dynamic_sse),
            fog.is_changed() || dynamic_sse.is_changed(),
        ),
        Err(_) => (Fog::disabled(), DynamicSse::disabled(), false),
    };

    for (metadata, mut tree) in &mut tiles {
        for (_, camera, frustum) in &camera {
            let needs_update = is_data_requesters_changed
                || changed_rendered_tiles
                || changed_renderable_features
                || camera.is_added()
                || camera.is_changed()
                || frustum.is_added()
                || frustum.is_changed()
                || tree.is_added()
                || is_fog_changed
                || pressure.is_changed();
            if !needs_update {
                continue;
            }
            let camera_pos = camera.transform_point(Vec3::ZERO);
            // Memory-pressure LOD degrade, weighted by distance relative to
            // the camera's height above the ellipsoid.
            let camera_height = navara_core::WGS84_64
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
            // Reborrow so the fields borrow disjointly.
            let tree = &mut *tree;
            select_tiles(
                &mut commands,
                &mut buf,
                &mut nested_map,
                tree.layer_id,
                tree.max_sse,
                &tree.base_url,
                &metadata.0.root,
                &mut tree.root,
                camera_pos,
                &frustum,
                &requesters,
                &mut rendered_tiles,
                &features,
                &renderable_features,
                &pool,
                &window,
                &fog,
                dynamic_sse,
                degrade,
                tree.is_v1_1,
                &tree.scope,
            );
        }
    }
}

/// Updates material properties for all rendered tiles in a Cesium 3D Tiles layer.
///
/// When an [`UpdateCesium3dTilesLayerMarker`] is added to an entity, this system
/// propagates the material changes to:
/// 1. The layer's appearance configuration
/// 2. All rendered features in the layer store
/// 3. All currently rendered tiles and their associated features
///
/// The update marker entity is despawned after processing.
#[allow(clippy::type_complexity)]
pub fn update_cesium3dtiles_layer(
    mut commands: Commands,
    layer_store: Res<LayerStore>,
    updated: Query<(Entity, &UpdateCesium3dTilesLayerMarker)>,
    mut layers: Query<&mut Cesium3dTilesLayer>,
    mut rendered_features: Query<&mut RenderableFeature>,
    rendered_tiles: Query<
        &RenderedCesium3dTileContent,
        Or<(
            With<RenderedCesium3dTileContentPntsMarker>,
            With<RenderedCesium3dTileContentB3dmMarker>,
            With<RenderedCesium3dTileContentGltfFeaturesMarker>,
            With<RenderedCesium3dTileContentGlbMarker>,
        )>,
    >,
    mut features: Query<
        &mut ModelMaterial,
        (
            With<LayerId>,
            With<ModelGeometry>,
            With<ModelBin>,
            With<ModelMaterial>,
            With<Transform>,
        ),
    >,
) {
    for (e, u) in &updated {
        let layer_id = u.layer_id.clone();
        for mut l in &mut layers {
            if l.layer_id != layer_id {
                continue;
            }
            for a in &mut l.appearances {
                if let Appearance::Model(mat) = a {
                    let mut new_mat = u.material.clone();
                    new_mat.internal = mat.internal.clone();
                    *mat = new_mat;
                    mat.should_rotate_in_default = false;
                }
            }
        }
        if let Some(ids) = layer_store.get(&layer_id) {
            for id in ids {
                let mut f = match rendered_features.get_mut(*id) {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                if let RenderableFeature::Model { material, .. } = f.as_mut() {
                    let mut new_mat = u.material.clone();
                    new_mat.internal = material.internal.clone();
                    *material = new_mat;
                    material.should_rotate_in_default = false;
                }
            }
        }
        for rendered_tile in &rendered_tiles {
            if !matches!(layers.get(rendered_tile.layer_id), Ok(l) if l.layer_id == layer_id) {
                continue;
            }
            if let Some(mut mat) = rendered_tile
                .feature_id
                .and_then(|id| features.get_mut(id).ok())
            {
                let mut new_mat = u.material.clone();
                new_mat.internal = mat.internal.clone();
                *mat = new_mat;
                mat.should_rotate_in_default = false;
            }
        }
        commands.entity(e).despawn();
    }
}

/// Handles deletion of an entire Cesium 3D Tiles layer.
///
/// When a [`DeleteCesium3dTilesLayerMarker`] is added, this system:
/// 1. Marks all rendered tiles as invisible (triggers cleanup)
/// 2. Despawns the tile tree entity
/// 3. Removes the layer from the layer store
/// 4. Despawns the layer entity itself
/// 5. Despawns the deletion marker entity
///
/// # Memory Cleanup
///
/// By marking tiles as invisible via [`mark_rendered_tiles_invisible`], the
/// subsequent `remove_invisible_rendered_tiles` and `remove_batched_feature`
/// systems will clean up all associated resources.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn delete_cesium3dtiles_layer(
    mut commands: Commands,
    mut layer_store: ResMut<LayerStore>,
    mut nested_map: ResMut<Cesium3dTilesNestedTreeMap>,
    deleted: Query<(Entity, &DeleteCesium3dTilesLayerMarker)>,
    layers: Query<(Entity, &Cesium3dTilesLayer)>,
    mut tiles: Query<(Entity, &LayerId, &mut Cesium3dTilesTree)>,
    mut rendered_tiles: Query<&mut RenderedCesium3dTileContent>,
    mut events: ResMut<EventStore>,
) {
    for (e, d) in &deleted {
        events.tileset_unloaded.push(d.0.clone());
        for (e, layer_id, mut tree) in &mut tiles {
            if layer_id.0 != d.0 {
                continue;
            }
            mark_rendered_tiles_invisible(
                &mut commands,
                &mut tree.root,
                &mut rendered_tiles,
                &mut nested_map,
            );
            commands.entity(e).despawn();
            layer_store.remove(&layer_id.0);
        }
        for (e, l) in &layers {
            if l.layer_id != d.0 {
                continue;
            }
            commands.entity(e).despawn();
        }
        commands.entity(e).despawn();
    }
}
