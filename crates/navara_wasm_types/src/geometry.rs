use js_sys::{Float32Array, Uint8Array, Uint32Array};
use navara_math::FloatType;
use serde::Deserialize;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{Vec3, copy_f32_array, copy_u8_array, copy_u32_array};

#[wasm_bindgen]
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
pub struct Geometry {
    /// Vector of vertex. The stride is 3.
    vertices: Vec<f32>,
    /// Vector of UV for a texture. The stride is 2.
    uvs: Vec<f32>,
    /// Vector of index that constructs a triangle.
    indices: Vec<u32>,
    /// Per-vertex normals (terrain only). Stride is 3.
    normals: Option<Vec<f32>>,
    /// Vector of skirt vertex. The stride is 3.
    skirt_vertices: Option<Vec<f32>>,
    /// Vector of skirt UV. The stride is 2.
    skirt_uvs: Option<Vec<f32>>,
    /// Vector of skirt index that constructs a triangle.
    skirt_indices: Option<Vec<u32>>,
    /// Per-vertex skirt normals copied from corresponding edge vertices. Stride is 3.
    skirt_normals: Option<Vec<f32>>,
    /// Terrain height of every skirt vertex.
    skirt_heights: Option<Vec<f32>>,
}

#[wasm_bindgen]
impl Geometry {
    #[wasm_bindgen(constructor)]
    pub fn new(vertices: Vec<f32>, indices: Vec<u32>, uvs: Vec<f32>) -> Self {
        Self {
            vertices,
            indices,
            uvs,
            normals: None,
            skirt_vertices: None,
            skirt_uvs: None,
            skirt_indices: None,
            skirt_normals: None,
            skirt_heights: None,
        }
    }

    #[wasm_bindgen(js_name = "transferVertices")]
    pub fn transfer_vertices(&self) -> Float32Array {
        copy_f32_array(&self.vertices)
    }

    #[wasm_bindgen(js_name = "transferUvs")]
    pub fn transfer_uvs(&self) -> Float32Array {
        copy_f32_array(&self.uvs)
    }

    #[wasm_bindgen(js_name = "transferIndices")]
    pub fn transfer_indices(&self) -> Uint32Array {
        copy_u32_array(&self.indices)
    }

    #[wasm_bindgen(js_name = "transferSkirtVertices")]
    pub fn transfer_skirt_vertices(&self) -> Option<Float32Array> {
        self.skirt_vertices.as_ref().map(|v| copy_f32_array(v))
    }

    #[wasm_bindgen(js_name = "transferSkirtUvs")]
    pub fn transfer_skirt_uvs(&self) -> Option<Float32Array> {
        self.skirt_uvs.as_ref().map(|v| copy_f32_array(v))
    }

    #[wasm_bindgen(js_name = "transferSkirtIndices")]
    pub fn transfer_skirt_indices(&self) -> Option<Uint32Array> {
        self.skirt_indices.as_ref().map(|v| copy_u32_array(v))
    }

    #[wasm_bindgen(js_name = "transferNormals")]
    pub fn transfer_normals(&self) -> Option<Float32Array> {
        self.normals.as_ref().map(|v| copy_f32_array(v))
    }

    #[wasm_bindgen(js_name = "transferSkirtNormals")]
    pub fn transfer_skirt_normals(&self) -> Option<Float32Array> {
        self.skirt_normals.as_ref().map(|v| copy_f32_array(v))
    }

    #[wasm_bindgen(js_name = "transferSkirtHeights")]
    pub fn transfer_skirt_heights(&self) -> Option<Float32Array> {
        self.skirt_heights.as_ref().map(|v| copy_f32_array(v))
    }

    #[wasm_bindgen(js_name = "hasSkirt")]
    pub fn has_skirt(&self) -> bool {
        self.skirt_vertices.is_some()
    }

    #[wasm_bindgen(js_name = "hasNormals")]
    pub fn has_normals(&self) -> bool {
        self.normals.is_some()
    }
}

impl From<navara_geometry::Geometry> for Geometry {
    fn from(d: navara_geometry::Geometry) -> Self {
        Self {
            vertices: d.vertices,
            uvs: d.uvs,
            indices: d.indices,
            normals: d.normals,
            skirt_vertices: d.skirt_vertices,
            skirt_uvs: d.skirt_uvs,
            skirt_indices: d.skirt_indices,
            skirt_normals: d.skirt_normals,
            skirt_heights: d.skirt_heights,
        }
    }
}

impl From<Geometry> for navara_geometry::Geometry {
    fn from(d: Geometry) -> Self {
        Self {
            vertices: d.vertices,
            uvs: d.uvs,
            indices: d.indices,
            normals: d.normals,
            skirt_vertices: d.skirt_vertices,
            skirt_uvs: d.skirt_uvs,
            skirt_indices: d.skirt_indices,
            skirt_normals: d.skirt_normals,
            skirt_heights: d.skirt_heights,
        }
    }
}

