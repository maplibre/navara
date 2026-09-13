use bevy_ecs::{component::Component, entity::Entity};
use navara_core::{CRS, ElevationDecoder, calc_transform};
use navara_geometry::TileUvTransform;
use navara_math::{Transform, Vec2, Vec3};

/// Configuration for elevation heatmap rendering.
/// Shared across all elevation heatmap layers in a tile.
/// Note: color_map_lut is now stored in Globe.elevation_colormap
#[derive(Debug, Clone, PartialEq)]
pub struct ElevationHeatmapConfig {
    pub max_height: f64,
    pub min_height: f64,

    pub logarithmic: bool,
    pub log_boundary: f64,
}

/// Configuration for hillshade rendering.
/// Computes normals from DEM gradients to fix tile boundary seams.
/// The computed normals are used with existing scene lighting.
#[derive(Debug, Clone, PartialEq)]
pub struct HillshadeConfig {
    /// Exaggeration factor for hillshade effect (default: 1.0)
    /// Higher values make terrain appear more dramatic, lower values flatten it. Recommended range is 0.5 to 2.0.
    pub exaggeration: f32,
}

/// Source geometry category a vector appearance consumes.
///
/// By default an appearance renders only its native geometry (point-like
/// appearances consume [`SourceGeometryType::Point`], polyline consumes
/// [`SourceGeometryType::Line`]). Opting extra entries into a material's
/// `geometry_types` derives additional representations: polygon boundary
/// rings render as polylines, and line/polygon vertices render as points.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceGeometryType {
    Point,
    Line,
    Polygon,
}

impl SourceGeometryType {
    /// Parse the JS-facing name (`"point" | "line" | "polygon"`).
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "point" => Some(Self::Point),
            "line" => Some(Self::Line),
            "polygon" => Some(Self::Polygon),
            _ => None,
        }
    }

    /// JS-facing name of this geometry type.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Point => "point",
            Self::Line => "line",
            Self::Polygon => "polygon",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Appearance {
    Point(PointMaterial),
    Billboard(BillboardMaterial),
    Text(TextMaterial),
    Polyline(PolylineMaterial),
    Polygon(PolygonMaterial),
    Model(ModelMaterial),
    TerrainTile(RasterMaterial),
}

impl Appearance {
    pub fn set(&mut self, appearance: &Appearance) {
        match (self, appearance) {
            (Appearance::Point(dist), Appearance::Point(src)) => {
                *dist = src.clone();
            }
            (Appearance::Billboard(dist), Appearance::Billboard(src)) => {
                *dist = src.clone();
            }
            (Appearance::Text(dist), Appearance::Text(src)) => {
                *dist = src.clone();
            }
            (Appearance::Polyline(dist), Appearance::Polyline(src)) => {
                *dist = src.clone();
            }
            (Appearance::Polygon(dist), Appearance::Polygon(src)) => {
                *dist = src.clone();
            }
            (Appearance::Model(dist), Appearance::Model(src)) => {
                *dist = src.clone();
            }
            (Appearance::TerrainTile(dist), Appearance::TerrainTile(src)) => {
                *dist = src.clone();
            }
            _ => {}
        }
    }

    /// Clone the first model material in `appearances`, falling back to the
    /// default material. Layers can be added without an explicit `model`
    /// material, so consumers must not assume the appearance list contains one.
    pub fn clone_model_or_default(appearances: &[Appearance]) -> ModelMaterial {
        for appearance in appearances {
            if let Appearance::Model(material) = appearance {
                return material.clone();
            }
        }
        ModelMaterial::default()
    }
}

