//! PNTS format parser implementation for the `TileContentParser` trait.

use navara_buffer_store::{BufferStore, Handle};
use navara_core::CRS;
use navara_feature_component::batch::{FeatureBatchId, GlobalBatchIds};
use navara_material::{DracoAttributeId, ModelInternalMaterial};
use navara_math::{Transform, Vec3};
use navara_parser::pnts::*;

use crate::tile_content_parser::{ParseContext, ParsedTileContent, TileContentParser};

use super::{RenderedCesium3dTileContentPntsMarker, requester::PntsDataRequesterMarker};

/// PNTS tile content parser.
pub struct PntsParser;

impl TileContentParser for PntsParser {
    type RenderedMarker = RenderedCesium3dTileContentPntsMarker;
    type RequesterMarker = PntsDataRequesterMarker;

    fn parse(ctx: &mut ParseContext) -> Option<ParsedTileContent> {
        let (draco_attributes, positions_center, positions_handle) =
            get_geometry_info_from_pnts(ctx.buf, ctx.requester_handle)?;

        let transform = match ctx.tile_transform {
            Some(t) => *t,
            None => Transform::IDENTITY,
        };

        let tile_aabb = ctx.tile_aabb.cloned();

        Some(ParsedTileContent {
            coords: positions_center,
            crs: CRS::Geocentric,
            model_bin_handle: positions_handle,
            transform,
            feature_batch_id: FeatureBatchId(0),
            global_batch_ids: GlobalBatchIds {
                handle: Handle::default(),
                batch_length: 0,
                instance_feature_indices: None,
            },
            appearance_modifier: Some(Box::new(move |appearance| {
                appearance.internal = Some(ModelInternalMaterial {
                    draco_attributes,
                    point_cloud: true,
                    point_cloud_geodetic_normal: Vec3::ZERO,
                });
            })),
            extra_components: tile_aabb.map(|aabb| {
                Box::new(
                    move |entity_commands: &mut bevy_ecs::system::EntityCommands| {
                        entity_commands.insert(aabb);
                    },
                ) as crate::tile_content_parser::ExtraComponentsInserter
            }),
        })
    }
}

pub(crate) fn get_geometry_info_from_pnts(
    buf: &mut BufferStore,
    handle: Handle,
) -> Option<(Option<Vec<DracoAttributeId>>, Vec3, Handle)> {
    let pnts_bin = buf.get_u8(&handle)?;
    let pnts = Pnts::from_data(pnts_bin).ok()?;

    let feature_table_json: serde_json::Value =
        parse_json_to_struct(&pnts.feature_table.json).ok()?;

    let positions_center = match feature_table_json["RTC_CENTER"].as_array() {
        Some(center) => {
            let [x, y, z] = center.as_slice() else {
                return None;
            };
            Vec3::new(x.as_f64()?, y.as_f64()?, z.as_f64()?)
        }
        None => Vec3::ZERO,
    };

    let position_bin_data: Vec<u8>;
    let mut draco_attributes = None;
    if let Some(draco_meta) =
        feature_table_json["extensions"]["3DTILES_draco_point_compression"].as_object()
    {
        let properties = draco_meta.get("properties")?.as_object()?;
        let byte_offset = draco_meta.get("byteOffset")?.as_u64()?;
        let byte_length = draco_meta.get("byteLength")?.as_u64()?;

        let mut attributes = Vec::with_capacity(properties.len());
        for (semantic, unique_id) in properties {
            attributes.push(DracoAttributeId {
                semantic: semantic.clone(),
                unique_id: u32::try_from(unique_id.as_u64()?).ok()?,
            });
        }
        draco_attributes = Some(attributes);

        position_bin_data =
            copy_feature_table_range(&pnts.feature_table.binary, byte_offset, byte_length)?;
    } else {
        // `POSITION` is a float32 vec3 per point.
        const POSITION_BYTE_SIZE: u64 = 3 * 4;

        let positions_len = feature_table_json["POINTS_LENGTH"].as_u64()?;
        let positions_offset = feature_table_json["POSITION"]["byteOffset"].as_u64()?;
        let positions_byte_size = positions_len.checked_mul(POSITION_BYTE_SIZE)?;

        // TODO: support color, normal, etc for non-draco compressed data.
        position_bin_data = copy_feature_table_range(
            &pnts.feature_table.binary,
            positions_offset,
            positions_byte_size,
        )?;
    }

    let position_bin_handle = buf.new_u8(position_bin_data);

    // NOTE: buffer is removed here to prevent duplicating data.
    buf.remove(&handle);

    Some((draco_attributes, positions_center, position_bin_handle))
}

/// Copies `byte_length` bytes at `byte_offset` out of the feature table
/// binary; `None` when the tile's range does not fit in it.
fn copy_feature_table_range(binary: &[u8], byte_offset: u64, byte_length: u64) -> Option<Vec<u8>> {
    let start = usize::try_from(byte_offset).ok()?;
    let end = start.checked_add(usize::try_from(byte_length).ok()?)?;
    Some(binary.get(start..end)?.to_vec())
}

