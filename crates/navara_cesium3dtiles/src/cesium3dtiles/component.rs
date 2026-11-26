//! Core Components and Data Structures for Cesium 3D Tiles
//!
//! This module defines the core components used throughout the 3D Tiles system.
//! These components represent the runtime state of tiles and are managed by
//! the traversal systems.
//!
//! # Component Hierarchy
//!
//! ```text
//! Cesium3dTilesLayer (layer definition)
//!     ↓
//! Cesium3dTilesTree (root tile tree, attached to entity)
//!     └── Cesium3dTileContent (recursive tile state, stored in tree)
//!         └── ContentSlot (one per content)
//!             ├── data_requester_id → DataRequester entity
//!             └── rendered_tile_id → RenderedCesium3dTileContent entity
//!                                         └── feature_id → Model entity
//! ```
//!
//! # Key Concepts
//!
//! - **Tree vs Content**: `Cesium3dTilesTree` is an ECS component, while
//!   `Cesium3dTileContent` is a regular struct stored within the tree.
//!
//! - **Entity References**: Tiles store `Entity` IDs to reference related
//!   entities (data requesters, rendered tiles, features).
//!
//! - **State Management**: `Cesium3dTileContentState` tracks traversal state
//!   that changes every frame (visibility, SSE, loading status).

use bevy_ecs::{component::Component, entity::Entity, system::Query};
use bevy_log::warn;
use navara_core::{BoundingSphere, BoundingVolume, Extent, LngLat, Obb};
use navara_data_requester::DataRequesterExtension;
use navara_feature_component::{id::FeatureId, model::GltfResourceBase, render::RenderableFeature};
use navara_layer::Cesium3dTilesLayer;
use navara_material::Appearance;
use navara_math::{FloatType, Mat4, Transform, Vec3};
use navara_parser::cesium3dtiles::{
    self,
    metadata_entity::resolve_metadata_entity,
    tileset::{Groups, Refine},
};
use serde::Serialize;
use serde_json::Value;
use smallvec::SmallVec;
use std::{collections::HashMap, sync::Arc};
use url::{ParseError, Url};

/// Type alias for tile metadata from the tileset.json.
///
/// This is the static metadata that doesn't change at runtime.
pub type Cesium3dTileContentMetadata = navara_parser::cesium3dtiles::tileset::Tile;

/// Parsed tileset.json metadata.
///
/// Stores the complete parsed tileset.json file, including geometric error,
/// asset info, and the root tile definition.
#[derive(Debug, Component)]
pub struct Cesium3dTilesMetadata(pub navara_parser::cesium3dtiles::tileset::Tileset);

/// The root of a 3D Tiles tree structure.
///
/// This component is attached to entities that represent tile trees.
/// There can be multiple trees per layer (when using external tilesets).
#[derive(Debug, Component)]
pub struct Cesium3dTilesTree {
    /// Entity ID of the parent [`Cesium3dTilesLayer`]
    pub layer_id: Entity,
    /// Base URL for resolving relative content URLs.
    /// Wrapped in `Arc` so the recursive traversal can hand it down without
    /// cloning the underlying `Url` (which would heap-allocate per tile).
    pub base_url: Arc<Url>,
    /// The root tile content (contains the full tree recursively)
    pub root: Cesium3dTileContent,
    /// Maximum screen-space error threshold for LOD selection
    pub max_sse: f32,
    /// Maximum number of tiles to render (soft limit)
    pub max_num_rendered_tiles: u32,
    /// Current count of rendered tiles
    pub num_rendered_tiles: u32,
    /// Whether this tileset is 3D Tiles version 1.1.
    pub is_v1_1: bool,
    pub scope: TilesetMetadataScope,
}

/// Metadata definitions of the root tileset JSON. Every tile resolves against
/// them, nested tilesets included: as in CesiumJS, the `schema` and `groups`
/// of a nested tileset are not read.
/// <https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/findTileMetadata.js>
#[derive(Debug, Default, Clone)]
pub struct TilesetMetadataScope {
    /// Resolves JSON metadata entities and the property tables of
    /// `EXT_structural_metadata` in glTF content.
    pub schema: Option<Arc<Value>>,
    /// Resolved group metadata entities, referenced by `content.group`.
    pub groups: Option<Arc<Groups<Value>>>,
}