#[wasm_bindgen]
pub struct ReturnedConstructedTerrainMesh {
    geometry: Geometry,
    pub max_height: FloatType,
    pub min_height: FloatType,
    heights: Vec<f32>,
    pub rtc_translation: Option<Vec3>,
    watermask: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl ReturnedConstructedTerrainMesh {
    #[wasm_bindgen(constructor)]
    pub fn new(
        geometry: Geometry,
        max_height: FloatType,
        min_height: FloatType,
        heights: Vec<f32>,
        rtc_translation: Option<Vec3>,
    ) -> Self {
        Self {
            geometry,
            max_height,
            min_height,
            heights,
            rtc_translation,
            watermask: None,
        }
    }

    #[wasm_bindgen(js_name = "transferVertices")]
    pub fn transfer_vertices(&self) -> Float32Array {
        self.geometry.transfer_vertices()
    }

    #[wasm_bindgen(js_name = "transferUvs")]
    pub fn transfer_uvs(&self) -> Float32Array {
        self.geometry.transfer_uvs()
    }

    #[wasm_bindgen(js_name = "transferIndices")]
    pub fn transfer_indices(&self) -> Uint32Array {
        self.geometry.transfer_indices()
    }

    #[wasm_bindgen(js_name = "transferHeights")]
    pub fn transfer_heights(&self) -> Float32Array {
        copy_f32_array(&self.heights)
    }

    #[wasm_bindgen(js_name = "transferSkirtVertices")]
    pub fn transfer_skirt_vertices(&self) -> Option<Float32Array> {
        self.geometry.transfer_skirt_vertices()
    }

    #[wasm_bindgen(js_name = "transferSkirtUvs")]
    pub fn transfer_skirt_uvs(&self) -> Option<Float32Array> {
        self.geometry.transfer_skirt_uvs()
    }

    #[wasm_bindgen(js_name = "transferSkirtIndices")]
    pub fn transfer_skirt_indices(&self) -> Option<Uint32Array> {
        self.geometry.transfer_skirt_indices()
    }

    #[wasm_bindgen(js_name = "transferNormals")]
    pub fn transfer_normals(&self) -> Option<Float32Array> {
        self.geometry.transfer_normals()
    }

    #[wasm_bindgen(js_name = "transferSkirtNormals")]
    pub fn transfer_skirt_normals(&self) -> Option<Float32Array> {
        self.geometry.transfer_skirt_normals()
    }

    #[wasm_bindgen(js_name = "transferSkirtHeights")]
    pub fn transfer_skirt_heights(&self) -> Option<Float32Array> {
        self.geometry.transfer_skirt_heights()
    }

    #[wasm_bindgen(js_name = "transferWatermask")]
    pub fn transfer_watermask(&self) -> Option<Uint8Array> {
        self.watermask.as_ref().map(|v| copy_u8_array(v))
    }

    #[wasm_bindgen(js_name = "hasSkirt")]
    pub fn has_skirt(&self) -> bool {
        self.geometry.has_skirt()
    }

    #[wasm_bindgen(js_name = "hasNormals")]
    pub fn has_normals(&self) -> bool {
        self.geometry.has_normals()
    }

    #[wasm_bindgen(js_name = "hasWatermask")]
    pub fn has_watermask(&self) -> bool {
        self.watermask.is_some()
    }
}

impl From<navara_geometry::ReturnedConstructedTerrainMesh> for ReturnedConstructedTerrainMesh {
    fn from(d: navara_geometry::ReturnedConstructedTerrainMesh) -> Self {
        Self {
            geometry: d.geometry.into(),
            max_height: d.max_height,
            min_height: d.min_height,
            heights: d.heights,
            rtc_translation: d.rtc_translation.map(|v| v.into()),
            watermask: d.watermask,
        }
    }
}

impl From<ReturnedConstructedTerrainMesh> for navara_geometry::ReturnedConstructedTerrainMesh {
    fn from(d: ReturnedConstructedTerrainMesh) -> Self {
        Self {
            geometry: d.geometry.into(),
            max_height: d.max_height,
            min_height: d.min_height,
            heights: d.heights,
            rtc_translation: d.rtc_translation.map(|v| v.into()),
            watermask: d.watermask,
        }
    }
}

#[wasm_bindgen]
pub struct UpsamplableTerrainGeometry {
    uvs: Vec<f32>,
    heights: Vec<f32>,
    indices: Vec<u32>,
    normals: Option<Vec<f32>>,
    watermask: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl UpsamplableTerrainGeometry {
    #[wasm_bindgen(constructor)]
    pub fn new(
        uvs: Vec<f32>,
        indices: Vec<u32>,
        heights: Vec<f32>,
        normals: Option<Vec<f32>>,
        watermask: Option<Vec<u8>>,
    ) -> Self {
        Self {
            uvs,
            indices,
            heights,
            normals,
            watermask,
        }
    }
}

impl<'a> From<navara_geometry::UpsamplableTerrainGeometry<'a>> for UpsamplableTerrainGeometry {
    fn from(d: navara_geometry::UpsamplableTerrainGeometry<'a>) -> Self {
        Self {
            uvs: d.uvs.to_vec(),
            heights: d.heights.to_vec(),
            indices: d.indices.to_vec(),
            normals: d.normals.map(|n| n.to_vec()),
            watermask: d.watermask.map(|w| w.to_vec()),
        }
    }
}

impl<'a> From<&'a UpsamplableTerrainGeometry> for navara_geometry::UpsamplableTerrainGeometry<'a> {
    fn from(d: &'a UpsamplableTerrainGeometry) -> Self {
        Self {
            uvs: &d.uvs,
            heights: &d.heights,
            indices: &d.indices,
            normals: d.normals.as_deref(),
            watermask: d.watermask.as_deref(),
        }
    }
}
