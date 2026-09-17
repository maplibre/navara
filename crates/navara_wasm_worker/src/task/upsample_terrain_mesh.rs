use navara_core::{TilingScheme, WGS84_64};
use navara_geometry::calculate_skirt_height;
use navara_tile_component::{QuantizedMeshData, RasterDEMData, TerrainTile};
use navara_wasm_transferable::{TransferableRasterDEMData, TransferableTile};
use navara_wasm_types::{ReturnedConstructedTerrainMesh, UpsamplableTerrainGeometry};
use wasm_bindgen::prelude::wasm_bindgen;

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = upsampleTerrainMesh)]
pub fn upsample_terrain_mesh(
    mut tile: TransferableTile,
    mut parent_tile: TransferableTile,
    raster_dem_data: TransferableRasterDEMData,
    upsamplable_geometry: UpsamplableTerrainGeometry,
    skirt: bool,
    skirt_exaggeration: f32,
    pole_north: bool,
    pole_south: bool,
    tms: bool,
) -> ReturnedConstructedTerrainMesh {
    let raster_dem_data: RasterDEMData = raster_dem_data.into();
    let tiling_scheme = TilingScheme::WebMercator { tms };

    let tile_cached_mesh_handle = tile.cached_mesh_handle.take();
    let mut tile = TerrainTile::new_with_scheme(
        tile.coords.into(),
        tile.max_height,
        tile.min_height,
        tiling_scheme.clone(),
    );
    tile.cached_mesh_handle = tile_cached_mesh_handle.map(|v| v.into());
    tile.terrain_data = Some(Box::new(raster_dem_data.clone()));

    let parent_cached_mesh_handle = parent_tile.cached_mesh_handle.take();
    let mut parent_tile = TerrainTile::new_with_scheme(
        parent_tile.coords.into(),
        parent_tile.max_height,
        parent_tile.min_height,
        tiling_scheme,
    );
    parent_tile.cached_mesh_handle = parent_cached_mesh_handle.map(|v| v.into());
    parent_tile.terrain_data = Some(Box::new(raster_dem_data));

    let upsamplable_geometry: navara_geometry::UpsamplableTerrainGeometry =
        (&upsamplable_geometry).into();

    let mut result = tile
        .upsample(WGS84_64, &parent_tile, upsamplable_geometry)
        .unwrap();

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
        &tile.extent,
        result
            .rtc_translation
            .expect("upsampling always sets an RTC translation"),
        navara_core::PoleSides {
            north: pole_north,
            south: pole_south,
        },
        skirt_height,
    );
    result.into()
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = upsampleQuantizedMeshTerrainMesh)]
pub fn upsample_quantized_mesh_terrain_mesh(
    mut tile: TransferableTile,
    mut parent_tile: TransferableTile,
    upsamplable_geometry: UpsamplableTerrainGeometry,
    skirt: bool,
    skirt_exaggeration: f32,
    pole_north: bool,
    pole_south: bool,
    geographic: bool,
    tms: bool,
) -> ReturnedConstructedTerrainMesh {
    let tiling_scheme = if geographic {
        TilingScheme::Geographic { tms }
    } else {
        TilingScheme::WebMercator { tms }
    };

    let tile_cached_mesh_handle = tile.cached_mesh_handle.take();
    let mut tile = TerrainTile::new_with_scheme(
        tile.coords.into(),
        tile.max_height,
        tile.min_height,
        tiling_scheme.clone(),
    );
    tile.cached_mesh_handle = tile_cached_mesh_handle.map(|v| v.into());
    tile.terrain_data = Some(Box::new(QuantizedMeshData::new_with_tiling_scheme(
        tiling_scheme.clone(),
    )));

    let parent_cached_mesh_handle = parent_tile.cached_mesh_handle.take();
    let mut parent_tile = TerrainTile::new_with_scheme(
        parent_tile.coords.into(),
        parent_tile.max_height,
        parent_tile.min_height,
        tiling_scheme.clone(),
    );
    parent_tile.cached_mesh_handle = parent_cached_mesh_handle.map(|v| v.into());
    parent_tile.terrain_data = Some(Box::new(QuantizedMeshData::new_with_tiling_scheme(
        tiling_scheme,
    )));

    let upsamplable_geometry: navara_geometry::UpsamplableTerrainGeometry =
        (&upsamplable_geometry).into();

    let mut result = tile
        .upsample(WGS84_64, &parent_tile, upsamplable_geometry)
        .unwrap();

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
        &tile.extent,
        result
            .rtc_translation
            .expect("upsampling always sets an RTC translation"),
        navara_core::PoleSides {
            north: pole_north,
            south: pole_south,
        },
        skirt_height,
    );
    result.into()
}