impl TilesetMetadataScope {
    pub fn new(tileset: &navara_parser::cesium3dtiles::tileset::Tileset) -> Self {
        let schema = tileset.schema.clone();
        let groups = tileset.groups.as_ref().map(|groups| {
            Arc::new(groups.map(|g| {
                resolve_metadata_entity(schema.as_ref(), &g.class_, g.properties.as_ref())
            }))
        });
        Self {
            schema: schema.map(Arc::new),
            groups,
        }
    }
}

impl Cesium3dTilesTree {
    pub fn new(
        url: &str,
        layer_id: Entity,
        layer: &Cesium3dTilesLayer,
        metadata: &navara_parser::cesium3dtiles::tileset::Tileset,
    ) -> Result<Self, ParseError> {
        let base_url = Arc::new(Url::parse(url)?);
        let scope = TilesetMetadataScope::new(metadata);
        let root = Cesium3dTileContent::new(&metadata.root, None, &scope);

        let appearance = layer
            .appearances
            .iter()
            .find(|a| matches!(a, Appearance::Model(_)));
        let max_sse = match appearance {
            Some(Appearance::Model(m)) => m.max_sse,
            _ => 2.,
        };

        let is_v1_1 = metadata.asset.version == "1.1";

        Ok(Self {
            layer_id,
            base_url,
            root,
            max_sse,
            max_num_rendered_tiles: 100,
            num_rendered_tiles: 0,
            is_v1_1,
            scope,
        })
    }
}

/// Runtime state for a single tile in the hierarchy.
///
/// This struct is stored recursively within [`Cesium3dTilesTree`] and represents
/// the mutable runtime state of a tile. It's not an ECS component itself.
///
/// # Content Types
///
/// - **Renderable content** (`is_renderable_content() = true`): B3DM, PNTS, GLB files
/// - **Non-renderable content** (`is_renderable_content() = false`): Nested tileset.json
///
/// # Memory Management
///
/// The `children` vector is allocated lazily and cleared when the tile goes
/// out of view. This prevents memory accumulation for deep tile hierarchies.
#[derive(Debug)]
pub struct Cesium3dTileContent {
    /// One slot for `content`, one per supported entry of `contents`; empty
    /// for an empty tile. A [`ContentKind::Json`] slot is always the only one.
    pub contents: SmallVec<[ContentSlot; 1]>,
    /// Child tiles (lazily allocated, cleared when out of view).
    pub children: Option<Vec<Cesium3dTileContent>>,
    /// Refinement strategy (REPLACE or ADD).
    pub refine: Refine,
    /// Bounding volume for frustum culling and SSE distance. Built as an OBB
    /// for both region (ENU-aligned at patch center) and box (preserves the
    /// source orientation) sources, so the envelope stays tight against
    /// curved ellipsoid patches.
    pub bounding_volume: Option<BoundingVolume>,
    /// Tile transform (inherited from parent if identity).
    pub transform: Option<Transform>,
    /// Per-frame traversal state.
    pub state: Cesium3dTileContentState,
}

