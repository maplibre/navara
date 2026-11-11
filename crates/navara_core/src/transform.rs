// Ref: https://github.com/CesiumGS/cesium/blob/6c2e520420b95bcb6c8eba0f02c76347cee1dd4b/packages/engine/Source/Core/Transforms.js

use navara_math::{EPSILON14, EqualEpsilon, FloatType, Mat4, Vec3, Vec4};

use crate::{Ellipsoid, vec3_to_xyz, xyz_to_vec3};

#[derive(Debug)]
enum LocalFrame {
    East,
    West,
    North,
    South,
    Up,
    Down,
}

impl LocalFrame {
    fn position(&self) -> Vec3 {
        match &self {
            LocalFrame::North => Vec3::new(-1., 0., 0.),
            LocalFrame::East => Vec3::new(0., 1., 0.),
            LocalFrame::Up => Vec3::new(0., 0., 1.),
            LocalFrame::South => Vec3::new(1., 0., 0.),
            LocalFrame::West => Vec3::new(0., -1., 0.),
            LocalFrame::Down => Vec3::new(0., 0., -1.),
        }
    }

    fn third_axis(&self, second: &Self) -> Self {
        match self {
            LocalFrame::Up => match second {
                LocalFrame::South => LocalFrame::East,
                LocalFrame::North => LocalFrame::West,
                LocalFrame::West => LocalFrame::South,
                LocalFrame::East => LocalFrame::North,
                _ => unreachable!(),
            },
            LocalFrame::Down => match second {
                LocalFrame::South => LocalFrame::West,
                LocalFrame::North => LocalFrame::East,
                LocalFrame::West => LocalFrame::North,
                LocalFrame::East => LocalFrame::South,
                _ => unreachable!(),
            },
            LocalFrame::South => match second {
                LocalFrame::Up => LocalFrame::West,
                LocalFrame::Down => LocalFrame::East,
                LocalFrame::West => LocalFrame::Down,
                LocalFrame::East => LocalFrame::Up,
                _ => unreachable!(),
            },
            LocalFrame::North => match second {
                LocalFrame::Up => LocalFrame::East,
                LocalFrame::Down => LocalFrame::West,
                LocalFrame::West => LocalFrame::Up,
                LocalFrame::East => LocalFrame::Down,
                _ => unreachable!(),
            },
            LocalFrame::West => match second {
                LocalFrame::Up => LocalFrame::North,
                LocalFrame::Down => LocalFrame::South,
                LocalFrame::North => LocalFrame::Down,
                LocalFrame::South => LocalFrame::Up,
                _ => unreachable!(),
            },
            LocalFrame::East => match second {
                LocalFrame::Up => LocalFrame::South,
                LocalFrame::Down => LocalFrame::North,
                LocalFrame::North => LocalFrame::Up,
                LocalFrame::South => LocalFrame::Down,
                _ => unreachable!(),
            },
        }
    }
}

fn local_frame_to_fixed_frame(
    first: LocalFrame,
    second: LocalFrame,
    origin: Vec3,
    ellipsoid: Ellipsoid<FloatType>,
) -> Mat4 {
    let third = first.third_axis(&second);
    let mut first_vec: Vec3;
    let mut second_vec: Vec3;
    let mut third_vec: Vec3;
    if origin.equal_epsilon(EPSILON14) {
        // If x, y, and z are zero, use the degenerate local frame, which is a special case
        first_vec = first.position();
        second_vec = second.position();
        third_vec = third.position();
    } else if origin.x.equal_epsilon(EPSILON14) && origin.y.equal_epsilon(EPSILON14) {
        // If x and y are zero, assume origin is at a pole, which is a special case.
        let sign = origin.z.signum();

        first_vec = first.position();
        if !matches!(first, LocalFrame::East | LocalFrame::West) {
            first_vec *= sign;
        }

        second_vec = second.position();
        if !matches!(second, LocalFrame::East | LocalFrame::West) {
            second_vec *= sign;
        }

        third_vec = third.position();
        if !matches!(third, LocalFrame::East | LocalFrame::West) {
            third_vec *= sign;
        }
    } else {
        let up = ellipsoid.geodetic_surface_normal_from_vec3(vec3_to_xyz(origin));
        let up = xyz_to_vec3(up).normalize();
        let east = Vec3::new(-origin.y, origin.x, 0.).normalize();
        let north = up.cross(east);

        let down = up * -1.;
        let west = east * -1.;
        let south = north * -1.;

        let local_frame_position = |l: &LocalFrame| -> Vec3 {
            match l {
                LocalFrame::North => north,
                LocalFrame::South => south,
                LocalFrame::West => west,
                LocalFrame::East => east,
                LocalFrame::Up => up,
                LocalFrame::Down => down,
            }
        };

        first_vec = local_frame_position(&first);
        second_vec = local_frame_position(&second);
        third_vec = local_frame_position(&third);
    }
    Mat4 {
        x_axis: Vec4::new(first_vec.x, first_vec.y, first_vec.z, 0.),
        y_axis: Vec4::new(second_vec.x, second_vec.y, second_vec.z, 0.),
        z_axis: Vec4::new(third_vec.x, third_vec.y, third_vec.z, 0.),
        w_axis: Vec4::new(origin.x, origin.y, origin.z, 1.),
    }
}

