use bevy_ecs::{component::Component, resource::Resource};
use navara_core::{
    Aabb, BoundingVolume, CRS, Plane, WGS84_64, WGS84_B_64, adjust_angle_for_lerp,
    ease_in_out_cubic, ease_in_out_quad, ease_in_out_quint, ease_linear, ease_out_cubic, lerp,
};
use navara_event_store::CameraFlightEnded;
use navara_math::{EPSILON10, EqualEpsilon, FloatType, Mat3, Quat, Transform, Vec3};

use crate::{
    CameraOrientation,
    helpers::{get_heading, get_pitch, get_roll},
};

#[derive(Component)]
pub struct CameraMarker;

// TODO: Support orthogonal camera.
/// Frustum for perspective camera.
#[derive(Component, Debug)]
pub struct CameraFrustum {
    pub near: FloatType,
    pub far: FloatType,
    /// Vertical field of view in radians (the horizontal extent is derived
    /// from it via `aspect_ratio`).
    pub fov: FloatType,
    pub aspect_ratio: FloatType,
    pub sse_denominator: FloatType,
    pub planes: [Plane; 6],
}

impl CameraFrustum {
    pub fn new(
        transform: &Transform,
        near: FloatType,
        far: FloatType,
        fov: FloatType,
        aspect_ratio: FloatType,
    ) -> Self {
        let mut this = Self {
            near,
            far,
            fov,
            sse_denominator: 0.,
            aspect_ratio,
            planes: [Default::default(); 6],
        };

        this.update_sse_denominator();
        this.update_planes(transform);

        this
    }

    pub fn update_sse_denominator(&mut self) {
        self.sse_denominator = 2. * (self.fov * 0.5).tan();
    }

    pub fn update_planes(&mut self, transform: &Transform) {
        let fov = self.fov;
        let half_v_side = self.far * (fov * 0.5).tan();
        let half_h_side = half_v_side * self.aspect_ratio;
        let front_far = self.far * transform.forward();

        let forward = transform.forward();
        let right = transform.right();
        let up = transform.up();

        let near_center = transform.translation + forward * self.near;
        let far_center = transform.translation + front_far;

        self.planes = [
            // Near
            Plane::from_point_normal(near_center, forward),
            // Far
            Plane::from_point_normal(far_center, -forward),
            // Right
            Plane::from_point_normal(
                transform.translation,
                (front_far - right * half_h_side).cross(up).normalize(),
            ),
            // Left
            Plane::from_point_normal(
                transform.translation,
                up.cross(front_far + right * half_h_side).normalize(),
            ),
            // Top
            Plane::from_point_normal(
                transform.translation,
                right.cross(front_far - up * half_v_side).normalize(),
            ),
            // Bottom
            Plane::from_point_normal(
                transform.translation,
                (front_far + up * half_v_side).cross(right).normalize(),
            ),
        ];
    }

    pub fn intersection_with_aabb(&self, aabb: &Aabb) -> bool {
        for plane in self.planes.iter() {
            if !aabb.is_on_or_forward_plane(plane) {
                return false;
            }
        }
        true
    }

    /// Conservative frustum vs bounding volume test. Returns true if the
    /// volume is on the forward side of every frustum plane (i.e. not
    /// definitively outside any plane). Dispatches to the underlying Aabb /
    /// Obb plane test.
    pub fn intersection_with_bounding_volume(&self, bv: &BoundingVolume) -> bool {
        self.planes.iter().all(|p| bv.is_on_or_forward_plane(p))
    }

    /// Returns true if the point is inside or on the boundary of all frustum planes.
    pub fn contains_point(&self, point: Vec3) -> bool {
        self.planes
            .iter()
            .all(|p| p.get_distance_to_point(point) >= 0.0)
    }

    /// Returns true if a sphere (center + radius) intersects the frustum.
    /// A sphere is considered visible if its center is within `radius` distance
    /// of the forward side of every frustum plane.
    pub fn contains_sphere(&self, center: Vec3, radius: FloatType) -> bool {
        self.planes
            .iter()
            .all(|p| p.get_distance_to_point(center) >= -radius)
    }

    /// Adjusts the near and far clipping planes based on camera distance from Earth.
    /// Uses linear division to create three zones between minimum and maximum zoom distance.
    ///
    /// - Zone 1 (Near ground): near = 1.0, far = 1e6
    /// - Zone 2 (Mid altitude): near = 100.0, far = 1e8
    /// - Zone 3 (Far/Space): near = 1000.0, far = 1e9
    pub fn adjust_near_far(&mut self, distance: FloatType) -> bool {
        let base = WGS84_B_64;

        // Ref: https://en.wikipedia.org/wiki/K%C3%A1rm%C3%A1n_line
        let threshold1 = base + 50_000.0;
        let threshold2 = base + 100_000.0;

        let (new_near, new_far) = if distance < threshold1 {
            (1.0, 1e6)
        } else if distance < threshold2 {
            (100.0, 1e8)
        } else {
            (1000.0, 1e9)
        };

        let changed = (self.near - new_near).abs() > 0.01 || (self.far - new_far).abs() > 1.0;

        if changed {
            self.near = new_near;
            self.far = new_far;
        }

        changed
    }
}

#[derive(Copy, Clone, Debug, PartialEq)]
pub enum CameraStatusType {
    Change,
    LookAt,
    Rotate,

    MoveStart,
    Moving,
    MoveEnd,
}

#[derive(Component, Clone, Default)]
pub struct CameraStatus {
    pub(super) initialized: bool,
    pub status: Vec<CameraStatusType>,
}

