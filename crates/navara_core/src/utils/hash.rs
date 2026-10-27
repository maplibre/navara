use std::hash::{Hash, Hasher};

use rustc_hash::FxHasher;

/// Hash a float slice by its exact bit patterns (`f32` has no `Hash` impl).
///
/// Meant for cheap change detection, e.g. keeping a hash of a large array in a
/// component instead of the array itself. `0.0` and `-0.0`, or two NaN
/// payloads, hash differently; not stable across processes or versions.
pub fn hash_f32s(values: &[f32]) -> u64 {
    let mut hasher = FxHasher::default();
    values.len().hash(&mut hasher);
    for v in values {
        v.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::hash_f32s;

    #[test]
    fn equal_slices_hash_equal_and_changes_are_detected() {
        assert_eq!(hash_f32s(&[0.0, 0.5, 1.0]), hash_f32s(&[0.0, 0.5, 1.0]));
        assert_ne!(hash_f32s(&[0.0, 0.5, 1.0]), hash_f32s(&[0.0, 0.6, 1.0]));
        assert_ne!(hash_f32s(&[]), hash_f32s(&[0.0]));
    }
}