impl Cesium3dTileContent {
    pub fn new(
        tile: &cesium3dtiles::tileset::Tile,
        parent: Option<&Self>,
        scope: &TilesetMetadataScope,
    ) -> Self {
        let schema = scope.schema.as_deref();
        let tile_metadata = tile
            .metadata
            .as_ref()
            .map(|m| resolve_metadata_entity(schema, &m.class_, m.properties.as_ref()));
        let new_slot = |content| ContentSlot::new(content, tile_metadata.as_ref(), scope);
        let contents = match (&tile.content, &tile.contents) {
            (Some(content), _) => new_slot(content).into_iter().collect(),
            (None, Some(contents)) => contents
                .iter()
                .filter_map(new_slot)
                .filter(|slot| {
                    // As in CesiumJS, which rejects an external tileset here.
                    let is_tileset = slot.kind == ContentKind::Json;
                    if is_tileset {
                        warn!(
                            "External tileset in 3D Tiles `contents`, skipping: {}",
                            truncate_uri(&slot.uri)
                        );
                    }
                    !is_tileset
                })
                .collect(),
            (None, None) => SmallVec::new(),
        };

        // Per 3D Tiles 1.1 spec, `tile.transform` is defined relative to the parent
        // tile's coordinate system. Accumulate down the chain so that this struct's
        // `transform` field always holds the world-space transform.
        let own = Transform::from_matrix(Mat4::from_cols_array(
            &tile.transform.map(|v| v as FloatType),
        ));
        let parent_world = parent
            .and_then(|p| p.transform)
            .unwrap_or(Transform::IDENTITY);
        let tile_transform = parent_world.mul_transform(own);
        let bv = &tile.bounding_volume;
        let bounding_volume = match (bv.region, bv.sphere, bv.box_) {
            (Some([west, south, east, north, min_height, max_height]), _, _) => {
                Some(BoundingVolume::Obb(Obb::from_oriented_extent(
                    Extent::from_points(&[
                        LngLat::new(south as FloatType, west as FloatType),
                        LngLat::new(north as FloatType, east as FloatType),
                    ]),
                    min_height as FloatType,
                    max_height as FloatType,
                )))
            }
            (_, Some([cx, cy, cz, radius]), _) => {
                // 3D Tiles spec: tile.transform applies to box/sphere volumes (but not to region).
                // Use the largest unit-axis length under the transform as the radius scale
                // so non-uniform scales stay conservative.
                let center = Vec3::new(cx as FloatType, cy as FloatType, cz as FloatType);
                let center_transformed = tile_transform.transform_point(center);
                let sx = tile_transform.transform_vector(Vec3::X).length();
                let sy = tile_transform.transform_vector(Vec3::Y).length();
                let sz = tile_transform.transform_vector(Vec3::Z).length();
                let scale = sx.max(sy).max(sz);
                Some(BoundingVolume::Sphere(BoundingSphere::new(
                    center_transformed,
                    (radius as FloatType) * scale,
                )))
            }
            (
                _,
                _,
                Some(
                    [
                        cx,
                        cy,
                        cz,
                        xdir0,
                        xdir1,
                        xdir2,
                        ydir0,
                        ydir1,
                        ydir2,
                        zdir0,
                        zdir1,
                        zdir2,
                    ],
                ),
            ) => {
                // Preserve the source axes through the tile transform instead of
                // taking an axis-aligned hull — the box bounding volume *is*
                // oriented in 3D Tiles, and collapsing it to an AABB would
                // reintroduce the envelope slack that this OBB pipeline exists
                // to eliminate.
                let center = Vec3::new(cx as FloatType, cy as FloatType, cz as FloatType);
                let x_axis = Vec3::new(xdir0 as FloatType, xdir1 as FloatType, xdir2 as FloatType);
                let y_axis = Vec3::new(ydir0 as FloatType, ydir1 as FloatType, ydir2 as FloatType);
                let z_axis = Vec3::new(zdir0 as FloatType, zdir1 as FloatType, zdir2 as FloatType);

                let center_transformed = tile_transform.transform_point(center);
                let x_transformed = tile_transform.transform_vector(x_axis);
                let y_transformed = tile_transform.transform_vector(y_axis);
                let z_transformed = tile_transform.transform_vector(z_axis);

                Some(BoundingVolume::Obb(Obb::new(
                    center_transformed,
                    [x_transformed, y_transformed, z_transformed],
                )))
            }
            _ => None,
        };
        let default_refine = Refine::Replace;
        Self {
            contents,
            children: None,
            bounding_volume,
            refine: match tile
                .refine
                .as_ref()
                .unwrap_or(parent.map_or(&default_refine, |p| &p.refine))
            {
                Refine::Replace => Refine::Replace,
                Refine::Add => Refine::Add,
            },
            transform: Some(tile_transform),
            state: Cesium3dTileContentState::default(),
        }
    }

    /// True for B3DM/PNTS/GLB, false for nested tileset.json or an empty tile.
    pub fn is_renderable_content(&self) -> bool {
        self.contents
            .first()
            .is_some_and(|slot| slot.kind != ContentKind::Json)
    }

    /// The slot of a nested tileset.json.
    pub fn tileset_slot(&self) -> Option<&ContentSlot> {
        self.contents
            .first()
            .filter(|slot| slot.kind == ContentKind::Json)
    }

    /// Key of the loaded nested tileset in
    /// [`Cesium3dTilesNestedTreeMap`](super::Cesium3dTilesNestedTreeMap).
    pub fn tileset_requester_id(&self) -> Option<Entity> {
        self.tileset_slot().and_then(|slot| slot.data_requester_id)
    }

