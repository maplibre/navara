use navara_core::{TilingScheme, WGS84_64};
use navara_geometry::calculate_skirt_height;
use navara_tile_component::{QuantizedMeshData, TerrainConstructContext, TerrainData, TerrainTile};
use navara_wasm_transferable::TransferableTile;
use navara_wasm_types::ReturnedConstructedTerrainMesh;
use wasm_bindgen::prelude::wasm_bindgen;

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = constructQuantizedMeshTerrainMesh)]
pub fn construct_quantized_mesh_terrain_mesh(
    bytes: &[u8],
    tile: TransferableTile,
    skirt: bool,
    skirt_exaggeration: f32,
    pole_north: bool,
    pole_south: bool,
    geographic: bool,
    tms: bool,
) -> ReturnedConstructedTerrainMesh {
    let tile: TerrainTile = tile.into();
    // TransferableTile.into() uses WebMercator by default; recompute with the actual scheme.
    let tiling_scheme = if geographic {
        TilingScheme::Geographic { tms }
    } else {
        TilingScheme::WebMercator { tms }
    };
    let extent = tiling_scheme.tile_extent(tile.coords);
    let ctx = TerrainConstructContext {
        coords: tile.coords,
        extent,
        max_height: tile.max_height,
    };
    let terrain_data = QuantizedMeshData::new_with_tiling_scheme(tiling_scheme);
    let mut result = terrain_data.construct_terrain_mesh(WGS84_64, &ctx, bytes, 0., None);

    if skirt {
        let skirt_height = calculate_skirt_height(&WGS84_64, tile.coords.z, skirt_exaggeration);
        let down_dir_fn = navara_geometry::make_wgs84_down_dir_fn(WGS84_64, result.rtc_translation);
        navara_geometry::add_skirt_separate(&mut result.geometry, skirt_height, &down_dir_fn);
    }

    navara_geometry::add_pole_extension(
        &mut result.geometry,
        WGS84_64,
        &ctx.extent,
        result.rtc_translation.unwrap(),
        navara_core::PoleSides {
            north: pole_north,
            south: pole_south,
        },
    );
    result.into()
}
