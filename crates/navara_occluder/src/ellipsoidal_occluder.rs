use bevy_ecs::component::Component;
use navara_core::Ellipsoid;
use navara_math::{FloatType, Vec3};

/// This is used to occlude a point by horizon occlusion.
/// This is based on Cesium's implementation.
/// Ref
///   - https://cesium.com/blog/2013/04/25/horizon-culling/
///   - https://cesium.com/blog/2013/05/09/computing-the-horizon-occlusion-point/
#[derive(Component)]
pub struct EllipsoidalOccluder {
    pub ellipsoid: Ellipsoid<FloatType>,
    pub camera_position: Vec3,
    pub camera_position_in_scaled_space: Vec3,
    pub distance_to_ellipsoid_surface_squared: FloatType,
}

impl EllipsoidalOccluder {
    pub fn new(camera_position: &Vec3, ellipsoid: Ellipsoid<FloatType>) -> Self {
        let mut this = Self {
            ellipsoid,
            camera_position: Vec3::ZERO,
            camera_position_in_scaled_space: Vec3::ZERO,
            distance_to_ellipsoid_surface_squared: 0.,
        };
        this.update(camera_position, ellipsoid);
        this
    }

    pub fn update(&mut self, camera_position: &Vec3, ellipsoid: Ellipsoid<FloatType>) {
        self.ellipsoid = ellipsoid;
        self.camera_position = *camera_position;
        self.camera_position_in_scaled_space = Vec3::from_array(
            ellipsoid.transform_position_to_scaled_space(camera_position.to_array()),
        );
        self.distance_to_ellipsoid_surface_squared =
            self.camera_position_in_scaled_space.length_squared() - 1.;
    }

    /// Horizon culling point of `positions` against the ellipsoid shrunk by
    /// `minimum_height` when that is negative, so that terrain below the
    /// ellipsoid is not occluded by the ellipsoid itself. Test it with
    /// [`Self::is_scaled_space_point_visible_possibly_under_ellipsoid`] and the
    /// same `minimum_height`.
    /// Ref: https://github.com/CesiumGS/cesium/blob/16674c161b161755c9143c2940a062042cecaefa/packages/engine/Source/Core/EllipsoidalOccluder.js#L229
    pub fn compute_horizontal_culling_point_possibly_under_ellipsoid(
        &self,
        direction_to_point: Vec3,
        positions: Vec<Vec3>,
        minimum_height: FloatType,
    ) -> Option<Vec3> {
        compute_horizon_culling_point_from_positions(
            &possibly_shrunk_ellipsoid(&self.ellipsoid, minimum_height),
            direction_to_point,
            positions,
        )
    }

    pub fn is_scaled_space_point_visible(&self, occludee_scaled_space_position: Vec3) -> bool {
        is_scaled_space_point_visible(
            occludee_scaled_space_position,
            self.camera_position_in_scaled_space,
            self.distance_to_ellipsoid_surface_squared,
        )
    }

    pub fn is_scaled_space_point_visible_possibly_under_ellipsoid(
        &self,
        occludee_scaled_space_position: Vec3,
        minimum_height: FloatType,
    ) -> bool {
        if !shrinks(&self.ellipsoid, minimum_height) {
            return self.is_scaled_space_point_visible(occludee_scaled_space_position);
        }
        let shrunk = possibly_shrunk_ellipsoid(&self.ellipsoid, minimum_height);
        let camera = Vec3::from_array(
            shrunk.transform_position_to_scaled_space(self.camera_position.to_array()),
        );
        is_scaled_space_point_visible(
            occludee_scaled_space_position,
            camera,
            camera.length_squared() - 1.,
        )
    }

    /// Whether `position` (ECEF) is above the horizon of the ellipsoid shrunk
    /// by `minimum_height` when that is negative.
    pub fn is_point_visible_possibly_under_ellipsoid(
        &self,
        position: Vec3,
        minimum_height: FloatType,
    ) -> bool {
        let scaled = Vec3::from_array(
            possibly_shrunk_ellipsoid(&self.ellipsoid, minimum_height)
                .transform_position_to_scaled_space(position.to_array()),
        );
        self.is_scaled_space_point_visible_possibly_under_ellipsoid(scaled, minimum_height)
    }
}

fn shrinks(ellipsoid: &Ellipsoid<FloatType>, minimum_height: FloatType) -> bool {
    minimum_height < 0. && ellipsoid.a.min(ellipsoid.b) > -minimum_height
}

