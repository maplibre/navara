use std::f64::consts::PI;
use std::sync::Arc;

use geojson_lib::{Feature, FeatureCollection, GeoJson, Geometry, GeometryValue, Position};

use crate::simplify::simplify;
use crate::types::{BBox, InternalFeature, InternalGeometry, Ring};

/// Projects longitude to [0,1] range.
pub fn project_x(lng: f64) -> f64 {
    lng / 360.0 + 0.5
}

/// Projects latitude to [0,1] range using Web Mercator.
pub fn project_y(lat: f64) -> f64 {
    let sin_lat = (lat * PI / 180.0).sin();
    let y = 0.5 - 0.25 * ((1.0 + sin_lat) / (1.0 - sin_lat)).ln() / PI;
    y.clamp(0.0, 1.0)
}

/// Converts a GeoJSON document into internal features with normalized coordinates.
///
/// `sq_tolerance` is the squared simplification tolerance at max zoom, used to
/// compute Douglas-Peucker importance values stored in z-coordinates.
pub fn convert(geojson: &GeoJson, sq_tolerance: f64) -> Vec<InternalFeature> {
    let capacity = match geojson {
        GeoJson::FeatureCollection(fc) => fc.features.len(),
        _ => 1,
    };
    let mut features = Vec::with_capacity(capacity);
    match geojson {
        GeoJson::FeatureCollection(fc) => {
            convert_feature_collection(fc, sq_tolerance, &mut features)
        }
        GeoJson::Feature(f) => convert_feature(f, sq_tolerance, features.len(), &mut features),
        GeoJson::Geometry(g) => {
            let props = Arc::new(serde_json::Value::Null);
            convert_geometry(g, props, None, sq_tolerance, features.len(), &mut features);
        }
    }
    features
}

fn convert_feature_collection(
    fc: &FeatureCollection,
    sq_tolerance: f64,
    features: &mut Vec<InternalFeature>,
) {
    for feature in &fc.features {
        convert_feature(feature, sq_tolerance, features.len(), features);
    }
}

fn convert_feature(
    feature: &Feature,
    sq_tolerance: f64,
    source_index: usize,
    features: &mut Vec<InternalFeature>,
) {
    let properties = Arc::new(
        feature
            .properties
            .as_ref()
            .map(|p| serde_json::Value::Object(p.clone()))
            .unwrap_or(serde_json::Value::Null),
    );
    let id = feature.id.clone();

    if let Some(geometry) = &feature.geometry {
        convert_geometry(
            geometry,
            properties,
            id,
            sq_tolerance,
            source_index,
            features,
        );
    }
}

