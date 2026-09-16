use navara_core::{CRS, Ellipsoid, LLE};
use navara_math::Vec3;
use radians::Radians;

use crate::helpers::vec::{append_flatten_vec3, get_position, unique_with_delta_e};
use crate::ring::ring_endpoints_coincide;

use super::{
    attributes::{PolylineGeometryAttributes, generate_geometry_attributes},
    constants::{WALL_INITIAL_MAX_HEIGHT, WALL_INITIAL_MIN_HEIGHT},
    helpers::{compute_right_normal, compute_vertex_miter_normal, interpolate_segment},
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PolylineGeometry {
    pub attributes: PolylineGeometryAttributes,
    pub indices: Vec<u32>,
}

pub const DEFAULT_POLYLINE_GRANULARITY_METERS: f64 = 9999.;

pub struct PolylineGeometryOptions {
    pub positions: Vec<LLE<f64, Radians>>,
    pub granularity: f64,
    pub crs: CRS,
    pub clamp_to_ground: bool,
    pub use_rte: bool,
    /// Whether these positions are a polygon ring. A ring that repeats its
    /// first vertex is joined at that seam instead of capped twice; an open
    /// polyline keeps its end caps even when its endpoints happen to coincide,
    /// which is what a source line's `line-cap` styling means. Ring geometry
    /// that is not actually closed (a boundary run split at a tile clip edge)
    /// still gets caps.
    pub ring: bool,
}

impl Default for PolylineGeometryOptions {
    fn default() -> Self {
        Self {
            positions: Default::default(),
            crs: Default::default(),
            granularity: DEFAULT_POLYLINE_GRANULARITY_METERS,
            clamp_to_ground: false,
            use_rte: false,
            ring: false,
        }
    }
}

// Ref: https://github.com/CesiumGS/cesium/blob/165e0fb4fcc9a448b15de6a2df46db23c71fffda/packages/engine/Source/Core/GroundPolylineGeometry.js#L458
pub fn create_polyline_geometry(
    ellipsoid: Ellipsoid<f64>,
    options: PolylineGeometryOptions,
) -> Option<PolylineGeometry> {
    let granularity = options.granularity;
    let crs = &options.crs;
    let positions = &options.positions;
    let cartographics = match crs {
        CRS::Geographic => positions,

        // TODO: Convert it to geographic coordinates system
        CRS::Geocentric => unimplemented!(),
        CRS::ESPG { code: _code } => unimplemented!(),
    };

    // `unique_with_delta_e` filters duplicates globally, so it also strips a
    // repeated first vertex, which would drop a real segment. Detect the repeat
    // first and restore it after filtering — this is about not losing data, so
    // it applies to every polyline, ring or not.
    let is_closed_ring = cartographics.len() > 3
        && cartographics
            .first()
            .zip(cartographics.last())
            .is_some_and(|(first, last)| {
                (first.lng.val() - last.lng.val()).abs() <= 1e-9
                    && (first.lat.val() - last.lat.val()).abs() <= 1e-9
                    && (first.height.val() - last.height.val()).abs() <= 1e-9
            });
    let mut cartographics = unique_with_delta_e(cartographics, 9);
    let restored_closing_vertex = is_closed_ring && cartographics.len() >= 3;
    if restored_closing_vertex {
        cartographics.push(cartographics[0]);
    }
    // Only a polygon ring joins at its repeated vertex. An open polyline that
    // happens to return to its start keeps both caps, and a ring left open by
    // tile clipping has no repeated vertex to join.
    let closed_ring = options.ring && restored_closing_vertex;
    let cartographics_length = cartographics.len();

    if cartographics_length < 2 {
        return None;
    }

    // ----- Build heap-side arrays for positions, interpolated cartographics, and normals from which to compute vertices -----
    // We build a "wall" and then decompose it into separately connected component "volumes" because we need a lot
    // of information about the wall. Also, this simplifies interpolation.
    // Convention: "next" and "end" are locally forward to each segment of the wall,
    // and we are computing normals pointing towards the local right side of the vertices in each segment.
    let mut cartographics_array = vec![];
    let mut normals_array = vec![];
    let mut bottom_positions_array = vec![];
    let mut top_positions_array = vec![];

    // Start points

    let start_cartographic = cartographics[0];
    let next_cartographic = cartographics[1];

    let mut previous_bottom: Vec3;
    let mut next_bottom = get_position(ellipsoid, &next_cartographic, WALL_INITIAL_MIN_HEIGHT);
    let mut vertex_bottom = get_position(ellipsoid, &start_cartographic, WALL_INITIAL_MIN_HEIGHT);
    let mut vertex_top = get_position(ellipsoid, &start_cartographic, WALL_INITIAL_MAX_HEIGHT);

    // A ring's first and last vertex are the same position, so both ends of the
    // seam take the miter between the closing and the opening segment. End caps
    // there would leave the corner open — the two wall ends would meet at an
    // angle with nothing filling the wedge between them.
    let seam_normal = closed_ring.then(|| {
        let previous_bottom = get_position(
            ellipsoid,
            &cartographics[cartographics_length - 2],
            WALL_INITIAL_MIN_HEIGHT,
        );
        compute_vertex_miter_normal(previous_bottom, vertex_bottom, vertex_top, next_bottom)
    });

    let mut vertex_normal = seam_normal.unwrap_or_else(|| {
        compute_right_normal(
            &start_cartographic,
            &next_cartographic,
            WALL_INITIAL_MAX_HEIGHT,
            ellipsoid,
        )
    });

    append_flatten_vec3(&mut normals_array, &vertex_normal);
    append_flatten_vec3(&mut bottom_positions_array, &vertex_bottom);
    append_flatten_vec3(&mut top_positions_array, &vertex_top);
    cartographics_array.append(&mut vec![
        start_cartographic.lat.val(),
        start_cartographic.lng.val(),
    ]);

    interpolate_segment(
        ellipsoid,
        start_cartographic,
        next_cartographic,
        WALL_INITIAL_MIN_HEIGHT,
        WALL_INITIAL_MAX_HEIGHT,
        granularity,
        |normal, bottom, top, cart| {
            append_flatten_vec3(&mut normals_array, &normal);
            append_flatten_vec3(&mut bottom_positions_array, &bottom);
            append_flatten_vec3(&mut top_positions_array, &top);
            cartographics_array.append(&mut vec![cart.lat.val(), cart.lng.val()]);
        },
    );

    // All in-between points
    for i in 1..(cartographics_length - 1) {
        previous_bottom = vertex_bottom;
        vertex_bottom = next_bottom;

        let vertex_cartographic = cartographics[i];
        vertex_top = get_position(ellipsoid, &vertex_cartographic, WALL_INITIAL_MAX_HEIGHT);
        next_bottom = get_position(ellipsoid, &cartographics[i + 1], WALL_INITIAL_MIN_HEIGHT);

        vertex_normal =
            compute_vertex_miter_normal(previous_bottom, vertex_bottom, vertex_top, next_bottom);

        append_flatten_vec3(&mut normals_array, &vertex_normal);
        append_flatten_vec3(&mut bottom_positions_array, &vertex_bottom);
        append_flatten_vec3(&mut top_positions_array, &vertex_top);
        cartographics_array.append(&mut vec![
            vertex_cartographic.lat.val(),
            vertex_cartographic.lng.val(),
        ]);

        interpolate_segment(
            ellipsoid,
            cartographics[i],
            cartographics[i + 1],
            WALL_INITIAL_MIN_HEIGHT,
            WALL_INITIAL_MAX_HEIGHT,
            granularity,
            |normal, bottom, top, cart| {
                append_flatten_vec3(&mut normals_array, &normal);
                append_flatten_vec3(&mut bottom_positions_array, &bottom);
                append_flatten_vec3(&mut top_positions_array, &top);
                cartographics_array.append(&mut vec![cart.lat.val(), cart.lng.val()]);
            },
        )
    }

    // End points

    let end_cartographic = cartographics[cartographics_length - 1];
    let pre_end_cartographic = cartographics[cartographics_length - 2];

    vertex_bottom = get_position(ellipsoid, &end_cartographic, WALL_INITIAL_MIN_HEIGHT);
    vertex_top = get_position(ellipsoid, &end_cartographic, WALL_INITIAL_MAX_HEIGHT);

    vertex_normal = seam_normal.unwrap_or_else(|| {
        compute_right_normal(
            &pre_end_cartographic,
            &end_cartographic,
            WALL_INITIAL_MAX_HEIGHT,
            ellipsoid,
        )
    });

    append_flatten_vec3(&mut normals_array, &vertex_normal);
    append_flatten_vec3(&mut bottom_positions_array, &vertex_bottom);
    append_flatten_vec3(&mut top_positions_array, &vertex_top);
    cartographics_array.append(&mut vec![
        end_cartographic.lat.val(),
        end_cartographic.lng.val(),
    ]);

    let (attributes, indices) = generate_geometry_attributes(
        bottom_positions_array,
        top_positions_array,
        normals_array,
        cartographics_array,
        options.clamp_to_ground,
        options.use_rte,
        closed_ring,
    );

    Some(PolylineGeometry {
        attributes,
        indices,
    })
}

/// Result of a miter joint computation at a polyline point.
///
/// Contains the 2D miter normal direction and the signed miter length used to
/// offset vertices perpendicular to the polyline in the vertex shader.
struct MiterJoint {
    /// Unit-length 2D normal pointing perpendicular to the miter joint.
    /// For endpoints this equals the segment's perpendicular; for interior
    /// points it is the perpendicular of the angular bisector between the
    /// incoming and outgoing segment directions.
    normal: (f32, f32),
    /// Scalar that the shader multiplies with `normal * halfWidth` to produce
    /// the final vertex offset.  Equals `1 / dot(miter_normal, segment_normal)`
    /// so that the projected thickness stays constant regardless of the corner
    /// angle.  Clamped to `[-MITER_LIMIT, MITER_LIMIT]` to prevent spike
    /// artifacts at very sharp angles.
    length: f32,
    /// True when the miter length was clamped to `MITER_LIMIT`.  At clamped
    /// joints the offset does not reach the true intersection of the two offset
    /// edges, leaving a triangular gap on the convex (outside) side of the
    /// corner.  The caller should emit an extra **bevel triangle** to fill it.
    clamped: bool,
}

/// Maximum ratio between the miter length and the half-width.
/// Angles sharper than ~30 degrees are clamped to this value, producing a
/// bevel-like visual that avoids excessively long spikes.
const MITER_LIMIT: f32 = 2.0;

/// Compute the miter joint for a single point in a flat polyline.
///
/// `seg_dirs` contains the unit direction vectors of each segment.
/// `point_index` is the index of the current point (0-based).
/// `point_count` is the total number of points.
///
/// # Algorithm
///
/// * **Endpoints** (first / last) of an open polyline: The miter normal is
///   simply the 90-degree rotation of the adjacent segment direction and the
///   length is 1.0 (no angular correction needed).
///
/// * **Ring seam** (`closed`): the first and last point are the same position,
///   so both take the miter between the last and the first segment — end caps
///   there would leave the seam corner open.
///
/// * **Interior points**: The tangent bisector is computed by summing the
///   incoming and outgoing unit directions and normalising.  The miter normal
///   is the perpendicular of that bisector.  The miter length is derived from
///   `1 / dot(miter_normal, segment_normal)` which compensates for the angle
///   so that the visible stroke width remains constant.
///
/// * **Hairpin turns** (nearly 180-degree reversal): When the two directions
///   almost cancel out, the tangent sum approaches zero and normalization
///   becomes unstable.  In this case we fall back to the incoming segment's
///   perpendicular with length 1.0.
fn compute_flat_miter(
    seg_dirs: &[(f32, f32)],
    point_index: usize,
    point_count: usize,
    closed: bool,
) -> MiterJoint {
    let seg_count = point_count - 1;
    let cap = |dir: (f32, f32)| MiterJoint {
        normal: perp(dir),
        length: 1.0,
        clamped: false,
    };

    // Which segments meet at this point. A ring's two ends meet at the seam, so
    // both bisect the closing and the opening segment and land on the same
    // joint; an open polyline's ends get a plain cap.
    let (incoming, outgoing) = if point_index == 0 {
        if !closed {
            return cap(seg_dirs[0]);
        }
        (seg_count - 1, 0)
    } else if point_index == point_count - 1 {
        if !closed {
            return cap(seg_dirs[seg_count - 1]);
        }
        (seg_count - 1, 0)
    } else {
        (point_index - 1, point_index)
    };

    // Bisect the angle between the two segments
    let (dx0, dy0) = seg_dirs[incoming]; // incoming segment direction
    let (dx1, dy1) = seg_dirs[outgoing]; // outgoing segment direction

    // Sum of the two unit directions gives the (unnormalised) angular bisector
    let tx = dx0 + dx1;
    let ty = dy0 + dy1;
    let t_len = (tx * tx + ty * ty).sqrt();

    if t_len < 1e-6 {
        // Hairpin: directions nearly cancel → fall back to incoming perpendicular
        return MiterJoint {
            normal: (-dy0, dx0),
            length: 1.0,
            clamped: false,
        };
    }

    // Miter normal = perpendicular of the normalised bisector (rotated 90 degrees)
    let miter_nx = -ty / t_len;
    let miter_ny = tx / t_len;

    // Perpendicular of the incoming segment (used as the reference for scaling)
    let seg_nx = -dy0;
    let seg_ny = dx0;

    // dot(miter_normal, segment_normal) tells us how much to stretch the offset
    // so that the projected width on the segment stays equal to the desired width.
    let dot = miter_nx * seg_nx + miter_ny * seg_ny;
    let unclamped = if dot.abs() < 1e-6 { 1.0 } else { 1.0 / dot };
    let length = unclamped.clamp(-MITER_LIMIT, MITER_LIMIT);

    MiterJoint {
        normal: (miter_nx, miter_ny),
        length,
        clamped: length != unclamped,
    }
}

/// Vertex indices assigned to each polyline point.
///
/// For unclamped miter joints only two vertices are emitted (shared by both
/// adjacent segments).  For clamped joints three vertices are emitted: one
/// shared **inside** vertex and two separate **outside** vertices, one aligned
/// with the incoming segment perpendicular and one with the outgoing.
///
/// The `incoming_*` pair is used by the segment arriving at this point;
/// the `outgoing_*` pair is used by the segment departing from it.
#[derive(Clone, Copy)]
struct PointJoin {
    incoming_left: u32,
    incoming_right: u32,
    outgoing_left: u32,
    outgoing_right: u32,
}

/// Compute the 90-degree-counterclockwise perpendicular ("left normal") of
/// a 2D unit direction vector `(dx, dy)`.
#[inline]
fn perp(dir: (f32, f32)) -> (f32, f32) {
    (-dir.1, dir.0)
}

/// Options for creating flat polyline geometry in Cartesian coordinates
pub struct FlatPolylineGeometryOptions {
    /// Positions in Cartesian coordinates (already converted from source CRS)
    pub positions: Vec<navara_math::Vec3>,
    /// Line width
    pub width: f32,
    /// Whether these positions are a polygon ring; see
    /// [`PolylineGeometryOptions::ring`].
    pub ring: bool,
}

impl Default for FlatPolylineGeometryOptions {
    fn default() -> Self {
        Self {
            positions: vec![],
            width: 1.0,
            ring: false,
        }
    }
}

/// Creates a flat polyline geometry from positions in Cartesian coordinates.
/// This function creates simple quad strips for the polyline, suitable for 2D texture rendering.
/// The geometry uses X/Y positions for the flat plane.
pub fn create_flat_polyline_geometry(
    options: FlatPolylineGeometryOptions,
) -> Option<PolylineGeometry> {
    let positions = &options.positions;

    if positions.len() < 2 {
        return None;
    }

    let n = positions.len();

    // A polygon ring repeats its first position at the end; that seam takes a
    // miter joint instead of two end caps. Open polylines keep their caps even
    // when the endpoints coincide, and a ring split at a tile clip edge has no
    // repeated vertex to join.
    let closed = options.ring
        && n > 3
        && ring_endpoints_coincide(
            (positions[0].x, positions[0].y),
            (positions[n - 1].x, positions[n - 1].y),
        );

    let mut flat_positions = vec![];
    let mut right_normal_and_tex_y = vec![];
    let mut indices = vec![];

    // Precompute per-segment unit direction vectors
    let seg_count = n - 1;
    let mut seg_dirs: Vec<(f32, f32)> = Vec::with_capacity(seg_count);
    for i in 0..seg_count {
        let p0 = positions[i];
        let p1 = positions[i + 1];
        let dx = (p1.x - p0.x) as f32;
        let dy = (p1.y - p0.y) as f32;
        let len = (dx * dx + dy * dy).sqrt();

        if len < 1e-10 {
            seg_dirs.push((0.0, 0.0));
        } else {
            seg_dirs.push((dx / len, dy / len));
        }
    }

    // Helper: push one vertex into all attribute arrays.
    // `normal` and `miter_len` encode the offset the vertex shader will apply:
    //   final_pos = position + normal * (lineWidth/2) * miter_len
    let mut vertex_count = 0u32;
    let push_vertex = |flat_positions: &mut Vec<f32>,
                       right_normal_and_tex_y: &mut Vec<f32>,
                       vertex_count: &mut u32,
                       px: f32,
                       py: f32,
                       normal: (f32, f32),
                       miter_len: f32|
     -> u32 {
        let idx = *vertex_count;
        flat_positions.extend_from_slice(&[px, py, 0.0]);
        right_normal_and_tex_y.extend_from_slice(&[normal.0, normal.1, 0.0, miter_len]);
        *vertex_count += 1;
        idx
    };

    // ── Per-point vertex emission ──
    //
    // Each polyline point emits either 2 or 3 vertices, depending on whether
    // the miter was clamped — except a ring's repeated last point, which
    // reuses the seam joint the first point built:
    //
    //   Unclamped (normal case):
    //     2 vertices — one left (+miter_len) and one right (−miter_len).
    //     Both adjacent segments share these vertices at the corner.
    //
    //   Clamped (sharp angle):
    //     3 vertices — one shared **inside** vertex (compressed miter) and
    //     two separate **outside** vertices whose normals match the incoming
    //     and outgoing segment perpendiculars.  A bevel triangle connects the
    //     three to fill the gap that clamping would otherwise leave on the
    //     convex side of the turn.
    //
    // `joins[i]` records which vertex indices the incoming / outgoing
    // segments should reference for point i.

    let mut joins: Vec<PointJoin> = Vec::with_capacity(n);
    let mut bevel_indices: Vec<(u32, u32, u32)> = vec![];

    for (i, p) in positions.iter().enumerate() {
        // A ring's repeated last point is the seam corner the loop already
        // passed at i == 0. Reusing that joint keeps the corner a single set of
        // vertices, so a clamped seam gets its bevel exactly once.
        if closed && i == n - 1 {
            joins.push(joins[0]);
            continue;
        }

        let px = p.x as f32;
        let py = p.y as f32;
        let miter = compute_flat_miter(&seg_dirs, i, n, closed);

        if miter.clamped {
            // Which segments meet here — the seam joins the closing segment to
            // the opening one. Open endpoints take a cap, which never clamps.
            let (incoming, outgoing) = if i == 0 {
                (seg_count - 1, 0)
            } else {
                (i - 1, i)
            };

            // Sharp corner — emit 3 vertices with a bevel triangle.
            //
            // Determine the turn direction via cross product of adjacent
            // segment directions:
            //   cross > 0  →  left turn  →  outside is on the right
            //   cross < 0  →  right turn →  outside is on the left
            let (dx0, dy0) = seg_dirs[incoming];
            let (dx1, dy1) = seg_dirs[outgoing];
            let cross = dx0 * dy1 - dy0 * dx1;

            let in_perp = perp(seg_dirs[incoming]);
            let out_perp = perp(seg_dirs[outgoing]);

            if cross < 0.0 {
                // Right turn: outside is on the left (+length) side.
                let incoming_left = push_vertex(
                    &mut flat_positions,
                    &mut right_normal_and_tex_y,
                    &mut vertex_count,
                    px,
                    py,
                    in_perp,
                    1.0,
                );
                let inside_right = push_vertex(
                    &mut flat_positions,
                    &mut right_normal_and_tex_y,
                    &mut vertex_count,
                    px,
                    py,
                    miter.normal,
                    -miter.length,
                );
                let outgoing_left = push_vertex(
                    &mut flat_positions,
                    &mut right_normal_and_tex_y,
                    &mut vertex_count,
                    px,
                    py,
                    out_perp,
                    1.0,
                );

                // Bevel triangle (CCW winding)
                bevel_indices.push((incoming_left, inside_right, outgoing_left));

                joins.push(PointJoin {
                    incoming_left,
                    incoming_right: inside_right,
                    outgoing_left,
                    outgoing_right: inside_right,
                });
            } else {
                // Left turn: outside is on the right (−length) side.
                let inside_left = push_vertex(
                    &mut flat_positions,
                    &mut right_normal_and_tex_y,
                    &mut vertex_count,
                    px,
                    py,
                    miter.normal,
                    miter.length,
                );
                let incoming_right = push_vertex(
                    &mut flat_positions,
                    &mut right_normal_and_tex_y,
                    &mut vertex_count,
                    px,
                    py,
                    in_perp,
                    -1.0,
                );
                let outgoing_right = push_vertex(
                    &mut flat_positions,
                    &mut right_normal_and_tex_y,
                    &mut vertex_count,
                    px,
                    py,
                    out_perp,
                    -1.0,
                );

                // Bevel triangle (CCW winding)
                bevel_indices.push((incoming_right, outgoing_right, inside_left));

                joins.push(PointJoin {
                    incoming_left: inside_left,
                    incoming_right,
                    outgoing_left: inside_left,
                    outgoing_right,
                });
            }
        } else {
            // Normal miter (unclamped) or endpoint — emit 2 shared vertices.
            let left = push_vertex(
                &mut flat_positions,
                &mut right_normal_and_tex_y,
                &mut vertex_count,
                px,
                py,
                miter.normal,
                miter.length,
            );
            let right = push_vertex(
                &mut flat_positions,
                &mut right_normal_and_tex_y,
                &mut vertex_count,
                px,
                py,
                miter.normal,
                -miter.length,
            );

            joins.push(PointJoin {
                incoming_left: left,
                incoming_right: right,
                outgoing_left: left,
                outgoing_right: right,
            });
        }
    }

    // ── Index generation ──
    //
    // Each segment emits a quad (2 triangles) connecting the outgoing side of
    // the start point to the incoming side of the end point.  Bevel triangles
    // at clamped joints are appended afterwards.

    for i in 0..seg_count {
        let from = &joins[i];
        let to = &joins[i + 1];

        indices.push(from.outgoing_left);
        indices.push(from.outgoing_right);
        indices.push(to.incoming_left);

        indices.push(from.outgoing_right);
        indices.push(to.incoming_right);
        indices.push(to.incoming_left);
    }

    for (a, b, c) in bevel_indices {
        indices.push(a);
        indices.push(b);
        indices.push(c);
    }

    if flat_positions.is_empty() {
        return None;
    }

    Some(PolylineGeometry {
        attributes: PolylineGeometryAttributes {
            position: crate::FloatAttribute::new(flat_positions, 3),
            position_high: None,
            position_low: None,
            start: None,
            start_high: None,
            start_low: None,
            forward_offset: None,
            end_high: None,
            end_low: None,
            start_normals: None,
            end_normal_and_texture_coordinate_normalization_x: None,
            right_normal_and_texture_coordinate_normalization_y: crate::FloatAttribute::new(
                right_normal_and_tex_y,
                4,
            ),
            batch_ids: None,
            batch_index: None,
        },
        indices,
    })
}

#[cfg(test)]
mod test {
    use navara_core::{EncodedVec3, LLE, WGS84_64};
    use radians::Degrees;

    use super::{
        FlatPolylineGeometryOptions, PolylineGeometryOptions, create_flat_polyline_geometry,
        create_polyline_geometry, perp,
    };

    #[test]
    fn it_computes_positions_and_attributes_for_polylines() {
        let geometry = create_polyline_geometry(
            WGS84_64,
            PolylineGeometryOptions {
                positions: vec![
                    LLE::<f64, Degrees>::from_float(0.01, 0., 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.02, 0., 0.).rad(),
                ],
                granularity: 0.0,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(geometry.indices.len(), 36);
        assert_eq!(geometry.attributes.position.data.len(), 24);

        // let values = geometry
        //     .attributes
        //     .end_normal_and_texture_coordinate_normalization_x
        //     .data;
        // for i in 0..4 {
        //     let index = i * 4 + 3;
        //     assert_eq!(values[index].sin(), 1.0);
        // }

        let geometry = create_polyline_geometry(
            WGS84_64,
            PolylineGeometryOptions {
                positions: vec![
                    LLE::<f64, Degrees>::from_float(0.01, 0., 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.02, 0., 0.).rad(),
                ],
                granularity: 600.0,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(geometry.indices.len(), 72);
        assert_eq!(geometry.attributes.position.data.len(), 48);

        let geometry = create_polyline_geometry(
            WGS84_64,
            PolylineGeometryOptions {
                positions: vec![
                    LLE::<f64, Degrees>::from_float(0.01, 0., 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.02, 0., 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.0201, 0., 0.).rad(),
                ],
                granularity: 600.0,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(geometry.indices.len(), 36 * 3);
        assert_eq!(geometry.attributes.position.data.len(), 24 * 3);
    }

    #[test]
    fn closed_ring_keeps_its_closing_segment() {
        let square = |close: bool| {
            let mut positions = vec![
                LLE::<f64, Degrees>::from_float(0.01, 0.01, 0.).rad(),
                LLE::<f64, Degrees>::from_float(0.02, 0.01, 0.).rad(),
                LLE::<f64, Degrees>::from_float(0.02, 0.02, 0.).rad(),
                LLE::<f64, Degrees>::from_float(0.01, 0.02, 0.).rad(),
            ];
            if close {
                positions.push(LLE::<f64, Degrees>::from_float(0.01, 0.01, 0.).rad());
            }
            create_polyline_geometry(
                WGS84_64,
                PolylineGeometryOptions {
                    positions,
                    granularity: 0.0,
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let open = square(false);
        let closed = square(true);
        // The global duplicate filter must not strip the ring-closing vertex:
        // a closed ring renders one more segment than the open path.
        assert!(
            closed.attributes.position.data.len() > open.attributes.position.data.len(),
            "closing segment was dropped"
        );
    }

    #[test]
    fn path_closed_only_in_2d_is_not_reclosed() {
        // A ramp returning over its start point at a different height is an
        // open path: re-closing it would append a zero-length segment whose
        // normal computation yields NaN.
        let geometry = create_polyline_geometry(
            WGS84_64,
            PolylineGeometryOptions {
                positions: vec![
                    LLE::<f64, Degrees>::from_float(0.01, 0.01, 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.02, 0.01, 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.02, 0.02, 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.01, 0.01, 100.).rad(),
                ],
                granularity: 0.0,
                ..Default::default()
            },
        )
        .unwrap();

        let assert_finite = |data: &[f32], name: &str| {
            assert!(
                data.iter().all(|v| v.is_finite()),
                "{name} contains non-finite values"
            );
        };
        assert_finite(&geometry.attributes.position.data, "position");
        assert_finite(
            &geometry
                .attributes
                .right_normal_and_texture_coordinate_normalization_y
                .data,
            "right_normal_and_texture_coordinate_normalization_y",
        );
        if let Some(attr) = &geometry.attributes.start_normals {
            assert_finite(&attr.data, "start_normals");
        }
        if let Some(attr) = &geometry
            .attributes
            .end_normal_and_texture_coordinate_normalization_x
        {
            assert_finite(
                &attr.data,
                "end_normal_and_texture_coordinate_normalization_x",
            );
        }
    }

    #[test]
    fn it_computes_flat_polyline_geometry() {
        use navara_math::Vec3;

        // Single segment (2 points = 4 vertices, 6 indices)
        let geometry = create_flat_polyline_geometry(FlatPolylineGeometryOptions {
            positions: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(1.0, 0.0, 0.0)],
            width: 1.0,
            ring: false,
        })
        .unwrap();

        assert_eq!(geometry.indices.len(), 6);
        assert_eq!(geometry.attributes.position.data.len() / 3, 4);

        // Two segments, moderate angle (unclamped miter): 3 points = 6 vertices, 12 indices
        let geometry = create_flat_polyline_geometry(FlatPolylineGeometryOptions {
            positions: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(2.0, 1.0, 0.0),
            ],
            width: 1.0,
            ring: false,
        })
        .unwrap();

        assert_eq!(geometry.indices.len(), 12);
        assert_eq!(geometry.attributes.position.data.len() / 3, 6);
    }

    #[test]
    fn flat_polyline_miter_collinear() {
        use navara_math::Vec3;

        // Collinear points: miter normal should equal segment perpendicular, miter_len = 1.0
        let geometry = create_flat_polyline_geometry(FlatPolylineGeometryOptions {
            positions: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(2.0, 0.0, 0.0),
            ],
            width: 1.0,
            ring: false,
        })
        .unwrap();

        // Interior point (index 1) is unclamped → 2 vertices at indices 2 and 3
        let rnty = &geometry
            .attributes
            .right_normal_and_texture_coordinate_normalization_y
            .data;
        let miter_len = rnty[2 * 4 + 3]; // vertex 2 (point 1, left side), w component
        assert!(
            (miter_len - 1.0).abs() < 1e-5,
            "expected miter_len ~1.0 for collinear, got {miter_len}"
        );
    }

    #[test]
    fn flat_polyline_miter_right_angle() {
        use navara_math::Vec3;

        // Right angle turn (unclamped): miter_len should be sqrt(2) ≈ 1.414
        let geometry = create_flat_polyline_geometry(FlatPolylineGeometryOptions {
            positions: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
            ],
            width: 1.0,
            ring: false,
        })
        .unwrap();

        // Unclamped → 2 vertices for interior point, at indices 2 and 3
        let rnty = &geometry
            .attributes
            .right_normal_and_texture_coordinate_normalization_y
            .data;
        let miter_len = rnty[2 * 4 + 3]; // interior left vertex, w component
        let expected = std::f32::consts::SQRT_2;
        assert!(
            (miter_len - expected).abs() < 1e-4,
            "expected miter_len ~{expected} for right angle, got {miter_len}"
        );
    }

    #[test]
    fn closed_ring_miters_its_seam() {
        // A ring whose seam corner turns by `seam_deg`; `close` repeats the
        // first vertex at the end.
        let ring = |seam_deg: f64, close: bool| {
            let r = 0.005;
            let a: f64 = seam_deg.to_radians();
            let mut positions = vec![
                LLE::<f64, Degrees>::from_float(0.01, 0.01, 0.).rad(),
                LLE::<f64, Degrees>::from_float(0.01 + r, 0.01, 0.).rad(),
                LLE::<f64, Degrees>::from_float(0.01 + r, 0.01 + r, 0.).rad(),
                LLE::<f64, Degrees>::from_float(0.01 + r * a.cos(), 0.01 + r * a.sin(), 0.).rad(),
            ];
            if close {
                positions.push(LLE::<f64, Degrees>::from_float(0.01, 0.01, 0.).rad());
            }
            create_polyline_geometry(
                WGS84_64,
                PolylineGeometryOptions {
                    positions,
                    granularity: 0.0,
                    ring: true,
                    ..Default::default()
                },
            )
            .unwrap()
        };

        // The wall's first start plane and its last end plane both sit at the
        // ring's repeated vertex. A joined seam puts them on one plane, so the
        // two normals are collinear — they face opposite ways at a plain miter
        // and the same way once the miter is broken, which is exactly how every
        // interior joint pairs up.
        let seam_planes_cross = |geometry: &super::PolylineGeometry| {
            let starts = &geometry.attributes.start_normals.as_ref().unwrap().data;
            let ends = &geometry
                .attributes
                .end_normal_and_texture_coordinate_normalization_x
                .as_ref()
                .unwrap()
                .data;
            let last = geometry.attributes.position.data.len() / 3 - 1;
            let s = [starts[0], starts[1], starts[2]];
            let e = [ends[last * 4], ends[last * 4 + 1], ends[last * 4 + 2]];
            [
                s[1] * e[2] - s[2] * e[1],
                s[2] * e[0] - s[0] * e[2],
                s[0] * e[1] - s[1] * e[0],
            ]
            .iter()
            .fold(0.0_f32, |m, c| m.max(c.abs()))
        };

        // A right-angled seam takes a plain miter; a sharp one breaks it. Both
        // have to keep the two ends on one plane.
        for seam_deg in [90., 40.] {
            let cross = seam_planes_cross(&ring(seam_deg, true));
            assert!(
                cross < 1e-5,
                "seam planes are not collinear at {seam_deg} degrees: cross {cross}"
            );
        }

        // An open polyline whose endpoints coincide keeps its caps: closure is
        // the source geometry's type, not a property of the coordinates.
        let coincident_but_open = create_polyline_geometry(
            WGS84_64,
            PolylineGeometryOptions {
                positions: vec![
                    LLE::<f64, Degrees>::from_float(0.01, 0.01, 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.015, 0.01, 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.015, 0.015, 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.0126, 0.0132, 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.01, 0.01, 0.).rad(),
                ],
                granularity: 0.0,
                ring: false,
                ..Default::default()
            },
        )
        .unwrap();
        let cross = seam_planes_cross(&coincident_but_open);
        assert!(
            cross > 1e-3,
            "a non-ring polyline must keep its caps: cross {cross}"
        );

        // The same vertices left open keep their per-segment end caps, which
        // sit on different planes: the assertion above is about closure, not
        // about the shape itself. (A 90-degree seam is a poor control here —
        // that ring's first and last segment run antiparallel, so their caps
        // land on one plane by coincidence.)
        let open_cross = seam_planes_cross(&ring(40., false));
        assert!(
            open_cross > 1e-3,
            "open polyline unexpectedly shares its end plane: cross {open_cross}"
        );
    }

    #[test]
    fn flat_closed_ring_miters_its_seam() {
        use navara_math::Vec3;

        // A square ring: the repeated first position closes it, so the seam
        // must be mitered like any other corner instead of capped twice.
        let ring = |close: bool| {
            let mut positions = vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(1.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ];
            if close {
                positions.push(Vec3::new(0.0, 0.0, 0.0));
            }
            create_flat_polyline_geometry(FlatPolylineGeometryOptions {
                positions,
                width: 1.0,
                ring: true,
            })
            .unwrap()
        };

        let closed = ring(true);
        // The seam is one joint, so the repeated last point adds no vertices:
        // the square's four corners leave 8.
        assert_eq!(closed.attributes.position.data.len() / 3, 8);

        let closed_rnty = &closed
            .attributes
            .right_normal_and_texture_coordinate_normalization_y
            .data;
        let expected_len = std::f32::consts::SQRT_2;
        assert!(
            (closed_rnty[3] - expected_len).abs() < 1e-4,
            "seam kept an end cap (miter_len {}), expected ~{expected_len}",
            closed_rnty[3]
        );

        // The same vertices left open keep their caps, so the assertion above
        // is about closure and not about right angles in general.
        let open = ring(false);
        let open_rnty = &open
            .attributes
            .right_normal_and_texture_coordinate_normalization_y
            .data;
        assert!(
            (open_rnty[3] - 1.0).abs() < 1e-6,
            "open start must stay capped"
        );
    }

    #[test]
    fn flat_closed_ring_bevels_a_sharp_seam() {
        use navara_math::Vec3;

        // A sliver ring whose sharp corner is the seam: the miter clamps there
        // just as it would at an interior corner, so the seam needs the same
        // bevel instead of a pinched, narrowed join.
        let geometry = create_flat_polyline_geometry(FlatPolylineGeometryOptions {
            positions: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.5, 0.05, 0.0),
                Vec3::new(0.0, 0.0, 0.0),
            ],
            width: 1.0,
            ring: true,
        })
        .unwrap();

        // Seam and the corner at (1,0) clamp and emit 3 vertices each, the
        // shallow corner at (0.5,0.05) emits 2, the repeated point none.
        assert_eq!(geometry.attributes.position.data.len() / 3, 8);
        // 3 segment quads (18) + 2 bevel triangles (6)
        assert_eq!(geometry.indices.len(), 24);

        // The seam's outside pair carries the closing and the opening segment
        // perpendicular at full half-width; a bevel triangle spans them.
        let rnty = &geometry
            .attributes
            .right_normal_and_texture_coordinate_normalization_y
            .data;
        let closing_len = (0.5f32 * 0.5 + 0.05 * 0.05).sqrt();
        let incoming = perp((-0.5 / closing_len, -0.05 / closing_len));
        assert!(
            (rnty[4] - incoming.0).abs() < 1e-3 && (rnty[5] - incoming.1).abs() < 1e-3,
            "seam incoming normal {:?} is not the closing segment perpendicular {incoming:?}",
            (rnty[4], rnty[5])
        );
        assert!(
            rnty[8].abs() < 1e-6 && (rnty[9] - 1.0).abs() < 1e-6,
            "seam outgoing normal {:?} is not the opening segment perpendicular",
            (rnty[8], rnty[9])
        );
        assert!(
            (rnty[7] + 1.0).abs() < 1e-6 && (rnty[11] + 1.0).abs() < 1e-6,
            "seam outside vertices must sit at full half-width"
        );
    }

    #[test]
    fn flat_polyline_bevel_at_sharp_angle() {
        use navara_math::Vec3;

        // Sharp turn that triggers miter clamping and bevel:
        // (0,0) → (1,0) → (0.9,-0.1)  (sharp right turn)
        let geometry = create_flat_polyline_geometry(FlatPolylineGeometryOptions {
            positions: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(1.0, 0.0, 0.0),
                Vec3::new(0.9, -0.1, 0.0),
            ],
            width: 1.0,
            ring: false,
        })
        .unwrap();

        // Clamped interior point emits 3 vertices instead of 2:
        //   point 0: 2 vertices, point 1: 3 vertices (bevel), point 2: 2 vertices
        //   Total = 7 vertices
        let vertex_count = geometry.attributes.position.data.len() / 3;
        assert_eq!(vertex_count, 7);

        // 2 segment quads (12) + 1 bevel triangle (3) = 15 indices
        assert_eq!(geometry.indices.len(), 15);
    }

    #[test]
    fn rte_position_high_low_matches_adjusted_positions_when_not_clamped() {
        // When use_rte=true and clamp_to_ground=false, position_high/low must encode
        // the same adjusted (collapsed) positions as the f32 position attribute.
        // This guards against a regression where unadjusted coordinates were used instead.
        let geometry = create_polyline_geometry(
            WGS84_64,
            PolylineGeometryOptions {
                positions: vec![
                    LLE::<f64, Degrees>::from_float(0.01, 0., 0.).rad(),
                    LLE::<f64, Degrees>::from_float(0.02, 0., 0.).rad(),
                ],
                granularity: 0.0,
                clamp_to_ground: false,
                use_rte: true,
                ..Default::default()
            },
        )
        .unwrap();

        let position_high = geometry
            .attributes
            .position_high
            .as_ref()
            .expect("position_high should be present when use_rte=true");
        let position_low = geometry
            .attributes
            .position_low
            .as_ref()
            .expect("position_low should be present when use_rte=true");

        // Reconstruct the expected high/low from the f32 position attribute.
        // The f32 positions are stored from adjusted (collapsed) coordinates cast to f32.
        // The f64 positions (used for RTE) should also come from adjusted coordinates,
        // so high + low should reconstruct closely to the f32 position values.
        let positions = &geometry.attributes.position.data;
        let vertex_count = positions.len() / 3;

        assert_eq!(position_high.data.len(), positions.len());
        assert_eq!(position_low.data.len(), positions.len());

        for v in 0..vertex_count {
            let i = v * 3;
            let high_x = position_high.data[i];
            let high_y = position_high.data[i + 1];
            let high_z = position_high.data[i + 2];
            let low_x = position_low.data[i];
            let low_y = position_low.data[i + 1];
            let low_z = position_low.data[i + 2];

            // high + low should reconstruct to approximately the same value as positions
            let reconstructed_x = high_x + low_x;
            let reconstructed_y = high_y + low_y;
            let reconstructed_z = high_z + low_z;

            let pos_x = positions[i];
            let pos_y = positions[i + 1];
            let pos_z = positions[i + 2];

            // Use relative tolerance since ECEF coords are large (~6.3M meters)
            let tol = 1.0; // 1 meter tolerance for f32 rounding
            assert!(
                (reconstructed_x - pos_x).abs() < tol,
                "vertex {v} x mismatch: reconstructed={reconstructed_x}, position={pos_x}"
            );
            assert!(
                (reconstructed_y - pos_y).abs() < tol,
                "vertex {v} y mismatch: reconstructed={reconstructed_y}, position={pos_y}"
            );
            assert!(
                (reconstructed_z - pos_z).abs() < tol,
                "vertex {v} z mismatch: reconstructed={reconstructed_z}, position={pos_z}"
            );
        }

        // Additionally verify that position_high/low values match EncodedVec3 encoding
        // of the adjusted positions (not the raw top/bottom positions).
        // When clamp_to_ground=false, max_height=0 so top collapses toward bottom.
        // All 8 vertices per segment should have collapsed positions.
        // Verify the first vertex by checking encoding directly.
        let pos_f64_x = positions[0] as f64;
        let pos_f64_y = positions[1] as f64;
        let pos_f64_z = positions[2] as f64;
        let encoded = EncodedVec3::encode_xyz(pos_f64_x, pos_f64_y, pos_f64_z);

        // The actual RTE encoding uses the f64 adjusted position (more precise than
        // round-tripping through f32), so we just verify high is in the right ballpark.
        assert!(
            (position_high.data[0] - encoded.high.x as f32).abs() < 1.0,
            "first vertex high.x doesn't match expected encoding"
        );
    }
}
