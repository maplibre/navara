use navara_core::{CRS, Extent, Radians, WGS84_64};
use navara_geometry::{
    FlatPolylineGeometryOptions, PolylineGeometryOptions, create_flat_polyline_geometry,
    create_polyline_geometry,
};
use navara_material::PolylineMaterial;
use navara_math::Vec3;

/// `ring` marks a polygon ring: its repeated first vertex is a seam to join,
/// where an open line keeps its end caps even with coincident endpoints.
pub fn construct_polyline_feature(
    material: &PolylineMaterial,
    coords: Vec<f64>,
    crs: &CRS,
    use_rte: bool,
    ring: bool,
) -> Option<(Extent<f64, Radians>, navara_geometry::PolylineGeometry)> {
    let mut latlngs = vec![];
    let mut positions = vec![];
    for i in 0..coords.len() / 3 {
        let i = i * 3;
        let vec3 = Vec3::new(coords[i], coords[i + 1], coords[i + 2]);
        latlngs.push(crs.to_lng_lat(WGS84_64, vec3));
        positions.push(crs.to_lle(WGS84_64, vec3, material.height));
    }

    let extent = Extent::from_points(&latlngs);

    create_polyline_geometry(
        WGS84_64,
        PolylineGeometryOptions {
            positions,
            clamp_to_ground: material.clamp_to_ground,
            use_rte,
            ring,
            ..Default::default()
        },
    )
    .map(|g| (extent, g))
}

/// Constructs a flat polyline feature geometry suitable for texture rendering.
/// The positions are kept as raw Cartesian coordinates without globe projection.
pub fn construct_flat_polyline_feature(
    coords: Vec<f64>,
    material: &PolylineMaterial,
    ring: bool,
) -> Option<navara_geometry::PolylineGeometry> {
    let mut positions = vec![];
    for i in 0..coords.len() / 3 {
        let i = i * 3;
        positions.push(Vec3::new(coords[i], coords[i + 1], coords[i + 2]));
    }

    create_flat_polyline_geometry(FlatPolylineGeometryOptions {
        positions,
        width: material.width,
        ring,
    })
}
