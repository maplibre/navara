use navara_core::{TilingScheme, WGS84_64};
use navara_geometry::{calculate_skirt_height, decode_height_from_dem, resample_dem_grid};
use navara_tile_component::{
    QuantizedMeshData, RasterDEMData, TerrainConstructContext, TerrainTile,
};
use navara_wasm_transferable::{TransferableRasterDEMData, TransferableTile};
use navara_wasm_types::{ReturnedConstructedTerrainMesh, UpsamplableTerrainGeometry};
use wasm_bindgen::prelude::{JsError, wasm_bindgen};

use crate::martini_cache::with_martini;

/// Upsample a raster-DEM tile from a real-DEM ancestor: the ancestor's DEM
/// pixels are resampled down the quadrant path to this tile and meshed at
/// this tile's own level, so the result matches what the real DEM tile will
/// look like, just at a lower source resolution. The engine may have rebuilt
/// its tiling after this task was queued, in which case the source no longer
/// names an ancestor: fail the task instead of aborting the worker.
/// `martini_size` is the DEM tile width plus one (the grid is 2^n + 1).
#[wasm_bindgen(js_name = upsampleTerrainMesh)]
#[allow(clippy::too_many_arguments)]
pub fn upsample_terrain_mesh(
    mut tile: TransferableTile,
    source_tile: TransferableTile,
    raster_dem_data: TransferableRasterDEMData,
    source_bytes: Vec<u8>,
    martini_size: u32,
    skirt: bool,
    skirt_exaggeration: f32,
    pole_north: bool,
    pole_south: bool,
    tms: bool,
) -> Result<ReturnedConstructedTerrainMesh, JsError> {
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
    let source_tile = TerrainTile::new_with_scheme(
        source_tile.coords.into(),
        source_tile.max_height,
        source_tile.min_height,
        tiling_scheme,
    );

    let regions = tile
        .region_path_from(&source_tile)
        .ok_or_else(|| JsError::new("upsample source is not an ancestor of the tile"))?;

    let width = martini_size as usize - 1;
    if source_bytes.len() < width * width * 4 {
        return Err(JsError::new(
            "upsample source DEM is smaller than the tile size",
        ));
    }
    let mut source_grid = Vec::with_capacity(width * width);
    for i in 0..width * width {
        let r = source_bytes[i * 4] as i64;
        let g = source_bytes[i * 4 + 1] as i64;
        let b = source_bytes[i * 4 + 2] as i64;
        source_grid.push(decode_height_from_dem(r, g, b, 0., &raster_dem_data.decoder) as f32);
    }
    let grid = resample_dem_grid(&source_grid, width, &regions);

    let ctx = TerrainConstructContext {
        coords: tile.coords,
        extent: tile.extent,
        max_height: tile.max_height,
    };
    let mut result = with_martini(martini_size, |martini| {
        raster_dem_data.construct_terrain_mesh_from_grid(WGS84_64, &ctx, &grid, martini.get_mut())
    });

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

    Ok(result.into())
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = upsampleQuantizedMeshTerrainMesh)]
pub fn upsample_quantized_mesh_terrain_mesh(
    mut tile: TransferableTile,
    mut source_tile: TransferableTile,
    upsamplable_geometry: UpsamplableTerrainGeometry,
    skirt: bool,
    skirt_exaggeration: f32,
    pole_north: bool,
    pole_south: bool,
    geographic: bool,
    tms: bool,
) -> Result<ReturnedConstructedTerrainMesh, JsError> {
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

    let source_cached_mesh_handle = source_tile.cached_mesh_handle.take();
    let mut source_tile = TerrainTile::new_with_scheme(
        source_tile.coords.into(),
        source_tile.max_height,
        source_tile.min_height,
        tiling_scheme.clone(),
    );
    source_tile.cached_mesh_handle = source_cached_mesh_handle.map(|v| v.into());
    source_tile.terrain_data = Some(Box::new(QuantizedMeshData::new_with_tiling_scheme(
        tiling_scheme,
    )));

    let upsamplable_geometry: navara_geometry::UpsamplableTerrainGeometry =
        (&upsamplable_geometry).into();

    // The engine may have rebuilt its tiling after this task was queued, in
    // which case the handle no longer names an ancestor: fail the task
    // instead of aborting the worker.
    let mut result = tile
        .upsample(WGS84_64, &source_tile, upsamplable_geometry)
        .ok_or_else(|| JsError::new("upsample source is not an ancestor of the tile"))?;

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

    Ok(result.into())
}
