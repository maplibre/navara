use navara_core::{Ellipsoid, Ray, WGS84_64, east_north_up_to_fixed_frame, ray_ellipsoid};
use navara_math::{
    EPSILON3, EPSILON10, EqualEpsilon, FloatType, PI_OVER_TWO, Quat, TWO_PI, Transform, Vec2, Vec3,
    zero_to_two_pi,
};
use navara_window::Window;

use crate::CameraFrustum;

// Ref: https://github.com/CesiumGS/cesium/blob/0e9a425b475cd3cfdd90f35e9cdbdda453e448d8/packages/engine/Source/Scene/Camera.js#L3035
pub fn get_pick_ray_from_camera(
    window: &Window,
    camera_transform: &Transform,
    frustum: &CameraFrustum,
    position_2d: Vec2,
) -> Ray {
    get_pick_ray_perspective(window, camera_transform, frustum, position_2d)
}

pub fn ray_ellipsoid_intersect(ray: &Ray, ellipsoid: Ellipsoid<FloatType>) -> Option<FloatType> {
    match ray_ellipsoid(ray, ellipsoid) {
        i if i.start == f64::INFINITY => {
            // Calculate an edge of ellipsoid
            let ellipsoid_vec3 = Vec3::new(ellipsoid.a, ellipsoid.a, ellipsoid.b);
            let forward = ellipsoid_vec3 * ray.direction;
            let distance_to_edge = forward.dot(ray.origin);

            if distance_to_edge.equal_epsilon(EPSILON10) {
                Some(1.)
            } else {
                None
            }
        }
        i if i.start != 0. => Some(i.start),
        i if i.end != 0. => Some(i.end),
        _ => None,
    }
}

// Ref: https://github.com/CesiumGS/cesium/blob/0e9a425b475cd3cfdd90f35e9cdbdda453e448d8/packages/engine/Source/Scene/Camera.js#L2946
// NOTE: We need to calculate it in f64 due to precision.
fn get_pick_ray_perspective(
    window: &Window,
    camera_transform: &Transform,
    frustum: &CameraFrustum,
    position_2d: Vec2,
) -> Ray {
    // TODO: Cache these calculation in struct
    let width = window.raw_width();
    let height = window.raw_height();
    let position = camera_transform.transform_point(Vec3::ZERO);
    let forward = camera_transform.forward();
    let right = camera_transform.right();
    let up = camera_transform.up();

    // `fov` is the vertical field of view; `tan_phi` is the vertical
    // near-plane half-extent and the horizontal one follows via the aspect.
    let tan_phi = (frustum.fov * 0.5).tan();
    let tan_theta = frustum.aspect_ratio * tan_phi;
    let near = frustum.near;

    let x = (2.0 / width) * position_2d.x - 1.0;
    let y = (2.0 / height) * (height - position_2d.y) - 1.0;

    let near_center = position + (forward * near);

    let x_dir = right * (x * near * tan_theta);
    let y_dir = up * (y * near * tan_phi);

    Ray {
        origin: position,
        direction: (near_center + x_dir + y_dir - position).normalize_or_zero(),
    }
}

// ref: https://github.com/CesiumGS/cesium/blob/fb314464d211abf51649b17151137db7a403502a/packages/engine/Source/Scene/Camera.js#L830
pub fn get_pitch(transform: &Transform) -> f64 {
    let ellipsoid = WGS84_64;
    let camera_pos = transform.transform_point(Vec3::ZERO);

    let enu_transform = east_north_up_to_fixed_frame(camera_pos, ellipsoid);
    let enu_quat = Quat::from_mat4(&enu_transform);
    let inverse = enu_quat.inverse();
    let local_forward = (inverse * transform.forward()).normalize_or_zero();

    (PI_OVER_TWO - local_forward.z.acos()).to_degrees()
}

// ref: https://github.com/CesiumGS/cesium/blob/fb314464d211abf51649b17151137db7a403502a/packages/engine/Source/Scene/Camera.js#L817C21-L817C30
pub fn get_heading(transform: &Transform) -> f64 {
    let ellipsoid = WGS84_64;
    let camera_pos = transform.transform_point(Vec3::ZERO);

    let enu_transform = east_north_up_to_fixed_frame(camera_pos, ellipsoid);
    let enu_quat = Quat::from_mat4(&enu_transform);
    let inverse = enu_quat.inverse();
    let local_up = (inverse * transform.up()).normalize_or_zero();
    let local_forward = (inverse * transform.forward()).normalize_or_zero();

    let heading = if local_forward.z.abs().equal_diff_epsilon(1.0, EPSILON3) {
        local_up.y.atan2(local_up.x) - PI_OVER_TWO
    } else {
        local_forward.y.atan2(local_forward.x) - PI_OVER_TWO
    };

    (TWO_PI - zero_to_two_pi(heading)).to_degrees()
}

// ref: https://github.com/CesiumGS/cesium/blob/fb314464d211abf51649b17151137db7a403502a/packages/engine/Source/Scene/Camera.js#L834
pub fn get_roll(transform: &Transform) -> f64 {
    let ellipsoid = WGS84_64;
    let camera_pos = transform.transform_point(Vec3::ZERO);

    let enu_transform = east_north_up_to_fixed_frame(camera_pos, ellipsoid);
    let enu_quat = Quat::from_mat4(&enu_transform);
    let inverse = enu_quat.inverse();
    let local_up = (inverse * transform.up()).normalize_or_zero();
    let local_forward = (inverse * transform.forward()).normalize_or_zero();
    let local_right = (inverse * transform.right()).normalize_or_zero();

    // Checks if the forward vector is nearly vertical (Z ≈ ±1).
    if local_forward.z.abs().equal_diff_epsilon(1.0, EPSILON3) {
        0.0
    } else {
        zero_to_two_pi((-local_right.z).atan2(local_up.z) + TWO_PI).to_degrees()
    }
}

