use std::collections::VecDeque;

use rustc_hash::FxHashMap;

use navara_core::{Ellipsoid, EllipsoidTangentPlane};
use navara_math::{EPSILON10, EqualEpsilon, FloatType, Vec2, Vec3, chord_length};

use crate::helpers::vec::{unique_with_delta_e, unpack_flatten_vec3};

use super::{ExtrusionBase, HierarchyDVec3, PolygonResource, WindingOrder, types::Polygon};

// Ref: https://github.com/CesiumGS/cesium/blob/6c2e520420b95bcb6c8eba0f02c76347cee1dd4b/packages/engine/Source/Core/PolygonGeometry.js#L1163
pub fn project_to_2d(
    ellipsoid: Ellipsoid<FloatType>,
    outer_positions: &[Vec3],
) -> impl Fn(&[Vec3]) -> Vec<Vec2> {
    // TODO: Add a logic for a large extent polygon: https://github.com/CesiumGS/cesium/blob/6c2e520420b95bcb6c8eba0f02c76347cee1dd4b/packages/engine/Source/Core/PolygonGeometry.js#L1165-L1189
    let tangent_plane = EllipsoidTangentPlane::from_points(outer_positions, ellipsoid);
    move |p| tangent_plane.project_points_onto_plane(p)
}

// Ref: https://github.com/CesiumGS/cesium/blob/6c2e520420b95bcb6c8eba0f02c76347cee1dd4b/packages/engine/Source/Core/PolygonGeometryLibrary.js#L753
pub fn polygons_from_hierarchy<F>(
    polygon_hierarchy: &HierarchyDVec3,
    project_points_to_2d: F,
) -> (Vec<Polygon>, Vec<HierarchyDVec3>)
where
    F: Fn(&[Vec3]) -> Vec<Vec2>,
{
    let mut polygons: Vec<Polygon> = vec![];
    let mut hierarchies: Vec<HierarchyDVec3> = vec![];

    let mut queue = VecDeque::new();
    queue.push_back(polygon_hierarchy);

    while let Some(outer_node) = queue.pop_front() {
        let outer_ring = &outer_node.outer_ring;

        let outer_ring = unique_with_delta_e(outer_ring, 9);
        if outer_ring.len() < 3 {
            continue;
        }

        let mut positions = outer_ring.clone();
        let mut hole_indices =
            Vec::with_capacity(outer_node.holes.as_ref().map_or(0, |holes| holes.len()));
        let mut holes_dst = Vec::with_capacity(hole_indices.capacity());

        if let Some(holes_src) = &outer_node.holes {
            for hole_src in holes_src {
                let hole_dst: Vec<_> = unique_with_delta_e(&hole_src.outer_ring, 9);
                if hole_dst.len() > 2 {
                    let index = positions.len() as u32;
                    hole_indices.push(index);
                    positions.extend(hole_dst.iter());

                    holes_dst.push(HierarchyDVec3 {
                        outer_ring: hole_dst,
                        holes: None,
                        expected_winding_order: WindingOrder::Clockwise,
                    });
                }
            }
        }

        let positions_2d = project_points_to_2d(&positions);
        if positions_2d.is_empty() {
            continue;
        }

        polygons.push(Polygon {
            positions,
            positions_2d,
            hole_indices,
        });
        hierarchies.push(HierarchyDVec3 {
            outer_ring,
            holes: (!holes_dst.is_empty()).then_some(holes_dst),
            expected_winding_order: WindingOrder::CounterClockwise,
        })
    }

    (polygons, hierarchies)
}

pub fn create_geometry_from_positions(
    ellipsoid: Ellipsoid<FloatType>,
    polygon_resource: &mut PolygonResource,
    polygon: &Polygon,
    per_position_height: bool,
    granularity: FloatType,
) -> (Vec<FloatType>, Vec<u32>) {
    let mut indices = polygon_resource.earcut(polygon);
    if indices.len() < 3 {
        indices = vec![0, 1, 2];
    }

    if per_position_height {
        let length = polygon.positions.len();
        let mut flattened_positions = vec![0.0; length * 3];
        let mut index = 0;
        for p in &polygon.positions {
            flattened_positions[index] = p.x as FloatType;
            flattened_positions[index + 1] = p.y as FloatType;
            flattened_positions[index + 2] = p.z as FloatType;
            index += 3;
        }

        let mut casted_indices = Vec::with_capacity(indices.len());
        for idx in indices {
            casted_indices.push(idx as u32);
        }

        return (flattened_positions, casted_indices);
    }

    // TODO: Support RHUMB arc type.
    // For geodesic arc type
    compute_subdivision(ellipsoid, &polygon.positions, indices, granularity)
}