#[derive(Component)]
pub struct CameraController {
    pub enabled: bool,
    pub enable_spin: bool,
    pub enable_zoom: bool,
    pub enable_tilt: bool,
    pub enable_look: bool,
    pub enable_translate: bool,
    pub auto_adjust_near_far: bool,
    /// Distance from the globe center below which zoom and translate stop,
    /// lowered by [`Self::surface_floor`].
    pub minimum_zoom_distance: FloatType,
    pub maximum_zoom_distance: FloatType,
    /// Height (meters above the ellipsoid, never positive) the rendered
    /// sea level is moved to by the terrain exaggeration, so the camera can
    /// follow terrain sunk below the ellipsoid. Kept in sync by the tile plugin.
    pub surface_floor: FloatType,
    pub spin_speed: FloatType,
    pub zoom_speed: FloatType,
    pub spin_duration: f32,
    pub zoom_duration: f32,
    pub translate_duration: f32,
    pub enable_follow: bool,
    pub free_look: bool,
    pub follow_target_cur: Option<Vec3>,
    pub follow_target_pre: Option<Vec3>,
    pub follow_offset: Option<Vec3>,
    pub terrain_hit_distance: Option<f64>,
}

impl CameraController {
    /// Distance from the globe center the camera may not go below.
    pub fn minimum_camera_radius(&self) -> FloatType {
        self.minimum_zoom_distance + self.surface_floor
    }

    /// Whether a move from `from` to `to` (positions from the globe center)
    /// ends below [`Self::minimum_camera_radius`] without moving away from the
    /// center. The floor rises when the exaggeration is reduced, and a camera
    /// left below it must still be able to move out.
    pub fn sinks_below_floor(&self, from: Vec3, to: Vec3) -> bool {
        let radius = to.length();
        radius <= self.minimum_camera_radius() && radius < from.length()
    }
}

impl Default for CameraController {
    fn default() -> Self {
        Self {
            enabled: true,
            enable_spin: true,
            enable_zoom: true,
            enable_tilt: true,
            enable_look: true,
            enable_translate: true,
            auto_adjust_near_far: true,
            minimum_zoom_distance: WGS84_B_64,
            maximum_zoom_distance: WGS84_B_64 * 10.0,
            surface_floor: 0.,
            spin_speed: 2.0,
            zoom_speed: 0.6,
            spin_duration: 500.,
            zoom_duration: 100.,
            translate_duration: 500.,
            enable_follow: false,
            free_look: false,
            follow_target_cur: None,
            follow_target_pre: None,
            follow_offset: None,
            terrain_hit_distance: None,
        }
    }
}

#[derive(Component)]
pub struct CameraInertia {
    pub spin: Vec3,
    pub spin_time: f32,
    pub translate: Vec3,
    pub translate_time: f32,
    pub zoom: FloatType,
    pub zoom_time: f32,
    pub pan: Vec3,
}

impl Default for CameraInertia {
    fn default() -> Self {
        Self {
            spin: Vec3::ZERO,
            spin_time: 500.,
            translate: Vec3::ZERO,
            translate_time: 500.,
            zoom: 0.,
            zoom_time: 100.,
            pan: Vec3::ZERO,
        }
    }
}

impl CameraInertia {
    pub fn spin(&mut self, v: Vec3) {
        self.spin = v;
        self.spin_time = 0.;
        self.zoom = 0.;
        self.translate = Vec3::ZERO;
    }

    pub fn zoom(&mut self, v: f64) {
        self.zoom = v;
        self.zoom_time = 0.;
        self.spin = Vec3::ZERO;
        self.translate = Vec3::ZERO;
    }

    pub fn translate(&mut self, v: Vec3) {
        self.translate = v;
        self.translate_time = 0.;
        self.spin = Vec3::ZERO;
        self.zoom = 0.;
    }

    pub fn stop_all(&mut self, controller: &CameraController) {
        self.spin = Vec3::ZERO;
        self.zoom = 0.;
        self.translate = Vec3::ZERO;

        self.spin_time = controller.spin_duration;
        self.translate_time = controller.translate_duration;
        self.zoom_time = controller.zoom_duration;
    }
}

#[derive(Component, Clone)]
pub struct Orbit {
    pub horizon_quat: Quat,
    pub vertical_quat: Quat,
    pub default_world_quat: Option<Quat>,
    pub world_quat: Quat,
    pub tilt_quat: Quat,
    pub pivot: Vec3,
    pub horizontal_rotation_axis: Vec3,
    pub vertical_rotation_axis: Vec3,
    pub local_up: Vec3,
    pub local_forward: Vec3,
    pub local_position: Vec3,
    // Fixed rotation axis and pivot for consistent rotation
    pub fixed_rotation_axis: Option<Vec3>,
    pub fixed_rotation_pivot: Option<Vec3>,
    pub is_tilting: bool,
}

impl Default for Orbit {
    fn default() -> Self {
        let controller = CameraController::default();
        let r = controller.minimum_zoom_distance * 3.;

        Self {
            horizon_quat: Quat::IDENTITY,
            vertical_quat: Quat::IDENTITY,
            world_quat: Quat::from_mat3(&Mat3::from_cols(Vec3::NEG_X, Vec3::NEG_Y, Vec3::Z)),
            tilt_quat: Quat::IDENTITY,
            default_world_quat: None,
            local_up: Vec3::Z,
            local_position: Vec3::NEG_Y * r,
            local_forward: Vec3::Y,
            vertical_rotation_axis: Vec3::NEG_X,
            horizontal_rotation_axis: Vec3::Z,
            pivot: Vec3::ZERO,
            fixed_rotation_axis: None,
            fixed_rotation_pivot: None,
            is_tilting: false,
        }
    }
}

