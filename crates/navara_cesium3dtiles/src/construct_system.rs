//! Generic construct system for all tile content formats.
//!
//! This system handles the common lifecycle of constructing model entities
//! from tile data. Format-specific parsing is delegated to `TileContentParser`
//! implementations.

use bevy_ecs::{
    entity::Entity,
    query::{Added, With, Without},
    system::{Commands, Query, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::Deleted;
use navara_core::Aabb;
use navara_data_requester::{DataRequester, DataRequesterStatus};
use navara_feature_component::{
    batch::BatchTable,
    id::FeatureId,
    model::{ModelBin, ModelGeometry, TileContentMetadata},
};
use navara_layer::{Cesium3dTilesLayer, LayerId};
use navara_material::Appearance;
use navara_memory::TileCost;

use crate::{
    Cesium3dTileContentDataRequesterMarker, Cesium3dTilesTree, RenderedCesium3dTileContent,
    TileOrderByDistance, TileTransform, gltf_resource_base,
    tile_content_parser::{ParseContext, TileContentParser},
};

/// Generic system that constructs model entities from tile data.
///
/// Triggered when a `RenderedCesium3dTileContent` with the format-specific
/// tile marker is added. Delegates parsing to `T::parse()` and handles
/// the common spawn logic.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn construct_model_by_cesium3dtiles_layer<T: TileContentParser>(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    mut batch_table_res: ResMut<BatchTable>,
    requesters: Query<
        (
            &Cesium3dTileContentDataRequesterMarker,
            &T::RequesterMarker,
            &DataRequester,
        ),
        Without<Deleted>,
    >,
    mut rendered_tiles: Query<
        (
            Entity,
            &mut RenderedCesium3dTileContent,
            Option<&TileTransform>,
            Option<&Aabb>,
            Option<&TileContentMetadata>,
            &TileOrderByDistance,
        ),
        (With<T::RenderedMarker>, Added<RenderedCesium3dTileContent>),
    >,
    layers: Query<(Entity, &Cesium3dTilesLayer)>,
    trees: Query<&Cesium3dTilesTree>,
    mut estimates: ResMut<navara_memory::ReserveEstimates>,
    mut model_index: ResMut<crate::cleanup_system::ModelContentIndex>,
) {
    for (rendered_tile_entity, mut tile, tile_transform, tile_aabb, metadata, _) in
        rendered_tiles.iter_mut().sort::<&TileOrderByDistance>()
    {
        let (_, _, req) = match requesters.get(tile.data_requester_id) {
            Ok(v) => v,
            Err(_) => continue,
        };
        // TODO: Handle fail
        if !matches!(req.status, DataRequesterStatus::Success) {
            continue;
        }
        let (_, layer) = match layers.get(tile.layer_id) {
            Ok(l) => l,
            Err(_) => continue,
        };
        let mut appearance = Appearance::clone_model_or_default(&layer.appearances);
        appearance.should_rotate_in_default = false;

        // Tileset-level schema (needed for glTF Features)
        let tileset_schema = trees
            .iter()
            .find(|tree| tree.layer_id == tile.layer_id)
            .and_then(|tree| tree.scope.schema.as_deref());

        // Copy handle before borrowing buf mutably (Handle is Copy/i32)
        let requester_handle = req.handle;

        // GPU cost estimate: the payload size is a reasonable proxy for the
        // decoded geometry the JS side uploads to the GPU. The payload's own
        // heap bytes are already covered by the BufferStore accounting.
        let payload_gpu_est = buf
            .get(&requester_handle)
            .map(|b| b.byte_len() as u64)
            .unwrap_or(0);

        let mut ctx = ParseContext {
            buf: &mut buf,
            batch_table: &mut batch_table_res,
            requester_handle,
            layer_id: &layer.layer_id,
            tile_transform: tile_transform.map(|t| &t.transform),
            tile_aabb,
            tileset_schema,
        };

        let parsed = match T::parse(&mut ctx) {
            Some(p) => p,
            None => continue,
        };

        // Apply format-specific appearance modifications
        if let Some(modifier) = parsed.appearance_modifier {
            modifier(&mut appearance);
        }

        // Spawn entity with common components
        let mut entity_commands = commands.spawn((
            LayerId(layer.layer_id.to_owned()),
            FeatureId::default(),
            parsed.feature_batch_id,
            parsed.global_batch_ids,
            ModelGeometry {
                coords: parsed.coords,
                crs: parsed.crs,
            },
            appearance,
            ModelBin {
                handle: parsed.model_bin_handle,
                gltf_resource: if T::BIN_IS_GLTF {
                    gltf_resource_base(&req.url)
                } else {
                    None
                },
            },
            parsed.transform,
        ));

        // Apply format-specific extra components (e.g., Aabb for PNTS)
        if let Some(extra) = parsed.extra_components {
            extra(&mut entity_commands);
        }
        if let Some(metadata) = metadata {
            entity_commands.insert(metadata.clone());
        }

        let model_geometry = entity_commands.id();
        tile.feature_id = Some(model_geometry);
        // Index ModelGeometry → content so `report_feature_gpu_bytes` inverts the
        // link in O(1) instead of scanning every rendered content. Removed on the
        // content's destroy path (`destroy_rendered_tile_content`).
        model_index
            .content_by_model
            .insert(model_geometry, rendered_tile_entity);

        commands.entity(rendered_tile_entity).insert(TileCost {
            cpu: 0,
            gpu_est: payload_gpu_est,
        });
        // Feed the per-tileset reservation estimator with the landed actual
        // cost — the same value the `TileCost` above binds to the ledger, i.e.
        // what the dispatch-time `ReservedCost` was protecting until this
        // moment. Failed fetches never reach here (status must be Success and
        // parse must succeed); an evicted-then-refetched content records again.
        estimates.record(
            navara_memory::ReserveKey::Tiles3dLayer(tile.layer_id),
            payload_gpu_est,
        );
    }
}