/// Places the caps of an extrusion whose top half and bottom half of
/// `positions` both hold the ring, and returns each vertex's up vector and cap
/// (1 top, 0 bottom). The shader offsets each cap along the up vector by its
/// height, so the top and the bottom may coincide here.
// Ref: https://github.com/CesiumGS/cesium/blob/6c2e520420b95bcb6c8eba0f02c76347cee1dd4b/packages/engine/Source/Core/PolygonGeometryLibrary.js#L358
pub fn scale_to_geodetic_height_extruded(
    positions: &mut [f64],
    ellipsoid: Ellipsoid<FloatType>,
    per_position_height: bool,
    extrusion_base: ExtrusionBase,
) -> Vec<f32> {
    let length = positions.len() / 2;

    let scale_normals_offset = length / 3 * 4;
    let mut scale_normals_and_cap = vec![0.; scale_normals_offset * 2];

    for i in 0..(length / 3) {
        let i3 = i * 3;
        let i4 = i * 4;
        let p = unpack_flatten_vec3(positions, i3);

        let n1 =
            Into::<Vec3>::into(ellipsoid.geodetic_surface_normal_from_vec3(p.into())).normalize();

        let surface = || match ellipsoid.scale_to_geodetic_surface(p) {
            Some(p2) => p2,
            None => unreachable!(),
        };
        let (top, bottom) = match (per_position_height, extrusion_base) {
            (false, _) => {
                let s = surface();
                (s, s)
            }
            (true, ExtrusionBase::Position) => (p, p),
            (true, ExtrusionBase::Ellipsoid) => (p, surface()),
        };

        positions[i3 + length] = bottom.x;
        positions[i3 + 1 + length] = bottom.y;
        positions[i3 + 2 + length] = bottom.z;

        positions[i3] = top.x;
        positions[i3 + 1] = top.y;
        positions[i3 + 2] = top.z;

        scale_normals_and_cap[i4 + scale_normals_offset] = n1.x as f32;
        scale_normals_and_cap[i4 + 1 + scale_normals_offset] = n1.y as f32;
        scale_normals_and_cap[i4 + 2 + scale_normals_offset] = n1.z as f32;
        scale_normals_and_cap[i4 + 3 + scale_normals_offset] = 0.;

        scale_normals_and_cap[i4] = n1.x as f32;
        scale_normals_and_cap[i4 + 1] = n1.y as f32;
        scale_normals_and_cap[i4 + 2] = n1.z as f32;
        scale_normals_and_cap[i4 + 3] = 1.;
    }

    scale_normals_and_cap
}