impl Orbit {
    pub fn get_default_world_quat(&mut self) -> Quat {
        match self.default_world_quat.take() {
            Some(d) => d,
            None => self.world_quat,
        }
    }

    pub fn set_quat(&mut self, transform: &Transform, world: Quat, center: Vec3, tilt: bool) {
        self.horizon_quat = Quat::IDENTITY;
        self.vertical_quat = Quat::IDENTITY;
        self.world_quat = world;
        self.is_tilting = tilt;

        if tilt {
            self.tilt_quat = world;
        }

        self.pivot = center;

        let position = transform.transform_point(Vec3::ZERO);

        let inverse = self.world_quat.inverse();

        let direction = position - center;

        self.local_forward = if tilt {
            inverse * -direction.normalize_or_zero()
        } else {
            inverse * transform.forward()
        };

        self.local_position = inverse * direction;

        if tilt {
            self.local_up = Vec3::Z;
            self.horizontal_rotation_axis = Vec3::Z;

            if self.local_up.dot(self.local_forward).abs() >= 0.99999 {
                self.local_up = inverse * transform.up();
                self.vertical_rotation_axis = self.local_forward.cross(self.local_up);
            } else {
                self.vertical_rotation_axis = inverse * transform.right();
            };

            return;
        } else {
            self.vertical_rotation_axis = inverse * transform.right();
        }

        if self.tilt_quat == Quat::IDENTITY {
            return;
        }

        // Get the up direction from the tilt quaternion
        let tilt_up = self.tilt_quat * Vec3::Z;
        // Get the vertical rotation axis in world space
        let world_vertical_axis = self.world_quat * self.vertical_rotation_axis;

        // Make the rotation direction opposite, since `tilt_up` is opposite when you move the camera a lot.
        let tilt_horizontal_rotation_axis = if tilt_up.dot(-position.normalize()) > 0.0 {
            world_vertical_axis.cross(tilt_up).normalize_or_zero()
        } else {
            tilt_up.cross(world_vertical_axis).normalize_or_zero()
        };

        self.horizontal_rotation_axis = inverse * tilt_horizontal_rotation_axis;
        self.local_up = self
            .vertical_rotation_axis
            .cross(self.local_forward)
            .normalize();
    }
}

#[derive(Default, Debug)]
pub struct FlightOptions {
    pub lon: FloatType,
    pub lat: FloatType,
    pub height: FloatType,
    pub heading: FloatType,
    pub pitch: FloatType,
    pub roll: FloatType,
}

/// Easing applied to the flight's normalized time.
/// The `u8` mapping is part of the WASM API contract and must stay in sync
/// with `FLY_TO_EASING_CODE` on the TypeScript side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FlyToEasing {
    Linear,
    QuadInOut,
    CubicInOut,
    CubicOut,
    #[default]
    QuinticInOut,
}

impl FlyToEasing {
    pub fn apply(&self, t: FloatType) -> FloatType {
        match self {
            FlyToEasing::Linear => ease_linear(t),
            FlyToEasing::QuadInOut => ease_in_out_quad(t),
            FlyToEasing::CubicInOut => ease_in_out_cubic(t),
            FlyToEasing::CubicOut => ease_out_cubic(t),
            FlyToEasing::QuinticInOut => ease_in_out_quint(t),
        }
    }
}

impl TryFrom<u8> for FlyToEasing {
    type Error = ();

    fn try_from(v: u8) -> Result<Self, Self::Error> {
        Ok(match v {
            0 => FlyToEasing::Linear,
            1 => FlyToEasing::QuadInOut,
            2 => FlyToEasing::CubicInOut,
            3 => FlyToEasing::CubicOut,
            4 => FlyToEasing::QuinticInOut,
            _ => return Err(()),
        })
    }
}

/// Allocates ids for `flyTo` flights. The id is returned to the caller
/// synchronously and echoed back through `CameraFlightEnded`, letting the
/// caller match a flight's terminal record to its pending promise.
#[derive(Resource, Debug)]
pub struct FlightIdAllocator {
    next: u32,
}

impl Default for FlightIdAllocator {
    fn default() -> Self {
        Self { next: 1 }
    }
}

