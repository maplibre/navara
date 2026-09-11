use navara_wasm_utils::ToU8;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::{TextureFragment, TileUvTransform, Vec2, Vec3 as WasmVec3};

/// Parse the JS-facing `geometryTypes` names into typed values. The given
/// array always replaces the material default, matching the Rust-level
/// contract: an explicitly empty array means "consume no geometry". Unknown
/// names are dropped with a warning, and a warning also fires when dropping
/// them empties a non-empty list, since that silences the whole appearance.
fn parse_geometry_types(
    value: &Option<Vec<String>>,
) -> Option<Vec<navara_material::SourceGeometryType>> {
    let list = value.as_ref()?;
    let mut parsed = Vec::with_capacity(list.len());
    for name in list {
        match navara_material::SourceGeometryType::parse(name) {
            Some(t) => parsed.push(t),
            None => bevy_log::warn!(
                "geometryTypes: unknown geometry type {name:?} (expected \"point\", \"line\" or \"polygon\")"
            ),
        }
    }
    if parsed.is_empty() && !list.is_empty() {
        bevy_log::warn!(
            "geometryTypes: no valid geometry types remain in {list:?}; the appearance consumes no geometry"
        );
    }
    Some(parsed)
}

/// Inverse of [`parse_geometry_types`] for the material→wasm direction.
fn geometry_type_names(value: &[navara_material::SourceGeometryType]) -> Vec<String> {
    value.iter().map(|t| t.as_str().to_string()).collect()
}
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointMaterial {
    pub show: Option<bool>,
    /// size in pixels/meters (units are determined by `sizeInMeters`).
    pub size: Option<f32>,
    pub color: Option<u32>,
    /// anchor point of the sprite, range is (-0.5, -0.5) to (0.5, 0.5).
    /// Default is (0.0, 0.0) which means the center of the sprite.
    pub center: Option<Vec2>,
    pub height: Option<f32>,
    #[wasm_bindgen(js_name = sizeInMeters)]
    #[serde(rename = "sizeInMeters")]
    /// Whether the size is specified in meters. If false, the size is in pixels. Default is true.
    pub size_in_meters: Option<bool>,
    #[wasm_bindgen(js_name = clampToGround)]
    #[serde(rename = "clampToGround")]
    pub clamp_to_ground: Option<bool>,
    #[wasm_bindgen(js_name = depthTest)]
    #[serde(rename = "depthTest")]
    pub depth_test: Option<bool>,
    /// Avoid overlapping with the globe surface.
    #[wasm_bindgen(js_name = offsetDepth)]
    #[serde(rename = "offsetDepth")]
    pub offset_depth: Option<bool>,
    pub transparent: Option<bool>,
    pub opacity: Option<f32>,
    /// Participate in screen-space decluttering: when labels/sprites overlap
    /// on screen, lower-priority ones are hidden. Defaults to `true`; set to
    /// `false` to draw every label unconditionally.
    pub declutter: Option<bool>,
    /// Placement priority for decluttering; higher wins. Only meaningful when
    /// `declutter` is enabled. Defaults to `0.0`.
    #[wasm_bindgen(js_name = declutterPriority)]
    #[serde(rename = "declutterPriority")]
    pub declutter_priority: Option<f32>,
    /// Source geometry types this appearance consumes: `"point"`, `"line"`,
    /// `"polygon"`. Defaults to `["point"]`; adding `"line"`/`"polygon"` also
    /// emits a point per line-string / polygon-ring vertex.
    #[wasm_bindgen(getter_with_clone, js_name = geometryTypes)]
    #[serde(rename = "geometryTypes")]
    pub geometry_types: Option<Vec<String>>,
    // SelectiveEffect
    /// IDs of selective effects to apply (e.g., "bloom", "outline")
    #[wasm_bindgen(getter_with_clone, js_name = effectIds)]
    #[serde(rename = "effectIds")]
    pub effect_ids: Option<Vec<String>>,
    /// Emissive glow intensity (omitted = 0, no emissive output)
    #[wasm_bindgen(js_name = emissiveIntensity)]
    #[serde(rename = "emissiveIntensity")]
    pub emissive_intensity: Option<f32>,
    /// Emissive glow color in 0xRRGGBB format
    #[wasm_bindgen(js_name = emissiveColor)]
    #[serde(rename = "emissiveColor")]
    pub emissive_color: Option<u32>,
}

impl From<PointMaterial> for navara_material::PointMaterial {
    fn from(val: PointMaterial) -> Self {
        let default = navara_material::PointMaterial::default();
        navara_material::PointMaterial {
            show: val.show.unwrap_or(default.show),
            size: val.size.unwrap_or(default.size),
            color: val.color.unwrap_or(default.color),
            center: val.center.unwrap_or(default.center.into()).into(),
            height: val.height.unwrap_or(default.height),
            size_in_meters: val.size_in_meters.unwrap_or(default.size_in_meters),
            clamp_to_ground: val.clamp_to_ground.unwrap_or(default.clamp_to_ground),
            depth_test: val.depth_test.unwrap_or(default.depth_test),
            offset_depth: val.offset_depth.unwrap_or(default.offset_depth),
            transparent: val.transparent.unwrap_or(default.transparent),
            opacity: val.opacity.unwrap_or(default.opacity),
            declutter: val.declutter.unwrap_or(default.declutter),
            declutter_priority: val.declutter_priority.unwrap_or(default.declutter_priority),
            geometry_types: parse_geometry_types(&val.geometry_types)
                .unwrap_or(default.geometry_types),
            effect_ids: val.effect_ids.or(default.effect_ids),
            emissive_intensity: val.emissive_intensity.or(default.emissive_intensity),
            emissive_color: val.emissive_color.or(default.emissive_color),
        }
    }
}
impl<'a> From<&'a navara_material::PointMaterial> for PointMaterial {
    fn from(value: &'a navara_material::PointMaterial) -> PointMaterial {
        PointMaterial {
            show: Some(value.show),
            size: Some(value.size),
            color: Some(value.color),
            center: Some(value.center.into()),
            height: Some(value.height),
            size_in_meters: Some(value.size_in_meters),
            clamp_to_ground: Some(value.clamp_to_ground),
            depth_test: Some(value.depth_test),
            offset_depth: Some(value.offset_depth),
            transparent: Some(value.transparent),
            opacity: Some(value.opacity),
            declutter: Some(value.declutter),
            declutter_priority: Some(value.declutter_priority),
            geometry_types: Some(geometry_type_names(&value.geometry_types)),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
        }
    }
}

