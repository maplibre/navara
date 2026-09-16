use navara_core::{ElevationDecoder, Extent, PoleSides, Radians, TilingScheme};
use navara_math::FloatType;

use crate::decode_height_from_dem;

/// Latitude (radians, 84.9°) from which a WebMercator DEM tile is treated as
/// reaching into the dataset's polar no-data fringe. Coverage ends inside the
/// band (Mapterhorn at about 85.02°), so the tiles that need correction are
/// the ones whose polar edge lies within the outer 0.15° of the band, at any
/// zoom, not only the band-edge tile row.
pub const POLAR_NODATA_LATITUDE: FloatType = 1.481_768_5;

/// Which sides of a WebMercator tile reach into the polar no-data fringe.
pub fn polar_nodata_sides(scheme: &TilingScheme, extent: &Extent<FloatType, Radians>) -> PoleSides {
    let mercator = matches!(scheme, TilingScheme::WebMercator { .. });
    PoleSides {
        north: mercator && extent.north.val() >= POLAR_NODATA_LATITUDE,
        south: mercator && extent.south.val() <= -POLAR_NODATA_LATITUDE,
    }
}

/// Raster DEMs end their polar coverage inside the WebMercator band and encode
/// the rows beyond it as exact 0 m, which meshes as a cliff along the band edge.
/// The covered row next to that band is resampled against the 0 m fill and only
/// holds a fraction of the true height, so it is treated as no-data as well.
/// Returns a copy of the RGBA `bytes` (a `width`-pixel square) with those rows
/// replaced by the nearest covered row, or `None` when nothing needs filling.
/// Only the rows on the tile's pole side are considered; an all-zero tile is
/// genuine sea level and stays untouched.
/// Whether every pixel of the RGBA DEM decodes to 0 m. A band-edge tile that
/// lies entirely past the dataset's polar coverage looks like this.
pub fn dem_is_all_zero(bytes: &[u8], decoder: &ElevationDecoder) -> bool {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .all(|p| decode_height_from_dem(p[0] as i64, p[1] as i64, p[2] as i64, 0., decoder) == 0.)
}

/// Nearest-neighbour copy of the sub-tile an ancestor `depth` levels up covers
/// for a descendant at offset `(sx, sy)` (in descendant tiles, `y == 0` the
/// northern edge, matching XYZ ordering) into a tile of the ancestor's size.
pub fn upsample_dem_region(
    ancestor: &[u8],
    width: usize,
    depth: u32,
    (sx, sy): (usize, usize),
) -> Vec<u8> {
    // Mapped through the ancestor's own pixel grid: a per-descendant tile span
    // (`width >> depth`) truncates to zero once the ancestor is more than
    // log2(width) levels up, collapsing every pixel onto its top-left corner.
    let scale = 1usize << depth;
    let mut out = Vec::with_capacity(ancestor.len());
    for y in 0..width {
        let row = (sy * width + y) / scale;
        for x in 0..width {
            let src = (row * width + (sx * width + x) / scale) * 4;
            out.extend_from_slice(&ancestor[src..src + 4]);
        }
    }
    out
}

pub fn fill_polar_nodata_rows(
    bytes: &[u8],
    width: usize,
    decoder: &ElevationDecoder,
    sides: PoleSides,
) -> Option<Vec<u8>> {
    let stride = width * 4;
    let rows = bytes.len() / stride;
    let is_zero_row = |row: usize| {
        bytes[row * stride..][..stride]
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| {
                decode_height_from_dem(p[0] as i64, p[1] as i64, p[2] as i64, 0., decoder) == 0.
            })
    };

    let mut filled = None;
    for (enabled, north) in [(sides.north, true), (sides.south, false)] {
        if !enabled {
            continue;
        }
        // Image row 0 is the tile's north edge.
        let order: Box<dyn Iterator<Item = usize>> = if north {
            Box::new(0..rows)
        } else {
            Box::new((0..rows).rev())
        };
        let mut nodata = Vec::new();
        let mut covered = Vec::new();
        for row in order {
            if covered.len() == 2 {
                break;
            }
            if is_zero_row(row) && covered.is_empty() {
                nodata.push(row);
            } else {
                covered.push(row);
            }
        }
        if nodata.is_empty() || covered.is_empty() {
            continue;
        }
        // Drop the blended row when a fully covered one exists behind it.
        let source = *covered.last().unwrap();
        if covered.len() == 2 {
            nodata.push(covered[0]);
        }
        let out = filled.get_or_insert_with(|| bytes.to_vec());
        let src = bytes[source * stride..][..stride].to_vec();
        for row in nodata {
            out[row * stride..][..stride].copy_from_slice(&src);
        }
    }
    filled
}