impl FlightIdAllocator {
    pub fn allocate(&mut self) -> u32 {
        let id = self.next;
        self.next = self.next.wrapping_add(1);
        id
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartFlyResult {
    /// The flight animation started.
    Started,
    /// The camera is already at the target pose; nothing to animate.
    NoOp,
    /// `duration <= 0`: the caller must apply the end pose immediately.
    Instant,
}

#[derive(Component, Default)]
pub struct CameraFlight {
    pub start_options: FlightOptions,
    pub end_options: FlightOptions,

    pub time: FloatType,
    pub duration: FloatType,
    pub max_height: FloatType,
    pub easing: FlyToEasing,
    height_function: Option<Box<dyn Fn(FloatType) -> FloatType + Send + Sync + 'static>>,

    /// Id of the in-progress flight, `None` when idle.
    current_id: Option<u32>,
    /// Terminal records drained into the `EventStore` once per frame.
    pub ended: Vec<CameraFlightEnded>,
}

impl CameraFlight {
    #[allow(clippy::too_many_arguments)]
    pub fn fly_to(
        &mut self,
        id: u32,
        transform: &Transform,
        frustum: &CameraFrustum,
        controller: &CameraController,
        pos: &Vec3,
        orient: &CameraOrientation,
        duration: &Option<FloatType>,
        max_height: &Option<FloatType>,
        easing: Option<FlyToEasing>,
    ) -> StartFlyResult {
        let lle = CRS::Geocentric.to_lle(WGS84_64, transform.translation, 0.0);
        let start = lle.deg();

        self.set_start_options(
            start.lng.val(),
            start.lat.val(),
            start.height.val(),
            get_heading(transform),
            get_pitch(transform),
            get_roll(transform),
        );

        self.set_end_options(
            pos.x,
            pos.y,
            pos.z,
            orient.get_heading(),
            orient.get_pitch(),
            orient.get_roll(),
        );

        self.start_fly(
            id, duration, max_height, easing, frustum, transform, controller,
        )
    }

    fn set_start_options(
        &mut self,
        lon: FloatType,
        lat: FloatType,
        height: FloatType,
        heading: FloatType,
        pitch: FloatType,
        roll: FloatType,
    ) {
        self.start_options.lon = lon;
        self.start_options.lat = lat;
        self.start_options.height = height;
        self.start_options.heading = heading;
        self.start_options.pitch = pitch;
        self.start_options.roll = roll;
    }

    fn set_end_options(
        &mut self,
        lon: FloatType,
        lat: FloatType,
        height: FloatType,
        heading: FloatType,
        pitch: FloatType,
        roll: FloatType,
    ) {
        self.end_options.lon = lon;
        self.end_options.lat = lat;
        self.end_options.height = height;
        self.end_options.heading = heading;
        self.end_options.pitch = pitch;
        self.end_options.roll = roll;
    }

    /// Smallest absolute angular difference between two angles in degrees.
    fn angle_diff_deg(a: FloatType, b: FloatType) -> FloatType {
        let d = (a - b).rem_euclid(360.0);
        d.min(360.0 - d)
    }

    fn options_changed(&self) -> bool {
        // Angles are degrees; compare their wrapped difference (a heading pair
        // differing by a multiple of 360 is the same pose).
        if Self::angle_diff_deg(self.start_options.heading, self.end_options.heading) > EPSILON10 {
            return true;
        }

        if Self::angle_diff_deg(self.start_options.pitch, self.end_options.pitch) > EPSILON10 {
            return true;
        }

        if Self::angle_diff_deg(self.start_options.roll, self.end_options.roll) > EPSILON10 {
            return true;
        }

        if Self::angle_diff_deg(self.start_options.lon, self.end_options.lon) > EPSILON10 {
            return true;
        }

        if !self
            .start_options
            .lat
            .equal_diff_epsilon(self.end_options.lat, EPSILON10)
        {
            return true;
        }

        if !self
            .start_options
            .height
            .equal_diff_epsilon(self.end_options.height, EPSILON10)
        {
            return true;
        }

        false
    }

    // Default duration derived from the flight distance:
    // `min(ceil(distance / 1_000_000) + 2, 3)` seconds, converted to ms.
    // ref: https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/Camera.js
    fn default_duration_ms(&self, transform: &Transform) -> FloatType {
        let end_ecef = CRS::Geographic.to_vec3(
            WGS84_64,
            Vec3::new(
                self.end_options.lon,
                self.end_options.lat,
                self.end_options.height,
            ),
            0.0,
        );
        let distance = (end_ecef - transform.translation).length();
        ((distance / 1_000_000.0).ceil() + 2.0).min(3.0) * 1000.0
    }

    #[allow(clippy::too_many_arguments)]
    fn start_fly(
        &mut self,
        id: u32,
        duration: &Option<FloatType>,
        max_height: &Option<FloatType>,
        easing: Option<FlyToEasing>,
        frustum: &CameraFrustum,
        transform: &Transform,
        controller: &CameraController,
    ) -> StartFlyResult {
        // A new flyTo always supersedes the in-progress flight, even when the
        // new target turns out to be a no-op.
        if let Some(old_id) = self.current_id.take() {
            self.ended.push(CameraFlightEnded {
                id: old_id,
                completed: false,
            });
            self.height_function = None;
            self.time = 0.;
            self.duration = 0.;
        }

        if !self.options_changed() {
            // Already at the target pose: report immediate completion.
            self.ended.push(CameraFlightEnded {
                id,
                completed: true,
            });
            return StartFlyResult::NoOp;
        }

        let duration = duration.unwrap_or_else(|| self.default_duration_ms(transform));
        if duration <= 0.0 {
            // A zero-duration flight applies the end pose immediately.
            self.time = 0.;
            self.duration = 0.;
            self.ended.push(CameraFlightEnded {
                id,
                completed: true,
            });
            return StartFlyResult::Instant;
        }

        // Heading and roll take the short way around; pitch is intentionally
        // lerped as-is.
        self.start_options.heading =
            adjust_angle_for_lerp(self.start_options.heading, self.end_options.heading);
        self.start_options.roll =
            adjust_angle_for_lerp(self.start_options.roll, self.end_options.roll);

        // Fly the short way across the antimeridian.
        let lon_diff = self.start_options.lon - self.end_options.lon;
        if lon_diff < -180.0 {
            self.start_options.lon += 360.0;
        } else if lon_diff > 180.0 {
            self.end_options.lon += 360.0;
        }

        self.time = 0.;
        self.duration = duration;
        // Default easing: quintic in/out, but cubic-out when descending
        // from high altitude.
        self.easing = easing.unwrap_or(
            if self.start_options.height > self.end_options.height
                && self.start_options.height > 11500.0
            {
                FlyToEasing::CubicOut
            } else {
                FlyToEasing::QuinticInOut
            },
        );
        if let Some(h) = max_height {
            self.max_height = *h;
        } else {
            self.max_height = self.get_altitude(transform, frustum, controller);
        }

        self.height_function = Some(Self::create_height_function(
            self.start_options.height,
            self.end_options.height,
            self.max_height,
        ));
        self.current_id = Some(id);

        StartFlyResult::Started
    }

    pub fn is_flying(&self) -> bool {
        self.time < self.duration
    }

    /// True while a flight owns the camera (i.e. its terminal record has not
    /// been emitted yet).
    pub fn is_active(&self) -> bool {
        self.current_id.is_some()
    }

    /// Cancels the in-progress flight, if any. Its pending promise on the JS
    /// side resolves as not completed.
    pub fn cancel(&mut self) {
        if let Some(id) = self.current_id.take() {
            self.ended.push(CameraFlightEnded {
                id,
                completed: false,
            });
        }
        self.time = 0.;
        self.duration = 0.;
        self.height_function = None;
    }

    pub fn update(&mut self, delta_time: FloatType) -> Option<(Vec3, CameraOrientation)> {
        if self.is_flying() {
            self.time += delta_time;
            if self.time > self.duration {
                self.time = self.duration;
            }

            if let Some(f) = &self.height_function {
                let t = self.easing.apply(self.time / self.duration);
                let height = f(t);

                let lon = lerp(self.start_options.lon, self.end_options.lon, t);
                let lat = lerp(self.start_options.lat, self.end_options.lat, t);
                let heading = lerp(self.start_options.heading, self.end_options.heading, t);
                let pitch = lerp(self.start_options.pitch, self.end_options.pitch, t);
                let roll = lerp(self.start_options.roll, self.end_options.roll, t);

                let position = Vec3::new(lon, lat, height);
                let orientation = CameraOrientation {
                    pitch: Some(pitch),
                    heading: Some(heading),
                    roll: Some(roll),
                };

                // The final sample lands exactly on t = 1; emit the terminal
                // record in the same frame.
                if !self.is_flying()
                    && let Some(id) = self.current_id.take()
                {
                    self.ended.push(CameraFlightEnded {
                        id,
                        completed: true,
                    });
                }

                return Some((position, orientation));
            }
        }

        None
    }

    // ref: https://github.com/CesiumGS/cesium/blob/fb314464d211abf51649b17151137db7a403502a/packages/engine/Source/Scene/CameraFlightPath.js#L22
    fn get_altitude(
        &self,
        transform: &Transform,
        frustum: &CameraFrustum,
        controller: &CameraController,
    ) -> FloatType {
        let cam_start = transform.translation;
        let cam_end = CRS::Geographic.to_vec3(
            WGS84_64,
            Vec3::new(
                self.end_options.lon,
                self.end_options.lat,
                self.end_options.height,
            ),
            0.0,
        );
        let diff = cam_end - cam_start;

        let up = transform.up();
        let right = transform.right();

        let dx = (up * diff.dot(up)).length();
        let dy = (right * diff.dot(right)).length();

        // The frustum extents are derived from the vertical fov.
        let tan_theta = (0.5 * frustum.fov).tan();
        let near = frustum.near;
        let top = near * tan_theta;
        let right = frustum.aspect_ratio * top;

        // Scale the fit-both-points estimate by 0.2, cap it at 1e9 m, and
        // clamp to the controller's zoom limit.
        ((dx * near / right).max(dy * near / top) * 0.2)
            .min(1_000_000_000.0)
            .min(controller.maximum_zoom_distance)
    }

    // ref: https://github.com/CesiumGS/cesium/blob/fb314464d211abf51649b17151137db7a403502a/packages/engine/Source/Scene/CameraFlightPath.js#L75
    fn create_height_function(
        start_height: FloatType,
        end_height: FloatType,
        option_altitude: FloatType,
    ) -> Box<dyn Fn(FloatType) -> FloatType + Send + Sync + 'static> {
        let altitude = option_altitude;
        let max_height = start_height.max(end_height);

        if max_height < altitude {
            let power = 4.0;
            let factor = 1000.0;

            let s = -((altitude - start_height) * factor).powf(1.0 / power);
            let e = ((altitude - end_height) * factor).powf(1.0 / power);

            Box::new(move |t: FloatType| {
                let x = t * (e - s) + s;
                -x.powf(power) / factor + altitude
            })
        } else {
            Box::new(move |t: FloatType| start_height * (1.0 - t) + end_height * t)
        }
    }
}

#[cfg(test)]
mod test {
    use approx::assert_abs_diff_eq;
    use navara_core::{Aabb, Angle, BoundingVolume, CRS, Obb, Plane, WGS84_64};
    use navara_math::{EPSILON5, Transform, Vec3};

