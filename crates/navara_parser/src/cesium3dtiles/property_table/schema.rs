use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;

use navara_glb::{BinaryReader, GLB_HEADER_SIZE, Glb};
use serde_json::Value;

use super::data::{PropertyColumnData, PropertyTableData, encode_no_data, infer_component_type};

/// Features are picked through 24-bit ids, so no tile can use more.
const MAX_FEATURE_COUNT: u32 = 0xff_ffff;

fn property_table_of(set: &Value) -> Option<usize> {
    Some(set.get("propertyTable")?.as_u64()? as usize)
}

/// Parses a GLB binary and provides methods for extracting 3D Tiles 1.1
/// feature metadata from EXT_mesh_features and EXT_structural_metadata.
pub struct GlbSchemaParser<'a> {
    /// The parsed glTF JSON.
    pub json: Value,
    /// The binary chunk data, if present.
    pub binary: Option<&'a [u8]>,
    /// Byte offset where the BIN chunk **data** starts within the full GLB binary
    /// (i.e. after the 8-byte chunk header: chunk_length + chunk_type).
    pub bin_data_start: usize,
}

impl<'a> GlbSchemaParser<'a> {
    /// Parses a GLB binary into its JSON and binary chunks.
    ///
    /// Uses `navara_glb::Glb` for JSON chunk parsing and extracts
    /// the binary chunk via offset calculation from the raw bytes.
    pub fn new(glb_bin: &'a [u8]) -> Option<Self> {
        let glb = Glb::from_data(glb_bin).ok()?;
        let json = glb.0.json_chunk.data;

        // Extract binary chunk: skip header(12) + JSON chunk header(8) + JSON data
        let chunk_header_size = 8; // chunk_length(4) + chunk_type(4)
        let json_chunk_length = glb_bin
            .get(GLB_HEADER_SIZE..GLB_HEADER_SIZE + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)?;
        let bin_data_start = GLB_HEADER_SIZE + chunk_header_size + json_chunk_length;

        // GLB BIN chunk type magic: 0x004E4942 ("BIN\0" in little-endian)
        const GLB_CHUNK_TYPE_BIN: u32 = 0x004E4942;

        let (binary, bin_data_start) = if glb_bin.len() >= bin_data_start + chunk_header_size {
            let bin_chunk_length = u32::from_le_bytes([
                glb_bin[bin_data_start],
                glb_bin[bin_data_start + 1],
                glb_bin[bin_data_start + 2],
                glb_bin[bin_data_start + 3],
            ]) as usize;
            let bin_chunk_type = u32::from_le_bytes([
                glb_bin[bin_data_start + 4],
                glb_bin[bin_data_start + 5],
                glb_bin[bin_data_start + 6],
                glb_bin[bin_data_start + 7],
            ]);
            if bin_chunk_type != GLB_CHUNK_TYPE_BIN {
                (None, bin_data_start + chunk_header_size)
            } else {
                let data_start = bin_data_start + chunk_header_size;
                let bin_data_end = data_start + bin_chunk_length;
                if glb_bin.len() >= bin_data_end {
                    (Some(&glb_bin[data_start..bin_data_end]), data_start)
                } else {
                    (None, data_start)
                }
            }
        } else {
            (None, bin_data_start + chunk_header_size)
        };

        Some(Self {
            json,
            binary,
            bin_data_start,
        })
    }