pub fn east_north_up_to_fixed_frame(origin: Vec3, ellipsoid: Ellipsoid<FloatType>) -> Mat4 {
    local_frame_to_fixed_frame(LocalFrame::East, LocalFrame::North, origin, ellipsoid)
}
pub fn north_east_down_to_fixed_frame(origin: Vec3, ellipsoid: Ellipsoid<FloatType>) -> Mat4 {
    local_frame_to_fixed_frame(LocalFrame::North, LocalFrame::East, origin, ellipsoid)
}
pub fn north_up_east_to_fixed_frame(origin: Vec3, ellipsoid: Ellipsoid<FloatType>) -> Mat4 {
    local_frame_to_fixed_frame(LocalFrame::North, LocalFrame::Up, origin, ellipsoid)
}
pub fn north_west_up_to_fixed_frame(origin: Vec3, ellipsoid: Ellipsoid<FloatType>) -> Mat4 {
    local_frame_to_fixed_frame(LocalFrame::North, LocalFrame::West, origin, ellipsoid)
}

#[cfg(test)]
mod test {
    use approx::assert_abs_diff_eq;
    use navara_math::{AbsDiffEqVec4, EPSILON5, Vec3, Vec4};

    const EPSILON5_VEC4: Vec4 = Vec4::new(EPSILON5, EPSILON5, EPSILON5, EPSILON5);

    use crate::{
        UNIT_SPHERE_64, WGS84_64,
        transform::{
            north_east_down_to_fixed_frame, north_up_east_to_fixed_frame,
            north_west_up_to_fixed_frame,
        },
    };

    use super::east_north_up_to_fixed_frame;

    // east_north_up_to_fixed_frame