#[derive(Debug, Clone, PartialEq, Component)]
pub struct PointMaterial {
    pub show: bool,
    pub size: f32,
    pub color: u32,
    pub center: Vec2,
    pub height: f32,
    pub size_in_meters: bool,
    pub clamp_to_ground: bool,
    pub depth_test: bool,
    pub offset_depth: bool,
    // Allow transparency and anti-aliasing.
    pub transparent: bool,
    pub opacity: f32,
    /// Participate in screen-space decluttering: when labels/sprites overlap
    /// on screen, lower-priority ones are hidden. Enabled by default; set to
    /// `false` to draw every label unconditionally.
    pub declutter: bool,
    /// Placement priority for decluttering; higher wins. Only meaningful when
    /// `declutter` is enabled.
    pub declutter_priority: f32,
    /// Source geometry types this appearance consumes. Defaults to the native
    /// geometry only; opting in `Line`/`Polygon` also emits a point per
    /// line-string / polygon-ring vertex.
    pub geometry_types: Vec<SourceGeometryType>,
    // post effect
    pub effect_ids: Option<Vec<String>>,
    pub emissive_intensity: Option<f32>,
    pub emissive_color: Option<u32>,
}

impl Default for PointMaterial {
    fn default() -> Self {
        Self {
            show: true,
            size: 0.1,
            color: 0xffffff,
            center: Vec2::new(0.0, 0.),
            clamp_to_ground: true,
            height: 1.,
            size_in_meters: true,
            depth_test: true,
            offset_depth: true,
            transparent: true,
            opacity: 1.0,
            declutter: true,
            declutter_priority: 0.0,
            geometry_types: vec![SourceGeometryType::Point],
            // post effect
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
        }
    }
}

impl PointMaterial {
    pub fn update(&mut self, from: &PointMaterial, transform: &mut Transform) {
        if self.size != from.size {
            transform.scale = Vec3::splat(from.size as f64);
        }
        *self = from.clone();
    }
}

#[derive(Debug, Clone, PartialEq, Component)]
pub struct BillboardMaterial {
    pub show: bool,
    pub size: f32,
    pub color: u32,
    pub center: Vec2,
    pub height: f32,
    pub url: String,
    pub size_in_meters: bool,
    pub clamp_to_ground: bool,
    pub depth_test: bool,
    pub offset_depth: bool,
    // Allow transparency and anti-aliasing.
    pub transparent: bool,
    pub opacity: f32,
    pub alpha_test: f32,
    /// Participate in screen-space decluttering: when labels/sprites overlap
    /// on screen, lower-priority ones are hidden. Enabled by default; set to
    /// `false` to draw every label unconditionally.
    pub declutter: bool,
    /// Placement priority for decluttering; higher wins. Only meaningful when
    /// `declutter` is enabled.
    pub declutter_priority: f32,
    /// Source geometry types this appearance consumes. Defaults to the native
    /// geometry only; opting in `Line`/`Polygon` also emits a billboard per
    /// line-string / polygon-ring vertex.
    pub geometry_types: Vec<SourceGeometryType>,
    // post effect
    pub effect_ids: Option<Vec<String>>,
    pub emissive_intensity: Option<f32>,
    pub emissive_color: Option<u32>,
}

impl Default for BillboardMaterial {
    fn default() -> Self {
        Self {
            show: true,
            size: 0.1,
            color: 0xffffff,
            center: Vec2::new(0.0, 0.),
            clamp_to_ground: true,
            height: 1.,
            url: "".to_string(),
            size_in_meters: true,
            depth_test: true,
            offset_depth: true,
            transparent: false,
            opacity: 1.0,
            alpha_test: 0.1,
            declutter: true,
            declutter_priority: 0.0,
            geometry_types: vec![SourceGeometryType::Point],
            // post effect
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
        }
    }
}

impl BillboardMaterial {
    pub fn update(&mut self, from: &BillboardMaterial, transform: &mut Transform) {
        if self.size != from.size {
            transform.scale = Vec3::splat(from.size as f64);
        }
        *self = from.clone();
    }
}

