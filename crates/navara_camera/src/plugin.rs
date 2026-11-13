use navara_core::Angle;
use navara_event_store::EventStore;
use navara_math::Transform;
use navara_window::WindowResizeEvent;

use crate::{
    CameraControlUpdateEvent, CameraController, CameraEvent, CameraFrustum, FlightIdAllocator,
    FrustumEvent, ViewZoom,
};

use super::CameraMarker;
use bevy_app::{PostUpdate, Startup, Update};
use bevy_ecs::{
    entity::Entity,
    message::MessageReader,
    query::{Added, Changed, Or},
    schedule::IntoScheduleConfigs,
    system::{Query, ResMut},
};

#[derive(Debug)]
pub struct CameraPlugin;

impl bevy_app::Plugin for CameraPlugin {
    fn build(&self, app: &mut bevy_app::App) {
        app.add_systems(Startup, super::system::startup)
            .init_resource::<FlightIdAllocator>()
            .init_resource::<ViewZoom>()
            .add_message::<CameraEvent>()
            .add_message::<FrustumEvent>()
            .add_message::<CameraControlUpdateEvent>()
            .add_systems(
                Update,
                (
                    handle_resize,
                    handle_frustum_setting,
                    handle_camera_control_update,
                    super::system::update,
                    super::system::sync_flight_events,
                    super::system::update_frustum,
                    super::system::update_view_zoom,
                )
                    .chain(),
            )
            .add_systems(PostUpdate, commit);
    }
}

// fn startup(mut commands: Commands) {
//     let translation = Vec3::new(-1000.0, 0.0, 0.0);
//     commands.spawn(CameraBundle {
//         marker: CameraMerker,
//         transform: Transform::from_translation(translation),
//     });
// }

#[allow(clippy::type_complexity)]
fn commit(
    mut events: ResMut<EventStore>,
    query: Query<(Entity, &CameraMarker), Or<(Added<Transform>, Changed<Transform>)>>,
) {
    let Some((e, _)) = query.iter().last() else {
        return;
    };
    events.camera_transform_updated = Some(e);
}

fn handle_resize(
    mut events: ResMut<EventStore>,
    mut camera: Query<(Entity, &CameraMarker, &mut CameraFrustum)>,
    mut ev: MessageReader<WindowResizeEvent>,
) {
    for w in ev.read() {
        for (e, _, mut frustum) in &mut camera {
            frustum.aspect_ratio = w.width / w.height;
            frustum.update_sse_denominator();

            // Emit camera frustum updated event when aspect ratio changes
            events.camera_frustum_updated = Some(e);
        }
    }
}

fn handle_frustum_setting(
    mut events: ResMut<EventStore>,
    mut camera: Query<(Entity, &CameraMarker, &mut CameraFrustum, &Transform)>,
    mut ev: MessageReader<FrustumEvent>,
) {
    for event in ev.read() {
        for (e, _, mut frustum, transform) in &mut camera {
            if let Some(fov) = event.fov {
                frustum.fov = Angle::new(fov).rad().val();
            }

            if let Some(near) = event.near {
                frustum.near = near;
            }

            if let Some(far) = event.far {
                frustum.far = far;
            }

            frustum.update_sse_denominator();
            frustum.update_planes(transform);

            events.camera_frustum_updated = Some(e);
        }
    }
}

fn handle_camera_control_update(
    mut camera: Query<(&CameraMarker, &mut CameraController)>,
    mut ev: MessageReader<CameraControlUpdateEvent>,
) {
    for event in ev.read() {
        for (_, mut controller) in &mut camera {
            if let Some(auto_adjust) = event.auto_adjust_near_far {
                controller.auto_adjust_near_far = auto_adjust;
            }
            if let Some(min_zoom) = event.minimum_zoom_distance {
                controller.minimum_zoom_distance = min_zoom;
            }
            if let Some(max_zoom) = event.maximum_zoom_distance {
                controller.maximum_zoom_distance = max_zoom;
            }
            if let Some(spin_speed) = event.spin_speed {
                controller.spin_speed = spin_speed;
            }
            if let Some(zoom_speed) = event.zoom_speed {
                controller.zoom_speed = zoom_speed;
            }
            if let Some(spin_duration) = event.spin_duration {
                controller.spin_duration = spin_duration;
            }
            if let Some(zoom_duration) = event.zoom_duration {
                controller.zoom_duration = zoom_duration;
            }
            if let Some(translate_duration) = event.translate_duration {
                controller.translate_duration = translate_duration;
            }
            if let Some(enable_spin) = event.enable_spin {
                controller.enable_spin = enable_spin;
            }
            if let Some(enable_zoom) = event.enable_zoom {
                controller.enable_zoom = enable_zoom;
            }
            if let Some(enable_tilt) = event.enable_tilt {
                controller.enable_tilt = enable_tilt;
            }
        }
    }
}
