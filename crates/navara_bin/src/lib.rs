#![doc = include_str!("../README.md")]

extern crate alloc;

use alloc::boxed::Box;
use binrw::io::Cursor;
use binrw::{BinRead, BinReaderExt};

#[binrw::parser(reader: reader)]
pub fn parse_json_to_struct_from_reader<T: serde::de::DeserializeOwned>(
    count: u32,
) -> binrw::BinResult<T> {
    let mut buf = alloc::vec![0u8; count as usize];
    binrw::io::Read::read_exact(reader, &mut buf).map_err(binrw::Error::Io)?;

    // Trim padding
    parse_json_to_struct(&buf).map_err(|e| {
        let pos = reader.stream_position();
        match pos {
            Ok(p) => binrw::Error::Custom {
                pos: p,
                err: Box::new(e),
            },
            Err(e) => binrw::Error::Io(e),
        }
    })
}

/// The JSON part of `buf`, without its trailing NUL padding.
pub fn trim_json_padding(buf: &[u8]) -> &[u8] {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    &buf[..end]
}

pub fn parse_json_to_struct<T: serde::de::DeserializeOwned>(buf: &[u8]) -> serde_json::Result<T> {
    serde_json::from_slice(trim_json_padding(buf))
}

pub trait BinaryReader<B: BinRead> {
    fn from_data<'a>(data: &[u8]) -> Result<B, binrw::Error>
    where
        B::Args<'a>: Default,
    {
        let mut reader = Cursor::new(&data);
        reader.read_be()
    }
}
