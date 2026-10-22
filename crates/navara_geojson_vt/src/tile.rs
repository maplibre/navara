use std::sync::Arc;

use crate::Options;
use crate::types::{
    BBox, InternalFeature, InternalGeometry, Ring, Tile, TileFeature, TileGeometry, TileLine,
};

/// Creates an output Tile from internal features.
///
/// 1. Computes per-zoom simplification tolerance
/// 2. Filters points by z-coord importance > sqTolerance
/// 3. Skips small geometries (area/dist < threshold)
/// 4. Transforms coordinates to tile-local extent space
/// 5. Rewinds polygon rings for correct winding order
pub fn create_tile(
    features: &[Arc<InternalFeature>],
    z: u32,
    x: u32,
    y: u32,
    options: &Options,
) -> Tile {
    let tolerance = if z == options.max_zoom {
        0.0
    } else {
        options.tolerance / ((1u64 << z) as f64 * options.extent as f64)
    };
    let sq_tolerance = tolerance * tolerance;

    let z2 = (1u32 << z) as f64;
    let tile_x = x as f64;
    let tile_y = y as f64;
    let extent = options.extent as f64;

    let mut features_bbox = if features.is_empty() {
        None
    } else {
        Some(BBox::new())
    };

    let mut num_points: u32 = 0;
    let mut num_simplified: u32 = 0;

    let mut tile_features = Vec::with_capacity(features.len());
    for f in features {
        if let Some(geom) = transform_geometry(
            &f.geometry,
            z2,
            tile_x,
            tile_y,
            extent,
            tolerance,
            sq_tolerance,
            &mut num_points,
            &mut num_simplified,
        ) {
            tile_features.push(TileFeature {
                geometry: geom,
                properties: f.properties.clone(),
            });
        }

        if let Some(bbox) = &mut features_bbox {
            bbox.extend(f.bbox.min_x, f.bbox.min_y);
            bbox.extend(f.bbox.max_x, f.bbox.max_y);
        }
    }

    Tile {
        features: tile_features,
        z,
        x,
        y,
        num_points,
        num_simplified,
        features_bbox,
    }
}

#[allow(clippy::too_many_arguments)]
fn transform_geometry(
    geometry: &InternalGeometry,
    z2: f64,
    tile_x: f64,
    tile_y: f64,
    extent: f64,
    tolerance: f64,
    sq_tolerance: f64,
    num_points: &mut u32,
    num_simplified: &mut u32,
) -> Option<TileGeometry> {
    match geometry {
        InternalGeometry::Point(coords) => {
            let p = transform_point(coords[0], coords[1], z2, tile_x, tile_y, extent);
            *num_points += 1;
            *num_simplified += 1;
            Some(TileGeometry::Points(vec![p]))
        }
        InternalGeometry::MultiPoint(coords) => {
            let n = coords.len() / 3;
            let mut points = Vec::with_capacity(n);
            for i in 0..n {
                points.push(transform_point(
                    coords[i * 3],
                    coords[i * 3 + 1],
                    z2,
                    tile_x,
                    tile_y,
                    extent,
                ));
                *num_points += 1;
                *num_simplified += 1;
            }
            if points.is_empty() {
                None
            } else {
                Some(TileGeometry::Points(points))
            }
        }
        InternalGeometry::LineString(ring) => {
            let mut lines: Vec<TileLine> = Vec::with_capacity(1);
            add_tile_line(
                &mut lines,
                ring,
                z2,
                tile_x,
                tile_y,
                extent,
                tolerance,
                sq_tolerance,
                num_points,
                num_simplified,
            );
            if lines.is_empty() {
                None
            } else {
                Some(TileGeometry::Lines(lines))
            }
        }
        InternalGeometry::MultiLineString(rings) => {
            let mut lines: Vec<TileLine> = Vec::with_capacity(rings.len());
            for ring in rings {
                add_tile_line(
                    &mut lines,
                    ring,
                    z2,
                    tile_x,
                    tile_y,
                    extent,
                    tolerance,
                    sq_tolerance,
                    num_points,
                    num_simplified,
                );
            }
            if lines.is_empty() {
                None
            } else {
                Some(TileGeometry::Lines(lines))
            }
        }
        InternalGeometry::Polygon(rings) => {
            let mut polygon_rings: Vec<Vec<[f64; 2]>> = Vec::with_capacity(rings.len());
            for (i, ring) in rings.iter().enumerate() {
                add_line(
                    &mut polygon_rings,
                    ring,
                    z2,
                    tile_x,
                    tile_y,
                    extent,
                    tolerance,
                    sq_tolerance,
                    true,
                    i == 0,
                    num_points,
                    num_simplified,
                );
            }
            if polygon_rings.is_empty() {
                None
            } else {
                Some(TileGeometry::Polygons(vec![polygon_rings]))
            }
        }
        InternalGeometry::MultiPolygon(polygons) => {
            // Keep each member polygon's rings grouped: downstream consumers
            // read `polygon[0]` as the outer ring and `polygon[1..]` as holes,
            // so flattening every member's rings into one polygon would turn
            // the 2nd..Nth outer rings into holes of the 1st.
            let mut all_polygons: Vec<Vec<Vec<[f64; 2]>>> = Vec::with_capacity(polygons.len());
            for rings in polygons {
                let mut polygon_rings: Vec<Vec<[f64; 2]>> = Vec::with_capacity(rings.len());
                for (i, ring) in rings.iter().enumerate() {
                    add_line(
                        &mut polygon_rings,
                        ring,
                        z2,
                        tile_x,
                        tile_y,
                        extent,
                        tolerance,
                        sq_tolerance,
                        true,
                        i == 0,
                        num_points,
                        num_simplified,
                    );
                }
                if !polygon_rings.is_empty() {
                    all_polygons.push(polygon_rings);
                }
            }
            if all_polygons.is_empty() {
                None
            } else {
                Some(TileGeometry::Polygons(all_polygons))
            }
        }
    }
}

