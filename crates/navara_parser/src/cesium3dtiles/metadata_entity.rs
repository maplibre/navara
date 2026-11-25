//! Resolves the JSON metadata entities of a 3D Tiles 1.1 tileset (tileset,
//! tile, content and group `metadata`) against the tileset `schema`.
//!
//! <https://github.com/CesiumGS/3d-tiles/tree/main/specification/Metadata#json-format>

use std::collections::HashMap;

use serde_json::{Map, Number, Value};

use super::property_table::transform_component;

/// Returns `{ "class": class, "properties": { .. } }` with each value in its
/// final form: `normalized`, `offset` and `scale` applied, a `noData` value
/// replaced by `default` (or null), and an omitted property filled with
/// `default`. Without a schema class, the values are returned as they are.
pub fn resolve_metadata_entity(
    schema: Option<&Value>,
    class: &str,
    properties: Option<&HashMap<String, Value>>,
) -> Value {
    let class_properties = schema
        .and_then(|s| s.get("classes"))
        .and_then(|c| c.get(class))
        .and_then(|c| c.get("properties"))
        .and_then(Value::as_object);

    let mut resolved = Map::new();
    if let Some(properties) = properties {
        for (name, value) in properties {
            let value = match class_properties.and_then(|c| c.get(name)) {
                Some(definition) => resolve_value(value, definition),
                None => value.clone(),
            };
            resolved.insert(name.clone(), value);
        }
    }
    if let Some(class_properties) = class_properties {
        for (name, definition) in class_properties {
            if !resolved.contains_key(name)
                && let Some(default) = definition.get("default")
            {
                resolved.insert(name.clone(), default.clone());
            }
        }
    }

    let mut entity = Map::new();
    entity.insert("class".to_string(), Value::String(class.to_string()));
    entity.insert("properties".to_string(), Value::Object(resolved));
    Value::Object(entity)
}

fn resolve_value(value: &Value, definition: &Value) -> Value {
    // `noData` is in raw form, `default` in final form.
    if definition
        .get("noData")
        .is_some_and(|no_data| json_eq(value, no_data))
    {
        return definition.get("default").cloned().unwrap_or(Value::Null);
    }

    let normalized = definition
        .get("normalized")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    // A variable-length array has no well-defined offset and scale.
    let is_variable_length = definition.get("array").and_then(Value::as_bool) == Some(true)
        && definition.get("count").is_none();
    let (offset, scale) = if is_variable_length {
        (None, None)
    } else {
        (definition.get("offset"), definition.get("scale"))
    };
    if !normalized && offset.is_none() && scale.is_none() {
        return value.clone();
    }

    let component_type = normalized
        .then(|| definition.get("componentType").and_then(Value::as_str))
        .flatten();
    transform(value, offset, scale, component_type)
}

/// `==` where numbers compare by value, as in JavaScript (`-1` equals `-1.0`).
fn json_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) if a.is_f64() || b.is_f64() => {
            a.as_f64() == b.as_f64()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| json_eq(a, b))
        }
        _ => a == b,
    }
}

