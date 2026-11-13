#![doc = include_str!("../README.md")]

extern crate alloc;

mod types;

pub use navara_bin::*;

use alloc::borrow::Cow;
use alloc::vec::Vec;
use binrw::BinRead;
use core::fmt;
use navara_glb::Glb;
use navara_property::{PropertyValue, json_value_to_property_value};
use serde::de::{DeserializeSeed, Deserializer, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use types::{ComponentType, DataType};

pub const B3DM_HEADER_SIZE: usize = 28;

#[derive(BinRead)]
pub struct B3dm {
    pub header: B3dmHeader,
    #[br(args(header.feature_table_json_byte_length, header.feature_table_binary_byte_length))]
    pub feature_table: FeatureTable,
    #[br(args(header.batch_table_json_byte_length, header.batch_table_binary_byte_length))]
    pub batch_table: BatchTable,
    pub glb: Glb,
}

impl B3dm {
    pub fn extract_glb(&self, original_data: &[u8]) -> Result<Vec<u8>, &'static str> {
        let glb_start = B3DM_HEADER_SIZE
            + self.header.feature_table_json_byte_length as usize
            + self.header.feature_table_binary_byte_length as usize
            + self.header.batch_table_json_byte_length as usize
            + self.header.batch_table_binary_byte_length as usize;

        if glb_start >= original_data.len() {
            return Err("Invalid B3DM data: GLB data start position out of bounds");
        }

        let glb_data = &original_data[glb_start..];

        Ok(glb_data.to_vec())
    }
}

impl BinaryReader<B3dm> for B3dm {}

#[derive(BinRead)]
#[br(magic = b"b3dm", little)]
pub struct B3dmHeader {
    pub version: u32,
    pub byte_length: u32,
    pub feature_table_json_byte_length: u32,
    pub feature_table_binary_byte_length: u32,
    pub batch_table_json_byte_length: u32,
    pub batch_table_binary_byte_length: u32,
}

#[derive(BinRead, Deserialize, Serialize)]
pub struct FeatureTableJson {
    #[serde(alias = "BATCH_LENGTH")]
    pub batch_length: Option<u32>,
}

#[derive(BinRead)]
#[br(import(feature_table_json_byte_length: u32, feature_table_binary_byte_length: u32))]
pub struct FeatureTable {
    #[br(parse_with = parse_json_to_struct_from_reader, args(feature_table_json_byte_length))]
    pub json: FeatureTableJson,
    #[br(count = feature_table_binary_byte_length)]
    pub binary: Vec<u8>,
}

#[derive(BinRead)]
#[br(import(batch_table_json_byte_length: u32, batch_table_binary_byte_length: u32))]
pub struct BatchTable {
    #[br(count = batch_table_json_byte_length)]
    pub json_data: Vec<u8>,
    #[br(count = batch_table_binary_byte_length)]
    pub binary_data: Vec<u8>,
}

/// Deserializes a JSON object into only its entries named in the keys.
struct FilteredKeys<'a>(&'a [String]);

impl<'de> DeserializeSeed<'de> for FilteredKeys<'_> {
    type Value = serde_json::Map<String, serde_json::Value>;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for FilteredKeys<'_> {
    type Value = serde_json::Map<String, serde_json::Value>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a batch table JSON object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut filtered = serde_json::Map::new();
        while let Some(key) = map.next_key::<Cow<str>>()? {
            if self.0.iter().any(|requested| requested == key.as_ref()) {
                filtered.insert(key.into_owned(), map.next_value()?);
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(filtered)
    }
}

impl BatchTable {
    pub fn json(&self) -> Result<serde_json::Value, serde_json::Error> {
        parse_json_to_struct(&self.json_data)
    }

    /// Parse the batch table JSON, retaining only the specified top-level keys.
    /// The other properties are skipped without being built.
    pub fn json_filtered(&self, keys: &[String]) -> Result<serde_json::Value, serde_json::Error> {
        let mut deserializer =
            serde_json::Deserializer::from_slice(trim_json_padding(&self.json_data));
        let filtered = FilteredKeys(keys).deserialize(&mut deserializer)?;
        deserializer.end()?;
        Ok(serde_json::Value::Object(filtered))
    }