impl PointMaterial {
    pub fn merge(&self, other: &navara_material::PointMaterial) -> navara_material::PointMaterial {
        navara_material::PointMaterial {
            show: self.show.unwrap_or(other.show),
            size: self.size.unwrap_or(other.size),
            color: self.color.unwrap_or(other.color),
            center: self.center.unwrap_or(other.center.into()).into(),
            height: self.height.unwrap_or(other.height),
            size_in_meters: self.size_in_meters.unwrap_or(other.size_in_meters),
            clamp_to_ground: self.clamp_to_ground.unwrap_or(other.clamp_to_ground),
            depth_test: self.depth_test.unwrap_or(other.depth_test),
            offset_depth: self.offset_depth.unwrap_or(other.offset_depth),
            transparent: self.transparent.unwrap_or(other.transparent),
            opacity: self.opacity.unwrap_or(other.opacity),
            declutter: self.declutter.unwrap_or(other.declutter),
            declutter_priority: self.declutter_priority.unwrap_or(other.declutter_priority),
            geometry_types: parse_geometry_types(&self.geometry_types)
                .unwrap_or_else(|| other.geometry_types.clone()),
            effect_ids: self.effect_ids.clone().or_else(|| other.effect_ids.clone()),
            emissive_intensity: self.emissive_intensity.or(other.emissive_intensity),
            emissive_color: self.emissive_color.or(other.emissive_color),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearFar {
    pub near: f32,
    pub far: f32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillboardMaterial {
    pub show: Option<bool>,
    /// size in pixels/meters (units are determined by `sizeInMeters`).
    pub size: Option<f32>,
    pub color: Option<u32>,
    /// anchor point of the sprite, range is (-0.5, -0.5) to (0.5, 0.5).
    /// Default is (0.0, 0.0) which means the center of the sprite.
    pub center: Option<Vec2>,
    pub height: Option<f32>,
    #[wasm_bindgen(getter_with_clone)]
    pub url: Option<String>,
    #[wasm_bindgen(js_name = sizeInMeters)]
    #[serde(rename = "sizeInMeters")]
    /// Whether the size is specified in meters. If false, the size is in pixels. Default is true.
    pub size_in_meters: Option<bool>,
    #[wasm_bindgen(js_name = clampToGround)]
    #[serde(rename = "clampToGround")]
    pub clamp_to_ground: Option<bool>,
    #[wasm_bindgen(js_name = depthTest)]
    #[serde(rename = "depthTest")]
    pub depth_test: Option<bool>,
    /// Avoid overlapping with the globe surface.
    #[wasm_bindgen(js_name = offsetDepth)]
    #[serde(rename = "offsetDepth")]
    pub offset_depth: Option<bool>,
    pub transparent: Option<bool>,
    pub opacity: Option<f32>,
    #[wasm_bindgen(js_name = alphaTest)]
    #[serde(rename = "alphaTest")]
    pub alpha_test: Option<f32>,
    /// Participate in screen-space decluttering: when labels/sprites overlap
    /// on screen, lower-priority ones are hidden. Defaults to `true`; set to
    /// `false` to draw every label unconditionally.
    pub declutter: Option<bool>,
    /// Placement priority for decluttering; higher wins. Only meaningful when
    /// `declutter` is enabled. Defaults to `0.0`.
    #[wasm_bindgen(js_name = declutterPriority)]
    #[serde(rename = "declutterPriority")]
    pub declutter_priority: Option<f32>,
    /// Source geometry types this appearance consumes: `"point"`, `"line"`,
    /// `"polygon"`. Defaults to `["point"]`; adding `"line"`/`"polygon"` also
    /// emits a billboard per line-string / polygon-ring vertex.
    #[wasm_bindgen(getter_with_clone, js_name = geometryTypes)]
    #[serde(rename = "geometryTypes")]
    pub geometry_types: Option<Vec<String>>,
    // SelectiveEffect
    /// IDs of selective effects to apply (e.g., "bloom", "outline")
    #[wasm_bindgen(getter_with_clone, js_name = effectIds)]
    #[serde(rename = "effectIds")]
    pub effect_ids: Option<Vec<String>>,
    /// Emissive glow intensity (omitted = 0, no emissive output)
    #[wasm_bindgen(js_name = emissiveIntensity)]
    #[serde(rename = "emissiveIntensity")]
    pub emissive_intensity: Option<f32>,
    /// Emissive glow color in 0xRRGGBB format
    #[wasm_bindgen(js_name = emissiveColor)]
    #[serde(rename = "emissiveColor")]
    pub emissive_color: Option<u32>,
}

impl From<BillboardMaterial> for navara_material::BillboardMaterial {
    fn from(val: BillboardMaterial) -> Self {
        let default = navara_material::BillboardMaterial::default();
        navara_material::BillboardMaterial {
            show: val.show.unwrap_or(default.show),
            size: val.size.unwrap_or(default.size),
            color: val.color.unwrap_or(default.color),
            center: val.center.unwrap_or(default.center.into()).into(),
            height: val.height.unwrap_or(default.height),
            url: val.url.unwrap_or(default.url),
            size_in_meters: val.size_in_meters.unwrap_or(default.size_in_meters),
            clamp_to_ground: val.clamp_to_ground.unwrap_or(default.clamp_to_ground),
            depth_test: val.depth_test.unwrap_or(default.depth_test),
            offset_depth: val.offset_depth.unwrap_or(default.offset_depth),
            transparent: val.transparent.unwrap_or(default.transparent),
            opacity: val.opacity.unwrap_or(default.opacity),
            alpha_test: val.alpha_test.unwrap_or(default.alpha_test),
            declutter: val.declutter.unwrap_or(default.declutter),
            declutter_priority: val.declutter_priority.unwrap_or(default.declutter_priority),
            geometry_types: parse_geometry_types(&val.geometry_types)
                .unwrap_or(default.geometry_types),
            effect_ids: val.effect_ids.or(default.effect_ids),
            emissive_intensity: val.emissive_intensity.or(default.emissive_intensity),
            emissive_color: val.emissive_color.or(default.emissive_color),
        }
    }
}
impl<'a> From<&'a navara_material::BillboardMaterial> for BillboardMaterial {
    fn from(value: &'a navara_material::BillboardMaterial) -> BillboardMaterial {
        BillboardMaterial {
            show: Some(value.show),
            size: Some(value.size),
            color: Some(value.color),
            center: Some(value.center.into()),
            height: Some(value.height),
            url: Some(value.url.clone()),
            size_in_meters: Some(value.size_in_meters),
            clamp_to_ground: Some(value.clamp_to_ground),
            depth_test: Some(value.depth_test),
            offset_depth: Some(value.offset_depth),
            transparent: Some(value.transparent),
            opacity: Some(value.opacity),
            alpha_test: Some(value.alpha_test),
            declutter: Some(value.declutter),
            declutter_priority: Some(value.declutter_priority),
            geometry_types: Some(geometry_type_names(&value.geometry_types)),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
        }
    }
}

impl BillboardMaterial {
    pub fn merge(
        &self,
        other: &navara_material::BillboardMaterial,
    ) -> navara_material::BillboardMaterial {
        navara_material::BillboardMaterial {
            show: self.show.unwrap_or(other.show),
            size: self.size.unwrap_or(other.size),
            color: self.color.unwrap_or(other.color),
            center: self.center.unwrap_or(other.center.into()).into(),
            height: self.height.unwrap_or(other.height),
            url: self.url.clone().unwrap_or(other.url.clone()),
            size_in_meters: self.size_in_meters.unwrap_or(other.size_in_meters),
            clamp_to_ground: self.clamp_to_ground.unwrap_or(other.clamp_to_ground),
            depth_test: self.depth_test.unwrap_or(other.depth_test),
            offset_depth: self.offset_depth.unwrap_or(other.offset_depth),
            transparent: self.transparent.unwrap_or(other.transparent),
            opacity: self.opacity.unwrap_or(other.opacity),
            alpha_test: self.alpha_test.unwrap_or(other.alpha_test),
            declutter: self.declutter.unwrap_or(other.declutter),
            declutter_priority: self.declutter_priority.unwrap_or(other.declutter_priority),
            geometry_types: parse_geometry_types(&self.geometry_types)
                .unwrap_or_else(|| other.geometry_types.clone()),
            effect_ids: self.effect_ids.clone().or_else(|| other.effect_ids.clone()),
            emissive_intensity: self.emissive_intensity.or(other.emissive_intensity),
            emissive_color: self.emissive_color.or(other.emissive_color),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextMaterial {
    pub show: Option<bool>,
    /// size in pixels/meters (units are determined by `sizeInMeters`).
    pub size: Option<f32>,
    pub color: Option<u32>,
    pub center: Option<Vec2>,
    pub height: Option<f32>,
    /// Whether the size is specified in meters. If false, the size is in pixels. Default is true.
    #[wasm_bindgen(js_name = sizeInMeters)]
    #[serde(rename = "sizeInMeters")]
    pub size_in_meters: Option<bool>,
    #[wasm_bindgen(js_name = clampToGround)]
    #[serde(rename = "clampToGround")]
    pub clamp_to_ground: Option<bool>,
    #[wasm_bindgen(js_name = depthTest)]
    #[serde(rename = "depthTest")]
    pub depth_test: Option<bool>,
    /// Avoid overlapping with the globe surface.
    #[wasm_bindgen(js_name = offsetDepth)]
    #[serde(rename = "offsetDepth")]
    pub offset_depth: Option<bool>,
    #[wasm_bindgen(getter_with_clone)]
    pub text: Option<String>,
    /// Specifies either the URL of a single font file or the `family` name of a font family
    /// previously registered with `view.addFontFamily()`. Supported file formats are ttf, otf,
    /// woff, and woff2.
    ///
    /// When a family name is used, only the face files whose unicode ranges cover the characters
    /// in `text` are fetched, so large scripts (CJK, etc.) can be split into multiple faces and
    /// loaded on demand. For each codepoint, the first face (in `faces` order) whose
    /// `unicodeRanges` contain the codepoint is used; codepoints not covered by any face fall
    /// back to the first face, which may therefore be downloaded even for characters outside its
    /// declared ranges.
    ///
    /// Defaults to `None`: no font is loaded, and the text layer will not render until a font
    /// is specified.
    #[wasm_bindgen(getter_with_clone)]
    pub font: Option<String>,
    #[wasm_bindgen(js_name = backgroundColor)]
    #[serde(rename = "backgroundColor")]
    pub background_color: Option<u32>,
    #[wasm_bindgen(js_name = borderColor)]
    #[serde(rename = "borderColor")]
    pub border_color: Option<u32>,
    #[wasm_bindgen(js_name = borderWidth)]
    #[serde(rename = "borderWidth")]
    pub border_width: Option<f32>,
    // TODO: support cornerRadius and padding later
    // #[wasm_bindgen(js_name = cornerRadius)]
    // #[serde(rename = "cornerRadius")]
    // pub corner_radius: Option<f32>,
    // pub padding: Option<Vec2>,
    // outline
    // TODO: support outlineBlur and outlineOffset later.
    /// Outline blur radius in CSS pixels. Defaults to `0.0`.
    // #[wasm_bindgen(js_name = outlineBlur)]
    // #[serde(rename = "outlineBlur")]
    // pub outline_blur: Option<f32>,
    #[wasm_bindgen(js_name = outlineColor)]
    #[serde(rename = "outlineColor")]
    pub outline_color: Option<u32>, // outlineColor Defalut:black
    // TODO: support outlineOffset later.
    /// Pixel offset `[x, y]` in CSS pixels. Defaults to `(0.0, 0.0)`.
    // #[wasm_bindgen(js_name = outlineOffset)]
    // #[serde(rename = "outlineOffset")]
    // pub outline_offset: Option<Vec2>,
    #[wasm_bindgen(js_name = outlineOpacity)]
    #[serde(rename = "outlineOpacity")]
    pub outline_opacity: Option<f32>, // outlineOpacity Default:1
    /// Outline thickness measured in CSS pixels. Defaults to `0.0`.
    #[wasm_bindgen(js_name = outlineWidth)]
    #[serde(rename = "outlineWidth")]
    pub outline_width: Option<f32>,
    /// Language code for text shaping (e.g., "en", "ja", "ar"). Used for proper text rendering.
    #[wasm_bindgen(getter_with_clone)]
    pub lang: Option<String>,
    /// Enable high-quality glyph rendering. When `true`, text uses an MTSDF
    /// atlas (sharper corners at large sizes, dramatically slower
    /// rasterization). When `false` or omitted, the default single-channel SDF
    /// atlas is used (fast). Mirrors `navara_material::TextMaterial::high_quality`
    /// on the Rust side.
    #[wasm_bindgen(js_name = highQuality)]
    #[serde(rename = "highQuality")]
    pub high_quality: Option<bool>,

    /// Opacity of the text
    pub opacity: Option<f32>,
    /// Enable transparency and alpha blending
    pub transparent: Option<bool>,

    /// Maximum line width in ems (multiples of `size`) before text wraps at
    /// word boundaries. `0.0` (the default) disables wrapping; explicit `\n`
    /// characters in `text` always break lines.
    #[wasm_bindgen(js_name = maxWidth)]
    #[serde(rename = "maxWidth")]
    pub max_width: Option<f32>,
    /// Line height as a multiplier of the font's natural line height
    /// (ascender − descender + line gap). Defaults to `1.0`.
    #[wasm_bindgen(js_name = lineHeight)]
    #[serde(rename = "lineHeight")]
    pub line_height: Option<f32>,
    /// Horizontal alignment of lines within a multi-line block:
    /// `"left"`, `"center"` (default), or `"right"`.
    #[wasm_bindgen(getter_with_clone, js_name = textAlign)]
    #[serde(rename = "textAlign")]
    pub text_align: Option<String>,

    /// Participate in screen-space decluttering: when labels/sprites overlap
    /// on screen, lower-priority ones are hidden. Defaults to `true`; set to
    /// `false` to draw every label unconditionally.
    pub declutter: Option<bool>,
    /// Placement priority for decluttering; higher wins. Only meaningful when
    /// `declutter` is enabled. Defaults to `0.0`.
    #[wasm_bindgen(js_name = declutterPriority)]
    #[serde(rename = "declutterPriority")]
    pub declutter_priority: Option<f32>,
    /// Source geometry types this appearance consumes: `"point"`, `"line"`,
    /// `"polygon"`. Defaults to `["point"]`; adding `"line"`/`"polygon"` also
    /// emits a label per line-string / polygon-ring vertex.
    #[wasm_bindgen(getter_with_clone, js_name = geometryTypes)]
    #[serde(rename = "geometryTypes")]
    pub geometry_types: Option<Vec<String>>,
    // SelectiveEffect
    /// IDs of selective effects to apply (e.g., "bloom", "outline")
    #[wasm_bindgen(getter_with_clone, js_name = effectIds)]
    #[serde(rename = "effectIds")]
    pub effect_ids: Option<Vec<String>>,
    /// Emissive glow intensity (omitted = 0, no emissive output)
    #[wasm_bindgen(js_name = emissiveIntensity)]
    #[serde(rename = "emissiveIntensity")]
    pub emissive_intensity: Option<f32>,
    /// Emissive glow color in 0xRRGGBB format
    #[wasm_bindgen(js_name = emissiveColor)]
    #[serde(rename = "emissiveColor")]
    pub emissive_color: Option<u32>,
}

impl From<TextMaterial> for navara_material::TextMaterial {
    fn from(val: TextMaterial) -> Self {
        let default = navara_material::TextMaterial::default();
        navara_material::TextMaterial {
            show: val.show.unwrap_or(default.show),
            size: val.size.unwrap_or(default.size),
            color: val.color.unwrap_or(default.color),
            center: val.center.unwrap_or(default.center.into()).into(),
            height: val.height.unwrap_or(default.height),
            size_in_meters: val.size_in_meters.unwrap_or(default.size_in_meters),
            clamp_to_ground: val.clamp_to_ground.unwrap_or(default.clamp_to_ground),
            depth_test: val.depth_test.unwrap_or(default.depth_test),
            offset_depth: val.offset_depth.unwrap_or(default.offset_depth),
            text: val.text.unwrap_or(default.text),
            font: val.font.unwrap_or(default.font),
            background_color: val.background_color,
            border_color: val.border_color.unwrap_or(default.border_color),
            border_width: val.border_width.unwrap_or(default.border_width),
            // corner_radius: val.corner_radius.unwrap_or(default.corner_radius),
            // padding: val.padding.unwrap_or(default.padding.into()).into(),
            // outline_blur: val.outline_blur.unwrap_or(default.outline_blur),
            outline_color: val.outline_color.unwrap_or(default.outline_color),
            // outline_offset: val
            //     .outline_offset
            //     .unwrap_or(default.outline_offset.into())
            //     .into(),
            outline_opacity: val.outline_opacity.unwrap_or(default.outline_opacity),
            outline_width: val.outline_width.unwrap_or(default.outline_width),
            lang: val.lang.unwrap_or(default.lang),
            high_quality: val.high_quality.unwrap_or(default.high_quality),

            opacity: val.opacity.unwrap_or(default.opacity),
            transparent: val.transparent.unwrap_or(default.transparent),

            max_width: val.max_width.unwrap_or(default.max_width),
            line_height: val.line_height.unwrap_or(default.line_height),
            text_align: val.text_align.unwrap_or(default.text_align),

            declutter: val.declutter.unwrap_or(default.declutter),
            declutter_priority: val.declutter_priority.unwrap_or(default.declutter_priority),
            geometry_types: parse_geometry_types(&val.geometry_types)
                .unwrap_or(default.geometry_types),
            effect_ids: val.effect_ids.or(default.effect_ids),
            emissive_intensity: val.emissive_intensity.or(default.emissive_intensity),
            emissive_color: val.emissive_color.or(default.emissive_color),
        }
    }
}
impl<'a> From<&'a navara_material::TextMaterial> for TextMaterial {
    fn from(value: &'a navara_material::TextMaterial) -> TextMaterial {
        TextMaterial {
            show: Some(value.show),
            size: Some(value.size),
            color: Some(value.color),
            center: Some(value.center.into()),
            height: Some(value.height),
            size_in_meters: Some(value.size_in_meters),
            clamp_to_ground: Some(value.clamp_to_ground),
            depth_test: Some(value.depth_test),
            offset_depth: Some(value.offset_depth),
            text: Some(value.text.clone()),
            font: Some(value.font.clone()),
            background_color: value.background_color,
            border_color: Some(value.border_color),
            border_width: Some(value.border_width),
            // corner_radius: Some(value.corner_radius),
            // padding: Some(value.padding.into()),
            // outline_blur: Some(value.outline_blur),
            outline_color: Some(value.outline_color),
            // outline_offset: Some(value.outline_offset.into()),
            outline_opacity: Some(value.outline_opacity),
            outline_width: Some(value.outline_width),
            lang: Some(value.lang.clone()),
            high_quality: Some(value.high_quality),

            opacity: Some(value.opacity),
            transparent: Some(value.transparent),

            max_width: Some(value.max_width),
            line_height: Some(value.line_height),
            text_align: Some(value.text_align.clone()),

            declutter: Some(value.declutter),
            declutter_priority: Some(value.declutter_priority),
            geometry_types: Some(geometry_type_names(&value.geometry_types)),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
        }
    }
}

impl TextMaterial {
    pub fn merge(&self, other: &navara_material::TextMaterial) -> navara_material::TextMaterial {
        navara_material::TextMaterial {
            show: self.show.unwrap_or(other.show),
            size: self.size.unwrap_or(other.size),
            color: self.color.unwrap_or(other.color),
            center: self.center.unwrap_or(other.center.into()).into(),
            height: self.height.unwrap_or(other.height),
            size_in_meters: self.size_in_meters.unwrap_or(other.size_in_meters),
            clamp_to_ground: self.clamp_to_ground.unwrap_or(other.clamp_to_ground),
            depth_test: self.depth_test.unwrap_or(other.depth_test),
            offset_depth: self.offset_depth.unwrap_or(other.offset_depth),
            text: self.text.clone().unwrap_or(other.text.clone()),
            font: self.font.clone().unwrap_or(other.font.clone()),
            background_color: self.background_color.or(other.background_color),
            border_color: self.border_color.unwrap_or(other.border_color),
            border_width: self.border_width.unwrap_or(other.border_width),
            // corner_radius: self.corner_radius.unwrap_or(other.corner_radius),
            // padding: self.padding.unwrap_or(other.padding.into()).into(),
            // outline_blur: self.outline_blur.unwrap_or(other.outline_blur),
            outline_color: self.outline_color.unwrap_or(other.outline_color),
            // outline_offset: self
            //     .outline_offset
            //     .unwrap_or(other.outline_offset.into())
            //     .into(),
            outline_opacity: self.outline_opacity.unwrap_or(other.outline_opacity),
            outline_width: self.outline_width.unwrap_or(other.outline_width),
            lang: self.lang.clone().unwrap_or(other.lang.clone()),
            high_quality: self.high_quality.unwrap_or(other.high_quality),

            opacity: self.opacity.unwrap_or(other.opacity),
            transparent: self.transparent.unwrap_or(other.transparent),

            max_width: self.max_width.unwrap_or(other.max_width),
            line_height: self.line_height.unwrap_or(other.line_height),
            text_align: self.text_align.clone().unwrap_or(other.text_align.clone()),

            declutter: self.declutter.unwrap_or(other.declutter),
            declutter_priority: self.declutter_priority.unwrap_or(other.declutter_priority),
            geometry_types: parse_geometry_types(&self.geometry_types)
                .unwrap_or_else(|| other.geometry_types.clone()),
            effect_ids: self.effect_ids.clone().or_else(|| other.effect_ids.clone()),
            emissive_intensity: self.emissive_intensity.or(other.emissive_intensity),
            emissive_color: self.emissive_color.or(other.emissive_color),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolylineMaterial {
    pub show: Option<bool>,
    #[wasm_bindgen(js_name = castShadow)]
    #[serde(rename = "castShadow")]
    pub cast_shadow: Option<bool>,
    #[wasm_bindgen(js_name = receiveShadow)]
    #[serde(rename = "receiveShadow")]
    pub receive_shadow: Option<bool>,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    pub color: Option<u32>,
    pub width: Option<f32>,
    /// Maximum line width in pixels, clamping the rendered width regardless of zoom level.
    /// Smaller values are cheaper to render as they reduce fragment shader overdraw.
    #[wasm_bindgen(js_name = maxWidth)]
    #[serde(rename = "maxWidth")]
    pub max_width: Option<f32>,
    #[wasm_bindgen(js_name = clampToGround)]
    #[serde(rename = "clampToGround")]
    pub clamp_to_ground: Option<bool>,
    /// Splits the polyline into XYZ vector tiles for rendering, even when the
    /// data source is not an MVT layer. This can improve performance for large
    /// polylines.
    ///
    /// Enabling `clamp_to_ground` implicitly forces `tiled` to `true`.
    #[wasm_bindgen(js_name = tiled)]
    #[serde(rename = "tiled")]
    pub tiled: Option<bool>,
    pub height: Option<f32>,
    /// Source geometry types this appearance consumes: `"line"`, `"polygon"`.
    /// Defaults to `["line"]`; adding `"polygon"` also renders polygon boundary
    /// rings (outer ring and holes) as closed polylines at the ring's base
    /// height. Extruded-polygon edges stay the polygon material's `outline`
    /// feature.
    #[wasm_bindgen(getter_with_clone, js_name = geometryTypes)]
    #[serde(rename = "geometryTypes")]
    pub geometry_types: Option<Vec<String>>,
    #[wasm_bindgen(getter_with_clone)]
    pub __internal__: Option<PolylineInternalMaterial>,
    // SelectiveEffect
    /// IDs of selective effects to apply (e.g., "bloom", "outline")
    #[wasm_bindgen(getter_with_clone, js_name = effectIds)]
    #[serde(rename = "effectIds")]
    pub effect_ids: Option<Vec<String>>,
    /// Emissive glow intensity (omitted = 0, no emissive output)
    #[wasm_bindgen(js_name = emissiveIntensity)]
    #[serde(rename = "emissiveIntensity")]
    pub emissive_intensity: Option<f32>,
    /// Emissive glow color in 0xRRGGBB format
    #[wasm_bindgen(js_name = emissiveColor)]
    #[serde(rename = "emissiveColor")]
    pub emissive_color: Option<u32>,
    /// Enable transparency and alpha blending
    pub transparent: Option<bool>,
    /// Opacity value
    pub opacity: Option<f32>,
    /// Enable writing to depth buffer
    #[wasm_bindgen(js_name = depthWrite)]
    #[serde(rename = "depthWrite")]
    pub depth_write: Option<bool>,
}

#[wasm_bindgen]
impl PolylineMaterial {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        show: Option<bool>,
        cast_shadow: Option<bool>,
        receive_shadow: Option<bool>,
        color: Option<u32>,
        clamp_to_ground: Option<bool>,
        tiled: Option<bool>,
        height: Option<f32>,
        width: Option<f32>,
        max_width: Option<f32>,
        __internal__: Option<PolylineInternalMaterial>,
    ) -> Self {
        Self {
            show,
            cast_shadow,
            receive_shadow,
            lit: None,
            color,
            clamp_to_ground,
            tiled,
            height,
            width,
            max_width,
            geometry_types: None,
            __internal__,
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
            transparent: None,
            opacity: None,
            depth_write: None,
        }
    }
}

impl PolylineMaterial {
    pub fn merge(
        &self,
        other: &navara_material::PolylineMaterial,
    ) -> navara_material::PolylineMaterial {
        navara_material::PolylineMaterial {
            show: self.show.unwrap_or(other.show),
            cast_shadow: self.cast_shadow.unwrap_or(other.cast_shadow),
            receive_shadow: self.receive_shadow.unwrap_or(other.receive_shadow),
            lit: self.lit.or(other.lit),
            color: self.color.unwrap_or(other.color),
            width: self.width.unwrap_or(other.width),
            max_width: self.max_width.unwrap_or(other.max_width),
            clamp_to_ground: self.clamp_to_ground.unwrap_or(other.clamp_to_ground),
            tiled: self.tiled.unwrap_or(other.tiled),
            height: self.height.unwrap_or(other.height),
            geometry_types: parse_geometry_types(&self.geometry_types)
                .unwrap_or_else(|| other.geometry_types.clone()),
            internal: self
                .__internal__
                .as_ref()
                .map(|v| v.to_owned().into())
                .or_else(|| other.internal.clone()),
            effect_ids: self.effect_ids.clone().or_else(|| other.effect_ids.clone()),
            emissive_intensity: self.emissive_intensity.or(other.emissive_intensity),
            emissive_color: self.emissive_color.or(other.emissive_color),
            transparent: self.transparent.unwrap_or(other.transparent),
            opacity: self.opacity.unwrap_or(other.opacity),
            depth_write: self.depth_write.unwrap_or(other.depth_write),
        }
    }
}

impl From<PolylineMaterial> for navara_material::PolylineMaterial {
    fn from(val: PolylineMaterial) -> Self {
        let default = navara_material::PolylineMaterial::default();
        navara_material::PolylineMaterial {
            show: val.show.unwrap_or(default.show),
            cast_shadow: val.cast_shadow.unwrap_or(default.cast_shadow),
            receive_shadow: val.receive_shadow.unwrap_or(default.receive_shadow),
            lit: val.lit.or(default.lit),
            color: val.color.unwrap_or(default.color),
            width: val.width.unwrap_or(default.width),
            max_width: val.max_width.unwrap_or(default.max_width),
            clamp_to_ground: val.clamp_to_ground.unwrap_or(default.clamp_to_ground),
            tiled: val.tiled.unwrap_or(default.tiled),
            height: val.height.unwrap_or(default.height),
            geometry_types: parse_geometry_types(&val.geometry_types)
                .unwrap_or(default.geometry_types),
            internal: val.__internal__.map(|v| v.into()),
            effect_ids: val.effect_ids.or(default.effect_ids),
            emissive_intensity: val.emissive_intensity.or(default.emissive_intensity),
            emissive_color: val.emissive_color.or(default.emissive_color),
            transparent: val.transparent.unwrap_or(default.transparent),
            opacity: val.opacity.unwrap_or(default.opacity),
            depth_write: val.depth_write.unwrap_or(default.depth_write),
        }
    }
}
impl<'a> From<&'a navara_material::PolylineMaterial> for PolylineMaterial {
    fn from(value: &'a navara_material::PolylineMaterial) -> PolylineMaterial {
        PolylineMaterial {
            show: Some(value.show),
            cast_shadow: Some(value.cast_shadow),
            receive_shadow: Some(value.receive_shadow),
            lit: value.lit,
            color: Some(value.color),
            width: Some(value.width),
            max_width: Some(value.max_width),
            clamp_to_ground: Some(value.clamp_to_ground),
            tiled: Some(value.tiled),
            height: Some(value.height),
            geometry_types: Some(geometry_type_names(&value.geometry_types)),
            __internal__: value.internal.as_ref().map(|v| v.into()),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
            transparent: Some(value.transparent),
            opacity: Some(value.opacity),
            depth_write: Some(value.depth_write),
        }
    }
}

impl From<navara_material::PolylineMaterial> for PolylineMaterial {
    fn from(value: navara_material::PolylineMaterial) -> PolylineMaterial {
        PolylineMaterial {
            show: Some(value.show),
            cast_shadow: Some(value.cast_shadow),
            receive_shadow: Some(value.receive_shadow),
            lit: value.lit,
            color: Some(value.color),
            width: Some(value.width),
            max_width: Some(value.max_width),
            clamp_to_ground: Some(value.clamp_to_ground),
            tiled: Some(value.tiled),
            height: Some(value.height),
            geometry_types: Some(geometry_type_names(&value.geometry_types)),
            __internal__: value.internal.map(|v| v.into()),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
            transparent: Some(value.transparent),
            opacity: Some(value.opacity),
            depth_write: Some(value.depth_write),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolylineInternalMaterial {
    #[wasm_bindgen(getter_with_clone, js_name = minMaxHeights)]
    #[serde(rename = "minMaxHeights")]
    pub min_max_heights: Vec<f64>,
}

impl From<PolylineInternalMaterial> for navara_material::PolylineInternalMaterial {
    fn from(val: PolylineInternalMaterial) -> Self {
        navara_material::PolylineInternalMaterial {
            min_max_heights: val.min_max_heights,
        }
    }
}
impl From<&navara_material::PolylineInternalMaterial> for PolylineInternalMaterial {
    fn from(val: &navara_material::PolylineInternalMaterial) -> Self {
        PolylineInternalMaterial {
            min_max_heights: val.min_max_heights.clone(),
        }
    }
}

impl From<navara_material::PolylineInternalMaterial> for PolylineInternalMaterial {
    fn from(val: navara_material::PolylineInternalMaterial) -> Self {
        PolylineInternalMaterial {
            min_max_heights: val.min_max_heights,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolygonMaterial {
    pub show: Option<bool>,
    #[wasm_bindgen(js_name = castShadow)]
    #[serde(rename = "castShadow")]
    pub cast_shadow: Option<bool>,
    #[wasm_bindgen(js_name = receiveShadow)]
    #[serde(rename = "receiveShadow")]
    pub receive_shadow: Option<bool>,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    pub color: Option<u32>,
    #[wasm_bindgen(js_name = clampToGround)]
    #[serde(rename = "clampToGround")]
    pub clamp_to_ground: Option<bool>,
    /// Splits the polygon into XYZ vector tiles for rendering, even when the
    /// data source is not an MVT layer. This can improve performance for large
    /// polygons.
    ///
    /// Enabling `clamp_to_ground` implicitly forces `tiled` to `true`.
    /// Outline rendering is not supported when `tiled` is enabled.
    #[wasm_bindgen(js_name = tiled)]
    #[serde(rename = "tiled")]
    pub tiled: Option<bool>,
    pub height: Option<f32>,
    #[wasm_bindgen(js_name = extrudedHeight)]
    #[serde(rename = "extrudedHeight")]
    pub extruded_height: Option<f32>,
    pub wireframe: Option<bool>,
    /// Reflectivity for post-process or env map.
    pub reflectivity: Option<f32>,
    /// Reflectivity for post-process.
    pub roughness: Option<f32>,
    #[wasm_bindgen(getter_with_clone)]
    pub __internal__: Option<PolygonInternalMaterial>,

    /// Whether or not the height is obtained from the data. If false, the height is constant.
    #[wasm_bindgen(js_name = perPositionHeight)]
    #[serde(rename = "perPositionHeight")]
    pub per_position_height: Option<bool>,
    /// Need to enable `transparent`.
    pub opacity: Option<f32>,
    /// Enable `opacity`. It might cause unexpected behavior when you use an effect.
    pub transparent: Option<bool>,

    /// Currently, this property is supported only in GeoJSON.
    #[wasm_bindgen(js_name = surfaceShow)]
    #[serde(rename = "surfaceShow")]
    pub surface_show: Option<bool>,
    /// Whether to compute outline geometry. Only effective at initial load time.
    /// When not set, inferred from `outlineShow`.
    pub outline: Option<bool>,
    /// Currently, this property is supported only in GeoJSON.
    #[wasm_bindgen(js_name = outlineShow)]
    #[serde(rename = "outlineShow")]
    pub outline_show: Option<bool>,
    /// Currently, this property is supported only in GeoJSON.
    #[wasm_bindgen(js_name = outlineColor)]
    #[serde(rename = "outlineColor")]
    pub outline_color: Option<u32>,
    /// Currently, this property is supported only in GeoJSON.
    #[wasm_bindgen(js_name = outlineWidth)]
    #[serde(rename = "outlineWidth")]
    pub outline_width: Option<f32>,

    /// Apply a water material on the polygon. It might slow down the loading of the mesh.
    pub water: Option<bool>,
    /// Scale water normal. Decreasing this value will make the water surface rough.
    #[wasm_bindgen(js_name = waterScaleNormal)]
    #[serde(rename = "waterScaleNormal")]
    pub water_scale_normal: Option<f32>,
    /// Water wave speed.
    #[wasm_bindgen(js_name = waterSpeed)]
    #[serde(rename = "waterSpeed")]
    pub water_speed: Option<f32>,
    pub shininess: Option<f32>,
    #[wasm_bindgen(js_name = specularStrength)]
    #[serde(rename = "specularStrength")]
    pub specular_strength: Option<f32>,
    #[wasm_bindgen(js_name = applyWaterNormal)]
    #[serde(rename = "applyWaterNormal")]
    pub apply_water_normal: Option<bool>,
    /// Enabling this value allows using `shininess` and `specular_strength`.
    pub specular: Option<bool>,
    pub ior: Option<f32>,
    // SelectiveEffect
    /// IDs of selective effects to apply (e.g., "bloom", "outline")
    #[wasm_bindgen(getter_with_clone, js_name = effectIds)]
    #[serde(rename = "effectIds")]
    pub effect_ids: Option<Vec<String>>,
    /// Emissive glow intensity (omitted = 0, no emissive output)
    #[wasm_bindgen(js_name = emissiveIntensity)]
    #[serde(rename = "emissiveIntensity")]
    pub emissive_intensity: Option<f32>,
    /// Emissive glow color in 0xRRGGBB format
    #[wasm_bindgen(js_name = emissiveColor)]
    #[serde(rename = "emissiveColor")]
    pub emissive_color: Option<u32>,
}

#[wasm_bindgen]
impl PolygonMaterial {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        show: Option<bool>,
        cast_shadow: Option<bool>,
        receive_shadow: Option<bool>,
        color: Option<u32>,
        clamp_to_ground: Option<bool>,
        tiled: Option<bool>,
        height: Option<f32>,
        extruded_height: Option<f32>,
        wireframe: Option<bool>,
        outline: Option<bool>,
        per_position_height: Option<bool>,
        __internal__: Option<PolygonInternalMaterial>,
    ) -> Self {
        Self {
            show,
            cast_shadow,
            receive_shadow,
            lit: None,
            color,
            clamp_to_ground,
            tiled,
            height,
            extruded_height,
            wireframe,
            reflectivity: None,
            roughness: None,
            __internal__,

            per_position_height,
            opacity: None,
            transparent: None,

            surface_show: None,
            outline,
            outline_show: None,
            outline_color: None,
            outline_width: None,

            // These are unnecessary for polygon geometry construction.
            water: None,
            water_scale_normal: None,
            water_speed: None,
            shininess: None,
            specular_strength: None,
            apply_water_normal: None,
            specular: None,
            ior: None,
            effect_ids: None,
            emissive_intensity: None,
            emissive_color: None,
        }
    }
}

impl PolygonMaterial {
    pub fn merge(
        &self,
        other: &navara_material::PolygonMaterial,
    ) -> navara_material::PolygonMaterial {
        navara_material::PolygonMaterial {
            show: self.show.unwrap_or(other.show),
            cast_shadow: self.cast_shadow.unwrap_or(other.cast_shadow),
            receive_shadow: self.receive_shadow.unwrap_or(other.receive_shadow),
            lit: self.lit.or(other.lit),
            color: self.color.unwrap_or(other.color),
            clamp_to_ground: self.clamp_to_ground.unwrap_or(other.clamp_to_ground),
            tiled: self.tiled.unwrap_or(other.tiled),
            height: self.height.unwrap_or(other.height),
            extruded_height: self.extruded_height.or(other.extruded_height),
            wireframe: self.wireframe.unwrap_or(other.wireframe),
            reflectivity: self.reflectivity.unwrap_or(other.reflectivity),
            roughness: self.roughness.unwrap_or(other.roughness),
            internal: self
                .__internal__
                .as_ref()
                .map(|v| v.to_owned().into())
                .or_else(|| other.internal.clone()),

            per_position_height: self
                .per_position_height
                .unwrap_or(other.per_position_height),
            opacity: self.opacity.unwrap_or(other.opacity),
            transparent: self.transparent.unwrap_or(other.transparent),

            surface_show: self.surface_show.unwrap_or(other.surface_show),
            outline: self.outline.unwrap_or(other.outline),
            outline_show: self.outline_show.unwrap_or(other.outline_show),
            outline_color: self.outline_color.unwrap_or(other.outline_color),
            outline_width: self.outline_width.unwrap_or(other.outline_width),
            water: self.water.unwrap_or(other.water),
            water_scale_normal: self.water_scale_normal.unwrap_or(other.water_scale_normal),
            water_speed: self.water_speed.unwrap_or(other.water_speed),
            shininess: self.shininess.unwrap_or(other.shininess),
            specular_strength: self.specular_strength.unwrap_or(other.specular_strength),
            apply_water_normal: self.apply_water_normal.unwrap_or(other.apply_water_normal),
            specular: self.specular.unwrap_or(other.specular),
            ior: self.ior.unwrap_or(other.ior),
            effect_ids: self.effect_ids.clone().or_else(|| other.effect_ids.clone()),
            emissive_intensity: self.emissive_intensity.or(other.emissive_intensity),
            emissive_color: self.emissive_color.or(other.emissive_color),
        }
    }
}

impl From<PolygonMaterial> for navara_material::PolygonMaterial {
    fn from(val: PolygonMaterial) -> Self {
        let default = navara_material::PolygonMaterial::default();
        navara_material::PolygonMaterial {
            show: val.show.unwrap_or(default.show),
            cast_shadow: val.cast_shadow.unwrap_or(default.cast_shadow),
            receive_shadow: val.receive_shadow.unwrap_or(default.receive_shadow),
            lit: val.lit.or(default.lit),
            color: val.color.unwrap_or(default.color),
            clamp_to_ground: val.clamp_to_ground.unwrap_or(default.clamp_to_ground),
            tiled: val.tiled.unwrap_or(default.tiled),
            height: val.height.unwrap_or(default.height),
            extruded_height: val.extruded_height,
            wireframe: val.wireframe.unwrap_or(default.wireframe),
            reflectivity: val.reflectivity.unwrap_or(default.reflectivity),
            roughness: val.roughness.unwrap_or(default.reflectivity),
            internal: val.__internal__.map(|v| v.into()),

            per_position_height: val
                .per_position_height
                .unwrap_or(default.per_position_height),
            opacity: val.opacity.unwrap_or(default.opacity),
            transparent: val.transparent.unwrap_or(default.transparent),

            surface_show: val.surface_show.unwrap_or(default.surface_show),
            outline: val
                .outline
                .unwrap_or_else(|| val.outline_show.unwrap_or(default.outline)),
            outline_show: val.outline_show.unwrap_or(default.outline_show),
            outline_color: val.outline_color.unwrap_or(default.outline_color),
            outline_width: val.outline_width.unwrap_or(default.outline_width),
            water: val.water.unwrap_or(default.water),
            water_scale_normal: val.water_scale_normal.unwrap_or(default.water_scale_normal),
            water_speed: val.water_speed.unwrap_or(default.water_speed),
            shininess: val.shininess.unwrap_or(default.shininess),
            specular_strength: val.specular_strength.unwrap_or(default.specular_strength),
            apply_water_normal: val.apply_water_normal.unwrap_or(default.apply_water_normal),
            specular: val.specular.unwrap_or(default.specular),
            ior: val.ior.unwrap_or(default.ior),
            effect_ids: val.effect_ids.or(default.effect_ids),
            emissive_intensity: val.emissive_intensity.or(default.emissive_intensity),
            emissive_color: val.emissive_color.or(default.emissive_color),
        }
    }
}
impl<'a> From<&'a navara_material::PolygonMaterial> for PolygonMaterial {
    fn from(value: &'a navara_material::PolygonMaterial) -> PolygonMaterial {
        PolygonMaterial {
            show: Some(value.show),
            cast_shadow: Some(value.cast_shadow),
            receive_shadow: Some(value.receive_shadow),
            lit: value.lit,
            color: Some(value.color),
            clamp_to_ground: Some(value.clamp_to_ground),
            tiled: Some(value.tiled),
            height: Some(value.height),
            extruded_height: value.extruded_height,
            wireframe: Some(value.wireframe),
            reflectivity: Some(value.reflectivity),
            roughness: Some(value.roughness),
            __internal__: value.internal.as_ref().map(|v| v.into()),

            per_position_height: Some(value.per_position_height),
            opacity: Some(value.opacity),
            transparent: Some(value.transparent),

            surface_show: Some(value.surface_show),
            outline: Some(value.outline),
            outline_show: Some(value.outline_show),
            outline_color: Some(value.outline_color),
            outline_width: Some(value.outline_width),
            water: Some(value.water),
            water_scale_normal: Some(value.water_scale_normal),
            water_speed: Some(value.water_speed),
            shininess: Some(value.shininess),
            specular_strength: Some(value.specular_strength),
            apply_water_normal: Some(value.apply_water_normal),
            specular: Some(value.specular),
            ior: Some(value.ior),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
        }
    }
}
impl From<navara_material::PolygonMaterial> for PolygonMaterial {
    fn from(value: navara_material::PolygonMaterial) -> PolygonMaterial {
        PolygonMaterial {
            show: Some(value.show),
            cast_shadow: Some(value.cast_shadow),
            receive_shadow: Some(value.receive_shadow),
            lit: value.lit,
            color: Some(value.color),
            clamp_to_ground: Some(value.clamp_to_ground),
            tiled: Some(value.tiled),
            height: Some(value.height),
            extruded_height: value.extruded_height,
            wireframe: Some(value.wireframe),
            reflectivity: Some(value.reflectivity),
            roughness: Some(value.roughness),
            __internal__: value.internal.map(|v| v.into()),

            per_position_height: Some(value.per_position_height),
            opacity: Some(value.opacity),
            transparent: Some(value.transparent),

            surface_show: Some(value.surface_show),
            outline: Some(value.outline),
            outline_show: Some(value.outline_show),
            outline_color: Some(value.outline_color),
            outline_width: Some(value.outline_width),
            water: Some(value.water),
            water_scale_normal: Some(value.water_scale_normal),
            water_speed: Some(value.water_speed),
            shininess: Some(value.shininess),
            specular_strength: Some(value.specular_strength),
            apply_water_normal: Some(value.apply_water_normal),
            specular: Some(value.specular),
            ior: Some(value.ior),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolygonInternalMaterial {
    #[wasm_bindgen(getter_with_clone, js_name = minMaxHeights)]
    #[serde(rename = "minMaxHeights")]
    pub min_max_heights: Vec<f64>,
}

impl From<PolygonInternalMaterial> for navara_material::PolygonInternalMaterial {
    fn from(val: PolygonInternalMaterial) -> Self {
        navara_material::PolygonInternalMaterial {
            min_max_heights: val.min_max_heights,
        }
    }
}
impl From<&navara_material::PolygonInternalMaterial> for PolygonInternalMaterial {
    fn from(val: &navara_material::PolygonInternalMaterial) -> Self {
        PolygonInternalMaterial {
            min_max_heights: val.min_max_heights.clone(),
        }
    }
}
impl From<navara_material::PolygonInternalMaterial> for PolygonInternalMaterial {
    fn from(val: navara_material::PolygonInternalMaterial) -> Self {
        PolygonInternalMaterial {
            min_max_heights: val.min_max_heights,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMaterial {
    pub show: Option<bool>,
    #[wasm_bindgen(js_name = castShadow)]
    #[serde(rename = "castShadow")]
    pub cast_shadow: Option<bool>,
    #[wasm_bindgen(js_name = receiveShadow)]
    #[serde(rename = "receiveShadow")]
    pub receive_shadow: Option<bool>,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    #[wasm_bindgen(getter_with_clone)]
    pub url: Option<String>,
    pub size: Option<f32>,
    pub height: Option<f32>,
    #[wasm_bindgen(js_name = maxSse)]
    #[serde(rename = "maxSse")]
    pub max_sse: Option<f32>,
    #[wasm_bindgen(js_name = shouldRotateInDefault)]
    #[serde(rename = "shouldRotateInDefault")]
    pub should_rotate_in_default: Option<bool>,
    pub color: Option<u32>,
    pub metalness: Option<f32>,
    /// Reflectivity for post-process.
    pub roughness: Option<f32>,
    /// Reflectivity for post-process or env map.
    pub reflectivity: Option<f32>,
    /// Apply a water material on the polygon. It might slow down the loading of the mesh.
    pub water: Option<bool>,
    /// Scale water normal. Decreasing this value will make the water surface rough.
    #[wasm_bindgen(js_name = waterScaleNormal)]
    #[serde(rename = "waterScaleNormal")]
    pub water_scale_normal: Option<f32>,
    /// Water wave speed.
    #[wasm_bindgen(js_name = waterSpeed)]
    #[serde(rename = "waterSpeed")]
    pub water_speed: Option<f32>,
    pub shininess: Option<f32>,
    #[wasm_bindgen(js_name = specularStrength)]
    #[serde(rename = "specularStrength")]
    pub specular_strength: Option<f32>,
    #[wasm_bindgen(js_name = applyWaterNormal)]
    #[serde(rename = "applyWaterNormal")]
    pub apply_water_normal: Option<bool>,
    /// Enabling this value allows using `shininess` and `specular_strength`.
    pub specular: Option<bool>,
    pub ior: Option<f32>,
    // animation
    #[wasm_bindgen(getter_with_clone, js_name = animationActiveClip)]
    #[serde(rename = "animationActiveClip")]
    pub animation_active_clip: Option<String>,
    #[wasm_bindgen(js_name = animationSpeed)]
    #[serde(rename = "animationSpeed")]
    pub animation_speed: Option<f32>,
    // Point size for point clouds data.
    #[wasm_bindgen(js_name = pointSize)]
    #[serde(rename = "pointSize")]
    pub point_size: Option<f32>,
    #[wasm_bindgen(js_name = showBoundingBox)]
    #[serde(rename = "showBoundingBox")]
    pub show_bounding_box: Option<bool>,
    /// When true, recompute vertex normals using a creased-normals algorithm
    /// after the model loads. Useful for tiled glTF assets that ship without
    /// normals or with low-quality normals.
    pub normals: Option<bool>,
    /// Crease angle (in radians) used when `normals` is true. Defaults to 30°
    /// (PI/6) when omitted.
    #[wasm_bindgen(js_name = creaseNormalAngle)]
    #[serde(rename = "creaseNormalAngle")]
    pub crease_normal_angle: Option<f32>,
    #[wasm_bindgen(getter_with_clone)]
    pub __internal__: Option<ModelInternalMaterial>,
    // SelectiveEffect
    /// IDs of selective effects to apply (e.g., "bloom", "outline")
    #[wasm_bindgen(getter_with_clone, js_name = effectIds)]
    #[serde(rename = "effectIds")]
    pub effect_ids: Option<Vec<String>>,
    /// Emissive glow intensity (omitted = 0, no emissive output)
    #[wasm_bindgen(js_name = emissiveIntensity)]
    #[serde(rename = "emissiveIntensity")]
    pub emissive_intensity: Option<f32>,
    /// Emissive glow color in 0xRRGGBB format
    #[wasm_bindgen(js_name = emissiveColor)]
    #[serde(rename = "emissiveColor")]
    pub emissive_color: Option<u32>,
    /// Enable transparency and alpha blending
    pub transparent: Option<bool>,
    /// Opacity value
    pub opacity: Option<f32>,
    /// Enable writing to depth buffer
    #[wasm_bindgen(js_name = depthWrite)]
    #[serde(rename = "depthWrite")]
    pub depth_write: Option<bool>,
}

impl From<ModelMaterial> for navara_material::ModelMaterial {
    fn from(val: ModelMaterial) -> Self {
        let default = navara_material::ModelMaterial::default();
        navara_material::ModelMaterial {
            show: val.show.unwrap_or(default.show),
            cast_shadow: val.cast_shadow.unwrap_or(default.cast_shadow),
            receive_shadow: val.receive_shadow.unwrap_or(default.receive_shadow),
            lit: val.lit.or(default.lit),
            url: val.url.unwrap_or(default.url),
            size: val.size.unwrap_or(default.size),
            height: val.height.unwrap_or(default.height),
            max_sse: val.max_sse.unwrap_or(default.max_sse),
            should_rotate_in_default: val
                .should_rotate_in_default
                .unwrap_or(default.should_rotate_in_default),
            color: val.color.unwrap_or(default.color),
            metalness: val.metalness.unwrap_or(default.metalness),
            roughness: val.roughness.unwrap_or(default.roughness),
            reflectivity: val.reflectivity.unwrap_or(default.reflectivity),
            water: val.water.unwrap_or(default.water),
            water_scale_normal: val.water_scale_normal.unwrap_or(default.water_scale_normal),
            water_speed: val.water_speed.unwrap_or(default.water_speed),
            shininess: val.shininess.unwrap_or(default.shininess),
            specular_strength: val.specular_strength.unwrap_or(default.specular_strength),
            apply_water_normal: val.apply_water_normal.unwrap_or(default.apply_water_normal),
            specular: val.specular.unwrap_or(default.specular),
            ior: val.ior.unwrap_or(default.ior),
            // animation
            animation_active_clip: val.animation_active_clip,
            animation_speed: val.animation_speed,
            point_size: val.point_size.unwrap_or(default.point_size),
            show_bounding_box: val.show_bounding_box.unwrap_or(default.show_bounding_box),
            normals: val.normals.unwrap_or(default.normals),
            crease_normal_angle: val.crease_normal_angle.or(default.crease_normal_angle),
            internal: val.__internal__.clone().map(|v| v.into()),
            effect_ids: val.effect_ids.or(default.effect_ids),
            emissive_intensity: val.emissive_intensity.or(default.emissive_intensity),
            emissive_color: val.emissive_color.or(default.emissive_color),
            transparent: val.transparent.unwrap_or(default.transparent),
            opacity: val.opacity.unwrap_or(default.opacity),
            depth_write: val.depth_write.unwrap_or(default.depth_write),
        }
    }
}

impl<'a> From<&'a navara_material::ModelMaterial> for ModelMaterial {
    fn from(value: &'a navara_material::ModelMaterial) -> ModelMaterial {
        ModelMaterial {
            show: Some(value.show),
            cast_shadow: Some(value.cast_shadow),
            receive_shadow: Some(value.receive_shadow),
            lit: value.lit,
            url: Some(value.url.clone()),
            size: Some(value.size),
            height: Some(value.height),
            max_sse: Some(value.max_sse),
            should_rotate_in_default: Some(value.should_rotate_in_default),
            color: Some(value.color),
            metalness: Some(value.metalness),
            roughness: Some(value.roughness),
            reflectivity: Some(value.reflectivity),
            water: Some(value.water),
            water_scale_normal: Some(value.water_scale_normal),
            water_speed: Some(value.water_speed),
            shininess: Some(value.shininess),
            specular_strength: Some(value.specular_strength),
            apply_water_normal: Some(value.apply_water_normal),
            specular: Some(value.specular),
            ior: Some(value.ior),
            // animation
            animation_active_clip: value.animation_active_clip.clone(),
            animation_speed: value.animation_speed,
            point_size: Some(value.point_size),
            show_bounding_box: Some(value.show_bounding_box),
            normals: Some(value.normals),
            crease_normal_angle: value.crease_normal_angle,
            __internal__: value.internal.clone().as_ref().map(|v| v.into()),
            effect_ids: value.effect_ids.clone(),
            emissive_intensity: value.emissive_intensity,
            emissive_color: value.emissive_color,
            transparent: Some(value.transparent),
            opacity: Some(value.opacity),
            depth_write: Some(value.depth_write),
        }
    }
}

impl ModelMaterial {
    pub fn merge(&self, other: &navara_material::ModelMaterial) -> navara_material::ModelMaterial {
        navara_material::ModelMaterial {
            show: self.show.unwrap_or(other.show),
            cast_shadow: self.cast_shadow.unwrap_or(other.cast_shadow),
            receive_shadow: self.receive_shadow.unwrap_or(other.receive_shadow),
            lit: self.lit.or(other.lit),
            url: self.url.clone().unwrap_or_else(|| other.url.clone()),
            size: self.size.unwrap_or(other.size),
            height: self.height.unwrap_or(other.height),
            max_sse: self.max_sse.unwrap_or(other.max_sse),
            should_rotate_in_default: self
                .should_rotate_in_default
                .unwrap_or(other.should_rotate_in_default),
            color: self.color.unwrap_or(other.color),
            metalness: self.metalness.unwrap_or(other.metalness),
            roughness: self.roughness.unwrap_or(other.roughness),
            reflectivity: self.reflectivity.unwrap_or(other.reflectivity),
            water: self.water.unwrap_or(other.water),
            water_scale_normal: self.water_scale_normal.unwrap_or(other.water_scale_normal),
            water_speed: self.water_speed.unwrap_or(other.water_speed),
            shininess: self.shininess.unwrap_or(other.shininess),
            specular_strength: self.specular_strength.unwrap_or(other.specular_strength),
            apply_water_normal: self.apply_water_normal.unwrap_or(other.apply_water_normal),
            specular: self.specular.unwrap_or(other.specular),
            ior: self.ior.unwrap_or(other.ior),
            // animation
            animation_active_clip: self
                .animation_active_clip
                .clone()
                .or_else(|| other.animation_active_clip.clone()),
            animation_speed: self.animation_speed.or(other.animation_speed),
            point_size: self.point_size.unwrap_or(other.point_size),
            show_bounding_box: self.show_bounding_box.unwrap_or(other.show_bounding_box),
            normals: self.normals.unwrap_or(other.normals),
            crease_normal_angle: self.crease_normal_angle.or(other.crease_normal_angle),
            internal: other.internal.clone(),
            effect_ids: self.effect_ids.clone().or_else(|| other.effect_ids.clone()),
            emissive_intensity: self.emissive_intensity.or(other.emissive_intensity),
            emissive_color: self.emissive_color.or(other.emissive_color),
            transparent: self.transparent.unwrap_or(other.transparent),
            opacity: self.opacity.unwrap_or(other.opacity),
            depth_write: self.depth_write.unwrap_or(other.depth_write),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInternalMaterial {
    #[wasm_bindgen(getter_with_clone, js_name = pointCloud)]
    #[serde(rename = "pointCloud")]
    pub point_cloud: bool,
    #[wasm_bindgen(getter_with_clone, js_name = dracoCompressed)]
    #[serde(rename = "dracoCompressed")]
    pub draco_compressed: bool,
    #[wasm_bindgen(getter_with_clone, js_name = pointCloudGeodeticNormal)]
    #[serde(rename = "pointCloudGeodeticNormal")]
    pub point_cloud_geodetic_normal: WasmVec3,
}

impl<'a> From<&'a navara_material::ModelInternalMaterial> for ModelInternalMaterial {
    fn from(value: &'a navara_material::ModelInternalMaterial) -> ModelInternalMaterial {
        ModelInternalMaterial {
            point_cloud: value.point_cloud,
            draco_compressed: value.draco_compressed,
            point_cloud_geodetic_normal: value.point_cloud_geodetic_normal.into(),
        }
    }
}

impl From<ModelInternalMaterial> for navara_material::ModelInternalMaterial {
    fn from(value: ModelInternalMaterial) -> navara_material::ModelInternalMaterial {
        navara_material::ModelInternalMaterial {
            point_cloud: value.point_cloud,
            draco_compressed: value.draco_compressed,
            point_cloud_geodetic_normal: value.point_cloud_geodetic_normal.into(),
        }
    }
}

/// Render-only appearance for a `raster` layer's imagery. All fetch/tiling
/// config lives on the referenced `Source`; only display fields are carried
/// here. Parallel to [`HillshadeMaterial`] / [`ElevationHeatmapMaterial`].
#[wasm_bindgen]
#[derive(Debug, Clone, Deserialize)]
pub struct RasterMaterial {
    pub show: Option<bool>,
    pub color: Option<u32>,
    pub opacity: Option<f32>,
    #[wasm_bindgen(js_name = showBoundingBox)]
    #[serde(rename = "showBoundingBox")]
    pub show_bounding_box: Option<bool>,
}

impl From<RasterMaterial> for navara_material::RasterMaterial {
    fn from(val: RasterMaterial) -> Self {
        let default = navara_material::RasterMaterial::default();
        navara_material::RasterMaterial {
            show: val.show.unwrap_or(default.show),
            color: val.color.unwrap_or(default.color),
            opacity: val.opacity.unwrap_or(default.opacity),
            show_bounding_box: val.show_bounding_box.unwrap_or(default.show_bounding_box),
        }
    }
}

impl RasterMaterial {
    pub fn merge(
        &self,
        other: &navara_material::RasterMaterial,
    ) -> navara_material::RasterMaterial {
        navara_material::RasterMaterial {
            show: self.show.unwrap_or(other.show),
            color: self.color.unwrap_or(other.color),
            opacity: self.opacity.unwrap_or(other.opacity),
            show_bounding_box: self.show_bounding_box.unwrap_or(other.show_bounding_box),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RasterTileInternalMaterial {
    #[wasm_bindgen(getter_with_clone)]
    pub shows: Vec<u8>,
    #[wasm_bindgen(getter_with_clone)]
    pub colors: Vec<u32>,
    #[wasm_bindgen(getter_with_clone)]
    pub opacities: Vec<f32>,
    texture_fragments: Option<Vec<Option<TextureFragment>>>,
    #[wasm_bindgen(js_name = castShadow)]
    #[serde(rename = "castShadow")]
    pub cast_shadow: Option<bool>,
    #[wasm_bindgen(js_name = receiveShadow)]
    #[serde(rename = "receiveShadow")]
    pub receive_shadow: Option<bool>,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    #[wasm_bindgen(js_name = showBoundingBox)]
    #[serde(rename = "showBoundingBox")]
    pub show_bounding_box: Option<bool>,

    // Elevation Heatmap fields
    #[wasm_bindgen(getter_with_clone, js_name = isElevationHeatmaps)]
    #[serde(rename = "isElevationHeatmaps")]
    pub is_elevation_heatmaps: Vec<u8>,
    // Shared elevation heatmap configuration (all heatmap layers use the same settings)
    #[wasm_bindgen(js_name = elevationMinHeight)]
    #[serde(rename = "elevationMinHeight")]
    pub elevation_min_height: f64,
    #[wasm_bindgen(js_name = elevationMaxHeight)]
    #[serde(rename = "elevationMaxHeight")]
    pub elevation_max_height: f64,
    #[wasm_bindgen(js_name = elevationRScaler)]
    #[serde(rename = "elevationRScaler")]
    pub elevation_r_scaler: f64,
    #[wasm_bindgen(js_name = elevationGScaler)]
    #[serde(rename = "elevationGScaler")]
    pub elevation_g_scaler: f64,
    #[wasm_bindgen(js_name = elevationBScaler)]
    #[serde(rename = "elevationBScaler")]
    pub elevation_b_scaler: f64,
    #[wasm_bindgen(js_name = elevationBoundary)]
    #[serde(rename = "elevationBoundary")]
    pub elevation_boundary: f64,
    #[wasm_bindgen(js_name = elevationMaxOffset)]
    #[serde(rename = "elevationMaxOffset")]
    pub elevation_max_offset: f64,
    #[wasm_bindgen(js_name = elevationMinOffset)]
    #[serde(rename = "elevationMinOffset")]
    pub elevation_min_offset: f64,
    #[wasm_bindgen(js_name = elevationEpsilon)]
    #[serde(rename = "elevationEpsilon")]
    pub elevation_epsilon: f64,
    #[wasm_bindgen(js_name = elevationOffset)]
    #[serde(rename = "elevationOffset")]
    pub elevation_offset: f64,

    pub logarithmic: bool,
    #[wasm_bindgen(js_name = logBoundary)]
    #[serde(rename = "logBoundary")]
    pub log_boundary: f64,

    // Hillshade fields
    #[wasm_bindgen(getter_with_clone, js_name = isHillshades)]
    #[serde(rename = "isHillshades")]
    pub is_hillshades: Vec<u8>,
    #[wasm_bindgen(js_name = hillshadeRScaler)]
    #[serde(rename = "hillshadeRScaler")]
    pub hillshade_r_scaler: f64,
    #[wasm_bindgen(js_name = hillshadeGScaler)]
    #[serde(rename = "hillshadeGScaler")]
    pub hillshade_g_scaler: f64,
    #[wasm_bindgen(js_name = hillshadeBScaler)]
    #[serde(rename = "hillshadeBScaler")]
    pub hillshade_b_scaler: f64,
    #[wasm_bindgen(js_name = hillshadeBoundary)]
    #[serde(rename = "hillshadeBoundary")]
    pub hillshade_boundary: f64,
    #[wasm_bindgen(js_name = hillshadeEpsilon)]
    #[serde(rename = "hillshadeEpsilon")]
    pub hillshade_epsilon: f64,
    #[wasm_bindgen(js_name = hillshadeMaxOffset)]
    #[serde(rename = "hillshadeMaxOffset")]
    pub hillshade_max_offset: f64,
    #[wasm_bindgen(js_name = hillshadeMinOffset)]
    #[serde(rename = "hillshadeMinOffset")]
    pub hillshade_min_offset: f64,
    #[wasm_bindgen(js_name = hillshadeOffset)]
    #[serde(rename = "hillshadeOffset")]
    pub hillshade_offset: f64,
    #[wasm_bindgen(js_name = hillshadeExaggeration)]
    #[serde(rename = "hillshadeExaggeration")]
    pub hillshade_exaggeration: f32,
    // Per-layer UV transforms for parent data reuse (covers both regular textures and hillshades).
    // Stored as raw Vec for internal use, exposed via getter.
    layer_uv_transforms: Vec<Option<TileUvTransform>>,

    // Per-slot flag (1/0): WebMercator raster draped on Geographic terrain that
    // the composite shader must reproject (Mercator) on the latitude axis.
    #[wasm_bindgen(getter_with_clone, js_name = layerReproject)]
    #[serde(rename = "layerReproject")]
    pub layer_reproject: Vec<u8>,
    // Terrain tile `[south, north]` latitude in radians for reprojection, or `[]`
    // when no slot reprojects (WebMercator terrain).
    #[wasm_bindgen(getter_with_clone, js_name = terrainLatRange)]
    #[serde(rename = "terrainLatRange")]
    pub terrain_lat_range: Vec<f32>,
}

#[wasm_bindgen]
impl RasterTileInternalMaterial {
    #[wasm_bindgen(js_name = layerUvTransforms)]
    pub fn layer_uv_transforms(&self) -> Vec<JsValue> {
        self.layer_uv_transforms
            .iter()
            .map(|opt| match opt {
                Some(transform) => JsValue::from(*transform),
                None => JsValue::NULL,
            })
            .collect()
    }

    pub fn texture_fragments(&self) -> Option<Vec<JsValue>> {
        self.texture_fragments.as_ref().map(|ts| {
            ts.iter()
                .map(|t| t.clone().map(|t| t.into()).unwrap_or(JsValue::null()))
                .collect()
        })
    }
}

impl<'a> From<&'a navara_material::RasterTileInternalMaterial> for RasterTileInternalMaterial {
    fn from(m: &'a navara_material::RasterTileInternalMaterial) -> Self {
        Self {
            shows: m.shows.iter().map(|s| s.to_u8()).collect(),
            colors: m.colors.clone(),
            opacities: m.opacities.clone(),
            texture_fragments: m.texture_fragments.as_ref().map(|ts| {
                ts.iter()
                    .map(|t| {
                        t.map(|t| TextureFragment {
                            ind: t.index().index(),
                            r#gen: t.generation().to_bits(),
                        })
                    })
                    .collect()
            }),
            cast_shadow: m.cast_shadow,
            receive_shadow: m.receive_shadow,
            lit: m.lit,
            show_bounding_box: m.show_bounding_box,

            // Elevation Heatmap fields
            is_elevation_heatmaps: m.is_elevation_heatmaps.iter().map(|b| b.to_u8()).collect(),
            elevation_min_height: m
                .elevation_heatmap_config
                .as_ref()
                .map(|c| c.min_height)
                .unwrap_or(0.0),
            elevation_max_height: m
                .elevation_heatmap_config
                .as_ref()
                .map(|c| c.max_height)
                .unwrap_or(1000.0),
            elevation_r_scaler: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.r_scaler)
                .unwrap_or(0.0),
            elevation_g_scaler: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.g_scaler)
                .unwrap_or(0.0),
            elevation_b_scaler: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.b_scaler)
                .unwrap_or(0.0),
            elevation_boundary: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.boundary)
                .unwrap_or(0.0),
            elevation_max_offset: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.max_offset)
                .unwrap_or(0.0),
            elevation_min_offset: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.min_offset)
                .unwrap_or(0.0),
            elevation_epsilon: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.epsilon)
                .unwrap_or(1.0),
            elevation_offset: m
                .heatmap_elevation_decoder
                .as_ref()
                .map(|d| d.offset)
                .unwrap_or(0.0),

            logarithmic: m
                .elevation_heatmap_config
                .as_ref()
                .map(|c| c.logarithmic)
                .unwrap_or(false),
            log_boundary: m
                .elevation_heatmap_config
                .as_ref()
                .map(|c| c.log_boundary)
                .unwrap_or(10.0),

            // Hillshade fields
            is_hillshades: m.is_hillshades.iter().map(|b| b.to_u8()).collect(),
            hillshade_r_scaler: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.r_scaler)
                .unwrap_or(0.0),
            hillshade_g_scaler: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.g_scaler)
                .unwrap_or(0.0),
            hillshade_b_scaler: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.b_scaler)
                .unwrap_or(0.0),
            hillshade_boundary: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.boundary)
                .unwrap_or(0.0),
            hillshade_epsilon: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.epsilon)
                .unwrap_or(0.01),
            hillshade_max_offset: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.max_offset)
                .unwrap_or(0.0),
            hillshade_min_offset: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.min_offset)
                .unwrap_or(0.0),
            hillshade_offset: m
                .hillshade_elevation_decoder
                .as_ref()
                .map(|d| d.offset)
                .unwrap_or(0.0),
            hillshade_exaggeration: m
                .hillshade_config
                .as_ref()
                .map(|c| c.exaggeration)
                .unwrap_or(1.0),
            // Per-layer UV transforms
            layer_uv_transforms: m
                .layer_uv_transforms
                .iter()
                .map(|opt| opt.as_ref().map(|t| t.into()))
                .collect(),
            layer_reproject: m.layer_reproject.iter().map(|&b| b as u8).collect(),
            terrain_lat_range: m
                .terrain_lat_range
                .map(|[s, n]| vec![s, n])
                .unwrap_or_default(),
        }
    }
}

/// Render-only appearance for a `terrain` layer's mesh, regardless of the
/// referenced source's data format (raster-dem, quantized-mesh, or the
/// source-less ellipsoid). All fetch/geometry config lives on the referenced
/// `Source`; the data format itself is carried by `TerrainDataType`.
#[wasm_bindgen]
#[derive(Debug, Clone, Deserialize)]
pub struct TerrainMaterial {
    pub show: Option<bool>,
    #[wasm_bindgen(js_name = castShadow)]
    #[serde(rename = "castShadow")]
    pub cast_shadow: Option<bool>,
    #[wasm_bindgen(js_name = receiveShadow)]
    #[serde(rename = "receiveShadow")]
    pub receive_shadow: Option<bool>,
    /// Applies the lighting equation to the color output. When `false` the
    /// material outputs plain albedo (for deferred lighting) while normals and
    /// the shadow G-buffer keep being written.
    pub lit: Option<bool>,
    #[wasm_bindgen(js_name = showBoundingBox)]
    #[serde(rename = "showBoundingBox")]
    pub show_bounding_box: Option<bool>,
    /// Whether to render skirts along tile boundaries to hide gaps.
    /// You should disable `skirt` if you want to visualize an underground model.
    pub skirt: Option<bool>,
    /// Multiplier for the automatically calculated skirt height.
    /// A value of 1.0 uses the default calculated height.
    #[wasm_bindgen(js_name = skirtExaggeration)]
    #[serde(rename = "skirtExaggeration")]
    pub skirt_exaggeration: Option<f32>,
}

impl From<TerrainMaterial> for navara_material::TerrainMaterial {
    fn from(val: TerrainMaterial) -> Self {
        val.merge(&navara_material::TerrainMaterial::default())
    }
}

impl TerrainMaterial {
    pub fn merge(
        &self,
        other: &navara_material::TerrainMaterial,
    ) -> navara_material::TerrainMaterial {
        navara_material::TerrainMaterial {
            show: self.show.unwrap_or(other.show),
            cast_shadow: self.cast_shadow.unwrap_or(other.cast_shadow),
            receive_shadow: self.receive_shadow.unwrap_or(other.receive_shadow),
            lit: self.lit.or(other.lit),
            show_bounding_box: self.show_bounding_box.unwrap_or(other.show_bounding_box),
            skirt: self.skirt.unwrap_or(other.skirt),
            skirt_exaggeration: self.skirt_exaggeration.unwrap_or(other.skirt_exaggeration),
        }
    }
}

/// Elevation-heatmap render options for a `raster` layer. The elevation decoder
/// is taken from the referenced `raster-dem` source, not from here.
#[wasm_bindgen]
#[derive(Debug, Clone, Deserialize)]
pub struct ElevationHeatmapMaterial {
    #[wasm_bindgen(js_name = maxHeight)]
    #[serde(rename = "maxHeight")]
    pub max_height: Option<f64>,
    #[wasm_bindgen(js_name = minHeight)]
    #[serde(rename = "minHeight")]
    pub min_height: Option<f64>,
    pub logarithmic: Option<bool>,
    #[wasm_bindgen(js_name = logBoundary)]
    #[serde(rename = "logBoundary")]
    pub log_boundary: Option<f64>,
}

/// Hillshade render options for a `raster` layer. The elevation decoder is taken
/// from the referenced `raster-dem` source, not from here.
#[wasm_bindgen]
#[derive(Debug, Clone, Deserialize)]
pub struct HillshadeMaterial {
    /// Exaggeration factor for hillshade effect (default: 1.0)
    pub exaggeration: Option<f32>,
}

#[cfg(test)]
mod test {
    use super::parse_geometry_types;
    use navara_material::SourceGeometryType;

    #[test]
    fn parse_geometry_types_keeps_valid_names() {
        let value = Some(vec!["line".to_string(), "polygon".to_string()]);
        assert_eq!(
            parse_geometry_types(&value),
            Some(vec![SourceGeometryType::Line, SourceGeometryType::Polygon])
        );
    }

    #[test]
    fn parse_geometry_types_drops_unknown_names() {
        let value = Some(vec!["Line".to_string(), "polygon".to_string()]);
        assert_eq!(
            parse_geometry_types(&value),
            Some(vec![SourceGeometryType::Polygon])
        );
    }

    /// The array replaces the material default even when it ends up empty:
    /// an explicitly empty array means "consume no geometry", and an
    /// all-invalid list warns instead of silently reverting to the default.
    /// Only an absent field reads as unspecified.
    #[test]
    fn parse_geometry_types_preserves_empty_result() {
        assert_eq!(parse_geometry_types(&None), None);
        assert_eq!(parse_geometry_types(&Some(vec![])), Some(vec![]));
        assert_eq!(
            parse_geometry_types(&Some(vec!["Line".to_string(), "polyline".to_string()])),
            Some(vec![])
        );
    }
}