    /// The first feature ID set of each node's `EXT_instance_features`, then
    /// of each primitive's `EXT_mesh_features`: the sets a renderer reads by
    /// default.
    fn default_feature_id_sets(&self) -> impl Iterator<Item = &Value> {
        fn first<'v>(owner: &'v Value, extension: &str) -> Option<&'v Value> {
            owner
                .get("extensions")?
                .get(extension)?
                .get("featureIds")?
                .as_array()?
                .first()
        }
        let array = |key: &str| {
            self.json
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        };
        let instance_sets = array("nodes").filter_map(|node| first(node, "EXT_instance_features"));
        let primitive_sets = array("meshes")
            .filter_map(|mesh| mesh.get("primitives")?.as_array())
            .flatten()
            .filter_map(|primitive| first(primitive, "EXT_mesh_features"));
        instance_sets.chain(primitive_sets)
    }

    /// Largest `featureCount` of the default feature ID sets referencing
    /// [`Self::property_table_index`], at most the rows of that table (as
    /// CesiumJS) and [`MAX_FEATURE_COUNT`]; 0 without one. Only those sets
    /// have features.
    pub fn feature_count(&self) -> u32 {
        let table = self.property_table_index();
        let limit = table
            .and_then(|index| self.property_table_rows(index))
            .map_or(MAX_FEATURE_COUNT.into(), |rows| {
                rows.min(MAX_FEATURE_COUNT.into())
            });
        self.default_feature_id_sets()
            .filter(|set| property_table_of(set) == table)
            .filter_map(|set| set.get("featureCount")?.as_u64())
            .max()
            .map_or(0, |count| count.min(limit) as u32)
    }

    /// The `count` of a property table, at most the rows its largest column
    /// can hold: a row takes at least one bit (BOOLEAN), and a column at
    /// least its values, array offsets and string offsets.
    fn property_table_rows(&self, index: usize) -> Option<u64> {
        let table = self
            .json
            .get("extensions")?
            .get("EXT_structural_metadata")?
            .get("propertyTables")?
            .get(index)?;
        let count = table.get("count")?.as_u64()?;
        let Some(columns) = table.get("properties").and_then(Value::as_object) else {
            return Some(count);
        };
        let column_bytes = |column: &Value| -> usize {
            ["values", "arrayOffsets", "stringOffsets"]
                .into_iter()
                .filter_map(|key| column.get(key)?.as_u64())
                .map(|view| self.buffer_view_range(view as usize).len())
                .sum()
        };
        match columns.values().map(column_bytes).max() {
            Some(bytes) => Some(count.min(bytes as u64 * 8)),
            None => Some(count),
        }
    }

    /// A buffer view as a byte range within the BIN chunk; empty when it
    /// does not fit.
    fn buffer_view_range(&self, index: usize) -> Range<usize> {
        let binary_len = self.binary.map_or(0, <[u8]>::len);
        let Some(view) = self
            .json
            .get("bufferViews")
            .and_then(|views| views.get(index))
        else {
            return 0..0;
        };
        let byte_offset = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
        let byte_length = view.get("byteLength").and_then(Value::as_u64).unwrap_or(0) as usize;
        match byte_offset.checked_add(byte_length) {
            Some(end) if end <= binary_len => byte_offset..end,
            _ => 0..0,
        }
    }

    /// `propertyTable` of the first default feature ID set with one.
    pub fn property_table_index(&self) -> Option<usize> {
        self.default_feature_id_sets().find_map(property_table_of)
    }

    /// Extracts PropertyTable data from EXT_structural_metadata.
    ///
    /// Reads `extensions.EXT_structural_metadata.propertyTables[propertyTableIndex]`.
    /// An optional `tileset_schema` can be provided for tileset-level schema resolution.
    pub fn property_table(
        &self,
        property_table_index: usize,
        tileset_schema: Option<&Value>,
    ) -> Option<PropertyTableData> {
        let metadata = self
            .json
            .get("extensions")
            .and_then(|e| e.get("EXT_structural_metadata"))?;

        let property_tables = metadata
            .get("propertyTables")
            .and_then(|pt| pt.as_array())?;

        let table = property_tables.get(property_table_index)?;
        let count = table.get("count").and_then(|c| c.as_u64())? as u32;

        // Resolve type info from the schema class definition.
        // In 3D Tiles 1.1, the schema can be defined either:
        // 1. Inline in the glTF's EXT_structural_metadata extension
        // 2. At the tileset.json level (more common)
        let class_name = table.get("class").and_then(|c| c.as_str());
        let gltf_schema = metadata.get("schema");
        let schema = gltf_schema.or(tileset_schema);
        let schema_class_props = class_name.and_then(|cn| {
            schema
                .and_then(|s| s.get("classes"))
                .and_then(|c| c.get(cn))
                .and_then(|cls| cls.get("properties"))
        });

        let props_obj = table.get("properties").and_then(|p| p.as_object())?;

        let mut properties = HashMap::new();
        for (name, prop) in props_obj {
            let values_bv_index = match prop.get("values").and_then(|v| v.as_u64()) {
                Some(idx) => idx as usize,
                None => continue,
            };

            let values_range = self.buffer_view_range(values_bv_index);

            // Look up type info from the schema class property definition
            let schema_prop = schema_class_props.and_then(|p| p.get(name));

            let (component_type, element_type) = if let Some(sp) = schema_prop {
                let ct = sp
                    .get("componentType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let et = sp
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("SCALAR")
                    .to_string();
                (ct, et)
            } else {
                // No schema available: infer type from buffer size and feature count
                infer_component_type(values_range.len(), count)
            };

            // Resolve stringOffsets buffer view for STRING properties (per 3D Tiles 1.1 spec)
            let string_offsets_range = prop
                .get("stringOffsets")
                .and_then(|v| v.as_u64())
                .map(|idx| self.buffer_view_range(idx as usize));

            let string_offset_type = prop
                .get("stringOffsetType")
                .and_then(|v| v.as_str())
                .unwrap_or("UINT32")
                .to_string();

            // Spec: noData is a sentinel value indicating missing data.
            let no_data_json = schema_prop.and_then(|sp| sp.get("noData"));
            let no_data = no_data_json.and_then(|nd| encode_no_data(nd, &component_type));
            let string_no_data = if element_type == "STRING" {
                no_data_json
                    .and_then(|nd| nd.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            };
            let default = schema_prop.and_then(|sp| sp.get("default")).cloned();

            // Spec: normalized, offset, and scale transform raw values.
            let normalized = schema_prop
                .and_then(|sp| sp.get("normalized"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            // Property table entry's offset/scale override schema class property's.
            let prop_offset = parse_offset_scale(prop.get("offset"))
                .or_else(|| parse_offset_scale(schema_prop.and_then(|sp| sp.get("offset"))));

            let prop_scale = parse_offset_scale(prop.get("scale"))
                .or_else(|| parse_offset_scale(schema_prop.and_then(|sp| sp.get("scale"))));

            properties.insert(
                name.clone(),
                PropertyColumnData {
                    values_range,
                    component_type,
                    element_type,
                    no_data,
                    string_no_data,
                    default,
                    string_offsets_range,
                    string_offset_type,
                    normalized,
                    offset: prop_offset,
                    scale: prop_scale,
                },
            );
        }

        Some(PropertyTableData {
            count,
            properties: Arc::new(properties),
        })
    }
}

/// Parse an offset or scale value from JSON. Per spec, this can be a single number (SCALAR)
/// or an array of numbers (VEC/MAT types).
fn parse_offset_scale(value: Option<&Value>) -> Option<Vec<f64>> {
    let v = value?;
    if let Some(n) = v.as_f64() {
        return Some(vec![n]);
    }
    if let Some(arr) = v.as_array() {
        let nums: Vec<f64> = arr.iter().filter_map(|e| e.as_f64()).collect();
        if !nums.is_empty() {
            return Some(nums);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // =========================================================================
    // feature_count
    // =========================================================================

    fn make_parser_from_json(gltf_json: Value) -> GlbSchemaParser<'static> {
        GlbSchemaParser {
            json: gltf_json,
            binary: None,
            bin_data_start: 0,
        }
    }

    fn make_parser_with_binary<'a>(gltf_json: Value, binary: &'a [u8]) -> GlbSchemaParser<'a> {
        GlbSchemaParser {
            json: gltf_json,
            binary: Some(binary),
            bin_data_start: 0,
        }
    }

    #[test]
    fn test_feature_count_with_vertex_attribute() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "attributes": { "POSITION": 0, "_FEATURE_ID_0": 1 },
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{
                                "featureCount": 10,
                                "attribute": 0,
                                "propertyTable": 0,
                                "label": "buildings"
                            }]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.feature_count(), 10);
    }

    #[test]
    fn test_feature_count_implicit_index() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{
                                "featureCount": 100
                            }]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.feature_count(), 100);
    }

    // standard: EXT_mesh_features "Feature ID by Texture Coordinates"
    // ref: https://github.com/CesiumGS/glTF/tree/proposal-EXT_mesh_features/extensions/2.0/Vendor/EXT_mesh_features#feature-id-by-texture-coordinates
    #[test]
    fn test_feature_count_with_texture() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{
                                "featureCount": 4,
                                "texture": { "index": 1, "texCoord": 0, "channels": [0] },
                                "propertyTable": 0
                            }]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.feature_count(), 4);
        assert_eq!(parser.property_table_index(), Some(0));
    }

    fn texture_ids_with_table(feature_count: u64, table: Value) -> Value {
        json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{
                                "featureCount": feature_count,
                                "texture": { "index": 0 },
                                "propertyTable": 0
                            }]
                        }
                    }
                }]
            }],
            "extensions": {
                "EXT_structural_metadata": { "propertyTables": [table] }
            },
            "bufferViews": [
                { "byteOffset": 0, "byteLength": 4 },
                { "byteOffset": 4, "byteLength": 4 }
            ]
        })
    }

    // standard: EXT_structural_metadata "Property Tables" (feature IDs index
    // the table's rows; CesiumJS takes `count` as the feature count)
    // ref: https://github.com/CesiumGS/glTF/tree/3d-tiles-next/extensions/2.0/Vendor/EXT_structural_metadata#property-tables
    #[test]
    fn test_feature_count_is_capped_to_property_table_count() {
        let binary = [0u8; 8];
        let parser = make_parser_with_binary(
            texture_ids_with_table(
                10,
                json!({ "count": 3, "properties": { "a": { "values": 0 } } }),
            ),
            &binary,
        );
        assert_eq!(parser.feature_count(), 3);
    }

    // user: allocation-bounded-by-input
    #[test]
    fn test_feature_count_is_bounded_by_property_table_bytes() {
        let binary = [0u8; 8];
        let parser = make_parser_with_binary(
            texture_ids_with_table(
                u32::MAX.into(),
                json!({
                    "count": u32::MAX,
                    "properties": {
                        "a": { "values": 0 },
                        "b": { "values": 1, "stringOffsets": 0 }
                    }
                }),
            ),
            &binary,
        );
        // One bit per row of the largest column, "b" (8 bytes).
        assert_eq!(parser.feature_count(), 64);
    }

    // user: allocation-bounded-by-input
    #[test]
    fn test_feature_count_ignores_buffer_views_outside_the_binary() {
        let parser = make_parser_from_json(texture_ids_with_table(
            100,
            json!({ "count": 100, "properties": { "a": { "values": 0 } } }),
        ));
        assert_eq!(parser.feature_count(), 0);
    }

    // Without a property table nothing bounds the count by input; at least
    // stay within the pick ID space.
    #[test]
    fn test_feature_count_is_capped_to_pick_id_space() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{ "featureCount": u32::MAX }]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.feature_count(), MAX_FEATURE_COUNT);
    }

    #[test]
    fn test_feature_count_multiple_feature_id_sets() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [
                                {
                                    "featureCount": 2,
                                    "nullFeatureId": 2,
                                    "attribute": 0,
                                    "propertyTable": 0,
                                    "label": "Forests"
                                },
                                {
                                    "featureCount": 9,
                                    "propertyTable": 1,
                                    "label": "Trees"
                                }
                            ]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.feature_count(), 2);
    }

    #[test]
    fn test_feature_count_no_meshes() {
        let parser = make_parser_from_json(json!({}));
        assert_eq!(parser.feature_count(), 0);
    }

    #[test]
    fn test_feature_count_no_extension() {
        let parser = make_parser_from_json(json!({
            "meshes": [{ "primitives": [{}] }]
        }));
        assert_eq!(parser.feature_count(), 0);
    }

    #[test]
    fn test_feature_count_skips_primitive_without_extension() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [
                    { "attributes": { "POSITION": 0 } },
                    {
                        "attributes": { "POSITION": 1 },
                        "extensions": {
                            "EXT_mesh_features": {
                                "featureIds": [{ "featureCount": 7 }]
                            }
                        }
                    }
                ]
            }]
        }));
        assert_eq!(parser.feature_count(), 7);
    }

    #[test]
    fn test_feature_count_empty_feature_ids() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": []
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.feature_count(), 0);
    }

    // =========================================================================
    // property_table_index
    // =========================================================================

    #[test]
    fn test_property_table_index_basic() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{
                                "featureCount": 10,
                                "attribute": 0,
                                "propertyTable": 0
                            }]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.property_table_index(), Some(0));
    }

    #[test]
    fn test_property_table_index_uses_first_feature_id_set() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [
                                { "featureCount": 5, "propertyTable": 0 },
                                { "featureCount": 20, "propertyTable": 1 }
                            ]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.property_table_index(), Some(0));
    }

    #[test]
    fn test_property_table_index_none_when_absent() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{ "featureCount": 5 }]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.property_table_index(), None);
    }

    #[test]
    fn test_property_table_index_no_meshes() {
        let parser = make_parser_from_json(json!({}));
        assert_eq!(parser.property_table_index(), None);
    }

    // =========================================================================
    // EXT_instance_features
    // =========================================================================

    #[test]
    fn test_feature_id_sets_of_another_property_table_have_no_features() {
        let parser = make_parser_from_json(json!({
            "nodes": [
                { "mesh": 0 },
                {
                    "mesh": 0,
                    "extensions": {
                        "EXT_instance_features": {
                            "featureIds": [
                                { "featureCount": 4, "propertyTable": 1 },
                                { "featureCount": 20, "attribute": 0, "propertyTable": 0 }
                            ]
                        }
                    }
                }
            ],
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{ "featureCount": 9, "attribute": 0, "propertyTable": 0 }]
                        }
                    }
                }]
            }]
        }));
        assert_eq!(parser.feature_count(), 4);
        assert_eq!(parser.property_table_index(), Some(1));
    }

    #[test]
    fn test_property_table_index_skips_sets_without_one() {
        let parser = make_parser_from_json(json!({
            "meshes": [{
                "primitives": [
                    { "extensions": { "EXT_mesh_features": { "featureIds": [{ "featureCount": 5 }] } } },
                    { "extensions": { "EXT_mesh_features": { "featureIds": [{ "featureCount": 5, "propertyTable": 0 }] } } }
                ]
            }]
        }));
        assert_eq!(parser.property_table_index(), Some(0));
    }

    // =========================================================================
    // property_table
    // =========================================================================

    fn make_tree_survey_gltf_json() -> Value {
        json!({
            "extensions": {
                "EXT_structural_metadata": {
                    "schema": {
                        "id": "TreeMetadata",
                        "classes": {
                            "tree": {
                                "properties": {
                                    "height": {
                                        "type": "SCALAR",
                                        "componentType": "FLOAT32"
                                    },
                                    "age": {
                                        "type": "SCALAR",
                                        "componentType": "UINT32"
                                    }
                                }
                            }
                        }
                    },
                    "propertyTables": [{
                        "name": "tree_survey",
                        "class": "tree",
                        "count": 3,
                        "properties": {
                            "height": { "values": 0 },
                            "age": { "values": 1 }
                        }
                    }]
                }
            },
            "bufferViews": [
                { "byteOffset": 0, "byteLength": 12 },
                { "byteOffset": 12, "byteLength": 12 }
            ]
        })
    }

    fn make_tree_survey_binary() -> Vec<u8> {
        let mut bin = Vec::new();
        bin.extend_from_slice(&10.5f32.to_le_bytes());
        bin.extend_from_slice(&20.0f32.to_le_bytes());
        bin.extend_from_slice(&30.75f32.to_le_bytes());
        bin.extend_from_slice(&5u32.to_le_bytes());
        bin.extend_from_slice(&12u32.to_le_bytes());
        bin.extend_from_slice(&25u32.to_le_bytes());
        bin
    }

    #[test]
    fn test_property_table_resolves_types_from_schema_class() {
        let binary = make_tree_survey_binary();
        let parser = make_parser_with_binary(make_tree_survey_gltf_json(), &binary);
        let table = parser.property_table(0, None).unwrap();

        assert_eq!(table.count, 3);

        let height = table.properties.get("height").unwrap();
        assert_eq!(height.component_type, "FLOAT32");
        assert_eq!(height.element_type, "SCALAR");

        let age = table.properties.get("age").unwrap();
        assert_eq!(age.component_type, "UINT32");
        assert_eq!(age.element_type, "SCALAR");
    }

    #[test]
    fn test_property_table_reads_binary_via_buffer_views() {
        let binary = make_tree_survey_binary();
        let parser = make_parser_with_binary(make_tree_survey_gltf_json(), &binary);
        let table = parser.property_table(0, None).unwrap();

        let height = table.properties.get("height").unwrap();
        assert_eq!(height.values_range.len(), 12);

        let age = table.properties.get("age").unwrap();
        assert_eq!(age.values_range.len(), 12);
    }

    #[test]
    fn test_property_table_decodes_values() {
        let binary = make_tree_survey_binary();
        let parser = make_parser_with_binary(make_tree_survey_gltf_json(), &binary);
        let table = parser.property_table(0, None).unwrap();

        let props: Value = table.get_properties(0, &binary).unwrap();
        let map = props.as_object().unwrap();
        assert!((map["height"].as_f64().unwrap() - 10.5).abs() < 1e-6);
        assert_eq!(map["age"].as_u64(), Some(5));

        let props: Value = table.get_properties(2, &binary).unwrap();
        let map = props.as_object().unwrap();
        assert!((map["height"].as_f64().unwrap() - 30.75).abs() < 1e-6);
        assert_eq!(map["age"].as_u64(), Some(25));
    }

    #[test]
    fn test_property_table_vec3_property() {
        let gltf_json = json!({
            "extensions": {
                "EXT_structural_metadata": {
                    "schema": {
                        "classes": {
                            "building": {
                                "properties": {
                                    "color": {
                                        "type": "VEC3",
                                        "componentType": "FLOAT32"
                                    }
                                }
                            }
                        }
                    },
                    "propertyTables": [{
                        "class": "building",
                        "count": 2,
                        "properties": {
                            "color": { "values": 0 }
                        }
                    }]
                }
            },
            "bufferViews": [
                { "byteOffset": 0, "byteLength": 24 }
            ]
        });

        let mut bin = Vec::new();
        bin.extend_from_slice(&1.0f32.to_le_bytes());
        bin.extend_from_slice(&0.0f32.to_le_bytes());
        bin.extend_from_slice(&0.0f32.to_le_bytes());
        bin.extend_from_slice(&0.0f32.to_le_bytes());
        bin.extend_from_slice(&1.0f32.to_le_bytes());
        bin.extend_from_slice(&0.0f32.to_le_bytes());

        let parser = make_parser_with_binary(gltf_json, &bin);
        let table = parser.property_table(0, None).unwrap();
        let props: Value = table.get_properties(1, &bin).unwrap();
        let color = props.as_object().unwrap()["color"].as_array().unwrap();
        assert_eq!(color.len(), 3);
        assert!((color[0].as_f64().unwrap()).abs() < 1e-6);
        assert!((color[1].as_f64().unwrap() - 1.0).abs() < 1e-6);
        assert!((color[2].as_f64().unwrap()).abs() < 1e-6);
    }

    #[test]
    fn test_property_table_multiple_classes() {
        let gltf_json = json!({
            "extensions": {
                "EXT_structural_metadata": {
                    "schema": {
                        "classes": {
                            "tree": {
                                "properties": {
                                    "height": { "type": "SCALAR", "componentType": "FLOAT32" }
                                }
                            },
                            "building": {
                                "properties": {
                                    "floors": { "type": "SCALAR", "componentType": "UINT8" }
                                }
                            }
                        }
                    },
                    "propertyTables": [
                        {
                            "class": "tree",
                            "count": 1,
                            "properties": {
                                "height": { "values": 0 }
                            }
                        },
                        {
                            "class": "building",
                            "count": 1,
                            "properties": {
                                "floors": { "values": 1 }
                            }
                        }
                    ]
                }
            },
            "bufferViews": [
                { "byteOffset": 0, "byteLength": 4 },
                { "byteOffset": 4, "byteLength": 1 }
            ]
        });

        let mut bin = Vec::new();
        bin.extend_from_slice(&25.0f32.to_le_bytes());
        bin.push(3u8);

        let parser = make_parser_with_binary(gltf_json, &bin);

        let tree_table = parser.property_table(0, None).unwrap();
        let tree_props: Value = tree_table.get_properties(0, &bin).unwrap();
        assert!((tree_props["height"].as_f64().unwrap() - 25.0).abs() < 1e-6);

        let building_table = parser.property_table(1, None).unwrap();
        let bld_props: Value = building_table.get_properties(0, &bin).unwrap();
        assert_eq!(bld_props["floors"].as_u64(), Some(3));
    }

    #[test]
    fn test_property_table_no_binary() {
        let parser = make_parser_from_json(make_tree_survey_gltf_json());
        let table = parser.property_table(0, None).unwrap();

        assert_eq!(table.count, 3);
        let height = table.properties.get("height").unwrap();
        assert!(height.values_range.is_empty());
    }

    #[test]
    fn test_property_table_invalid_index() {
        let parser = make_parser_from_json(make_tree_survey_gltf_json());
        assert!(parser.property_table(99, None).is_none());
    }

    #[test]
    fn test_property_table_no_metadata() {
        let parser = make_parser_from_json(json!({}));
        assert!(parser.property_table(0, None).is_none());
    }

    #[test]
    fn test_property_table_defaults_without_schema() {
        let gltf_json = json!({
            "extensions": {
                "EXT_structural_metadata": {
                    "propertyTables": [{
                        "count": 2,
                        "properties": {
                            "value": { "values": 0 }
                        }
                    }]
                }
            },
            "bufferViews": [
                { "byteOffset": 0, "byteLength": 8 }
            ]
        });

        let mut bin = Vec::new();
        bin.extend_from_slice(&42u32.to_le_bytes());
        bin.extend_from_slice(&99u32.to_le_bytes());

        let parser = make_parser_with_binary(gltf_json, &bin);
        let table = parser.property_table(0, None).unwrap();
        let col = table.properties.get("value").unwrap();
        assert_eq!(col.component_type, "FLOAT32");
        assert_eq!(col.element_type, "SCALAR");
    }

    #[test]
    fn test_property_table_tileset_level_schema() {
        let gltf_json = json!({
            "extensions": {
                "EXT_structural_metadata": {
                    "propertyTables": [{
                        "class": "building",
                        "count": 2,
                        "properties": {
                            "height": { "values": 0 }
                        }
                    }]
                }
            },
            "bufferViews": [
                { "byteOffset": 0, "byteLength": 8 }
            ]
        });

        let tileset_schema = json!({
            "id": "BuildingSchema",
            "classes": {
                "building": {
                    "properties": {
                        "height": {
                            "type": "SCALAR",
                            "componentType": "FLOAT32"
                        }
                    }
                }
            }
        });

        let mut bin = Vec::new();
        bin.extend_from_slice(&10.5f32.to_le_bytes());
        bin.extend_from_slice(&20.0f32.to_le_bytes());

        let parser = make_parser_with_binary(gltf_json, &bin);
        let table = parser.property_table(0, Some(&tileset_schema)).unwrap();
        let col = table.properties.get("height").unwrap();
        assert_eq!(col.component_type, "FLOAT32");
        assert_eq!(col.element_type, "SCALAR");

        let props: Value = table.get_properties(0, &bin).unwrap();
        assert!((props["height"].as_f64().unwrap() - 10.5).abs() < 1e-6);
    }

    // =========================================================================
    // GlbSchemaParser::new (GLB parsing)
    // =========================================================================

    fn make_glb(json_bytes: &[u8], bin_bytes: &[u8]) -> Vec<u8> {
        let json_padded_len = (json_bytes.len() + 3) & !3;
        let bin_padded_len = (bin_bytes.len() + 3) & !3;
        let total_len = 12 + 8 + json_padded_len + 8 + bin_padded_len;
        let mut glb = Vec::with_capacity(total_len);

        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&(total_len as u32).to_le_bytes());

        glb.extend_from_slice(&(json_padded_len as u32).to_le_bytes());
        glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
        glb.extend_from_slice(json_bytes);
        glb.resize(12 + 8 + json_padded_len, 0x20);

        glb.extend_from_slice(&(bin_padded_len as u32).to_le_bytes());
        glb.extend_from_slice(&0x004E4942u32.to_le_bytes());
        glb.extend_from_slice(bin_bytes);
        glb.resize(total_len, 0x00);

        glb
    }

    #[test]
    fn test_new_basic() {
        let json_str = r#"{"asset":{"version":"2.0"}}"#;
        let glb = make_glb(json_str.as_bytes(), &[0u8; 4]);

        let parser = GlbSchemaParser::new(&glb).unwrap();
        assert_eq!(parser.json["asset"]["version"], "2.0");
    }

    #[test]
    fn test_new_with_extensions() {
        let json_str = serde_json::to_string(&json!({
            "asset": { "version": "2.0" },
            "extensionsUsed": ["EXT_mesh_features", "EXT_structural_metadata"],
            "meshes": [{
                "primitives": [{
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{ "featureCount": 5, "propertyTable": 0 }]
                        }
                    }
                }]
            }]
        }))
        .unwrap();
        let glb = make_glb(json_str.as_bytes(), &[0u8; 4]);

        let parser = GlbSchemaParser::new(&glb).unwrap();
        let ext_used = parser.json["extensionsUsed"].as_array().unwrap();
        assert_eq!(ext_used.len(), 2);
        assert_eq!(parser.feature_count(), 5);
    }

    #[test]
    fn test_new_too_short() {
        assert!(GlbSchemaParser::new(&[0u8; 10]).is_none());
    }

    #[test]
    fn test_new_binary_chunk() {
        let bin_data = vec![1u8, 2, 3, 4, 5, 6, 7, 8];
        let glb = make_glb(b"{}", &bin_data);

        let parser = GlbSchemaParser::new(&glb).unwrap();
        let binary = parser.binary.unwrap();
        assert_eq!(&binary[..8], &[1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn test_new_no_binary_chunk() {
        let json_bytes = b"{}";
        let json_padded_len = 4;
        let total_len = 12 + 8 + json_padded_len;
        let mut glb = Vec::with_capacity(total_len);
        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&(total_len as u32).to_le_bytes());
        glb.extend_from_slice(&(json_padded_len as u32).to_le_bytes());
        glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
        glb.extend_from_slice(json_bytes);
        glb.resize(total_len, 0x20);

        let parser = GlbSchemaParser::new(&glb).unwrap();
        assert!(parser.binary.is_none());
    }

    // =========================================================================
    // Integration: end-to-end GLB → extract pipeline
    // =========================================================================

    #[test]
    fn test_end_to_end_glb_to_property_extraction() {
        let mut bin = Vec::new();
        bin.extend_from_slice(&10.5f32.to_le_bytes());
        bin.extend_from_slice(&20.0f32.to_le_bytes());
        bin.extend_from_slice(&30.75f32.to_le_bytes());
        bin.extend_from_slice(&5u32.to_le_bytes());
        bin.extend_from_slice(&12u32.to_le_bytes());
        bin.extend_from_slice(&25u32.to_le_bytes());

        let gltf_json_value = json!({
            "asset": { "version": "2.0" },
            "extensionsUsed": ["EXT_mesh_features", "EXT_structural_metadata"],
            "extensions": {
                "EXT_structural_metadata": {
                    "schema": {
                        "id": "TreeMetadata",
                        "classes": {
                            "tree": {
                                "properties": {
                                    "height": { "type": "SCALAR", "componentType": "FLOAT32" },
                                    "age": { "type": "SCALAR", "componentType": "UINT32" }
                                }
                            }
                        }
                    },
                    "propertyTables": [{
                        "name": "tree_survey",
                        "class": "tree",
                        "count": 3,
                        "properties": {
                            "height": { "values": 0 },
                            "age": { "values": 1 }
                        }
                    }]
                }
            },
            "meshes": [{
                "primitives": [{
                    "attributes": { "POSITION": 2 },
                    "extensions": {
                        "EXT_mesh_features": {
                            "featureIds": [{
                                "featureCount": 3,
                                "attribute": 0,
                                "propertyTable": 0
                            }]
                        }
                    }
                }]
            }],
            "bufferViews": [
                { "byteOffset": 0, "byteLength": 12 },
                { "byteOffset": 12, "byteLength": 12 }
            ]
        });

        let json_bytes = serde_json::to_vec(&gltf_json_value).unwrap();
        let glb = make_glb(&json_bytes, &bin);

        let parser = GlbSchemaParser::new(&glb).unwrap();

        assert_eq!(parser.feature_count(), 3);
        assert_eq!(parser.property_table_index(), Some(0));

        let table = parser.property_table(0, None).unwrap();
        assert_eq!(table.count, 3);

        let binary = parser.binary.unwrap();
        let props: Value = table.get_properties(1, binary).unwrap();
        let map = props.as_object().unwrap();
        assert!((map["height"].as_f64().unwrap() - 20.0).abs() < 1e-6);
        assert_eq!(map["age"].as_u64(), Some(12));
    }
}
