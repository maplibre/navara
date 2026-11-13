use navara_core::{
    CRS, Ellipsoid, Ray, WGS84_64, WGS84_A_64, camera_zoom_level, east_north_up_to_fixed_frame,
    ray_ellipsoid,
};
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

/// Web Mercator zoom level of the current view, measured at the point the
/// camera looks at on the ellipsoid (as MapLibre does). `tile_size_px`
/// defaults to 256; pass 512 for MapLibre-compatible values.
///
/// Returns `None` when the camera looks away from the ellipsoid or the inputs
/// (viewport, FOV, tile size) are degenerate.
pub fn camera_view_zoom_level(
    transform: &Transform,
    frustum: &CameraFrustum,
    window: &Window,
    tile_size_px: Option<f64>,
) -> Option<f64> {
    if matches!(tile_size_px, Some(t) if t <= 0.0) {
        return None;
    }
    let viewport_height = window.raw_height();
    let fov_y = frustum.fov;

    // Use the camera-to-target distance rather than the altitude, so the zoom
    // matches the distance `setCamera` takes.
    let (target_point, distance) = calc_camera_target_and_distance(transform, WGS84_64)?;
    let target_lat = CRS::Geocentric
        .to_lle(WGS84_64, target_point, 0.0)
        .lat
        .val();

    zoom_at(distance, target_lat, viewport_height, fov_y, tile_size_px)
}

/// MapLibre's maximum camera pitch, in degrees from straight down.
const MAPLIBRE_MAX_PITCH_DEG: f64 = 85.0;

/// [`camera_view_zoom_level`] (256 px tiles) for level-of-detail decisions,
/// defined for every camera pose. MapLibre caps the pitch at 85°, so its
/// viewing distance never exceeds `height / cos(85°)`; Navara does not, so a
/// pitched camera's centre ray can hit the globe far away (a much lower zoom)
/// or miss it entirely (`None`), hiding min-zoom layers even though nearby
/// tiles fill the screen. Here the distance is clamped to what MapLibre's
/// maximum pitch allows from the camera's height, and a missed ray uses that
/// clamped distance at the camera's latitude.
///
/// Returns `None` only for a degenerate viewport or FOV.
pub fn camera_lod_zoom_level(
    transform: &Transform,
    frustum: &CameraFrustum,
    window: &Window,
) -> Option<f64> {
    let camera_lle = CRS::Geocentric.to_lle(WGS84_64, transform.translation, 0.0);
    // At least 1 m: a camera below the ellipsoid still gets a finite bound.
    let height = camera_lle.height.val().max(1.0);
    let max_distance = height / MAPLIBRE_MAX_PITCH_DEG.to_radians().cos();

    let (distance, lat) = match calc_camera_target_and_distance(transform, WGS84_64) {
        Some((target, distance)) if distance <= max_distance => (
            distance,
            CRS::Geocentric.to_lle(WGS84_64, target, 0.0).lat.val(),
        ),
        _ => (max_distance, camera_lle.lat.val()),
    };

    zoom_at(distance, lat, window.raw_height(), frustum.fov, None)
}

/// Web Mercator zoom for a viewing `distance` at latitude `lat_rad`, or `None`
/// for degenerate inputs.
fn zoom_at(
    distance: f64,
    lat_rad: f64,
    viewport_height: f64,
    fov_y: f64,
    tile_size_px: Option<f64>,
) -> Option<f64> {
    if distance <= 0.0
        || viewport_height <= 0.0
        || !fov_y.is_finite()
        || fov_y <= 0.0
        || !lat_rad.is_finite()
    {
        return None;
    }

    let zoom = camera_zoom_level(
        distance,
        fov_y,
        viewport_height,
        lat_rad,
        WGS84_A_64,
        tile_size_px,
    );
    zoom.is_finite().then_some(zoom)
}

#[cfg(test)]
mod test {
    use approx::assert_abs_diff_eq;
    use navara_core::{Angle, WGS84_64, WGS84_A_64, camera_zoom_level};
    use navara_math::{AbsDiffEqVec3, Transform, Vec2, Vec3};
    use navara_window::Window;

    use crate::CameraFrustum;

