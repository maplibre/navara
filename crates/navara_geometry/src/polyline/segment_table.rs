use navara_core::EncodedVec3;
use navara_math::Vec3;

/// Texels (RGBA floats) of one segment in a volume polyline's segment table.
pub const LINE_SEGMENT_TEXELS: usize = 3;

/// Appends one segment to a volume polyline's segment table, which lets a
/// fragment find the point of the line at any length, in any segment:
/// - texel 0: `(start high, length so far high)`
/// - texel 1: `(start low, length so far low)`
/// - texel 2: `(end - start, position in the line)`
///
/// The position in the line is the number of segments before this one in its
/// line, `n`, stored as `-(n + 1)` when the line is a closed ring. It is
/// relative, so tables stay valid when batching concatenates them.
///
/// Entries follow the geometry's segments, eight vertices each, so a vertex's
/// entry is its index divided by eight.
pub(super) fn append_line_segment(
    table: &mut Vec<f32>,
    start: Vec3,
    end: Vec3,
    length_so_far_high: f64,
    length_so_far_low: f64,
    segments_before: usize,
    closed_ring: bool,
) {
    // The shader takes the segment length from `end - start`.
    debug_assert!(start != end, "zero-length segment in a volume polyline");
    let encoded = EncodedVec3::encode_xyz(start.x, start.y, start.z);
    let offset = end - start;
    let position_in_line = if closed_ring {
        -(segments_before as f32) - 1.
    } else {
        segments_before as f32
    };
    table.extend_from_slice(&[
        encoded.high.x as f32,
        encoded.high.y as f32,
        encoded.high.z as f32,
        length_so_far_high as f32,
        encoded.low.x as f32,
        encoded.low.y as f32,
        encoded.low.z as f32,
        length_so_far_low as f32,
        offset.x as f32,
        offset.y as f32,
        offset.z as f32,
        position_in_line,
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_one_entry_per_segment() {
        let mut table = vec![];
        let start = Vec3::new(65537., 2., 3.);
        append_line_segment(
            &mut table,
            start,
            Vec3::new(65540., 2., 3.),
            0.,
            0.,
            0,
            false,
        );
        append_line_segment(
            &mut table,
            Vec3::new(65540., 2., 3.),
            Vec3::new(65541., 2., 3.),
            16384.,
            5.,
            1,
            false,
        );

        assert_eq!(table.len(), 2 * LINE_SEGMENT_TEXELS * 4);
        let encoded = EncodedVec3::encode(start);
        assert_eq!(
            table[..12],
            [
                encoded.high.x as f32,
                encoded.high.y as f32,
                encoded.high.z as f32,
                0.,
                encoded.low.x as f32,
                encoded.low.y as f32,
                encoded.low.z as f32,
                0.,
                3.,
                0.,
                0.,
                0.,
            ]
        );
        // The high and low parts add up to the start.
        assert_eq!((table[12] as f64) + (table[16] as f64), 65540.);
        assert_eq!(table[12 + 3], 16384.);
        assert_eq!(table[12 + 7], 5.);
        assert_eq!(table[12 + 8..], [1., 0., 0., 1.]);
    }

    #[test]
    fn marks_the_segments_of_a_closed_ring_negative() {
        let mut table = vec![];
        let corners = [
            Vec3::new(1., 0., 0.),
            Vec3::new(2., 0., 0.),
            Vec3::new(2., 1., 0.),
        ];
        for (i, &start) in corners.iter().enumerate() {
            append_line_segment(
                &mut table,
                start,
                corners[(i + 1) % corners.len()],
                0.,
                i as f64,
                i,
                true,
            );
        }
        let positions: Vec<f32> = table.chunks(4).skip(2).step_by(3).map(|t| t[3]).collect();
        assert_eq!(positions, [-1., -2., -3.]);
    }
}