#[derive(Debug, Clone, PartialEq, Component)]
pub struct TextMaterial {
    pub show: bool,
    pub size: f32,
    pub color: u32,
    pub center: Vec2,
    pub height: f32,
    pub size_in_meters: bool,
    pub clamp_to_ground: bool,
    pub depth_test: bool,
    pub offset_depth: bool,
    pub text: String,
    pub font: String,
    pub background_color: Option<u32>,
    pub border_color: u32,
    pub border_width: f32, // 0 ~ 0.5, the ratio of the border to the height
    // pub corner_radius: f32, // 0 ~ 0.5, the ratio of the corner radius to the height
    // pub padding: Vec2,
    // outline
    // pub outline_blur: f32,    // outlineBlur Defalut:0
    pub outline_color: u32, // outlineColor Defalut:black
    // pub outline_offset: Vec2, // outlineOffset Default: (0,0)
    pub outline_opacity: f32, // outlineOpacity Default:1
    pub outline_width: f32,   // outlineWidth Default:0
    pub lang: String,
    /// Enable high-quality glyph rendering. When `true`, text uses an MTSDF
    /// atlas via `fdsm` — preserves sharp corners at large sizes but per-glyph
    /// cost is dominated by exact distance-to-curve math. When `false` (the
    /// default), single-channel SDF (Felzenszwalb on a fontdue bitmap) is used
    /// — ~100× faster per glyph, slightly soft corners at extreme zoom.
    pub high_quality: bool,

    /// Opacity of the text
    pub opacity: f32,
    /// Enable transparency and alpha blending
    pub transparent: bool,

    /// Maximum line width in ems (multiples of `size`) before text wraps at
    /// word boundaries. `0.0` (the default) disables wrapping; explicit `\n`
    /// characters in `text` always break lines. Em units keep the wrap width
    /// stable whether `size_in_meters` is on or off.
    pub max_width: f32,
    /// Line height as a multiplier of the font's natural line height
    /// (ascender − descender + line gap). Default `1.0`.
    pub line_height: f32,
    /// Horizontal alignment of lines within a multi-line block:
    /// `"left"`, `"center"` (default), or `"right"`.
    pub text_align: String,

    /// Participate in screen-space decluttering: when labels/sprites overlap
    /// on screen, lower-priority ones are hidden. Enabled by default; set to
    /// `false` to draw every label unconditionally.
    pub declutter: bool,
    /// Placement priority for decluttering; higher wins. Only meaningful when
    /// `declutter` is enabled.
    pub declutter_priority: f32,
    /// Source geometry types this appearance consumes. Defaults to the native
    /// geometry only; opting in `Line`/`Polygon` also emits a label per
    /// line-string / polygon-ring vertex.
    pub geometry_types: Vec<SourceGeometryType>,
    // post effect
    pub effect_ids: Option<Vec<String>>,
    pub emissive_intensity: Option<f32>,
    pub emissive_color: Option<u32>,
}

impl Default for TextMaterial {
    fn default() -> Self {
        Self {
            show: true,
            size: 10.0,
            color: 0xffffff,
            center: Vec2::new(0.5, 0.),
            clamp_to_ground: true,
            height: 1.,
            size_in_meters: true,
            depth_test: true,
            offset_depth: true,
            text: "".to_string(),
            font: "".to_string(),
            background_color: None,
            border_color: 0x000000,
            border_width: 0.05,
            // corner_radius: 0.1,
            // padding: Vec2::new(5.0, 2.0),
            // outline_blur: 0.0,
            outline_color: 0x000000,
            // outline_offset: Vec2::new(0.0, 0.0),
            outline_opacity: 1.0,
            outline_width: 0.0,
            lang: "".to_string(),
            high_quality: false,

            opacity: 1.0,
            transparent: true,

            max_width: 0.0,
            line_height: 1.0,
            text_align: "center".to_string(),

            declutter: true,
            declutter_priority: 0.0,
            geometry_types: vec![SourceGeometryType::Point],
            // post effect
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
        }
    }
}

impl TextMaterial {
    pub fn update(&mut self, from: &TextMaterial) {
        *self = from.clone();
    }
}

