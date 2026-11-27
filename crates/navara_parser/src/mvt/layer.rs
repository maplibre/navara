use std::sync::Arc;

use geozero::mvt::tile;
use navara_property::PropertyValue;

/// Raw MVT layer data for lazy property parsing.
/// Properties are only parsed when accessed via `get_property`.
///
/// Per-feature tags are stored flat (`feature_tags_flat`) with prefix-sum
/// `feature_tag_offsets` (length = feature count + 1) rather than a jagged
/// `Vec<Vec<u32>>`, so tag data stays in one contiguous buffer end-to-end (parse
/// → Web Worker transfer → batch table) without per-feature allocations.
#[derive(Debug, Clone)]
pub struct MvtLayerData {
    /// Property key names (shared across all features in the layer)
    pub keys: Arc<Vec<String>>,
    /// Property values (shared across all features in the layer) - raw MVT format for lazy conversion
    pub values: Arc<Vec<tile::Value>>,
    /// All per-feature tag pairs (key_index, value_index) concatenated.
    pub feature_tags_flat: Vec<u32>,
    /// Prefix-sum offsets into `feature_tags_flat`; length = feature count + 1.
    pub feature_tag_offsets: Vec<u32>,
    /// Top-level MVT feature ids by feature index; empty when no feature has one.
    pub feature_ids: Vec<Option<u64>>,
}

/// Build prefix-sum offsets (length `sizes.len() + 1`) from per-feature sizes.
fn offsets_from_sizes(sizes: &[u32]) -> Vec<u32> {
    let mut offsets = Vec::with_capacity(sizes.len() + 1);
    let mut acc = 0u32;
    offsets.push(0);
    for &s in sizes {
        acc += s;
        offsets.push(acc);
    }
    offsets
}

impl MvtLayerData {
    /// Construct from already-shared keys/values plus flat tags + per-feature sizes.
    pub fn from_raw(
        keys: Arc<Vec<String>>,
        values: Arc<Vec<tile::Value>>,
        feature_tags_flat: Vec<u32>,
        feature_tag_sizes: &[u32],
    ) -> Self {
        Self {
            keys,
            values,
            feature_tags_flat,
            feature_tag_offsets: offsets_from_sizes(feature_tag_sizes),
            feature_ids: Vec::new(),
        }
    }

    /// Attach the features' top-level MVT ids (parallel to the tag sizes; empty
    /// for none).
    pub fn with_feature_ids(mut self, feature_ids: Vec<Option<u64>>) -> Self {
        self.feature_ids = feature_ids;
        self
    }

    /// The top-level MVT id of `feature_index`, if the feature has one.
    pub fn feature_id(&self, feature_index: usize) -> Option<u64> {
        self.feature_ids.get(feature_index).copied().flatten()
    }

    /// Number of features (batch entries) stored.
    pub fn feature_count(&self) -> usize {
        self.feature_tag_offsets.len().saturating_sub(1)
    }

    // === Memory accounting (for MemoryLedger via BatchTable) ===
    //
    // `keys`/`values` are `Arc`-shared across a layer's groups, so they must be
    // counted once per allocation (via [`Self::keys_ptr`]/[`Self::values_ptr`]),
    // while `feature_tags_flat`/`feature_tag_offsets` are owned per entry.

    /// Bytes owned exclusively by this entry (the two flat tag buffers).
    pub fn owned_bytes(&self) -> usize {
        self.feature_tags_flat.capacity() * size_of::<u32>()
            + self.feature_tag_offsets.capacity() * size_of::<u32>()
            + self.feature_ids.capacity() * size_of::<Option<u64>>()
    }

    /// Stable identity of the shared keys allocation (dedup key).
    pub fn keys_ptr(&self) -> usize {
        Arc::as_ptr(&self.keys) as *const () as usize
    }

    /// Stable identity of the shared values allocation (dedup key).
    pub fn values_ptr(&self) -> usize {
        Arc::as_ptr(&self.values) as *const () as usize
    }

    /// Approximate bytes held by the shared keys table (property names).
    pub fn keys_shared_bytes(&self) -> usize {
        size_of::<Vec<String>>()
            + self
                .keys
                .iter()
                .map(|s| size_of::<String>() + s.capacity())
                .sum::<usize>()
    }

    /// Approximate bytes held by the shared values table. Only `string_value`
    /// carries a heap payload; the other `tile::Value` fields are inline.
    pub fn values_shared_bytes(&self) -> usize {
        size_of::<Vec<tile::Value>>()
            + self
                .values
                .iter()
                .map(|v| {
                    size_of::<tile::Value>()
                        + v.string_value.as_ref().map(|s| s.capacity()).unwrap_or(0)
                })
                .sum::<usize>()
    }

    /// Tag pairs for a feature index, or `None` if out of range.
    pub fn feature_tags(&self, feature_index: usize) -> Option<&[u32]> {
        let start = *self.feature_tag_offsets.get(feature_index)? as usize;
        let end = *self.feature_tag_offsets.get(feature_index + 1)? as usize;
        self.feature_tags_flat.get(start..end)
    }
}

