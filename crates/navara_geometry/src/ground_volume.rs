//! Height ranges for clamp-to-ground volumes built with the default
//! granularities.

use navara_core::{Aabb, Extent, Radians, WGS84_64};
use navara_math::FloatType;

use crate::{DEFAULT_POLYGON_GRANULARITY, DEFAULT_POLYLINE_GRANULARITY_METERS};

/// Slack in metres on both sides of the range, so the volume's faces never
/// coincide with the terrain they must enclose under depth testing.
const DEPTH_SLACK: FloatType = 5.;

/// Upper bound on the angle between two points of `extent`.
fn extent_span(extent: Extent<FloatType, Radians>) -> FloatType {
    let half_diagonal = Aabb::from_extent_f64(extent, 0., 0.).extents.length();
    // A chord spans its widest angle on the tightest sphere.
    2. * (half_diagonal / WGS84_64.semi_minor_axis()).min(1.).asin()
}

/// Pads `range` so a volume over `extent` whose flat faces join vertices up
/// to `apex_angle` radians away still encloses the rendered ground. A flat face
/// dips below its vertices by up to `r - r cos(a)` at `a` from them, so:
///
/// - the top is raised until its faces clear `range.1`: `r / cos(apex_angle)`;
/// - the bottom is lowered under the globe's own flat triangles, which dip
///   below `range.0` by as much when they span the extent. Larger globe
///   triangles render only far enough away that the extent covers a few
///   pixels.
///
/// Taken on a sphere of the semi-major axis; the ellipsoid's tighter
/// meridional curvature adds under 1%.
fn enclose(
    range: (FloatType, FloatType),
    apex_angle: FloatType,
    extent: Extent<FloatType, Radians>,
) -> (FloatType, FloatType) {
    let radius = WGS84_64.semi_major_axis();
    let top = radius + range.1;
    let lift = top / apex_angle.cos() - top;
    let ground_apex = extent_span(extent) / (3. as FloatType).sqrt();
    let bottom = (radius + range.0) * ground_apex.cos() - radius;
    (bottom - DEPTH_SLACK, range.1 + lift + DEPTH_SLACK)
}

/// Height range a clamp-to-ground polygon volume over `extent` must span to
/// enclose the ground heights `range`. A point inside a cap triangle is at
/// most `edge / √3` from a vertex.
pub fn polygon_ground_volume(
    range: (FloatType, FloatType),
    extent: Extent<FloatType, Radians>,
) -> (FloatType, FloatType) {
    let edge = (DEFAULT_POLYGON_GRANULARITY as FloatType).min(extent_span(extent));
    enclose(range, edge / (3. as FloatType).sqrt(), extent)
}

/// Height range a clamp-to-ground polyline volume over `extent` must span to
/// enclose the ground heights `range`. A point on a segment is at most half
/// its length from an end.
pub fn polyline_ground_volume(
    range: (FloatType, FloatType),
    extent: Extent<FloatType, Radians>,
) -> (FloatType, FloatType) {
    let granularity = DEFAULT_POLYLINE_GRANULARITY_METERS / WGS84_64.semi_major_axis();
    let segment = granularity.min(extent_span(extent));
    enclose(range, segment / 2., extent)
}

#[cfg(test)]
mod tests {
    use navara_core::Angle;
    use navara_math::{RADIANS_PER_DEGREE, Vec3};

    use super::*;

    const RANGE: (FloatType, FloatType) = (-50., 3776.);

    fn extent(west: f64, south: f64, east: f64, north: f64) -> Extent<FloatType, Radians> {
        Extent {
            west: Angle::new(west * RADIANS_PER_DEGREE),
            south: Angle::new(south * RADIANS_PER_DEGREE),
            east: Angle::new(east * RADIANS_PER_DEGREE),
            north: Angle::new(north * RADIANS_PER_DEGREE),
        }
    }

    fn radius() -> FloatType {
        WGS84_64.semi_major_axis()
    }

    /// Radius at `angle` from the vertices of a flat face at radius `top`.
    fn face_radius_at(top: FloatType, angle: FloatType) -> FloatType {
        top * angle.cos()
    }

    /// A point at `lng`/`lat` degrees on a sphere of `r`.
    fn on_sphere(lng: f64, lat: f64, r: FloatType) -> Vec3 {
        let (lng, lat) = (lng * RADIANS_PER_DEGREE, lat * RADIANS_PER_DEGREE);
        Vec3::new(lat.cos() * lng.cos(), lat.cos() * lng.sin(), lat.sin()) * r
    }

    #[test]
    fn lifts_a_full_cap_triangle_centre_above_the_range() {
        let (_, max) = polygon_ground_volume(RANGE, extent(130., 30., 140., 40.));

        let centre = face_radius_at(
            radius() + max,
            DEFAULT_POLYGON_GRANULARITY as FloatType / (3. as FloatType).sqrt(),
        );
        assert!(centre > radius() + RANGE.1);
        assert!(centre < radius() + RANGE.1 + 10.);
    }

    #[test]
    fn lifts_a_full_segment_midpoint_above_the_range() {
        let (_, max) = polyline_ground_volume(RANGE, extent(130., 30., 140., 40.));

        let midpoint = face_radius_at(
            radius() + max,
            DEFAULT_POLYLINE_GRANULARITY_METERS / radius() / 2.,
        );
        assert!(midpoint > radius() + RANGE.1);
        assert!(midpoint < radius() + RANGE.1 + 10.);
    }

    #[test]
    fn lowers_the_bottom_under_a_ground_triangle_spanning_the_extent() {
        // A globe triangle with its vertices on three corners of the extent,
        // at the lowest ground height. Its centroid sinks below them.
        let ground = radius() + RANGE.0;
        let centroid = (on_sphere(130., 30., ground)
            + on_sphere(140., 30., ground)
            + on_sphere(140., 40., ground))
            / 3.;
        let ground_low = centroid.length();
        assert!(ground_low < ground - 10_000., "the triangle must sag");

        let wide = extent(130., 30., 140., 40.);
        for (min, _) in [
            polygon_ground_volume(RANGE, wide),
            polyline_ground_volume(RANGE, wide),
        ] {
            assert!(radius() + min < ground_low);
        }
    }

    #[test]
    fn barely_pads_a_shape_smaller_than_the_granularity() {
        let small = extent(138.7, 35.3, 138.71, 35.31);
        for (min, max) in [
            polygon_ground_volume(RANGE, small),
            polyline_ground_volume(RANGE, small),
        ] {
            assert!(max - RANGE.1 < 10.);
            assert!(RANGE.0 - min < 10.);
        }
    }
}