    /// Get all properties for a batch index as a single PropertyValue map.
    pub fn get_property<V: PropertyValue>(
        &self,
        batch_table_json: &serde_json::Value,
        batch_id: usize,
    ) -> Option<V> {
        let mut prop = V::empty_map();

        if let serde_json::Value::Object(map) = batch_table_json {
            for (key, value) in map {
                match value {
                    serde_json::Value::Object(_) => {
                        if let Ok(v) = self.read_property_from_binary::<V>(batch_id, value) {
                            V::insert(&mut prop, key.clone(), v);
                        }
                    }
                    serde_json::Value::Array(arr) => {
                        if let Some(v) = json_value_to_property_value::<V>(&arr[batch_id]) {
                            V::insert(&mut prop, key.clone(), v);
                        }
                    }
                    _ => {}
                }
            }
        }

        Some(V::finalize_map(prop))
    }

    /// Get filtered properties for a batch index, returning `Vec<Option<V>>` matching key order.
    pub fn get_filtered_properties<V: PropertyValue>(
        &self,
        batch_table_json: &serde_json::Value,
        batch_idx: usize,
        keys: &[String],
    ) -> Option<Vec<Option<V>>> {
        if let serde_json::Value::Object(map) = batch_table_json {
            let result = keys
                .iter()
                .map(|key| {
                    map.get(key).and_then(|value| match value {
                        serde_json::Value::Object(_) => {
                            self.read_property_from_binary::<V>(batch_idx, value).ok()
                        }
                        serde_json::Value::Array(arr) => {
                            json_value_to_property_value::<V>(&arr[batch_idx])
                        }
                        _ => None,
                    })
                })
                .collect();
            Some(result)
        } else {
            None
        }
    }

    pub fn read_property_from_binary<V: PropertyValue>(
        &self,
        idx: usize,
        prop: &serde_json::Value,
    ) -> Result<V, &'static str> {
        let offset = prop["byteOffset"].as_u64().unwrap() as usize;
        let component_type = ComponentType::from_str(prop["componentType"].as_str().unwrap());
        let data_type = DataType::from_str(prop["type"].as_str().unwrap());