/// A single MVT property value (mirrors protobuf tile::Value).
///
/// Unlike the prost-generated `tile::Value`, this is a plain, serializable enum,
/// so it can cross the Web Worker boundary (`tile::Value` derives no serde).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum MvtValue {
    String(String),
    Float(f32),
    Double(f64),
    Int(i64),
    UInt(u64),
    SInt(i64),
    Bool(bool),
    Null,
}

impl MvtValue {
    pub fn to_value<V: PropertyValue>(&self) -> V {
        match self {
            MvtValue::String(s) => V::from_string(s.clone()),
            MvtValue::Float(f) => V::from_f32(*f),
            MvtValue::Double(d) => V::from_f64(*d),
            MvtValue::Int(i) => V::from_i64(*i),
            MvtValue::UInt(u) => V::from_u64(*u),
            MvtValue::SInt(i) => V::from_i64(*i),
            MvtValue::Bool(b) => V::from_bool(*b),
            MvtValue::Null => V::null(),
        }
    }

    /// Convert a raw protobuf `tile::Value` into a serializable `MvtValue`.
    pub fn from_tile_value(value: &tile::Value) -> Self {
        if let Some(s) = &value.string_value {
            MvtValue::String(s.clone())
        } else if let Some(f) = value.float_value {
            MvtValue::Float(f)
        } else if let Some(d) = value.double_value {
            MvtValue::Double(d)
        } else if let Some(i) = value.int_value {
            MvtValue::Int(i)
        } else if let Some(u) = value.uint_value {
            MvtValue::UInt(u)
        } else if let Some(i) = value.sint_value {
            MvtValue::SInt(i)
        } else if let Some(b) = value.bool_value {
            MvtValue::Bool(b)
        } else {
            MvtValue::Null
        }
    }

    /// Rebuild a protobuf `tile::Value` (as consumed by [`MvtLayerData`]),
    /// moving the string payload rather than cloning it.
    pub fn into_tile_value(self) -> tile::Value {
        let mut v = tile::Value::default();
        match self {
            MvtValue::String(s) => v.string_value = Some(s),
            MvtValue::Float(f) => v.float_value = Some(f),
            MvtValue::Double(d) => v.double_value = Some(d),
            MvtValue::Int(i) => v.int_value = Some(i),
            MvtValue::UInt(u) => v.uint_value = Some(u),
            MvtValue::SInt(i) => v.sint_value = Some(i),
            MvtValue::Bool(b) => v.bool_value = Some(b),
            MvtValue::Null => {}
        }
        v
    }
}

/// The keys/values half of a layer's lazy property data, carried across the Web
/// Worker boundary as a structured clone while `feature_tags` ride alongside as
/// zero-copy flat buffers. Rebuilt into [`MvtLayerData`] via
/// [`MvtLayerData::from_meta`].
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ParsedLayerPropertiesMeta {
    pub keys: Vec<String>,
    pub values: Vec<MvtValue>,
}

impl ParsedLayerPropertiesMeta {
    /// Snapshot from shared layer data (clones keys, converts values to a
    /// serializable form).
    pub fn from_parts(keys: &[String], values: &[tile::Value]) -> Self {
        Self {
            keys: keys.to_vec(),
            values: values.iter().map(MvtValue::from_tile_value).collect(),
        }
    }

    /// Convert into the `Arc`-shared keys/values consumed by
    /// [`MvtLayerData::from_raw`], moving the strings (no clone). Built once
    /// per layer on worker completion and shared by all of the layer's groups.
    pub fn into_shared_parts(self) -> (Arc<Vec<String>>, Arc<Vec<tile::Value>>) {
        let values: Vec<tile::Value> = self
            .values
            .into_iter()
            .map(MvtValue::into_tile_value)
            .collect();
        (Arc::new(self.keys), Arc::new(values))
    }
}

/// Convert raw MVT tile::Value to PropertyValue
fn tile_value_to_property<V: PropertyValue>(value: &tile::Value) -> V {
    if let Some(s) = &value.string_value {
        V::from_string(s.clone())
    } else if let Some(f) = value.float_value {
        V::from_f32(f)
    } else if let Some(d) = value.double_value {
        V::from_f64(d)
    } else if let Some(i) = value.int_value {
        V::from_i64(i)
    } else if let Some(u) = value.uint_value {
        V::from_u64(u)
    } else if let Some(i) = value.sint_value {
        V::from_i64(i)
    } else if let Some(b) = value.bool_value {
        V::from_bool(b)
    } else {
        V::null()
    }
}

