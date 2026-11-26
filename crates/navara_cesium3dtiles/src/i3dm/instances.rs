//! Per-instance transforms and batch IDs of an I3DM feature table, read as
//! CesiumJS's `I3dmLoader` does.
//!
//! ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/Instanced3DModel/README.adoc#feature-table

use navara_core::{WGS84_64, east_north_up_to_fixed_frame};
use navara_math::{Mat3, Mat4, Vec2, Vec3};
use serde_json::Value;

use crate::feature_table::{f32x3, global_u32, global_vec3};

/// The instances of an I3DM, placed in the tile frame.
#[derive(Debug)]
pub(crate) struct Instances {
    /// Point of the tile frame the instance transforms are relative to.
    pub center: Vec3,
    /// `T(position - center) * R * S` of each instance.
    pub transforms: Vec<Mat4>,
    /// Feature index of each instance: `BATCH_ID`, or the instance index.
    pub batch_ids: Vec<u32>,
    /// Number of features the batch table describes.
    pub batch_length: u32,
}

/// Reads the instances from the feature table; `None` when it lacks a
/// required semantic or a property does not fit in `binary`.
pub(crate) fn read_instances(json: &Value, binary: &[u8]) -> Option<Instances> {
    let count = global_u32(json.get("INSTANCES_LENGTH")?, binary)? as usize;
    let property = |name: &str, element_size: usize| -> Option<Option<&[u8]>> {
        let Some(value) = json.get(name) else {
            return Some(None);
        };
        let start = usize::try_from(value.get("byteOffset")?.as_u64()?).ok()?;
        let end = start.checked_add(count.checked_mul(element_size)?)?;
        binary.get(start..end).map(Some)
    };

    let rtc_center = match json.get("RTC_CENTER") {
        Some(center) => Some(global_vec3(center, binary)?),
        None => None,
    };
    let mut positions = read_positions(json, binary, count, property)?;
    if let Some(rtc_center) = rtc_center {
        for p in &mut positions {
            *p += rtc_center;
        }
    }
    // Without an RTC center the positions are absolute: center them so they
    // keep their precision as f32 instance translations.
    let center = match rtc_center {
        Some(center) if center != Vec3::ZERO => center,
        _ => {
            let (min, max) = positions
                .iter()
                .fold((Vec3::INFINITY, Vec3::NEG_INFINITY), |(min, max), p| {
                    (min.min(*p), max.max(*p))
                });
            if count == 0 {
                Vec3::ZERO
            } else {
                (min + max) / 2.
            }
        }
    };

    let normal_up = property("NORMAL_UP", 12)?;
    let normal_right = property("NORMAL_RIGHT", 12)?;
    let oct_normal_up = property("NORMAL_UP_OCT32P", 4)?;
    let oct_normal_right = property("NORMAL_RIGHT_OCT32P", 4)?;
    let east_north_up = json.get("EAST_NORTH_UP").and_then(Value::as_bool) == Some(true);
    let scale = property("SCALE", 4)?;
    let scale_non_uniform = property("SCALE_NON_UNIFORM", 12)?;

    let mut transforms = Vec::with_capacity(count);
    for (i, position) in positions.iter().enumerate() {
        let rotation = if let (Some(up), Some(right)) = (normal_up, normal_right) {
            rotation_from_normals(f32x3_at(up, i), f32x3_at(right, i))
        } else if let (Some(up), Some(right)) = (oct_normal_up, oct_normal_right) {
            rotation_from_normals(oct32p_at(up, i), oct32p_at(right, i))
        } else if east_north_up {
            Mat3::from_mat4(east_north_up_to_fixed_frame(*position, WGS84_64))
        } else {
            Mat3::IDENTITY
        };
        let mut s = Vec3::ONE;
        if let Some(scale) = scale {
            s *= f64::from(f32_at(scale, i));
        }
        if let Some(scale) = scale_non_uniform {
            s *= f32x3_at(scale, i);
        }
        transforms.push(
            Mat4::from_translation(*position - center)
                * Mat4::from_mat3(rotation)
                * Mat4::from_scale(s),
        );
    }

    let batch_ids = read_batch_ids(json, count, property)?;
    let batch_length = match &batch_ids {
        Some(ids) => ids.iter().max().map_or(Some(0), |max| max.checked_add(1))?,
        None => u32::try_from(count).ok()?,
    };
    let batch_ids = batch_ids.unwrap_or_else(|| (0..count as u32).collect());

    Some(Instances {
        center,
        transforms,
        batch_ids,
        batch_length,
    })
}

