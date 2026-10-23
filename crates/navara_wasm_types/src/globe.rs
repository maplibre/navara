use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// WASM wrapper for Globe resource.
///
/// This provides a JavaScript-friendly interface for accessing and modifying
/// globe configuration properties.
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Globe {
    /// Screen-space error threshold for level of detail (LOD) calculations. Initialization only.
    #[wasm_bindgen(js_name = maxSse)]
    pub max_sse: f32,

    /// Number of segments for mesh tessellation. Initialization only.
    pub segments: f32,

    /// Base color for the globe surface (RGB as u32).
    pub color: u32,

    /// Whether to hide underground geometry. Disabling this value might cause unexpected behavior when using effect.
    #[wasm_bindgen(js_name = hideUnderground)]
    pub hide_underground: bool,

    /// Whether to use normals. Initialization only.
    #[wasm_bindgen(js_name = useNormal)]
    pub use_normal: bool,

    /// Whether materials should be transparent.
    /// Note that blending works only for resource layer.
    pub transparent: bool,

    /// Global opacity for materials (0.0 to 1.0).
    pub opacity: f32,

    /// Whether to render materials in wireframe mode.
    pub wireframe: bool,

    /// Whether the globe tiles with the Geographic scheme (quantized-mesh
    /// terrain) rather than the default WebMercator. Engine-set output — the
    /// web renderer selects its raster drape pipeline (baked vs direct) from
    /// it at tile-mesh creation; ignored on input (the scheme is dictated by
    /// the terrain source, not configurable).
    #[wasm_bindgen(js_name = isGeographicTiling)]
    #[serde(default)]
    pub is_geographic_tiling: bool,
}

#[wasm_bindgen]
impl Globe {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        max_sse: f32,
        segments: f32,
        color: u32,
        hide_underground: bool,
        use_normal: bool,
        transparent: bool,
        opacity: f32,
        wireframe: bool,
    ) -> Self {
        Self {
            max_sse,
            segments,
            color,
            hide_underground,
            use_normal,
            transparent,
            opacity,
            wireframe,
            is_geographic_tiling: false,
        }
    }
}

impl From<&navara_globe::Globe> for Globe {
    fn from(val: &navara_globe::Globe) -> Self {
        Globe {
            max_sse: val.max_sse,
            segments: val.segments as f32,
            color: val.color,
            hide_underground: val.hide_underground,
            use_normal: val.use_normal,
            transparent: val.transparent,
            opacity: val.opacity,
            wireframe: val.wireframe,
            is_geographic_tiling: val.tiling_scheme.is_geographic(),
        }
    }
}

impl From<navara_globe::Globe> for Globe {
    fn from(val: navara_globe::Globe) -> Self {
        (&val).into()
    }
}

impl From<&Globe> for navara_globe::Globe {
    fn from(val: &Globe) -> Self {
        navara_globe::Globe {
            max_sse: val.max_sse,
            segments: val.segments as usize,
            color: val.color,
            hide_underground: val.hide_underground,
            use_normal: val.use_normal,
            transparent: val.transparent,
            opacity: val.opacity,
            wireframe: val.wireframe,
            tiling_scheme: Default::default(),
        }
    }
}

impl From<Globe> for navara_globe::Globe {
    fn from(val: Globe) -> Self {
        (&val).into()
    }
}
