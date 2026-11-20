#![doc = include_str!("../README.md")]
extern crate alloc;

pub use navara_bin::*;

use alloc::vec::Vec;
use binrw::{BinRead, io::Cursor};

pub const PNTS_HEADER_SIZE: usize = 28;

#[derive(BinRead)]
pub struct Pnts {
    pub header: PntsHeader,
    #[br(args(header.feature_table_json_byte_length, header.feature_table_binary_byte_length))]
    pub feature_table: FeatureTable,
    #[br(args(header.batch_table_json_byte_length, header.batch_table_binary_byte_length))]
    pub batch_table: BatchTable,
}

impl BinaryReader<Pnts> for Pnts {}

#[derive(BinRead)]
#[br(magic = b"pnts", little)]
pub struct PntsHeader {
    pub version: u32,
    pub byte_length: u32,
    pub feature_table_json_byte_length: u32,
    pub feature_table_binary_byte_length: u32,
    pub batch_table_json_byte_length: u32,
    pub batch_table_binary_byte_length: u32,
}

impl PntsHeader {
    /// Reads the header at the start of `tile`; `None` when it is too short
    /// or not a PNTS tile.
    pub fn parse(tile: &[u8]) -> Option<Self> {
        Self::read(&mut Cursor::new(tile.get(..PNTS_HEADER_SIZE)?)).ok()
    }
}

#[derive(BinRead)]
#[br(import(feature_table_json_byte_length: u32, feature_table_binary_byte_length: u32))]
pub struct FeatureTable {
    #[br(count = feature_table_json_byte_length)]
    pub json: Vec<u8>,
    #[br(count = feature_table_binary_byte_length)]
    pub binary: Vec<u8>,
}

#[derive(BinRead)]
#[br(import(batch_table_json_byte_length: u32, batch_table_binary_byte_length: u32))]
pub struct BatchTable {
    #[br(count = batch_table_json_byte_length)]
    pub json: Vec<u8>,
    #[br(count = batch_table_binary_byte_length)]
    pub binary: Vec<u8>,
}

pub fn json(blob: &[u8]) -> Result<serde_json::Value, serde_json::Error> {
    parse_json_to_struct(blob)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use serde_json::{Number, Value};

    fn create_mock_pnts_data() -> Vec<u8> {
        // Feature Table JSON
        let feature_table_json = r#"
        {
            "POINTS_LENGTH" : 4,
            "RTC_CENTER" : [1215013.8, -4736316.7, 4081608.4],
            "POSITION" : {
                "byteOffset" : 0
            }
        }"#;
        let feature_table_json_padded = {
            let mut padded = feature_table_json.as_bytes().to_vec();
            padded.resize((padded.len() + 3) & !3, 0); // Align 4 byte
            padded
        };

        // Feature Table Binary
        let mut feature_table_binary = vec![];
        feature_table_binary.append(&mut 1.0f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 2.0f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 3.0f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 1.1f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 2.1f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 3.1f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 1.2f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 2.2f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 3.2f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 1.3f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 2.3f32.to_le_bytes().to_vec());
        feature_table_binary.append(&mut 3.3f32.to_le_bytes().to_vec());

        let mut header = Vec::new();
        header.extend_from_slice(b"pnts"); // magic
        header.extend_from_slice(&1u32.to_le_bytes()); // version

        let total_byte_length =
            PNTS_HEADER_SIZE + feature_table_json_padded.len() + feature_table_binary.len();

        header.extend_from_slice(&(total_byte_length as u32).to_le_bytes());
        header.extend_from_slice(&(feature_table_json_padded.len() as u32).to_le_bytes());
        header.extend_from_slice(&(feature_table_binary.len() as u32).to_le_bytes());
        header.extend_from_slice(&0.0f32.to_le_bytes());
        header.extend_from_slice(&0.0f32.to_le_bytes());

        let mut data = Vec::new();
        data.extend_from_slice(&header);
        data.extend_from_slice(&feature_table_json_padded);
        data.extend_from_slice(&feature_table_binary);

        data
    }

    #[test]
    fn it_should_parse_pnts_feature_table_json() {
        let data = create_mock_pnts_data();
        let pnts = Pnts::from_data(&data).unwrap();

        assert_eq!(pnts.header.version, 1);

        let feature_table_json: serde_json::Value =
            parse_json_to_struct(&pnts.feature_table.json).unwrap();

        assert_eq!(feature_table_json["POINTS_LENGTH"], Value::Number(4.into()));
        assert_eq!(
            feature_table_json["RTC_CENTER"],
            Value::Array(vec![
                Value::Number(Number::from_f64(1215013.8).unwrap()),
                Value::Number(Number::from_f64(-4736316.7).unwrap()),
                Value::Number(Number::from_f64(4081608.4).unwrap())
            ])
        );
        assert_eq!(
            feature_table_json["POSITION"]["byteOffset"],
            Value::Number(0.into())
        );
    }
}