    use super::{CameraController, CameraFlight, CameraFrustum, FlyToEasing, StartFlyResult};

    #[test]
    fn is_frustum_plane_correct() {
        let camera = Transform::from_xyz(0., 0., -10.);
        let camera = camera.looking_at(Vec3::new(0., 0., 0.), Vec3::Y);

        let frustum = CameraFrustum::new(&camera, 0.1, 1000., Angle::new(50.).rad().val(), 1.);
        debug_assert_eq!(
            frustum.planes[0],
            Plane::from_point_normal(Vec3::new(0., 0., -9.9), Vec3::new(0., 0., 1.))
        );
        debug_assert_eq!(
            frustum.planes[1],
            Plane::from_point_normal(Vec3::new(0., 0., 990.), Vec3::new(0., 0., -1.))
        );
        assert_abs_diff_eq!(
            frustum.planes[2].distance,
            Plane::from_point_normal(
                Vec3::new(0., 0., -10.),
                Vec3::new(-0.9063078, 0.0, 0.42261827)
            )
            .distance,
            epsilon = EPSILON5
        );
        assert_abs_diff_eq!(
            frustum.planes[3].distance,
            Plane::from_point_normal(
                Vec3::new(0., 0., -10.),
                Vec3::new(-0.9063078, 0.0, 0.42261827)
            )
            .distance,
            epsilon = EPSILON5
        );
        assert_abs_diff_eq!(
            frustum.planes[4].distance,
            Plane::from_point_normal(
                Vec3::new(0., 0., -10.),
                Vec3::new(-0.9063078, 0.0, 0.42261827)
            )
            .distance,
            epsilon = EPSILON5
        );
        assert_abs_diff_eq!(
            frustum.planes[5].distance,
            Plane::from_point_normal(
                Vec3::new(0., 0., -10.),
                Vec3::new(-0.9063078, 0.0, 0.42261827)
            )
            .distance,
            epsilon = EPSILON5
        );
    }

