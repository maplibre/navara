use crate::{ReturnedConstructedTerrainMesh, tile_triangles};
use navara_core::{Aabb, ElevationDecoder, Ellipsoid, Extent, Radians};
use navara_math::FloatType;

/// Decode pixels to a terrain height.
pub fn decode_height_from_dem(
    r: i64,
    g: i64,
    b: i64,
    geoid_height: FloatType,
    decoder: &ElevationDecoder,
) -> FloatType {
    let x = r as FloatType * decoder.r_scaler
        + g as FloatType * decoder.g_scaler
        + b as FloatType * decoder.b_scaler;
    let h = if x != decoder.boundary {
        if x > decoder.boundary {
            x + decoder.max_offset
        } else {
            x + decoder.min_offset
        }
    } else {
        0.
    };
    h * decoder.epsilon + decoder.offset + geoid_height
}

/// Construct a terrain geometry with RTC translation.
///
/// `mercator_v` selects the vertex row distribution (see `tile_triangles`);
/// raster-dem terrain is WebMercator, whose DEM image rows are uniform in
/// Mercator northing — the Mercator-spaced grid keeps the linear `height`
/// row lookup below exact.
#[allow(clippy::too_many_arguments)]
pub fn tile_triangles_with_terrain(
    ellipsoid: Ellipsoid<FloatType>,
    extent: &Extent<FloatType, Radians>,
    segments: usize,
    geoid_height: FloatType,
    terrain: &[u8],
    terrain_w: usize,
    terrain_h: usize,
    decoder: &ElevationDecoder,
    parent_max_height: FloatType,
    mercator_v: bool,
) -> ReturnedConstructedTerrainMesh {
    let read_height = |image_x: usize, image_y: usize| -> FloatType {
        let i = image_y * terrain_w + image_x;
        let r = terrain[i * 4] as i64;
        let g = terrain[i * 4 + 1] as i64;
        let b = terrain[i * 4 + 2] as i64;
        decode_height_from_dem(r, g, b, geoid_height, decoder)
    };
    tile_triangles_with_heights(
        ellipsoid,
        extent,
        segments,
        &read_height,
        terrain_w,
        terrain_h,
        parent_max_height,
        mercator_v,
    )
}

/// [`tile_triangles_with_terrain`] over any height source: `read_height`
/// takes DEM image coordinates (row 0 = north) of a `terrain_w × terrain_h`
/// grid, so a decoded or resampled height grid meshes the same way as raw
/// DEM pixels.
#[allow(clippy::too_many_arguments)]
pub fn tile_triangles_with_heights<F: Fn(usize, usize) -> FloatType>(
    ellipsoid: Ellipsoid<FloatType>,
    extent: &Extent<FloatType, Radians>,
    segments: usize,
    read_height: &F,
    terrain_w: usize,
    terrain_h: usize,
    parent_max_height: FloatType,
    mercator_v: bool,
) -> ReturnedConstructedTerrainMesh {
    let mut max_height: f64 = 0.0;
    let mut min_height: f64 = 9999.0;
    let mut heights = vec![];
    let mut height = |x: usize, y: usize| -> FloatType {
        let image_x = x * (terrain_w - 1) / segments;
        let image_y = (terrain_h - 1) - y * (terrain_h - 1) / segments;

        let height = read_height(image_x, image_y);

        max_height = max_height.max(height);
        min_height = min_height.min(height);

        heights.push(height as f32);

        height
    };

    // Calculate tile center using AABB from extent and terrain heights
    let aabb = Aabb::from_extent_f64(*extent, 0., parent_max_height);
    let tile_center = aabb.center;

    let geometry = tile_triangles(
        ellipsoid,
        extent,
        segments,
        &mut height,
        &tile_center,
        mercator_v,
    );

    ReturnedConstructedTerrainMesh {
        geometry,
        max_height,
        min_height,
        heights,
        rtc_translation: Some(tile_center),
        watermask: None,
    }
}

#[cfg(test)]
mod test {
    use approx::assert_abs_diff_eq;
    use navara_core::{
        ElevationDecoder, JAPAN_GSI_ELEVATION_DECODER, MAPBOX_ELEVATION_DECODER,
        TERRARIUM_ELEVATION_DECODER,
    };
    use navara_math::EPSILON3;

    use crate::decode_height_from_dem;

    /// Encode a terrain height to pixels.
    fn encode_height_to_dem(
        height: f64,
        geoid_height: f64,
        decoder: &ElevationDecoder,
    ) -> (i64, i64, i64) {
        let h = ((height - decoder.offset - geoid_height) / decoder.epsilon) as i64;
        let r = (h >> 16) & 255;
        let g = (h >> 8) & 255;
        let b = h & 255;
        (r, g, b)
    }

    #[test]
    fn test_gsi_raster_dem_conversion() {
        let decoder = JAPAN_GSI_ELEVATION_DECODER;
        let geoid_height = 1.;
        let expected_height = 3747.95;
        let decoded_rgba = encode_height_to_dem(expected_height, geoid_height, &decoder);
        let encoded_height = decode_height_from_dem(
            decoded_rgba.0,
            decoded_rgba.1,
            decoded_rgba.2,
            geoid_height,
            &decoder,
        );
        assert_abs_diff_eq!(encoded_height, expected_height, epsilon = EPSILON3);
    }

    #[test]
    fn test_mapbox_raster_dem_conversion() {
        let decoder = MAPBOX_ELEVATION_DECODER;
        let geoid_height = 1.;
        let expected_height = 407.2002;
        let decoded_rgba = encode_height_to_dem(expected_height, geoid_height, &decoder);
        let encoded_height = decode_height_from_dem(
            decoded_rgba.0,
            decoded_rgba.1,
            decoded_rgba.2,
            geoid_height,
            &decoder,
        );
        assert_abs_diff_eq!(encoded_height, expected_height, epsilon = EPSILON3);
    }

    #[test]
    fn test_terrarium_raster_dem_conversion() {
        // Ref: https://github.com/tilezen/joerd/blob/0b86765156d0612d837548c2cf70376c43b3405c/docs/formats.md#terrarium
        fn encode_terrarium(decoder: ElevationDecoder, height: f64) -> (i64, i64, i64) {
            let mut v = height;
            v -= decoder.offset;
            let r = (v / 256.0).floor();
            let g = (v % 256.0).floor();
            let b = ((v - (v).floor()) * 256.0).floor();
            (r as i64, g as i64, b as i64)
        }

        let decoder = TERRARIUM_ELEVATION_DECODER;
        let expected_height = 407.2002;
        let decoded_rgba = encode_terrarium(decoder, expected_height);
        let encoded_height =
            decode_height_from_dem(decoded_rgba.0, decoded_rgba.1, decoded_rgba.2, 0., &decoder);
        assert_abs_diff_eq!(encoded_height, expected_height, epsilon = EPSILON3);
    }
}