// Ref: https://github.com/CesiumGS/cesium/blob/6c2e520420b95bcb6c8eba0f02c76347cee1dd4b/packages/engine/Source/Core/PolygonPipeline.js#L102
pub fn compute_subdivision(
    ellipsoid: Ellipsoid<FloatType>,
    positions: &[Vec3],
    indices: Vec<usize>,
    granularity: FloatType,
) -> (Vec<FloatType>, Vec<u32>) {
    let radius = ellipsoid.semi_major_axis();
    let min_distance = chord_length(granularity, radius);
    let min_distance_sqrt = min_distance * min_distance;

    let mut edges: FxHashMap<(usize, usize), usize> = FxHashMap::default();

    let mut subdivided_indices = vec![];
    let mut subdivided_positions = positions
        .iter()
        .flat_map(|p| [p.x as FloatType, p.y as FloatType, p.z as FloatType])
        .collect::<Vec<_>>();

    let mut triangles = indices;

    let mut make_triangle = |triangles: &mut Vec<usize>,
                             subdivided_positions: &mut Vec<FloatType>,
                             ia: usize,
                             ib: usize,
                             ic: usize,
                             va: Vec3,
                             vb: Vec3| {
        let min = ia.min(ib);
        let max = ia.max(ib);
        let edge_key = (min, max);
        let i = match edges.get(&edge_key) {
            Some(i) => *i,
            None => {
                let mid = (va + vb) * 0.5;
                subdivided_positions.append(&mut vec![mid.x, mid.y, mid.z]);
                let i = subdivided_positions.len() / 3 - 1;
                edges.insert(edge_key, i);
                i
            }
        };
        triangles.append(&mut vec![ia, i, ic]);
        triangles.append(&mut vec![i, ib, ic]);
    };

    while let Some(i2) = triangles.pop() {
        let i1 = triangles.pop().unwrap();
        let i0 = triangles.pop().unwrap();

        let v0 = unpack_flatten_vec3(&subdivided_positions, i0 * 3);
        let v1 = unpack_flatten_vec3(&subdivided_positions, i1 * 3);
        let v2 = unpack_flatten_vec3(&subdivided_positions, i2 * 3);

        let s0 = v0.normalize() * radius;
        let s1 = v1.normalize() * radius;
        let s2 = v2.normalize() * radius;

        let g0 = (s0 - s1).length_squared();
        let g1 = (s1 - s2).length_squared();
        let g2 = (s2 - s0).length_squared();

        let max = g0.max(g1).max(g2);

        if max <= min_distance_sqrt {
            subdivided_indices.push(i0 as u32);
            subdivided_indices.push(i1 as u32);
            subdivided_indices.push(i2 as u32);
            continue;
        }

        match max {
            v if g0 == v => make_triangle(
                &mut triangles,
                &mut subdivided_positions,
                i0,
                i1,
                i2,
                v0,
                v1,
            ),
            v if g1 == v => make_triangle(
                &mut triangles,
                &mut subdivided_positions,
                i1,
                i2,
                i0,
                v1,
                v2,
            ),
            v if g2 == v => make_triangle(
                &mut triangles,
                &mut subdivided_positions,
                i2,
                i0,
                i1,
                v2,
                v0,
            ),
            _ => {}
        }
    }

    (subdivided_positions, subdivided_indices)
}

// Ref: https://github.com/CesiumGS/cesium/blob/6c2e520420b95bcb6c8eba0f02c76347cee1dd4b/packages/engine/Source/Core/PolygonGeometryLibrary.js#L1029
pub fn compute_wall_geometry(
    ellipsoid: Ellipsoid<FloatType>,
    positions: &[Vec3],
    granularity: FloatType,
) -> (Vec<f64>, Vec<u32>) {
    let length = positions.len();
    let min_distance = chord_length(granularity, ellipsoid.semi_major_axis());

    let mut edge_positions = vec![];

    for i in 0..length {
        let p1 = positions[i];
        let p2 = positions[(i + 1) % length];

        // For geodesic arc type
        let subdivided_positions = subdivide_line(p1, p2, min_distance);

        for idx in 0..subdivided_positions.len() / 3 {
            let i = idx * 3;
            let x = subdivided_positions[i];
            let y = subdivided_positions[i + 1];
            let z = subdivided_positions[i + 2];

            edge_positions.push(x);
            edge_positions.push(y);
            edge_positions.push(z);
        }

        edge_positions.push(p2.x);
        edge_positions.push(p2.y);
        edge_positions.push(p2.z);
    }

    edge_positions.extend_from_within(..);

    let indices = calculate_wall_indices(&edge_positions);

    (edge_positions, indices)
}

pub fn compute_outline_positions(
    ellipsoid: Ellipsoid<FloatType>,
    positions: &[Vec3],
    closed: bool,
    granularity: FloatType,
) -> Vec<f64> {
    let length = positions.len();
    let min_distance = chord_length(granularity, ellipsoid.semi_major_axis());
    let edge_count = if closed { length } else { length - 1 };

    let mut edge_positions = vec![];
    for i in 0..edge_count {
        let p1 = positions[i];
        let p2 = positions[(i + 1) % length];
        debug_assert_ne!(p1, p2, "zero-length outline edge at {i}");
        edge_positions.extend(subdivide_line(p1, p2, min_distance));
    }
    let last = if closed {
        positions[0]
    } else {
        positions[length - 1]
    };
    edge_positions.extend([last.x, last.y, last.z]);

    edge_positions.extend_from_within(..);

    edge_positions
}