/// `POSITION`, or `POSITION_QUANTIZED` dequantized into the volume.
fn read_positions<'a>(
    json: &Value,
    binary: &[u8],
    count: usize,
    property: impl Fn(&str, usize) -> Option<Option<&'a [u8]>>,
) -> Option<Vec<Vec3>> {
    if let Some(bytes) = property("POSITION", 12)? {
        return Some((0..count).map(|i| f32x3_at(bytes, i)).collect());
    }
    let bytes = property("POSITION_QUANTIZED", 6)??;
    let offset = global_vec3(json.get("QUANTIZED_VOLUME_OFFSET")?, binary)?;
    let scale = global_vec3(json.get("QUANTIZED_VOLUME_SCALE")?, binary)?;
    Some(
        bytes
            .as_chunks::<6>()
            .0
            .iter()
            .map(|p| {
                let q = |j: usize| f64::from(u16::from_le_bytes([p[2 * j], p[2 * j + 1]]));
                Vec3::new(q(0), q(1), q(2)) / 65535. * scale + offset
            })
            .collect(),
    )
}

/// `BATCH_ID` in its `componentType`; `Some(None)` without it.
fn read_batch_ids<'a>(
    json: &Value,
    count: usize,
    property: impl Fn(&str, usize) -> Option<Option<&'a [u8]>>,
) -> Option<Option<Vec<u32>>> {
    let Some(semantic) = json.get("BATCH_ID") else {
        return Some(None);
    };
    let component_type = semantic
        .get("componentType")
        .and_then(Value::as_str)
        .unwrap_or("UNSIGNED_SHORT");
    let ids: Vec<u32> = match component_type {
        "UNSIGNED_BYTE" => property("BATCH_ID", 1)??
            .iter()
            .map(|&b| u32::from(b))
            .collect(),
        "UNSIGNED_SHORT" => property("BATCH_ID", 2)??
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| u32::from(u16::from_le_bytes(*b)))
            .collect(),
        "UNSIGNED_INT" => property("BATCH_ID", 4)??
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| u32::from_le_bytes(*b))
            .collect(),
        _ => return None,
    };
    debug_assert_eq!(ids.len(), count);
    Some(Some(ids))
}

/// Rotation whose x axis is `right`, y axis `up` and z axis `right × up`.
fn rotation_from_normals(up: Vec3, right: Vec3) -> Mat3 {
    Mat3::from_cols(right, up, right.cross(up).normalize())
}

fn f32_at(bytes: &[u8], i: usize) -> f32 {
    f32::from_le_bytes(*bytes[4 * i..].first_chunk().unwrap())
}

fn f32x3_at(bytes: &[u8], i: usize) -> Vec3 {
    f32x3(bytes[12 * i..].first_chunk().unwrap())
}

