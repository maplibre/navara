//! B3DM format parser implementation for the `TileContentParser` trait.

use bevy_log::error;
use navara_buffer_store::{BufferStore, Handle};
use navara_core::CRS;
use navara_feature_component::batch::{
    BatchProperty, BatchTable, BatchTableValue, FeatureBatchId, GlobalBatchIds,
};
use navara_math::{PI_OVER_TWO, Quat, Transform, Vec3};
use navara_parser::b3dm::B3dm;
use navara_parser::b3dm::BatchTable as B3dmBatchTable;
use navara_parser::glb::BinaryReader;

use crate::tile_content_parser::{ParseContext, ParsedTileContent, TileContentParser};

use super::{RenderedCesium3dTileContentB3dmMarker, requester::B3dmDataRequesterMarker};

/// B3DM tile content parser.
pub struct B3dmParser;

impl TileContentParser for B3dmParser {
    type RenderedMarker = RenderedCesium3dTileContentB3dmMarker;
    type RequesterMarker = B3dmDataRequesterMarker;
    const BIN_IS_GLTF: bool = true;

    fn parse(ctx: &mut ParseContext) -> Option<ParsedTileContent> {
        let (center, glb_bin_handle, batch_table, batch_length) =
            get_geometry_info_from_b3dm(ctx.buf, ctx.requester_handle)?;

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

        let batch_length = global_batch_ids.len();
        let ids_handle = ctx.buf.new_u32(global_batch_ids);

        Some(ParsedTileContent {
            coords: center,
            crs: CRS::Geocentric,
            model_bin_handle: glb_bin_handle,
            transform: Transform::from_rotation(Quat::from_rotation_x(PI_OVER_TWO)),
            feature_batch_id: FeatureBatchId(feature_batch_id),
            global_batch_ids: GlobalBatchIds {
                handle: ids_handle,
                batch_length: batch_length as u32,
                instance_feature_indices: None,
            },
            appearance_modifier: None,
            extra_components: None,
        })
    }
}

pub(crate) fn generate_global_batch_ids(
    batch_table_res: &mut BatchTable,
    batch_length: usize,
    global_batch_ids: &mut Vec<u32>,
) {
    for _i in 0..batch_length {
        let g_id = batch_table_res.gen_global_batch_id().unwrap_or(0);
        global_batch_ids.push(g_id);
    }
}

pub(crate) fn get_geometry_info_from_b3dm(
    buf: &mut BufferStore,
    handle: Handle,
) -> Option<(Vec3, Handle, B3dmBatchTable, usize)> {
    let b3dm_bin = buf.get_u8(&handle)?;
    let b3dm = B3dm::from_data(b3dm_bin).unwrap();
    let center = match b3dm.glb.0.json_chunk.data["extensions"]["CESIUM_RTC"]["center"].as_array() {
        Some(a) => {
            let mut center = Vec::with_capacity(a.len());
            for v in a {
                match v.as_f64() {
                    Some(v) => center.push(v),
                    None => continue,
                }
            }
            center
        }
        None => {
            error!("CESIUM_RTC could not find");
            return None;
        }
    };
    let glb_bin = match b3dm.extract_glb(b3dm_bin) {
        Ok(b) => b,
        Err(_) => unreachable!("B3DM should contain GLB"),
    };

    let glb_bin_handle = buf.new_u8(glb_bin);

    // NOTE: B3DM buffer is removed here to prevent duplicating data.
    buf.remove(&handle);

    let batch_length = b3dm.feature_table.json.batch_length.unwrap() as usize;

    Some((
        Vec3::new(center[0], center[1], center[2]),
        glb_bin_handle,
        b3dm.batch_table,
        batch_length,
    ))
}