    pub fn reset_state(&mut self) {
        self.state.reset();
    }

    /// Whether every content has been drawn.
    pub fn is_rendered(
        &self,
        rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
        features: &Query<&FeatureId>,
        renderable_features: &Query<&RenderableFeature>,
    ) -> bool {
        self.all_contents_match(rendered_tiles, features, renderable_features, |f| {
            matches!(f, RenderableFeature::Model { render_info, .. } if render_info.is_rendered)
        })
    }

    /// Whether every content is active.
    pub fn is_active(
        &self,
        rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
        features: &Query<&FeatureId>,
        renderable_features: &Query<&RenderableFeature>,
    ) -> bool {
        self.all_contents_match(
            rendered_tiles,
            features,
            renderable_features,
            |f| matches!(f, RenderableFeature::Model { active, .. } if *active),
        )
    }

    fn all_contents_match(
        &self,
        rendered_tiles: &mut Query<&mut RenderedCesium3dTileContent>,
        features: &Query<&FeatureId>,
        renderable_features: &Query<&RenderableFeature>,
        f: impl Fn(&RenderableFeature) -> bool,
    ) -> bool {
        !self.contents.is_empty()
            && self.contents.iter().all(|slot| {
                slot.rendered_tile_id
                    .and_then(|e| rendered_tiles.get(e).ok().and_then(|t| t.feature_id))
                    .and_then(|feature_id| features.get(feature_id).ok().and_then(|f| f.0))
                    .and_then(|id| renderable_features.get(id).ok())
                    .is_some_and(&f)
            })
    }
}

/// One content of a tile, with the entities that load and render it.
#[derive(Debug)]
pub struct ContentSlot {
    /// Relative URL to the content (may be a path, not full URL).
    pub uri: String,
    pub kind: ContentKind,
    /// Entity with [`DataRequester`](navara_data_requester::DataRequester)
    /// for this content.
    ///
    /// For a [`ContentKind::Json`] slot this is the metadata data requester
    /// that fetched the nested `tileset.json` — it is also the key into
    /// [`Cesium3dTilesNestedTreeMap`](super::Cesium3dTilesNestedTreeMap).
    pub data_requester_id: Option<Entity>,
    /// Entity with [`RenderedCesium3dTileContent`] when the content is rendered.
    pub rendered_tile_id: Option<Entity>,
    /// JSON of the resolved `{ tile?, content?, group? }` metadata; `None`
    /// when none of them is defined.
    pub metadata: Option<Arc<str>>,
}

impl ContentSlot {
    /// `None` for a content without a URI or in an unsupported format.
    fn new(
        content: &cesium3dtiles::tileset::Content,
        tile_metadata: Option<&Value>,
        scope: &TilesetMetadataScope,
    ) -> Option<Self> {
        // Legacy tilesets name the content URI `url`.
        let uri = content.uri.as_ref().or(content.url.as_ref())?;
        let Some(kind) = ContentKind::from_uri(uri) else {
            // TODO: support other formats like cmpt.
            // The tile is kept so its children still render.
            if !uri.is_empty() {
                warn!(
                    "Unsupported 3D Tiles content, skipping: {}",
                    truncate_uri(uri)
                );
            }
            return None;
        };
        Some(Self {
            uri: uri.clone(),
            kind,
            data_requester_id: None,
            rendered_tile_id: None,
            metadata: content_metadata(tile_metadata, content, scope),
        })
    }
}

fn content_metadata(
    tile_metadata: Option<&Value>,
    content: &cesium3dtiles::tileset::Content,
    scope: &TilesetMetadataScope,
) -> Option<Arc<str>> {
    #[derive(Serialize)]
    struct ContentMetadata<'a> {
        #[serde(skip_serializing_if = "Option::is_none")]
        tile: Option<&'a Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        group: Option<&'a Value>,
    }

    let metadata = ContentMetadata {
        tile: tile_metadata,
        content: content.metadata.as_ref().map(|m| {
            resolve_metadata_entity(scope.schema.as_deref(), &m.class_, m.properties.as_ref())
        }),
        group: content
            .group
            .as_ref()
            .and_then(|g| scope.groups.as_ref()?.get(g)),
    };
    if metadata.tile.is_none() && metadata.content.is_none() && metadata.group.is_none() {
        return None;
    }
    serde_json::to_string(&metadata).ok().map(Into::into)
}

