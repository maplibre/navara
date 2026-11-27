//! Batch table reads of generated tiles: a spec-valid batch table reads back
//! its model, malformed property definitions are dropped, and corrupted tiles
//! never panic.
//!
//! standard: 3D Tiles 1.0 Batch Table
//! ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/TileFormats/BatchTable/README.adoc
//! ref: https://github.com/CesiumGS/3d-tiles/blob/main/specification/schema/TileFormats/batchTable.schema.json
//! user: bad-data-never-crashes

use proptest::prelude::*;
use proptest::sample::Index;
use proptest::test_runner::RngSeed;
use serde_json::{Map, Value, json};

use super::*;
use navara_glb::GLB_HEADER_SIZE;

/// The seed of PR runs; a deep run sets `PROPTEST_RNG_SEED`.
const PR_SEED: u64 = 3;

/// `componentType` names with their byte size.
const COMPONENT_TYPES: [(&str, usize); 8] = [
    ("BYTE", 1),
    ("UNSIGNED_BYTE", 1),
    ("SHORT", 2),
    ("UNSIGNED_SHORT", 2),
    ("INT", 4),
    ("UNSIGNED_INT", 4),
    ("FLOAT", 4),
    ("DOUBLE", 8),
];
/// `type` names with their component count.
const DATA_TYPES: [(&str, usize); 4] = [("SCALAR", 1), ("VEC2", 2), ("VEC3", 3), ("VEC4", 4)];

#[derive(Debug, Clone)]
struct BinaryColumnSpec {
    component_type: usize,
    data_type: usize,
    /// `batch_length` elements of the column.
    bytes: Vec<u8>,
    /// Whether the reference carries `extras`, which the spec allows.
    extras: bool,
}

/// A property definition the spec does not allow.
#[derive(Debug, Clone)]
enum Malformed {
    /// A binary body reference with a missing, mistyped, unknown or
    /// out-of-range field. Dropped.
    Reference(Map<String, Value>),
    /// A JSON array of any length. Read where it has an element.
    Array(Vec<i32>),
    /// Neither an array nor an object. Dropped.
    Scalar(Value),
}

#[derive(Debug, Clone)]
struct B3dmSpec {
    batch_length: u32,
    json_columns: Vec<Vec<Value>>,
    binary_columns: Vec<BinaryColumnSpec>,
    /// Batch table `extensions` and `extras`, which are not properties.
    extensions: Option<Map<String, Value>>,
    extras: Option<Value>,
    malformed: Vec<Malformed>,
}

fn json_scalar() -> impl Strategy<Value = Value> {
    prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::from),
        any::<i32>().prop_map(Value::from),
        (-1e9f64..1e9).prop_map(Value::from),
        "[a-z]{0,4}".prop_map(Value::from),
    ]
}

fn json_value() -> BoxedStrategy<Value> {
    json_scalar()
        .prop_recursive(2, 8, 3, |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 0..3).prop_map(Value::Array),
                prop::collection::btree_map("[a-zA-Z]{1,10}", inner, 0..3)
                    .prop_map(|m| Value::Object(m.into_iter().collect())),
            ]
        })
        .boxed()
}

/// A binary body reference field: a valid value, or an invalid one.
fn reference_field(
    valid: impl Strategy<Value = Value>,
    invalid: Vec<Option<Value>>,
) -> impl Strategy<Value = (Option<Value>, bool)> {
    prop_oneof![
        valid.prop_map(|v| (Some(v), true)),
        prop::sample::select(invalid).prop_map(|v| (v, false)),
    ]
}

