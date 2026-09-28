#![doc = include_str!("../README.md")]

use bevy_ecs::{
    entity::Entity,
    query::{With, Without},
    system::SystemState,
    world::Mut,
};
use navara_buffer_store::{BufferStore, Handle};
use navara_camera::{
    CamDirType, CameraControlUpdateEvent, CameraController, CameraDirection, CameraEvent,
    CameraFrustum, CameraMarker, CameraOrientation, CameraStatus, FlightIdAllocator, FlyToEasing,
    FrustumEvent, get_heading, get_pitch, get_roll,
};
use navara_component::{Deleted, Rendered};
use navara_core::{
    CRS, ElevationDecoder, LLE, LngLat, Radians, WGS84_64, WGS84_A_64, camera_zoom_level,
};
use navara_data_requester::DataRequester;
use navara_event::Events;
use navara_feature_component::{
    batch::{FeatureBatchIdMap, GlobalBatchIds},
    batched_geometry::{
        BatchedPolygonGeometry, BatchedPolylineGeometry, TakenPolygonGeometry,
        TakenPolylineGeometry,
    },
    render::RenderableFeature,
};
use navara_frame::FrameManager;
use navara_globe::Globe;
use navara_layer::{LayerDescStore, LayerDescription, LayerId};
use navara_material::{PolygonMaterial, PolylineMaterial};
use navara_math::{FloatType, Transform, Vec3};
use navara_source::{Source, SourceStore};
use navara_texture_fragment::{TextureFragmentLoadedEvent, TextureFragmentStatus};
use navara_tile_component::{
    MartiniComponent, RasterTileQuadtree, TerrainHeightObserver, TerrainTile, TerrainTileQuadtree,
    TileHandle, TileTerrainDataRequesterQuery, VectorTileQuadtree, compute_terrain_height_at_point,
};
use navara_vector_tile::{LayerResources, VectorResolveRevision, resolve_vector_tile_states};
use navara_window::{Window, WindowResizeEvent};
use navara_worker::{
    DelegatedWorkerTasksResult, WorkerTaskCompleted, WorkerTaskCompletedEvent,
    WorkerTaskFailedEvent, WorkerTaskMarker,
};

mod app;
mod batch_property;
mod memory;

pub use batch_property::*;
pub use memory::*;
pub use navara_tile::raster::ResolvedRasterTileState;
pub use navara_vector_tile::ResolvedVectorTileState;

pub struct App {
    app: bevy_app::App,
    win: bevy_ecs::entity::Entity,
}

impl App {
    pub fn new() -> Self {
        let mut app = bevy_app::App::new();

        app.add_plugins(app::Plugin);

        let win = app.world_mut().spawn_empty().id();

        Self { app, win }
    }

    pub fn update(&mut self, updated_at: f64) {
        self.set_updated_at(updated_at);
        self.app.update();
    }

    fn set_updated_at(&mut self, at: f64) {
        let Some(mut m) = self.app.world_mut().get_resource_mut::<FrameManager>() else {
            return;
        };
        m.set_updated_at(at);
    }

    pub fn trigger_event(&mut self, ev: navara_input::Input) {
        navara_input::trigger_event(self.app.world_mut(), self.win, ev);
    }

