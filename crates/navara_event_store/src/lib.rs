#![doc = include_str!("../README.md")]

mod model;

use bevy_ecs::{entity::Entity, prelude::Resource};

pub use model::*;

#[derive(Debug, Default, Resource)]
pub struct EventStore {
    pub camera_transform_updated: Option<Entity>,
    pub camera_frustum_updated: Option<Entity>,
    pub camera_flight_ended: Vec<CameraFlightEnded>,
    pub object_transform_updated: Vec<Entity>,
    pub mesh_removed: Vec<Entity>,
    pub mesh_added: Vec<Entity>,
    pub mesh_updated: Vec<Entity>,
    /// A live tile mesh whose geometry buffers were rewritten in place (an
    /// upsampled terrain mesh replaced by its real DEM). Emitted instead of
    /// `mesh_updated` so the platform swaps only the geometry and leaves the
    /// material, textures and drape state untouched.
    pub mesh_geometry_replaced: Vec<Entity>,
    pub data_requested: Vec<Entity>,
    pub data_requester_removed: Vec<Entity>,
    pub texture_fragment_reqested: Vec<Entity>,
    pub texture_fragment_removed: Vec<Entity>,
    pub worker_task_delegated: Vec<Entity>,
    pub worker_task_removed: Vec<Entity>,
    pub renderable_feature_added: Vec<Entity>,
    pub renderable_feature_changed: Vec<Entity>,
    pub renderable_feature_removed: Vec<Entity>,
    pub update_sample_terrain_height: Vec<Entity>,
    pub hillshade_backfilled: Vec<Entity>,
    pub hillshade_canceled: Vec<Entity>,
}

impl EventStore {
    pub fn clear(&mut self) {
        self.camera_transform_updated = None;
        self.camera_frustum_updated = None;
        self.camera_flight_ended.clear();
        self.object_transform_updated.clear();
        self.mesh_removed.clear();
        self.mesh_added.clear();
        self.mesh_updated.clear();
        self.mesh_geometry_replaced.clear();
        self.data_requested.clear();
        self.data_requester_removed.clear();
        self.texture_fragment_reqested.clear();
        self.texture_fragment_removed.clear();
        self.worker_task_delegated.clear();
        self.worker_task_removed.clear();
        self.renderable_feature_added.clear();
        self.renderable_feature_changed.clear();
        self.renderable_feature_removed.clear();
        self.update_sample_terrain_height.clear();
        self.hillshade_backfilled.clear();
        self.hillshade_canceled.clear();
    }
}