    #[test]
    fn frustum_should_intersect_with_aabb() {
        let camera = Transform::from_xyz(0., 0., -10.);
        let camera = camera.looking_at(Vec3::new(0., 0., 0.), Vec3::Y);

        let frustum = CameraFrustum::new(&camera, 0.1, 1000., Angle::new(50.).rad().val(), 1.);

        let aabb = Aabb::from_vec3(&[Vec3::new(-10., -1., 10.), Vec3::new(10., 1., 30.)]);
        debug_assert!(frustum.intersection_with_aabb(&aabb));

        let aabb = Aabb::from_vec3(&[Vec3::new(10., 10., 100.), Vec3::new(20., 20., 100.)]);
        debug_assert!(frustum.intersection_with_aabb(&aabb));

        let aabb = Aabb::from_vec3(&[
            Vec3::new(-1000., -1000., -1000.),
            Vec3::new(1000., 1000., -9.8),
        ]);
        debug_assert!(frustum.intersection_with_aabb(&aabb));

        // Out of top
        let aabb = Aabb::from_vec3(&[Vec3::new(100., 100., 10.), Vec3::new(120., 120., 10.)]);
        debug_assert!(!frustum.intersection_with_aabb(&aabb));

        // Out of bottom
        let aabb = Aabb::from_vec3(&[Vec3::new(-100., -100., 10.), Vec3::new(-120., -120., 10.)]);
        debug_assert!(!frustum.intersection_with_aabb(&aabb));
    }

    #[test]
    fn contains_point_inside_frustum() {
        let camera = Transform::from_xyz(0., 0., -10.);
        let camera = camera.looking_at(Vec3::new(0., 0., 0.), Vec3::Y);
        let frustum = CameraFrustum::new(&camera, 0.1, 1000., Angle::new(50.).rad().val(), 1.);

        // Point in front of camera, within frustum
        assert!(frustum.contains_point(Vec3::new(0., 0., 10.)));
        // Point behind camera
        assert!(!frustum.contains_point(Vec3::new(0., 0., -20.)));
        // Point far to the side
        assert!(!frustum.contains_point(Vec3::new(100., 100., 10.)));
    }

    /// The new `intersection_with_bounding_volume` must match the
    /// AABB-specific path for Aabb-wrapped volumes, and must additionally
    /// reject OBBs that lie outside the frustum even when their axis-aligned
    /// hull would have looked like a false positive.
    #[test]
    fn intersection_with_bounding_volume_handles_both_variants() {
        let camera = Transform::from_xyz(0., 0., -10.).looking_at(Vec3::ZERO, Vec3::Y);
        let frustum = CameraFrustum::new(&camera, 0.1, 1000., Angle::new(50.).rad().val(), 1.);

        // Aabb path mirrors `intersection_with_aabb`.
        let aabb = Aabb::from_vec3(&[Vec3::new(-10., -1., 10.), Vec3::new(10., 1., 30.)]);
        let bv: BoundingVolume = aabb.clone().into();
        assert_eq!(
            frustum.intersection_with_bounding_volume(&bv),
            frustum.intersection_with_aabb(&aabb),
        );

        // OBB inside the frustum at (0, 0, 10).
        let obb_inside = Obb::new(
            Vec3::new(0., 0., 10.),
            [
                Vec3::new(1., 0., 0.),
                Vec3::new(0., 1., 0.),
                Vec3::new(0., 0., 1.),
            ],
        );
        let bv: BoundingVolume = obb_inside.into();
        assert!(frustum.intersection_with_bounding_volume(&bv));

        // OBB far above the frustum (no axis-aligned slack involved).
        let obb_outside = Obb::new(
            Vec3::new(0., 200., 10.),
            [
                Vec3::new(1., 0., 0.),
                Vec3::new(0., 1., 0.),
                Vec3::new(0., 0., 1.),
            ],
        );
        let bv: BoundingVolume = obb_outside.into();
        assert!(!frustum.intersection_with_bounding_volume(&bv));

        // OBB rotated 45° around Z, near the boundary — must still be
        // considered visible (the projection radius onto each plane normal
        // accounts for the rotation).
        let s = 1.0_f64 / 2.0_f64.sqrt();
        let obb_rotated = Obb::new(
            Vec3::new(0., 0., 10.),
            [
                Vec3::new(s, s, 0.),
                Vec3::new(-s, s, 0.),
                Vec3::new(0., 0., 1.),
            ],
        );
        let bv: BoundingVolume = obb_rotated.into();
        assert!(frustum.intersection_with_bounding_volume(&bv));
    }

    #[test]
    fn contains_sphere_partially_overlapping() {
        let camera = Transform::from_xyz(0., 0., -10.);
        let camera = camera.looking_at(Vec3::new(0., 0., 0.), Vec3::Y);
        let frustum = CameraFrustum::new(&camera, 0.1, 1000., Angle::new(50.).rad().val(), 1.);

        // Point behind camera but large sphere reaches into frustum
        // Near plane is at z = -9.9, point is at z = -15 (5.1 behind near plane)
        // With radius 10, sphere extends to z = -5 which is in front of near plane
        assert!(frustum.contains_sphere(Vec3::new(0., 0., -15.), 10.0));

        // Point far behind camera, sphere too small to reach
        assert!(!frustum.contains_sphere(Vec3::new(0., 0., -100.), 5.0));

        // Point in frustum, any radius works
        assert!(frustum.contains_sphere(Vec3::new(0., 0., 10.), 1.0));
    }

