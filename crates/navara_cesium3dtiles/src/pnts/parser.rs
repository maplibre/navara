//! PNTS format parser implementation for the `TileContentParser` trait.

use navara_buffer_store::{BufferStore, Handle};
use navara_core::CRS;
use navara_feature_component::batch::{FeatureBatchId, GlobalBatchIds};
use navara_material::{
    DracoAttributeId, ModelInternalMaterial, PointCloudLayout, PointColorsFormat,
    PointPositionsFormat,
};
use navara_math::{Transform, Vec3};
use navara_parser::pnts::{PNTS_HEADER_SIZE, PntsHeader, parse_json_to_struct};

use crate::feature_table::{f32x3, global_bytes, global_vec3};
use crate::tile_content_parser::{ParseContext, ParsedTileContent, TileContentParser};

use super::{RenderedCesium3dTileContentPntsMarker, requester::PntsDataRequesterMarker};

/// PNTS tile content parser.
pub struct PntsParser;

impl TileContentParser for PntsParser {
    type RenderedMarker = RenderedCesium3dTileContentPntsMarker;
    type RequesterMarker = PntsDataRequesterMarker;
    const BIN_IS_GLTF: bool = false;

    fn parse(ctx: &mut ParseContext) -> Option<ParsedTileContent> {
        let (internal, positions_center) =
            get_geometry_info_from_pnts(ctx.buf, ctx.requester_handle)?;

        let transform = match ctx.tile_transform {
            Some(t) => *t,
            None => Transform::IDENTITY,
        };

        let tile_aabb = ctx.tile_aabb.cloned();

        Some(ParsedTileContent {
            coords: positions_center,
            crs: CRS::Geocentric,
            // The tile itself is the bin; `PointCloudLayout` says where its
            // points are.
            model_bin_handle: ctx.requester_handle,
            transform,
            feature_batch_id: FeatureBatchId(0),
            global_batch_ids: GlobalBatchIds {
                handle: Handle::default(),
                batch_length: 0,
                instance_feature_indices: None,
            },
            appearance_modifier: Some(Box::new(move |appearance| {
                appearance.internal = Some(internal);
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

/// Feature table semantics that hold per-point colors, in the spec's
/// precedence, with their format and bytes per point.
const COLOR_SEMANTICS: [(&str, PointColorsFormat, u64); 3] = [
    ("RGBA", PointColorsFormat::Rgba8, 4),
    ("RGB", PointColorsFormat::Rgb8, 3),
    ("RGB565", PointColorsFormat::Rgb565, 2),
];

/// Reads where the points of a PNTS tile sit in it, with the center its
/// positions are relative to. The tile itself becomes the model bin, cut
/// down to the header and feature table, which hold every point.
///
/// ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/PointCloud/README.adoc#semantics
pub(crate) fn get_geometry_info_from_pnts(
    buf: &mut BufferStore,
    handle: Handle,
) -> Option<(ModelInternalMaterial, Vec3)> {
    let (internal, positions_center, feature_table_end) = read_pnts(buf.get_u8(&handle)?)?;
    // Nothing reads the batch table, so drop it rather than keep it for the
    // tile's lifetime.
    if let Some(mut tile) = buf.remove_u8(&handle) {
        if tile.len() > feature_table_end {
            tile.truncate(feature_table_end);
            tile.shrink_to_fit();
        }
        buf.set_u8(handle, tile);
    }
    Some((internal, positions_center))
}

/// [`get_geometry_info_from_pnts`] on the tile bytes, with where its feature
/// table ends.
fn read_pnts(pnts: &[u8]) -> Option<(ModelInternalMaterial, Vec3, usize)> {
    let (feature_table_json, binary, binary_offset) = split_feature_table(pnts)?;

    let feature_table_json: serde_json::Value = parse_json_to_struct(feature_table_json).ok()?;

    let points_length = feature_table_json["POINTS_LENGTH"].as_u64()?;
    let point_count = u32::try_from(points_length).ok()?;
    // Offset into the tile of `byte_length` bytes at `byte_offset` of the
    // feature table binary.
    let range = |byte_offset: u64, byte_length: u64| {
        feature_table_range(binary, binary_offset, byte_offset, byte_length)
    };

    let mut positions_center = match feature_table_json.get("RTC_CENTER") {
        Some(center) => global_vec3(center, binary)?,
        None => Vec3::ZERO,
    };

    let mut draco_attributes = None;
    let mut draco_has_positions = false;
    let mut draco_has_colors = false;
    let mut draco_byte_offset = 0;
    let mut draco_byte_length = 0;
    if let Some(draco_meta) =
        feature_table_json["extensions"]["3DTILES_draco_point_compression"].as_object()
    {
        let properties = draco_meta.get("properties")?.as_object()?;
        let byte_offset = draco_meta.get("byteOffset")?.as_u64()?;
        let byte_length = draco_meta.get("byteLength")?.as_u64()?;

        let mut attributes = Vec::with_capacity(properties.len());
        for (semantic, unique_id) in properties {
            draco_has_positions |= semantic == "POSITION";
            draco_has_colors |= COLOR_SEMANTICS.iter().any(|(s, ..)| s == semantic);
            attributes.push(DracoAttributeId {
                semantic: semantic.clone(),
                unique_id: u32::try_from(unique_id.as_u64()?).ok()?,
            });
        }
        draco_attributes = Some(attributes);
        draco_byte_offset = range(byte_offset, byte_length)?;
        draco_byte_length = u32::try_from(byte_length).ok()?;
    }

    let mut positions_origin = Vec3::ZERO;
    let mut quantized_volume_scale = Vec3::ZERO;
    // A Draco blob without `POSITION` leaves the positions in the feature
    // table, like any semantic it does not list.
    let (positions_format, positions_byte_offset, positions_byte_length) = if draco_has_positions {
        (PointPositionsFormat::Draco, 0, 0)
    } else if let Some(offset) = feature_table_json["POSITION"]["byteOffset"].as_u64() {
        // float32 vec3 per point.
        let byte_length = points_length.checked_mul(3 * 4)?;
        let byte_offset = range(offset, byte_length)?;
        if positions_center == Vec3::ZERO
            && points_length > 0
            && let Some(first) = pnts[byte_offset as usize..].first_chunk::<12>()
        {
            // Absolute positions: re-center on the first point, or the model
            // origin is the Earth's center, where the geodetic normal is NaN.
            positions_origin = f32x3(first);
            positions_center = positions_origin;
        }
        (PointPositionsFormat::Float32, byte_offset, byte_length)
    } else {
        // uint16 vec3 per point, normalized to the quantized volume.
        let offset = feature_table_json["POSITION_QUANTIZED"]["byteOffset"].as_u64()?;
        let byte_length = points_length.checked_mul(3 * 2)?;
        positions_center += global_vec3(&feature_table_json["QUANTIZED_VOLUME_OFFSET"], binary)?;
        quantized_volume_scale =
            global_vec3(&feature_table_json["QUANTIZED_VOLUME_SCALE"], binary)?;
        (
            PointPositionsFormat::Uint16,
            range(offset, byte_length)?,
            byte_length,
        )
    };

    let (colors_format, colors_byte_offset, constant_color) = if draco_has_colors {
        (PointColorsFormat::None, 0, 0)
    } else {
        point_colors(&feature_table_json, binary, binary_offset, points_length)?
    };

    let layout = PointCloudLayout {
        point_count,
        positions_format,
        positions_byte_offset,
        positions_byte_length: u32::try_from(positions_byte_length).ok()?,
        positions_origin,
        quantized_volume_scale,
        draco_byte_offset,
        draco_byte_length,
        colors_format,
        colors_byte_offset,
        constant_color,
    };
    let internal = ModelInternalMaterial {
        draco_attributes,
        point_cloud: true,
        point_cloud_geodetic_normal: Vec3::ZERO,
        point_cloud_layout: Some(layout),
        gltf_feature_ids: false,
        gltf_property_table: None,
    };
    Some((internal, positions_center, binary_offset + binary.len()))
}

/// The first color semantic of the tile in the spec's precedence `RGBA`,
/// `RGB`, `RGB565`, `CONSTANT_RGBA`, with the offset of per-point colors into
/// the tile or the constant color; `None` when they are malformed.
fn point_colors(
    feature_table_json: &serde_json::Value,
    binary: &[u8],
    binary_offset: usize,
    points_length: u64,
) -> Option<(PointColorsFormat, u32, u32)> {
    for (semantic, format, bytes_per_point) in COLOR_SEMANTICS {
        if let Some(offset) = feature_table_json[semantic]["byteOffset"].as_u64() {
            let byte_length = points_length.checked_mul(bytes_per_point)?;
            let byte_offset = feature_table_range(binary, binary_offset, offset, byte_length)?;
            return Some((format, byte_offset, 0));
        }
    }
    if let Some(constant) = feature_table_json.get("CONSTANT_RGBA") {
        let rgba = match global_bytes::<4>(constant, binary) {
            Some(bytes) => *bytes,
            None => {
                let [r, g, b, a] = constant.as_array()?.as_slice() else {
                    return None;
                };
                let mut rgba = [0; 4];
                for (dst, c) in rgba.iter_mut().zip([r, g, b, a]) {
                    *dst = u8::try_from(c.as_u64()?).ok()?;
                }
                rgba
            }
        };
        return Some((PointColorsFormat::Constant, 0, u32::from_be_bytes(rgba)));
    }
    Some((PointColorsFormat::None, 0, 0))
}

/// The feature table JSON and binary of a PNTS tile, with the binary's byte
/// offset in the tile.
fn split_feature_table(pnts: &[u8]) -> Option<(&[u8], &[u8], usize)> {
    let header = PntsHeader::parse(pnts)?;
    let json_length = usize::try_from(header.feature_table_json_byte_length).ok()?;
    let binary_length = usize::try_from(header.feature_table_binary_byte_length).ok()?;
    let binary_offset = PNTS_HEADER_SIZE.checked_add(json_length)?;
    let json = pnts.get(PNTS_HEADER_SIZE..binary_offset)?;
    let binary = pnts.get(binary_offset..binary_offset.checked_add(binary_length)?)?;
    Some((json, binary, binary_offset))
}

/// Offset into the tile of the `byte_length` bytes at `byte_offset` of the
/// feature table binary; `None` when they do not fit in it.
fn feature_table_range(
    binary: &[u8],
    binary_offset: usize,
    byte_offset: u64,
    byte_length: u64,
) -> Option<u32> {
    let start = usize::try_from(byte_offset).ok()?;
    let end = start.checked_add(usize::try_from(byte_length).ok()?)?;
    binary.get(start..end)?;
    u32::try_from(binary_offset + start).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Returns the tile and the byte offset of its feature table binary.
    fn create_pnts(feature_table_json: &str, feature_table_binary: &[u8]) -> (Vec<u8>, u32) {
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
        let binary_offset = (PNTS_HEADER_SIZE + json.len()) as u32;
        (data, binary_offset)
    }

    /// Parses a tile; returns its layout, Draco attributes, center and the
    /// byte offset of its feature table binary.
    fn parse(
        feature_table_json: &str,
        feature_table_binary: &[u8],
    ) -> Option<(PointCloudLayout, Option<Vec<DracoAttributeId>>, Vec3, u32)> {
        let (pnts, binary_offset) = create_pnts(feature_table_json, feature_table_binary);
        let mut buf = BufferStore::new();
        let handle = buf.new_u8(pnts);
        let (internal, center) = get_geometry_info_from_pnts(&mut buf, handle)?;
        Some((
            internal.point_cloud_layout.unwrap(),
            internal.draco_attributes,
            center,
            binary_offset,
        ))
    }

    fn f32_bytes(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    #[test]
    fn it_should_locate_draco_blob_and_attribute_ids() {
        let (layout, draco_attributes, _, binary_offset) = parse(
            r#"{"POINTS_LENGTH":2,"POSITION":{"byteOffset":0},"RGB":{"byteOffset":0},
            "extensions":{"3DTILES_draco_point_compression":
            {"byteOffset":2,"byteLength":3,"properties":{"POSITION":0,"RGB":1}}}}"#,
            &[9, 9, 1, 2, 3, 9],
        )
        .unwrap();

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
        assert_eq!(layout.positions_format, PointPositionsFormat::Draco);
        assert_eq!(layout.draco_byte_offset, binary_offset + 2);
        assert_eq!(layout.draco_byte_length, 3);
        // Draco decodes `RGB`; the placeholder `RGB` outside it is not read.
        assert_eq!(layout.colors_format, PointColorsFormat::None);
    }

    #[test]
    fn it_should_read_raw_positions_beside_draco_blob_without_them() {
        let mut binary = f32_bytes(&[1.0, 2.0, 3.0]);
        binary.extend([7, 7]);
        let (layout, _, center, binary_offset) = parse(
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},"RTC_CENTER":[4,5,6],
            "extensions":{"3DTILES_draco_point_compression":
            {"byteOffset":12,"byteLength":2,"properties":{"RGB":0}}}}"#,
            &binary,
        )
        .unwrap();

        assert_eq!(center, Vec3::new(4.0, 5.0, 6.0));
        assert_eq!(layout.positions_format, PointPositionsFormat::Float32);
        assert_eq!(layout.positions_byte_offset, binary_offset);
        assert_eq!(layout.positions_byte_length, 12);
        assert_eq!(layout.draco_byte_offset, binary_offset + 12);
        assert_eq!(layout.draco_byte_length, 2);
        assert_eq!(layout.colors_format, PointColorsFormat::None);
    }

    #[test]
    fn it_should_drop_batch_table_from_bin() {
        let (mut pnts, _) = create_pnts(
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0}}"#,
            &f32_bytes(&[1.0, 2.0, 3.0]),
        );
        let feature_table_end = pnts.len();
        // Batch table JSON.
        pnts[20..24].copy_from_slice(&8u32.to_le_bytes());
        pnts.extend(br#"{"a":1} "#);
        let mut buf = BufferStore::new();
        let handle = buf.new_u8(pnts);

        get_geometry_info_from_pnts(&mut buf, handle).unwrap();
        assert_eq!(buf.get_u8(&handle).unwrap().len(), feature_table_end);
    }

    #[test]
    fn it_should_read_raw_colors_beside_partial_draco_blob() {
        let (layout, _, _, binary_offset) = parse(
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},"RGB":{"byteOffset":3},
            "extensions":{"3DTILES_draco_point_compression":
            {"byteOffset":0,"byteLength":3,"properties":{"POSITION":0}}}}"#,
            &[9, 9, 9, 1, 2, 3],
        )
        .unwrap();

        assert_eq!(layout.colors_format, PointColorsFormat::Rgb8);
        assert_eq!(layout.colors_byte_offset, binary_offset + 3);
    }

    #[test]
    fn it_should_reject_malformed_tiles() {
        let cases = [
            // Malformed Draco extension.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},
            "extensions":{"3DTILES_draco_point_compression":{"byteOffset":0}}}"#,
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
            // Colors end past the binary.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},"RGB":{"byteOffset":10}}"#,
            // Constant color channel out of the u8 range.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},"CONSTANT_RGBA":[0,0,0,256]}"#,
            // Binary-body RTC_CENTER ends past the binary.
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},"RTC_CENTER":{"byteOffset":4}}"#,
            // Neither POSITION nor POSITION_QUANTIZED.
            r#"{"POINTS_LENGTH":1}"#,
        ];
        for feature_table_json in cases {
            assert!(
                parse(feature_table_json, &[0; 12]).is_none(),
                "{feature_table_json}"
            );
        }
    }

    #[test]
    fn it_should_locate_raw_positions_relative_to_rtc_center() {
        let (layout, draco_attributes, center, binary_offset) = parse(
            r#"{"POINTS_LENGTH":1,"POSITION":{"byteOffset":0},"RTC_CENTER":[4,5,6]}"#,
            &f32_bytes(&[1.0, 2.0, 3.0]),
        )
        .unwrap();

        assert!(draco_attributes.is_none());
        assert_eq!(center, Vec3::new(4.0, 5.0, 6.0));
        assert_eq!(layout.positions_format, PointPositionsFormat::Float32);
        assert_eq!(layout.positions_byte_offset, binary_offset);
        assert_eq!(layout.positions_byte_length, 12);
        assert_eq!(layout.positions_origin, Vec3::ZERO);
        assert_eq!(layout.colors_format, PointColorsFormat::None);
    }

    #[test]
    fn it_should_read_global_semantics_from_binary_body() {
        let mut binary = f32_bytes(&[0.0; 3]);
        binary.extend(f32_bytes(&[100.0, 200.0, 300.0])); // QUANTIZED_VOLUME_OFFSET
        binary.extend(f32_bytes(&[10.0, 20.0, 30.0])); // QUANTIZED_VOLUME_SCALE
        binary.extend(f32_bytes(&[1.0, 2.0, 3.0])); // RTC_CENTER
        binary.extend([255, 255, 0, 51]); // CONSTANT_RGBA
        let (layout, _, center, _) = parse(
            r#"{"POINTS_LENGTH":1,"POSITION_QUANTIZED":{"byteOffset":0},
            "QUANTIZED_VOLUME_OFFSET":{"byteOffset":12},"QUANTIZED_VOLUME_SCALE":{"byteOffset":24},
            "RTC_CENTER":{"byteOffset":36},"CONSTANT_RGBA":{"byteOffset":48}}"#,
            &binary,
        )
        .unwrap();

        assert_eq!(center, Vec3::new(101.0, 202.0, 303.0));
        assert_eq!(layout.quantized_volume_scale, Vec3::new(10.0, 20.0, 30.0));
        assert_eq!(layout.colors_format, PointColorsFormat::Constant);
        assert_eq!(layout.constant_color, 0xffff0033);
    }

    #[test]
    fn it_should_recenter_absolute_positions_on_first_point() {
        let (layout, _, center, _) = parse(
            r#"{"POINTS_LENGTH":2,"POSITION":{"byteOffset":0}}"#,
            &f32_bytes(&[
                1215010.4, -4736313.5, 4081601.8, 1215011.5, -4736313.0, 4081602.0,
            ]),
        )
        .unwrap();

        let first = [1215010.4f32, -4736313.5, 4081601.8].map(f64::from);
        assert_eq!(center, Vec3::from_array(first));
        assert_eq!(layout.positions_origin, center);
    }

    #[test]
    fn it_should_locate_quantized_positions_in_volume() {
        let (layout, _, center, binary_offset) = parse(
            r#"{"POINTS_LENGTH":1,"POSITION_QUANTIZED":{"byteOffset":0},
            "QUANTIZED_VOLUME_OFFSET":[100,200,300],"QUANTIZED_VOLUME_SCALE":[10,20,30],
            "RTC_CENTER":[1,2,3]}"#,
            &[0; 6],
        )
        .unwrap();

        assert_eq!(center, Vec3::new(101.0, 202.0, 303.0));
        assert_eq!(layout.positions_format, PointPositionsFormat::Uint16);
        assert_eq!(layout.positions_byte_offset, binary_offset);
        assert_eq!(layout.positions_byte_length, 6);
        assert_eq!(layout.quantized_volume_scale, Vec3::new(10.0, 20.0, 30.0));
    }

    #[test]
    fn it_should_pick_colors_in_spec_precedence() {
        let colors = |color_semantics: &str| {
            let (layout, _, _, binary_offset) = parse(
                &format!(r#"{{"POINTS_LENGTH":1,"POSITION":{{"byteOffset":0}}{color_semantics}}}"#),
                &[0; 20],
            )
            .unwrap();
            (
                layout.colors_format,
                layout.colors_byte_offset.saturating_sub(binary_offset),
                layout.constant_color,
            )
        };

        assert_eq!(
            colors(
                r#","RGB":{"byteOffset":12},"RGBA":{"byteOffset":16},"CONSTANT_RGBA":[0,0,0,0]"#
            ),
            (PointColorsFormat::Rgba8, 16, 0)
        );
        assert_eq!(
            colors(r#","RGB565":{"byteOffset":16},"RGB":{"byteOffset":12}"#),
            (PointColorsFormat::Rgb8, 12, 0)
        );
        assert_eq!(
            colors(r#","CONSTANT_RGBA":[0,0,0,0],"RGB565":{"byteOffset":12}"#),
            (PointColorsFormat::Rgb565, 12, 0)
        );
        assert_eq!(
            colors(r#","CONSTANT_RGBA":[255,255,0,51]"#),
            (PointColorsFormat::Constant, 0, 0xffff0033)
        );
    }
}