    #[test]
    fn it_calculates_east_north_up_to_fixed_frame() {
        let origin = Vec3::new(1.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = east_north_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::Y); // east
        assert_eq!(result.y_axis, Vec4::Z); // north
        assert_eq!(result.z_axis, Vec4::X); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_east_north_up_to_fixed_frame_at_the_north_pole() {
        let origin = Vec3::new(0.0, 0.0, 1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = east_north_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::Y); // east
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.y_axis),
            AbsDiffEqVec4(Vec4::new(-1.0, 0.0, 0.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // north
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.z_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, 1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_keeps_unit_axes_with_up_outward_at_the_wgs84_north_pole() {
        let origin = Vec3::new(0.0, 0.0, 6356752.314245);

        let result = east_north_up_to_fixed_frame(origin, WGS84_64);
        assert_eq!(result.x_axis, Vec4::Y); // east
        assert_eq!(result.y_axis, Vec4::NEG_X); // north
        assert_eq!(result.z_axis, Vec4::Z); // up
    }

    #[test]
    fn it_calculates_east_north_up_to_fixed_frame_at_the_south_pole() {
        let origin = Vec3::new(0.0, 0.0, -1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = east_north_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::Y); // east
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.y_axis),
            AbsDiffEqVec4(Vec4::new(1.0, 0., 0., 0.)),
            epsilon = EPSILON5_VEC4
        ); // north
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.z_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, -1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_east_north_up_to_fixed_frame_at_origin() {
        let origin = Vec3::new(0.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = east_north_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::Y); // east
        assert_eq!(result.y_axis, Vec4::NEG_X); // north
        assert_eq!(result.z_axis, Vec4::Z); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    // north_east_down_to_fixed_frame

    #[test]
    fn it_calculates_north_east_down_to_fixed_frame() {
        let origin = Vec3::new(1.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_east_down_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::Z); // east
        assert_eq!(result.y_axis, Vec4::Y); // north
        assert_eq!(result.z_axis, Vec4::NEG_X); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_east_down_to_fixed_frame_at_the_north_pole() {
        let origin = Vec3::new(0.0, 0.0, 1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_east_down_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.x_axis),
            AbsDiffEqVec4(Vec4::new(-1.0, 0.0, 0.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // east
        assert_eq!(result.y_axis, Vec4::Y); // north
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.z_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, -1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_east_down_to_fixed_frame_at_the_south_pole() {
        let origin = Vec3::new(0.0, 0.0, -1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_east_down_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.x_axis),
            AbsDiffEqVec4(Vec4::new(1.0, 0., 0., 0.)),
            epsilon = EPSILON5_VEC4
        ); // east
        assert_eq!(result.y_axis, Vec4::Y); // north
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.z_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, 1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_east_down_to_fixed_frame_at_origin() {
        let origin = Vec3::new(0.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_east_down_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::NEG_X); // east
        assert_eq!(result.y_axis, Vec4::Y); // north
        assert_eq!(result.z_axis, Vec4::NEG_Z); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    // north_up_east_to_fixed_frame

    #[test]
    fn it_calculates_north_up_east_to_fixed_frame() {
        let origin = Vec3::new(1.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_up_east_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::Z); // east
        assert_eq!(result.y_axis, Vec4::X); // north
        assert_eq!(result.z_axis, Vec4::Y); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_up_east_to_fixed_frame_at_the_north_pole() {
        let origin = Vec3::new(0.0, 0.0, 1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_up_east_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.x_axis),
            AbsDiffEqVec4(Vec4::new(-1.0, 0.0, 0.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // east
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.y_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, 1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // north
        assert_eq!(result.z_axis, Vec4::Y); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_up_east_to_fixed_frame_at_the_south_pole() {
        let origin = Vec3::new(0.0, 0.0, -1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_up_east_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.x_axis),
            AbsDiffEqVec4(Vec4::new(1.0, 0., 0., 0.)),
            epsilon = EPSILON5_VEC4
        ); // east
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.y_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, -1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // north
        assert_eq!(result.z_axis, Vec4::Y); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_up_east_to_fixed_frame_at_origin() {
        let origin = Vec3::new(0.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_up_east_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::NEG_X); // east
        assert_eq!(result.y_axis, Vec4::Z); // north
        assert_eq!(result.z_axis, Vec4::Y); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    // north_west_up_to_fixed_frame

    #[test]
    fn it_calculates_north_west_up_to_fixed_frame() {
        let origin = Vec3::new(1.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_west_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::Z); // east
        assert_eq!(result.y_axis, Vec4::NEG_Y); // north
        assert_eq!(result.z_axis, Vec4::X); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_west_up_to_fixed_frame_at_the_north_pole() {
        let origin = Vec3::new(0.0, 0.0, 1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_west_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.x_axis),
            AbsDiffEqVec4(Vec4::new(-1.0, 0.0, 0.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // east
        assert_eq!(result.y_axis, Vec4::NEG_Y); // north
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.z_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, 1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_west_up_to_fixed_frame_at_the_south_pole() {
        let origin = Vec3::new(0.0, 0.0, -1.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_west_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.x_axis),
            AbsDiffEqVec4(Vec4::new(1.0, 0., 0., 0.)),
            epsilon = EPSILON5_VEC4
        ); // east
        assert_eq!(result.y_axis, Vec4::NEG_Y); // north
        assert_abs_diff_eq!(
            AbsDiffEqVec4(result.z_axis),
            AbsDiffEqVec4(Vec4::new(0.0, 0.0, -1.0, 0.0)),
            epsilon = EPSILON5_VEC4
        ); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }

    #[test]
    fn it_calculates_north_west_up_to_fixed_frame_at_origin() {
        let origin = Vec3::new(0.0, 0.0, 0.0);
        let expected_translation = Vec4::new(origin.x, origin.y, origin.z, 1.0);

        let result = north_west_up_to_fixed_frame(origin, UNIT_SPHERE_64);
        assert_eq!(result.x_axis, Vec4::NEG_X); // east
        assert_eq!(result.y_axis, Vec4::NEG_Y); // north
        assert_eq!(result.z_axis, Vec4::Z); // up
        assert_eq!(result.w_axis, expected_translation); // translation
    }
}