pub fn calculate_wall_indices(top_bottom_positions: &[FloatType]) -> Vec<u32> {
    let length = top_bottom_positions.len() / 6;
    let mut indices = vec![];
    for i in 0..length {
        let ul = i as u32;
        let ur = ul + 1;
        let ll = ul + length as u32;
        let lr = ll + 1;

        let p1 = unpack_flatten_vec3(top_bottom_positions, (ul * 3) as usize);
        let p2 = unpack_flatten_vec3(top_bottom_positions, (ur * 3) as usize);
        if p1.equal_diff_epsilon(p2, EPSILON10) {
            // skip corner
            continue;
        }

        indices.push(ul);
        indices.push(ll);
        indices.push(ur);
        if top_bottom_positions.get((lr * 3) as usize).is_some() {
            indices.push(ur);
            indices.push(ll);
            indices.push(lr);
        }
    }

    indices
}

fn subdivide_line_count(p0: Vec3, p1: Vec3, min_distance: f64) -> u64 {
    let distance = p0.distance(p1);
    let n = distance / min_distance;
    let count_divide = n.log2().ceil().max(0.);
    2.0f64.powf(count_divide) as u64
}

fn get_point_at_distance(p0: Vec3, p1: Vec3, distance: f64, length: f64) -> Vec3 {
    let mut next_p = p1 - p0;
    next_p *= distance / length;
    next_p = p0 + next_p;
    next_p
}

/// Subdivide line by the given minimum distance.
fn subdivide_line(p0: Vec3, p1: Vec3, min_distance: f64) -> Vec<f64> {
    let num_vertices = subdivide_line_count(p0, p1, min_distance);
    let length = p0.distance(p1);
    let distance_between_vertices = length / num_vertices as f64;

    let mut positions = vec![];
    for i in 0..num_vertices {
        let p = get_point_at_distance(p0, p1, i as f64 * distance_between_vertices, length);
        positions.push(p.x);
        positions.push(p.y);
        positions.push(p.z);
    }

    positions
}

#[cfg(test)]
mod test {
    use navara_core::{CRS, WGS84_64};
    use navara_math::{RADIANS_PER_DEGREE, Vec3};

    use crate::polygon::{ExtrusionBase, helpers::calculate_wall_indices};

    use super::{compute_subdivision, scale_to_geodetic_height_extruded};

    /// The caps of one position 30 m above the ellipsoid, as (top, bottom)
    /// heights above it.
    fn cap_heights(per_position_height: bool, base: ExtrusionBase) -> (f64, f64) {
        let p = CRS::Geographic.to_vec3(WGS84_64, Vec3::new(139.7, 35.7, 30.0), 0.0);
        let mut positions = vec![p.x, p.y, p.z, p.x, p.y, p.z];
        let caps =
            scale_to_geodetic_height_extruded(&mut positions, WGS84_64, per_position_height, base);
        assert_eq!((caps[3], caps[7]), (1.0, 0.0));
        let height = |i: usize| {
            let p = Vec3::new(positions[i], positions[i + 1], positions[i + 2]);
            WGS84_64.xyz_to_lle(p.into()).height.val()
        };
        (height(0), height(3))
    }

    fn assert_heights((top, bottom): (f64, f64), expected: (f64, f64)) {
        assert!(
            (top - expected.0).abs() < 1e-6 && (bottom - expected.1).abs() < 1e-6,
            "caps at {top} and {bottom}, expected {expected:?}"
        );
    }

    #[test]
    fn caps_lie_on_the_ellipsoid_without_per_position_heights() {
        for base in [ExtrusionBase::Position, ExtrusionBase::Ellipsoid] {
            assert_heights(cap_heights(false, base), (0.0, 0.0));
        }
    }

    #[test]
    fn caps_follow_the_position_on_a_position_base() {
        assert_heights(cap_heights(true, ExtrusionBase::Position), (30.0, 30.0));
    }

    #[test]
    fn bottom_cap_lies_on_the_ellipsoid_on_an_ellipsoid_base() {
        assert_heights(cap_heights(true, ExtrusionBase::Ellipsoid), (30.0, 0.0));
    }