    type Pose = (f64, f64, f64, f64, f64, f64); // lon, lat, height, heading, pitch, roll

    fn flight_with_pose(start: Pose, end: Pose) -> CameraFlight {
        let mut flight = CameraFlight::default();
        flight.set_start_options(start.0, start.1, start.2, start.3, start.4, start.5);
        flight.set_end_options(end.0, end.1, end.2, end.3, end.4, end.5);
        flight
    }

    fn test_frustum() -> CameraFrustum {
        CameraFrustum::new(
            &Transform::default(),
            0.1,
            1000.,
            Angle::new(50.).rad().val(),
            1.,
        )
    }

    fn start(
        flight: &mut CameraFlight,
        id: u32,
        duration: Option<f64>,
        easing: Option<FlyToEasing>,
    ) -> StartFlyResult {
        flight.start_fly(
            id,
            &duration,
            &Some(10_000.),
            easing,
            &test_frustum(),
            &Transform::default(),
            &CameraController::default(),
        )
    }

    #[test]
    fn options_changed_compares_angles_in_degrees() {
        let pose: Pose = (139.7, 35.6, 1000., 10., -45., 0.);

        // Identical pose: unchanged.
        assert!(!flight_with_pose(pose, pose).options_changed());

        // Regression: headings differing by 2π degrees (~6.2832°) used to be
        // normalized with a ±π (radians) helper and compare equal.
        let mut end = pose;
        end.3 += std::f64::consts::TAU;
        assert!(flight_with_pose(pose, end).options_changed());

        // A full 360° turn is the same pose.
        let mut end = pose;
        end.3 += 360.;
        assert!(!flight_with_pose(pose, end).options_changed());

        // lon 180 and -180 are the same meridian.
        let start = (180., 0., 1000., 0., -90., 0.);
        let end = (-180., 0., 1000., 0., -90., 0.);
        assert!(!flight_with_pose(start, end).options_changed());
    }

    #[test]
    fn start_fly_takes_short_path_across_antimeridian() {
        // Tokyo → Bangkok: |diff| < 180, no adjustment.
        let mut flight = flight_with_pose(
            (139.7, 35.6, 1000., 0., -90., 0.),
            (100.5, 13.7, 1000., 0., -90., 0.),
        );
        assert_eq!(
            start(&mut flight, 1, Some(1000.), None),
            StartFlyResult::Started
        );
        assert_abs_diff_eq!(flight.start_options.lon, 139.7);
        assert_abs_diff_eq!(flight.end_options.lon, 100.5);

        // Tokyo → San Francisco: the short way crosses the Pacific, so the
        // destination is unwrapped past the antimeridian (-122.4 → 237.6).
        let mut flight = flight_with_pose(
            (139.7, 35.6, 1000., 0., -90., 0.),
            (-122.4, 37.7, 1000., 0., -90., 0.),
        );
        assert_eq!(
            start(&mut flight, 1, Some(1000.), None),
            StartFlyResult::Started
        );
        assert_abs_diff_eq!(flight.end_options.lon, 237.6, epsilon = 1e-9);

        // 170 → -170 must cross the antimeridian: end becomes 190.
        let mut flight = flight_with_pose(
            (170., 0., 1000., 0., -90., 0.),
            (-170., 0., 1000., 0., -90., 0.),
        );
        assert_eq!(
            start(&mut flight, 1, Some(1000.), None),
            StartFlyResult::Started
        );
        assert_abs_diff_eq!(flight.end_options.lon, 190.);

        // Mirrored: -170 → 170 shifts the start instead.
        let mut flight = flight_with_pose(
            (-170., 0., 1000., 0., -90., 0.),
            (170., 0., 1000., 0., -90., 0.),
        );
        assert_eq!(
            start(&mut flight, 1, Some(1000.), None),
            StartFlyResult::Started
        );
        assert_abs_diff_eq!(flight.start_options.lon, 190.);
    }

    #[test]
    fn default_duration_derives_from_flight_distance() {
        let pose: Pose = (139.7, 35.6, 1000., 0., -90., 0.);
        let mut end = pose;
        end.3 = 90.; // heading change only → zero flight distance

        // Camera exactly at the destination: min(ceil(0) + 2, 3) = 2 s.
        let transform = Transform {
            translation: CRS::Geographic.to_vec3(WGS84_64, Vec3::new(pose.0, pose.1, pose.2), 0.0),
            ..Default::default()
        };
        let mut flight = flight_with_pose(pose, end);
        let result = flight.start_fly(
            1,
            &None,
            &Some(10_000.),
            None,
            &test_frustum(),
            &transform,
            &CameraController::default(),
        );
        assert_eq!(result, StartFlyResult::Started);
        assert_abs_diff_eq!(flight.duration, 2000.);

        // Any distance beyond 0 m caps at 3 s.
        let mut flight = flight_with_pose(pose, end);
        let result = flight.start_fly(
            2,
            &None,
            &Some(10_000.),
            None,
            &test_frustum(),
            &Transform::default(), // Earth's center: ~6378 km away
            &CameraController::default(),
        );
        assert_eq!(result, StartFlyResult::Started);
        assert_abs_diff_eq!(flight.duration, 3000.);

        // Explicit duration wins.
        let mut flight = flight_with_pose(pose, end);
        start(&mut flight, 3, Some(750.), None);
        assert_abs_diff_eq!(flight.duration, 750.);
    }

