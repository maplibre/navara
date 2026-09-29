use navara_buffer_store::Handle;
use navara_math::FloatType;
use navara_tile_component::TileHandle;
use navara_wasm_types::Vec3;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::geometry::TransferableGeometry;

#[wasm_bindgen]
#[derive(Clone, Debug, Serialize)]
pub struct UpsampleTerrainMeshParameters {
    #[wasm_bindgen(getter_with_clone)]
    pub tile_handle: TileHandle,
    /// The ancestor tile whose mesh is clipped down to `tile_handle`.
    #[wasm_bindgen(getter_with_clone)]
    pub source_tile_handle: TileHandle,
    /// DEM tile width in pixels (raster DEM only).
    pub tile_size: u32,
    /// Whether to render skirts along tile boundaries.
    pub skirt: bool,
    #[wasm_bindgen(js_name = poleNorth)]
    pub pole_north: bool,
    #[wasm_bindgen(js_name = poleSouth)]
    pub pole_south: bool,
    /// Multiplier for the automatically calculated skirt height.
    #[wasm_bindgen(js_name = skirtExaggeration)]
    pub skirt_exaggeration: f32,
    #[wasm_bindgen(js_name = isQuantizedMesh)]
    pub is_quantized_mesh: bool,
    pub geographic: bool,
    pub tms: bool,
}

#[wasm_bindgen]
impl UpsampleTerrainMeshParameters {
    #[wasm_bindgen(constructor)]
    pub fn new(
        tile_handle: TileHandle,
        source_tile_handle: TileHandle,
        tile_size: u32,
        skirt: bool,
        skirt_exaggeration: f32,
    ) -> Self {
        Self {
            tile_handle,
            source_tile_handle,
            tile_size,
            skirt,
            pole_north: false,
            pole_south: false,
            skirt_exaggeration,
            is_quantized_mesh: false,
            geographic: false,
            tms: false,
        }
    }
}

impl<'a> From<&'a navara_worker::upsample_terrain_mesh::UpsampleTerrainMeshParameters>
    for UpsampleTerrainMeshParameters
{
    fn from(
        val: &'a navara_worker::upsample_terrain_mesh::UpsampleTerrainMeshParameters,
    ) -> UpsampleTerrainMeshParameters {
        UpsampleTerrainMeshParameters {
            tile_handle: val.tile_handle,
            source_tile_handle: val.source_tile_handle,
            tile_size: val.tile_size,
            skirt: val.skirt,
            pole_north: val.pole_sides.0,
            pole_south: val.pole_sides.1,
            skirt_exaggeration: val.skirt_exaggeration,
            is_quantized_mesh: val.is_quantized_mesh,
            geographic: val.geographic,
            tms: val.tms,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug, Serialize)]
pub struct UpsampleTerrainMeshResult {
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferableGeometry,
    pub heights: Handle,
    pub min_height: FloatType,
    pub max_height: FloatType,
    pub rtc_translation: Option<Vec3>,
    pub watermask: Option<Handle>,
}

#[wasm_bindgen]
impl UpsampleTerrainMeshResult {
    #[wasm_bindgen(constructor)]
    pub fn new(
        geometry: TransferableGeometry,
        heights: Handle,
        min_height: FloatType,
        max_height: FloatType,
        rtc_translation: Option<Vec3>,
    ) -> Self {
        Self {
            geometry,
            heights,
            min_height,
            max_height,
            rtc_translation,
            watermask: None,
        }
    }
}

impl From<UpsampleTerrainMeshResult>
    for navara_worker::upsample_terrain_mesh::UpsampleTerrainMeshResult
{
    fn from(val: UpsampleTerrainMeshResult) -> Self {
        navara_worker::upsample_terrain_mesh::UpsampleTerrainMeshResult {
            geometry: val.geometry.into(),
            heights: val.heights,
            min_height: val.min_height,
            max_height: val.max_height,
            rtc_translation: val.rtc_translation.map(|r| r.into()),
            watermask: val.watermask,
        }
    }
}
impl<'a> From<&'a navara_worker::upsample_terrain_mesh::UpsampleTerrainMeshResult>
    for UpsampleTerrainMeshResult
{
    fn from(
        val: &'a navara_worker::upsample_terrain_mesh::UpsampleTerrainMeshResult,
    ) -> UpsampleTerrainMeshResult {
        UpsampleTerrainMeshResult {
            geometry: (&val.geometry).into(),
            heights: val.heights,
            min_height: val.min_height,
            max_height: val.max_height,
            rtc_translation: val.rtc_translation.map(|r| r.into()),
            watermask: val.watermask,
        }
    }
}