    pub fn read_events(&mut self) -> Option<Events<'_>> {
        let ev = self
            .app
            .world()
            .get_resource::<navara_event_store::EventStore>()?;
        Events::from_event_store(self.app.world(), ev)
    }

    pub fn get_buffer_u8(&self, handle: i32) -> Option<&[u8]> {
        let store = self.app.world().get_resource::<BufferStore>()?;
        store.get_u8(&handle)
    }

    pub fn get_buffer_u32(&self, handle: i32) -> Option<&[u32]> {
        let store = self.app.world().get_resource::<BufferStore>()?;
        store.get_u32(&handle)
    }

    pub fn get_buffer_f32(&self, handle: i32) -> Option<&[f32]> {
        let store = self.app.world().get_resource::<BufferStore>()?;
        store.get_f32(&handle)
    }

    pub fn get_buffer_f64(&self, handle: i32) -> Option<&[f64]> {
        let store = self.app.world().get_resource::<BufferStore>()?;
        store.get_f64(&handle)
    }

    pub fn set_buffer_u8(&mut self, handle: i32, bits: u64, data: Vec<u8>) {
        let Some(mut store) = self.app.world_mut().get_resource_mut::<BufferStore>() else {
            return;
        };
        store.set_u8(handle, data);

        // TODO: This is only for DataRequester, so curve out this function.
        self.app
            .world_mut()
            .write_message(navara_buffer_store::BufferStoreLoadedEvent {
                id: Entity::from_bits(bits),
                ty: navara_buffer_store::BufferType::U8,
                handle,
            });
    }

    /// Mirror of [`set_buffer_u8`](Self::set_buffer_u8) for the JS-side
    /// `InMemoryBufferStore`: registers an `External` entry (byte count only —
    /// the real bytes stay in JS) and fires `BufferStoreLoadedEvent` so the
    /// DataRequester finalizes exactly like a WASM-resident load. An `External`
    /// entry carries no element type, so unlike `set_buffer_u8` this is not
    /// typed; the event's `ty` is nominal (nothing reads it).
    pub fn set_external_buffer(&mut self, handle: i32, bits: u64, byte_len: usize) {
        let Some(mut store) = self.app.world_mut().get_resource_mut::<BufferStore>() else {
            return;
        };
        store.set_external(handle, byte_len);

        // TODO: This is only for DataRequester, so curve out this function.
        self.app
            .world_mut()
            .write_message(navara_buffer_store::BufferStoreLoadedEvent {
                id: Entity::from_bits(bits),
                ty: navara_buffer_store::BufferType::U8,
                handle,
            });
    }

    /// Issue a handle for a JS-side buffer whose real bytes live in the
    /// `InMemoryBufferStore` (byte count only tracked here).
    pub fn new_external_buffer(&mut self, byte_len: usize) -> Option<Handle> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        Some(store.new_external(byte_len))
    }

    /// Drain the handles of `External` entries removed since the last call so
    /// JS can evict them from its `InMemoryBufferStore` map.
    pub fn drain_removed_external_handles(&mut self) -> Vec<i32> {
        let Some(mut store) = self.app.world_mut().get_resource_mut::<BufferStore>() else {
            return Vec::new();
        };
        store.drain_removed_external()
    }

    pub fn new_buffer_u8(&mut self, data: Vec<u8>) -> Option<Handle> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        Some(store.new_u8(data))
    }

    pub fn new_buffer_u32(&mut self, data: Vec<u32>) -> Option<Handle> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        Some(store.new_u32(data))
    }

    pub fn new_buffer_f32(&mut self, data: Vec<f32>) -> Option<Handle> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        Some(store.new_f32(data))
    }

    pub fn new_buffer_f64(&mut self, data: Vec<f64>) -> Option<Handle> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        Some(store.new_f64(data))
    }

    pub fn remove_buffer(&mut self, handle: i32) {
        let Some(mut store) = self.app.world_mut().get_resource_mut::<BufferStore>() else {
            return;
        };
        store.remove(&handle);
    }

    pub fn remove_buffer_u8(&mut self, handle: i32) -> Option<Vec<u8>> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        store.remove_u8(&handle)
    }
    pub fn remove_buffer_u32(&mut self, handle: i32) -> Option<Vec<u32>> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        store.remove_u32(&handle)
    }
    pub fn remove_buffer_f32(&mut self, handle: i32) -> Option<Vec<f32>> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        store.remove_f32(&handle)
    }
    pub fn remove_buffer_f64(&mut self, handle: i32) -> Option<Vec<f64>> {
        let mut store = self.app.world_mut().get_resource_mut::<BufferStore>()?;
        store.remove_f64(&handle)
    }

    pub fn set_tile_mesh_prepared(&mut self, handle: TileHandle) {
        self.app
            .world_mut()
            .write_message(navara_tile::tile::MeshPreparedEvent {
                tile_handle: handle,
            });
    }

    pub fn mark_point_is_rendered(&mut self, bits: u64) {
        let entity = Entity::from_bits(bits);
        let world = self.app.world_mut();
        let mut query = world.query::<&mut RenderableFeature>();

        let Ok(mut feature) = query.get_mut(world, entity) else {
            return;
        };
        let render_info = match feature.as_mut() {
            RenderableFeature::Point { render_info, .. } => render_info,
            RenderableFeature::Billboard { render_info, .. } => render_info,
            RenderableFeature::Text { render_info, .. } => render_info,
            _ => unreachable!("Unexpected RenderableFeature type"),
        };
        render_info.is_rendered = true;
        world.commands().entity(entity).insert(Rendered);
    }

    pub fn mark_polyline_is_rendered(&mut self, bits: u64) {
        let entity = Entity::from_bits(bits);
        let world = self.app.world_mut();
        let mut query = world.query::<&mut RenderableFeature>();

        let Ok(mut feature) = query.get_mut(world, entity) else {
            return;
        };
        let RenderableFeature::Polyline { render_info, .. } = feature.as_mut() else {
            unreachable!("Unexpected RenderableFeature type");
        };
        render_info.is_rendered = true;
        world.commands().entity(entity).insert(Rendered);
    }

    pub fn mark_polygon_is_rendered(&mut self, bits: u64) {
        let entity = Entity::from_bits(bits);
        let world = self.app.world_mut();
        let mut query = world.query::<&mut RenderableFeature>();

        let Ok(mut feature) = query.get_mut(world, entity) else {
            return;
        };
        let RenderableFeature::Polygon { render_info, .. } = feature.as_mut() else {
            unreachable!("Unexpected RenderableFeature type");
        };
        render_info.is_rendered = true;
        world.commands().entity(entity).insert(Rendered);
    }

    pub fn mark_model_is_rendered(&mut self, bits: u64) {
        let entity = Entity::from_bits(bits);
        let world = self.app.world_mut();
        let mut query = world.query::<&mut RenderableFeature>();

        let Ok(mut feature) = query.get_mut(world, entity) else {
            return;
        };
        let RenderableFeature::Model { render_info, .. } = feature.as_mut() else {
            unreachable!("Unexpected RenderableFeature type");
        };
        render_info.is_rendered = true;
        world.commands().entity(entity).insert(Rendered);
    }

    pub fn trigger_data_requester_loaded(&mut self, bits: u64, handle: i32) {
        self.app
            .world_mut()
            .write_message(navara_buffer_store::BufferStoreLoadedEvent {
                id: Entity::from_bits(bits),
                ty: navara_buffer_store::BufferType::U8,
                handle,
            });
    }

    pub fn trigger_data_requester_failed(&mut self, bits: u64) {
        self.app
            .world_mut()
            .write_message(navara_buffer_store::BufferStoreFailedEvent {
                id: Entity::from_bits(bits),
            });
    }

    pub fn resize(&mut self, width: FloatType, height: FloatType, pixel_ratio: FloatType) {
        let Some(mut window_res) = self.app.world_mut().get_resource_mut::<Window>() else {
            return;
        };

        window_res.height = height * pixel_ratio;
        window_res.width = width * pixel_ratio;
        window_res.pixel_ratio = pixel_ratio;

        self.app.world_mut().write_message(WindowResizeEvent {
            width,
            height,
            pixel_ratio,
        });
    }

    pub fn trigger_texture_fragment_loaded(&mut self, bits: u64, status: TextureFragmentStatus) {
        self.app
            .world_mut()
            .write_message(TextureFragmentLoadedEvent {
                id: Entity::from_bits(bits),
                status,
            });
    }

    pub fn trigger_worker_task_completed(&mut self, bits: u64, result: DelegatedWorkerTasksResult) {
        self.app
            .world_mut()
            .write_message(WorkerTaskCompletedEvent {
                parameters_id: Entity::from_bits(bits),
                result,
            });
    }

    /// Report a delegated task that ended without a deliverable result so the
    /// engine releases its delegator (see [`WorkerTaskFailedEvent`]).
    pub fn trigger_worker_task_failed(&mut self, delegator_bits: u64) {
        self.app.world_mut().write_message(WorkerTaskFailedEvent {
            delegator_id: Entity::from_bits(delegator_bits),
        });
    }

    pub fn add_layer(&mut self, layer_id: &str, desc: LayerDescription) {
        if let Some(mut layer_desc_store) =
            self.app.world_mut().get_resource_mut::<LayerDescStore>()
        {
            layer_desc_store.add(layer_id.to_owned(), desc.clone());
        }

        self.app
            .world_mut()
            .write_message(navara_layer_event::AddLayerEvent {
                desc,
                restore_order: None,
            });
    }

    pub fn get_layer_index(&self, layer_id: &str) -> Option<usize> {
        let store = self.app.world().get_resource::<LayerDescStore>()?;
        store.get_order(layer_id).copied()
    }

    /// The source-based layer type (`vector`/`raster`/`terrain`/`3d-tiles`) of a
    /// layer — the same type accepted by `build_source_layer`. `update_layer`
    /// uses this so a partial update payload doesn't need to repeat `type`.
    pub fn get_layer_type(&self, layer_id: &str) -> Option<&'static str> {
        let mut layer_type = None;
        if let Some(layer_desc_store) = self.app.world().get_resource::<LayerDescStore>()
            && let Some(desc) = layer_desc_store.get(layer_id)
        {
            layer_type = match desc {
                LayerDescription::Tiles(_) => Some("raster"),
                LayerDescription::Terrain(_) => Some("terrain"),
                LayerDescription::GeoJson(_) | LayerDescription::Mvt(_) => Some("vector"),
                LayerDescription::B3dm(_)
                | LayerDescription::Pnts(_)
                | LayerDescription::Cesium3dTiles(_) => Some("3d-tiles"),
            };
        }

        layer_type
    }

    pub fn get_layer_description(&self, layer_id: &str) -> Option<LayerDescription> {
        if let Some(layer_desc_store) = self.app.world().get_resource::<LayerDescStore>()
            && let Some(desc) = layer_desc_store.get(layer_id)
        {
            return Some(desc.clone());
        }

        None
    }

    pub fn update_layer(&mut self, layer_id: &str, mut desc: LayerDescription) {
        match &mut desc {
            LayerDescription::GeoJson(layer) => {
                for appearance in &layer.appearances {
                    self.app
                        .world_mut()
                        .write_message(navara_layer_event::UpdateLayerEvent {
                            layer_id: LayerId(layer_id.to_owned()),
                            appearance: appearance.clone(),
                            elevation_heatmap_config: None,
                            hillshade_config: None,
                        });
                }
            }
            LayerDescription::B3dm(layer) => {
                for appearance in &layer.appearances {
                    self.app
                        .world_mut()
                        .write_message(navara_layer_event::UpdateLayerEvent {
                            layer_id: LayerId(layer_id.to_owned()),
                            appearance: appearance.clone(),
                            elevation_heatmap_config: None,
                            hillshade_config: None,
                        });
                }
            }
            LayerDescription::Pnts(layer) => {
                for appearance in &layer.appearances {
                    self.app
                        .world_mut()
                        .write_message(navara_layer_event::UpdateLayerEvent {
                            layer_id: LayerId(layer_id.to_owned()),
                            appearance: appearance.clone(),
                            elevation_heatmap_config: None,
                            hillshade_config: None,
                        });
                }
            }
            LayerDescription::Cesium3dTiles(layer) => {
                for appearance in &layer.appearances {
                    self.app
                        .world_mut()
                        .write_message(navara_layer_event::UpdateLayerEvent {
                            layer_id: LayerId(layer_id.to_owned()),
                            appearance: appearance.clone(),
                            elevation_heatmap_config: None,
                            hillshade_config: None,
                        });
                }
            }
            LayerDescription::Mvt(layer) => {
                for appearance in &layer.appearances {
                    self.app
                        .world_mut()
                        .write_message(navara_layer_event::UpdateLayerEvent {
                            layer_id: LayerId(layer_id.to_owned()),
                            appearance: appearance.clone(),
                            elevation_heatmap_config: None,
                            hillshade_config: None,
                        });
                }
            }
            LayerDescription::Tiles(layer) => {
                if let Some(appearance) = layer.appearance.clone() {
                    self.app
                        .world_mut()
                        .write_message(navara_layer_event::UpdateLayerEvent {
                            layer_id: LayerId(layer_id.to_owned()),
                            appearance,
                            elevation_heatmap_config: layer.elevation_heatmap_config.clone(),
                            hillshade_config: layer.hillshade_config.clone(),
                        });
                }
            }
            LayerDescription::Terrain(layer) => {
                // `Appearance` has no terrain variant, so terrain material updates
                // flow through a dedicated event. A source change is handled by
                // rebuilding the layer in `Core::update_layer`, not here.
                if let Some(material) = layer.appearance.clone() {
                    self.app.world_mut().write_message(
                        navara_layer_event::UpdateTerrainLayerEvent {
                            layer_id: LayerId(layer_id.to_owned()),
                            material,
                        },
                    );
                }
            }
        }

        if let Some(mut layer_desc_store) =
            self.app.world_mut().get_resource_mut::<LayerDescStore>()
        {
            layer_desc_store.update(layer_id.to_owned(), desc.clone());
        }
    }

    pub fn delete_layer(&mut self, layer_id: &str) {
        if let Some(mut source_store) = self.app.world_mut().get_resource_mut::<SourceStore>() {
            source_store.unlink_layer(layer_id);
        }

        // Drop any queued reset for this layer so an in-flight source update can't
        // re-add (resurrect) a layer the caller has explicitly deleted.
        if let Some(mut queue) = self
            .app
            .world_mut()
            .get_resource_mut::<navara_layer_event::LayerReloadQueue>()
        {
            queue.pending.retain(|reload| reload.layer_id != layer_id);
        }

        self.app
            .world_mut()
            .write_message(navara_layer_event::DeleteLayerEvent {
                layer_id: LayerId(layer_id.to_owned()),
                reset: false,
            });
    }

    /// Record that a layer references a source so the source is reference-counted
    /// and protected from deletion while in use.
    pub fn link_layer_source(&mut self, layer_id: &str, source_id: &str) {
        if let Some(mut source_store) = self.app.world_mut().get_resource_mut::<SourceStore>() {
            source_store.link_layer(layer_id.to_owned(), source_id);
        }
    }

    /// Drop a layer's reference to its current source (decrementing that source's
    /// count), without deleting the layer. Used when a layer is re-pointed at a
    /// different source so the old source is dereferenced but kept.
    pub fn unlink_layer_source(&mut self, layer_id: &str) {
        if let Some(mut source_store) = self.app.world_mut().get_resource_mut::<SourceStore>() {
            source_store.unlink_layer(layer_id);
        }
    }

    pub fn add_source(&mut self, source_id: &str, source: Source) {
        // A duplicate id overrides the existing source (later wins) while keeping
        // its reference count.
        if let Some(mut source_store) = self.app.world_mut().get_resource_mut::<SourceStore>() {
            source_store.add(source_id.to_owned(), source);
        }
    }

    // TODO: Remove with the legacy layer API.
    /// Register an implicit source created for a legacy layer. Unlike
    /// [`add_source`](Self::add_source), the source is reclaimed automatically
    /// once the referencing layer is deleted.
    pub fn add_implicit_source(&mut self, source_id: &str, source: Source) {
        if let Some(mut source_store) = self.app.world_mut().get_resource_mut::<SourceStore>() {
            source_store.add_implicit(source_id.to_owned(), source);
        }
    }

    pub fn update_source(&mut self, source_id: &str, source: Source) {
        if let Some(mut source_store) = self.app.world_mut().get_resource_mut::<SourceStore>() {
            source_store.update(source_id.to_owned(), source);
        }
    }

    /// Remove a source and its resources, returning whether it was deleted.
    ///
    /// Returns `false` (and deletes nothing) while any layer still references the
    /// source, or if the source id is unknown; `true` once it has been removed.
    /// Sources own no ECS entities, so removing the store entry is the cleanup.
    pub fn delete_source(&mut self, source_id: &str) -> bool {
        if let Some(mut source_store) = self.app.world_mut().get_resource_mut::<SourceStore>() {
            let ref_count = source_store.ref_count(source_id);
            if ref_count > 0 {
                #[cfg(feature = "debug")]
                bevy_log::warn!(
                    "Cannot delete source `{source_id}` while {ref_count} layer(s) reference it"
                );
                return false;
            }
            return source_store.delete(source_id).is_some();
        }
        false
    }

    /// The ids of every layer currently referencing `source_id`.
    pub fn layers_for_source(&self, source_id: &str) -> Vec<String> {
        self.app
            .world()
            .get_resource::<SourceStore>()
            .map(|store| store.layers_for_source(source_id))
            .unwrap_or_default()
    }

    /// Reset a layer: tear down its current resources and re-add it with `desc`
    /// once the teardown completes. Used when a referenced source changes so the
    /// layer reloads against the new fetch config.
    ///
    /// The source reference is intentionally left intact (this does not go through
    /// [`delete_layer`](Self::delete_layer), which would unlink it), so the layer
    /// keeps its single reference across the reset. The re-add is deferred until
    /// teardown finishes — see `navara_layer_event::flush_layer_reloads`.
    pub fn reset_layer(&mut self, layer_id: &str, desc: LayerDescription) {
        // Capture the layer's current order index before teardown drops it, so the
        // re-add can restore it and `get_layer_index` stays stable across the reset.
        let order = self
            .app
            .world()
            .get_resource::<LayerDescStore>()
            .and_then(|store| store.get_order(layer_id).copied());

        // Also capture the layer entity's ECS `Order` (the render z-order) so the
        // re-spawned entity keeps its position: a reset must be transparent, not
        // move the layer to the top like a user re-add. Only `TilesLayer` carries
        // an ECS `Order`; other layer types yield `None` here.
        let ecs_order = {
            let world = self.app.world_mut();
            let mut query = world.query::<(&navara_layer::TilesLayer, &navara_component::Order)>();
            query
                .iter(world)
                .find(|(l, _)| l.layer_id == layer_id)
                .map(|(_, o)| o.0)
        };

        self.app
            .world_mut()
            .write_message(navara_layer_event::DeleteLayerEvent {
                layer_id: LayerId(layer_id.to_owned()),
                reset: true,
            });

        if let Some(mut queue) = self
            .app
            .world_mut()
            .get_resource_mut::<navara_layer_event::LayerReloadQueue>()
        {
            // Dedup: several source updates can land within one teardown window
            // (e.g. dragging a source-level slider). Only one entity is ever torn
            // down, so replace any existing pending reload's description instead of
            // enqueuing a duplicate — otherwise `flush_layer_reloads` would re-add
            // the same layer once per queued entry. Keep the first-captured order.
            if let Some(existing) = queue
                .pending
                .iter_mut()
                .find(|reload| reload.layer_id == layer_id)
            {
                existing.desc = desc;
            } else {
                queue.pending.push(navara_layer_event::PendingReload {
                    layer_id: layer_id.to_owned(),
                    desc,
                    seen_alive: false,
                    order,
                    ecs_order,
                });
            }
        }
    }

    pub fn get_source_type(&self, source_id: &str) -> Option<&str> {
        let store = self.app.world().get_resource::<SourceStore>()?;
        Some(store.get(source_id)?.source_type())
    }

    pub fn get_source_description(&self, source_id: &str) -> Option<Source> {
        let store = self.app.world().get_resource::<SourceStore>()?;
        store.get(source_id).cloned()
    }

    pub fn has_data_requester(&mut self, bits: u64) -> bool {
        let entity = Entity::from_bits(bits);
        let world = self.app.world_mut();
        let mut query = world.query_filtered::<&DataRequester, Without<Deleted>>();

        query.get(world, entity).is_ok()
    }

    pub fn has_worker_task(&mut self, bits: u64) -> bool {
        let entity = Entity::from_bits(bits);
        let world = self.app.world_mut();
        let mut query = world
            .query_filtered::<&WorkerTaskMarker, (Without<Deleted>, Without<WorkerTaskCompleted>)>(
            );

        query.get(world, entity).is_ok()
    }

    pub fn get_martini(&mut self, martini_id: u64) -> Option<&MartiniComponent> {
        let martini_id = Entity::from_bits(martini_id);
        let world = self.app.world_mut();
        let mut query = world.query::<&MartiniComponent>();

        query.get(world, martini_id).ok()
    }

    pub fn get_tile(&mut self, handle: TileHandle) -> Option<&TerrainTile> {
        let world = self.app.world_mut();
        let qt = world.get_resource::<TerrainTileQuadtree>()?;

        qt.qt.get(handle)
    }

    pub fn calc_meters_per_texel(
        &mut self,
        tile_handle: TileHandle,
        texture_zoom: usize,
        texture_width: u32,
    ) -> Option<f32> {
        let world = self.app.world_mut();
        let qt = world.get_resource::<TerrainTileQuadtree>()?;
        let tile = qt.qt.get(tile_handle)?;

        // Delegate to pure function in navara_core
        Some(navara_core::calc_meters_per_texel(
            tile.coords.y,
            tile.coords.z,
            texture_zoom,
            texture_width,
            WGS84_64.a,
        ))
    }

    /// Buffer handle of the tile's loaded raw DEM bytes, the height data a
    /// descendant's upsample resamples from. `None` unless the DEM has landed.
    pub fn get_terrain_dem_bytes(
        &mut self,
        handle: TileHandle,
    ) -> Option<navara_buffer_store::Handle> {
        let world = self.app.world_mut();
        let qt = world.get_resource::<TerrainTileQuadtree>()?;
        let terrain_data = qt.qt.get(handle)?.terrain_data.as_ref()?;
        let requester = world.get::<DataRequester>(terrain_data.data_requester_entity_id()?)?;
        requester.is_succeeded().then_some(requester.handle)
    }

    /// Resolve the WebMercator texturized-vector tiles to drape on a terrain tile,
    /// flattened across clamp-to-ground vector layers for the wasm boundary. Gathers the
    /// terrain extent/scheme and the per-layer vector quadtrees from the ECS world, then
    /// delegates the N:M overlap + budget logic to
    /// [`resolve_vector_tile_states`](navara_vector_tile::resolve_vector_tile_states).
    pub fn get_vector_tiles(&mut self, handle: TileHandle) -> Vec<ResolvedVectorTileState> {
        let world = self.app.world_mut();

        // Terrain tile extent + scheme, copied out so the resource borrow ends before the
        // component queries below.
        let Some((terrain_extent, terrain_is_geographic)) = world
            .get_resource::<TerrainTileQuadtree>()
            .and_then(|qt| qt.qt.get(handle))
            .map(|tile| (tile.extent, tile.tiling_scheme.is_geographic()))
        else {
            return vec![];
        };

        // Snapshot (layer_id, quadtree entity), owned so the query borrow is released before
        // the resource/quadtree borrows below.
        let mut layer_refs: Vec<(String, Entity)> = {
            let mut layers = world.query::<&LayerResources>();
            layers
                .iter(world)
                .map(|r| (r.layer_id.clone(), r.quadtree))
                .collect()
        };

        // Sort by the layer's declaration order (`LayerDescStore`, same source as
        // `get_layer_index`) so the composite stacks vector layers like the raster path
        // (lower order = bottom, later = on top), instead of the arbitrary ECS query
        // iteration order the resolve would otherwise preserve.
        {
            let store = world.get_resource::<LayerDescStore>();
            layer_refs.sort_by_key(|(layer_id, _)| {
                store
                    .and_then(|s| s.get_order(layer_id).copied())
                    .unwrap_or(usize::MAX)
            });
        }

        let mut qts = world.query::<&VectorTileQuadtree>();
        let pairs: Vec<(String, &VectorTileQuadtree)> = layer_refs
            .into_iter()
            .filter_map(|(layer_id, quadtree)| {
                qts.get(world, quadtree).ok().map(|qt| (layer_id, qt))
            })
            .collect();

        resolve_vector_tile_states(terrain_extent, terrain_is_geographic, &pairs)
    }

    /// Monotonic counter that changes only when the vector-tile resolution could have
    /// changed (a traverse ran — readiness lives in the traverse now). The web side reads
    /// this once per frame and skips the per-terrain-tile `get_vector_tiles` calls while it
    /// is unchanged.
    pub fn vector_revision(&self) -> u32 {
        self.app
            .world()
            .get_resource::<VectorResolveRevision>()
            .map(|r| r.0)
            .unwrap_or(0)
    }

    /// Resolve the WebMercator raster tiles to bake into per-layer drape render targets
    /// for a terrain tile, flattened across the baked (non-hillshade, elevation
    /// heatmaps included) layers for the wasm boundary. Only Geographic terrain bakes —
    /// WebMercator terrain drapes 1:1 through the per-slot material path (and keeps the
    /// snapshot empty) — so this returns empty there. Reads the per-revision
    /// [`RasterBakeSnapshot`](navara_tile::raster::RasterBakeSnapshot) (sorted baked
    /// layers + loaded fragment set — this runs per visible terrain tile, so it must
    /// not rebuild them) and delegates the N:M overlap + per-layer budget logic to
    /// [`resolve_raster_tile_states`](navara_tile::raster::resolve_raster_tile_states).
    pub fn get_raster_tiles(&mut self, handle: TileHandle) -> Vec<ResolvedRasterTileState> {
        let world = self.app.world();

        let Some(snapshot) = world.get_resource::<navara_tile::raster::RasterBakeSnapshot>() else {
            return vec![];
        };
        if snapshot.layers.is_empty() {
            return vec![];
        }

        let Some((terrain_extent, terrain_is_geographic)) = world
            .get_resource::<TerrainTileQuadtree>()
            .and_then(|qt| qt.qt.get(handle))
            .map(|tile| (tile.extent, tile.tiling_scheme.is_geographic()))
        else {
            return vec![];
        };
        if !terrain_is_geographic {
            return vec![];
        }

        let Some(raster_qt) = world.get_resource::<RasterTileQuadtree>() else {
            return vec![];
        };

        navara_tile::raster::resolve_raster_tile_states(
            raster_qt,
            &terrain_extent,
            terrain_is_geographic,
            &snapshot.layers,
            &|e| snapshot.loaded.contains(&e),
        )
    }

    /// Monotonic counter that changes only when the raster drape resolution could have
    /// changed (a raster traverse ran — fragment loads and layer/terrain changes are
    /// inputs of its change gate). The web side reads this once per frame and skips the
    /// per-terrain-tile `get_raster_tiles` calls while it is unchanged.
    pub fn raster_revision(&self) -> u32 {
        self.app
            .world()
            .get_resource::<navara_tile::raster::RasterResolveRevision>()
            .map(|r| r.0)
            .unwrap_or(0)
    }

    pub fn get_tile_elevation_decoder(&mut self, handle: TileHandle) -> Option<ElevationDecoder> {
        let world = self.app.world_mut();
        let qt = world.get_resource::<TerrainTileQuadtree>()?;

        let tile = qt.qt.get(handle).unwrap();
        tile.terrain_data.as_ref()?.decoder().copied()
    }

    pub fn get_buffer_store(&self) -> Option<&BufferStore> {
        let world = self.app.world();
        world.get_resource::<BufferStore>()
    }

    pub fn get_buffer_store_mut(&mut self) -> Option<Mut<'_, BufferStore>> {
        let world = self.app.world_mut();
        world.get_resource_mut::<BufferStore>()
    }

    /// Take polygon geometry data from BufferStore via the `BatchedPolygonGeometry` component.
    /// Returns owned Vecs ready for WASM transfer, along with batch IDs and material.
    pub fn take_batched_polygon_geometry(
        &mut self,
        batched_feature_id: u64,
    ) -> Option<(TakenPolygonGeometry, GlobalBatchIds, PolygonMaterial)> {
        let entity = Entity::from_bits(batched_feature_id);
        let world = self.app.world_mut();
        // Read small component data (handles + CRS) and drop the entity borrow
        let (geom, batch_ids, material) = {
            let entity_ref = world.get_entity(entity).ok()?;
            let batch_ids = entity_ref.get::<GlobalBatchIds>()?.clone();
            let material = entity_ref.get::<PolygonMaterial>()?.clone();
            let geom = entity_ref.get::<BatchedPolygonGeometry>()?.clone();
            (geom, batch_ids, material)
        };
        let mut buf = world.get_resource_mut::<BufferStore>()?;
        let taken = geom.take_from_buf(&mut buf);
        Some((taken, batch_ids, material))
    }

    /// Take polyline geometry data from BufferStore via the `BatchedPolylineGeometry` component.
    /// Returns owned Vecs ready for WASM transfer, along with batch IDs and material.
    pub fn take_batched_polyline_geometry(
        &mut self,
        batched_feature_id: u64,
    ) -> Option<(TakenPolylineGeometry, GlobalBatchIds, PolylineMaterial)> {
        let entity = Entity::from_bits(batched_feature_id);
        let world = self.app.world_mut();
        let (geom, batch_ids, material) = {
            let entity_ref = world.get_entity(entity).ok()?;
            let batch_ids = entity_ref.get::<GlobalBatchIds>()?.clone();
            let material = entity_ref.get::<PolylineMaterial>()?.clone();
            let geom = entity_ref.get::<BatchedPolylineGeometry>()?.clone();
            (geom, batch_ids, material)
        };
        let mut buf = world.get_resource_mut::<BufferStore>()?;
        let taken = geom.take_from_buf(&mut buf);
        Some((taken, batch_ids, material))
    }

    /// Find the entity owning `global_batch_id`, the feature ordinal (the row
    /// index into the batch properties) of the picked instance, and the
    /// feature's canonical global batch id (Its first instance's id. The id
    /// the evaluator reports, so callers can correlate picks with styling).
    pub fn search_feature_entity_by_global_batch_id(
        &self,
        global_batch_id: &u32,
    ) -> Option<(Entity, usize, u32)> {
        let map = self.app.world().get_resource::<FeatureBatchIdMap>()?;

        map.map.iter().find_map(|(entity, batch_ids)| {
            self.get_buffer_u32(batch_ids.handle).and_then(|vec_ids| {
                vec_ids
                    .iter()
                    .position(|id| id == global_batch_id)
                    .map(|instance| {
                        // Multi-instance features (e.g. MultiPoint) share one
                        // property row across instances; resolve the instance
                        // position to the owning feature's ordinal and to the
                        // feature's first instance (canonical) id.
                        match batch_ids
                            .instance_feature_indices
                            .and_then(|handle| self.get_buffer_u32(handle))
                            .and_then(|indices| {
                                let feature = indices.get(instance).copied()?;
                                let first = indices.iter().position(|&f| f == feature)?;
                                let canonical_id = vec_ids.get(first).copied()?;
                                Some((feature as usize, canonical_id))
                            }) {
                            Some((feature_index, canonical_id)) => {
                                (*entity, feature_index, canonical_id)
                            }
                            None => (*entity, instance, *global_batch_id),
                        }
                    })
            })
        })
    }

    pub fn change_camera(
        &mut self,
        position: Option<Vec<FloatType>>,
        pitch: Option<FloatType>,
        heading: Option<FloatType>,
        roll: Option<FloatType>,
        distance: Option<FloatType>,
    ) {
        let pos = position.and_then(|v| (v.len() == 3).then(|| Vec3::new(v[0], v[1], v[2])));
        self.app.world_mut().write_message(CameraEvent::Change {
            position: pos,
            orientation: Some(CameraOrientation {
                pitch,
                heading,
                roll,
            }),
            distance,
        });
    }

    pub fn move_camera(&mut self, direction: CameraDirection, amount: FloatType) {
        self.app.world_mut().write_message(CameraEvent::Translate {
            direction: CamDirType::Standard(direction),
            amount,
        });
    }

    pub fn move_camera_with_direction(&mut self, direction: Vec<FloatType>, amount: FloatType) {
        if direction.len() != 3 {
            return;
        }
        self.app.world_mut().write_message(CameraEvent::Translate {
            direction: CamDirType::Custom(Vec3::new(direction[0], direction[1], direction[2])),
            amount,
        });
    }

    /// Starts a camera flight and returns its id. The flight's terminal
    /// record is delivered later as a `CameraFlightEnded` event carrying the
    /// same id.
    #[allow(clippy::too_many_arguments)]
    pub fn fly_to(
        &mut self,
        position: Option<Vec<FloatType>>,
        pitch: Option<FloatType>,
        heading: Option<FloatType>,
        roll: Option<FloatType>,
        duration: Option<FloatType>,
        max_height: Option<FloatType>,
        distance: Option<FloatType>,
        easing: Option<u8>,
    ) -> u32 {
        let id = self
            .app
            .world_mut()
            .get_resource_or_insert_with(FlightIdAllocator::default)
            .allocate();

        let pos = position.and_then(|v| (v.len() == 3).then(|| Vec3::new(v[0], v[1], v[2])));
        self.app.world_mut().write_message(CameraEvent::FlyTo {
            position: pos,
            orientation: Some(CameraOrientation {
                pitch,
                heading,
                roll,
            }),
            duration,
            max_height,
            distance,
            easing: easing.and_then(|v| FlyToEasing::try_from(v).ok()),
            id,
        });

        id
    }

    pub fn look_at(&mut self, target: Vec<FloatType>, offset: Vec<FloatType>) {
        self.app.world_mut().write_message(CameraEvent::LookAt {
            target: Vec3::new(target[0], target[1], target[2]),
            offset: Vec3::new(offset[0], offset[1], offset[2]),
        });
    }

    pub fn camera_follow(
        &mut self,
        enabled: bool,
        target: Option<Vec<FloatType>>,
        offset: Option<Vec<FloatType>>,
    ) {
        let target_vec3 = target.and_then(|v| (v.len() == 3).then(|| Vec3::new(v[0], v[1], v[2])));
        let offset_vec3 = offset.and_then(|v| (v.len() == 3).then(|| Vec3::new(v[0], v[1], v[2])));

        self.app.world_mut().write_message(CameraEvent::Follow {
            enabled,
            target: target_vec3,
            offset: offset_vec3,
        });
    }

    pub fn camera_free_look(&mut self, enabled: bool, target: Option<Vec<FloatType>>) {
        let target_vec3 = target.and_then(|v| (v.len() == 3).then(|| Vec3::new(v[0], v[1], v[2])));

        self.app
            .world_mut()
            .write_message(CameraEvent::FollowFreeLook {
                enabled,
                target: target_vec3,
            });
    }

    pub fn get_camera_status(&mut self) -> Option<CameraStatus> {
        let world = self.app.world_mut();
        let mut query = world.query_filtered::<&CameraStatus, With<CameraMarker>>();

        if let Some(cam_st) = query.iter(world).next() {
            return Some(cam_st.clone());
        }

        None
    }

    pub fn get_camera_position_lle(&mut self) -> Option<Vec<FloatType>> {
        let world = self.app.world_mut();
        let mut query = world.query_filtered::<&Transform, With<CameraMarker>>();

        if let Some(transform) = query.iter(world).next() {
            let lle = CRS::Geocentric.to_lle(WGS84_64, transform.translation, 0.0);
            let start = lle.deg();
            return Some(vec![start.lng.val(), start.lat.val(), start.height.val()]);
        }

        None
    }

    pub fn get_camera_position_ecef(&mut self) -> Option<Vec<FloatType>> {
        let world = self.app.world_mut();
        let mut query = world.query_filtered::<&Transform, With<CameraMarker>>();

        if let Some(transform) = query.iter(world).next() {
            return Some(vec![
                transform.translation.x,
                transform.translation.y,
                transform.translation.z,
            ]);
        }

        None
    }

    pub fn get_camera_orientation(&mut self) -> Option<(FloatType, FloatType, FloatType)> {
        let world = self.app.world_mut();
        let mut query = world.query_filtered::<&Transform, With<CameraMarker>>();

        if let Some(transform) = query.iter(world).next() {
            return Some((
                get_heading(transform),
                get_pitch(transform),
                get_roll(transform),
            ));
        }

        None
    }

    /// Vertical field of view in radians as set via `set_frustum`.
    pub fn get_camera_fov(&mut self) -> Option<FloatType> {
        let world = self.app.world_mut();
        let mut query = world.query_filtered::<&CameraFrustum, With<CameraMarker>>();

        if let Some(frustum) = query.iter(world).next() {
            return Some(frustum.fov);
        }

        None
    }

    /// Effective Web Mercator zoom level the camera is viewing the surface at,
    /// derived from the camera's ellipsoid height (not terrain), FOV and
    /// viewport (see [`navara_core::camera_zoom_level`]).
    pub fn get_zoom_level(&mut self) -> Option<FloatType> {
        // Camera altitude (m) and latitude (rad).
        let lle = {
            let world = self.app.world_mut();
            let mut query = world.query_filtered::<&Transform, With<CameraMarker>>();
            let transform = query.iter(world).next()?;
            CRS::Geocentric.to_lle(WGS84_64, transform.translation, 0.0)
        };
        // Vertical field of view (rad).
        let fov_y = {
            let world = self.app.world_mut();
            let mut query = world.query_filtered::<&CameraFrustum, With<CameraMarker>>();
            query.iter(world).next()?.fov
        };
        // Viewport height in CSS px (matches the 256px tile model).
        let viewport_height = self.app.world_mut().get_resource::<Window>()?.raw_height();

        let height = lle.height.val();
        let lat = lle.lat.val();
        // Guard the inputs: a default/unset frustum has `fov_y == 0` (→ tan(0)=0
        // → division by zero → ±inf), and a non-finite latitude would poison the
        // math. The `is_finite` checks also reject NaN/inf. Bail so a non-finite
        // zoom never crosses the WASM boundary to JS.
        if height <= 0.0
            || viewport_height <= 0.0
            || !fov_y.is_finite()
            || fov_y <= 0.0
            || !lat.is_finite()
        {
            return None;
        }
        let zoom = camera_zoom_level(height, fov_y, viewport_height, lat, WGS84_A_64);
        zoom.is_finite().then_some(zoom)
    }

    pub fn rotate_around_axis(&mut self, axis: Option<Vec<FloatType>>, angle: FloatType) {
        let axis = axis.and_then(|v| (v.len() == 3).then(|| Vec3::new(v[0], v[1], v[2])));
        self.app
            .world_mut()
            .write_message(CameraEvent::RotateAroundAxis { axis, angle });
    }

    pub fn sample_terrain_height(&mut self, lle: LLE<FloatType, Radians>) -> Option<FloatType> {
        let world = self.app.world_mut();

        let _ = world.get_resource::<TerrainTileQuadtree>()?;
        let _ = world.get_resource::<BufferStore>()?;

        world.resource_scope(|world, mut qt: Mut<TerrainTileQuadtree>| {
            world.resource_scope(|world, mut buf: Mut<BufferStore>| {
                let mut state: SystemState<TileTerrainDataRequesterQuery> = SystemState::new(world);
                let query = state.get(world).ok()?;

                compute_terrain_height_at_point(
                    &mut qt,
                    &mut buf,
                    &query,
                    &LngLat::new(lle.lat.val(), lle.lng.val()),
                )
            })
        })
    }

    pub fn add_terrain_height_observer(&mut self, lle: LLE<FloatType, Radians>) -> u64 {
        let world = self.app.world_mut();

        let e_id = world
            .commands()
            .spawn(TerrainHeightObserver { lle, height: None })
            .id();

        e_id.to_bits()
    }

    pub fn remove_terrain_height_observer(&mut self, bits: u64) {
        let world = self.app.world_mut();
        let entity = Entity::from_bits(bits);
        if world.get_entity(entity).is_ok() {
            world.commands().entity(entity).despawn();
        }
    }

    pub fn set_frustum(
        &mut self,
        fov: Option<FloatType>,
        near: Option<FloatType>,
        far: Option<FloatType>,
    ) {
        self.app
            .world_mut()
            .write_message(FrustumEvent { fov, near, far });
    }

    pub fn set_camera_control(&mut self, event: CameraControlUpdateEvent) {
        self.app.world_mut().write_message(event);
    }

    pub fn set_terrain_pick_distance(&mut self, distance: Option<f64>) {
        let world = self.app.world_mut();
        let mut query = world.query::<(&CameraMarker, &mut CameraController)>();
        for (_, mut controller) in query.iter_mut(world) {
            controller.terrain_hit_distance = distance;
        }
    }

    pub fn get_globe(&self) -> Option<&Globe> {
        self.app.world().get_resource::<Globe>()
    }

    pub fn get_globe_mut(&mut self) -> Option<Mut<'_, Globe>> {
        self.app.world_mut().get_resource_mut::<Globe>()
    }

    // === Globe definition ===

    pub fn set_globe_transparent(&mut self, value: bool) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.transparent = value;
        }
    }

    pub fn set_globe_max_sse(&mut self, value: f32) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.max_sse = value;
        }
    }

    pub fn set_globe_segments(&mut self, value: usize) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.segments = value;
        }
    }

    pub fn set_globe_color(&mut self, value: u32) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.color = value;
        }
    }

    pub fn set_globe_hide_underground(&mut self, value: bool) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.hide_underground = value;
        }
    }

    pub fn set_globe_use_normal(&mut self, value: bool) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.use_normal = value;
        }
    }

    pub fn set_globe_opacity(&mut self, value: f32) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.opacity = value;
        }
    }

    pub fn set_globe_wireframe(&mut self, value: bool) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.wireframe = value;
        }
    }

    pub fn set_globe_elevation_colormap(&mut self, value: Vec<f32>) {
        if let Some(mut globe) = self.get_globe_mut() {
            globe.elevation_colormap = value;
        }
    }

    // === Globe definition ===
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
