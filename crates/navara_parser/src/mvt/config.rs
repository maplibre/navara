//! ECS-free description of how a matched target layer should be parsed.
//!
//! On the main thread these are derived from the layer's `Appearance`s. Keeping
//! them as plain data (no `navara_material` / `bevy_ecs` dependency) lets the
//! parse core run either inline or inside a Web Worker.

/// The geometry-appearance kind a parsed group belongs to.
///
/// This mirrors `navara_feature_component::geometry_builder::GeometryAppearanceKind`
/// but is ECS-free so it can live in the lean parse core.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum LayerParseKind {
    Point,
    Billboard,
    Text,
    Polyline,
    Polygon,
}

impl LayerParseKind {
    /// Stable numeric tag for crossing the Web Worker boundary.
    pub fn as_u8(self) -> u8 {
        match self {
            LayerParseKind::Point => 0,
            LayerParseKind::Billboard => 1,
            LayerParseKind::Text => 2,
            LayerParseKind::Polyline => 3,
            LayerParseKind::Polygon => 4,
        }
    }

    /// Inverse of [`LayerParseKind::as_u8`]; returns `None` for unknown tags.
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(LayerParseKind::Point),
            1 => Some(LayerParseKind::Billboard),
            2 => Some(LayerParseKind::Text),
            3 => Some(LayerParseKind::Polyline),
            4 => Some(LayerParseKind::Polygon),
            _ => None,
        }
    }
}

pub use crate::line_placement::PointPlacement;

/// A point-like emitter derived from a `Point`/`Billboard`/`Text` appearance.
///
/// Each coordinate of a point/multipoint geometry is emitted once per enabled
/// emitter, at the emitter's own `height`. The three kinds keep independent
/// heights, so they cannot be collapsed into a single scalar.
///
/// The `from_*` flags mirror the appearance's opt-in `geometry_types`: besides
/// point geometry, an emitter can derive a point per line-string vertex and/or
/// per polygon-ring vertex.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PointEmitter {
    pub kind: LayerParseKind,
    pub height: f32,
    /// Emit for point/multipoint geometry (the native source).
    #[serde(default = "default_true")]
    pub from_points: bool,
    /// Also emit one point per line-string vertex.
    #[serde(default)]
    pub from_lines: bool,
    /// Also emit one point per polygon-ring vertex (closing duplicate skipped).
    #[serde(default)]
    pub from_polygons: bool,
    /// How anchors are derived from line geometry once `from_lines` is set.
    #[serde(default)]
    pub placement: PointPlacement,
    /// Anchor spacing along a line in pixels at this tile's own zoom. Only used
    /// by [`PointPlacement::Line`].
    #[serde(default = "default_spacing")]
    pub spacing_px: f32,
}

fn default_true() -> bool {
    true
}

fn default_spacing() -> f32 {
    250.0
}

/// Instructions for parsing the features of a single matched target layer.
///
/// Produced on the main thread by reducing the layer's `Appearance`s to the
/// plain values the geometry walk actually needs.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LayerParseConfig {
    /// Target layer id used for property/tag storage and entity spawning.
    pub layer_id: String,
    /// Whether polyline/polygon geometry should be clamped to the ground
    /// (projected on the tile center instead of geographic coordinates).
    pub flat: bool,
    /// Point-like emitters (Point/Billboard/Text) and their heights.
    pub point_emitters: Vec<PointEmitter>,
    /// Whether a polyline appearance consumes line geometry.
    pub polyline: bool,
    /// Whether the polyline appearance also renders polygon boundary rings
    /// (outer ring and holes) as closed polylines.
    #[serde(default)]
    pub polyline_from_polygons: bool,
    /// Whether a polygon appearance is present.
    pub polygon: bool,
    /// Optional MVT sublayer name filter.
    pub limit_layers: Option<Vec<String>>,
}

impl LayerParseConfig {
    /// Whether this config wants the MVT sublayer with the given name.
    pub fn matches_sublayer(&self, name: &str) -> bool {
        self.limit_layers
            .as_ref()
            .map(|ll| ll.iter().any(|l| l == name))
            .unwrap_or(true)
    }
}