/// A data URI can be megabytes long.
fn truncate_uri(uri: &str) -> String {
    uri.chars().take(128).collect()
}

/// Supported format of a tile's content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentKind {
    /// A nested tileset.
    Json,
    B3dm,
    I3dm,
    Pnts,
    Glb,
    /// JSON glTF, which the frontend packs into a GLB, so it is then handled
    /// as [`Self::Glb`].
    Gltf,
}

impl ContentKind {
    /// Format of a content URI: from the extension of its path, or for a
    /// `data:` URI from its media type or the magic of its payload. `None`
    /// when unsupported.
    pub(crate) fn from_uri(uri: &str) -> Option<Self> {
        if let Some(data) = uri.strip_prefix("data:") {
            return Self::from_data_uri(data);
        }
        match content_extension(uri)? {
            "json" => Some(Self::Json),
            "b3dm" => Some(Self::B3dm),
            "i3dm" => Some(Self::I3dm),
            "pnts" => Some(Self::Pnts),
            "glb" => Some(Self::Glb),
            "gltf" => Some(Self::Gltf),
            _ => None,
        }
    }

    /// `data` is the URI after `data:`, i.e. `[<media type>][;base64],<payload>`.
    fn from_data_uri(data: &str) -> Option<Self> {
        let (header, payload) = data.split_once(',')?;
        match header.split(';').next() {
            Some("application/json") => return Some(Self::Json),
            Some("model/gltf-binary") => return Some(Self::Glb),
            Some("model/gltf+json") => return Some(Self::Gltf),
            _ => {}
        }
        let magic = if header.ends_with(";base64") {
            base64_magic(payload)?
        } else {
            payload.as_bytes().get(..4)?.try_into().ok()?
        };
        match &magic {
            b"b3dm" => Some(Self::B3dm),
            b"i3dm" => Some(Self::I3dm),
            b"pnts" => Some(Self::Pnts),
            b"glTF" => Some(Self::Glb),
            [b'{', ..] => Some(Self::Json),
            _ => None,
        }
    }

    pub(crate) fn data_requester_extension(self) -> DataRequesterExtension {
        match self {
            Self::Json => DataRequesterExtension::Json,
            Self::B3dm => DataRequesterExtension::B3dm,
            Self::I3dm => DataRequesterExtension::I3dm,
            Self::Pnts => DataRequesterExtension::Pnts,
            Self::Glb => DataRequesterExtension::Glb,
            Self::Gltf => DataRequesterExtension::Gltf,
        }
    }
}

/// First 4 bytes of a base64 payload, decoded from its first 6 characters.
fn base64_magic(payload: &str) -> Option<[u8; 4]> {
    let mut bits = 0u64;
    let mut len = 0;
    for c in payload.bytes().take(6) {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        };
        bits = bits << 6 | u64::from(v);
        len += 1;
    }
    // 6 characters hold 36 bits; the magic is the top 32.
    (len == 6).then(|| ((bits >> 4) as u32).to_be_bytes())
}

/// Resolves a content URI against the tileset URL, carrying over the
/// tileset's query parameters the URI does not set. A `data:` URI is used as
/// is, since a query would corrupt its payload.
pub(crate) fn resolve_content_url(base_url: &Url, uri: &str) -> Result<Url, ParseError> {
    if uri.starts_with("data:") {
        return Url::parse(uri);
    }
    let mut url = base_url.join(uri)?;
    let base_query = base_url.query_pairs().into_owned();
    let new_query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    for (key, value) in base_query {
        if new_query.contains_key(&key) {
            continue;
        }
        url.query_pairs_mut()
            .append_pair(key.as_ref(), value.as_ref());
    }
    Ok(url)
}

/// Extension of a content URI's path, ignoring its query and fragment.
fn content_extension(uri: &str) -> Option<&str> {
    let path = uri.split(['?', '#']).next()?;
    let (_, ext) = path.rsplit_once('.')?;
    (!ext.contains('/')).then_some(ext)
}