/// Find where the camera is looking on the ellipsoid and the distance to that point.
///
/// Used for zoom calculation based on viewing distance rather than altitude.
/// Returns `None` if the camera is looking away from the ellipsoid.
pub fn calc_camera_target_and_distance(
    transform: &Transform,
    ellipsoid: Ellipsoid<f64>,
) -> Option<(Vec3, f64)> {
    let camera_pos = transform.transform_point(Vec3::ZERO);
    let camera_forward = transform.forward();

    // Normalize forward direction to ensure ray intersection returns correct distances
    let forward_length_sq = camera_forward.length_squared();
    if forward_length_sq > 0.0 {
        let ray = Ray {
            origin: camera_pos,
            direction: camera_forward.normalize(),
        };

        let intersection = ray_ellipsoid(&ray, ellipsoid);
        let distance = if intersection.start > 0.0 {
            intersection.start
        } else {
            intersection.end
        };
        if distance.is_finite() && distance > 0.0 {
            let target_point = ray.get_point(distance);
            return Some((target_point, distance));
        }
    }

    None
}

#[cfg(test)]
mod test {
    use approx::assert_abs_diff_eq;
    use navara_core::{Angle, WGS84_64};
    use navara_math::{AbsDiffEqVec3, Transform, Vec2, Vec3};
    use navara_window::Window;

    use crate::CameraFrustum;

    use super::{calc_camera_target_and_distance, get_pick_ray_from_camera};

    #[test]
    fn it_should_pick_ray_perspective() {
        let window = Window {
            width: 100.,
            height: 100.,
            pixel_ratio: 1.,
        };
        let camera = Transform::from_translation(Vec3::Z);

        assert_eq!(camera.up(), Vec3::Y);
        assert_eq!(camera.right(), Vec3::X);

        let frustum = CameraFrustum::new(
            &camera,
            0.1,
            1000.,
            Angle::new(50.).rad().val(),
            window.width / window.height,
        );

        let position_2d = Vec2::new(window.raw_width() / 2., window.raw_height() / 2.);
        let ray = get_pick_ray_from_camera(&window, &camera, &frustum, position_2d);
        assert_eq!(ray.direction, Vec3::NEG_Z,);

        let position_2d = Vec2::new(window.raw_width() / 2., window.raw_height());
        let ray = get_pick_ray_from_camera(&window, &camera, &frustum, position_2d);
        assert_abs_diff_eq!(
            AbsDiffEqVec3(ray.direction),
            AbsDiffEqVec3(Vec3::new(0., -0.42, -0.9)),
            epsilon = Vec3::new(0.01, 0.01, 0.01)
        );
    }

    #[test]
    fn pick_ray_uses_vertical_fov_on_landscape() {
        let window = Window {
            width: 200.,
            height: 100.,
            pixel_ratio: 1.,
        };
        let camera = Transform::from_translation(Vec3::Z);
        let fov = Angle::new(50.).rad().val();
        let frustum = CameraFrustum::new(&camera, 0.1, 1000., fov, 2.);

        // Bottom-center of the screen: the ray's vertical slope equals
        // tan(fov / 2) regardless of the aspect ratio (`fov` is vertical).
        let position_2d = Vec2::new(window.raw_width() / 2., window.raw_height());
        let ray = get_pick_ray_from_camera(&window, &camera, &frustum, position_2d);
        let slope = -ray.direction.y / -ray.direction.z;
        assert_abs_diff_eq!(slope, (frustum.fov * 0.5).tan(), epsilon = 1e-9);
    }

    #[test]
    fn calc_camera_target_forward_ray_hits() {
        // Camera 1000km above equator, looking down
        let camera_pos = Vec3::new(7378137.0, 0.0, 0.0);
        let mut transform = Transform::from_translation(camera_pos);
        transform.look_to(-Vec3::X, Vec3::Z);

        let result = calc_camera_target_and_distance(&transform, WGS84_64);
        assert!(result.is_some(), "Forward ray should hit");
        let (_target, distance) = result.unwrap();
        assert!(distance > 0.0 && distance < 2_000_000.0);
    }

    #[test]
    fn calc_camera_target_both_rays_miss() {
        // Camera far from Earth, looking tangent (neither forward nor fallback hits)
        // This is a rare edge case but important to handle
        let camera_pos = Vec3::new(50_000_000.0, 50_000_000.0, 0.0);
        let mut transform = Transform::from_translation(camera_pos);
        // Look perpendicular to both the forward and radial directions
        transform.look_to(Vec3::Z, Vec3::X);

        // This may still hit depending on geometry, so we just verify no panic/NaN
        let result = calc_camera_target_and_distance(&transform, WGS84_64);
        if let Some((target, distance)) = result {
            assert!(target.is_finite() && distance.is_finite());
        }
    }

    #[test]
    fn calc_camera_target_zero_position_no_nans() {
        let mut transform = Transform::from_translation(Vec3::ZERO);
        transform.look_to(Vec3::X, Vec3::Y);

        let result = calc_camera_target_and_distance(&transform, WGS84_64);
        if let Some((target, distance)) = result {
            assert!(target.is_finite() && distance.is_finite() && distance >= 0.0);
        }
    }
}