fn malformed_reference() -> impl Strategy<Value = Malformed> {
    let byte_offset = reference_field(
        Just(json!(0)),
        vec![
            None,
            Some(json!("0")),
            Some(json!(-1)),
            Some(json!(1.5)),
            Some(Value::Null),
            Some(json!(1u64 << 20)),
            Some(json!(1u64 << 53)),
            Some(json!(u64::MAX)),
        ],
    );
    let component_type = reference_field(
        prop::sample::select(COMPONENT_TYPES.map(|(name, _)| name).to_vec()).prop_map(Value::from),
        vec![
            None,
            Some(json!("HALF")),
            Some(json!("float")),
            Some(json!(5126)),
            Some(Value::Null),
        ],
    );
    let data_type = reference_field(
        prop::sample::select(DATA_TYPES.map(|(name, _)| name).to_vec()).prop_map(Value::from),
        vec![
            None,
            Some(json!("MAT2")),
            Some(json!("MAT3")),
            Some(json!("MAT4")),
            Some(json!("vec3")),
            Some(json!(3)),
        ],
    );
    (byte_offset, component_type, data_type)
        .prop_filter("one field is invalid", |(a, b, c)| !(a.1 && b.1 && c.1))
        .prop_map(|fields| {
            let mut reference = Map::new();
            for (name, (value, _)) in [
                ("byteOffset", fields.0),
                ("componentType", fields.1),
                ("type", fields.2),
            ] {
                if let Some(value) = value {
                    reference.insert(name.into(), value);
                }
            }
            Malformed::Reference(reference)
        })
}

fn malformed() -> impl Strategy<Value = Malformed> {
    prop_oneof![
        malformed_reference(),
        prop::collection::vec(any::<i32>(), 0..8).prop_map(Malformed::Array),
        json_scalar().prop_map(Malformed::Scalar),
    ]
}

fn spec(with_malformed: bool) -> impl Strategy<Value = B3dmSpec> {
    (0u32..6).prop_flat_map(move |batch_length| {
        let n = batch_length as usize;
        let binary_column = (0..COMPONENT_TYPES.len(), 0..DATA_TYPES.len(), any::<bool>())
            .prop_flat_map(move |(component_type, data_type, extras)| {
                let len = n * COMPONENT_TYPES[component_type].1 * DATA_TYPES[data_type].1;
                prop::collection::vec(any::<u8>(), len).prop_map(move |bytes| BinaryColumnSpec {
                    component_type,
                    data_type,
                    bytes,
                    extras,
                })
            });
        // `extras` may be any JSON value, including one shaped like a property.
        let extras = prop_oneof![
            json_value(),
            Just(json!({"byteOffset": 0, "componentType": "BYTE", "type": "SCALAR"})),
            prop::collection::vec(json_scalar(), n).prop_map(Value::Array),
        ];
        let extensions = prop::collection::btree_map(
            prop_oneof![
                Just("3DTILES_batch_table_hierarchy".to_string()),
                "[A-Z_]{1,12}"
            ],
            json_value(),
            0..3,
        )
        .prop_map(|m| m.into_iter().collect::<Map<_, _>>());
        (
            prop::collection::vec(prop::collection::vec(json_value(), n), 0..3),
            prop::collection::vec(binary_column, 0..3),
            prop::option::of(extensions),
            prop::option::of(extras),
            prop::collection::vec(malformed(), if with_malformed { 1..4 } else { 0..1 }),
        )
            .prop_map(
                move |(json_columns, binary_columns, extensions, extras, malformed)| B3dmSpec {
                    batch_length,
                    json_columns,
                    binary_columns,
                    extensions,
                    extras,
                    malformed,
                },
            )
    })
}

/// Pads `buf`, which starts at byte `start` of the tile, to an 8-byte boundary.
fn pad8(buf: &mut Vec<u8>, start: usize, byte: u8) {
    while !(start + buf.len()).is_multiple_of(8) {
        buf.push(byte);
    }
}

fn align(buf: &mut Vec<u8>, to: usize) {
    while !buf.len().is_multiple_of(to) {
        buf.push(0);
    }
}

fn build_glb() -> Vec<u8> {
    let mut chunk = serde_json::to_vec(&json!({"asset": {"version": "2.0"}})).unwrap();
    while !chunk.len().is_multiple_of(4) {
        chunk.push(b' ');
    }
    let mut glb = b"glTF".to_vec();
    glb.extend(2u32.to_le_bytes());
    glb.extend(((GLB_HEADER_SIZE + 8 + chunk.len()) as u32).to_le_bytes());
    glb.extend((chunk.len() as u32).to_le_bytes());
    glb.extend(0x4E4F534Au32.to_le_bytes());
    glb.extend(chunk);
    glb
}