fn convert_geometry(
    geometry: &Geometry,
    properties: Arc<serde_json::Value>,
    id: Option<geojson_lib::feature::Id>,
    sq_tolerance: f64,
    source_index: usize,
    features: &mut Vec<InternalFeature>,
) {
    match &geometry.value {
        GeometryValue::Point {
            coordinates: coords,
        } => {
            let mut bbox = BBox::new();
            let projected = project_point(coords, &mut bbox);
            features.push(InternalFeature {
                geometry: InternalGeometry::Point(projected),
                bbox,
                properties,
                id: id.clone(),
                source_index,
            });
        }
        GeometryValue::MultiPoint {
            coordinates: coords_list,
        } => {
            let mut bbox = BBox::new();
            let mut flat = Vec::with_capacity(coords_list.len() * 3);
            for coords in coords_list {
                let projected = project_point(coords, &mut bbox);
                flat.extend_from_slice(&projected);
            }
            features.push(InternalFeature {
                geometry: InternalGeometry::MultiPoint(flat),
                bbox,
                properties,
                id: id.clone(),
                source_index,
            });
        }
        GeometryValue::LineString {
            coordinates: coords,
        } => {
            let mut bbox = BBox::new();
            let ring = convert_line(coords, &mut bbox, sq_tolerance, false);
            features.push(InternalFeature {
                geometry: InternalGeometry::LineString(ring),
                bbox,
                properties,
                id: id.clone(),
                source_index,
            });
        }
        GeometryValue::MultiLineString { coordinates: lines } => {
            let mut bbox = BBox::new();
            let rings: Vec<Ring> = lines
                .iter()
                .map(|line| convert_line(line, &mut bbox, sq_tolerance, false))
                .collect();
            features.push(InternalFeature {
                geometry: InternalGeometry::MultiLineString(rings),
                bbox,
                properties,
                id: id.clone(),
                source_index,
            });
        }
        GeometryValue::Polygon { coordinates: rings } => {
            let mut bbox = BBox::new();
            let projected_rings = convert_polygon(rings, &mut bbox, sq_tolerance);
            features.push(InternalFeature {
                geometry: InternalGeometry::Polygon(projected_rings),
                bbox,
                properties,
                id: id.clone(),
                source_index,
            });
        }
        GeometryValue::MultiPolygon {
            coordinates: polygons,
        } => {
            let mut bbox = BBox::new();
            let projected_polygons: Vec<Vec<Ring>> = polygons
                .iter()
                .map(|rings| convert_polygon(rings, &mut bbox, sq_tolerance))
                .collect();
            features.push(InternalFeature {
                geometry: InternalGeometry::MultiPolygon(projected_polygons),
                bbox,
                properties,
                id: id.clone(),
                source_index,
            });
        }
        GeometryValue::GeometryCollection { geometries } => {
            for geom in geometries {
                convert_geometry(
                    geom,
                    Arc::clone(&properties),
                    id.clone(),
                    sq_tolerance,
                    source_index,
                    features,
                );
            }
        }
    }
}

fn project_point(coords: &Position, bbox: &mut BBox) -> [f64; 3] {
    if coords.len() < 2 {
        return [0.0, 0.0, 0.0];
    }
    let x = project_x(coords[0]);
    let y = project_y(coords[1]);
    let z = if coords.len() > 2 { coords[2] } else { 0.0 };
    bbox.extend(x, y);
    [x, y, z]
}

/// Projects a ring and runs simplification.
fn convert_line(coords: &[Position], bbox: &mut BBox, sq_tolerance: f64, is_polygon: bool) -> Ring {
    let mut ring = Ring::new();
    ring.coords.reserve(coords.len() * 3);

    let mut prev_x = 0.0;
    let mut prev_y = 0.0;
    let mut size = 0.0;

    for (i, coord) in coords.iter().enumerate() {
        let x = project_x(coord[0]);
        let y = project_y(coord[1]);
        bbox.extend(x, y);
        ring.coords.extend_from_slice(&[x, y, 0.0]); // z will be set by simplify

        if i > 0 {
            if is_polygon {
                size += (prev_x * y - x * prev_y) / 2.0; // signed area
            } else {
                size += ((x - prev_x).powi(2) + (y - prev_y).powi(2)).sqrt(); // length
            }
        }
        prev_x = x;
        prev_y = y;
    }

    let n = ring.coords.len();
    if n >= 6 {
        // Set first and last point importance to 1 (always keep)
        ring.coords[2] = 1.0;
        if sq_tolerance > 0.0 {
            simplify(&mut ring.coords, 0, n - 3, sq_tolerance);
        }
        ring.coords[n - 1] = 1.0;
    }

    ring.size = size.abs();
    if is_polygon {
        ring.area = size;
    }
    ring.dist = if is_polygon { 0.0 } else { size.abs() };

    ring
}

/// Projects polygon rings with simplification.
fn convert_polygon(rings: &[Vec<Position>], bbox: &mut BBox, sq_tolerance: f64) -> Vec<Ring> {
    let mut projected_rings = Vec::with_capacity(rings.len());
    for ring_coords in rings.iter() {
        let ring = convert_line(ring_coords, bbox, sq_tolerance, true);
        projected_rings.push(ring);
    }
    projected_rings
}