    #[test]
    fn it_should_be_non_subdivision_polygon() {
        let positions = &[
            Vec3::new(0.0, 0.0, 90.0),
            Vec3::new(0.0, 90.0, 0.0),
            Vec3::new(90.0, 0.0, 0.0),
        ];
        let indices = vec![0, 1, 2];
        let subdivision = compute_subdivision(WGS84_64, positions, indices, 60.);

        assert_eq!(subdivision.0[0], 0.0);
        assert_eq!(subdivision.0[1], 0.0);
        assert_eq!(subdivision.0[2], 90.0);
        assert_eq!(subdivision.0[3], 0.0);
        assert_eq!(subdivision.0[4], 90.0);
        assert_eq!(subdivision.0[5], 0.0);
        assert_eq!(subdivision.0[6], 90.0);
        assert_eq!(subdivision.0[7], 0.0);
        assert_eq!(subdivision.0[8], 0.0);

        assert_eq!(subdivision.1[0], 0);
        assert_eq!(subdivision.1[1], 1);
        assert_eq!(subdivision.1[2], 2);
    }

    #[test]
    fn it_should_be_subdivided_polygon() {
        let positions = &[
            Vec3::new(6377802.759444977, -58_441.305, 29_025.648),
            Vec3::new(6377802.759444977, -58_441.305, -29_025.648),
            Vec3::new(6378137., 0., 0.),
            Vec3::new(6377802.759444977, 58_441.305, -29_025.648),
            Vec3::new(6377802.759444977, 58_441.305, 29_025.648),
        ];
        let indices = vec![0, 1, 2, 2, 3, 4, 4, 0, 2];
        let subdivision = compute_subdivision(WGS84_64, positions, indices, RADIANS_PER_DEGREE);

        assert_eq!(subdivision.0[0], 6377802.759444977);
        assert_eq!(subdivision.0[1], -58_441.305);
        assert_eq!(subdivision.0[2], 29_025.648);
        assert_eq!(subdivision.0[3], 6377802.759444977);
        assert_eq!(subdivision.0[4], -58_441.305);
        assert_eq!(subdivision.0[5], -29_025.648);
        assert_eq!(subdivision.0[6], 6378137.0);
        assert_eq!(subdivision.0[7], 0.0);
        assert_eq!(subdivision.0[8], 0.0);
        assert_eq!(subdivision.0[9], 6377802.759444977);
        assert_eq!(subdivision.0[10], 58_441.305);
        assert_eq!(subdivision.0[11], -29_025.648);
        assert_eq!(subdivision.0[12], 6377802.759444977);
        assert_eq!(subdivision.0[13], 58_441.305);
        assert_eq!(subdivision.0[14], 29_025.648);
        assert_eq!(subdivision.0[15], 6377802.759444977);
        assert_eq!(subdivision.0[16], 0.0);
        assert_eq!(subdivision.0[17], 29_025.648);

        assert_eq!(subdivision.1[0], 5);
        assert_eq!(subdivision.1[1], 0);
        assert_eq!(subdivision.1[2], 2);
        assert_eq!(subdivision.1[3], 4);
        assert_eq!(subdivision.1[4], 5);
        assert_eq!(subdivision.1[5], 2);
        assert_eq!(subdivision.1[6], 2);
        assert_eq!(subdivision.1[7], 3);
        assert_eq!(subdivision.1[8], 4);
        assert_eq!(subdivision.1[9], 0);
        assert_eq!(subdivision.1[10], 1);
        assert_eq!(subdivision.1[11], 2);
    }

    #[test]
    fn it_should_calculate_wall_indices() {
        let mut top = vec![
            0., 1., 2., //
            3., 4., 5., //
            6., 7., 8., //
            9., 10., 11.,
        ];
        top.append(&mut top.clone());
        let indices = calculate_wall_indices(&top);
        assert_eq!(
            indices,
            vec![
                0, 4, 1, //
                1, 4, 5, //
                1, 5, 2, //
                2, 5, 6, //
                2, 6, 3, //
                3, 6, 7, //
                3, 7, 4, //
            ]
        );
    }
}
