use navara_core::{ElevationDecoder, PoleSides};

use crate::decode_height_from_dem;

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
    fn a_single_covered_row_is_kept_as_the_source() {
        let bytes = tile(&[70., 0., 0.]);
        let filled =
            fill_polar_nodata_rows(&bytes, 3, &TERRARIUM_ELEVATION_DECODER, SOUTH).unwrap();
        assert_eq!(heights(&filled, 3), [70., 70., 70.]);
    }
}