fn build(spec: &B3dmSpec) -> Vec<u8> {
    let mut bt = Map::new();
    let mut bt_bin = Vec::new();
    for (i, column) in spec.json_columns.iter().enumerate() {
        bt.insert(format!("j{i}"), Value::Array(column.clone()));
    }
    for (i, column) in spec.binary_columns.iter().enumerate() {
        let (component_type, size) = COMPONENT_TYPES[column.component_type];
        align(&mut bt_bin, size);
        let mut reference = json!({
            "byteOffset": bt_bin.len(),
            "componentType": component_type,
            "type": DATA_TYPES[column.data_type].0,
        });
        if column.extras {
            reference["extras"] = json!({"note": "not a component"});
        }
        bt.insert(format!("b{i}"), reference);
        bt_bin.extend(&column.bytes);
    }
    for (i, column) in spec.malformed.iter().enumerate() {
        let value = match column {
            Malformed::Reference(reference) => Value::Object(reference.clone()),
            Malformed::Array(values) => json!(values),
            Malformed::Scalar(value) => value.clone(),
        };
        bt.insert(format!("m{i}"), value);
    }
    if let Some(extensions) = &spec.extensions {
        bt.insert("extensions".into(), Value::Object(extensions.clone()));
    }
    if let Some(extras) = &spec.extras {
        bt.insert("extras".into(), extras.clone());
    }

    let mut ft_json = serde_json::to_vec(&json!({"BATCH_LENGTH": spec.batch_length})).unwrap();
    pad8(&mut ft_json, B3DM_HEADER_SIZE, b' ');
    let mut bt_json = if bt.is_empty() {
        Vec::new()
    } else {
        serde_json::to_vec(&Value::Object(bt)).unwrap()
    };
    pad8(&mut bt_json, 0, b' ');
    pad8(&mut bt_bin, 0, 0);

    let body = [&ft_json[..], &bt_json, &bt_bin, &build_glb()].concat();
    let mut tile = b"b3dm".to_vec();
    tile.extend(1u32.to_le_bytes());
    tile.extend(((B3DM_HEADER_SIZE + body.len()) as u32).to_le_bytes());
    for len in [ft_json.len(), 0, bt_json.len(), bt_bin.len()] {
        tile.extend((len as u32).to_le_bytes());
    }
    tile.extend(body);
    tile
}

/// The spec's reading of binary column element `batch_id`.
fn decode_binary(column: &BinaryColumnSpec, batch_id: usize) -> Value {
    let size = COMPONENT_TYPES[column.component_type].1;
    let count = DATA_TYPES[column.data_type].1;
    let element = &column.bytes[batch_id * size * count..][..size * count];
    let mut components = Vec::new();
    for b in element.chunks(size) {
        components.push(match COMPONENT_TYPES[column.component_type].0 {
            "BYTE" => Value::from_i64(b[0] as i8 as i64),
            "UNSIGNED_BYTE" => Value::from_u64(b[0] as u64),
            "SHORT" => Value::from_i64(i16::from_le_bytes([b[0], b[1]]) as i64),
            "UNSIGNED_SHORT" => Value::from_u64(u16::from_le_bytes([b[0], b[1]]) as u64),
            "INT" => Value::from_i64(i32::from_le_bytes(b.try_into().unwrap()) as i64),
            "UNSIGNED_INT" => Value::from_u64(u32::from_le_bytes(b.try_into().unwrap()) as u64),
            "FLOAT" => Value::from_f32(f32::from_le_bytes(b.try_into().unwrap())),
            _ => Value::from_f64(f64::from_le_bytes(b.try_into().unwrap())),
        });
    }
    match count {
        1 => components.remove(0),
        _ => Value::Array(components),
    }
}

/// The properties of batch `batch_id`.
fn expected_properties(spec: &B3dmSpec, batch_id: usize) -> Map<String, Value> {
    let mut props = Map::new();
    for (i, column) in spec.json_columns.iter().enumerate() {
        props.insert(format!("j{i}"), column[batch_id].clone());
    }
    for (i, column) in spec.binary_columns.iter().enumerate() {
        props.insert(format!("b{i}"), decode_binary(column, batch_id));
    }
    for (i, column) in spec.malformed.iter().enumerate() {
        if let Malformed::Array(values) = column
            && let Some(value) = values.get(batch_id)
        {
            props.insert(format!("m{i}"), json!(value));
        }
    }
    props
}

