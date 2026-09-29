pub mod feature;
mod feature_event;
pub mod worker;

use feature_event::{
    RenderableFeatureAddedEvent, RenderableFeatureChangedEvent, RenderableFeatureRemovedEvent,
};

use navara_tile_component::TileHandle;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use worker::WorkerTaskDelegatedEvent;

use navara_wasm_types::{
    CameraFlightEndedEvent, CameraFrustum, Globe, LLE, RasterTileInternalMaterial, Transform,
};

// Fields are private on purpose: exposing them via `getter_with_clone` would
// deep-clone every Vec (and each element) on each JS read. JS consumes each
// stack exactly once per frame through the move-out `take_*` accessors below.
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct Events {
    camera_transform_updated: Option<Transform>,
    camera_frustum_updated: Option<CameraFrustum>,
    camera_flight_ended: Vec<CameraFlightEndedEvent>,
    object_transform_updated: Vec<ObjectTransformEvent>,
    mesh_removed: Vec<EntityEvent>,
    mesh_added: Vec<MeshAdded>,
    mesh_updated: Vec<MeshChanged>,
    mesh_geometry_replaced: Vec<MeshGeometryReplaced>,
    data_requested: Vec<DataRequestEvent>,
    data_requester_removed: Vec<DataRequesterRemovedEvent>,
    texture_fragment_requested: Vec<TextureFragmentRequestedEvent>,
    texture_fragment_removed: Vec<EntityEvent>,
    worker_task_delegated: Vec<WorkerTaskDelegatedEvent>,
    worker_task_removed: Vec<EntityEvent>,
    renderable_feature_added: Vec<RenderableFeatureAddedEvent>,
    renderable_feature_changed: Vec<RenderableFeatureChangedEvent>,
    renderable_feature_removed: Vec<RenderableFeatureRemovedEvent>,
    update_sample_terrain_height: Vec<TerrainHeightUpdatedEvent>,
    hillshade_backfilled: Vec<HillshadeBackfilledEvent>,
    hillshade_canceled: Vec<EntityEvent>,
}

