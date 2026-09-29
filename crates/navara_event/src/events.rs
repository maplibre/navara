use bevy_ecs::world::World;
use navara_camera::CameraFrustum;
use navara_component::Priority;
use navara_data_requester::DataRequester;
use navara_event_store::{
    CameraFlightEnded, ComponentEvent, ComponentEventWithResource, EntityEvent, EventStore,
    ReconstructableComponentEvent,
};
use navara_feature_component::render::RenderableFeature;
use navara_globe::Globe;
use navara_layer::LayerId;
use navara_material::RasterTileInternalMaterial;
use navara_math::Transform;
use navara_mesh::Mesh;
use navara_texture_fragment::TextureFragment;
use navara_tile_component::{
    HillshadeBackfillEventData, HillshadeBackfillEvents, OverscaledTileHandle,
    TerrainHeightObserver, TileMeshMarker,
};
use navara_worker::DelegatedWorkerTasksParameters;

#[derive(Debug, Default)]
pub struct Events<'a> {
    pub camera_transform_updated: Option<&'a Transform>,
    pub camera_frustum_updated: Option<&'a CameraFrustum>,
    pub camera_flight_ended: Vec<CameraFlightEnded>,
    pub object_transform_updated: Vec<ComponentEvent<&'a Transform>>,
    pub mesh_removed: Vec<EntityEvent>,
    #[allow(clippy::type_complexity)]
    pub mesh_added: Vec<
        ComponentEventWithResource<
            (
                &'a TileMeshMarker,
                &'a Mesh,
                &'a RasterTileInternalMaterial,
                &'a Transform,
            ),
            &'a Globe,
        >,
    >,
    pub mesh_updated: Vec<
        ComponentEventWithResource<
            (&'a TileMeshMarker, &'a Mesh, &'a RasterTileInternalMaterial),
            &'a Globe,
        >,
    >,
    pub mesh_geometry_replaced: Vec<ComponentEvent<&'a Mesh>>,
    pub data_requested:
        Vec<ReconstructableComponentEvent<(&'a DataRequester, Option<&'a Priority>)>>,
    pub data_requester_removed: Vec<ReconstructableComponentEvent<&'a DataRequester>>,
    pub texture_fragment_reqested: Vec<ReconstructableComponentEvent<&'a TextureFragment>>,
    pub texture_fragment_removed: Vec<EntityEvent>,
    pub worker_task_delegated:
        Vec<ReconstructableComponentEvent<(&'a DelegatedWorkerTasksParameters, &'a Priority)>>,
    pub worker_task_removed: Vec<EntityEvent>,
    pub renderable_feature_added: Vec<
        ReconstructableComponentEvent<(
            &'a RenderableFeature,
            &'a LayerId,
            Option<&'a OverscaledTileHandle>,
        )>,
    >,
    pub renderable_feature_changed: Vec<
        ReconstructableComponentEvent<(
            &'a RenderableFeature,
            &'a LayerId,
            Option<&'a OverscaledTileHandle>,
        )>,
    >,
    pub renderable_feature_removed: Vec<ReconstructableComponentEvent<&'a LayerId>>,
    pub update_sample_terrain_height: Vec<ReconstructableComponentEvent<&'a TerrainHeightObserver>>,
    pub hillshade_backfilled: Vec<ReconstructableComponentEvent<&'a HillshadeBackfillEventData>>,
    pub hillshade_canceled: Vec<EntityEvent>,
}

impl<'a> Events<'a> {
    pub fn from_event_store(world: &'a World, store: &EventStore) -> Option<Events<'a>> {
        let mut events = Self::default();

        let mut is_changed = false;

        if let Some(e) = store.camera_transform_updated {
            events.camera_transform_updated = world.get::<Transform>(e);
            is_changed = true;
        }

        if let Some(e) = store.camera_frustum_updated {
            events.camera_frustum_updated = world.get::<CameraFrustum>(e);
            is_changed = true;
        }

        for e in store.camera_flight_ended.iter() {
            events.camera_flight_ended.push(*e);
            is_changed = true;
        }

        for e in store.object_transform_updated.iter() {
            if let Some(e) = ComponentEvent::from_world(*e, world) {
                events.object_transform_updated.push(e);
                is_changed = true;
            }
        }

        for e in store.mesh_removed.iter() {
            events.mesh_removed.push((*e).into());
            is_changed = true;
        }

        for e in store.mesh_added.iter() {
            if let Some(e) = ComponentEventWithResource::from_world_4(*e, world) {
                events.mesh_added.push(e);
                is_changed = true;
            }
        }

        for e in store.mesh_updated.iter() {
            if let Some(e) = ComponentEventWithResource::from_world_3(*e, world) {
                events.mesh_updated.push(e);
                is_changed = true;
            }
        }

        for e in store.mesh_geometry_replaced.iter() {
            if let Some(e) = ComponentEvent::from_world(*e, world) {
                events.mesh_geometry_replaced.push(e);
                is_changed = true;
            }
        }

        for e in store.data_requested.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world_and_option(*e, world) {
                events.data_requested.push(e);
                is_changed = true;
            }
        }

        for e in store.data_requester_removed.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world(*e, world) {
                events.data_requester_removed.push(e);
                is_changed = true;
            }
        }

        for e in store.texture_fragment_reqested.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world(*e, world) {
                events.texture_fragment_reqested.push(e);
                is_changed = true;
            }
        }

        for e in store.texture_fragment_removed.iter() {
            events.texture_fragment_removed.push((*e).into());
            is_changed = true;
        }

        for e in store.worker_task_delegated.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world_2(*e, world) {
                events.worker_task_delegated.push(e);
                is_changed = true;
            }
        }

        for e in store.worker_task_removed.iter() {
            events.worker_task_removed.push((*e).into());
            is_changed = true;
        }

        for e in store.renderable_feature_added.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world_2_and_option(*e, world) {
                events.renderable_feature_added.push(e);
                is_changed = true;
            }
        }

        for e in store.renderable_feature_changed.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world_2_and_option(*e, world) {
                events.renderable_feature_changed.push(e);
                is_changed = true;
            }
        }

        for e in store.renderable_feature_removed.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world(*e, world) {
                events.renderable_feature_removed.push(e);
                is_changed = true;
            }
        }

        for e in store.update_sample_terrain_height.iter() {
            if let Some(e) = ReconstructableComponentEvent::from_world(*e, world) {
                events.update_sample_terrain_height.push(e);
                is_changed = true;
            }
        }

        for entity in store.hillshade_backfilled.iter() {
            // Read HillshadeBackfillEvents component from entity
            if let Some(backfill_events) = world.get::<HillshadeBackfillEvents>(*entity) {
                // Push each event data as a separate ReconstructableComponentEvent
                for event_data in &backfill_events.events {
                    events
                        .hillshade_backfilled
                        .push(ReconstructableComponentEvent::new(*entity, event_data));
                    is_changed = true;
                }
            }
        }

        for e in store.hillshade_canceled.iter() {
            events.hillshade_canceled.push((*e).into());
            is_changed = true;
        }

        is_changed.then_some(events)
    }
}
