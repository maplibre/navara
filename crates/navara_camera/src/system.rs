use std::f64::{self, consts::PI};

use bevy_ecs::{
    change_detection::DetectChanges,
    entity::Entity,
    message::MessageReader,
    query::{Added, Changed, Or, With},
    system::{Commands, Query, Res, ResMut},
    world::Ref,
};
use bevy_input::{
    ButtonInput,
    keyboard::KeyCode,
    mouse::{MouseButton, MouseMotion, MouseWheel},
};
use navara_core::{
    Angle, CRS, Ellipsoid, Ray, WGS84_64, ease_out_circ, east_north_up_to_fixed_frame, vec3_to_xyz,
    xyz_to_vec3,
};
use navara_event_store::EventStore;
use navara_frame::FrameManager;
use navara_math::{EPSILON3, EPSILON6, EqualEpsilon, FloatType, Mat3, Quat, Transform, Vec2, Vec3};
use navara_window::Window;

use crate::{
    CamDirType, CameraController, CameraDirection, CameraEvent, CameraFlight, CameraInertia,
    CameraOrientation, CameraStatus, CameraStatusType, StartFlyResult,
    follow::handle_follow,
    helpers::{
        get_heading, get_pick_ray_from_camera, get_pitch, get_roll, ray_ellipsoid_intersect,
    },
};

use super::{CameraFrustum, CameraMarker, Orbit};
use navara_input::TouchControl;

pub fn startup(mut commands: Commands) {
    let orbit = Orbit::default();

    let transform = Transform::default();

    commands.spawn((
        CameraMarker,
        orbit.clone(),
        transform,
        CameraFrustum::new(
            &transform,
            100.,
            1e8,
            // Default vertical fov.
            Angle::new(50.).rad().val(),
            1.,
        ),
        CameraController::default(),
        CameraInertia::default(),
        CameraFlight::default(),
        CameraStatus::default(),
    ));
}

const FRAME_JUMP_LIMIT: f32 = (1000.0 / 60.0) * 2.0;

#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn update(
    window: Res<Window>,
    mut query: Query<
        (
            Ref<CameraMarker>,
            &mut Transform,
            &mut CameraController,
            &mut CameraInertia,
            &CameraFrustum,
            &mut Orbit,
            &mut CameraFlight,
            &mut CameraStatus,
        ),
        With<CameraMarker>,
    >,
    mb: Res<ButtonInput<MouseButton>>,
    mut mm: MessageReader<MouseMotion>,
    mut mw: MessageReader<MouseWheel>,
    mut tc: MessageReader<TouchControl>,
    mut ce: MessageReader<CameraEvent>,
    keys: Res<ButtonInput<KeyCode>>,
    frame: Res<FrameManager>,
) {
    let updated_at = frame.updated_at();
    let last_updated_at = frame.last_updated_at();
    let duration = ((updated_at - last_updated_at) as f32).min(FRAME_JUMP_LIMIT);
    for (
        marker,
        mut transform,
        mut controller,
        mut inertia,
        frustum,
        mut orbit,
        mut flight,
        mut cam_st,
    ) in query.iter_mut()
    {
        if !controller.enabled {
            continue;
        }

        let is_cam_moving = is_camera_moving(&inertia, &controller);
        if cam_st.initialized {
            cam_st.status.clear();
        }

        // Handle camera events in order, processing all events this frame, not just the last.
        // If setCamera and moveCamera fire in the same frame, both must be applied sequentially.
        // Events run before the flight advances so a FlyTo issued mid-flight
        // interrupts the current flight instead of being swallowed.
        for ce in ce.read() {
            process_camera_event(
                &window,
                ce,
                &mut transform,
                &mut orbit,
                &mut inertia,
                frustum,
                &mut flight,
                &mut cam_st,
                &mut controller,
                is_cam_moving,
            );
        }

        // flying
        if let Some((position, orientation)) = flight.update(duration as FloatType) {
            apply_camera_change(
                &window,
                frustum,
                &mut transform,
                &mut orbit,
                &Some(position),
                &Some(orientation),
                None,
            );

            if flight.is_flying() {
                cam_st.status.push(CameraStatusType::Moving);
            } else {
                cam_st.status.push(CameraStatusType::MoveEnd);

                orbit.fixed_rotation_axis = None;
                orbit.fixed_rotation_pivot = None;
            };

            // Avoid manual camera operations during flight.
            continue;
        }

        if controller.enable_follow {
            handle_follow(
                &mut transform,
                &mut orbit,
                &mut controller,
                &mb,
                &mut mm,
                &mut mw,
            );
            continue;
        }

        let is_ctrl = keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight);
        let _is_shift = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);

        let touch_control = tc.read().last().map(|ev| ev.to_owned());

        // Handle rotations and movements
        handle_orbit_spin(
            &transform,
            &mut orbit,
            &mut controller,
            &mut inertia,
            &mb,
            &mut mm,
            &touch_control,
            is_ctrl,
            is_cam_moving,
            &mut cam_st,
        );

        handle_zoom(
            &transform,
            &mut orbit,
            &controller,
            &mut inertia,
            &mut mw,
            &touch_control,
            is_ctrl,
            is_cam_moving,
            &mut cam_st,
        );

        handle_tilt(
            &window,
            &mut orbit,
            &mut inertia,
            &mut controller,
            &mb,
            &mut mm,
            &touch_control,
            is_ctrl,
            &transform,
            frustum,
            is_cam_moving,
            &mut cam_st,
        );

        // Apply inertia
        apply_inertia(&mut orbit, &mut inertia, &controller, &transform);

        if needs_update(&inertia, &controller) || window.is_changed() || marker.is_added() {
            commit(&mut transform, &mut orbit);

            orbit.fixed_rotation_axis = None;
            orbit.fixed_rotation_pivot = None;
        }

        if inertia.translate_time < controller.translate_duration {
            apply_camera_translate(&mut transform, &mut inertia, &controller);

            orbit.fixed_rotation_axis = None;
            orbit.fixed_rotation_pivot = None;
        }

        after_inertia(&mut inertia, duration, &mut controller, &mut cam_st);

        if !cam_st.initialized {
            cam_st.initialized = true;
            // Set initial camera move status if camera status is empty.
            if cam_st.status.is_empty() {
                cam_st.status.push(CameraStatusType::MoveEnd);
            }
        }
    }
}