fn possibly_shrunk_ellipsoid(
    ellipsoid: &Ellipsoid<FloatType>,
    minimum_height: FloatType,
) -> Ellipsoid<FloatType> {
    if !shrinks(ellipsoid, minimum_height) {
        return *ellipsoid;
    }
    let a = ellipsoid.a + minimum_height;
    let b = ellipsoid.b + minimum_height;
    Ellipsoid {
        a,
        b,
        one_over_radii: [1. / a, 1. / a, 1. / b],
        one_over_radii_squared: [1. / (a * a), 1. / (a * a), 1. / (b * b)],
        center_tolerance_squared: ellipsoid.center_tolerance_squared,
    }
}

// The detils of this function is: https://cesium.com/blog/2013/05/09/computing-the-horizon-occlusion-point/
// Ref: https://github.com/CesiumGS/cesium/blob/16674c161b161755c9143c2940a062042cecaefa/packages/engine/Source/Core/EllipsoidalOccluder.js#L383
fn compute_horizon_culling_point_from_positions(
    ellipsoid: &Ellipsoid<FloatType>,
    direction_to_point: Vec3,
    positions: Vec<Vec3>,
) -> Option<Vec3> {
    let scaled_space_direction_to_point =
        compute_scaled_space_direction_to_point(ellipsoid, direction_to_point);

    let mut max_mag: FloatType = 0.;
    for position in positions {
        let mag = compute_magnitude(ellipsoid, position, scaled_space_direction_to_point);
        if mag < 0. {
            return None;
        }
        max_mag = max_mag.max(mag);
    }

    magnitude_to_point(scaled_space_direction_to_point, max_mag)
}

fn compute_scaled_space_direction_to_point(
    ellipsoid: &Ellipsoid<FloatType>,
    direction_to_point: Vec3,
) -> Vec3 {
    if direction_to_point == Vec3::ZERO {
        return direction_to_point;
    }
    Vec3::from_array(ellipsoid.transform_position_to_scaled_space(direction_to_point.to_array()))
        .normalize()
}

fn compute_magnitude(
    ellipsoid: &Ellipsoid<FloatType>,
    position: Vec3,
    scaled_space_direction_to_point: Vec3,
) -> FloatType {
    let scaled_space_position =
        Vec3::from_array(ellipsoid.transform_position_to_scaled_space(position.to_array()));
    let mag_squared = scaled_space_position.length_squared();
    let mag = mag_squared.sqrt();
    let direction = scaled_space_position / mag;

    // For the purpose of the computation of the max, points below the ellipsoid are consider to be on it instead.
    let suppressed_mag_squared = mag_squared.max(1.);
    let suppressed_mag = mag.max(1.);

    let cos_a = direction.dot(scaled_space_direction_to_point);
    let sin_a = direction.cross(scaled_space_direction_to_point).length();
    let cos_b = 1. / suppressed_mag;
    let sin_b = (suppressed_mag_squared - 1.).sqrt() * cos_b;

    1. / (cos_a * cos_b - sin_a * sin_b)
}

fn magnitude_to_point(scaled_space_direction_to_point: Vec3, max_mag: FloatType) -> Option<Vec3> {
    // The horizon culling point is undefined if there were no positions from which to compute it,
    // the directionToPoint is pointing opposite all of the positions,  or if we computed NaN or infinity.
    if max_mag <= 0.0 || max_mag.is_infinite() {
        return None;
    }

    Some(scaled_space_direction_to_point * max_mag)
}

fn is_scaled_space_point_visible(
    occludee_scaled_space_position: Vec3,
    camera_position_in_scaled_space: Vec3,
    distance_to_ellipsoid_surface_squared: FloatType,
) -> bool {
    // See https://cesium.com/blog/2013/04/25/horizon-culling/
    let cv = camera_position_in_scaled_space;
    let vh_magnitude_squared = distance_to_ellipsoid_surface_squared;
    let vt = occludee_scaled_space_position - cv;
    let vt_dot_vc = -vt.dot(cv);
    // If vh_magnitude_squared < 0 then we are below the surface of the ellipsoid and
    // in this case, set the culling plane to be on V.
    let is_occluded = if vh_magnitude_squared < 0. {
        vt_dot_vc > 0.
    } else {
        vt_dot_vc > vh_magnitude_squared
            && (vt_dot_vc * vt_dot_vc) / vt.length_squared() > vh_magnitude_squared
    };
    !is_occluded
}