#[cfg(test)]
mod tests {
    use navara_parser::pnts::PNTS_HEADER_SIZE;

    use super::*;

    fn create_pnts(feature_table_json: &str, feature_table_binary: &[u8]) -> Vec<u8> {
        let mut json = feature_table_json.as_bytes().to_vec();
        while !json.len().is_multiple_of(8) {
            json.push(b' ');
        }
        let total = PNTS_HEADER_SIZE + json.len() + feature_table_binary.len();
        let mut data = Vec::with_capacity(total);
        data.extend_from_slice(b"pnts");
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&(total as u32).to_le_bytes());
        data.extend_from_slice(&(json.len() as u32).to_le_bytes());
        data.extend_from_slice(&(feature_table_binary.len() as u32).to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&json);
        data.extend_from_slice(feature_table_binary);
        data
    }

    #[test]
    fn it_should_extract_draco_blob_and_attribute_ids() {
        let pnts = create_pnts(
            r#"{"POINTS_LENGTH":2,"POSITION":{"byteOffset":0},"RGB":{"byteOffset":0},
            "extensions":{"3DTILES_draco_point_compression":
            {"byteOffset":2,"byteLength":3,"properties":{"POSITION":0,"RGB":1}}}}"#,
            &[9, 9, 1, 2, 3, 9],
        );
        let mut buf = BufferStore::new();
        let handle = buf.new_u8(pnts);

        let (draco_attributes, _, bin_handle) =
            get_geometry_info_from_pnts(&mut buf, handle).unwrap();

        let mut draco_attributes = draco_attributes.unwrap();
        draco_attributes.sort_by_key(|attribute| attribute.unique_id);
        assert_eq!(
            draco_attributes,
            vec![
                DracoAttributeId {
                    semantic: "POSITION".to_string(),
                    unique_id: 0,
                },
                DracoAttributeId {
                    semantic: "RGB".to_string(),
                    unique_id: 1,
                },
            ]
        );
        assert_eq!(buf.get_u8(&bin_handle).unwrap(), &[1, 2, 3]);
    }

    #[test]
    fn it_should_reject_malformed_draco_extension() {
        let pnts = create_pnts(
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},
            "extensions":{"3DTILES_draco_point_compression":{"byteOffset":0}}}"#,
            &[0; 12],
        );
        let mut buf = BufferStore::new();
        let handle = buf.new_u8(pnts);

        assert!(get_geometry_info_from_pnts(&mut buf, handle).is_none());
    }

    #[test]
    fn it_should_reject_out_of_range_feature_table_slices() {
        let cases = [
            // Draco blob starts past the binary.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},
            "extensions":{"3DTILES_draco_point_compression":
            {"byteOffset":64,"byteLength":1,"properties":{"POSITION":0}}}}"#,
            // Draco blob ends past the binary.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},
            "extensions":{"3DTILES_draco_point_compression":
            {"byteOffset":8,"byteLength":8,"properties":{"POSITION":0}}}}"#,
            // Draco range overflows.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},
            "extensions":{"3DTILES_draco_point_compression":
            {"byteOffset":8,"byteLength":18446744073709551615,"properties":{"POSITION":0}}}}"#,
            // Raw positions need more points than the binary holds.
            r#"{"POINTS_LENGTH":2,"POSITION":{"byteOffset":0}}"#,
            // Raw position byte size overflows.
            r#"{"POINTS_LENGTH":18446744073709551615,"POSITION":{"byteOffset":0}}"#,
            // Malformed RTC_CENTER.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},"RTC_CENTER":[1,2]}"#,
        ];
        for feature_table_json in cases {
            let mut buf = BufferStore::new();
            let handle = buf.new_u8(create_pnts(feature_table_json, &[0; 12]));

            assert!(
                get_geometry_info_from_pnts(&mut buf, handle).is_none(),
                "{feature_table_json}"
            );
            // A rejected tile leaves the store as it was.
            assert_eq!(buf.len(), 1, "{feature_table_json}");
            assert!(buf.contains(&handle), "{feature_table_json}");
        }
    }

    #[test]
    fn it_should_extract_raw_positions_without_draco() {
        let mut binary = Vec::new();
        for v in [1.0f32, 2.0, 3.0] {
            binary.extend_from_slice(&v.to_le_bytes());
        }
        let pnts = create_pnts(
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0}}"#,
            &binary,
        );
        let mut buf = BufferStore::new();
        let handle = buf.new_u8(pnts);

        let (draco_attributes, _, bin_handle) =
            get_geometry_info_from_pnts(&mut buf, handle).unwrap();

        assert!(draco_attributes.is_none());
        assert_eq!(buf.get_u8(&bin_handle).unwrap(), binary.as_slice());
    }
}
