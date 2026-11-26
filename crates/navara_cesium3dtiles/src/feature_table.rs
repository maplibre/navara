//! Reading the feature table of a 3D Tiles 1.0 tile format.

use navara_math::Vec3;

/// Reads a float32 vec3 global semantic, given inline as `[x, y, z]` or as a
/// `{"byteOffset"}` into the feature table binary.
pub(crate) fn global_vec3(value: &serde_json::Value, binary: &[u8]) -> Option<Vec3> {
    if let Some(bytes) = global_bytes::<12>(value, binary) {
        return Some(f32x3(bytes));
    }
    let [x, y, z] = value.as_array()?.as_slice() else {
        return None;
    };
    Some(Vec3::new(x.as_f64()?, y.as_f64()?, z.as_f64()?))
}

/// Reads a uint32 global semantic, given inline or as a `{"byteOffset"}` into
/// the feature table binary.
pub(crate) fn global_u32(value: &serde_json::Value, binary: &[u8]) -> Option<u32> {
    if let Some(bytes) = global_bytes::<4>(value, binary) {
        return Some(u32::from_le_bytes(*bytes));
    }
    u32::try_from(value.as_u64()?).ok()
}

/// Reads a little-endian float32 vec3.
pub(crate) fn f32x3(bytes: &[u8; 12]) -> Vec3 {
    let p = bytes.as_chunks::<4>().0;
    let read = |b: [u8; 4]| f64::from(f32::from_le_bytes(b));
    Vec3::new(read(p[0]), read(p[1]), read(p[2]))
}

/// The `N` bytes a `{"byteOffset"}` global semantic points to in the feature
/// table binary; `None` when it is inline or does not fit in the binary.
pub(crate) fn global_bytes<'a, const N: usize>(
    value: &serde_json::Value,
    binary: &'a [u8],
) -> Option<&'a [u8; N]> {
    let start = usize::try_from(value.get("byteOffset")?.as_u64()?).ok()?;
    binary.get(start..)?.first_chunk::<N>()
}