#[cfg(test)]
mod tests {
    use super::*;
    use navara_core::TERRARIUM_ELEVATION_DECODER;

    fn terrarium(h: f64) -> [u8; 4] {
        let v = h + 32768.;
        [
            (v / 256.) as u8,
            (v % 256.) as u8,
            ((v * 256.) % 256.) as u8,
            255,
        ]
    }

    /// Square tile; covered rows slope one metre per column so copied rows are
    /// distinguishable from a uniform fill.
    fn tile(rows: &[f64]) -> Vec<u8> {
        let width = rows.len();
        rows.iter()
            .flat_map(|&h| {
                (0..width).flat_map(move |x| terrarium(if h == 0. { 0. } else { h + x as f64 }))
            })
            .collect()
    }

    fn heights(bytes: &[u8], width: usize) -> Vec<f64> {
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .step_by(width)
            .map(|p| {
                decode_height_from_dem(
                    p[0] as i64,
                    p[1] as i64,
                    p[2] as i64,
                    0.,
                    &TERRARIUM_ELEVATION_DECODER,
                )
            })
            .collect()
    }

    #[test]
    fn polar_fringe_covers_inner_rows_at_deep_zoom_only() {
        use navara_core::TileXYZ;
        let scheme = TilingScheme::default();
        let sides = |x, y, z| polar_nodata_sides(&scheme, &scheme.tile_extent(TileXYZ { x, y, z }));
        assert!(sides(0, 1023, 10).south);
        // Row 1019 at zoom 10 ends at 84.93°, row 1018 at 84.90°.
        assert!(sides(0, 1019, 10).south);
        assert!(!sides(0, 1018, 10).south);
        // Row 2046 at zoom 11 spans 85.05° to 85.04°: inside the fringe.
        assert!(sides(0, 2046, 11).south);
        // Row 253 at zoom 8 ends at 84.80°: outside the fringe.
        assert!(!sides(1, 253, 8).south);
        assert!(sides(0, 0, 3).north && !sides(0, 0, 3).south);
        assert_eq!(
            polar_nodata_sides(
                &TilingScheme::Geographic { tms: false },
                &TilingScheme::Geographic { tms: false }.tile_extent(TileXYZ { x: 0, y: 0, z: 0 })
            ),
            PoleSides::default()
        );
    }

    const SOUTH: PoleSides = PoleSides {
        north: false,
        south: true,
    };
    const NORTH: PoleSides = PoleSides {
        north: true,
        south: false,
    };

    #[test]
    fn fills_trailing_rows_and_the_blended_edge_row_on_the_south_side() {
        // Mapterhorn 7/10/127 at the band edge: 128, 128, 48 (blended), 0, 0.
        let bytes = tile(&[300., 250., 200., 80., 0., 0.]);
        let filled =
            fill_polar_nodata_rows(&bytes, 6, &TERRARIUM_ELEVATION_DECODER, SOUTH).unwrap();
        assert_eq!(heights(&filled, 6), [300., 250., 200., 200., 200., 200.]);
        // Every column is copied, not just the sampled one.
        assert_eq!(&filled[3 * 24..4 * 24], &bytes[2 * 24..3 * 24]);
    }

