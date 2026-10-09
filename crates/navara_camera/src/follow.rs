use bevy_ecs::{message::MessageReader, system::Res};
use bevy_input::{
    ButtonInput,
    mouse::{MouseButton, MouseMotion, MouseWheel},
};
use navara_core::{CRS, WGS84_64, east_north_up_to_fixed_frame};
use navara_math::{EPSILON3, Quat, Transform, Vec2, Vec3};

use crate::{
    CameraController, Orbit,
    system::{apply_look_at, commit},
};

pub(crate) fn handle_follow(
    transform: &mut Transform,
    orbit: &mut Orbit,
    controller: &mut CameraController,
    mb: &Res<ButtonInput<MouseButton>>,
    mm: &mut MessageReader<MouseMotion>,
    mw: &mut MessageReader<MouseWheel>,
) {
    // If the user specifies both target and offset, treat it as a lookAt operation.
    if let (Some(follow_target_cur), Some(follow_offset)) =
        (controller.follow_target_cur, controller.follow_offset)
    {
        apply_look_at(transform, orbit, &follow_target_cur, &follow_offset);
        controller.follow_offset = None; // Clear offset after lookAt
        controller.follow_target_pre = controller.follow_target_cur;
        return;
    }

    if controller.free_look {
        handle_follow_move(transform, orbit, controller, false);
        orbit.local_position = Vec3::ZERO;
        orbit.horizontal_rotation_axis = Vec3::Z;
        handle_follow_spin(transform, orbit, controller, mb, mm);
        return;
    }

    handle_follow_move(transform, orbit, controller, true);
    handle_follow_spin(transform, orbit, controller, mb, mm);
    handle_follow_zoom(transform, orbit, controller, mw);
}

/// Calculate smooth follow effect when target moves
fn handle_follow_move(
    transform: &mut Transform,
    orbit: &mut Orbit,
    controller: &mut CameraController,
    tilt: bool,
) {
    if let (Some(target_cur), Some(target_pre)) =
        (controller.follow_target_cur, controller.follow_target_pre)
    {
        // Convert both targets to world coordinates
        let ellipsoid = WGS84_64;
        let world_target_cur = CRS::Geographic.to_vec3(ellipsoid, target_cur, 0.0);
        let world_target_pre = CRS::Geographic.to_vec3(ellipsoid, target_pre, 0.0);

        // Calculate the movement delta in world space
        let target_delta = world_target_cur - world_target_pre;
        let has_delta = target_delta.length_squared() > EPSILON3;

        if has_delta {
            // Apply the delta to camera position to follow the target smoothly
            transform.translation += target_delta;
        }

        // Update orbit pivot to keep the orbit center at the new target position
        orbit.pivot = world_target_cur;
        // Update orbit state to maintain synchronization
        let enu_transform = east_north_up_to_fixed_frame(world_target_cur, ellipsoid);
        orbit.set_quat(
            transform,
            Quat::from_mat4(&enu_transform),
            world_target_cur,
            tilt,
        );

        if has_delta {
            commit(transform, orbit);
        }

        controller.follow_target_pre = controller.follow_target_cur;
    }
}

fn handle_follow_spin(
    transform: &mut Transform,
    orbit: &mut Orbit,
    controller: &mut CameraController,
    mb: &Res<ButtonInput<MouseButton>>,
    mm: &mut MessageReader<MouseMotion>,
) {
    if mb.pressed(MouseButton::Left) && !mm.is_empty() {
        let screen_delta = if let Some(ev) = mm.read().last() {
            Vec3::new(ev.delta.x as f64, ev.delta.y as f64, 0.0)
        } else {
            return;
        };

        // Use fixed ratio for consistent rotation speed
        let ratio = 1.0;

        let pan_delta = Vec2::new(screen_delta.x * ratio, screen_delta.y * ratio);
        let spin = Vec3::new(-pan_delta.x, -pan_delta.y, 0.0) * controller.spin_speed;

        // Apply horizontal rotation directly
        orbit.horizon_quat *= Quat::from_axis_angle(orbit.horizontal_rotation_axis, spin.x);

        // Apply vertical rotation with pole restriction
        let vertical_delta = Quat::from_axis_angle(orbit.vertical_rotation_axis, spin.y);
        let inverse = orbit.world_quat.inverse();
        let local_camera_forward = inverse * transform.forward();

        let next_vert_quat = orbit.vertical_quat * vertical_delta;
        let next_up = next_vert_quat * Vec3::Z;
        let next_forward = next_vert_quat * local_camera_forward;
        let next_align = next_forward.dot(next_up);

        // Restrict the vertical rotation near the poles
        if next_align.abs() <= 0.999 {
            orbit.vertical_quat = next_vert_quat;
        } else {
            let y = spin.y;
            let is_vertical_rotation_skipped =
                (next_align < 0. && y < 0.) || (next_align > 0. && y > 0.);
            if !is_vertical_rotation_skipped {
                orbit.vertical_quat = next_vert_quat;
            }
        }

        commit(transform, orbit);
    }
}

fn handle_follow_zoom(
    transform: &mut Transform,
    orbit: &mut Orbit,
    controller: &mut CameraController,
    mw: &mut MessageReader<MouseWheel>,
) {
    // Handle mouse wheel to zoom in/out from follow target
    if let Some(follow_target_cur) = controller.follow_target_cur
        && !mw.is_empty()
    {
        let zoom = if let Some(ev) = mw.read().last() {
            ev.y
        } else {
            return;
        };

        // Calculate actual distance from camera to follow target
        let ellipsoid = WGS84_64;
        let world_target = CRS::Geographic.to_vec3(ellipsoid, follow_target_cur, 0.0);
        let current_distance = (transform.translation - world_target).length();

        let zoom_amount = (zoom as f64) * controller.zoom_speed * current_distance * 0.0025;

        // Calculate direction from camera to target (for zooming in)
        let to_target = (world_target - transform.translation).normalize();
        let new_camera_pos = transform.translation - to_target * zoom_amount;
        let new_distance = new_camera_pos.length();

        let too_close = controller.sinks_below_floor(transform.translation, new_camera_pos);
        let too_far = new_distance >= controller.maximum_zoom_distance;

        if !too_close && !too_far {
            transform.translation = new_camera_pos;

            // Update orbit state after zoom
            let enu_transform = east_north_up_to_fixed_frame(world_target, ellipsoid);
            orbit.set_quat(
                transform,
                Quat::from_mat4(&enu_transform),
                world_target,
                true,
            );

            commit(transform, orbit);
        }
    }
}