fn property_keys(spec: &B3dmSpec) -> Vec<String> {
    let mut keys = Vec::new();
    for (prefix, len) in [
        ("j", spec.json_columns.len()),
        ("b", spec.binary_columns.len()),
        ("m", spec.malformed.len()),
    ] {
        for i in 0..len {
            keys.push(format!("{prefix}{i}"));
        }
    }
    for key in ["extensions", "extras", "absent"] {
        keys.push(key.into());
    }
    keys
}

fn assert_reads_model(spec: &B3dmSpec) -> Result<(), TestCaseError> {
    let tile = build(spec);
    let b3dm = B3dm::from_data(&tile).map_err(|e| TestCaseError::fail(e.to_string()))?;
    prop_assert_eq!(b3dm.batch_length(), spec.batch_length);

    let table = &b3dm.batch_table;
    let json = table.json().unwrap_or(Value::Null);
    let keys = property_keys(spec);
    let filtered = table.json_filtered(&keys).unwrap_or_default();
    let columns = BatchTable::filtered_columns(&filtered, &keys);
    let n = spec.batch_length as usize;
    for batch_id in 0..n {
        let expected = expected_properties(spec, batch_id);
        prop_assert_eq!(
            table.get_property::<Value>(&json, batch_id),
            Some(Value::Object(expected.clone()))
        );
        let expected: Vec<Option<Value>> = keys.iter().map(|k| expected.get(k).cloned()).collect();
        prop_assert_eq!(
            table.get_filtered_properties::<Value>(&columns, batch_id),
            expected
        );
    }
    // A batch id past `BATCH_LENGTH` reads whatever is there, without panicking.
    for batch_id in n..n + 2 {
        table.get_property::<Value>(&json, batch_id);
        table.get_filtered_properties::<Value>(&columns, batch_id);
    }
    Ok(())
}

/// Overwrites bytes of `tile` and maybe truncates it.
fn corrupt(tile: &mut Vec<u8>, edits: &[(Index, u8)], cut: Option<Index>) {
    for (at, byte) in edits {
        let i = at.index(tile.len());
        tile[i] = *byte;
    }
    if let Some(cut) = cut {
        tile.truncate(cut.index(tile.len() + 1));
    }
}

fn config() -> ProptestConfig {
    let mut config = ProptestConfig::default();
    if std::env::var_os("PROPTEST_RNG_SEED").is_none() {
        config.rng_seed = RngSeed::Fixed(PR_SEED);
    }
    config
}

proptest! {
    #![proptest_config(config())]

    /// standard: 3D Tiles 1.0 Batch Table, "JSON header" and "Binary body".
    #[test]
    fn spec_batch_table_reads_its_model(spec in spec(false)) {
        assert_reads_model(&spec)?;
    }

    /// user: bad-data-never-crashes. Malformed definitions are dropped and
    /// leave the valid properties beside them intact.
    #[test]
    fn malformed_properties_are_dropped(spec in spec(true)) {
        assert_reads_model(&spec)?;
    }

    /// user: bad-data-never-crashes.
    #[test]
    fn corrupted_tile_reads_without_panic(
        spec in spec(true),
        edits in prop::collection::vec((any::<Index>(), any::<u8>()), 1..8),
        cut in prop::option::of(any::<Index>()),
    ) {
        let mut tile = build(&spec);
        corrupt(&mut tile, &edits, cut);
        let Ok(b3dm) = B3dm::from_data(&tile) else {
            return Ok(());
        };
        let _ = b3dm.extract_glb(&tile);
        let table = &b3dm.batch_table;
        let batch_ids = 0..b3dm.batch_length().min(64) as usize + 1;
        if let Ok(json) = table.json() {
            for batch_id in batch_ids.clone() {
                table.get_property::<Value>(&json, batch_id);
            }
            let keys: Vec<String> = json.as_object().map_or(Vec::new(), |m| m.keys().cloned().collect());
            if let Ok(filtered) = table.json_filtered(&keys) {
                let columns = BatchTable::filtered_columns(&filtered, &keys);
                for batch_id in batch_ids {
                    table.get_filtered_properties::<Value>(&columns, batch_id);
                }
            }
        }
    }
}