/// `offset + scale * normalize(value)`, component-wise. `offset` and `scale`
/// follow the shape of `value` (VECN, MATN, fixed-length arrays) or are a
/// single number applied to every component.
fn transform(
    value: &Value,
    offset: Option<&Value>,
    scale: Option<&Value>,
    component_type: Option<&str>,
) -> Value {
    match value {
        Value::Number(n) => {
            let Some(raw) = n.as_f64() else {
                return value.clone();
            };
            let v = transform_component(
                raw,
                component_type,
                offset.and_then(Value::as_f64),
                scale.and_then(Value::as_f64),
            );
            Number::from_f64(v).map_or(Value::Null, Value::Number)
        }
        Value::Array(values) => Value::Array(
            values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    transform(
                        v,
                        component_of(offset, i),
                        component_of(scale, i),
                        component_type,
                    )
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn component_of(v: Option<&Value>, i: usize) -> Option<&Value> {
    match v {
        Some(Value::Array(values)) => values.get(i),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    //! Cases ported from the CesiumJS specs, with raw (pre-normalization)
    //! inputs where the spec feeds already-normalized values:
    //! <https://github.com/CesiumGS/cesium/blob/e1f243e07d795c5acb7df8f1be622c9eeb83a532/packages/engine/Specs/Scene/MetadataEntitySpec.js>
    //! <https://github.com/CesiumGS/cesium/blob/e1f243e07d795c5acb7df8f1be622c9eeb83a532/packages/engine/Specs/Scene/MetadataClassPropertySpec.js>

    use serde_json::json;

    use super::*;

    fn resolve_class(class_properties: Value, properties: Value) -> Value {
        let schema = json!({ "classes": { "c": { "properties": class_properties } } });
        let properties: HashMap<String, Value> = serde_json::from_value(properties).unwrap();
        resolve_metadata_entity(Some(&schema), "c", Some(&properties))["properties"].clone()
    }

    /// Resolves each raw value of a single property `p` defined by `definition`.
    fn assert_resolves(definition: Value, cases: &[(Value, Value)]) {
        for (raw, expected) in cases {
            let resolved = resolve_class(json!({ "p": definition }), json!({ "p": raw }));
            assert_approx(&resolved["p"], expected, &format!("{definition} <- {raw}"));
        }
    }

    fn assert_approx(actual: &Value, expected: &Value, context: &str) {
        match (actual, expected) {
            (Value::Number(a), Value::Number(e)) => {
                let (a, e) = (a.as_f64().unwrap(), e.as_f64().unwrap());
                assert!((a - e).abs() <= 1e-12, "{context}: {a} != {e}");
            }
            (Value::Array(a), Value::Array(e)) => {
                assert_eq!(a.len(), e.len(), "{context}: {actual} != {expected}");
                for (a, e) in a.iter().zip(e) {
                    assert_approx(a, e, context);
                }
            }
            (Value::Object(a), Value::Object(e)) => {
                assert_eq!(a.len(), e.len(), "{context}: {actual} != {expected}");
                for (key, e) in e {
                    assert_approx(&a[key], e, &format!("{context}.{key}"));
                }
            }
            _ => assert_eq!(actual, expected, "{context}"),
        }
    }

    // MetadataEntitySpec: "getProperty returns the property value", "... the
    // default value when the property is missing", "... handles arrays of
    // vectors correctly", "handles offset and scale".
    #[test]
    fn entity_get_property() {
        let resolved = resolve_class(
            json!({
                "name": { "type": "STRING", "semantic": "NAME", "required": true },
                "height": { "type": "SCALAR", "componentType": "FLOAT32", "required": false, "default": 10.0 },
                "position": { "type": "SCALAR", "componentType": "FLOAT32", "array": true, "count": 3, "required": true },
                "axisColors": { "array": true, "count": 3, "type": "VEC3", "componentType": "UINT8", "normalized": true, "required": true },
                "temperature": { "type": "SCALAR", "componentType": "UINT8", "normalized": true, "offset": 32, "scale": 180 },
                "temperatureArray": { "array": true, "count": 4, "type": "SCALAR", "componentType": "UINT8", "normalized": true, "offset": [32, 32, 32, 32], "scale": [180, 180, 180, 180] },
            }),
            json!({
                "name": "Building A",
                "position": [0.0, 0.0, 0.0],
                "axisColors": [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
                "temperature": 0,
                "temperatureArray": [0, 255, 255, 0],
            }),
        );
        assert_approx(
            &resolved,
            &json!({
                "name": "Building A",
                "height": 10.0,
                "position": [0.0, 0.0, 0.0],
                "axisColors": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                "temperature": 32,
                "temperatureArray": [32, 212, 212, 32],
            }),
            "entity",
        );
    }

    // MetadataEntitySpec: "getProperty handles noData correctly". CesiumJS
    // returns `undefined` where this returns null.
    #[test]
    fn entity_no_data() {
        let resolved = resolve_class(
            json!({
                "noDefault": { "type": "SCALAR", "componentType": "INT32", "required": false, "noData": -1 },
                "hasDefault": { "type": "SCALAR", "componentType": "INT32", "required": false, "noData": -1, "default": 100 },
                "noDefaultVector": { "type": "VEC2", "componentType": "FLOAT32", "required": false, "noData": [0.0, 0.0] },
                "hasDefaultVector": { "type": "VEC2", "componentType": "FLOAT32", "required": false, "noData": [0.0, 0.0], "default": [100.0, 100.0] },
                "noDefaultArray": { "array": true, "type": "SCALAR", "componentType": "UINT8", "count": 3, "required": false, "noData": [0, 0, 0] },
                "hasDefaultArray": { "array": true, "type": "SCALAR", "componentType": "UINT8", "required": false, "noData": [], "default": [1, 1, 1] },
                "noDefaultArrayOfVector": { "array": true, "type": "VEC2", "componentType": "FLOAT32", "count": 3, "required": false, "noData": [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]] },
                "hasDefaultArrayOfVector": { "array": true, "type": "VEC2", "componentType": "FLOAT32", "required": false, "noData": [], "default": [[1.0, 1.0], [1.0, 1.0]] },
            }),
            json!({
                "noDefault": -1,
                "hasDefault": -1,
                "noDefaultVector": [0.0, 0.0],
                "hasDefaultVector": [0.0, 0.0],
                "noDefaultArray": [0, 0, 0],
                "hasDefaultArray": [],
                "noDefaultArrayOfVector": [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]],
                "hasDefaultArrayOfVector": [],
            }),
        );
        assert_eq!(
            resolved,
            json!({
                "noDefault": null,
                "hasDefault": 100,
                "noDefaultVector": null,
                "hasDefaultVector": [100.0, 100.0],
                "noDefaultArray": null,
                "hasDefaultArray": [1, 1, 1],
                "noDefaultArrayOfVector": null,
                "hasDefaultArrayOfVector": [[1.0, 1.0], [1.0, 1.0]],
            })
        );
    }

    // MetadataClassPropertySpec "handleNoData": "passes through valid values
    // unchanged", "converts noData values to undefined".
    #[test]
    fn handle_no_data() {
        let null = Value::Null;
        // `-1` against `noData: -1.0`.
        assert_resolves(
            json!({ "type": "SCALAR", "componentType": "FLOAT64", "noData": -1.0 }),
            &[(json!(1.0), json!(1.0)), (json!(-1), null.clone())],
        );
        assert_resolves(
            json!({ "array": true, "count": 4, "type": "SCALAR", "componentType": "UINT8", "noData": [255, 255, 255, 255] }),
            &[
                (json!([0, 0, 0, 255]), json!([0, 0, 0, 255])),
                (json!([255, 255, 255, 255]), null.clone()),
            ],
        );
        assert_resolves(
            json!({ "array": true, "type": "STRING", "noData": [] }),
            &[
                (json!(["Hello", "World"]), json!(["Hello", "World"])),
                (json!([]), null.clone()),
            ],
        );
        assert_resolves(
            json!({ "array": true, "count": 2, "type": "VEC2", "componentType": "FLOAT32", "noData": [[0, 0], [0, 0]] }),
            &[
                (json!([[1, 1], [2, -1]]), json!([[1, 1], [2, -1]])),
                (json!([[0, 0], [0.0, 0]]), null),
            ],
        );
    }

    // MetadataClassPropertySpec "normalize and unnormalize": "normalizes
    // scalar values", "... array values", "... vector and matrix values",
    // "... arrays of vectors".
    #[test]
    fn normalizes_integer_components() {
        for (component_type, raw) in [
            ("INT8", json!([-127, 0, 127])),
            ("INT16", json!([-32767, 0, 32767])),
            ("INT32", json!([-2147483647, 0, 2147483647])),
            (
                "INT64",
                json!([-9223372036854775807_i64, 0, 9223372036854775807_i64]),
            ),
        ] {
            let def =
                json!({ "type": "SCALAR", "componentType": component_type, "normalized": true });
            let expected = [json!(-1.0), json!(0.0), json!(1.0)];
            let cases: Vec<_> = raw
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .zip(expected)
                .collect();
            assert_resolves(def, &cases);
        }
        for (component_type, raw) in [
            ("UINT8", json!([0, 51, 255])),
            ("UINT16", json!([0, 13107, 65535])),
            ("UINT32", json!([0, 858993459, 4294967295_u64])),
            (
                "UINT64",
                json!([0, 3689348814741910528_u64, 18446744073709551615_u64]),
            ),
        ] {
            let def =
                json!({ "type": "SCALAR", "componentType": component_type, "normalized": true });
            let expected = [json!(0.0), json!(0.2), json!(1.0)];
            let cases: Vec<_> = raw
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .zip(expected)
                .collect();
            assert_resolves(def, &cases);
        }

        assert_resolves(
            json!({ "array": true, "type": "SCALAR", "componentType": "INT8", "normalized": true }),
            &[
                (json!([-127, 0]), json!([-1.0, 0.0])),
                (json!([127]), json!([1.0])),
                (json!([]), json!([])),
            ],
        );
        assert_resolves(
            json!({ "array": true, "count": 2, "type": "SCALAR", "componentType": "UINT8", "normalized": true }),
            &[
                (json!([0, 255]), json!([0.0, 1.0])),
                (json!([0, 51]), json!([0.0, 0.2])),
            ],
        );
        assert_resolves(
            json!({ "type": "VEC4", "componentType": "INT8", "normalized": true }),
            &[
                (json!([-127, 0, 127, 0]), json!([-1.0, 0.0, 1.0, 0])),
                (json!([-127, -127, -127, 0]), json!([-1.0, -1.0, -1.0, 0])),
            ],
        );
        assert_resolves(
            json!({ "type": "MAT2", "componentType": "UINT8", "normalized": true }),
            &[(json!([0, 51, 51, 0]), json!([0.0, 0.2, 0.2, 0.0]))],
        );
        assert_resolves(
            json!({ "type": "VEC3", "componentType": "UINT8", "normalized": true, "array": true, "count": 2 }),
            &[(
                json!([[0, 0, 255], [255, 255, 0]]),
                json!([[0.0, 0.0, 1.0], [1.0, 1.0, 0.0]]),
            )],
        );
        assert_resolves(
            json!({ "type": "MAT2", "componentType": "UINT8", "normalized": true, "array": true }),
            &[
                (
                    json!([[255, 255, 255, 255], [51, 0, 0, 51]]),
                    json!([[1.0, 1.0, 1.0, 1.0], [0.2, 0.0, 0.0, 0.2]]),
                ),
                (json!([]), json!([])),
            ],
        );
    }

    // MetadataClassPropertySpec "value transform": "applies value transform
    // for scalar values".
    #[test]
    fn transforms_scalars() {
        let cases = [
            (
                json!({ "componentType": "INT8", "normalized": true, "offset": 1, "scale": 2 }),
                json!([-127, 0, 127]),
                json!([-1.0, 1.0, 3.0]),
            ),
            (
                json!({ "componentType": "UINT8", "normalized": true, "offset": 2, "scale": 2 }),
                json!([0, 255]),
                json!([2.0, 4.0]),
            ),
            (
                json!({ "componentType": "INT16", "normalized": true, "scale": 2 }),
                json!([-32767, 0, 32767]),
                json!([-2.0, 0, 2.0]),
            ),
            (
                json!({ "componentType": "UINT16", "normalized": true, "offset": 4 }),
                json!([0, 65535]),
                json!([4.0, 5.0]),
            ),
            (
                json!({ "componentType": "INT32", "normalized": true, "offset": 0, "scale": 1 }),
                json!([-2147483647, 0, 2147483647]),
                json!([-1.0, 0, 1.0]),
            ),
            (
                json!({ "componentType": "UINT32", "normalized": true, "scale": 2, "offset": 2 }),
                json!([0, 4294967295_u64]),
                json!([2.0, 4.0]),
            ),
            (
                json!({ "componentType": "INT64", "normalized": true, "offset": -1, "scale": 0.5 }),
                json!([-9223372036854775807_i64, 0, 9223372036854775807_i64]),
                json!([-1.5, -1.0, -0.5]),
            ),
            (
                json!({ "componentType": "UINT64", "normalized": true, "offset": 1, "scale": 2 }),
                json!([0, 18446744073709551615_u64]),
                json!([1.0, 3.0]),
            ),
            (
                json!({ "componentType": "FLOAT32", "offset": 8, "scale": 4 }),
                json!([-8.0, 3.0, 256.0]),
                json!([-24.0, 20.0, 1032.0]),
            ),
            (
                json!({ "componentType": "FLOAT64", "offset": 4, "scale": 2 }),
                json!([-4.5, 0.0, 45.0]),
                json!([-5.0, 4.0, 94.0]),
            ),
        ];
        for (mut def, raw, expected) in cases {
            def["type"] = json!("SCALAR");
            let cases: Vec<_> = raw
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .zip(expected.as_array().unwrap().iter().cloned())
                .collect();
            assert_resolves(def, &cases);
        }
    }

    // MetadataClassPropertySpec "value transform": "applies value transform
    // for array values", "... for vector and matrix values", "... for arrays
    // of vectors", "value transforms do not transform variable length arrays".
    #[test]
    fn transforms_arrays_vectors_and_matrices() {
        assert_resolves(
            json!({ "array": true, "count": 3, "type": "SCALAR", "componentType": "INT8", "normalized": true, "offset": [1, 2, 3], "scale": [2, 2, 2] }),
            &[
                (json!([-127, 0, 127]), json!([-1.0, 2.0, 5.0])),
                (json!([127, 127, 127]), json!([3.0, 4.0, 5.0])),
            ],
        );
        assert_resolves(
            json!({ "array": true, "count": 2, "type": "SCALAR", "componentType": "FLOAT32", "offset": [-1, -1], "scale": [2, 1] }),
            &[
                (json!([0.0, 1.0]), json!([-1.0, 0.0])),
                (json!([0.0, 0.125]), json!([-1.0, -0.875])),
                (json!([1.0, 1.0]), json!([1.0, 0.0])),
            ],
        );
        assert_resolves(
            json!({ "array": true, "count": 2, "type": "SCALAR", "componentType": "FLOAT32", "scale": [2, 2] }),
            &[(json!([-2, 4]), json!([-4, 8]))],
        );
        assert_resolves(
            json!({ "array": true, "count": 2, "type": "SCALAR", "componentType": "FLOAT32", "offset": [1, 2] }),
            &[(json!([-0.5, 0.5]), json!([0.5, 2.5]))],
        );
        assert_resolves(
            json!({ "type": "SCALAR", "componentType": "FLOAT32", "array": true, "offset": [1, 2, 3], "scale": [2, 2, 2] }),
            &[(json!([-1.0, 0.0, 5.0, 4.0]), json!([-1.0, 0.0, 5.0, 4.0]))],
        );
        assert_resolves(
            json!({ "type": "VEC4", "componentType": "INT8", "normalized": true, "offset": [3, 3, 0, 1], "scale": [2, 8, 4, 1] }),
            &[
                (json!([-127, 0, 127, 0]), json!([1, 3, 4, 1])),
                (json!([-127, -127, -127, 0]), json!([1, -5, -4, 1])),
                (json!([127, 127, 127, 127]), json!([5, 11, 4, 2])),
            ],
        );
        assert_resolves(
            json!({ "type": "MAT2", "componentType": "FLOAT32", "scale": [0.25, 0.25, 1.0, 1.0] }),
            &[(
                json!([0.0, 0.25, 0.25, 0.0]),
                json!([0.0, 0.0625, 0.25, 0.0]),
            )],
        );
        assert_resolves(
            json!({ "type": "VEC3", "componentType": "UINT8", "normalized": true, "array": true, "count": 2, "offset": [[2, 2, 2], [0, 1, 2]] }),
            &[
                (
                    json!([[255, 0, 0], [0, 255, 0]]),
                    json!([[3.0, 2.0, 2.0], [0.0, 2.0, 2.0]]),
                ),
                (
                    json!([[0, 0, 255], [255, 255, 0]]),
                    json!([[2.0, 2.0, 3.0], [1.0, 2.0, 2.0]]),
                ),
            ],
        );
    }

    // MetadataClassPropertySpec "normalize and unnormalize": "does not
    // normalize non integer types"; "value transform": "does not transform
    // other types".
    #[test]
    fn keeps_non_numeric_values() {
        let resolved = resolve_class(
            json!({
                "e": { "type": "ENUM", "enumType": "myEnum" },
                "ea": { "type": "ENUM", "array": true, "enumType": "myEnum" },
                "s": { "type": "STRING" },
                "b": { "type": "BOOLEAN" },
            }),
            json!({ "e": "Other", "ea": ["Other", "ValueA"], "s": "bc", "b": true }),
        );
        assert_eq!(
            resolved,
            json!({ "e": "Other", "ea": ["Other", "ValueA"], "s": "bc", "b": true })
        );
    }

    #[test]
    fn broadcasts_scalar_offset_and_scale() {
        assert_resolves(
            json!({ "type": "VEC3", "componentType": "FLOAT64", "offset": [10, 20, 30], "scale": 2 }),
            &[(json!([1, 2, 3]), json!([12.0, 24.0, 36.0]))],
        );
    }

    #[test]
    fn keeps_values_without_schema_class() {
        let properties: HashMap<String, Value> =
            serde_json::from_value(json!({ "count": 3 })).unwrap();
        let resolved = resolve_metadata_entity(None, "c", Some(&properties));
        assert_eq!(
            resolved,
            json!({ "class": "c", "properties": { "count": 3 } })
        );
    }
}
