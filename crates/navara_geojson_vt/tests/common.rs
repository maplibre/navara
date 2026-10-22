//! Shared helpers for integration tests.

pub use geojson_lib::GeoJson;
use navara_geojson_vt::Options;
pub use navara_geojson_vt::types::{Tile, TileGeometry};
pub use serde::Deserialize;

pub fn fixture_path(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

pub fn load_geojson(name: &str) -> GeoJson {
    let data = std::fs::read_to_string(fixture_path(name)).unwrap();
    serde_json::from_str(&data).unwrap()
}

/// Options matching maplibre/geojson-vt defaults.
pub fn gen_tiles_opts() -> Options {
    Options {
        index_max_zoom: 0,
        index_max_points: 10_000,
        max_zoom: 14,
        tolerance: 3.0,
        ..Default::default()
    }
}

/// JS fixture feature format.
#[derive(Debug, Deserialize)]
pub struct JsFeature {
    pub geometry: serde_json::Value,
    #[serde(rename = "type")]
    pub geom_type: u8,
    pub tags: serde_json::Value,
}

/// Returns the JS type number for a TileGeometry.
pub fn geom_type_num(geom: &TileGeometry) -> u8 {
    match geom {
        TileGeometry::Points(_) => 1,
        TileGeometry::Lines(_) => 2,
        TileGeometry::Polygons(_) => 3,
    }
}

/// Converts a Rust TileGeometry to the JS fixture format (with rounded coordinates).
pub fn geom_to_js_value(geom: &TileGeometry) -> serde_json::Value {
    match geom {
        TileGeometry::Points(pts) => {
            let arr: Vec<serde_json::Value> = pts
                .iter()
                .map(|p| serde_json::json!([p[0].round() as i64, p[1].round() as i64]))
                .collect();
            serde_json::Value::Array(arr)
        }
        TileGeometry::Lines(lines) => {
            let arr: Vec<serde_json::Value> = lines
                .iter()
                .map(|line| {
                    let pts: Vec<serde_json::Value> = line
                        .points
                        .iter()
                        .map(|p| serde_json::json!([p[0].round() as i64, p[1].round() as i64]))
                        .collect();
                    serde_json::Value::Array(pts)
                })
                .collect();
            serde_json::Value::Array(arr)
        }
        TileGeometry::Polygons(polygons) => {
            let mut all_rings = Vec::new();
            for polygon in polygons {
                for ring in polygon {
                    let pts: Vec<serde_json::Value> = ring
                        .iter()
                        .map(|p| serde_json::json!([p[0].round() as i64, p[1].round() as i64]))
                        .collect();
                    all_rings.push(serde_json::Value::Array(pts));
                }
            }
            serde_json::Value::Array(all_rings)
        }
    }
}

/// Converts Rust properties to the JS `tags` format.
pub fn props_to_tags(props: &serde_json::Value) -> serde_json::Value {
    match props {
        serde_json::Value::Null => serde_json::Value::Null,
        other => other.clone(),
    }
}

/// Full comparison of a tile's features against JS-format features (ignoring `id`).
pub fn assert_tile_features_match(tile: &Tile, expected: &[JsFeature]) {
    assert_eq!(
        tile.features.len(),
        expected.len(),
        "Feature count mismatch for tile z{}-{}-{}",
        tile.z,
        tile.x,
        tile.y
    );

    for (i, (rf, jf)) in tile.features.iter().zip(expected.iter()).enumerate() {
        assert_eq!(
            geom_type_num(&rf.geometry),
            jf.geom_type,
            "Feature {} type mismatch in tile z{}-{}-{}",
            i,
            tile.z,
            tile.x,
            tile.y
        );

        let rust_geom = geom_to_js_value(&rf.geometry);
        assert_eq!(
            rust_geom, jf.geometry,
            "Feature {} geometry mismatch in tile z{}-{}-{}",
            i, tile.z, tile.x, tile.y
        );

        let rust_tags = props_to_tags(&rf.properties);
        assert_eq!(
            rust_tags, jf.tags,
            "Feature {} tags mismatch in tile z{}-{}-{}",
            i, tile.z, tile.x, tile.y
        );
    }
}