/// Calculates the signed area of a ring stored as flat [x, y, z, ...] coordinates.
pub fn calc_ring_area(coords: &[f64]) -> f64 {
    let n = coords.len() / 3;
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    let mut j = n - 1;
    for i in 0..n {
        area += (coords[j * 3] - coords[i * 3]) * (coords[i * 3 + 1] + coords[j * 3 + 1]);
        j = i;
    }
    area / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn test_project_x() {
        assert_relative_eq!(project_x(0.0), 0.5, epsilon = 1e-10);
        assert_relative_eq!(project_x(-180.0), 0.0, epsilon = 1e-10);
        assert_relative_eq!(project_x(180.0), 1.0, epsilon = 1e-10);
        assert_relative_eq!(project_x(90.0), 0.75, epsilon = 1e-10);
    }

    #[test]
    fn test_project_y() {
        assert_relative_eq!(project_y(0.0), 0.5, epsilon = 1e-10);
        // North pole should be near 0
        assert!(project_y(85.0) < 0.1);
        // South pole should be near 1
        assert!(project_y(-85.0) > 0.9);
    }

    #[test]
    fn test_convert_point() {
        let geojson: GeoJson =
            serde_json::from_str(r#"{"type": "Point", "coordinates": [0.0, 0.0]}"#).unwrap();

        let features = convert(&geojson, 0.0);
        assert_eq!(features.len(), 1);

        match &features[0].geometry {
            InternalGeometry::Point(coords) => {
                assert_relative_eq!(coords[0], 0.5, epsilon = 1e-10);
                assert_relative_eq!(coords[1], 0.5, epsilon = 1e-10);
            }
            _ => panic!("Expected Point geometry"),
        }
    }

    #[test]
    fn test_convert_feature_collection() {
        let geojson: GeoJson = serde_json::from_str(
            r#"{
                "type": "FeatureCollection",
                "features": [
                    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"name": "a"}},
                    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [90, 0]}, "properties": {"name": "b"}}
                ]
            }"#,
        )
        .unwrap();

        let features = convert(&geojson, 0.0);
        assert_eq!(features.len(), 2);
        assert_eq!(features[0].source_index, 0);
        assert_eq!(features[1].source_index, 1);
    }

    #[test]
    fn test_properties_shared_via_arc() {
        let geojson: GeoJson = serde_json::from_str(
            r#"{
                "type": "Feature",
                "geometry": {"type": "GeometryCollection", "geometries": [
                    {"type": "Point", "coordinates": [0, 0]},
                    {"type": "Point", "coordinates": [1, 1]}
                ]},
                "properties": {"key": "value"}
            }"#,
        )
        .unwrap();

        let features = convert(&geojson, 0.0);
        assert_eq!(features.len(), 2);
        // Both features should share the same Arc
        assert!(Arc::ptr_eq(
            &features[0].properties,
            &features[1].properties
        ));
    }

    #[test]
    fn test_convert_polygon() {
        let geojson: GeoJson = serde_json::from_str(
            r#"{
                "type": "Polygon",
                "coordinates": [
                    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
                ]
            }"#,
        )
        .unwrap();

        let features = convert(&geojson, 0.0);
        assert_eq!(features.len(), 1);

        match &features[0].geometry {
            InternalGeometry::Polygon(rings) => {
                assert_eq!(rings.len(), 1);
                assert_eq!(rings[0].len(), 5);
                // Area should be non-zero (sign is normalized later in tile creation)
                assert!(rings[0].area != 0.0);
            }
            _ => panic!("Expected Polygon geometry"),
        }
    }

    #[test]
    fn test_bbox_computed_correctly() {
        let geojson: GeoJson = serde_json::from_str(
            r#"{
                "type": "LineString",
                "coordinates": [[-10, -10], [10, 10]]
            }"#,
        )
        .unwrap();

        let features = convert(&geojson, 0.0);
        let bbox = &features[0].bbox;

        assert!(bbox.min_x < bbox.max_x);
        assert!(bbox.min_y < bbox.max_y);
        assert!(bbox.min_x < 0.5);
        assert!(bbox.max_x > 0.5);
    }

    #[test]
    fn test_calc_ring_area() {
        // Counter-clockwise square: should give positive area
        let coords = vec![
            0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
        ];
        let area = calc_ring_area(&coords);
        assert_relative_eq!(area.abs(), 1.0, epsilon = 1e-10);
    }
}
