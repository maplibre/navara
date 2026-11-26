use navara_core::{CRS, Extent, Radians, WGS84_64};
use navara_geometry::{
    Hierarchy, HierarchyDVec3, OutlineRun, PolygonGeometryOptions, PolygonGeometryResult,
    PolygonOutline, PolygonResource, WindingOrder, create_flat_polygon_geometry,
    create_polygon_geometry, kept_edge_runs,
};
use navara_material::PolygonMaterial;
use navara_math::Vec3;

/// `outline_edges` holds one flag per ring vertex (outer ring, then each hole),
/// nonzero where the edge to the next vertex of its ring is outlined. Without
/// it every ring edge is outlined.
pub fn construct_polygon_feature(
    geometry_hierarchy: Hierarchy,
    outline_edges: Option<&[u8]>,
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

    let outline = match (material.outline, outline_edges) {
        (false, _) => PolygonOutline::None,
        (true, None) => PolygonOutline::Rings,
        (true, Some(edges)) => PolygonOutline::Runs(outline_runs(&hierarchy, edges)),
    };

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
            extrusion_base: material.extrusion_base,
            use_rte,
            outline,
            ..Default::default()
        },
        polygon_resource,
    );

    (Some(extent), polygon_result)
}

fn outline_runs(hierarchy: &HierarchyDVec3, edges: &[u8]) -> Vec<OutlineRun> {
    let rings = std::iter::once(&hierarchy.outer_ring).chain(
        hierarchy
            .holes
            .iter()
            .flatten()
            .map(|hole| &hole.outer_ring),
    );
    let mut runs = Vec::new();
    let mut offset = 0;
    for ring in rings {
        let ring_edges = &edges[offset..offset + ring.len()];
        offset += ring.len();
        // A zero-length edge turns the outline into NaN positions, so drop
        // every vertex equal to the next one around the ring, together with
        // the flag of the edge it starts.
        let (vertices, kept): (Vec<Vec3>, Vec<bool>) = ring
            .iter()
            .zip(ring_edges)
            .enumerate()
            .filter(|&(i, _)| ring[i] != ring[(i + 1) % ring.len()])
            .map(|(_, (&v, &e))| (v, e != 0))
            .unzip();
        let n = vertices.len();
        for run in kept_edge_runs(&kept) {
            let closed = run.len() == n + 1;
            let indices = if closed { &run[..n] } else { &run[..] };
            runs.push(OutlineRun {
                positions: indices.iter().map(|&i| vertices[i]).collect(),
                closed,
            });
        }
    }
    debug_assert_eq!(offset, edges.len());
    runs
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

#[cfg(test)]
mod test {
    use navara_core::CRS;
    use navara_geometry::{Hierarchy, PolygonOutlineGeometry, PolygonResource, WindingOrder};
    use navara_material::PolygonMaterial;

    use super::construct_polygon_feature;

    const A: [f64; 3] = [0.00, 0.00, 0.];
    const B: [f64; 3] = [0.01, 0.00, 0.];
    const C: [f64; 3] = [0.01, 0.01, 0.];
    const D: [f64; 3] = [0.00, 0.01, 0.];

    fn outline(edges: Option<&[u8]>) -> PolygonOutlineGeometry {
        ring_outline(&[A, B, C, D, A], edges)
    }

    fn ring_outline(ring: &[[f64; 3]], edges: Option<&[u8]>) -> PolygonOutlineGeometry {
        let hierarchy = Hierarchy {
            outer_ring: ring.concat(),
            holes: None,
            expected_winding_order: WindingOrder::Unknown,
        };
        let material = PolygonMaterial {
            outline: true,
            ..Default::default()
        };
        construct_polygon_feature(
            hierarchy,
            edges,
            &CRS::Geographic,
            &material,
            &mut PolygonResource::new(),
            false,
        )
        .1
        .expect("polygon geometry")
        .outline
        .expect("outline geometry")
    }

    fn segment_count(outline: &PolygonOutlineGeometry) -> usize {
        let vertices = outline.position.data.len() / 3;
        (0..vertices - 1)
            .filter(|i| !outline.skip_indices.contains(&(*i as u32)))
            .count()
    }

    /// Segments of an outline: its roof rim, its base rim and its vertical
    /// edges.
    fn segments(roof: usize, base: usize, vertical: usize) -> usize {
        roof + base + vertical
    }

    #[test]
    fn every_edge_outlined_matches_the_ring_outline() {
        assert_eq!(segment_count(&outline(None)), segments(4, 4, 4));
        assert_eq!(
            segment_count(&outline(Some(&[1, 1, 1, 1, 1]))),
            segments(4, 4, 4)
        );
    }

    #[test]
    fn dropped_edge_leaves_no_rim_and_no_corners_at_its_ends() {
        assert_eq!(
            segment_count(&outline(Some(&[1, 1, 1, 0, 0]))),
            segments(3, 3, 2)
        );
    }

    #[test]
    fn two_dropped_edges_split_the_outline_into_two_runs() {
        assert_eq!(
            segment_count(&outline(Some(&[1, 0, 1, 0, 0]))),
            segments(2, 2, 0)
        );
    }

    /// MVT rings that write their first vertex again before `ClosePath`
    /// arrive with it twice at the end.
    #[test]
    fn ring_repeating_its_first_vertex_before_closing_is_outlined_once() {
        let outline = ring_outline(&[A, B, C, D, A, A], Some(&[1, 1, 1, 1, 1, 1]));
        assert!(outline.position.data.iter().all(|v| v.is_finite()));
        assert_eq!(segment_count(&outline), segments(4, 4, 4));
    }

    #[test]
    fn repeated_vertices_keep_the_flags_of_their_real_edges() {
        let outline = ring_outline(&[A, B, B, C, D, A], Some(&[1, 1, 1, 1, 0, 1]));
        assert!(outline.position.data.iter().all(|v| v.is_finite()));
        assert_eq!(segment_count(&outline), segments(3, 3, 2));
    }
}