#[derive(Debug, Clone, PartialEq, Component)]
pub struct PolylineMaterial {
    pub show: bool,
    pub cast_shadow: bool,
    pub receive_shadow: bool,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    pub color: u32,
    pub width: f32,
    pub max_width: f32,
    pub clamp_to_ground: bool,
    pub tiled: bool,
    pub height: f32,
    /// Source geometry types this appearance consumes. Defaults to the native
    /// geometry only; opting in `Polygon` also renders polygon boundary rings
    /// (outer ring and holes) as closed polylines at the ring's base height —
    /// `extruded_height` edges stay the polygon material's `outline` feature.
    pub geometry_types: Vec<SourceGeometryType>,
    pub internal: Option<PolylineInternalMaterial>,
    // post effect
    pub effect_ids: Option<Vec<String>>,
    pub emissive_intensity: Option<f32>,
    pub emissive_color: Option<u32>,
    /// Enable transparency and alpha blending
    pub transparent: bool,
    /// Opacity value
    pub opacity: f32,
    /// Enable writing to depth buffer
    pub depth_write: bool,
}

impl Default for PolylineMaterial {
    fn default() -> Self {
        Self {
            show: true,
            cast_shadow: false,
            receive_shadow: false,
            lit: None,
            color: 0xffffff,
            width: 1.,
            max_width: 10000.,
            clamp_to_ground: true,
            tiled: false,
            height: 1.,
            geometry_types: vec![SourceGeometryType::Line],
            internal: None,
            // post effect
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
            transparent: false,
            opacity: 1.0,
            depth_write: true,
        }
    }
}

impl PolylineMaterial {
    pub fn update(&mut self, from: &PolylineMaterial) {
        let internal = self.internal.take();
        *self = from.clone();
        self.internal = internal;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PolylineInternalMaterial {
    pub min_max_heights: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Component)]
pub struct PolygonMaterial {
    pub show: bool,
    pub cast_shadow: bool,
    pub receive_shadow: bool,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    pub color: u32,
    pub clamp_to_ground: bool,
    pub tiled: bool,
    pub height: f32,
    pub extruded_height: Option<f32>,
    pub wireframe: bool,
    pub reflectivity: f32,
    pub roughness: f32,
    pub internal: Option<PolygonInternalMaterial>,
    pub per_position_height: bool,
    pub opacity: f32,
    pub transparent: bool,

    pub surface_show: bool,
    pub outline: bool,
    pub outline_show: bool,
    pub outline_color: u32,
    pub outline_width: f32,