/// Drains flight terminal records into the `EventStore` so they reach JS
/// through `readEvents()` even on frames where the transform did not change.
pub fn sync_flight_events(
    mut events: ResMut<EventStore>,
    mut query: Query<&mut CameraFlight, With<CameraMarker>>,
) {
    for mut flight in query.iter_mut() {
        if !flight.ended.is_empty() {
            events.camera_flight_ended.append(&mut flight.ended);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_camera_event(
    window: &Window,
    ce: &CameraEvent,
    transform: &mut Transform,
    orbit: &mut Orbit,
    inertia: &mut CameraInertia,
    frustum: &CameraFrustum,
    flight: &mut CameraFlight,
    cam_st: &mut CameraStatus,
    controller: &mut CameraController,
    is_cam_moving: bool,
) {
    match ce {
        CameraEvent::Change {
            position,
            orientation,
            distance,
        } => {
            // Setting the camera cancels an in-progress flight.
            flight.cancel();
            apply_camera_change(
                window,
                frustum,
                transform,
                orbit,
                position,
                orientation,
                *distance,
            );

            // stop camera movement when changing position or orientation
            inertia.stop_all(controller);
            cam_st.status.push(CameraStatusType::Change);
            if is_cam_moving {
                cam_st.status.push(CameraStatusType::MoveEnd);
            }

            orbit.fixed_rotation_axis = None;
            orbit.fixed_rotation_pivot = None;
        }
        CameraEvent::Translate { amount, direction } => {
            // Ignored while a flight owns the camera.
            if flight.is_active() {
                return;
            }
            if handle_camera_translate(transform, orbit, inertia, amount, direction)
                && !is_cam_moving
            {
                cam_st.status.push(CameraStatusType::MoveStart);
            }
        }
        CameraEvent::FlyTo {
            position,
            orientation,
            duration,
            max_height,
            distance,
            easing,
            id,
        } => {
            let Some(pos) = position else {
                // Nothing to fly to, but the caller holds a pending promise
                // for this id. Settle it as not completed.
                flight.ended.push(navara_event_store::CameraFlightEnded {
                    id: *id,
                    completed: false,
                });
                return;
            };
            {
                let orient = orientation.unwrap_or(CameraOrientation::default());

                // When distance is specified, convert the target geographic point + orientation + distance
                // into the camera's own geographic position, then use that for flight interpolation.
                let effective_pos = if let Some(dist) = distance {
                    let heading = -orient.get_heading();
                    let pitch = orient.get_pitch() + 90.0;
                    let roll = orient.get_roll();

                    let ground_point = Vec3::new(pos.x, pos.y, 0.0);
                    let ellipsoid_surface = CRS::Geographic.to_vec3(WGS84_64, ground_point, 0.0);
                    // Geodetic surface normal, matching `apply_camera_change`.
                    let target_dir = xyz_to_vec3(
                        WGS84_64.geodetic_surface_normal_from_vec3(vec3_to_xyz(ellipsoid_surface)),
                    )
                    .normalize_or_zero();
                    let world_quat = calculate_world_quat(target_dir, heading);
                    let (world_forward, _) =
                        apply_orientation_changes(world_quat, Vec3::Y, Vec3::Z, pitch, roll);
                    // Use full position (including altitude) as the target point
                    let target = CRS::Geographic.to_vec3(WGS84_64, *pos, 0.0);
                    let camera_world = target - world_forward * dist.max(1.0);
                    let lle = CRS::Geocentric.to_lle(WGS84_64, camera_world, 0.0);
                    let lle_deg = lle.deg();
                    Vec3::new(lle_deg.lng.val(), lle_deg.lat.val(), lle_deg.height.val())
                } else {
                    *pos
                };

                match flight.fly_to(
                    *id,
                    transform,
                    frustum,
                    controller,
                    &effective_pos,
                    &orient,
                    duration,
                    max_height,
                    *easing,
                ) {
                    StartFlyResult::Started => {
                        // Start the flight animation and stop current inertia
                        inertia.stop_all(controller);
                        if is_cam_moving {
                            cam_st.status.push(CameraStatusType::Moving);
                        } else {
                            cam_st.status.push(CameraStatusType::MoveStart);
                        }
                    }
                    StartFlyResult::Instant => {
                        // duration <= 0: jump straight to the end pose. Report
                        // it as `Change`, exactly like `setCamera`, so an
                        // instant flight raises the same events as any other
                        // instantaneous camera change.
                        apply_camera_change(
                            window,
                            frustum,
                            transform,
                            orbit,
                            &Some(effective_pos),
                            &Some(orient),
                            None,
                        );
                        inertia.stop_all(controller);
                        cam_st.status.push(CameraStatusType::Change);

                        orbit.fixed_rotation_axis = None;
                        orbit.fixed_rotation_pivot = None;
                    }
                    StartFlyResult::NoOp => {}
                }
            }
        }
        CameraEvent::LookAt { target, offset } => {
            // Looking at a target cancels an in-progress flight.
            flight.cancel();
            apply_look_at(transform, orbit, target, offset);

            // stop camera movement when looking at a target
            inertia.stop_all(controller);
            cam_st.status.push(CameraStatusType::LookAt);
            if is_cam_moving {
                cam_st.status.push(CameraStatusType::MoveEnd);
            }

            orbit.fixed_rotation_axis = None;
            orbit.fixed_rotation_pivot = None;
        }
        CameraEvent::RotateAroundAxis { axis, angle } => {
            // Ignored while a flight owns the camera.
            if flight.is_active() {
                return;
            }
            // don't rotate if the camera is moving
            if !is_cam_moving {
                rotate_around_axis(window, transform, orbit, frustum, axis, angle);
                cam_st.status.push(CameraStatusType::Rotate);
            }
        }
        CameraEvent::Follow {
            enabled,
            target,
            offset,
        } => {
            // Ignored while a flight owns the camera.
            if flight.is_active() {
                return;
            }
            controller.enable_follow = *enabled;
            controller.free_look = false;

            if controller.enable_follow {
                controller.follow_target_pre = controller.follow_target_cur;
                controller.follow_target_cur = *target;
            } else {
                controller.follow_target_pre = None;
                controller.follow_target_cur = None;
            }

            controller.follow_offset = *offset;
        }
        CameraEvent::FollowFreeLook { enabled, target } => {
            // Ignored while a flight owns the camera.
            if flight.is_active() {
                return;
            }
            let was_free_look = controller.free_look;
            controller.enable_follow = *enabled;
            controller.free_look = *enabled;
            controller.follow_offset = None;

            if *enabled {
                if !was_free_look {
                    // Entry transition: snap pre = cur so handle_follow_move
                    // doesn't translate the camera by the (potentially huge)
                    // delta from the previous mode's target.
                    controller.follow_target_pre = *target;
                    controller.follow_target_cur = *target;
                } else {
                    controller.follow_target_pre = controller.follow_target_cur;
                    controller.follow_target_cur = *target;
                }
            } else {
                controller.follow_target_pre = None;
                controller.follow_target_cur = None;
            }
        }
    }
}

fn is_camera_moving(inertia: &CameraInertia, controller: &CameraController) -> bool {
    inertia.spin_time < controller.spin_duration
        || inertia.zoom_time < controller.zoom_duration
        || inertia.translate_time < controller.translate_duration
}

pub(crate) fn commit(transform: &mut Transform, orbit: &mut Orbit) {
    let quat = orbit.horizon_quat * orbit.vertical_quat;
    let rotated_local_position = quat * orbit.local_position;
    let rotated_local_up = quat * orbit.local_up;
    let rotated_local_forward = quat * orbit.local_forward;

    let world_position = orbit.pivot + (orbit.world_quat * rotated_local_position);
    let world_up = orbit.world_quat * rotated_local_up;
    let world_forward = orbit.world_quat * rotated_local_forward;

    transform.translation = world_position;
    transform.look_to(world_forward, world_up);
}

#[allow(clippy::too_many_arguments)]
fn handle_orbit_spin(
    transform: &Transform,
    orbit: &mut Orbit,
    controller: &mut CameraController,
    inertia: &mut CameraInertia,
    mb: &Res<ButtonInput<MouseButton>>,
    mm: &mut MessageReader<MouseMotion>,
    touch_control: &Option<TouchControl>,
    is_ctrl: bool,
    is_cam_moving: bool,
    cam_st: &mut CameraStatus,
) {
    let touch_spin = touch_control
        .as_ref()
        .is_some_and(|tc| tc.gesture == navara_input::TouchGesture::Swipe);

    if !controller.enable_spin
        || ((!mb.pressed(MouseButton::Left) || is_ctrl || mb.pressed(MouseButton::Right))
            && !touch_spin)
    {
        return;
    }

    if mm.is_empty() && !touch_spin {
        return;
    }

    let world = orbit.get_default_world_quat();
    orbit.set_quat(transform, world, Vec3::ZERO, false);

    let effective_distance = controller
        .terrain_hit_distance
        .unwrap_or_else(|| calc_distance_from_ellipsoid_surface(transform, WGS84_64));

    let ratio = effective_distance.abs() / controller.minimum_zoom_distance;

    let Some(spin) = rotate(mm, touch_control, controller, ratio, ratio) else {
        return;
    };

    if !is_cam_moving {
        cam_st.status.push(CameraStatusType::MoveStart);
    }

    inertia.spin(spin);
}

fn get_fixed_rotation_axis_and_pivot(
    window: &Window,
    transform: &Transform,
    frustum: &CameraFrustum,
    orbit: &mut Orbit,
) -> (Vec3, Vec3) {
    // Use fixed axis and pivot if they exist, otherwise calculate new ones
    if let (Some(fixed_axis), Some(fixed_pivot)) =
        (orbit.fixed_rotation_axis, orbit.fixed_rotation_pivot)
    {
        (fixed_axis, fixed_pivot)
    } else {
        // Calculate new fixed axis and pivot based on screen center intersection
        let center_2d = Vec2::new(window.raw_width() / 2., window.raw_height() / 2.);
        let ray = get_pick_ray_from_camera(window, transform, frustum, center_2d);
        if let Some(t) = ray_ellipsoid_intersect(&ray, WGS84_64) {
            let hit = ray.get_point(t);
            let n_xyz = WGS84_64.geodetic_surface_normal_from_vec3(vec3_to_xyz(hit));
            let n = xyz_to_vec3(n_xyz).normalize_or_zero();

            // Store the surface point as fixed pivot for all future rotations
            orbit.fixed_rotation_axis = Some(n);
            orbit.fixed_rotation_pivot = Some(hit);

            (n, hit)
        } else {
            // No intersection found, use rotation axis through Earth's core with camera up direction
            let axis = transform.up(); // Camera up direction (screen up)
            let pivot = Vec3::ZERO; // Earth's core as pivot

            orbit.fixed_rotation_axis = Some(axis);
            orbit.fixed_rotation_pivot = Some(pivot);

            (axis, pivot)
        }
    }
}

/// Compute the signed angle (in radians) to rotate `v_from` onto `v_to` around a given `axis`.
///
/// The angle is positive if the rotation from `v_from` to `v_to` follows the right-hand rule
/// around `axis`, and negative otherwise. Both input vectors and the axis are normalized
/// internally. The result is in the range [-π, π].
fn signed_angle_around(v_from: Vec3, v_to: Vec3, axis: Vec3) -> f64 {
    let from_n = v_from.normalize_or_zero();
    let to_n = v_to.normalize_or_zero();
    let ax_n = axis.normalize_or_zero();
    let s = from_n.cross(to_n).dot(ax_n);
    let c = from_n.dot(to_n).clamp(-1.0, 1.0);
    s.atan2(c)
}

fn rotate_around_axis(
    window: &Window,
    transform: &mut Transform,
    orbit: &mut Orbit,
    frustum: &CameraFrustum,
    axis: &Option<Vec3>,
    angle: &FloatType,
) {
    if angle.abs() < EPSILON6 {
        return;
    }

    // If a rotation axis is specified, rotate around that axis with the Vec3::ZERO as the pivot.
    if let Some(axis) = axis {
        let a = axis.normalize_or_zero();
        if a.length_squared() < EPSILON6 {
            return;
        }

        let rotation = Quat::from_axis_angle(a, *angle);

        transform.translation = rotation * transform.translation;
        transform.rotation = (rotation * transform.rotation).normalize();

        return;
    }

    // If no rotation axis is specified, obtain the intersection of the screen center and the ground surface as the pivot,
    // and use the surface normal at the intersection point as the rotation axis.
    let (axis, pivot_point) = get_fixed_rotation_axis_and_pivot(window, transform, frustum, orbit);
    if axis.length_squared() < EPSILON6 {
        return;
    }

    let rotation = Quat::from_axis_angle(axis, *angle);
    let old_pos = transform.translation;
    let offset = old_pos - pivot_point;

    // Check if camera is nearly on the rotation axis (singular case)
    let is_singular =
        offset.length_squared() < EPSILON6 || axis.dot(offset.normalize_or_zero()).abs() > 0.9999;

    // Update position
    transform.translation = pivot_point + rotation * offset;

    if is_singular {
        // Singular case: just rotate orientation
        transform.rotation = (rotation * transform.rotation).normalize();
    } else {
        // Normal case: look at pivot point while preserving roll
        let old_forward = (pivot_point - old_pos).normalize_or_zero();
        let old_up = transform.up();

        // Project `axis` onto the plane orthogonal to `old_forward` and normalize it.
        // (i.e. the component of `axis` perpendicular to the viewing direction,
        //      used as a stable reference "up" vector relative to the forward direction)
        let up_ref = (axis - old_forward * old_forward.dot(axis)).normalize_or_zero();
        let roll = if up_ref.length_squared() > EPSILON6 {
            signed_angle_around(up_ref, old_up, old_forward)
        } else {
            0.0
        };

        // Look at pivot with roll compensation
        let new_forward = (pivot_point - transform.translation).normalize_or_zero();
        transform.look_to(new_forward, axis);

        if roll.abs() > EPSILON6 {
            let roll_rotation = Quat::from_axis_angle(new_forward, roll);
            transform.rotation = (roll_rotation * transform.rotation).normalize();
        }
    }

    orbit.tilt_quat = transform.rotation;
}

fn get_tilt_quat_by_ray(
    window: &Window,
    transform: &Transform,
    frustum: &CameraFrustum,
    ellipsoid: Ellipsoid<f64>,
    terrain_hit_distance: Option<f64>,
) -> (Vec3, Quat) {
    let center_2d = Vec2::new(window.raw_width() / 2., window.raw_height() / 2.);
    let ray = get_pick_ray_from_camera(window, transform, frustum, center_2d);
    let t = terrain_hit_distance.or_else(|| ray_ellipsoid_intersect(&ray, ellipsoid));
    let center = if let Some(t) = t {
        ray.get_point(t)
    } else {
        // If no intersection found, find the intersection point from the camera forward and the distance from the surface.
        let camera_world_pos = transform.translation;

        let distance = ray_ellipsoid_intersect(
            &Ray {
                origin: camera_world_pos,
                direction: -camera_world_pos.normalize(),
            },
            ellipsoid,
        )
        .unwrap_or(0.);

        camera_world_pos + transform.forward() * distance
    };

    let enu_transform = east_north_up_to_fixed_frame(center, ellipsoid);

    (center, Quat::from_mat4(&enu_transform))
}

// ref: https://github.com/CesiumGS/cesium/blob/0e9a425b475cd3cfdd90f35e9cdbdda453e448d8/packages/engine/Source/Scene/ScreenSpaceCameraController.js#L2462
#[allow(clippy::too_many_arguments)]
fn handle_tilt(
    window: &Window,
    orbit: &mut Orbit,
    inertia: &mut CameraInertia,
    controller: &mut CameraController,
    mb: &Res<ButtonInput<MouseButton>>,
    mm: &mut MessageReader<MouseMotion>,
    touch_control: &Option<TouchControl>,
    is_ctrl: bool,
    transform: &Transform,
    frustum: &CameraFrustum,
    is_cam_moving: bool,
    cam_st: &mut CameraStatus,
) {
    let ellipsoid = WGS84_64;

    let touch_tilt = touch_control.as_ref().is_some_and(|tc| {
        matches!(
            tc.gesture,
            navara_input::TouchGesture::DoubleSwipe | navara_input::TouchGesture::Rotate
        )
    });

    if !controller.enable_tilt
        || (((!is_ctrl || !mb.pressed(MouseButton::Left)) && !mb.pressed(MouseButton::Right))
            && !touch_tilt)
    {
        return;
    }

    if mm.is_empty() && !touch_tilt {
        return;
    }

    if orbit.default_world_quat.is_none() {
        orbit.default_world_quat = Some(orbit.world_quat);
    }

    let (center, enu_quat) = get_tilt_quat_by_ray(
        window,
        transform,
        frustum,
        ellipsoid,
        controller.terrain_hit_distance,
    );

    orbit.set_quat(transform, enu_quat, center, true);

    let Some(spin) = rotate(mm, touch_control, controller, 1., 1.) else {
        return;
    };

    if !is_cam_moving {
        cam_st.status.push(CameraStatusType::MoveStart);
    }

    inertia.spin(spin);
}

fn rotate(
    mm: &mut MessageReader<MouseMotion>,
    touch_control: &Option<TouchControl>,
    controller: &CameraController,
    ratio_x: f64,
    ratio_y: f64,
) -> Option<Vec3> {
    // Use just the latest motion
    let screen_delta = if let Some(ev) = mm.read().last() {
        Vec3::new(ev.delta.x as f64, ev.delta.y as f64, 0.0)
    } else if let Some(touch) = touch_control {
        Vec3::new(touch.delta.x, touch.delta.y, 0.0)
    } else {
        return None;
    };

    let pan_delta = Vec2::new(screen_delta.x * ratio_x, screen_delta.y * ratio_y);

    Some(Vec3::new(-pan_delta.x, -pan_delta.y, 0.0) * controller.spin_speed)
}

// Ref: https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/2933415dd04f969c902a976df8c85f132409bae7/src/three/controls/GlobeControls.js#L408
#[allow(clippy::too_many_arguments)]
fn handle_zoom(
    transform: &Transform,
    orbit: &mut Orbit,
    controller: &CameraController,
    inertia: &mut CameraInertia,
    mw: &mut MessageReader<MouseWheel>,
    touch_control: &Option<TouchControl>,
    is_ctrl: bool,
    is_cam_moving: bool,
    cam_st: &mut CameraStatus,
) {
    let touch_zoom = touch_control.as_ref().is_some_and(|tc| {
        matches!(
            tc.gesture,
            navara_input::TouchGesture::Pinch | navara_input::TouchGesture::Spread
        )
    });

    if !controller.enable_zoom || (mw.is_empty() && !touch_zoom) || is_ctrl {
        return;
    }

    let zoom = if let Some(ev) = mw.read().last() {
        ev.y
    } else if let Some(touch) = touch_control {
        touch.delta.x as f32
    } else {
        return;
    };

    let world = orbit.get_default_world_quat();
    orbit.set_quat(transform, world, Vec3::ZERO, false);

    let dist = controller
        .terrain_hit_distance
        .unwrap_or_else(|| calc_distance_from_ellipsoid_surface(transform, WGS84_64))
        .max(0.);
    let d = (zoom as f64) * controller.zoom_speed * dist * 0.0025;

    if !is_cam_moving {
        cam_st.status.push(CameraStatusType::MoveStart);
    }

    inertia.zoom(d);
}

fn calc_distance_from_ellipsoid_surface(transform: &Transform, ellipsoid: Ellipsoid<f64>) -> f64 {
    let camera_pos = transform.transform_point(Vec3::ZERO);
    let camera_forward = transform.forward();

    let ray = Ray {
        origin: camera_pos,
        direction: camera_forward,
    };

    if let Some(distance) = ray_ellipsoid_intersect(&ray, ellipsoid) {
        return distance;
    }

    // If we can't find the intersection point with the camera's forward direction,
    // it means the camera's forward vector is out of ellipsoid surface.
    // In that case, we can simply use the camera's position as the direction as workaround.
    let ray = Ray {
        origin: camera_pos,
        direction: -camera_pos.normalize(),
    };

    ray_ellipsoid_intersect(&ray, ellipsoid).unwrap_or(0.)
}

fn apply_inertia(
    orbit: &mut Orbit,
    inertia: &mut CameraInertia,
    controller: &CameraController,
    transform: &Transform,
) {
    apply_spin(orbit, inertia, controller, transform);
    apply_zoom(orbit, inertia, controller);
}

const MAX_SPIN_ANGLE: f64 = PI / 30.;

fn apply_spin(
    orbit: &mut Orbit,
    inertia: &mut CameraInertia,
    controller: &CameraController,
    transform: &Transform,
) {
    let t = inertia.spin_time / controller.spin_duration;
    if t > 1.0 {
        return;
    }

    let mut next = inertia.spin * (1.0 - ease_out_circ(t) as f64);

    next.y = next.y.clamp(-MAX_SPIN_ANGLE, MAX_SPIN_ANGLE);

    orbit.horizon_quat *= Quat::from_axis_angle(orbit.horizontal_rotation_axis, next.x);

    let vertical_delta = Quat::from_axis_angle(orbit.vertical_rotation_axis, next.y);

    let inverse = orbit.world_quat.inverse();

    let local_camera_forward = inverse * transform.forward();

    let next_vert_quat = orbit.vertical_quat * vertical_delta;
    let next_up = next_vert_quat * Vec3::Z;
    let next_forward = next_vert_quat * local_camera_forward;
    let next_align = next_forward.dot(next_up);

    // Restrict the vertical rotation near the poles.
    if orbit.is_tilting && next_align.abs() > 0.995 {
        let y = inertia.spin.y;
        let is_vertical_rotation_skipped =
            (next_align < 0. && y < 0.) || (next_align > 0. && y > 0.);
        if is_vertical_rotation_skipped {
            return;
        }
    }
    orbit.vertical_quat = next_vert_quat;
}

fn apply_zoom(orbit: &mut Orbit, inertia: &mut CameraInertia, controller: &CameraController) {
    let t = inertia.zoom_time / controller.zoom_duration;
    if t > 1. {
        return;
    }
    let next_zoom = inertia.zoom * (1. - ease_out_circ(t) as f64);
    let next = orbit.local_position - orbit.local_forward * next_zoom;
    let length = next.length();
    if length >= controller.maximum_zoom_distance && next_zoom > 0. {
        return;
    }
    if length <= controller.minimum_zoom_distance && next_zoom < 0. {
        return;
    }
    orbit.local_position = next;
}

fn needs_update(inertia: &CameraInertia, controller: &CameraController) -> bool {
    inertia.spin_time < controller.spin_duration || inertia.zoom_time < controller.zoom_duration
}

fn after_inertia(
    inertia: &mut CameraInertia,
    duration: f32,
    controller: &mut CameraController,
    cam_st: &mut CameraStatus,
) {
    if inertia.spin_time < controller.spin_duration {
        inertia.spin_time += duration;

        if inertia.spin_time < controller.spin_duration {
            if !cam_st.status.contains(&CameraStatusType::MoveStart) {
                cam_st.status.push(CameraStatusType::Moving);
            }
        } else {
            cam_st.status.push(CameraStatusType::MoveEnd);
        }
    }
    if inertia.zoom_time < controller.zoom_duration {
        inertia.zoom_time += duration;

        if inertia.zoom_time < controller.zoom_duration {
            if !cam_st.status.contains(&CameraStatusType::MoveStart) {
                cam_st.status.push(CameraStatusType::Moving);
            }
        } else {
            cam_st.status.push(CameraStatusType::MoveEnd);
        }
    }
    if inertia.translate_time < controller.translate_duration {
        inertia.translate_time += duration;

        if inertia.translate_time < controller.translate_duration {
            if !cam_st.status.contains(&CameraStatusType::MoveStart) {
                cam_st.status.push(CameraStatusType::Moving);
            }
        } else {
            cam_st.status.push(CameraStatusType::MoveEnd);
        }
    }
}

/// Applies a camera change based on geographic position, heading, and pitch.
///
/// - `cc.position.xy`: longitude & latitude
/// - `cc.position.z`: camera height above the ground point (along normal)
/// - `cc.heading`: rotation around the local up axis (degrees)
/// - `cc.pitch`: tilt around the camera's right axis (degrees)
fn apply_camera_change(
    window: &Window,
    frustum: &CameraFrustum,
    transform: &mut Transform,
    orbit: &mut Orbit,
    position: &Option<Vec3>,
    orientation: &Option<CameraOrientation>,
    distance: Option<FloatType>,
) {
    let orient = orientation.unwrap_or_default();

    // Heading is inverted because positive rotation should be clockwise
    let heading = if orient.heading.is_some() {
        -orient.get_heading()
    } else {
        -get_heading(transform)
    };

    // Pitch is adjusted by +90° because we want -90° to point straight down
    let pitch = if orient.pitch.is_some() {
        orient.get_pitch() + 90.0
    } else {
        get_pitch(transform) + 90.0
    };

    let roll = if orient.roll.is_some() {
        orient.get_roll()
    } else {
        get_roll(transform)
    };

    // Reset orbit to default state before applying changes
    *orbit = Orbit::default();

    // Calculate new world position and target direction
    // This differs based on whether we have a new position or are using existing one
    // The frame axis must be the *geodetic* surface normal: the extraction
    // side (`CRS::Geocentric::to_lle`, `get_heading`/`get_pitch` via the ENU
    // frame) is geodetic, so building the frame from the geocentric direction
    // makes apply(extract(transform)) land up to ~0.2 deg / 0.33% of the
    // altitude away from the original pose (visible as a jump when a flight
    // starts from the current camera pose).
    let (world_position, target_dir) = if let Some(pos) = position {
        // Create ground point (ignoring altitude for now)
        let ground_point = Vec3::new(pos.x, pos.y, 0.0);
        // Convert geographic coordinates to world-space position
        let pivot = CRS::Geographic.to_vec3(WGS84_64, ground_point, 0.0);
        let target_dir =
            xyz_to_vec3(WGS84_64.geodetic_surface_normal_from_vec3(vec3_to_xyz(pivot)))
                .normalize_or_zero();

        let world_quat = calculate_world_quat(target_dir, heading);

        let world_position = if let Some(dist) = distance {
            // Distance-based: place camera `dist` meters from the target along the reverse forward direction.
            // Use the full position (including altitude) as the target point so that elevated
            // targets (e.g. a mountain summit at pos.z > 0) are correctly framed.
            let target = CRS::Geographic.to_vec3(WGS84_64, *pos, 0.0);
            let (world_forward, _) = apply_orientation_changes(
                world_quat,
                orbit.local_forward,
                orbit.local_up,
                pitch,
                roll,
            );
            target - world_forward * dist.max(1.0)
        } else {
            // Altitude-based: place camera `altitude` meters above the ground
            // point along the geodetic surface normal (the exact inverse of
            // the geocentric→geodetic conversion used when reading the pose
            // back).
            let altitude = pos.z.max(1.0);
            CRS::Geographic.to_vec3(WGS84_64, Vec3::new(pos.x, pos.y, altitude), 0.0)
        };

        (world_position, target_dir)
    } else {
        // When no position provided, use existing transform position
        let mut position = transform.translation;
        if position == Vec3::ZERO {
            position = orbit.local_position; // Fallback to orbit's default position
        }
        let target_dir =
            xyz_to_vec3(WGS84_64.geodetic_surface_normal_from_vec3(vec3_to_xyz(position)))
                .normalize_or_zero();
        (position, target_dir)
    };

    // Calculate orientation quaternion based on target direction
    let world_quat = calculate_world_quat(target_dir, heading);

    // Apply pitch and roll rotations to forward and up vectors
    let (world_forward, world_up) =
        apply_orientation_changes(world_quat, orbit.local_forward, orbit.local_up, pitch, roll);

    // Update transform with new position and orientation
    transform.translation = world_position;
    transform.look_to(world_forward, world_up);

    let (center, enu_quat) = get_tilt_quat_by_ray(window, transform, frustum, WGS84_64, None);

    // Update orbit state with new quaternion
    orbit.set_quat(transform, enu_quat, center, true);
}

/// Calculates the world rotation quaternion based on target direction and heading
/// Handles special case when looking directly up/down (Z-axis)
fn calculate_world_quat(target_dir: Vec3, heading: f64) -> Quat {
    // Calculate right vector - special case when looking straight up/down
    let right = if target_dir.abs_diff_eq(Vec3::Z, EPSILON3)
        || target_dir.abs_diff_eq(-Vec3::Z, EPSILON3)
    {
        Vec3::X // Default right vector when looking straight up/down
    } else {
        target_dir.cross(Vec3::Z).normalize_or_zero() // Standard right vector
    };

    // Calculate up vector from right and target direction
    let up = right.cross(target_dir).normalize_or_zero();

    // Create rotation matrix from coordinate system axes
    let rot_mat = Mat3::from_cols(right, target_dir, up);

    // Default camera orientation (looking down negative Y axis)
    let default_quat = Quat::from_mat3(&Mat3::from_cols(Vec3::NEG_X, Vec3::NEG_Y, Vec3::Z));

    // Create heading rotation around target direction
    let heading_quat = Quat::from_axis_angle(target_dir, heading.to_radians());

    // Combine rotations: heading × local rotation × default orientation
    heading_quat * Quat::from_mat3(&rot_mat) * default_quat
}

/// Applies pitch and roll rotations to orientation vectors
/// Returns modified forward and up vectors
fn apply_orientation_changes(
    world_quat: Quat,
    local_forward: Vec3,
    local_up: Vec3,
    pitch: f64,
    roll: f64,
) -> (Vec3, Vec3) {
    // Transform local vectors to world space
    let mut world_up = world_quat * local_up;
    let mut world_forward = world_quat * local_forward;

    // Calculate camera right vector for pitch rotation
    let camera_right = world_forward.cross(world_up).normalize_or_zero();

    // Apply pitch rotation (tilt up/down around right axis)
    let pitch_quat = Quat::from_axis_angle(camera_right, pitch.to_radians());
    world_forward = pitch_quat * world_forward;
    world_up = pitch_quat * world_up;

    // Apply roll rotation (tilt side-to-side around forward axis)
    let roll_quat = Quat::from_axis_angle(world_forward, roll.to_radians());
    world_up = roll_quat * world_up;

    (world_forward, world_up)
}

fn handle_camera_translate(
    transform: &mut Transform,
    orbit: &mut Orbit,
    inertia: &mut CameraInertia,
    amount: &f64,
    direction: &CamDirType,
) -> bool {
    if *amount < EPSILON6 {
        return false;
    }

    // Get the camera's local forward, right, and up directions
    let forward = transform.forward();
    let right = transform.right();
    let up = transform.up();

    // Determine the movement direction vector based on the input direction
    let dir_vec = match direction {
        CamDirType::Standard(CameraDirection::Forward) => forward,
        CamDirType::Standard(CameraDirection::Backward) => -forward,
        CamDirType::Standard(CameraDirection::Right) => right,
        CamDirType::Standard(CameraDirection::Left) => -right,
        CamDirType::Standard(CameraDirection::Up) => up,
        CamDirType::Standard(CameraDirection::Down) => -up,
        CamDirType::Custom(dir) => dir.normalize_or_zero(),
    };

    // Move the camera by the specified amount in the chosen direction
    inertia.translate(dir_vec * amount);

    // Reapply the orbit rotation to maintain a consistent view orientation
    let world = orbit.get_default_world_quat();
    orbit.set_quat(transform, world, Vec3::ZERO, false);

    true
}

fn apply_camera_translate(
    transform: &mut Transform,
    inertia: &mut CameraInertia,
    controller: &CameraController,
) {
    let t = inertia.translate_time / controller.translate_duration;
    if t > 1. {
        return;
    }
    let next_trans = inertia.translate * (1. - ease_out_circ(t) as f64);
    let next = transform.translation + next_trans;
    let length = next.length();
    if length >= controller.maximum_zoom_distance {
        return;
    }
    if length <= controller.minimum_zoom_distance {
        return;
    }
    transform.translation = next;
}

// TODO: Always spin around `target`. It should be reset by `look_at(center)`.
pub(crate) fn apply_look_at(
    transform: &mut Transform,
    orbit: &mut Orbit,
    target: &Vec3,
    offset: &Vec3,
) {
    let ellipsoid = WGS84_64;
    let world_target = CRS::Geographic.to_vec3(ellipsoid, *target, 0.0);

    let enu_transform = east_north_up_to_fixed_frame(world_target, ellipsoid);
    let offset_world = (enu_transform * offset.extend(0.0)).truncate();

    let camera_position = world_target + offset_world;

    let forward = (world_target - camera_position).normalize();
    let mut up = (enu_transform * Vec3::Z.extend(0.0)).truncate().normalize();

    // Handle edge case where forward and up vectors are colinear (or nearly so)
    if forward
        .dot(up)
        .clamp(-1.0, 1.0)
        .abs()
        .equal_diff_epsilon(1.0, EPSILON6)
    {
        up = (enu_transform * Vec3::Y.extend(0.0)).truncate().normalize();
    }

    transform.translation = camera_position;
    transform.look_to(forward, up);

    orbit.set_quat(
        transform,
        Quat::from_mat4(&enu_transform),
        world_target,
        true,
    );
}

#[allow(clippy::type_complexity)]
pub fn update_frustum(
    mut events: ResMut<EventStore>,
    mut query: Query<
        (Entity, &mut CameraFrustum, &Transform, &CameraController),
        Or<(Added<Transform>, Changed<Transform>)>,
    >,
) {
    for (e, mut frustum, transform, controller) in query.iter_mut() {
        if controller.auto_adjust_near_far {
            let distance = transform.translation.length();
            if frustum.adjust_near_far(distance) {
                events.camera_frustum_updated = Some(e);
            }
        }

        frustum.update_sse_denominator();
        frustum.update_planes(transform);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::CameraFrustum;

    /// A flight's first sample is the reconstruction of the extracted current
    /// pose (transform -> lle + heading/pitch/roll -> apply_camera_change).
    /// The reconstruction must be the inverse of the extraction, or the
    /// camera visibly jumps when a flight starts.
    #[test]
    fn camera_pose_reconstruction_inverts_extraction() {
        let window = Window {
            width: 1600.,
            height: 900.,
            pixel_ratio: 1.,
        };
        let frustum_transform = Transform::default();
        let frustum = CameraFrustum::new(
            &frustum_transform,
            1.,
            1e6,
            Angle::new(50.).rad().val(),
            16. / 9.,
        );

        for (lng, lat, height, heading, pitch) in [
            (139.7671_f64, 35.6812_f64, 1000.0_f64, 0.0_f64, -60.0_f64),
            (139.7671, 35.6812, 1000.0, 45.0, -30.0),
            (-122.4, 37.7, 3200.0, 0.0, -60.0),
            (139.7, 35.6, 300_000.0, 20.0, -85.0),
            (0.0, 0.0, 5000.0, 0.0, -90.0),
        ] {
            // Build the "current" camera pose the same way setCamera does.
            let mut transform = Transform::default();
            let mut orbit = Orbit::default();
            apply_camera_change(
                &window,
                &frustum,
                &mut transform,
                &mut orbit,
                &Some(Vec3::new(lng, lat, height)),
                &Some(CameraOrientation {
                    pitch: Some(pitch),
                    heading: Some(heading),
                    roll: Some(0.0),
                }),
                None,
            );

            // Extract start options exactly like CameraFlight::fly_to.
            let lle = navara_core::CRS::Geocentric
                .to_lle(WGS84_64, transform.translation, 0.0)
                .deg();
            let ext_heading = get_heading(&transform);
            let ext_pitch = get_pitch(&transform);
            let ext_roll = get_roll(&transform);

            // Reconstruct like the per-frame flight apply.
            let mut re_transform = Transform::default();
            let mut re_orbit = Orbit::default();
            apply_camera_change(
                &window,
                &frustum,
                &mut re_transform,
                &mut re_orbit,
                &Some(Vec3::new(lle.lng.val(), lle.lat.val(), lle.height.val())),
                &Some(CameraOrientation {
                    pitch: Some(ext_pitch),
                    heading: Some(ext_heading),
                    roll: Some(ext_roll),
                }),
                None,
            );

            let pos_err = (re_transform.translation - transform.translation).length();
            let fwd_err = re_transform
                .forward()
                .angle_between(transform.forward())
                .to_degrees();
            assert!(
                pos_err < 0.01,
                "pose ({lng}, {lat}, {height}) reconstructed {pos_err} m away"
            );
            assert!(
                fwd_err < 0.05,
                "pose ({lng}, {lat}, {height}) reconstructed {fwd_err} deg off"
            );
        }
    }
}