impl MvtLayerData {
    /// Get properties for a specific feature index.
    /// Properties are converted lazily from raw MVT format.
    pub fn get_properties<V: PropertyValue>(&self, feature_index: usize) -> Option<V> {
        let tags = self.feature_tags(feature_index)?;
        let mut props = V::empty_map();

        for pair in tags.chunks(2) {
            if let [key_idx, value_idx] = pair {
                let key = self.keys.get(*key_idx as usize)?;
                let value = self.values.get(*value_idx as usize)?;
                V::insert(&mut props, key.clone(), tile_value_to_property(value));
            }
        }

        Some(V::finalize_map(props))
    }

    /// Resolve `keys` against this layer's key table once, for reading many
    /// features with [`Self::get_filtered_properties`].
    pub fn key_filter(&self, keys: &[String]) -> MvtKeyFilter {
        MvtKeyFilter {
            positions: self
                .keys
                .iter()
                .map(|layer_key| keys.iter().rposition(|k| k == layer_key))
                .collect(),
            len: keys.len(),
        }
    }

    /// Get only the requested properties for a specific feature index.
    /// Returns `Vec<Option<V>>` in the order of the keys `filter` was built
    /// from (None for missing keys).
    pub fn get_filtered_properties<V: PropertyValue>(
        &self,
        feature_index: usize,
        filter: &MvtKeyFilter,
    ) -> Option<Vec<Option<V>>> {
        let tags = self.feature_tags(feature_index)?;

        let mut result: Vec<Option<V>> = (0..filter.len).map(|_| None).collect();

        for &[key_idx, value_idx] in tags.as_chunks::<2>().0 {
            if let Some(pos) = *filter.positions.get(key_idx as usize)? {
                let value = self.values.get(value_idx as usize)?;
                result[pos] = Some(tile_value_to_property(value));
            }
        }

        Some(result)
    }
}

/// Requested keys resolved against one layer's key table: the output
/// position of each layer key index. Built by [`MvtLayerData::key_filter`].
pub struct MvtKeyFilter {
    positions: Vec<Option<usize>>,
    len: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use geozero::mvt::tile;
    use serde_json::json;
    use std::sync::Arc;

    fn make_layer_data() -> MvtLayerData {
        let keys = Arc::new(vec![
            "name".to_string(),
            "height".to_string(),
            "visible".to_string(),
        ]);
        let values = Arc::new(vec![
            tile::Value {
                string_value: Some("building_a".to_string()),
                ..Default::default()
            },
            tile::Value {
                double_value: Some(42.5),
                ..Default::default()
            },
            tile::Value {
                bool_value: Some(true),
                ..Default::default()
            },
            tile::Value {
                string_value: Some("building_b".to_string()),
                ..Default::default()
            },
            tile::Value {
                int_value: Some(100),
                ..Default::default()
            },
        ]);
        // Feature 0: name=building_a, height=42.5, visible=true (6 tag ints)
        // Feature 1: name=building_b, height=100 (no visible) (4 tag ints)
        let feature_tags_flat = vec![0, 0, 1, 1, 2, 2, 0, 3, 1, 4];
        let feature_tag_sizes = [6, 4];
        MvtLayerData::from_raw(keys, values, feature_tags_flat, &feature_tag_sizes)
    }

    #[test]
    fn test_get_properties_all_tags() {
        let layer = make_layer_data();
        let props: serde_json::Value = layer.get_properties(0).unwrap();
        let map = props.as_object().unwrap();

        assert_eq!(map["name"], json!("building_a"));
        assert_eq!(map["height"], json!(42.5));
        assert_eq!(map["visible"], json!(true));
    }

    #[test]
    fn test_get_properties_partial_tags() {
        let layer = make_layer_data();
        let props: serde_json::Value = layer.get_properties(1).unwrap();
        let map = props.as_object().unwrap();

        assert_eq!(map["name"], json!("building_b"));
        assert_eq!(map["height"], json!(100));
        assert!(!map.contains_key("visible"));
    }

    #[test]
    fn test_get_properties_out_of_bounds() {
        let layer = make_layer_data();
        let result: Option<serde_json::Value> = layer.get_properties(99);
        assert!(result.is_none());
    }

    #[test]
    fn test_get_filtered_properties_ordering_and_missing() {
        let layer = make_layer_data();
        let keys = vec![
            "visible".to_string(),
            "nonexistent".to_string(),
            "name".to_string(),
        ];

        let result: Vec<Option<serde_json::Value>> = layer
            .get_filtered_properties(0, &layer.key_filter(&keys))
            .unwrap();

        assert_eq!(result.len(), 3);
        assert_eq!(result[0], Some(json!(true)));
        assert_eq!(result[1], None);
        assert_eq!(result[2], Some(json!("building_a")));
    }

    #[test]
    fn test_get_filtered_properties_feature_missing_some_keys() {
        let layer = make_layer_data();
        // Feature 1 has no "visible" tag
        let keys = vec!["visible".to_string(), "name".to_string()];
        let result: Vec<Option<serde_json::Value>> = layer
            .get_filtered_properties(1, &layer.key_filter(&keys))
            .unwrap();

        assert_eq!(result[0], None);
        assert_eq!(result[1], Some(json!("building_b")));
    }
}