// Move-out accessors: each hands the stack's ownership to JS (elements are
// boxed once for their JS wrappers, nothing is cloned). Method names must be
// `take_<stack key>` — `EventManager.pushEvents` derives the method name from
// its stack keys.
#[wasm_bindgen]
impl Events {
    pub fn take_camera_transform_updated(&mut self) -> Option<Transform> {
        self.camera_transform_updated.take()
    }
    pub fn take_camera_frustum_updated(&mut self) -> Option<CameraFrustum> {
        self.camera_frustum_updated.take()
    }
    pub fn take_camera_flight_ended(&mut self) -> Vec<CameraFlightEndedEvent> {
        std::mem::take(&mut self.camera_flight_ended)
    }
    pub fn take_object_transform_updated(&mut self) -> Vec<ObjectTransformEvent> {
        std::mem::take(&mut self.object_transform_updated)
    }
    pub fn take_mesh_removed(&mut self) -> Vec<EntityEvent> {
        std::mem::take(&mut self.mesh_removed)
    }
    pub fn take_mesh_added(&mut self) -> Vec<MeshAdded> {
        std::mem::take(&mut self.mesh_added)
    }
    pub fn take_mesh_updated(&mut self) -> Vec<MeshChanged> {
        std::mem::take(&mut self.mesh_updated)
    }
    pub fn take_mesh_geometry_replaced(&mut self) -> Vec<MeshGeometryReplaced> {
        std::mem::take(&mut self.mesh_geometry_replaced)
    }
    pub fn take_data_requested(&mut self) -> Vec<DataRequestEvent> {
        std::mem::take(&mut self.data_requested)
    }
    pub fn take_data_requester_removed(&mut self) -> Vec<DataRequesterRemovedEvent> {
        std::mem::take(&mut self.data_requester_removed)
    }
    pub fn take_texture_fragment_requested(&mut self) -> Vec<TextureFragmentRequestedEvent> {
        std::mem::take(&mut self.texture_fragment_requested)
    }
    pub fn take_texture_fragment_removed(&mut self) -> Vec<EntityEvent> {
        std::mem::take(&mut self.texture_fragment_removed)
    }
    pub fn take_worker_task_delegated(&mut self) -> Vec<WorkerTaskDelegatedEvent> {
        std::mem::take(&mut self.worker_task_delegated)
    }
    pub fn take_worker_task_removed(&mut self) -> Vec<EntityEvent> {
        std::mem::take(&mut self.worker_task_removed)
    }
    pub fn take_renderable_feature_added(&mut self) -> Vec<RenderableFeatureAddedEvent> {
        std::mem::take(&mut self.renderable_feature_added)
    }
    pub fn take_renderable_feature_changed(&mut self) -> Vec<RenderableFeatureChangedEvent> {
        std::mem::take(&mut self.renderable_feature_changed)
    }
    pub fn take_renderable_feature_removed(&mut self) -> Vec<RenderableFeatureRemovedEvent> {
        std::mem::take(&mut self.renderable_feature_removed)
    }
    pub fn take_update_sample_terrain_height(&mut self) -> Vec<TerrainHeightUpdatedEvent> {
        std::mem::take(&mut self.update_sample_terrain_height)
    }
    pub fn take_hillshade_backfilled(&mut self) -> Vec<HillshadeBackfilledEvent> {
        std::mem::take(&mut self.hillshade_backfilled)
    }
    pub fn take_hillshade_canceled(&mut self) -> Vec<EntityEvent> {
        std::mem::take(&mut self.hillshade_canceled)
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct ObjectTransformEvent {
    pub ind: u32,
    pub r#gen: u32,
    pub transform: Transform,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct MeshAdded {
    pub ind: u32,
    pub r#gen: u32,
    pub tile_handle: TileHandle,
    pub ready_parent_tile_handle: Option<TileHandle>,
    pub mesh: Mesh,
    #[wasm_bindgen(getter_with_clone)]
    pub material: RasterTileInternalMaterial,
    pub transform: Transform,
    #[wasm_bindgen(getter_with_clone)]
    pub globe: Globe,
}

/// A live tile mesh whose geometry buffers were rewritten in place (see
/// `EventStore::mesh_geometry_replaced`): only the geometry changes.
#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct MeshGeometryReplaced {
    pub ind: u32,
    pub r#gen: u32,
    pub mesh: Mesh,
}

impl<'a> From<navara_event_store::ComponentEvent<&'a navara_mesh::Mesh>> for MeshGeometryReplaced {
    fn from(ev: navara_event_store::ComponentEvent<&'a navara_mesh::Mesh>) -> Self {
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            mesh: ev.comp.into(),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct MeshChanged {
    pub ind: u32,
    pub r#gen: u32,
    pub ready_parent_tile_handle: Option<TileHandle>,
    pub mesh: Mesh,
    #[wasm_bindgen(getter_with_clone)]
    pub material: RasterTileInternalMaterial,
    #[wasm_bindgen(getter_with_clone)]
    pub globe: Globe,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Mesh {
    pub vertices: i32, // handle
    pub uvs: i32,      // handle
    pub indices: i32,  // handle
    pub active: bool,
    /// Quadrant bitmask to draw (`0` = whole tile); see `navara_mesh::Mesh`.
    pub fill_quadrants: u8,
    pub render_order: i32,
    pub aabb: navara_wasm_types::Aabb,
    /// Per-vertex normals handle (terrain only).
    pub normals: Option<i32>,
    /// Skirt vertices handle (separate from main geometry for shadow/normal handling).
    pub skirt_vertices: Option<i32>,
    /// Skirt UVs handle.
    pub skirt_uvs: Option<i32>,
    /// Skirt indices handle.
    pub skirt_indices: Option<i32>,
    /// Skirt per-vertex normals handle.
    pub skirt_normals: Option<i32>,
    /// Watermask handle (1 byte uniform or 65536 byte grid).
    pub watermask: Option<i32>,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct DataRequestEvent {
    // Entity
    pub ind: u32,
    pub r#gen: u32,
    pub bits: u64,

    /// Fetch urgency: 0 is the most urgent (see `Priority::rank`). The web
    /// side keeps its pending fetch queue sorted by this. Requests without an
    /// ECS `Priority` (tileset / PMTiles bootstrap reads, 3D Tiles content)
    /// rank as `Extreme`, matching the engine sender that dispatches them
    /// ahead of the prioritized ones.
    pub priority: u8,

    pub handle: i32, // handle
    #[wasm_bindgen(getter_with_clone)]
    pub extension: String,
    #[wasm_bindgen(getter_with_clone)]
    pub url: String,
    /// Byte-range offset for a partial fetch. `None` for a full-resource GET.
    pub offset: Option<u64>,
    /// Byte-range length in bytes. Set together with `offset`.
    pub length: Option<u64>,
    /// Quantized-mesh only: server should return the oct-encoded normals extension.
    #[wasm_bindgen(js_name = requestVertexNormals)]
    pub request_vertex_normals: bool,
    /// Quantized-mesh only: server should return the watermask extension.
    #[wasm_bindgen(js_name = requestWaterMask)]
    pub request_water_mask: bool,
    /// Quantized-mesh only: bearer token sent as the `Authorization` header
    /// for `.terrain` requests. `None` means no Authorization header is added.
    #[wasm_bindgen(getter_with_clone)]
    pub token: Option<String>,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct DataRequesterRemovedEvent {
    // Entity
    pub ind: u32,
    pub r#gen: u32,
    pub bits: u64,

    pub handle: i32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub enum TextureFragmentStatus {
    Success,
    Fail,
    Pending,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TextureFragmentRequestedEvent {
    pub ind: u32,
    pub r#gen: u32,
    pub bits: u64,
    #[wasm_bindgen(getter_with_clone)]
    pub url: String,
    #[wasm_bindgen(getter_with_clone)]
    pub status: TextureFragmentStatus,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct TerrainHeightUpdatedEvent {
    pub ind: u32,
    pub r#gen: u32,
    pub bits: u64,
    pub lle: LLE,
    pub height: Option<f64>,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct EntityEvent {
    pub ind: u32,
    pub r#gen: u32,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct HillshadeBackfilledEvent {
    pub ind: u32,
    pub r#gen: u32,
    pub tile_handle: TileHandle, // Handle of the tile that owns this texture

    #[wasm_bindgen(readonly)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edge_data_handle: Option<u32>, // Edge data handle (one edge), None when no edge update

    #[wasm_bindgen(readonly)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_handle: Option<u32>, // Original DEM data (256×256 RGBA), None when not provided

    #[wasm_bindgen(readonly)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_entity_ind: Option<u32>, // Target entity ind (DataRequester), None when not applicable

    #[wasm_bindgen(readonly)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_entity_gen: Option<u32>, // Target entity gen, None when not applicable

    pub edge_direction: u8, // 0=Left, 1=Right, 2=Top, 3=Bottom, 255=N/A
}

impl From<navara_event::Events<'_>> for Events {
    fn from(ev: navara_event::Events) -> Self {
        Self {
            camera_transform_updated: ev.camera_transform_updated.map(|ev| ev.into()),
            camera_frustum_updated: ev.camera_frustum_updated.map(|ev| ev.into()),
            camera_flight_ended: ev
                .camera_flight_ended
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            object_transform_updated: ev
                .object_transform_updated
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            mesh_removed: ev.mesh_removed.into_iter().map(|ev| ev.into()).collect(),
            mesh_added: ev.mesh_added.into_iter().map(|ev| ev.into()).collect(),
            mesh_updated: ev.mesh_updated.into_iter().map(|ev| ev.into()).collect(),
            mesh_geometry_replaced: ev
                .mesh_geometry_replaced
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            data_requested: ev.data_requested.into_iter().map(|ev| ev.into()).collect(),
            data_requester_removed: ev
                .data_requester_removed
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            texture_fragment_requested: ev
                .texture_fragment_reqested
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            texture_fragment_removed: ev
                .texture_fragment_removed
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            worker_task_delegated: ev
                .worker_task_delegated
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            worker_task_removed: ev
                .worker_task_removed
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            renderable_feature_added: ev
                .renderable_feature_added
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            renderable_feature_changed: ev
                .renderable_feature_changed
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            renderable_feature_removed: ev
                .renderable_feature_removed
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            update_sample_terrain_height: ev
                .update_sample_terrain_height
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            hillshade_backfilled: ev
                .hillshade_backfilled
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
            hillshade_canceled: ev
                .hillshade_canceled
                .into_iter()
                .map(|ev| ev.into())
                .collect(),
        }
    }
}

impl From<navara_event_store::EntityEvent> for EntityEvent {
    fn from(ev: navara_event_store::EntityEvent) -> Self {
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
        }
    }
}

impl<'a>
    From<
        navara_event_store::ReconstructableComponentEvent<
            &'a navara_tile_component::TerrainHeightObserver,
        >,
    > for TerrainHeightUpdatedEvent
{
    fn from(
        ev: navara_event_store::ReconstructableComponentEvent<
            &'a navara_tile_component::TerrainHeightObserver,
        >,
    ) -> Self {
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            bits: ev.bits,
            lle: ev.comp.lle.into(),
            height: ev.comp.height,
        }
    }
}

impl<'a> From<navara_event_store::ComponentEvent<&'a navara_math::Transform>>
    for ObjectTransformEvent
{
    fn from(ev: navara_event_store::ComponentEvent<&'a navara_math::Transform>) -> Self {
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            transform: ev.comp.into(),
        }
    }
}

impl
    From<
        navara_event_store::ComponentEventWithResource<
            (
                &navara_tile_component::TileMeshMarker,
                &navara_mesh::Mesh,
                &navara_material::RasterTileInternalMaterial,
                &navara_math::Transform,
            ),
            &navara_globe::Globe,
        >,
    > for MeshAdded
{
    fn from(
        ev: navara_event_store::ComponentEventWithResource<
            (
                &navara_tile_component::TileMeshMarker,
                &navara_mesh::Mesh,
                &navara_material::RasterTileInternalMaterial,
                &navara_math::Transform,
            ),
            &navara_globe::Globe,
        >,
    ) -> Self {
        Self {
            ind: ev.comp.ind,
            r#gen: ev.comp.r#gen,
            tile_handle: ev.comp.comp.0.handle,
            ready_parent_tile_handle: ev.comp.comp.0.ready_parent_tile_handle,
            mesh: ev.comp.comp.1.into(),
            material: ev.comp.comp.2.into(),
            transform: ev.comp.comp.3.into(),
            globe: ev.resource.into(),
        }
    }
}

impl
    From<
        navara_event_store::ComponentEventWithResource<
            (
                &navara_tile_component::TileMeshMarker,
                &navara_mesh::Mesh,
                &navara_material::RasterTileInternalMaterial,
            ),
            &navara_globe::Globe,
        >,
    > for MeshChanged
{
    fn from(
        ev: navara_event_store::ComponentEventWithResource<
            (
                &navara_tile_component::TileMeshMarker,
                &navara_mesh::Mesh,
                &navara_material::RasterTileInternalMaterial,
            ),
            &navara_globe::Globe,
        >,
    ) -> Self {
        Self {
            ind: ev.comp.ind,
            r#gen: ev.comp.r#gen,
            ready_parent_tile_handle: ev.comp.comp.0.ready_parent_tile_handle,
            mesh: ev.comp.comp.1.into(),
            material: ev.comp.comp.2.into(),
            globe: ev.resource.into(),
        }
    }
}

impl<'a> From<&'a navara_mesh::Mesh> for Mesh {
    fn from(m: &'a navara_mesh::Mesh) -> Self {
        Self {
            vertices: m.vertices,
            uvs: m.uvs,
            indices: m.indices,
            active: m.active,
            fill_quadrants: m.fill_quadrants,
            render_order: m.render_order,
            aabb: m.aabb.clone().into(),
            normals: m.normals,
            skirt_vertices: m.skirt_vertices,
            skirt_uvs: m.skirt_uvs,
            skirt_indices: m.skirt_indices,
            skirt_normals: m.skirt_normals,
            watermask: m.watermask,
        }
    }
}

impl<'a>
    From<
        navara_event_store::ReconstructableComponentEvent<(
            &'a navara_data_requester::DataRequester,
            Option<&'a navara_component::Priority>,
        )>,
    > for DataRequestEvent
{
    fn from(
        ev: navara_event_store::ReconstructableComponentEvent<(
            &'a navara_data_requester::DataRequester,
            Option<&'a navara_component::Priority>,
        )>,
    ) -> Self {
        let (req, priority) = ev.comp;
        let (offset, length) = match req.byte_range {
            Some((offset, length)) => (Some(offset), Some(length)),
            None => (None, None),
        };
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            bits: ev.bits,
            priority: priority.map_or(navara_component::Priority::Extreme.rank(), |p| p.rank()),
            handle: req.handle,
            extension: req.extension.to_string(),
            url: req.url.clone(),
            offset,
            length,
            request_vertex_normals: req.request_vertex_normals,
            request_water_mask: req.request_water_mask,
            token: req.token.clone(),
        }
    }
}

impl<'a>
    From<
        navara_event_store::ReconstructableComponentEvent<&'a navara_data_requester::DataRequester>,
    > for DataRequesterRemovedEvent
{
    fn from(
        ev: navara_event_store::ReconstructableComponentEvent<
            &'a navara_data_requester::DataRequester,
        >,
    ) -> Self {
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            bits: ev.bits,
            handle: ev.comp.handle,
        }
    }
}

impl<'a>
    From<
        navara_event_store::ReconstructableComponentEvent<
            &'a navara_texture_fragment::TextureFragment,
        >,
    > for TextureFragmentRequestedEvent
{
    fn from(
        ev: navara_event_store::ReconstructableComponentEvent<
            &'a navara_texture_fragment::TextureFragment,
        >,
    ) -> Self {
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            bits: ev.bits,
            url: ev.comp.url.clone(),
            status: ev.comp.status.clone().into(),
        }
    }
}

impl From<TextureFragmentStatus> for navara_texture_fragment::TextureFragmentStatus {
    fn from(value: TextureFragmentStatus) -> Self {
        match value {
            TextureFragmentStatus::Success => {
                navara_texture_fragment::TextureFragmentStatus::Success
            }
            TextureFragmentStatus::Fail => navara_texture_fragment::TextureFragmentStatus::Fail,
            TextureFragmentStatus::Pending => {
                navara_texture_fragment::TextureFragmentStatus::Pending
            }
        }
    }
}

impl From<navara_texture_fragment::TextureFragmentStatus> for TextureFragmentStatus {
    fn from(value: navara_texture_fragment::TextureFragmentStatus) -> Self {
        match value {
            navara_texture_fragment::TextureFragmentStatus::Success => {
                TextureFragmentStatus::Success
            }
            navara_texture_fragment::TextureFragmentStatus::Fail => TextureFragmentStatus::Fail,
            navara_texture_fragment::TextureFragmentStatus::Pending => {
                TextureFragmentStatus::Pending
            }
        }
    }
}

impl<'a>
    From<
        navara_event_store::ReconstructableComponentEvent<
            &'a navara_tile_component::HillshadeBackfillEventData,
        >,
    > for HillshadeBackfilledEvent
{
    fn from(
        ev: navara_event_store::ReconstructableComponentEvent<
            &'a navara_tile_component::HillshadeBackfillEventData,
        >,
    ) -> Self {
        let (target_ind, target_gen) = ev
            .comp
            .target_entity
            .map(|e| (Some(e.index().index()), Some(e.generation().to_bits())))
            .unwrap_or((None, None));
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            tile_handle: ev.comp.tile_handle,
            edge_data_handle: if ev.comp.edge_data_handle >= 0 {
                Some(ev.comp.edge_data_handle as u32)
            } else {
                None
            },
            original_handle: ev.comp.original_handle.map(|h| h as u32),
            target_entity_ind: target_ind,
            target_entity_gen: target_gen,
            edge_direction: ev.comp.edge_direction,
        }
    }
}
