use navara_core::WGS84_64;
use navara_geometry::calculate_skirt_height;
use navara_tile_component::{
    MartiniComponent, RasterDEMData, TerrainConstructContext, TerrainData, TerrainTile,
};
use navara_wasm_transferable::{TransferableMartini, TransferableRasterDEMData, TransferableTile};
use navara_wasm_types::ReturnedConstructedTerrainMesh;
use wasm_bindgen::prelude::wasm_bindgen;

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = constructTerrainMesh)]
pub fn construct_terrain_mesh(
    bytes: &[u8],
    tile: TransferableTile,
    raster_dem_data: TransferableRasterDEMData,
    martini: TransferableMartini,
    skirt: bool,
    skirt_exaggeration: f32,
    pole_north: bool,
    pole_south: bool,
) -> ReturnedConstructedTerrainMesh {
    let tile: TerrainTile = tile.into();
    let raster_dem_data: RasterDEMData = raster_dem_data.into();
    let ctx = TerrainConstructContext {
        coords: tile.coords,
        extent: tile.extent,
        max_height: tile.max_height,
    };

    let mut martini: MartiniComponent = martini.into();

    let mut result =
        raster_dem_data.construct_terrain_mesh(WGS84_64, &ctx, bytes, 0., Some(martini.get_mut()));

    // Computed unconditionally: the polar cap closes its meridian seams with a
    // curtain of this depth even when grid skirts are switched off, since those
    // seams are cracks rather than cosmetic.
    let skirt_height = calculate_skirt_height(&WGS84_64, tile.coords.z, skirt_exaggeration);
    if skirt {
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
        skirt_height,
    );
    result.into()
}
