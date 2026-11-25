#![doc = include_str!("../README.md")]

use std::collections::HashMap;

use cesiumtiles::tileset::{BoundingVolume, ImplicitTiling, Statistics};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A metadata entity of the tileset, a tile, a content or a group.
/// Same with cesiumtiles-rs `MetadataEntity` / `GroupMetadata`, but reads the
/// spec's `extras` (cesiumtiles-rs names it `extra` and rejects `extras`), and
/// unknown fields are ignored.
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEntity {
    /// The class that property values conform to. The value shall be a class ID declared in the `classes` dictionary of the metadata schema.
    #[serde(rename = "class")]
    pub class_: String,

    /// A dictionary, where each key corresponds to a property ID in the class' `properties` dictionary and each value contains the property values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, Value>>,

    /// Dictionary object with extension-specific objects.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, Value>>,

    /// Application-specific data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<Value>,
}

/// Metadata about the tile's content and a link to the content.
/// Almost same with original: https://github.com/reearth/cesiumtiles-rs/blob/97485fe1c80577f052ae710eaa35b472bf594295/src/models/tileset.rs#L172,
/// but `uri` and `url` are optional, and unknown fields are ignored.
#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Content {
    /// An optional bounding volume that tightly encloses tile content. tile.boundingVolume provides spatial coherence and tile.content.boundingVolume enables tight view frustum culling. When this is omitted, tile.boundingVolume is used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounding_volume: Option<BoundingVolume>,

    /// A uri that points to tile content. When the uri is relative, it is relative to the referring tileset JSON file.
    pub uri: Option<String>,

    /// For backward compatibility.
    pub url: Option<String>,

    /// Metadata that is associated with this content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<MetadataEntity>,

    /// The group this content belongs to. The value is an index into the array of `groups` that is defined for the containing tileset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<u32>,

    /// Dictionary object with extension-specific objects.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, Value>>,

    /// Application-specific data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "UPPERCASE")]
pub enum Refine {
    // Lowercase is deprecated but still accepted by CesiumJS.
    #[serde(alias = "add")]
    Add,
    #[serde(alias = "replace")]
    Replace,
}

/// A tile in a 3D Tiles tileset.
/// Same with https://github.com/reearth/cesiumtiles-rs/blob/97485fe1c80577f052ae710eaa35b472bf594295/src/models/tileset.rs#L207,
/// but unknown fields are ignored, as tilesets in the wild carry tool-specific ones.
#[derive(Serialize, Deserialize, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Tile {
    /// The bounding volume that encloses the tile.
    pub bounding_volume: BoundingVolume,

    /// Optional bounding volume that defines the volume the viewer shall be inside of before the tile's content will be requested and before the tile will be refined based on geometricError.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer_request_volume: Option<BoundingVolume>,

    /// The error, in meters, introduced if this tile is rendered and its children are not. At runtime, the geometric error is used to compute screen space error (SSE), i.e., the error measured in pixels.
    pub geometric_error: f64, // non-negative

    /// Specifies if additive or replacement refinement is used when traversing the tileset for rendering. This property is required for the root tile of a tileset; it is optional for all other tiles. The default is to inherit from the parent tile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refine: Option<Refine>,

    /// A floating-point 4x4 affine transformation matrix, stored in column-major order, that transforms the tile's content--i.e., its features as well as content.boundingVolume, boundingVolume, and viewerRequestVolume--from the tile's local coordinate system to the parent tile's coordinate system, or, in the case of a root tile, from the tile's local coordinate system to the tileset's coordinate system. `transform` does not apply to any volume property when the volume is a region, defined in EPSG:4979 coordinates. `transform` scales the `geometricError` by the maximum scaling factor from the matrix.
    #[serde(skip_serializing_if = "is_identity_matrix")]
    pub transform: [f64; 16],

    /// Metadata about the tile's content and a link to the content. When this is omitted the tile is just used for culling. When this is defined, then `contents` shall be undefined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Content>,

    /// An array of contents. When this is defined, then `content` shall be undefined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contents: Option<Vec<Content>>,

    /// A metadata entity that is associated with this tile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<MetadataEntity>,

    /// An object that describes the implicit subdivision of this tile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implicit_tiling: Option<ImplicitTiling>,

    /// An array of objects that define child tiles. Each child tile content is fully enclosed by its parent tile's bounding volume and, generally, has a geometricError less than its parent tile's geometricError. For leaf tiles, there are no children, and this property may not be defined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Tile>>,

    /// Dictionary object with extension-specific objects.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, Value>>,

    /// Application-specific data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,

    /// Application-specific data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<Value>,
}

