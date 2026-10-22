use navara_core::EncodedVec3;

use crate::{
    FloatAttribute, UintAttribute,
    helpers::vec::{append_flatten_vec3_with_index, unpack_flatten_vec3},
};

use super::{
    constants::{LINE_LENGTH_HIGH_STEP, REFERENCE_INDICES},
    helpers::{adjust_height, break_miter},
    segment_table::{LINE_SEGMENT_TEXELS, append_line_segment},
};

#[derive(Clone, Debug, PartialEq)]
pub struct PolylineGeometryAttributes {
    pub position: FloatAttribute,
    pub start: Option<FloatAttribute>,

    /// RTE (Relative To Eye) high-precision component of vertex positions.
    /// Present when `use_rte = true` (e.g. GeoJSON polylines with large ECEF coordinates).
    pub position_high: Option<FloatAttribute>,
    /// RTE low-precision component of vertex positions.
    pub position_low: Option<FloatAttribute>,
    /// RTE high-precision component of segment start positions.
    pub start_high: Option<FloatAttribute>,
    /// RTE low-precision component of segment start positions.
    pub start_low: Option<FloatAttribute>,
    pub forward_offset: Option<FloatAttribute>,
    /// RTE high-precision component of segment end positions (start + forward_offset).
    pub end_high: Option<FloatAttribute>,
    /// RTE low-precision component of segment end positions.
    pub end_low: Option<FloatAttribute>,

    /// xyz: segment start plane normal. w: the high part of the length so far
    /// along the line at the segment start, in meters — a multiple of
    /// `LINE_LENGTH_HIGH_STEP`.
    pub start_normal_and_length_high: Option<FloatAttribute>,
    /// xyz: segment end plane normal. w: the segment length in meters, signed
    /// positive on the right side of the line and negative on the left.
    pub end_normal_and_segment_length: Option<FloatAttribute>,
    /// Volume polylines — xyz: right plane normal; w: the low part of the
    /// length so far along the line at the segment start, in meters.
    ///
    /// Flat polylines — xy: miter normal; z: distance along the line in the
    /// position's units; w: signed miter length.
    pub right_normal_and_line_length: FloatAttribute,
    pub batch_ids: Option<FloatAttribute>,
    pub batch_index: Option<UintAttribute>,
    /// RTE volume polylines: the segment table, one entry of
    /// `LINE_SEGMENT_TEXELS` texels per segment rather than a vertex
    /// attribute. See `append_line_segment` for the layout.
    pub line_segments: Option<FloatAttribute>,
    /// Flat polylines, per vertex: `(high, low, line length, end mask)`.
    /// `high + low` is the distance along the original line, with `high` a
    /// multiple of `FLAT_LINE_DISTANCE_HIGH_STEP`, in the position's units. A
    /// line clipped out of a longer one starts at the distance its first
    /// position carries in z, so a dash pattern lines up across the tiles it
    /// was clipped into. The line length is that of this line, from its first
    /// position. The end mask has bit 0 set when the first position is an end
    /// of the line itself and bit 1 for the last one; a tile clip end and a
    /// closed ring's seam have none.
    pub line_distance_and_ends: Option<FloatAttribute>,
}

impl PolylineGeometryAttributes {
    pub fn with_batch_id() -> Self {
        Self {
            batch_ids: Some(FloatAttribute::new(vec![], 1)),
            batch_index: Some(UintAttribute::new(vec![], 1)),
            ..Default::default()
        }
    }

    pub fn with_batch_id_and_rte() -> Self {
        Self {
            start: Some(FloatAttribute::new(vec![], 3)),
            forward_offset: Some(FloatAttribute::new(vec![], 3)),
            start_normal_and_length_high: Some(FloatAttribute::new(vec![], 4)),
            end_normal_and_segment_length: Some(FloatAttribute::new(vec![], 4)),
            batch_ids: Some(FloatAttribute::new(vec![], 1)),
            batch_index: Some(UintAttribute::new(vec![], 1)),
            position_high: Some(FloatAttribute::new(vec![], 3)),
            position_low: Some(FloatAttribute::new(vec![], 3)),
            start_high: Some(FloatAttribute::new(vec![], 3)),
            start_low: Some(FloatAttribute::new(vec![], 3)),
            end_high: Some(FloatAttribute::new(vec![], 3)),
            end_low: Some(FloatAttribute::new(vec![], 3)),
            line_segments: Some(FloatAttribute::new(vec![], 4)),
            ..Default::default()
        }
    }
}

