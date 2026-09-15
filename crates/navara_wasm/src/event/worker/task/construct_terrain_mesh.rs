use navara_buffer_store::Handle;
use navara_math::FloatType;
use navara_tile_component::TileHandle;
use navara_wasm_types::Vec3;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::geometry::TransferableGeometry;

#[wasm_bindgen]
#[derive(Clone, Debug, Serialize)]
pub struct ConstructTerrainMeshParameters {
    #[wasm_bindgen(getter_with_clone)]
    pub tile_size: u32,
    pub bytes_handle: Handle,
    pub tile_handle: TileHandle,
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

impl<'a> From<&'a navara_worker::construct_terrain_mesh::ConstructTerrainMeshParameters>
    for ConstructTerrainMeshParameters
{
    fn from(
        val: &'a navara_worker::construct_terrain_mesh::ConstructTerrainMeshParameters,
    ) -> ConstructTerrainMeshParameters {
        ConstructTerrainMeshParameters {
            tile_size: val.tile_size,
            bytes_handle: val.bytes_handle,
            tile_handle: val.tile_handle,
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
pub struct ConstructTerrainMeshResult {
    #[wasm_bindgen(getter_with_clone)]
    pub geometry: TransferableGeometry,
    pub heights: Handle,
    pub min_height: FloatType,
    pub max_height: FloatType,
    pub rtc_translation: Option<Vec3>,
    pub watermask: Option<Handle>,
}

#[wasm_bindgen]
impl ConstructTerrainMeshResult {
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

impl From<ConstructTerrainMeshResult>
    for navara_worker::construct_terrain_mesh::ConstructTerrainMeshResult
{
    fn from(val: ConstructTerrainMeshResult) -> Self {
        navara_worker::construct_terrain_mesh::ConstructTerrainMeshResult {
            geometry: val.geometry.into(),
            heights: val.heights,
            min_height: val.min_height,
            max_height: val.max_height,
            rtc_translation: val.rtc_translation.map(|r| r.into()),
            watermask: val.watermask,
        }
    }
}
impl<'a> From<&'a navara_worker::construct_terrain_mesh::ConstructTerrainMeshResult>
    for ConstructTerrainMeshResult
{
    fn from(
        val: &'a navara_worker::construct_terrain_mesh::ConstructTerrainMeshResult,
    ) -> ConstructTerrainMeshResult {
        ConstructTerrainMeshResult {
            geometry: (&val.geometry).into(),
            heights: val.heights,
            min_height: val.min_height,
            max_height: val.max_height,
            rtc_translation: val.rtc_translation.map(|r| r.into()),
            watermask: val.watermask,
        }
    }
}
