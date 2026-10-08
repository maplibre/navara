//! glTF Features (3D Tiles 1.1) format parser implementation for the `TileContentParser` trait.

use bevy_log::warn;
use navara_core::CRS;
use navara_feature_component::batch::{
    BatchProperty, BatchTableValue, FeatureBatchId, GlobalBatchIds, GltfPropertyTable,
};
use navara_material::ModelInternalMaterial;
use navara_math::{PI_OVER_TWO, Quat, Transform, Vec3};
use navara_parser::cesium3dtiles::property_table::GlbSchemaParser;

use crate::tile_content_parser::{ParseContext, ParsedTileContent, TileContentParser};

use super::{
    RenderedCesium3dTileContentGltfFeaturesMarker, requester::GltfFeaturesDataRequesterMarker,
};

/// glTF Features (3D Tiles 1.1) tile content parser.
///
/// Parses `EXT_mesh_features` and `EXT_structural_metadata` extensions
/// from GLB data to extract feature IDs and property tables.
pub struct GltfFeaturesParser;

impl TileContentParser for GltfFeaturesParser {
    type RenderedMarker = RenderedCesium3dTileContentGltfFeaturesMarker;
    type RequesterMarker = GltfFeaturesDataRequesterMarker;

    fn parse(ctx: &mut ParseContext) -> Option<ParsedTileContent> {
        let glb_bin = ctx.buf.get_u8(&ctx.requester_handle)?;

        let glb_parser = match GlbSchemaParser::new(glb_bin) {
            Some(parser) => parser,
            None => {
                warn!("Failed to parse GLB binary. Plain .gltf files are not supported, only .glb");
                return None;
            }
        };

        // Extract feature information from EXT_mesh_features
        let feature_count = glb_parser.feature_count();
        let property_table_index = glb_parser.property_table_index();

        // Generate global batch IDs from active feature set
        let mut global_batch_ids = Vec::with_capacity(feature_count as usize);
        for _ in 0..feature_count {
            let g_id = ctx.batch_table.gen_global_batch_id().unwrap_or(0);
            global_batch_ids.push(g_id);
        }

        // Extract and register property table if available
        let feature_batch_id = if feature_count > 0 {
            let property_table_data = property_table_index
                .and_then(|idx| glb_parser.property_table(idx, ctx.tileset_schema));

            let batch_property = property_table_data.map(|table| {
                BatchProperty::Cesium3dTilesetV11(GltfPropertyTable {
                    table,
                    handle: ctx.requester_handle,
                    bin_data_start: glb_parser.bin_data_start,
                })
            });

            ctx.batch_table
                .add(Some(BatchTableValue {
                    properties: batch_property,
                    layer_id: Some(ctx.layer_id.to_owned()),
                }))
                .unwrap_or(0)
        } else {
            0
        };

        let batch_length = global_batch_ids.len();
        let ids_handle = ctx.buf.new_u32(global_batch_ids);

        // Compose the accumulated tile world-transform (from tileset.json hierarchy)
        // with the glTF-to-Navara Y-up→Z-up rotation. Inner rotation runs first in
        // glTF local space, then `tile_transform` places the tile in world ECEF.
        let y_up_to_z_up = Transform::from_rotation(Quat::from_rotation_x(PI_OVER_TWO));
        let transform = match ctx.tile_transform {
            Some(t) => t.mul_transform(y_up_to_z_up),
            None => y_up_to_z_up,
        };

        Some(ParsedTileContent {
            coords: Vec3::ZERO,
            crs: CRS::Geocentric,
            model_bin_handle: ctx.requester_handle,
            transform,
            feature_batch_id: FeatureBatchId(feature_batch_id),
            global_batch_ids: GlobalBatchIds {
                handle: ids_handle,
                batch_length: batch_length as u32,
                instance_feature_indices: None,
            },
            appearance_modifier: Some(Box::new(|material: &mut navara_material::ModelMaterial| {
                material.internal = Some(ModelInternalMaterial {
                    draco_attributes: None,
                    point_cloud: false,
                    point_cloud_geodetic_normal: Vec3::ZERO,
                });
            })),
            extra_components: None,
        })
    }
}
