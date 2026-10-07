//! Polyline geometry for standalone meshes, built with the vector layer's
//! per-feature construction.

use navara_core::{Angle, CRS, Extent};
use navara_wasm_types::{
    PolylineMaterial,
    polyline::{ConstructedPolylineGeometry, PolylineGeometry},
};
use wasm_bindgen::prelude::*;

/// Builds the geometry of one standalone polyline.
///
/// `coordinates` is a flat `[x, y, z, ...]` buffer, read as ECEF metres when
/// `geocentric`, otherwise lng/lat/height. `ring` joins a repeated first vertex
/// as a seam instead of two caps. `material` is a `polyline` layer material.
///
/// Throws when `material` does not deserialize. Returns `undefined` when
/// fewer than two distinct positions remain.
#[wasm_bindgen(js_name = buildPolylineGeometry)]
pub fn build_polyline_geometry(
    coordinates: &[f64],
    geocentric: bool,
    ring: bool,
    material: JsValue,
) -> Result<Option<ConstructedPolylineGeometry>, JsError> {
    let material: PolylineMaterial = serde_wasm_bindgen::from_value(material)?;
    Ok(build_polyline(coordinates, geocentric, ring, material))
}

fn build_polyline(
    coordinates: &[f64],
    geocentric: bool,
    ring: bool,
    material: PolylineMaterial,
) -> Option<ConstructedPolylineGeometry> {
    let material: navara_material::PolylineMaterial = material.into();
    let crs = if geocentric {
        CRS::Geocentric
    } else {
        CRS::Geographic
    };

    let (extent, geometry) = navara_feature_component::polyline::construct_polyline_feature(
        &material,
        coordinates.to_vec(),
        &crs,
        // No tile center to be relative to, so RTE.
        true,
        ring,
    )?;

    Some(ConstructedPolylineGeometry::new(
        Some((&extent).into()),
        PolylineGeometry::new(geometry.attributes.into(), geometry.indices),
    ))
}

/// `[min, max]` height a clamp-to-ground polyline volume over the extent (radians)
/// must span to enclose ground heights from `min_height` to `max_height`.
#[wasm_bindgen(js_name = polylineGroundVolume)]
pub fn polyline_ground_volume(
    min_height: f64,
    max_height: f64,
    west: f64,
    south: f64,
    east: f64,
    north: f64,
) -> Vec<f64> {
    let (min, max) = navara_geometry::polyline_ground_volume(
        (min_height, max_height),
        Extent {
            west: Angle::new(west),
            south: Angle::new(south),
            east: Angle::new(east),
            north: Angle::new(north),
        },
    );
    vec![min, max]
}