/// [`add_line`] for a line ring, keeping where the line starts on the original one.
#[allow(clippy::too_many_arguments)]
fn add_tile_line(
    result: &mut Vec<TileLine>,
    ring: &Ring,
    z2: f64,
    tile_x: f64,
    tile_y: f64,
    extent: f64,
    tolerance: f64,
    sq_tolerance: f64,
    num_points: &mut u32,
    num_simplified: &mut u32,
) {
    let mut lines = Vec::with_capacity(1);
    add_line(
        &mut lines,
        ring,
        z2,
        tile_x,
        tile_y,
        extent,
        tolerance,
        sq_tolerance,
        false,
        false,
        num_points,
        num_simplified,
    );
    if let Some(points) = lines.pop() {
        result.push(TileLine {
            points,
            // The scale `transform_point` gives a distance in [0,1] space.
            start: ring.line_start * z2 * extent,
        });
    }
}

/// Filters points by simplification importance, skips small geometries,
/// rewinds polygon rings, and transforms to tile space.
#[allow(clippy::too_many_arguments)]
fn add_line(
    result: &mut Vec<Vec<[f64; 2]>>,
    ring: &Ring,
    z2: f64,
    tile_x: f64,
    tile_y: f64,
    extent: f64,
    tolerance: f64,
    sq_tolerance: f64,
    is_polygon: bool,
    is_outer: bool,
    num_points: &mut u32,
    num_simplified: &mut u32,
) {
    let n = ring.len();

    // Skip small geometries
    if tolerance > 0.0 && (ring.size < if is_polygon { sq_tolerance } else { tolerance }) {
        *num_points += n as u32;
        return;
    }

    // Filter points by importance and transform to tile space
    let mut pts: Vec<[f64; 2]> = Vec::with_capacity(n);
    for i in 0..n {
        let z_importance = ring.coords[i * 3 + 2];
        if tolerance == 0.0 || z_importance > sq_tolerance {
            *num_simplified += 1;
            let x = ring.coords[i * 3];
            let y = ring.coords[i * 3 + 1];
            pts.push(transform_point(x, y, z2, tile_x, tile_y, extent));
        }
        *num_points += 1;
    }

    if pts.is_empty() {
        return;
    }

    if is_polygon {
        rewind(&mut pts, is_outer);
    }

    result.push(pts);
}

/// Transforms a point from [0,1] space to tile-local extent space.
fn transform_point(x: f64, y: f64, z2: f64, tile_x: f64, tile_y: f64, extent: f64) -> [f64; 2] {
    [(extent * (x * z2 - tile_x)), (extent * (y * z2 - tile_y))]
}

