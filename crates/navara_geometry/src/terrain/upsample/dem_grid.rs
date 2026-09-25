use navara_core::TileRegion;

/// Resample a square DEM height grid (row 0 = north, `size × size`) down the
/// quadrant path `regions` (see `TerrainTile::region_path_from`) into a grid of
/// the same size covering the descendant tile. Bilinear, with pixel centers
/// at `(i + 0.5) / size`, so a descendant grid re-meshed at its own level looks
/// like a lower-resolution version of a real tile rather than a clipped copy
/// of the ancestor's simplified mesh.
pub fn resample_dem_grid(source: &[f32], size: usize, regions: &[TileRegion]) -> Vec<f32> {
    debug_assert_eq!(source.len(), size * size);

    // The descendant's window into the source, normalized to [0, 1].
    let mut origin_u = 0.0f64;
    let mut origin_v = 0.0f64;
    let mut scale = 1.0f64;
    for region in regions {
        scale *= 0.5;
        let (east, north) = match region {
            TileRegion::NorthWest => (false, true),
            TileRegion::NorthEast => (true, true),
            TileRegion::SouthWest => (false, false),
            TileRegion::SouthEast => (true, false),
        };
        if east {
            origin_u += scale;
        }
        if !north {
            origin_v += scale;
        }
    }

    let max = (size - 1) as f64;
    let sample = |px: f64, py: f64| -> f32 {
        let px = px.clamp(0.0, max);
        let py = py.clamp(0.0, max);
        let x0 = px.floor() as usize;
        let y0 = py.floor() as usize;
        let x1 = (x0 + 1).min(size - 1);
        let y1 = (y0 + 1).min(size - 1);
        let fx = (px - x0 as f64) as f32;
        let fy = (py - y0 as f64) as f32;
        let top = source[y0 * size + x0] * (1.0 - fx) + source[y0 * size + x1] * fx;
        let bottom = source[y1 * size + x0] * (1.0 - fx) + source[y1 * size + x1] * fx;
        top * (1.0 - fy) + bottom * fy
    };

    let mut out = Vec::with_capacity(size * size);
    for y in 0..size {
        let v = origin_v + (y as f64 + 0.5) / size as f64 * scale;
        let py = v * size as f64 - 0.5;
        for x in 0..size {
            let u = origin_u + (x as f64 + 0.5) / size as f64 * scale;
            let px = u * size as f64 - 0.5;
            out.push(sample(px, py));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 4×4 ramp: height = column index * 10 + row index * 100.
    fn ramp() -> Vec<f32> {
        (0..4)
            .flat_map(|y| (0..4).map(move |x| (x * 10 + y * 100) as f32))
            .collect()
    }

    #[test]
    fn empty_path_resamples_the_whole_grid_onto_itself() {
        let src = ramp();
        let out = resample_dem_grid(&src, 4, &[]);
        assert_eq!(out, src);
    }

    #[test]
    fn north_west_child_covers_the_top_left_quarter() {
        let src = ramp();
        let out = resample_dem_grid(&src, 4, &[TileRegion::NorthWest]);
        // Child pixel centers land on source pixel coordinates -0.25 (clamped
        // to 0), 0.25, 0.75 and 1.25 along both axes.
        assert!((out[0] - 0.0).abs() < 1e-4, "{}", out[0]);
        assert!((out[3] - 12.5).abs() < 1e-4, "{}", out[3]);
        assert!((out[15] - (12.5 + 125.0)).abs() < 1e-4, "{}", out[15]);
    }

    #[test]
    fn south_east_child_covers_the_bottom_right_quarter() {
        let src = ramp();
        let out = resample_dem_grid(&src, 4, &[TileRegion::SouthEast]);
        // Source pixel coordinates 1.75..=3 along both axes (clamped at the
        // edge), so the first sample is 17.5 + 175 and the last 30 + 300.
        assert!((out[0] - 192.5).abs() < 1e-4, "{}", out[0]);
        assert!(out.iter().all(|h| *h >= 192.5 - 1e-4), "{out:?}");
        assert!((out[15] - (30.0 + 300.0)).abs() < 1e-4, "{}", out[15]);
    }

    #[test]
    fn two_level_path_matches_composing_the_windows() {
        let src: Vec<f32> = (0..64).map(|i| i as f32).collect();
        let direct = resample_dem_grid(&src, 8, &[TileRegion::NorthEast, TileRegion::SouthWest]);
        // The window of NE→SW is u in [0.5, 0.75], v in [0.25, 0.5]: source
        // pixel coordinates 3.625..=5.375 in x and 1.625..=3.375 in y, so the
        // ramp `row * 8 + col` spans 16.625..=32.375, corners first and last.
        assert_eq!(direct.len(), 64);
        assert!((direct[0] - 16.625).abs() < 1e-4, "{}", direct[0]);
        assert!((direct[63] - 32.375).abs() < 1e-4, "{}", direct[63]);
        for h in &direct {
            assert!((16.625 - 1e-4..=32.375 + 1e-4).contains(h), "{h}");
        }
    }
}