        match data_type {
            DataType::Scalar => self.read_scalar(offset, idx, component_type),
            DataType::Vec2 | DataType::Vec3 | DataType::Vec4 => {
                self.read_vector(offset, idx, data_type, component_type)
            }
        }
    }

    fn read_scalar<V: PropertyValue>(
        &self,
        byte_offset: usize,
        idx: usize,
        component_type: ComponentType,
    ) -> Result<V, &'static str> {
        let offset = byte_offset + idx * component_type.size();
        self.read_value(offset, &component_type)
    }

    fn read_vector<V: PropertyValue>(
        &self,
        byte_offset: usize,
        idx: usize,
        data_type: DataType,
        component_type: ComponentType,
    ) -> Result<V, &'static str> {
        let offset = byte_offset + idx * data_type.size() * component_type.size();
        let values = (0..data_type.size())
            .map(|j| self.read_value::<V>(offset + j * component_type.size(), &component_type))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(V::from_array(values))
    }

    fn read_value<V: PropertyValue>(
        &self,
        offset: usize,
        component_type: &ComponentType,
    ) -> Result<V, &'static str> {
        if offset + component_type.size() > self.binary_data.len() {
            return Err("Out of bounds read");
        }

        match component_type {
            ComponentType::Byte => Ok(V::from_i64(self.binary_data[offset] as i8 as i64)),
            ComponentType::UnsignedByte => Ok(V::from_u64(self.binary_data[offset] as u64)),
            ComponentType::Short => Ok(V::from_i64(i16::from_le_bytes([
                self.binary_data[offset],
                self.binary_data[offset + 1],
            ]) as i64)),
            ComponentType::UnsignedShort => Ok(V::from_u64(u16::from_le_bytes([
                self.binary_data[offset],
                self.binary_data[offset + 1],
            ]) as u64)),
            ComponentType::Int => Ok(V::from_i64(i32::from_le_bytes([
                self.binary_data[offset],
                self.binary_data[offset + 1],
                self.binary_data[offset + 2],
                self.binary_data[offset + 3],
            ]) as i64)),
            ComponentType::UnsignedInt => Ok(V::from_u64(u32::from_le_bytes([
                self.binary_data[offset],
                self.binary_data[offset + 1],
                self.binary_data[offset + 2],
                self.binary_data[offset + 3],
            ]) as u64)),
            ComponentType::Float => Ok(V::from_f32(f32::from_le_bytes([
                self.binary_data[offset],
                self.binary_data[offset + 1],
                self.binary_data[offset + 2],
                self.binary_data[offset + 3],
            ]))),
            ComponentType::Double => Ok(V::from_f64(f64::from_le_bytes([
                self.binary_data[offset],
                self.binary_data[offset + 1],
                self.binary_data[offset + 2],
                self.binary_data[offset + 3],
                self.binary_data[offset + 4],
                self.binary_data[offset + 5],
                self.binary_data[offset + 6],
                self.binary_data[offset + 7],
            ]))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_abs_diff_eq;
    #[cfg(test)]
    use navara_glb::mock::create_mock_glb_data;
    use serde_json::{Number, Value, json};

    fn create_mock_b3dm_data() -> Vec<u8> {
        // Feature Table JSON
        let feature_table_json = r#"
{
	"BATCH_LENGTH": 5
}"#;
        let feature_table_json_padded = {
            let mut padded = feature_table_json.as_bytes().to_vec();
            padded.resize((padded.len() + 3) & !3, 0); // Align 4 byte
            padded
        };

        // Feature Table Binary
        let feature_table_binary = vec![0u8; 10];

        // Batch Table JSON
        let batch_table_json = r#"
{
	"some_property": [1,2,3,4,5],
	"test_property_byte": {
		"byteOffset": 0,
		"componentType": "BYTE",
		"type": "SCALAR"
	},
	"test_property_float": {
		"byteOffset": 5,
		"componentType": "FLOAT",
		"type": "SCALAR"
	},
	"test_property_vec3": {
		"byteOffset": 25,
		"componentType": "FLOAT",
		"type": "VEC3"
	}
}"#;
        let batch_table_json_padded = {
            let mut padded = batch_table_json.as_bytes().to_vec();
            padded.resize((padded.len() + 3) & !3, 0); // Align 4 byte
            padded
        };

        // Batch Table Binary
        let mut batch_table_binary = vec![];
        // test_property_byte
        batch_table_binary.append(&mut 1i8.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 2i8.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 3i8.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 4i8.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 5i8.to_le_bytes().to_vec());
        // test_property_float
        batch_table_binary.append(&mut 2.0f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 2.1f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 2.2f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 2.3f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 2.4f32.to_le_bytes().to_vec());
        // test_property_vec3
        batch_table_binary.append(&mut 3.0f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 4.0f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 5.0f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 3.1f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 4.1f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 5.1f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 3.2f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 4.2f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 5.2f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 3.3f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 4.3f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 5.3f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 3.4f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 4.4f32.to_le_bytes().to_vec());
        batch_table_binary.append(&mut 5.4f32.to_le_bytes().to_vec());

        // GLB Data (dummy)
        let glb_data = create_mock_glb_data();

        let mut header = Vec::new();
        header.extend_from_slice(b"b3dm");
        header.extend_from_slice(&1u32.to_le_bytes()); // version

        let total_byte_length = B3DM_HEADER_SIZE
            + feature_table_json_padded.len()
            + feature_table_binary.len()
            + batch_table_json_padded.len()
            + batch_table_binary.len()
            + glb_data.len();

        header.extend_from_slice(&(total_byte_length as u32).to_le_bytes());
        header.extend_from_slice(&(feature_table_json_padded.len() as u32).to_le_bytes());
        header.extend_from_slice(&(feature_table_binary.len() as u32).to_le_bytes());
        header.extend_from_slice(&(batch_table_json_padded.len() as u32).to_le_bytes());
        header.extend_from_slice(&(batch_table_binary.len() as u32).to_le_bytes());

        let mut data = Vec::new();
        data.extend_from_slice(&header);
        data.extend_from_slice(&feature_table_json_padded);
        data.extend_from_slice(&feature_table_binary);
        data.extend_from_slice(&batch_table_json_padded);
        data.extend_from_slice(&batch_table_binary);
        data.extend_from_slice(&glb_data);

        data
    }

    #[test]
    fn it_should_parse_b3dm() {
        let data = create_mock_b3dm_data();
        let b3dm = B3dm::from_data(&data).unwrap();

        let batch_length = b3dm.feature_table.json.batch_length.unwrap() as usize;

        assert_eq!(b3dm.header.version, 1);
        assert_eq!(batch_length, 5);

        let batch_table_json = b3dm.batch_table.json().unwrap();
        assert_eq!(
            batch_table_json["some_property"],
            Value::Array(vec![
                Value::Number(1.into()),
                Value::Number(2.into()),
                Value::Number(3.into()),
                Value::Number(4.into()),
                Value::Number(5.into())
            ])
        );

        type Expects<'a> = Vec<(&'a str, Vec<Value>, Box<dyn Fn(Value, Value)>)>;

        // Batch table binary
        let expects: Expects = vec![
            (
                "test_property_byte",
                vec![
                    Value::Number(1.into()),
                    Value::Number(2.into()),
                    Value::Number(3.into()),
                    Value::Number(4.into()),
                    Value::Number(5.into()),
                ],
                Box::new(|a: Value, b: Value| assert_eq!(a, b)),
            ),
            (
                "test_property_float",
                vec![
                    Value::Number(Number::from_f64(2.0).unwrap()),
                    Value::Number(Number::from_f64(2.1).unwrap()),
                    Value::Number(Number::from_f64(2.2).unwrap()),
                    Value::Number(Number::from_f64(2.3).unwrap()),
                    Value::Number(Number::from_f64(2.4).unwrap()),
                ],
                Box::new(|a: Value, b: Value| {
                    assert_abs_diff_eq!(
                        a.as_f64().unwrap(),
                        b.as_f64().unwrap(),
                        epsilon = 0.000001
                    );
                }),
            ),
            (
                "test_property_vec3",
                vec![
                    Value::Array(vec![
                        Value::Number(Number::from_f64(3.0).unwrap()),
                        Value::Number(Number::from_f64(4.0).unwrap()),
                        Value::Number(Number::from_f64(5.0).unwrap()),
                    ]),
                    Value::Array(vec![
                        Value::Number(Number::from_f64(3.1).unwrap()),
                        Value::Number(Number::from_f64(4.1).unwrap()),
                        Value::Number(Number::from_f64(5.1).unwrap()),
                    ]),
                    Value::Array(vec![
                        Value::Number(Number::from_f64(3.2).unwrap()),
                        Value::Number(Number::from_f64(4.2).unwrap()),
                        Value::Number(Number::from_f64(5.2).unwrap()),
                    ]),
                    Value::Array(vec![
                        Value::Number(Number::from_f64(3.3).unwrap()),
                        Value::Number(Number::from_f64(4.3).unwrap()),
                        Value::Number(Number::from_f64(5.3).unwrap()),
                    ]),
                    Value::Array(vec![
                        Value::Number(Number::from_f64(3.4).unwrap()),
                        Value::Number(Number::from_f64(4.4).unwrap()),
                        Value::Number(Number::from_f64(5.4).unwrap()),
                    ]),
                ],
                Box::new(|a: Value, b: Value| {
                    let a = a.as_array().unwrap();
                    let b = b.as_array().unwrap();
                    // x
                    assert_abs_diff_eq!(
                        a[0].as_f64().unwrap(),
                        b[0].as_f64().unwrap(),
                        epsilon = 0.000001
                    );
                    // y
                    assert_abs_diff_eq!(
                        a[1].as_f64().unwrap(),
                        b[1].as_f64().unwrap(),
                        epsilon = 0.000001
                    );
                    // z
                    assert_abs_diff_eq!(
                        a[2].as_f64().unwrap(),
                        b[2].as_f64().unwrap(),
                        epsilon = 0.000001
                    );
                }),
            ),
        ];

        for (name, expect, assert) in expects {
            let property = &batch_table_json[name];

            for (batch_id, v) in expect.iter().enumerate() {
                let property_value = b3dm
                    .batch_table
                    .read_property_from_binary(batch_id, property)
                    .unwrap();
                assert(property_value, v.clone());
            }
        }
    }

    #[test]
    fn it_should_get_property_combining_array_and_binary() {
        let data = create_mock_b3dm_data();
        let b3dm = B3dm::from_data(&data).unwrap();
        let batch_table_json = b3dm.batch_table.json().unwrap();

        // batch_id 0
        let prop: Value = b3dm.batch_table.get_property(&batch_table_json, 0).unwrap();
        let map = prop.as_object().unwrap();

        // Array-based property
        assert_eq!(map["some_property"], json!(1));
        // Binary BYTE SCALAR
        assert_eq!(map["test_property_byte"], json!(1));
        // Binary FLOAT SCALAR
        assert_abs_diff_eq!(
            map["test_property_float"].as_f64().unwrap(),
            2.0,
            epsilon = 1e-6
        );
        // Binary FLOAT VEC3
        let vec3 = map["test_property_vec3"].as_array().unwrap();
        assert_abs_diff_eq!(vec3[0].as_f64().unwrap(), 3.0, epsilon = 1e-6);
        assert_abs_diff_eq!(vec3[1].as_f64().unwrap(), 4.0, epsilon = 1e-6);
        assert_abs_diff_eq!(vec3[2].as_f64().unwrap(), 5.0, epsilon = 1e-6);

        // batch_id 4 (last)
        let prop: Value = b3dm.batch_table.get_property(&batch_table_json, 4).unwrap();
        let map = prop.as_object().unwrap();
        assert_eq!(map["some_property"], json!(5));
        assert_eq!(map["test_property_byte"], json!(5));
        assert_abs_diff_eq!(
            map["test_property_float"].as_f64().unwrap(),
            2.4,
            epsilon = 1e-6
        );
    }

    #[test]
    fn it_should_get_filtered_properties_with_ordering_and_missing() {
        let data = create_mock_b3dm_data();
        let b3dm = B3dm::from_data(&data).unwrap();
        let batch_table_json = b3dm.batch_table.json().unwrap();

        let keys = vec![
            "test_property_float".to_string(),
            "nonexistent".to_string(),
            "some_property".to_string(),
        ];

        let result: Vec<Option<Value>> = b3dm
            .batch_table
            .get_filtered_properties(&batch_table_json, 0, &keys)
            .unwrap();

        assert_eq!(result.len(), 3);
        // Matches key order
        assert_abs_diff_eq!(
            result[0].as_ref().unwrap().as_f64().unwrap(),
            2.0,
            epsilon = 1e-6
        );
        assert!(result[1].is_none());
        assert_eq!(result[2], Some(json!(1)));
    }

    #[test]
    fn it_should_parse_only_requested_keys() {
        let data = create_mock_b3dm_data();
        let b3dm = B3dm::from_data(&data).unwrap();
        let full = b3dm.batch_table.json().unwrap();

        let keys = vec![
            "test_property_vec3".to_string(),
            "nonexistent".to_string(),
            "some_property".to_string(),
        ];
        let filtered = b3dm.batch_table.json_filtered(&keys).unwrap();

        let map = filtered.as_object().unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map["test_property_vec3"], full["test_property_vec3"]);
        assert_eq!(map["some_property"], full["some_property"]);
    }

    #[test]
    fn it_should_return_none_for_filtered_properties_on_non_object() {
        let data = create_mock_b3dm_data();
        let b3dm = B3dm::from_data(&data).unwrap();
        let result: Option<Vec<Option<Value>>> =
            b3dm.batch_table
                .get_filtered_properties(&Value::Array(vec![]), 0, &["a".into()]);
        assert!(result.is_none());
    }

    #[test]
    fn it_should_extract_glb_from_b3dm() {
        let data = create_mock_b3dm_data();
        let b3dm = B3dm::from_data(&data).unwrap();

        let glb = Glb::from_data(&b3dm.extract_glb(&data).unwrap()).unwrap();

        assert_eq!(glb.0.header.version, 2);
    }
}