/// Oct-decodes the `i`-th pair of u16 in `[0, 65535]` into a unit vector.
fn oct32p_at(bytes: &[u8], i: usize) -> Vec3 {
    let b = &bytes[4 * i..];
    let unorm = |j: usize| f64::from(u16::from_le_bytes([b[2 * j], b[2 * j + 1]])) / 65535.;
    let mut v = Vec2::new(unorm(0), unorm(1)) * 2. - 1.;
    let z = 1. - v.x.abs() - v.y.abs();
    if z < 0. {
        let sign = |x: f64| if x < 0. { -1. } else { 1. };
        v = Vec2::new((1. - v.y.abs()) * sign(v.x), (1. - v.x.abs()) * sign(v.y));
    }
    v.extend(z).normalize()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn f32s(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    #[test]
    fn absolute_positions_are_centered() {
        let binary = f32s(&[10., 0., 0., 20., 4., 0.]);
        let json = json!({ "INSTANCES_LENGTH": 2, "POSITION": { "byteOffset": 0 } });
        let instances = read_instances(&json, &binary).unwrap();
        assert_eq!(instances.center, Vec3::new(15., 2., 0.));
        assert_eq!(
            instances.transforms[1].transform_point3(Vec3::ZERO),
            Vec3::new(5., 2., 0.)
        );
        assert_eq!(instances.batch_ids, [0, 1]);
        assert_eq!(instances.batch_length, 2);
    }

    #[test]
    fn positions_are_relative_to_the_rtc_center() {
        let binary = f32s(&[1., 2., 3.]);
        let json = json!({
            "INSTANCES_LENGTH": 1,
            "RTC_CENTER": [100., 0., 0.],
            "POSITION": { "byteOffset": 0 },
        });
        let instances = read_instances(&json, &binary).unwrap();
        assert_eq!(instances.center, Vec3::new(100., 0., 0.));
        assert_eq!(
            instances.transforms[0].transform_point3(Vec3::ZERO),
            Vec3::new(1., 2., 3.)
        );
    }

    #[test]
    fn quantized_positions_are_dequantized() {
        let binary: Vec<u8> = [0u16, 65535, 0, 65535, 65535, 65535]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let json = json!({
            "INSTANCES_LENGTH": 2,
            "QUANTIZED_VOLUME_OFFSET": [-1., -1., -1.],
            "QUANTIZED_VOLUME_SCALE": [2., 2., 2.],
            "POSITION_QUANTIZED": { "byteOffset": 0 },
        });
        let instances = read_instances(&json, &binary).unwrap();
        // Positions (-1, 1, -1) and (1, 1, 1) around the center (0, 1, 0).
        assert_eq!(instances.center, Vec3::new(0., 1., 0.));
        assert_eq!(
            instances.transforms[0].transform_point3(Vec3::ZERO),
            Vec3::new(-1., 0., -1.)
        );
    }

    #[test]
    fn normals_scale_and_batch_ids_compose() {
        // up = +x, right = -y: forward = right × up = +z.
        let mut binary = f32s(&[0., 0., 0., 1., 0., 0., 0., -1., 0., 2., 1., 3., 1.]);
        binary.extend([7u8, 0, 0, 0]);
        let json = json!({
            "INSTANCES_LENGTH": 1,
            "POSITION": { "byteOffset": 0 },
            "NORMAL_UP": { "byteOffset": 12 },
            "NORMAL_RIGHT": { "byteOffset": 24 },
            "SCALE": { "byteOffset": 36 },
            "SCALE_NON_UNIFORM": { "byteOffset": 40 },
            "BATCH_ID": { "byteOffset": 52, "componentType": "UNSIGNED_BYTE" },
        });
        let instances = read_instances(&json, &binary).unwrap();
        let m = instances.transforms[0];
        // Local x (right) scaled by 2 * 1 → -y * 2; local y (up) by 2 * 3 → +x * 6.
        assert_close!(m.transform_vector3(Vec3::X), Vec3::new(0., -2., 0.));
        assert_close!(m.transform_vector3(Vec3::Y), Vec3::new(6., 0., 0.));
        assert_close!(m.transform_vector3(Vec3::Z), Vec3::new(0., 0., 2.));
        assert_eq!(instances.batch_ids, [7]);
        assert_eq!(instances.batch_length, 8);
    }

    #[test]
    fn oct_encoded_normals_decode() {
        // 0x7fff is the midpoint 0 of [-1, 1].
        assert_close!(
            oct32p_at(&[0xff, 0x7f, 0xff, 0xff], 0),
            Vec3::Y,
            epsilon = 1e-4
        );
        assert_close!(
            oct32p_at(&[0xff, 0xff, 0xff, 0x7f], 0),
            Vec3::X,
            epsilon = 1e-4
        );
        assert_close!(
            oct32p_at(&[0xff, 0x7f, 0xff, 0x7f], 0),
            Vec3::Z,
            epsilon = 1e-4
        );
    }

    #[test]
    fn east_north_up_orients_to_the_surface() {
        let binary = f32s(&[6378137., 0., 0.]);
        let json = json!({
            "INSTANCES_LENGTH": 1,
            "POSITION": { "byteOffset": 0 },
            "EAST_NORTH_UP": true,
        });
        let m = read_instances(&json, &binary).unwrap().transforms[0];
        // At (lon 0, lat 0): east = +y, north = +z, up = +x.
        assert_close!(m.transform_vector3(Vec3::X), Vec3::Y, epsilon = 1e-9);
        assert_close!(m.transform_vector3(Vec3::Y), Vec3::Z, epsilon = 1e-9);
        assert_close!(m.transform_vector3(Vec3::Z), Vec3::X, epsilon = 1e-9);
    }

    #[test]
    fn missing_positions_reject_the_tile() {
        let json = json!({ "INSTANCES_LENGTH": 1 });
        assert!(read_instances(&json, &[]).is_none());
    }

    #[test]
    fn instances_length_reads_from_the_binary() {
        let mut binary = 1u32.to_le_bytes().to_vec();
        binary.extend(f32s(&[1., 2., 3.]));
        let json = json!({
            "INSTANCES_LENGTH": { "byteOffset": 0 },
            "POSITION": { "byteOffset": 4 },
        });
        assert_eq!(read_instances(&json, &binary).unwrap().transforms.len(), 1);
    }

    #[test]
    fn the_largest_batch_id_rejects_the_tile() {
        let mut binary = f32s(&[0., 0., 0.]);
        binary.extend(u32::MAX.to_le_bytes());
        let json = json!({
            "INSTANCES_LENGTH": 1,
            "POSITION": { "byteOffset": 0 },
            "BATCH_ID": { "byteOffset": 12, "componentType": "UNSIGNED_INT" },
        });
        assert!(read_instances(&json, &binary).is_none());
    }
}