/// Resource base for a glTF fetched from `url`, so its relative URIs resolve
/// like [`resolve_content_url`] resolves content URIs.
/// `None` unless `url` is http(s): `blob:`/`data:` URLs cannot be a base.
pub(crate) fn gltf_resource_base(url: &str) -> Option<Arc<GltfResourceBase>> {
    let url = Url::parse(url).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    Some(Arc::new(GltfResourceBase {
        path: url.join(".").ok()?.into(),
        query: url.query().map(str::to_owned),
    }))
}

/// Per-frame traversal state for a tile.
///
/// This state is reset at the beginning of each traversal and updated
/// during the [`mark_leaves`](super::traversal::mark_leaves) phase.
/// It's used by [`mark_rendered_tiles`](super::traversal::mark_rendered_tiles)
/// to determine what actions to take for each tile.
#[derive(Debug, Default)]
pub struct Cesium3dTileContentState {
    /// True if this tile is a leaf (should be rendered).
    pub leaf: bool,
    /// Whether the tile was touched in the previous frame.
    pub touched_last_frame: bool,
    /// Whether the tile is within camera frustum.
    pub is_visible: bool,
    /// Marked for removal (nested tileset cleanup).
    pub removed: bool,
    /// Whether this content was touched while traversing.
    pub touched: bool,
    /// Whether tile data has been successfully loaded.
    pub is_data_loaded: bool,
    /// Whether this tile was rendered in the previous frame.
    pub is_rendered_last_frame: bool,
    /// For REPLACE refinement: true when all children are loaded.
    pub are_all_children_loaded: bool,
    /// Distance from camera to tile bounding volume.
    pub distance_from_camera: f32,
    /// Calculated screen-space error for this tile.
    pub sse: f32,
}

impl Cesium3dTileContentState {
    fn reset(&mut self) {
        self.leaf = false;
        self.removed = false;
        self.is_visible = false;
        self.touched = false;
        self.is_data_loaded = false;
        self.distance_from_camera = 0.;
        self.sse = 0.;
    }
}

/// Represents a tile that is currently being rendered.
///
/// This component is spawned on an entity when a tile becomes visible.
/// It's paired with a format-specific marker component:
/// - [`RenderedCesium3dTileContentB3dmMarker`]
/// - [`RenderedCesium3dTileContentPntsMarker`]
/// - [`RenderedCesium3dTileContentGlbMarker`]
///
/// # Lifecycle
///
/// 1. Spawned by [`update_or_spawn_rendered_tile`](super::traversal)
/// 2. Triggers `construct_model_by_cesium3dtiles_layer` via `Added` query
/// 3. `feature_id` is set when model entity is created
/// 4. Visibility toggled based on traversal results
/// 5. Despawned by `remove_invisible_rendered_tiles` when no longer needed
#[derive(Component)]
pub struct RenderedCesium3dTileContent {
    /// Parent layer entity.
    pub layer_id: Entity,
    /// Entity with model components (set after construction).
    pub feature_id: Option<Entity>,
    /// Entity with DataRequester containing tile data.
    pub data_requester_id: Entity,
    /// Whether the tile should be visible in the scene.
    pub is_visible: bool,
    /// Whether the tile was touched during traversal (for REPLACE refinement).
    pub touched: bool,
}

/// Transform component for tile content.
///
/// Stores the tile's transformation matrix from tileset.json.
/// Used primarily for PNTS (point cloud) tiles.
#[derive(Component)]
pub struct TileTransform {
    pub transform: Transform,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gltf_resource_base_splits_query_containing_slash() {
        let base =
            gltf_resource_base("https://example.com/tiles/data/root.glb?sig=a/b&v=1").unwrap();
        assert_eq!(base.path, "https://example.com/tiles/data/");
        assert_eq!(base.query.as_deref(), Some("sig=a/b&v=1"));
    }

    #[test]
    fn content_extension_ignores_query_and_fragment() {
        assert_eq!(content_extension("a/b.b3dm?v=1.2"), Some("b3dm"));
        assert_eq!(content_extension("sub.json#x"), Some("json"));
        assert_eq!(content_extension("v1.0/content"), None);
        assert_eq!(content_extension("content?id=1"), None);
    }