    use super::{
        calc_camera_target_and_distance, camera_lod_zoom_level, camera_view_zoom_level,
        get_pick_ray_from_camera,
    };

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
    fn camera_view_zoom_level_measures_at_the_looked_at_point() {
        // 1000 m above the equator, looking straight down.
        let mut transform = Transform::from_translation(Vec3::new(WGS84_A_64 + 1000.0, 0.0, 0.0));
        transform.look_to(-Vec3::X, Vec3::Z);
        let fov = Angle::new(60.0).rad().val();
        let frustum = CameraFrustum::new(&transform, 0.1, 1e9, fov, 800.0 / 600.0);
        let window = Window {
            width: 1600.,
            height: 1200.,
            pixel_ratio: 2.,
        };

        let zoom = camera_view_zoom_level(&transform, &frustum, &window, None).unwrap();
        // CSS-pixel viewport height (1200 / 2), latitude 0.
        let expected = camera_zoom_level(1000.0, frustum.fov, 600.0, 0.0, WGS84_A_64, None);
        assert_abs_diff_eq!(zoom, expected, epsilon = 1e-6);

        // 512 px tiles (MapLibre zoom) are exactly one level lower.
        let zoom_512 = camera_view_zoom_level(&transform, &frustum, &window, Some(512.0)).unwrap();
        assert_abs_diff_eq!(zoom_512, zoom - 1.0, epsilon = 1e-9);

        // Degenerate tile size.
        assert!(camera_view_zoom_level(&transform, &frustum, &window, Some(0.0)).is_none());
    }

    #[test]
    fn camera_view_zoom_level_is_none_when_looking_away() {
        let mut transform = Transform::from_translation(Vec3::new(WGS84_A_64 + 1000.0, 0.0, 0.0));
        transform.look_to(Vec3::X, Vec3::Z);
        let frustum = CameraFrustum::new(&transform, 0.1, 1e9, 1.0, 1.0);
        let window = Window {
            width: 800.,
            height: 600.,
            pixel_ratio: 1.,
        };
        assert!(camera_view_zoom_level(&transform, &frustum, &window, None).is_none());
    }

    #[test]
    fn camera_lod_zoom_level_matches_the_view_zoom_below_maplibre_max_pitch() {
        // Looking straight down: the clamp does not apply.
        let mut transform = Transform::from_translation(Vec3::new(WGS84_A_64 + 1000.0, 0.0, 0.0));
        transform.look_to(-Vec3::X, Vec3::Z);
        let frustum = CameraFrustum::new(&transform, 0.1, 1e9, 1.0, 4. / 3.);
        let window = Window {
            width: 800.,
            height: 600.,
            pixel_ratio: 1.,
        };
        let lod = camera_lod_zoom_level(&transform, &frustum, &window).unwrap();
        let view = camera_view_zoom_level(&transform, &frustum, &window, None).unwrap();
        assert_abs_diff_eq!(lod, view, epsilon = 1e-9);
    }

    #[test]
    fn camera_lod_zoom_level_clamps_to_maplibre_max_pitch() {
        let frustum_for = |t: &Transform| CameraFrustum::new(t, 0.1, 1e9, 1.0, 4. / 3.);
        let window = Window {
            width: 800.,
            height: 600.,
            pixel_ratio: 1.,
        };
        // 1000 m above the equator: the clamped distance is 1000 / cos(85°).
        let expected = camera_zoom_level(
            1000.0 / 85f64.to_radians().cos(),
            1.0,
            600.0,
            0.0,
            WGS84_A_64,
            None,
        );
        let position = Vec3::new(WGS84_A_64 + 1000.0, 0.0, 0.0);

        // Looking at the sky (the centre ray misses): still defined.
        let mut sky = Transform::from_translation(position);
        sky.look_to(Vec3::X, Vec3::Z);
        let zoom = camera_lod_zoom_level(&sky, &frustum_for(&sky), &window).unwrap();
        assert_abs_diff_eq!(zoom, expected, epsilon = 1e-6);

        // Nearly horizontal (hits the globe ~100 km away): clamped too.
        let mut grazing = Transform::from_translation(position);
        grazing.look_to(Vec3::new(-0.01, 1.0, 0.0), Vec3::X);
        let zoom = camera_lod_zoom_level(&grazing, &frustum_for(&grazing), &window).unwrap();
        assert_abs_diff_eq!(zoom, expected, epsilon = 1e-3);
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
