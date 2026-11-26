//! I3DM format parser implementation for the `TileContentParser` trait.
//!
//! The glTF of the tile is rewritten to instance itself with
//! `EXT_mesh_gpu_instancing`, so it renders as any other glTF content.
//!
//! ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/Instanced3DModel/README.adoc

use bevy_log::warn;
use navara_core::CRS;
use navara_feature_component::batch::{
    BatchProperty, BatchTableValue, FeatureBatchId, GlobalBatchIds,
};
use navara_material::{ModelInternalMaterial, ModelMaterial};
use navara_math::Vec3;
use navara_parser::b3dm::BatchTable as B3dmBatchTable;
use navara_parser::pnts::parse_json_to_struct;

use crate::b3dm::parser::generate_global_batch_ids;
use crate::tile_content_parser::{
    ParseContext, ParsedTileContent, TileContentParser, gltf_placement,
};

use super::instances::{Instances, read_instances};
use super::instancing_glb::instance_glb;
use super::{RenderedCesium3dTileContentI3dmMarker, requester::I3dmDataRequesterMarker};

const I3DM_HEADER_SIZE: usize = 32;

/// I3DM tile content parser.
pub struct I3dmParser;

impl TileContentParser for I3dmParser {
    type RenderedMarker = RenderedCesium3dTileContentI3dmMarker;
    type RequesterMarker = I3dmDataRequesterMarker;
    const BIN_IS_GLTF: bool = true;

    fn parse(ctx: &mut ParseContext) -> Option<ParsedTileContent> {
        let (glb, instances, batch_table) = match read_i3dm(ctx.buf.get_u8(&ctx.requester_handle)?)
        {
            Ok(parsed) => parsed,
            Err(e) => {
                warn!("Failed to parse I3DM: {e}");
                return None;
            }
        };
        // The glb replaces the tile, which nothing reads anymore.
        ctx.buf.remove(&ctx.requester_handle);
        let glb_handle = ctx.buf.new_u8(glb);

        let (coords, transform) = gltf_placement(ctx.tile_transform, instances.center);

        let batch_length = instances.batch_length as usize;
        let mut global_batch_ids = Vec::with_capacity(batch_length);
        generate_global_batch_ids(ctx.batch_table, batch_length, &mut global_batch_ids);
        let feature_batch_id = if batch_length > 0 {
            ctx.batch_table
                .add(Some(BatchTableValue {
                    properties: Some(BatchProperty::Cesium3dTileset(batch_table)),
                    layer_id: Some(ctx.layer_id.to_owned()),
                }))
                .unwrap_or(0)
        } else {
            0
        };

        Some(ParsedTileContent {
            coords,
            crs: CRS::Geocentric,
            model_bin_handle: glb_handle,
            transform,
            feature_batch_id: FeatureBatchId(feature_batch_id),
            global_batch_ids: GlobalBatchIds {
                handle: ctx.buf.new_u32(global_batch_ids),
                batch_length: batch_length as u32,
                instance_feature_indices: None,
            },
            appearance_modifier: Some(Box::new(|material: &mut ModelMaterial| {
                material.internal = Some(ModelInternalMaterial {
                    draco_attributes: None,
                    point_cloud: false,
                    point_cloud_geodetic_normal: Vec3::ZERO,
                    point_cloud_layout: None,
                    gltf_feature_ids: true,
                    gltf_property_table: None,
                });
            })),
            extra_components: None,
        })
    }
}

/// The instancing glb, instances and batch table of an I3DM tile.
fn read_i3dm(tile: &[u8]) -> Result<(Vec<u8>, Instances, B3dmBatchTable), &'static str> {
    let header = tile
        .get(..I3DM_HEADER_SIZE)
        .filter(|header| header.starts_with(b"i3dm"))
        .ok_or("invalid header")?;
    let [_, _, _, ft_json, ft_binary, bt_json, bt_binary, gltf_format] =
        header.as_chunks::<4>().0.try_into().unwrap();
    let mut sections = [ft_json, ft_binary, bt_json, bt_binary].into_iter().scan(
        I3DM_HEADER_SIZE,
        |start, length| {
            let length = u32::from_le_bytes(length) as usize;
            let range = *start..*start + length;
            *start = range.end;
            Some(range)
        },
    );
    let mut section = || tile.get(sections.next().unwrap()).ok_or("truncated tile");
    let (ft_json, ft_binary, bt_json, bt_binary) = (section()?, section()?, section()?, section()?);

    if u32::from_le_bytes(gltf_format) != 1 {
        return Err("the glTF referenced by URI (gltfFormat 0) was not embedded");
    }
    let glb_start =
        I3DM_HEADER_SIZE + ft_json.len() + ft_binary.len() + bt_json.len() + bt_binary.len();
    let glb = &tile[glb_start..];

    let feature_table: serde_json::Value =
        parse_json_to_struct(ft_json).map_err(|_| "invalid feature table JSON")?;
    let instances = read_instances(&feature_table, ft_binary).ok_or("invalid feature table")?;
    let glb = instance_glb(glb, &instances).ok_or("invalid glTF")?;
    let batch_table = B3dmBatchTable {
        json_data: bt_json.to_vec(),
        binary_data: bt_binary.to_vec(),
    };
    Ok((glb, instances, batch_table))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn create_i3dm(
        feature_table: &serde_json::Value,
        ft_binary: &[u8],
        gltf_format: u32,
    ) -> Vec<u8> {
        let mut ft_json = serde_json::to_vec(feature_table).unwrap();
        ft_json.resize(ft_json.len().next_multiple_of(8), b' ');
        let gltf = serde_json::to_vec(&json!({
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "mesh": 0 }],
            "meshes": [{ "primitives": [] }],
        }))
        .unwrap();
        let mut glb = Vec::new();
        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&((20 + gltf.len()) as u32).to_le_bytes());
        glb.extend_from_slice(&(gltf.len() as u32).to_le_bytes());
        glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
        glb.extend_from_slice(&gltf);

        let mut tile = Vec::new();
        tile.extend_from_slice(b"i3dm");
        for value in [
            1,
            0,
            ft_json.len() as u32,
            ft_binary.len() as u32,
            0,
            0,
            gltf_format,
        ] {
            tile.extend_from_slice(&value.to_le_bytes());
        }
        tile.extend_from_slice(&ft_json);
        tile.extend_from_slice(ft_binary);
        tile.extend_from_slice(&glb);
        tile
    }

    #[test]
    fn reads_an_embedded_glb() {
        let binary: Vec<u8> = [1f32, 2., 3.]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let tile = create_i3dm(
            &json!({ "INSTANCES_LENGTH": 1, "POSITION": { "byteOffset": 0 } }),
            &binary,
            1,
        );
        let (glb, instances, _) = read_i3dm(&tile).unwrap();
        assert!(glb.starts_with(b"glTF"));
        assert_eq!(instances.batch_ids, [0]);
    }

    #[test]
    fn rejects_a_glb_referenced_by_uri() {
        let tile = create_i3dm(&json!({ "INSTANCES_LENGTH": 0 }), &[], 0);
        assert!(read_i3dm(&tile).is_err());
    }
}