#[cfg(test)]
mod test {

    use approx::assert_abs_diff_eq;
    use navara_core::{WGS84_64, WGS84_A_64};
    use navara_math::{AbsDiffEqVec3, EPSILON5, Vec3};
    use navara_mock::camera::update_camera_transform;

    use super::EllipsoidalOccluder;

    #[test]
    fn it_should_return_some_or_none() {
        let (camera_pos, _camera_lle) = update_camera_transform(WGS84_A_64 * 2.);
        let occluder = EllipsoidalOccluder::new(&camera_pos, WGS84_64);

        let center = Vec3::new(WGS84_A_64 / 2., WGS84_A_64 / 2., WGS84_A_64);
        assert_abs_diff_eq!(
            AbsDiffEqVec3(
                occluder
                    .compute_horizontal_culling_point_possibly_under_ellipsoid(
                        center,
                        vec![Vec3::new(center.x + 100., center.y, center.z - 100.)],
                        0.,
                    )
                    .unwrap()
            ),
            AbsDiffEqVec3(Vec3::new(0.5000035, 0.5000035, 1.003371)),
            epsilon = Vec3::new(EPSILON5, EPSILON5, EPSILON5)
        );
        debug_assert!(
            occluder
                .compute_horizontal_culling_point_possibly_under_ellipsoid(
                    center,
                    vec![Vec3::new(-center.x, -center.y, -center.z)],
                    0.,
                )
                .is_none()
        );
    }

    #[test]
    fn it_should_be_occluded() {
        let (camera_pos, _camera_lle) = update_camera_transform(WGS84_A_64 * 1.5);
        let occluder = EllipsoidalOccluder::new(&camera_pos, WGS84_64);

        let center = Vec3::new(WGS84_A_64 / 2., WGS84_A_64 / 2., -WGS84_A_64);
        let occludee_point = occluder
            .compute_horizontal_culling_point_possibly_under_ellipsoid(
                center,
                vec![Vec3::new(center.x + 100., center.y, center.z - 100.)],
                0.,
            )
            .unwrap();
        debug_assert!(occluder.is_scaled_space_point_visible(occludee_point));

        let center = Vec3::new(WGS84_A_64 / 2., 0., -WGS84_A_64);
        let occludee_point = occluder
            .compute_horizontal_culling_point_possibly_under_ellipsoid(
                center,
                vec![Vec3::new(center.x - 100., center.y, center.z + 100.)],
                0.,
            )
            .unwrap();
        debug_assert!(!occluder.is_scaled_space_point_visible(occludee_point));
    }

    /// A point at `height` (meters) `distance` meters east of (0°, 0°) along
    /// the equator.
    fn equator_point(distance: f64, height: f64) -> Vec3 {
        use navara_core::{Angle, LLE, Meters};
        let lle = LLE {
            lng: Angle::new(distance / WGS84_A_64),
            lat: Angle::new(0.),
            height: Meters::new(height),
        };
        let xyz = lle.to_xyz(WGS84_64);
        Vec3::new(xyz.x.val(), xyz.y.val(), xyz.z.val())
    }

    /// Ground sunk 8 km below the ellipsoid, 300 km from a camera 3 km above
    /// it: past the ellipsoid's horizon (~196 km) but before the horizon of
    /// the sunken surface (~374 km), so only the ellipsoid hides it.
    #[test]
    fn terrain_below_the_ellipsoid_is_seen_past_the_ellipsoid_horizon() {
        let camera = equator_point(0., 3000.);
        let occluder = EllipsoidalOccluder::new(&camera, WGS84_64);
        let ground = equator_point(300_000., -8000.);

        let point = occluder
            .compute_horizontal_culling_point_possibly_under_ellipsoid(ground, vec![ground], 0.)
            .unwrap();
        assert!(!occluder.is_scaled_space_point_visible_possibly_under_ellipsoid(point, 0.));

        let point = occluder
            .compute_horizontal_culling_point_possibly_under_ellipsoid(ground, vec![ground], -8000.)
            .unwrap();
        assert!(occluder.is_scaled_space_point_visible_possibly_under_ellipsoid(point, -8000.));
        assert!(occluder.is_point_visible_possibly_under_ellipsoid(ground, -8000.));

        // The sunken surface still hides what lies past its own horizon.
        let far = equator_point(600_000., -8000.);
        assert!(!occluder.is_point_visible_possibly_under_ellipsoid(far, -8000.));
    }
}