    #[test]
    fn fills_leading_rows_on_the_north_side_and_ignores_the_other_edge() {
        let bytes = tile(&[0., 0., 100., 150., 0.]);
        let filled =
            fill_polar_nodata_rows(&bytes, 5, &TERRARIUM_ELEVATION_DECODER, NORTH).unwrap();
        assert_eq!(heights(&filled, 5), [150., 150., 150., 150., 0.]);
        assert!(fill_polar_nodata_rows(&bytes, 5, &TERRARIUM_ELEVATION_DECODER, SOUTH).is_some());
        assert!(
            fill_polar_nodata_rows(
                &bytes,
                5,
                &TERRARIUM_ELEVATION_DECODER,
                PoleSides::default()
            )
            .is_none()
        );
    }

    #[test]
    fn leaves_covered_and_all_sea_level_tiles_alone() {
        let covered = tile(&[10., 20., 30., 40.]);
        assert!(fill_polar_nodata_rows(&covered, 4, &TERRARIUM_ELEVATION_DECODER, SOUTH).is_none());
        assert!(!dem_is_all_zero(&covered, &TERRARIUM_ELEVATION_DECODER));
        let sea = tile(&[0., 0., 0., 0.]);
        assert!(fill_polar_nodata_rows(&sea, 4, &TERRARIUM_ELEVATION_DECODER, SOUTH).is_none());
        assert!(dem_is_all_zero(&sea, &TERRARIUM_ELEVATION_DECODER));
        // A zero row that is not on the band edge is real data.
        let inland = tile(&[10., 0., 30., 40.]);
        assert!(fill_polar_nodata_rows(&inland, 4, &TERRARIUM_ELEVATION_DECODER, SOUTH).is_none());
    }

    #[test]
    fn a_row_with_one_covered_pixel_counts_as_covered() {
        let mut bytes = tile(&[100., 0., 0.]);
        bytes[3 * 4..3 * 4 + 4].copy_from_slice(&terrarium(5.));
        let filled =
            fill_polar_nodata_rows(&bytes, 3, &TERRARIUM_ELEVATION_DECODER, SOUTH).unwrap();
        // Row 1 is the blended edge row; row 0 is the only fully covered row.
        assert_eq!(&filled[12..24], &bytes[..12]);
        assert_eq!(&filled[24..36], &bytes[..12]);
        assert_eq!(&filled[..12], &bytes[..12]);
    }

    #[test]
    fn upsamples_the_matching_ancestor_region() {
        let parent = tile(&[10., 20., 30., 40.]);
        let child = upsample_dem_region(&parent, 4, 1, (1, 1));
        // Rows 2, 2, 3, 3 of the parent, columns 2, 2, 3, 3.
        assert_eq!(heights(&child, 4), [32., 32., 42., 42.]);
        assert_eq!(&child[..4], &parent[(2 * 4 + 2) * 4..][..4]);
        assert_eq!(&child[3 * 4..4 * 4], &parent[(2 * 4 + 3) * 4..][..4]);
        // Two levels up: the south-eastern grand-child is parent pixel (3, 3).
        let grandchild = upsample_dem_region(&parent, 4, 2, (3, 3));
        assert!(
            grandchild
                .chunks(4)
                .all(|p| p == &parent[(3 * 4 + 3) * 4..][..4])
        );
        // Deeper than log2(width): still the matching corner pixel, not (0, 0).
        let deep = upsample_dem_region(&parent, 4, 3, (7, 7));
        assert!(deep.chunks(4).all(|p| p == &parent[(3 * 4 + 3) * 4..][..4]));
        let deep = upsample_dem_region(&parent, 4, 3, (0, 0));
        assert!(deep.chunks(4).all(|p| p == &parent[..4]));
    }

    #[test]
    fn a_single_covered_row_is_kept_as_the_source() {
        let bytes = tile(&[70., 0., 0.]);
        let filled =
            fill_polar_nodata_rows(&bytes, 3, &TERRARIUM_ELEVATION_DECODER, SOUTH).unwrap();
        assert_eq!(heights(&filled, 3), [70., 70., 70.]);
    }
}
