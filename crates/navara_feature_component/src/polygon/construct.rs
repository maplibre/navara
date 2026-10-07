use navara_core::{CRS, Extent, Radians, WGS84_64};
use navara_geometry::{
    Hierarchy, HierarchyDVec3, PolygonGeometryOptions, PolygonGeometryResult, PolygonResource,
    WindingOrder, create_flat_polygon_geometry, create_polygon_geometry,
};
use navara_material::PolygonMaterial;
use navara_math::Vec3;

pub fn construct_polygon_feature(
    geometry_hierarchy: Hierarchy,
    crs: &CRS,
    material: &PolygonMaterial,
    polygon_resource: &mut PolygonResource,
    use_rte: bool,
) -> (Option<Extent<f64, Radians>>, Option<PolygonGeometryResult>) {
    let mut lnglats = vec![];

    let mut hierarchy = HierarchyDVec3 {
        expected_winding_order: geometry_hierarchy.expected_winding_order,
        ..Default::default()
    };
    let ring: Vec<f64> = geometry_hierarchy.outer_ring;
    for i in 0..(ring.len() / 3) {
        let i = i * 3;
        let v = Vec3::new(ring[i], ring[i + 1], ring[i + 2]);
        let converted = crs.to_vec3(WGS84_64, v, material.height);
        hierarchy
            .outer_ring
            .push(Vec3::new(converted.x, converted.y, converted.z));
        lnglats.push(crs.to_lng_lat(WGS84_64, v));
    }

    if let Some(holes_before) = &geometry_hierarchy.holes {
        hierarchy.holes = Some(
            holes_before
                .iter()
                .map(|hole| {
                    let ring = &hole.outer_ring;
                    let mut outer_ring = vec![];
                    for i in 0..(ring.len() / 3) {
                        let i = i * 3;
                        let converted = crs.to_vec3(
                            WGS84_64,
                            Vec3::new(ring[i], ring[i + 1], ring[i + 2]),
                            material.height,
                        );
                        outer_ring.push(Vec3::new(converted.x, converted.y, converted.z));
                    }
                    HierarchyDVec3 {
                        outer_ring,
                        holes: None,
                        expected_winding_order: geometry_hierarchy.expected_winding_order,
                    }
                })
                .collect(),
        );
    }

    hierarchy.align_winding_order_on_globe();

    if hierarchy.expected_winding_order == WindingOrder::Unknown {
        // If all the vertices of a polygon lie on a single line, the winding order becomes WindingOrder::Unknown.
        // Such a polygon should be discarded.
        return (None, None);
    }

    let extent = Extent::from_points(&lnglats);

    let polygon_result = create_polygon_geometry(
        PolygonGeometryOptions {
            hierarchy,
            clamp_to_ground: material.clamp_to_ground,
            height: material.height,
            extruded_height: material.extruded_height.unwrap_or_default(),
            per_position_height: material.per_position_height,
            use_rte,
            outline: material.outline,
            ..Default::default()
        },
        polygon_resource,
    );

    (Some(extent), polygon_result)
}

pub fn construct_flat_polygon_feature(
    geometry_hierarchy: Hierarchy,
    material: &PolygonMaterial,
    polygon_resource: &mut PolygonResource,
    use_rte: bool,
) -> Option<PolygonGeometryResult> {
    let mut hierarchy = HierarchyDVec3 {
        expected_winding_order: geometry_hierarchy.expected_winding_order,
        ..Default::default()
    };
    let ring = geometry_hierarchy.outer_ring;
    for i in 0..(ring.len() / 3) {
        let i = i * 3;
        hierarchy
            .outer_ring
            .push(Vec3::new(ring[i], ring[i + 1], ring[i + 2]));
    }

    if let Some(holes_before) = &geometry_hierarchy.holes {
        hierarchy.holes = Some(
            holes_before
                .iter()
                .map(|hole| {
                    let ring = &hole.outer_ring;
                    let mut outer_ring = vec![];
                    for i in 0..(ring.len() / 3) {
                        let i = i * 3;
                        outer_ring.push(Vec3::new(ring[i], ring[i + 1], ring[i + 2]));
                    }
                    HierarchyDVec3 {
                        outer_ring,
                        holes: None,
                        expected_winding_order: geometry_hierarchy.expected_winding_order,
                    }
                })
                .collect(),
        );
    }

    hierarchy.align_winding_order();

    if hierarchy.expected_winding_order == WindingOrder::Unknown {
        // If all the vertices of a polygon lie on a single line, the winding order becomes WindingOrder::Unknown.
        // Such a polygon should be discarded.
        return None;
    }

    create_flat_polygon_geometry(
        PolygonGeometryOptions {
            hierarchy,
            clamp_to_ground: material.clamp_to_ground,
            height: material.height,
            extruded_height: material.extruded_height.unwrap_or_default(),
            use_rte,
            ..Default::default()
        },
        polygon_resource,
    )
}