impl Default for PolylineGeometryAttributes {
    fn default() -> Self {
        Self {
            position: FloatAttribute::new(vec![], 3),
            position_high: None,
            position_low: None,
            start: None,
            start_high: None,
            start_low: None,
            forward_offset: None,
            end_high: None,
            end_low: None,
            start_normal_and_length_high: None,
            end_normal_and_segment_length: None,
            right_normal_and_line_length: FloatAttribute::new(vec![], 4),
            batch_ids: None,
            batch_index: None,
            line_segments: None,
            line_distance_and_ends: None,
        }
    }
}

/// Encodes a Vec<f64> of 3D coordinates into high/low precision FloatAttributes
/// # Arguments
/// * `f64_coords` - Optional vector of f64 coordinates in [x, y, z, x, y, z, ...] format
///
/// # Returns
/// A tuple of (Option<FloatAttribute>, Option<FloatAttribute>) for high and low components
fn encode_f64_to_high_low(
    f64_coords: Option<Vec<f64>>,
) -> (Option<FloatAttribute>, Option<FloatAttribute>) {
    let Some(coords) = f64_coords else {
        return (None, None);
    };

    let mut high_values = Vec::with_capacity(coords.len());
    let mut low_values = Vec::with_capacity(coords.len());

    for i in (0..coords.len()).step_by(3) {
        let encoded = EncodedVec3::encode_xyz(coords[i], coords[i + 1], coords[i + 2]);

        high_values.push(encoded.high.x as f32);
        high_values.push(encoded.high.y as f32);
        high_values.push(encoded.high.z as f32);

        low_values.push(encoded.low.x as f32);
        low_values.push(encoded.low.y as f32);
        low_values.push(encoded.low.z as f32);
    }

    (
        Some(FloatAttribute::new(high_values, 3)),
        Some(FloatAttribute::new(low_values, 3)),
    )
}