/// Rewinds a polygon ring to ensure correct winding order.
/// Outer rings should be clockwise (area < 0), inner rings counter-clockwise (area > 0).
fn rewind(ring: &mut [[f64; 2]], clockwise: bool) {
    let len = ring.len();
    if len < 2 {
        return;
    }

    // Calculate signed area using shoelace formula on 2D points
    let mut area = 0.0;
    let mut j = len - 1;
    for i in 0..len {
        area += (ring[i][0] - ring[j][0]) * (ring[i][1] + ring[j][1]);
        j = i;
    }

    // area > 0 means counter-clockwise in tile coords (Y-down)
    if (area > 0.0) != clockwise {
        return; // Already correct winding
    }

    // Reverse the ring
    ring.reverse();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::types::BBox;

    fn default_options() -> Options {
        Options::default()
    }

    #[test]
    fn test_transform_point_z0() {
        // At z=0, the entire world is one tile
        // A point at (0.5, 0.5) should be at (2048, 2048) with extent=4096
        let p = transform_point(0.5, 0.5, 1.0, 0.0, 0.0, 4096.0);
        assert!((p[0] - 2048.0).abs() < 1e-10);
        assert!((p[1] - 2048.0).abs() < 1e-10);
    }

    #[test]
    fn test_transform_point_z1() {
        // At z=1, x=1, y=0: the tile covers x=[0.5, 1.0], y=[0.0, 0.5]
        // A point at (0.75, 0.25) should be at (2048, 2048) with extent=4096
        let p = transform_point(0.75, 0.25, 2.0, 1.0, 0.0, 4096.0);
        assert!((p[0] - 2048.0).abs() < 1e-10);
        assert!((p[1] - 2048.0).abs() < 1e-10);
    }

    #[test]
    fn test_create_tile_with_point() {
        let feature = Arc::new(InternalFeature {
            geometry: InternalGeometry::Point([0.5, 0.5, 0.0]),
            bbox: BBox {
                min_x: 0.5,
                min_y: 0.5,
                max_x: 0.5,
                max_y: 0.5,
            },
            properties: Arc::new(serde_json::json!({"name": "test"})),
            source_index: 0,
        });

        let opts = default_options();
        let tile = create_tile(&[feature], 0, 0, 0, &opts);
        assert_eq!(tile.z, 0);
        assert_eq!(tile.x, 0);
        assert_eq!(tile.y, 0);
        assert_eq!(tile.features.len(), 1);

        match &tile.features[0].geometry {
            TileGeometry::Points(pts) => {
                assert_eq!(pts.len(), 1);
                assert!((pts[0][0] - 2048.0).abs() < 1e-10);
                assert!((pts[0][1] - 2048.0).abs() < 1e-10);
            }
            _ => panic!("Expected Points geometry"),
        }

        // Properties should be preserved
        assert_eq!(
            tile.features[0].properties.as_ref(),
            &serde_json::json!({"name": "test"})
        );
    }

    #[test]
    fn test_create_tile_keeps_where_a_line_starts() {
        let ring = Ring {
            coords: vec![0.25, 0.25, 1.0, 0.5, 0.25, 1.0],
            area: 0.0,
            dist: 0.25,
            size: 0.25,
            line_start: 0.125,
        };
        let feature = Arc::new(InternalFeature {
            geometry: InternalGeometry::LineString(ring),
            bbox: BBox {
                min_x: 0.25,
                min_y: 0.25,
                max_x: 0.5,
                max_y: 0.25,
            },
            properties: Arc::new(serde_json::Value::Null),
            source_index: 0,
        });

        let opts = default_options();
        let tile = create_tile(&[feature], 1, 0, 0, &opts);
        match &tile.features[0].geometry {
            TileGeometry::Lines(lines) => {
                // In the tile's units, like its points: 0.125 of the world is a
                // quarter of a z1 tile.
                assert_eq!(lines[0].start, 0.25 * opts.extent as f64);
                assert_eq!(lines[0].points[0], [0.5 * opts.extent as f64; 2]);
            }
            _ => panic!("Expected Lines geometry"),
        }
    }

    #[test]
    fn test_create_tile_with_polygon() {
        // z-coords set to 1.0 so they survive simplification filtering
        let ring = Ring {
            coords: vec![
                0.0, 0.0, 1.0, 0.5, 0.0, 1.0, 0.5, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0, 0.0, 1.0,
            ],
            area: 0.25,
            dist: 0.0,
            size: 0.25,
            line_start: 0.0,
        };

        let feature = Arc::new(InternalFeature {
            geometry: InternalGeometry::Polygon(vec![ring]),
            bbox: BBox {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 0.5,
                max_y: 0.5,
            },
            properties: Arc::new(serde_json::Value::Null),
            source_index: 0,
        });

        let opts = default_options();
        let tile = create_tile(&[feature], 0, 0, 0, &opts);
        assert_eq!(tile.features.len(), 1);

        match &tile.features[0].geometry {
            TileGeometry::Polygons(polygons) => {
                assert_eq!(polygons.len(), 1);
                assert_eq!(polygons[0].len(), 1); // one ring
                assert_eq!(polygons[0][0].len(), 5); // 5 points
            }
            _ => panic!("Expected Polygons geometry"),
        }
    }

    #[test]
    fn test_create_tile_features_bbox() {
        let feature = Arc::new(InternalFeature {
            geometry: InternalGeometry::Point([0.25, 0.75, 0.0]),
            bbox: BBox {
                min_x: 0.25,
                min_y: 0.75,
                max_x: 0.25,
                max_y: 0.75,
            },
            properties: Arc::new(serde_json::Value::Null),
            source_index: 0,
        });

        let opts = default_options();
        let tile = create_tile(&[feature], 0, 0, 0, &opts);
        let bbox = tile.features_bbox.unwrap();
        assert!((bbox.min_x - 0.25).abs() < 1e-10);
        assert!((bbox.min_y - 0.75).abs() < 1e-10);
        assert!((bbox.max_x - 0.25).abs() < 1e-10);
        assert!((bbox.max_y - 0.75).abs() < 1e-10);
    }

    #[test]
    fn test_create_tile_empty_features_bbox() {
        let opts = default_options();
        let tile = create_tile(&[], 0, 0, 0, &opts);
        assert!(tile.features_bbox.is_none());
    }
}