    #[test]
    fn content_kind_from_data_uri() {
        let cases = [
            // "b3dm" + version 1.
            (
                "data:application/octet-stream;base64,YjNkbQEAAAA=",
                Some(ContentKind::B3dm),
            ),
            ("data:;base64,cG50cwEAAAA=", Some(ContentKind::Pnts)),
            ("data:model/gltf-binary;base64,AAAA", Some(ContentKind::Glb)),
            ("data:model/gltf+json,{}", Some(ContentKind::Gltf)),
            ("data:application/json,{}", Some(ContentKind::Json)),
            ("data:,{\"asset\":{}}", Some(ContentKind::Json)),
            ("data:;base64,aTNkbQEAAAA=", Some(ContentKind::I3dm)),
            // "cmpt".
            ("data:;base64,Y21wdAEAAAA=", None),
            ("data:;base64,YjNk", None),
            ("data:;base64", None),
        ];
        for (uri, kind) in cases {
            assert_eq!(ContentKind::from_uri(uri), kind, "{uri}");
        }
    }

    #[test]
    fn resolve_content_url_keeps_data_uri_intact() {
        let base = Url::parse("https://example.com/t/tileset.json?key=1").unwrap();
        assert_eq!(
            resolve_content_url(&base, "a.b3dm").unwrap().as_str(),
            "https://example.com/t/a.b3dm?key=1"
        );
        let data = "data:application/octet-stream;base64,YjNkbQEAAAA=";
        assert_eq!(resolve_content_url(&base, data).unwrap().as_str(), data);
    }

    #[test]
    fn contents_keep_supported_renderable_slots() {
        let tile = |json: &str| {
            let tile: cesium3dtiles::tileset::Tile = serde_json::from_str(json).unwrap();
            Cesium3dTileContent::new(&tile, None, &TilesetMetadataScope::default())
        };
        let kinds = |t: &Cesium3dTileContent| t.contents.iter().map(|s| s.kind).collect::<Vec<_>>();

        let multi = tile(
            r#"{"contents": [{"uri": "a.b3dm"}, {"uri": "b.cmpt"}, {"uri": "c.glb"}, {"uri": "d.json"}]}"#,
        );
        assert_eq!(kinds(&multi), [ContentKind::B3dm, ContentKind::Glb]);
        assert!(multi.is_renderable_content());

        // A single `content` may still be a nested tileset.
        let nested = tile(r#"{"content": {"uri": "d.json"}}"#);
        assert_eq!(kinds(&nested), [ContentKind::Json]);
        assert!(!nested.is_renderable_content());
    }

    #[test]
    fn contents_carry_tile_content_and_group_metadata() {
        let tileset: navara_parser::cesium3dtiles::tileset::Tileset = serde_json::from_value(serde_json::json!({
            "asset": { "version": "1.1" },
            "geometricError": 1,
            "schema": { "id": "s", "classes": {
                "t": { "properties": { "area": { "type": "SCALAR", "componentType": "UINT8", "normalized": true, "scale": 10 } } },
                "g": { "properties": { "name": { "type": "STRING" } } },
            } },
            "groups": [{ "class": "g", "properties": { "name": "a" } }],
            "root": {
                "boundingVolume": { "sphere": [0, 0, 0, 1] },
                "geometricError": 0,
                "metadata": { "class": "t", "properties": { "area": 255 } },
                "contents": [
                    { "uri": "a.b3dm", "group": 0, "metadata": { "class": "c", "properties": { "n": 1 } } },
                    { "uri": "b.b3dm" },
                ],
            },
        }))
        .unwrap();
        let scope = TilesetMetadataScope::new(&tileset);
        let tile = Cesium3dTileContent::new(&tileset.root, None, &scope);
        let metadata = |i: usize| -> Value {
            serde_json::from_str(tile.contents[i].metadata.as_deref().unwrap()).unwrap()
        };

        assert_eq!(
            metadata(0),
            serde_json::json!({
                "tile": { "class": "t", "properties": { "area": 10.0 } },
                "content": { "class": "c", "properties": { "n": 1 } },
                "group": { "class": "g", "properties": { "name": "a" } },
            })
        );
        assert_eq!(
            metadata(1),
            serde_json::json!({ "tile": { "class": "t", "properties": { "area": 10.0 } } })
        );
    }

    #[test]
    fn gltf_resource_base_skips_non_http() {
        assert!(gltf_resource_base("blob:https://example.com/0f8c").is_none());
        assert!(gltf_resource_base("data:model/gltf-binary;base64,AA==").is_none());
    }
}