// Ref: https://github.com/CesiumGS/cesium/blob/165e0fb4fcc9a448b15de6a2df46db23c71fffda/packages/engine/Source/Core/GroundPolylineGeometry.js#L1055
pub(super) fn generate_geometry_attributes(
    bottom_positions_array: Vec<f64>,
    top_positions_array: Vec<f64>,
    normals_array: Vec<f64>,
    _cartographics_array: Vec<f64>,
    clamp_to_ground: bool,
    use_rte: bool,
    // Whether the wall closes back on its first vertex, so the segment before
    // the first one is the last.
    closed_ring: bool,
) -> (PolylineGeometryAttributes, Vec<u32>) {
    let segment_count = bottom_positions_array.len() / 3 - 1;
    let vertex_count = segment_count * 8;
    let array_size_vec3 = vertex_count * 3;
    let array_size_vec4 = vertex_count * 4;
    let index_count = segment_count * 36;

    let mut indices = vec![0; index_count];
    let mut positions_array = vec![0.; vertex_count * 3];

    // Keep f64 positions for RTE encoding if needed
    let mut positions_f64 = if use_rte {
        Some(Vec::with_capacity(vertex_count * 3))
    } else {
        None
    };

    let mut starts_array = vec![0.; array_size_vec3];
    // Keep f64 starts for RTE encoding if needed
    let mut starts_f64 = if use_rte {
        Some(Vec::with_capacity(array_size_vec3))
    } else {
        None
    };
    let mut forward_offsets = vec![0.; array_size_vec3];
    // Keep f64 ends for RTE encoding if needed (for calculating offset in shader)
    let mut ends_f64 = if use_rte {
        Some(Vec::with_capacity(array_size_vec3))
    } else {
        None
    };
    let mut line_segments = if use_rte {
        Some(Vec::with_capacity(segment_count * LINE_SEGMENT_TEXELS * 4))
    } else {
        None
    };
    let mut start_normal_and_length_high = vec![0.; array_size_vec4];
    let mut end_normal_and_segment_length = vec![0.; array_size_vec4];
    let mut right_normal_and_line_length = vec![0.; array_size_vec4];

    // let cartographics_length_full = cartographics_array.len();
    // let cartographics_length = cartographics_length_full / 2;

    // For calculating the terrain height
    // let start_cartographic: LLE<f32, Radians> =
    //     LLE::from_float(cartographics_array[0], cartographics_array[1], 0.);
    // let end_cartographic: LLE<f32, Radians> = LLE::from_float(
    //     cartographics_array[cartographics_length_full - 2],
    //     cartographics_array[cartographics_length_full - 1],
    //     0.,
    // );

    // Generates segments

    let mut index = 3;

    let mut end_bottom = unpack_flatten_vec3(&bottom_positions_array, 0);
    let mut end_top = unpack_flatten_vec3(&top_positions_array, 0);
    let mut end_geometry_normal = unpack_flatten_vec3(&normals_array, 0);

    let mut length_so_far: f64 = 0.;

    // For the bounding sphere
    // let mut sum_heights = 0.;

    let mut miter_broken = None;

    // A ring's first segment continues from its last one, so it enters the loop
    // with that segment's state: a seam sharp enough to break the miter must
    // break it on both sides, or the two ends stop sharing a plane and the
    // corner opens up again.
    if closed_ring && segment_count >= 2 {
        let last = segment_count * 3;
        let seam_normal = unpack_flatten_vec3(&normals_array, last);
        miter_broken = break_miter(
            seam_normal,
            unpack_flatten_vec3(&bottom_positions_array, last - 3),
            unpack_flatten_vec3(&bottom_positions_array, last),
            unpack_flatten_vec3(&top_positions_array, last),
        );
        if let Some(broken) = miter_broken {
            end_geometry_normal = broken;
        }
    }

    let reference_indices_length = REFERENCE_INDICES.len();

    let mut vec3s_write_index = 0;
    let mut vec4s_write_index = 0;

    for segment in 0..segment_count {
        let start_bottom = end_bottom;
        let start_top = end_top;
        let mut start_geometry_normal = end_geometry_normal;

        if miter_broken.is_some() {
            start_geometry_normal = -start_geometry_normal;
        }

        end_bottom = unpack_flatten_vec3(&bottom_positions_array, index);
        end_top = unpack_flatten_vec3(&top_positions_array, index);
        end_geometry_normal = unpack_flatten_vec3(&normals_array, index);

        miter_broken = break_miter(end_geometry_normal, start_bottom, end_bottom, end_top);
        if let Some(miter_broken) = miter_broken {
            end_geometry_normal = miter_broken;
        }

        /****************************************
         * Geometry descriptors of a "line on terrain,"
         * as opposed to the "shadow volume used to draw
         * the line on terrain":
         * - position of start + offset to end
         * - start, end, and right-facing planes
         * - segment length and length so far along the line, in meters
         ****************************************/

        let segment_length = start_bottom.distance(end_bottom);
        let length_so_far_high =
            (length_so_far / LINE_LENGTH_HIGH_STEP).floor() * LINE_LENGTH_HIGH_STEP;
        let length_so_far_low = length_so_far - length_so_far_high;

        if let Some(ref mut table) = line_segments {
            append_line_segment(
                table,
                start_bottom,
                end_bottom,
                length_so_far_high,
                length_so_far_low,
                segment,
                closed_ring,
            );
        }

        let forward_offset = end_bottom - start_bottom;
        let forward = forward_offset.normalize();

        let start_up = (start_top - start_bottom).normalize();
        let right_normal = forward.cross(start_up).normalize();

        let start_plane_normal = start_up.cross(start_geometry_normal).normalize();

        let end_up = (end_top - end_bottom).normalize();
        let end_plane_normal = end_geometry_normal.cross(end_up).normalize();

        // Adjust height for actual rendering
        // The actual height is updated by shader uniform.
        let min_height = 0.;
        let max_height = if clamp_to_ground { 1. } else { 0. };

        let (adjust_height_start_bottom, adjust_height_start_top) =
            adjust_height(start_bottom, start_top, min_height, max_height);
        let (adjust_height_end_bottom, adjust_height_end_top) =
            adjust_height(end_bottom, end_top, min_height, max_height);

        // Pack
        for j in 0..8 {
            let vec4_index = vec4s_write_index + j * 4;
            let vec3_index = vec3s_write_index + j * 3;
            let w_index = vec4_index + 3;

            let right_plane_side = if j < 4 { 1. } else { -1. };

            append_flatten_vec3_with_index(&mut starts_array, &start_bottom, vec3_index);
            // Store f64 start for RTE encoding using unadjusted coordinates
            // CRITICAL: start/end are used for plane calculations in shader, must use original coords
            if let Some(ref mut f64_starts) = starts_f64 {
                f64_starts.push(start_bottom.x);
                f64_starts.push(start_bottom.y);
                f64_starts.push(start_bottom.z);
            }
            append_flatten_vec3_with_index(&mut forward_offsets, &forward_offset, vec3_index);
            // Store f64 end for RTE encoding (end = start + forward_offset)
            // CRITICAL: Must use unadjusted coordinates for plane calculations
            if let Some(ref mut f64_ends) = ends_f64 {
                f64_ends.push(end_bottom.x);
                f64_ends.push(end_bottom.y);
                f64_ends.push(end_bottom.z);
            }
            append_flatten_vec3_with_index(
                &mut start_normal_and_length_high,
                &start_plane_normal,
                vec4_index,
            );
            start_normal_and_length_high[w_index] = length_so_far_high as f32;

            append_flatten_vec3_with_index(
                &mut end_normal_and_segment_length,
                &end_plane_normal,
                vec4_index,
            );
            end_normal_and_segment_length[w_index] = (segment_length * right_plane_side) as f32;

            append_flatten_vec3_with_index(
                &mut right_normal_and_line_length,
                &right_normal,
                vec4_index,
            );
            right_normal_and_line_length[w_index] = length_so_far_low as f32;
        }

        if let Some(ref mut f64_positions) = positions_f64 {
            // 8 vertices per segment (repeated positions for each corner)
            // Use adjusted coordinates so that the wall is collapsed when clampToGround=false
            // (matching the non-RTE positions_array). The shader's height extrusion uniform
            // will add the correct height on top of these positions.
            f64_positions.extend_from_slice(&[
                adjust_height_start_bottom.x,
                adjust_height_start_bottom.y,
                adjust_height_start_bottom.z,
                adjust_height_end_bottom.x,
                adjust_height_end_bottom.y,
                adjust_height_end_bottom.z,
                adjust_height_end_top.x,
                adjust_height_end_top.y,
                adjust_height_end_top.z,
                adjust_height_start_top.x,
                adjust_height_start_top.y,
                adjust_height_start_top.z,
                adjust_height_start_bottom.x,
                adjust_height_start_bottom.y,
                adjust_height_start_bottom.z,
                adjust_height_end_bottom.x,
                adjust_height_end_bottom.y,
                adjust_height_end_bottom.z,
                adjust_height_end_top.x,
                adjust_height_end_top.y,
                adjust_height_end_top.z,
                adjust_height_start_top.x,
                adjust_height_start_top.y,
                adjust_height_start_top.z,
            ]);
        }

        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_start_bottom,
            vec3s_write_index,
        );
        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_end_bottom,
            vec3s_write_index + 3,
        );
        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_end_top,
            vec3s_write_index + 6,
        );
        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_start_top,
            vec3s_write_index + 9,
        );

        // TODO: Calculate the nudge here.

        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_start_bottom,
            vec3s_write_index + 12,
        );
        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_end_bottom,
            vec3s_write_index + 15,
        );
        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_end_top,
            vec3s_write_index + 18,
        );
        append_flatten_vec3_with_index(
            &mut positions_array,
            &adjust_height_start_top,
            vec3s_write_index + 21,
        );

        index += 3;

        vec3s_write_index += 24;
        vec4s_write_index += 32;
        length_so_far += segment_length;
    }

    index = 0;
    let mut index_offset = 0;
    for _ in 0..segment_count {
        for j in 0..reference_indices_length {
            indices[index + j] = REFERENCE_INDICES[j] + index_offset;
        }
        index_offset += 8;
        index += reference_indices_length;
    }

    // Encode positions as high/low for RTE if requested
    let (position_high, position_low) = encode_f64_to_high_low(positions_f64);
    let (start_high, start_low) = encode_f64_to_high_low(starts_f64);
    let (end_high, end_low) = encode_f64_to_high_low(ends_f64);

    let attributes = PolylineGeometryAttributes {
        position: FloatAttribute::new(positions_array, 3),
        position_high,
        position_low,
        start: Some(FloatAttribute::new(starts_array, 3)),
        start_high,
        start_low,
        forward_offset: Some(FloatAttribute::new(forward_offsets, 3)),
        end_high,
        end_low,
        start_normal_and_length_high: Some(FloatAttribute::new(start_normal_and_length_high, 4)),
        end_normal_and_segment_length: Some(FloatAttribute::new(end_normal_and_segment_length, 4)),
        right_normal_and_line_length: FloatAttribute::new(right_normal_and_line_length, 4),
        batch_ids: None,
        batch_index: None,
        line_segments: line_segments.map(|table| FloatAttribute::new(table, 4)),
        line_distance_and_ends: None,
    };

    // TODO: Bounding sphere

    (attributes, indices)
}
