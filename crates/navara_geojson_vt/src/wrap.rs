use std::sync::Arc;

use crate::clip::{clip, intersect_x};
use crate::types::InternalFeature;

/// Handles antimeridian wrapping by clipping features at x=0 and x=1
/// and creating shifted copies for features that cross the boundaries.
///
/// Buffer is in normalized [0,1] coordinates.
pub fn wrap(features: &[Arc<InternalFeature>], buffer: f64) -> Vec<Arc<InternalFeature>> {
    // Clip to the left of the antimeridian
    let left = clip(features, -1.0 - buffer, buffer, 0, intersect_x, 0.0);
    // Clip to the right of the antimeridian
    let right = clip(features, 1.0 - buffer, 2.0 + buffer, 0, intersect_x, 0.0);

    let mut result = Vec::with_capacity(features.len());

    // Shift left features (those that wrap around from negative x) to x+1
    for feature in left {
        result.push(shift_feature(&feature, 1.0));
    }

    // Add the main features clipped to [0,1]
    let center = clip(features, -buffer, 1.0 + buffer, 0, intersect_x, 0.0);
    result.extend(center);

    // Shift right features (those that wrap around from x>1) to x-1
    for feature in right {
        result.push(shift_feature(&feature, -1.0));
    }

    result
}

fn shift_feature(feature: &InternalFeature, offset: f64) -> Arc<InternalFeature> {
    Arc::new(InternalFeature {
        geometry: shift_geometry(&feature.geometry, offset),
        bbox: crate::types::BBox {
            min_x: feature.bbox.min_x + offset,
            min_y: feature.bbox.min_y,
            max_x: feature.bbox.max_x + offset,
            max_y: feature.bbox.max_y,
        },
        properties: feature.properties.clone(),
        source_index: feature.source_index,
    })
}

fn shift_geometry(
    geometry: &crate::types::InternalGeometry,
    offset: f64,
) -> crate::types::InternalGeometry {
    use crate::types::InternalGeometry::*;

    match geometry {
        Point(coords) => {
            let mut c = *coords;
            c[0] += offset;
            Point(c)
        }
        MultiPoint(coords) => {
            let mut new_coords = coords.clone();
            let n = new_coords.len() / 3;
            for i in 0..n {
                new_coords[i * 3] += offset;
            }
            MultiPoint(new_coords)
        }
        LineString(ring) => LineString(shift_ring(ring, offset)),
        MultiLineString(rings) => {
            MultiLineString(rings.iter().map(|r| shift_ring(r, offset)).collect())
        }
        Polygon(rings) => Polygon(rings.iter().map(|r| shift_ring(r, offset)).collect()),
        MultiPolygon(polygons) => MultiPolygon(
            polygons
                .iter()
                .map(|rings| rings.iter().map(|r| shift_ring(r, offset)).collect())
                .collect(),
        ),
    }
}

fn shift_ring(ring: &crate::types::Ring, offset: f64) -> crate::types::Ring {
    let mut new_coords = ring.coords.clone();
    let n = new_coords.len() / 3;
    for i in 0..n {
        new_coords[i * 3] += offset;
    }
    crate::types::Ring {
        coords: new_coords,
        area: ring.area,
        dist: ring.dist,
        size: ring.size,
        line_start: ring.line_start,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::convert::convert;
    use crate::types::InternalFeature;
    use geojson_lib::GeoJson;

    fn wrap_features(geojson: &GeoJson) -> Vec<Arc<InternalFeature>> {
        convert(geojson, 0.0).into_iter().map(Arc::new).collect()
    }

    #[test]
    fn test_no_crossing_identity() {
        // A feature entirely within [0,1] should pass through unchanged
        let geojson: GeoJson =
            serde_json::from_str(r#"{"type": "Point", "coordinates": [10, 20]}"#).unwrap();

        let features = wrap_features(&geojson);
        let wrapped = wrap(&features, 0.004);

        assert_eq!(wrapped.len(), 1);
        match &wrapped[0].geometry {
            crate::types::InternalGeometry::Point(coords) => {
                assert!((coords[0] - features[0].bbox.min_x).abs() < 1e-10);
            }
            _ => panic!("Expected Point"),
        }
    }

    #[test]
    fn test_antimeridian_wrapping() {
        // A line that crosses the antimeridian
        let geojson: GeoJson =
            serde_json::from_str(r#"{"type": "LineString", "coordinates": [[170, 0], [190, 0]]}"#)
                .unwrap();

        let features = wrap_features(&geojson);
        let wrapped = wrap(&features, 0.004);

        // Should produce features - the line crosses x=1.0 boundary
        assert!(!wrapped.is_empty());
    }

    #[test]
    fn test_antimeridian_wrapping_coordinates_in_range() {
        // A line at longitude 170-190 crosses the antimeridian.
        // After wrapping, ALL x-coordinates should be within [-buffer, 1+buffer].
        let geojson: GeoJson =
            serde_json::from_str(r#"{"type": "LineString", "coordinates": [[170, 0], [190, 0]]}"#)
                .unwrap();

        let features = wrap_features(&geojson);
        let buffer = 0.004;
        let wrapped = wrap(&features, buffer);

        for feature in &wrapped {
            // All bboxes should have x in valid range
            assert!(
                feature.bbox.min_x >= -buffer - 0.01,
                "min_x = {} is too negative",
                feature.bbox.min_x
            );
            assert!(
                feature.bbox.max_x <= 1.0 + buffer + 0.01,
                "max_x = {} is too large",
                feature.bbox.max_x
            );
        }
    }

    #[test]
    fn test_wrapping_shifts_right_features_left() {
        // A point at longitude 181 (x > 1.0) should be shifted to x-1
        let geojson: GeoJson =
            serde_json::from_str(r#"{"type": "Point", "coordinates": [181, 0]}"#).unwrap();

        let features = wrap_features(&geojson);
        let wrapped = wrap(&features, 0.004);

        // The shifted feature should have x near project_x(181) - 1.0
        let expected_x = crate::convert::project_x(181.0) - 1.0;
        let has_shifted = wrapped.iter().any(|f| match &f.geometry {
            crate::types::InternalGeometry::Point(coords) => (coords[0] - expected_x).abs() < 0.01,
            _ => false,
        });
        assert!(
            has_shifted,
            "Expected a feature shifted from x>1 to near {}",
            expected_x
        );
    }
}