impl Default for Tile {
    fn default() -> Self {
        Self {
            bounding_volume: BoundingVolume::default(),
            viewer_request_volume: None,
            geometric_error: 0.0,
            refine: None,
            transform: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
            content: None,
            contents: None,
            metadata: None,
            implicit_tiling: None,
            children: None,
            extensions: None,
            extra: None,
            extras: None,
        }
    }
}

/// Metadata about the entire tileset.
/// Almost same with https://github.com/reearth/cesiumtiles-rs/blob/97485fe1c80577f052ae710eaa35b472bf594295/src/models/tileset.rs#L9-L32.
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    /// The 3D Tiles version. The version defines the JSON schema for the tileset JSON and the base set of tile formats.
    pub version: String,

    pub copyright: Option<String>,

    /// Application-specific version of this tileset, e.g., for when an existing tileset is updated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tileset_version: Option<String>,

    /// Dictionary object with extension-specific objects.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, Value>>,

    /// Application-specific data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,

    /// Application-specific data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extras: Option<Value>,
}

impl Default for Asset {
    fn default() -> Self {
        Self {
            version: "1.1".to_string(),
            copyright: None,
            tileset_version: None,
            extensions: None,
            extra: None,
            extras: None,
        }
    }
}

/// A 3D Tiles tileset.
/// Same with https://github.com/reearth/cesiumtiles-rs/blob/97485fe1c80577f052ae710eaa35b472bf594295/src/models/tileset.rs#L313
#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tileset {
    /// Metadata about the entire tileset.
    pub asset: Asset,

    /// (deprecated) A dictionary object of metadata about per-feature properties.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, Value>>,

    /// An object defining the structure of metadata classes and enums. When this is defined, then `schemaUri` shall be undefined.
    /// Kept as JSON: the metadata resolvers read it as JSON, and apps get it as written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,

    /// The URI (or IRI) of the external schema file. When this is defined, then `schema` shall be undefined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_uri: Option<String>,

    /// An object containing statistics about metadata entities.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub statistics: Option<Statistics>,

    /// An array of groups that tile content may belong to. Each element of this array is a metadata entity that describes the group. The tile content `group` property is an index into this array.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub groups: Option<Vec<MetadataEntity>>,

    /// A metadata entity that is associated with this tileset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<MetadataEntity>,

    /// The error, in meters, introduced if this tileset is not rendered. At runtime, the geometric error is used to compute screen space error (SSE), i.e., the error measured in pixels.
    pub geometric_error: f64, // non-negative

    /// The root tile.
    pub root: Tile,

    /// Names of 3D Tiles extensions used somewhere in this tileset.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions_used: Vec<String>,

    /// Names of 3D Tiles extensions required to properly load this tileset. Each element of this array shall also be contained in `extensionsUsed`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions_required: Vec<String>,

    /// Dictionary object with extension-specific objects.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, Value>>,

    /// Application-specific data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Value>,
}

fn is_identity_matrix(a: &[f64; 16]) -> bool {
    *a == [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_should_parse_legacy_tileset() {
        let tileset: Tileset = serde_json::from_str(
            r#"{
                "asset": {"version": "0.0", "gltfUpAxis": "Y"},
                "geometricError": 100,
                "root": {
                    "boundingVolume": {"sphere": [0, 0, 0, 10]},
                    "geometricError": 10,
                    "refine": "replace",
                    "content": {"url": "a.b3dm", "toolSpecific": 1},
                    "toolSpecific": true
                }
            }"#,
        )
        .unwrap();

        assert!(matches!(tileset.root.refine, Some(Refine::Replace)));
        assert_eq!(tileset.root.content.unwrap().url.as_deref(), Some("a.b3dm"));
    }

    #[test]
    fn it_should_parse_metadata_entities_with_extras() {
        let tileset: Tileset = serde_json::from_str(
            r#"{
                "asset": {"version": "1.1"},
                "geometricError": 100,
                "schema": {"id": "s", "classes": {"c": {"properties": {}}}, "toolSpecific": 1},
                "metadata": {"class": "c", "extras": {"a": 1}},
                "groups": [{"class": "c", "properties": {}, "extras": {}}],
                "root": {
                    "boundingVolume": {"sphere": [0, 0, 0, 10]},
                    "geometricError": 10,
                    "metadata": {"class": "c", "extras": {}},
                    "content": {"uri": "a.glb", "metadata": {"class": "c", "extras": {}}}
                }
            }"#,
        )
        .unwrap();

        assert_eq!(tileset.metadata.unwrap().class_, "c");
        assert_eq!(tileset.groups.unwrap().len(), 1);
        assert!(tileset.root.content.unwrap().metadata.is_some());
    }
}