    pub water: bool,
    pub water_scale_normal: f32,
    pub water_speed: f32,
    pub shininess: f32,
    pub specular_strength: f32,
    pub apply_water_normal: bool,
    pub specular: bool,
    pub ior: f32,
    // post effect
    pub effect_ids: Option<Vec<String>>,
    pub emissive_intensity: Option<f32>,
    pub emissive_color: Option<u32>,
}

impl Default for PolygonMaterial {
    fn default() -> Self {
        Self {
            show: true,
            cast_shadow: false,
            receive_shadow: false,
            lit: None,
            color: 0xffffff,
            clamp_to_ground: true,
            tiled: false,
            height: 1.,
            extruded_height: None,
            wireframe: false,
            reflectivity: 0.0,
            roughness: 0.0,
            internal: None,
            per_position_height: false,
            opacity: 1.0,
            transparent: false,

            surface_show: true,
            outline: false,
            outline_show: false,
            outline_color: 0xffffff,
            outline_width: 1.,

            water: false,
            water_scale_normal: 0.1,
            water_speed: 0.0003,
            shininess: 100.0,
            specular_strength: 2.0,
            apply_water_normal: false,
            specular: false,
            ior: 1.33333,

            // post effect
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
        }
    }
}

impl PolygonMaterial {
    pub fn update(&mut self, from: &PolygonMaterial) {
        let internal = self.internal.clone();
        *self = from.clone();
        self.internal = internal;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PolygonInternalMaterial {
    pub min_max_heights: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Component)]
pub struct ModelMaterial {
    pub show: bool,
    pub cast_shadow: bool,
    pub receive_shadow: bool,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    pub url: String,
    pub size: f32,
    pub height: f32,
    pub should_rotate_in_default: bool,
    pub max_sse: f32,
    pub color: u32,
    pub metalness: f32,
    pub roughness: f32,
    pub reflectivity: f32,
    pub water: bool,
    pub water_scale_normal: f32,
    pub water_speed: f32,
    pub shininess: f32,
    pub specular_strength: f32,
    pub apply_water_normal: bool,
    pub specular: bool,
    pub ior: f32,
    // animation
    pub animation_active_clip: Option<String>,
    pub animation_speed: Option<f32>,
    pub point_size: f32,
    pub show_bounding_box: bool,
    /// When true, recompute vertex normals using a creased-normals algorithm
    /// after the model loads. Useful for tiled glTF assets that ship without
    /// normals or with low-quality normals.
    pub normals: bool,
    /// Crease angle (in radians) used when `normals` is true. `None` lets the
    /// renderer pick its default (currently 30° / PI/6).
    pub crease_normal_angle: Option<f32>,
    pub internal: Option<ModelInternalMaterial>,
    // post effect
    pub effect_ids: Option<Vec<String>>,
    pub emissive_intensity: Option<f32>,
    pub emissive_color: Option<u32>,
    /// Enable transparency and alpha blending
    pub transparent: bool,
    /// Opacity value
    pub opacity: f32,
    /// Enable writing to depth buffer
    pub depth_write: bool,
}

impl Default for ModelMaterial {
    fn default() -> Self {
        Self {
            show: true,
            cast_shadow: false,
            receive_shadow: false,
            lit: None,
            size: 1.,
            height: 1.,
            url: "".to_string(),
            should_rotate_in_default: true,
            max_sse: 8.,
            color: 0xffffff,
            metalness: 0.0,
            roughness: 1.0,
            reflectivity: 0.0,
            water: false,
            water_scale_normal: 0.01,
            water_speed: 0.0003,
            shininess: 100.0,
            specular_strength: 2.0,
            apply_water_normal: false,
            specular: false,
            ior: 1.33333,
            // animation
            animation_active_clip: None,
            animation_speed: None,
            point_size: 0.3,
            show_bounding_box: false,
            normals: false,
            crease_normal_angle: None,
            internal: None,
            // post effect
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
            transparent: false,
            opacity: 1.0,
            depth_write: true,
        }
    }
}

impl ModelMaterial {
    pub fn update(
        &mut self,
        from: &ModelMaterial,
        coordinates: &Vec3,
        crs: &CRS,
        transform: &mut Transform,
    ) {
        let should_update_transform = self.height != from.height
            || self.size != from.size
            || self.should_rotate_in_default != from.should_rotate_in_default;
        *self = from.clone();

        if should_update_transform {
            *transform = calc_transform(
                coordinates,
                crs,
                self.height,
                self.size,
                self.should_rotate_in_default,
            );
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelInternalMaterial {
    pub point_cloud: bool,
    pub draco_compressed: bool,
    pub point_cloud_geodetic_normal: Vec3,
}

/// Render-only appearance for a `raster` layer's imagery. All fetch/tiling
/// config lives on the referenced `Source`.
#[derive(Debug, Clone, PartialEq, Component)]
pub struct RasterMaterial {
    pub show: bool,
    pub color: u32,
    pub opacity: f32,
    pub show_bounding_box: bool,
}

impl Default for RasterMaterial {
    fn default() -> Self {
        Self {
            show: true,
            color: 0xffffff,
            opacity: 1.,
            show_bounding_box: false,
        }
    }
}

/// This is used to handle each tile's style in uniforms.
#[derive(Debug, Clone, PartialEq, Component, Default)]
pub struct RasterTileInternalMaterial {
    pub shows: Vec<bool>,
    pub colors: Vec<u32>,
    pub opacities: Vec<f32>,
    pub texture_fragments: Option<Vec<Option<Entity>>>,
    pub cast_shadow: Option<bool>,
    pub receive_shadow: Option<bool>,
    pub lit: Option<bool>,
    pub show_bounding_box: Option<bool>,

    // Elevation Heatmap fields
    pub is_elevation_heatmaps: Vec<bool>, // Per-layer flags: which texture slots are elevation heatmaps
    pub elevation_heatmap_config: Option<ElevationHeatmapConfig>, // Shared config for all heatmap layers
    /// DEM decoder for the heatmap's source, resolved live from the referenced
    /// `Source` at material-build time (not stored on the layer config). `None`
    /// when there is no heatmap or the source isn't a raster-dem.
    pub heatmap_elevation_decoder: Option<ElevationDecoder>,

    // Hillshade fields
    pub is_hillshades: Vec<bool>, // Per-layer flags: which texture slots are hillshades
    pub hillshade_config: Option<HillshadeConfig>, // Shared config for all hillshade layers
    /// DEM decoder for the hillshade's source, resolved live from the referenced
    /// `Source` at material-build time (not stored on the layer config). `None`
    /// when there is no hillshade or the source isn't a raster-dem.
    pub hillshade_elevation_decoder: Option<ElevationDecoder>,

    /// Per-layer UV transform used when this layer's slot samples a parent tile's data.
    /// `None` means identity (own tile's data is in use). Length matches `texture_fragments`
    /// and other per-layer vectors. Covers both regular texture layers and hillshade layers.
    pub layer_uv_transforms: Vec<Option<TileUvTransform>>,

    /// Per-slot flag: the slot is a WebMercator raster draped on a Geographic
    /// (e.g. quantized-mesh) terrain tile, so the composite shader must reproject
    /// its latitude (Mercator) instead of using the linear affine UV. Length
    /// matches the other per-slot vectors.
    pub layer_reproject: Vec<bool>,
    /// The terrain tile's `(south, north)` latitude in radians, used by the
    /// composite shader to reproject `layer_reproject` slots. `None` when no slot
    /// needs reprojection (WebMercator terrain).
    pub terrain_lat_range: Option<[f32; 2]>,
}

/// Render-only appearance for a `terrain` layer's mesh, regardless of the
/// referenced source's data format (raster-dem, quantized-mesh, or the
/// source-less ellipsoid). All fetch/geometry config lives on the referenced
/// `Source`; the data format itself is carried by `TerrainDataType`.
#[derive(Debug, Clone, PartialEq, Component)]
pub struct TerrainMaterial {
    pub show: bool,
    pub cast_shadow: bool,
    pub receive_shadow: bool,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    pub show_bounding_box: bool,
    /// Whether to render skirts along tile boundaries to hide gaps.
    pub skirt: bool,
    /// Multiplier for the automatically calculated skirt height.
    /// A value of 1.0 uses the default calculated height.
    pub skirt_exaggeration: f32,
}

impl Default for TerrainMaterial {
    fn default() -> Self {
        Self {
            show: true,
            cast_shadow: false,
            receive_shadow: false,
            lit: None,
            show_bounding_box: false,
            skirt: true,
            skirt_exaggeration: 1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clone_model_or_default_returns_the_model_material() {
        let material = ModelMaterial {
            max_sse: 42.,
            ..Default::default()
        };
        let appearances = vec![
            Appearance::Point(PointMaterial::default()),
            Appearance::Model(material.clone()),
        ];
        assert_eq!(Appearance::clone_model_or_default(&appearances), material);
    }

    #[test]
    fn clone_model_or_default_falls_back_when_model_is_missing() {
        // A layer added without an explicit `model` material has an empty
        // appearance list; consumers must get the default instead of panicking.
        assert_eq!(
            Appearance::clone_model_or_default(&[]),
            ModelMaterial::default()
        );
        assert_eq!(
            Appearance::clone_model_or_default(&[Appearance::Point(PointMaterial::default())]),
            ModelMaterial::default()
        );
    }
}