    #[test]
    fn zero_duration_is_instant() {
        let mut flight = flight_with_pose(
            (139.7, 35.6, 1000., 0., -90., 0.),
            (135.0, 34.7, 1000., 0., -90., 0.),
        );
        assert_eq!(
            start(&mut flight, 7, Some(0.), None),
            StartFlyResult::Instant
        );
        assert!(!flight.is_flying());
        assert!(!flight.is_active());
        assert_eq!(flight.ended.len(), 1);
        assert_eq!(flight.ended[0].id, 7);
        assert!(flight.ended[0].completed);
    }

    #[test]
    fn default_easing_is_quintic_in_out_or_cubic_out_on_high_descent() {
        // Descending from above 11,500 m → cubic-out.
        let mut flight = flight_with_pose(
            (139.7, 35.6, 20_000., 0., -90., 0.),
            (139.7, 35.6, 100., 0., -90., 0.),
        );
        start(&mut flight, 1, Some(1000.), None);
        assert_eq!(flight.easing, FlyToEasing::CubicOut);

        // Ascending → quintic in/out.
        let mut flight = flight_with_pose(
            (139.7, 35.6, 100., 0., -90., 0.),
            (139.7, 35.6, 20_000., 0., -90., 0.),
        );
        start(&mut flight, 2, Some(1000.), None);
        assert_eq!(flight.easing, FlyToEasing::QuinticInOut);

        // Explicit easing wins.
        let mut flight = flight_with_pose(
            (139.7, 35.6, 20_000., 0., -90., 0.),
            (139.7, 35.6, 100., 0., -90., 0.),
        );
        start(&mut flight, 3, Some(1000.), Some(FlyToEasing::Linear));
        assert_eq!(flight.easing, FlyToEasing::Linear);
    }

    #[test]
    fn flight_lifecycle_emits_terminal_records() {
        let start_pose: Pose = (139.7, 35.6, 1000., 0., -90., 0.);
        let end_pose: Pose = (135.0, 34.7, 1000., 0., -90., 0.);

        // Completion.
        let mut flight = flight_with_pose(start_pose, end_pose);
        start(&mut flight, 1, Some(1000.), None);
        assert!(flight.is_active());
        assert!(flight.update(1000.).is_some());
        assert!(!flight.is_active());
        assert_eq!(flight.ended.len(), 1);
        assert_eq!(flight.ended[0].id, 1);
        assert!(flight.ended[0].completed);

        // A new flight supersedes the current one.
        let mut flight = flight_with_pose(start_pose, end_pose);
        start(&mut flight, 1, Some(1000.), None);
        flight.update(500.);
        flight.set_start_options(137., 35., 1000., 0., -90., 0.);
        flight.set_end_options(130., 33., 1000., 0., -90., 0.);
        start(&mut flight, 2, Some(1000.), None);
        assert_eq!(flight.ended.len(), 1);
        assert_eq!(flight.ended[0].id, 1);
        assert!(!flight.ended[0].completed);
        flight.update(1000.);
        assert_eq!(flight.ended.len(), 2);
        assert_eq!(flight.ended[1].id, 2);
        assert!(flight.ended[1].completed);

        // Cancel.
        let mut flight = flight_with_pose(start_pose, end_pose);
        start(&mut flight, 3, Some(1000.), None);
        flight.cancel();
        assert!(!flight.is_active());
        assert!(!flight.is_flying());
        assert_eq!(flight.ended.len(), 1);
        assert_eq!(flight.ended[0].id, 3);
        assert!(!flight.ended[0].completed);
        assert!(flight.update(16.).is_none());

        // No-op start resolves immediately.
        let mut flight = flight_with_pose(start_pose, start_pose);
        assert_eq!(
            start(&mut flight, 4, Some(1000.), None),
            StartFlyResult::NoOp
        );
        assert_eq!(flight.ended.len(), 1);
        assert_eq!(flight.ended[0].id, 4);
        assert!(flight.ended[0].completed);

        // Even a no-op flyTo interrupts the in-progress flight first.
        let mut flight = flight_with_pose(start_pose, end_pose);
        start(&mut flight, 5, Some(1000.), None);
        flight.update(500.);
        flight.set_start_options(137., 35., 1000., 0., -90., 0.);
        flight.set_end_options(137., 35., 1000., 0., -90., 0.);
        assert_eq!(
            start(&mut flight, 6, Some(1000.), None),
            StartFlyResult::NoOp
        );
        assert!(!flight.is_active());
        assert!(!flight.is_flying());
        assert_eq!(flight.ended.len(), 2);
        assert_eq!(flight.ended[0].id, 5);
        assert!(!flight.ended[0].completed);
        assert_eq!(flight.ended[1].id, 6);
        assert!(flight.ended[1].completed);
    }

    #[test]
    fn get_altitude_clamps_to_live_controller() {
        let flight = flight_with_pose(
            (139.7, 35.6, 1000., 0., -90., 0.),
            (135.0, 34.7, 1000., 0., -90., 0.),
        );

        let frustum = CameraFrustum::new(
            &Transform::default(),
            0.1,
            1000.,
            Angle::new(50.).rad().val(),
            2.,
        );

        // The transform sits at Earth's center, so the raw altitude is huge and
        // must clamp to the *live* controller's maximum zoom distance.
        let controller = CameraController {
            maximum_zoom_distance: 1234.,
            ..Default::default()
        };
        let altitude = flight.get_altitude(&Transform::default(), &frustum, &controller);
        assert_abs_diff_eq!(altitude, 1234.);
    }
}
