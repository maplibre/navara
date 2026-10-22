use navara_tile_component::TerrainTile;
use navara_wasm_types::{CachedMeshHandle, TileXYZ};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct TransferableTile {
    pub coords: TileXYZ,
    pub max_height: f64,
    pub min_height: f64,
    pub cached_mesh_handle: Option<CachedMeshHandle>,
}

#[wasm_bindgen]
impl TransferableTile {
    #[wasm_bindgen(constructor)]
    pub fn new(
        coords: TileXYZ,
        max_height: f64,
        min_height: f64,
        cached_mesh_handle: Option<CachedMeshHandle>,
    ) -> Self {
        Self {
            coords,
            max_height,
            min_height,
            cached_mesh_handle,
        }
    }
}

impl<'a> From<&'a TerrainTile> for TransferableTile {
    fn from(value: &'a TerrainTile) -> Self {
        Self {
            coords: value.coords.into(),
            max_height: value.max_height,
            min_height: value.min_height,
            cached_mesh_handle: value.cached_mesh_handle.clone().map(|v| v.into()),
        }
    }
}

impl From<TransferableTile> for TerrainTile {
    fn from(value: TransferableTile) -> Self {
        let mut t = Self::new(value.coords.into(), value.max_height, value.min_height);
        t.cached_mesh_handle = value.cached_mesh_handle.map(|v| v.into());
        t
    }
}
