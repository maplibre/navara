#![doc = include_str!("../README.md")]
mod attribute;
mod camera;
mod entity;
mod event;
mod geometry;
mod input;
mod property_value;
mod raster_tile;
mod source_types;
mod types;
mod vector_tile;

use entity::ReconstructableEntity;
use feature::{
    ReturnedTransferablePolygonBatchedFeature, ReturnedTransferablePolylineBatchedFeature,
};
use navara_buffer_store::Handle;
use navara_ecs::{App, BatchProperties};
use navara_input::Key;
use navara_math::FloatType;
use navara_tile_component::TileHandle;
use navara_wasm_utils::set_panic_hook;
use polygon::TransferablePolygonBatchedFeature;
use polyline::TransferablePolylineBatchedFeature;
use rand::RngExt;
use wasm_bindgen::prelude::*;

pub use camera::*;
pub use event::*;
pub use input::*;
pub use navara_wasm_transferable::*;
pub use navara_wasm_types::*;
pub use raster_tile::*;
pub use source_types::*;
pub use types::*;
pub use vector_tile::*;
use worker::DelegatedWorkerTasksResult;

use crate::property_value::JsPropertyValue;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen(getter_with_clone)]
pub struct Core {
    pub id: String,
    app: App,
}

/// Engine memory usage snapshot for diagnostics. Byte counts are `f64`
/// because JS has no u64.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct MemoryStats {
    #[wasm_bindgen(js_name = bufferTotalBytes, readonly)]
    pub buffer_total_bytes: f64,
    #[wasm_bindgen(js_name = externalBufferBytes, readonly)]
    pub external_buffer_bytes: f64,
    #[wasm_bindgen(js_name = bufferCount, readonly)]
    pub buffer_count: u32,
    #[wasm_bindgen(js_name = gpuBytesEst, readonly)]
    pub gpu_bytes_est: f64,
    #[wasm_bindgen(js_name = externalCpuBytes, readonly)]
    pub external_cpu_bytes: f64,
    #[wasm_bindgen(js_name = reservedBytes, readonly)]
    pub reserved_bytes: f64,
    #[wasm_bindgen(js_name = fixedGpuBytes, readonly)]
    pub fixed_gpu_bytes: f64,
    #[wasm_bindgen(js_name = budgetBytes, readonly)]
    pub budget_bytes: Option<f64>,
    #[wasm_bindgen(js_name = evictedCount, readonly)]
    pub evicted_count: f64,
    #[wasm_bindgen(js_name = sseMultiplier, readonly)]
    pub sse_multiplier: f32,
    #[wasm_bindgen(js_name = retainedVector, readonly)]
    pub retained_vector: u32,
    #[wasm_bindgen(js_name = retainedTerrain, readonly)]
    pub retained_terrain: u32,
    #[wasm_bindgen(js_name = retainedRaster, readonly)]
    pub retained_raster: u32,
    #[wasm_bindgen(js_name = retainedTiles3d, readonly)]
    pub retained_tiles3d: u32,
}

/// Dynamic screen-space-error settings (CesiumJS `dynamicScreenSpaceError`
/// equivalent): tilted, street-level horizon views tolerate a larger error
/// for far tiles. Zero effect looking straight down; fades out as the camera
/// climbs past `maxHeight` meters. Only affects tile LOD selection.
///
/// The TS-side `DynamicSseSettings` plain-object type is derived from this
/// class (`NormalizeWASMClass`), so this is the single source of the shape.
// Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTileset.js#L433-L521
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct DynamicSse {
    pub enabled: bool,
    /// Distance scale of the relaxation ramp before tilt/height scaling.
    pub density: f64,
    /// Maximum SSE relaxation (in pixels) at full tilt and saturation for a
    /// layer with the reference max SSE of 16 (the CesiumJS 3D Tiles default);
    /// each layer scales it by its own max SSE, so terrain and imagery
    /// (max SSE 2) relax by at most `sseFactor / 8` pixels.
    #[wasm_bindgen(js_name = sseFactor)]
    pub sse_factor: f64,
    /// Fraction of the height band below which the effect is at full strength.
    #[wasm_bindgen(js_name = heightFalloff)]
    pub height_falloff: f64,
    /// Camera height band (meters above the ellipsoid) the effect fades across.
    #[wasm_bindgen(js_name = minHeight)]
    pub min_height: f64,
    #[wasm_bindgen(js_name = maxHeight)]
    pub max_height: f64,
}

#[wasm_bindgen]
impl DynamicSse {
    #[wasm_bindgen(constructor)]
    pub fn new(
        enabled: bool,
        density: f64,
        sse_factor: f64,
        height_falloff: f64,
        min_height: f64,
        max_height: f64,
    ) -> Self {
        Self {
            enabled,
            density,
            sse_factor,
            height_falloff,
            min_height,
            max_height,
        }
    }
}

#[wasm_bindgen]
impl Core {
    #[wasm_bindgen(constructor)]
    pub fn new(id: String) -> Self {
        Self {
            id,
            app: App::new(),
        }
    }

    pub fn start(&mut self) {
        // debug
        self.app
            .trigger_event(navara_input::Input::Keyboard(navara_input::KeyboardInput {
                logical_key: Key::Character("a".into()),
                key_code: navara_input::KeyCode::KeyA,
                state: navara_input::ButtonState::Pressed,
            }));
    }

    pub fn update(&mut self, updated_at: f64) {
        self.app.update(updated_at);
    }

    #[wasm_bindgen(js_name = readEvents)]
    pub fn read_events(&mut self) -> Option<Events> {
        self.app.read_events().map(|ev| ev.into())
    }

    pub fn input(&mut self, input: JsValue) {
        let Some(input) = Input::from(input) else {
            return;
        };

        if matches!(
            input.r#type,
            InputType::MouseDown | InputType::Wheel | InputType::TouchStart
        ) {
            self.app.set_terrain_pick_distance(input.terrain_distance);
        }

        // Re-anchor the cursor position on mousedown: while the window is
        // unfocused or hidden no mousemove reaches the page, so the first drag
        // delta would otherwise be computed against a stale position.
        if input.r#type == InputType::MouseDown
            && let (Some(x), Some(y)) = (input.x, input.y)
        {
            self.app.trigger_event(navara_input::Input::MouseAnchor(
                navara_input::MouseMoveInput { x, y },
            ));
        }

        let Some(input) = input.into_ecs_input() else {
            return;
        };

        self.app.trigger_event(input);
    }

    // The `getBuffer*` getters return zero-copy VIEWS into wasm linear memory
    // (see `view_*` in navara_wasm_types): the caller must consume the array
    // immediately and `.slice()` it if it needs to retain the data. Consecutive
    // `getBuffer*` calls do not allocate wasm memory, so earlier views stay
    // valid; any other wasm call may grow memory and detach them.
    #[wasm_bindgen(js_name = getBufferU8)]
    pub fn get_buffer_u8(&self, handle: i32) -> Option<js_sys::Uint8Array> {
        let buf = self.app.get_buffer_u8(handle)?;

        Some(view_u8_array(buf))
    }

    #[wasm_bindgen(js_name = getBufferU32)]
    pub fn get_buffer_u32(&self, handle: i32) -> Option<js_sys::Uint32Array> {
        let buf = self.app.get_buffer_u32(handle)?;

        Some(view_u32_array(buf))
    }

    #[wasm_bindgen(js_name = getBufferF32)]
    pub fn get_buffer_f32(&self, handle: i32) -> Option<js_sys::Float32Array> {
        let buf = self.app.get_buffer_f32(handle)?;

        Some(view_f32_array(buf))
    }

    #[wasm_bindgen(js_name = getBufferF64)]
    pub fn get_buffer_f64(&self, handle: i32) -> Option<js_sys::Float64Array> {
        let buf = self.app.get_buffer_f64(handle)?;

        Some(view_f64_array(buf))
    }

    #[wasm_bindgen(js_name = setBufferU8)]
    pub fn set_buffer_u8(
        &mut self,
        handle: i32,
        bits: u64,
        byte_length: usize,
        f: &js_sys::Function,
    ) {
        self.app
            .set_buffer_u8(handle, bits, transfer_u8_array(byte_length, f));
    }

    #[wasm_bindgen(js_name = newBufferU8)]
    pub fn new_buffer_u8(&mut self, byte_length: usize, f: &js_sys::Function) -> Option<Handle> {
        self.app.new_buffer_u8(transfer_u8_array(byte_length, f))
    }

    #[wasm_bindgen(js_name = newBufferU32)]
    pub fn new_buffer_u32(&mut self, byte_length: usize, f: &js_sys::Function) -> Option<Handle> {
        self.app.new_buffer_u32(transfer_u32_array(byte_length, f))
    }

    #[wasm_bindgen(js_name = newBufferF32)]
    pub fn new_buffer_f32(&mut self, byte_length: usize, f: &js_sys::Function) -> Option<Handle> {
        self.app.new_buffer_f32(transfer_f32_array(byte_length, f))
    }

    #[wasm_bindgen(js_name = newBufferF64)]
    pub fn new_buffer_f64(&mut self, byte_length: usize, f: &js_sys::Function) -> Option<Handle> {
        self.app.new_buffer_f64(transfer_f64_array(byte_length, f))
    }

    #[wasm_bindgen(js_name = newBufferU8Cloned)]
    pub fn new_buffer_u8_cloned(&mut self, data: &[u8]) -> Option<Handle> {
        self.app.new_buffer_u8(data.to_vec())
    }

    #[wasm_bindgen(js_name = newBufferU32Cloned)]
    pub fn new_buffer_u32_cloned(&mut self, data: &[u32]) -> Option<Handle> {
        self.app.new_buffer_u32(data.to_vec())
    }

    #[wasm_bindgen(js_name = newBufferF32Cloned)]
    pub fn new_buffer_f32_cloned(&mut self, data: &[f32]) -> Option<Handle> {
        self.app.new_buffer_f32(data.to_vec())
    }

    // The `External` buffer APIs register byte-count-only entries whose real
    // data lives in the JS-side `InMemoryBufferStore`, so no round-trip copy of
    // JS bytes through WASM linear memory happens. Handle issuance, accounting
    // and removal still flow through the single Rust `BufferStore` owner.
    #[wasm_bindgen(js_name = setExternalBuffer)]
    pub fn set_external_buffer(&mut self, handle: i32, bits: u64, byte_length: usize) {
        self.app.set_external_buffer(handle, bits, byte_length);
    }

    #[wasm_bindgen(js_name = newExternalBuffer)]
    pub fn new_external_buffer(&mut self, byte_length: usize) -> Option<Handle> {
        self.app.new_external_buffer(byte_length)
    }

    /// Handles of `External` entries removed since the last drain; JS evicts
    /// each from its `InMemoryBufferStore` map every frame.
    #[wasm_bindgen(js_name = drainRemovedExternalHandles)]
    pub fn drain_removed_external_handles(&mut self) -> Vec<i32> {
        self.app.drain_removed_external_handles()
    }

    #[wasm_bindgen(js_name = removeBuffer)]
    pub fn remove_buffer(&mut self, handle: i32) {
        self.app.remove_buffer(handle);
    }

    // Unlike `getBuffer*`, the `removeBuffer*` variants MUST copy: the backing
    // Vec is dropped here, so a view would point at freed wasm memory. The copy
    // is the single transfer of ownership to JS.
    #[wasm_bindgen(js_name = removeBufferU8)]
    pub fn remove_buffer_u8(&mut self, handle: i32) -> Option<js_sys::Uint8Array> {
        Some(copy_u8_array(&self.app.remove_buffer_u8(handle)?))
    }
    #[wasm_bindgen(js_name = removeBufferU32)]
    pub fn remove_buffer_u32(&mut self, handle: i32) -> Option<js_sys::Uint32Array> {
        Some(copy_u32_array(&self.app.remove_buffer_u32(handle)?))
    }
    #[wasm_bindgen(js_name = removeBufferF32)]
    pub fn remove_buffer_f32(&mut self, handle: i32) -> Option<js_sys::Float32Array> {
        Some(copy_f32_array(&self.app.remove_buffer_f32(handle)?))
    }
    #[wasm_bindgen(js_name = removeBufferF64)]
    pub fn remove_buffer_f64(&mut self, handle: i32) -> Option<js_sys::Float64Array> {
        Some(copy_f64_array(&self.app.remove_buffer_f64(handle)?))
    }

    #[wasm_bindgen(js_name = triggerDataRequesterLoaded)]
    pub fn trigger_data_requester_loaded(&mut self, bits: u64, handle: i32) {
        self.app.trigger_data_requester_loaded(bits, handle);
    }

    #[wasm_bindgen(js_name = triggerDataRequesterFailed)]
    pub fn trigger_data_requester_failed(&mut self, bits: u64) {
        self.app.trigger_data_requester_failed(bits);
    }

    pub fn resize(&mut self, width: FloatType, height: FloatType, pixel_ratio: FloatType) {
        self.app.resize(width, height, pixel_ratio);
    }

    #[wasm_bindgen(js_name = addLayer)]
    pub fn add_layer(&mut self, layer: JsValue) -> String {
        let layer_id = generate_id();
        // TODO: Improve an undesirable cloning the layer.
        let Some(ld) = LayerDescription::from(layer.clone()) else {
            return layer_id;
        };
        let Some(layer_type) = ld.r#type else {
            return layer_id;
        };

        // Source-based layer types build their internal layer from a referenced
        // source. `terrain` may also be source-less (a flat ellipsoid surface),
        // in which case it takes the dedicated source-less build path.
        if matches!(
            layer_type.as_str(),
            "vector" | "raster" | "3d-tiles" | "terrain"
        ) {
            if let Some(source_id) = source_types::read_source_ref(layer.clone()) {
                if let Some(source) = self.app.get_source_description(&source_id)
                    && let Some(l) = source_types::build_source_layer(
                        &layer_id,
                        layer_type.as_str(),
                        layer,
                        &source,
                        None,
                    )
                {
                    self.app.add_layer(layer_id.as_str(), l);
                    self.app.link_layer_source(&layer_id, &source_id);
                }
            } else if let Some(l) =
                source_types::build_sourceless_layer(&layer_id, layer_type.as_str(), layer, None)
            {
                self.app.add_layer(layer_id.as_str(), l);
            }
        }

        layer_id
    }

    #[wasm_bindgen(js_name = updateLayer)]
    pub fn update_layer(&mut self, layer_id: String, layer: JsValue) {
        // Partial update payloads (e.g. `{ polygon: { opacity } }`) don't repeat
        // `type` or `source`, so both come from the stored layer. An explicit
        // `source` in the payload re-points the layer at a different source; a
        // partial payload without one keeps the layer's current source.
        let Some(layer_type) = self.app.get_layer_type(&layer_id) else {
            return;
        };

        let old_desc = self.app.get_layer_description(&layer_id);
        let old_source_id = old_desc
            .as_ref()
            .and_then(|d| d.source_id().map(str::to_owned));
        // The payload's source wins when present (a source switch); otherwise the
        // layer keeps its current source (partial appearance updates carry none).
        // If the payload names a source that isn't registered (typo, or a source
        // deleted earlier), ignore the switch and keep the current source so the
        // rest of the update (appearance) still applies instead of being dropped.
        let payload_source = source_types::read_source_ref(layer.clone())
            .filter(|id| self.app.get_source_description(id).is_some());
        let source_id = payload_source.or(old_source_id.clone());

        // Build the (possibly re-sourced) layer description. Source-less layers
        // (currently only ellipsoid terrain) have no `source_id`, so they take a
        // dedicated build path instead of resolving a source.
        let new_layer = match &source_id {
            Some(source_id) => self
                .app
                .get_source_description(source_id)
                .and_then(|source| {
                    source_types::build_source_layer(
                        layer_id.as_str(),
                        layer_type,
                        layer,
                        &source,
                        old_desc.as_ref(),
                    )
                }),
            None => source_types::build_sourceless_layer(
                layer_id.as_str(),
                layer_type,
                layer,
                old_desc.as_ref(),
            ),
        };

        let Some(new_layer) = new_layer else {
            return;
        };

        // Re-pointing a layer at a different source rebuilds it (delete + re-add)
        // exactly like `updateSource`, rather than mutating it in place, so the
        // layer reloads against the new source (for terrain the teardown + re-add
        // also rebuilds the globe tiling if the new source's scheme differs — see
        // `init_globe_tiling`). Relink ref-counts so the old source is dereferenced
        // and the new one referenced; both stay registered (neither is deleted).
        if old_source_id.as_deref() != source_id.as_deref()
            && let Some(new_source_id) = source_id.as_deref()
        {
            self.app.unlink_layer_source(&layer_id);
            self.app.link_layer_source(&layer_id, new_source_id);
            self.app.reset_layer(layer_id.as_str(), new_layer);
            return;
        }

        self.app.update_layer(layer_id.as_str(), new_layer);
    }

    #[wasm_bindgen(js_name = deleteLayer)]
    pub fn delete_layer(&mut self, layer_id: String) {
        self.app.delete_layer(layer_id.as_str());
    }

    #[wasm_bindgen(js_name = addSource)]
    pub fn add_source(&mut self, source: JsValue) -> String {
        let Some(sd) = SourceDescription::from(source.clone()) else {
            unreachable!();
        };
        // Use the caller-provided id, or generate one. A duplicate id overrides
        // the existing source (later definition wins).
        let source_id = sd.id.clone().unwrap_or_else(generate_id);
        if let Some(source_type) = sd.r#type
            && let Some(s) = SourceDescription::to(&source_id, source_type.as_str(), source, None)
        {
            self.app.add_source(source_id.as_str(), s);
        }

        source_id
    }

    #[wasm_bindgen(js_name = updateSource)]
    pub fn update_source(&mut self, source_id: String, source: JsValue) {
        // The source type can't change on update; reuse the stored one.
        let source_type = self
            .app
            .get_source_type(&source_id)
            .unwrap_or("")
            .to_owned();
        // Partial update: omitted fields fall back to the current source's values
        // (like `updateLayer`'s material merge) instead of resetting to defaults.
        let old = self.app.get_source_description(&source_id);
        let Some(s) = SourceDescription::to(
            source_id.as_str(),
            source_type.as_str(),
            source,
            old.as_ref(),
        ) else {
            return;
        };
        self.app.update_source(source_id.as_str(), s);

        // Reset every referencing layer so it reloads against the new config: tear
        // it down and re-add it (the loader rebuilds against the updated source, and
        // its delete path cleans up the layer's tiles/features). The stored
        // description is reused unchanged — its `source_id` is stable, so respawned
        // loaders read the updated source live and all layer-only fields
        // (appearances, MVT source-layers) are preserved.
        //
        // Terrain resets like every other layer: its teardown marker
        // (`DeleteTerrainLayerMarker`) re-flattens the globe, and the re-add
        // re-meshes against the updated source, so fetch changes (e.g. URL) fully
        // reload rather than being masked by cached tiles.
        for layer_id in self.app.layers_for_source(&source_id) {
            let Some(desc) = self.app.get_layer_description(&layer_id) else {
                continue;
            };
            self.app.reset_layer(&layer_id, desc);
        }
    }

    /// Delete a source, returning `false` while any layer still references it (or
    /// the id is unknown) and `true` once it has been removed.
    #[wasm_bindgen(js_name = deleteSource)]
    pub fn delete_source(&mut self, source_id: String) -> bool {
        self.app.delete_source(source_id.as_str())
    }

    /// Read back a stored source as the plain description object `addSource`
    /// accepts — including engine defaults and partial-update merges (inline
    /// GeoJSON `data` is not read back). `undefined` for unknown ids. Used by
    /// `view.sampleTerrainMostDetailed` to sample against the exact config
    /// the view renders with.
    #[wasm_bindgen(js_name = getSourceDescription)]
    pub fn get_source_description(&self, source_id: String) -> JsValue {
        let Some(source) = self.app.get_source_description(&source_id) else {
            return JsValue::UNDEFINED;
        };
        source_description_to_js(&source)
    }

    #[wasm_bindgen(js_name = getLayerIndex)]
    pub fn get_layer_index(&self, layer_id: &str) -> Option<usize> {
        self.app.get_layer_index(layer_id)
    }

    #[wasm_bindgen(js_name = triggerTextureFragmentLoaded)]
    pub fn trigger_texture_fragment_loaded(&mut self, bits: u64, status: TextureFragmentStatus) {
        self.app
            .trigger_texture_fragment_loaded(bits, status.into());
    }

    #[wasm_bindgen(js_name = setTileMeshPrepared)]
    pub fn set_tile_mesh_prepared(&mut self, handle: TileHandle) {
        self.app.set_tile_mesh_prepared(handle);
    }

    #[wasm_bindgen(js_name = markFeatureIsRendered)]
    pub fn mark_feature_is_rendered(&mut self, feature_type: &str, bits: u64) {
        match feature_type {
            "point" => self.app.mark_point_is_rendered(bits),
            "polyline" => self.app.mark_polyline_is_rendered(bits),
            "polygon" => self.app.mark_polygon_is_rendered(bits),
            "model" => self.app.mark_model_is_rendered(bits),
            _ => unreachable!(),
        }
    }

    /// Reports the actual GPU byte size a rendered feature was measured at on
    /// the JS side so the memory ledger corrects its payload-based estimate.
    /// Feature kinds without a wired-up owner lookup are a no-op. Currently
    /// wired: 3D Tiles models (replaces the tile's estimate — glTF/Draco
    /// decode otherwise undercounts) and billboards (folds the JS texture
    /// atlas footprint into the owning vector tile; `0` clears it on dispose).
    #[wasm_bindgen(js_name = reportFeatureGpuBytes)]
    pub fn report_feature_gpu_bytes(&mut self, feature_bits: u64, gpu_bytes: f64) {
        self.app
            .report_feature_gpu_bytes(feature_bits, gpu_bytes as u64);
    }

    /// Reports the drape render-target GPU footprint of a terrain tile (the
    /// clamp-to-ground vector layers baked onto it), measured on the JS side
    /// where the render targets are lazily allocated. Scales with terrain
    /// subdivision past the vector `maxZoom`, which per-vector-tile accounting
    /// cannot see.
    #[wasm_bindgen(js_name = reportTerrainDrapeGpuBytes)]
    pub fn report_terrain_drape_gpu_bytes(&mut self, handle: TileHandle, gpu_bytes: f64) {
        self.app
            .report_terrain_drape_gpu_bytes(handle, gpu_bytes as u64);
    }

    #[wasm_bindgen(js_name = triggerWorkerTaskCompleted)]
    pub fn trigger_worker_task_completed(&mut self, bits: u64, result: DelegatedWorkerTasksResult) {
        self.app.trigger_worker_task_completed(
            bits,
            match result {
                DelegatedWorkerTasksResult {
                    delegator_id,
                    construct_terrain_mesh: Some(v),
                    ..
                } => navara_worker::DelegatedWorkerTasksResult::ConstructTerrainMesh(
                    navara_worker::DelegatedWorkerTask::with_bits(delegator_id.0, v.into()),
                ),
                DelegatedWorkerTasksResult {
                    delegator_id,
                    upsample_terrain_mesh: Some(v),
                    ..
                } => navara_worker::DelegatedWorkerTasksResult::UpsampleTerrainMesh(
                    navara_worker::DelegatedWorkerTask::with_bits(delegator_id.0, v.into()),
                ),
                DelegatedWorkerTasksResult {
                    delegator_id,
                    construct_polygon_batched_feature: Some(v),
                    ..
                } => navara_worker::DelegatedWorkerTasksResult::ConstructPolygonBatchedFeature(
                    navara_worker::DelegatedWorkerTask::with_bits(delegator_id.0, v.into()),
                ),
                DelegatedWorkerTasksResult {
                    delegator_id,
                    construct_polyline_batched_feature: Some(v),
                    ..
                } => navara_worker::DelegatedWorkerTasksResult::ConstructPolylineBatchedFeature(
                    navara_worker::DelegatedWorkerTask::with_bits(delegator_id.0, v.into()),
                ),
                DelegatedWorkerTasksResult {
                    delegator_id,
                    parse_mvt_tile: Some(v),
                    ..
                } => navara_worker::DelegatedWorkerTasksResult::ParseMvtTile(
                    navara_worker::DelegatedWorkerTask::with_bits(delegator_id.0, v.into()),
                ),
                _ => unreachable!(),
            },
        );
    }

    /// Release the delegator of a task that ended without a deliverable
    /// result (worker error, missing input, ...). Consumes `delegator_id`.
    /// Safe to call for a task the engine already cancelled: a despawned
    /// delegator makes this a no-op.
    #[wasm_bindgen(js_name = triggerWorkerTaskFailed)]
    pub fn trigger_worker_task_failed(&mut self, delegator_id: ReconstructableEntity) {
        self.app.trigger_worker_task_failed(delegator_id.0);
    }

    #[wasm_bindgen(js_name = getMartini)]
    pub fn get_martini(
        &mut self,
        martini_id: ReconstructableEntity,
    ) -> Option<TransferableMartini> {
        self.app.get_martini(martini_id.0).map(|v| v.into())
    }

    #[wasm_bindgen(js_name = hasDataRequester)]
    pub fn has_data_requester(&mut self, id: u64) -> bool {
        self.app.has_data_requester(id)
    }
    #[wasm_bindgen(js_name = hasWorkerTask)]
    pub fn has_worker_task(&mut self, id: u64) -> bool {
        self.app.has_worker_task(id)
    }

    #[wasm_bindgen(js_name = getTile)]
    pub fn get_tile(&mut self, handle: TileHandle) -> Option<TransferableTile> {
        self.app.get_tile(handle).map(|v| v.into())
    }

    /// Buffer handle of a tile's loaded raw DEM bytes (the data a raster-DEM
    /// upsample of a descendant resamples from), `undefined` until it landed.
    #[wasm_bindgen(js_name = getTerrainDemBytes)]
    pub fn get_terrain_dem_bytes(
        &mut self,
        handle: TileHandle,
    ) -> Option<navara_buffer_store::Handle> {
        self.app.get_terrain_dem_bytes(handle)
    }

    #[wasm_bindgen(js_name = getVectorTileStates)]
    pub fn get_vector_tile_states(&mut self, handle: TileHandle) -> Vec<VectorTileState> {
        self.app
            .get_vector_tiles(handle)
            .into_iter()
            .map(VectorTileState::from)
            .collect()
    }

    /// Monotonic revision that changes only when the vector-tile resolution could have
    /// changed. The web renderer reads it once per frame and skips the per-terrain-tile
    /// `getVectorTileStates` calls while it is unchanged.
    #[wasm_bindgen(js_name = vectorRevision)]
    pub fn vector_revision(&self) -> u32 {
        self.app.vector_revision()
    }

    /// The WebMercator raster tiles to bake into per-layer drape render targets for a
    /// terrain tile (baked layers only; empty on WebMercator terrain, which drapes 1:1
    /// through the per-slot material path).
    #[wasm_bindgen(js_name = getRasterTileStates)]
    pub fn get_raster_tile_states(&mut self, handle: TileHandle) -> Vec<RasterTileState> {
        self.app
            .get_raster_tiles(handle)
            .into_iter()
            .map(RasterTileState::from)
            .collect()
    }

    /// Monotonic revision that changes only when the raster drape resolution could have
    /// changed. The web renderer reads it once per frame and skips the per-terrain-tile
    /// `getRasterTileStates` calls while it is unchanged.
    #[wasm_bindgen(js_name = rasterRevision)]
    pub fn raster_revision(&self) -> u32 {
        self.app.raster_revision()
    }

    #[wasm_bindgen(js_name = getTileElevationDecoder)]
    pub fn get_tile_elevation_decoder(&mut self, handle: TileHandle) -> Option<ElevationDecoder> {
        self.app
            .get_tile_elevation_decoder(handle)
            .map(|v| v.into())
    }

    /// Calculate meters per texel for hillshade normal computation
    ///
    /// # Arguments
    /// * `tile_handle` - Handle of the tile (for calculating latitude)
    /// * `texture_zoom` - Zoom level of the texture
    /// * `texture_width` - Width of the texture in pixels (including 2-pixel padding)
    ///
    /// # Returns
    /// Meters per texel value for hillshade shader
    #[wasm_bindgen(js_name = calcMetersPerTexel)]
    pub fn calc_meters_per_texel(
        &mut self,
        tile_handle: TileHandle,
        texture_zoom: usize,
        texture_width: u32,
    ) -> f32 {
        self.app
            .calc_meters_per_texel(tile_handle, texture_zoom, texture_width)
            .unwrap_or(1.0)
    }

    #[wasm_bindgen(js_name = getTransferablePolygonBatchedFeature)]
    pub fn get_transferable_polygon_batched_feature(
        &mut self,
        batched_feature_id: u64,
    ) -> Option<ReturnedTransferablePolygonBatchedFeature> {
        let (batched_geom, batch_ids_component, material) =
            self.app.take_batched_polygon_geometry(batched_feature_id)?;

        let mut transferable = TransferablePolygonBatchedFeature::from_batched(batched_geom);

        let buf_store = self.app.get_buffer_store()?;
        transferable.add_batch_id(&mut buf_store.get_u32(&batch_ids_component.handle)?.to_vec());

        Some(ReturnedTransferablePolygonBatchedFeature {
            transferable,
            material: material.into(),
        })
    }

    #[wasm_bindgen(js_name = getTransferablePolylineBatchedFeature)]
    pub fn get_transferable_polyline_batched_feature(
        &mut self,
        batched_feature_id: u64,
    ) -> Option<ReturnedTransferablePolylineBatchedFeature> {
        let (batched_geom, batch_ids_component, material) = self
            .app
            .take_batched_polyline_geometry(batched_feature_id)?;

        let mut transferable = TransferablePolylineBatchedFeature::from_batched(batched_geom);

        let buf_store = self.app.get_buffer_store()?;
        transferable.add_batch_id(&mut buf_store.get_u32(&batch_ids_component.handle)?.to_vec());

        Some(ReturnedTransferablePolylineBatchedFeature {
            transferable,
            material: material.into(),
        })
    }

    #[wasm_bindgen(js_name = genGlobalBatchId)]
    pub fn gen_global_batch_id(&mut self) -> Option<u32> {
        self.app.gen_global_batch_id()
    }

    #[wasm_bindgen(js_name = readPropertyByGlobalBatchId)]
    pub fn read_property_by_global_batch_id(&mut self, batch_id: u32) -> BatchPropResult {
        let (properties, layer_id, canonical_batch_id) = self
            .app
            .read_property_by_global_batch_id::<JsPropertyValue>(&batch_id);

        let properties_js = properties.map(|v| v.0).unwrap_or(JsValue::NULL);

        BatchPropResult {
            properties: properties_js,
            layer_id,
            batch_id: canonical_batch_id,
        }
    }

    #[wasm_bindgen(js_name = readAllBatchedProperties)]
    pub fn read_all_batched_properties(
        &mut self,
        renderable_feature_bits: u64,
        callback: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let this = JsValue::NULL;
        self.app
            .read_all_batched_properties::<JsPropertyValue, JsValue, _>(
                renderable_feature_bits,
                None,
                &|batch_idx, batch_id, props| {
                    let batch_idx = JsValue::from(batch_idx as u32);
                    let batch_id = JsValue::from(batch_id);
                    match props {
                        BatchProperties::All(Some(v)) => {
                            callback.call3(&this, &batch_idx, &batch_id, &v.0)?
                        }
                        _ => callback.call2(&this, &batch_idx, &batch_id)?,
                    };
                    Ok(())
                },
            )?;
        Ok(())
    }

    #[wasm_bindgen(js_name = readFilteredBatchedProperties)]
    pub fn read_filtered_batched_properties(
        &mut self,
        renderable_feature_bits: u64,
        keys: Vec<JsValue>,
        callback: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let keys: Vec<String> = keys.iter().filter_map(|k| k.as_string()).collect();

        let this = JsValue::NULL;
        self.app
            .read_all_batched_properties::<JsPropertyValue, JsValue, _>(
                renderable_feature_bits,
                Some(&keys),
                &|batch_idx, batch_id, props| {
                    let batch_idx = JsValue::from(batch_idx as u32);
                    let batch_id = JsValue::from(batch_id);
                    match props {
                        BatchProperties::Filtered(Some(values)) => {
                            let arr = js_sys::Array::new_with_length(values.len() as u32);
                            for (i, val) in values.into_iter().enumerate() {
                                match val {
                                    Some(v) => arr.set(i as u32, v.0),
                                    None => arr.set(i as u32, JsValue::UNDEFINED),
                                }
                            }
                            callback.call3(&this, &batch_idx, &batch_id, &arr.into())?
                        }
                        _ => callback.call2(&this, &batch_idx, &batch_id)?,
                    };
                    Ok(())
                },
            )?;
        Ok(())
    }

    #[wasm_bindgen(js_name = changeCamera)]
    pub fn change_camera(
        &mut self,
        position: Option<Vec<FloatType>>,
        pitch: Option<FloatType>,
        heading: Option<FloatType>,
        roll: Option<FloatType>,
        distance: Option<FloatType>,
    ) {
        self.app
            .change_camera(position, pitch, heading, roll, distance);
    }

    #[wasm_bindgen(js_name = moveCamera)]
    pub fn move_camera(&mut self, direction: CameraDirection, amount: FloatType) {
        self.app.move_camera(direction.into(), amount);
    }

    #[wasm_bindgen(js_name = moveCameraWithDirection)]
    pub fn move_camera_with_direction(&mut self, direction: Vec<FloatType>, amount: FloatType) {
        self.app.move_camera_with_direction(direction, amount);
    }

    /// Starts a camera flight and returns its id. A `CameraFlightEndedEvent`
    /// carrying the same id is delivered through the event stream when the
    /// flight completes (`completed: true`) or is superseded/canceled
    /// (`completed: false`).
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = flyTo)]
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
        self.app.fly_to(
            position, pitch, heading, roll, duration, max_height, distance, easing,
        )
    }

    #[wasm_bindgen(js_name = lookAt)]
    pub fn look_at(&mut self, target: Vec<FloatType>, offset: Vec<FloatType>) {
        self.app.look_at(target, offset);
    }

    #[wasm_bindgen(js_name = cameraFollow)]
    pub fn camera_follow(
        &mut self,
        enabled: bool,
        target: Option<Vec<FloatType>>,
        offset: Option<Vec<FloatType>>,
    ) {
        self.app.camera_follow(enabled, target, offset);
    }

    #[wasm_bindgen(js_name = cameraFreeLook)]
    pub fn camera_free_look(&mut self, enabled: bool, target: Option<Vec<FloatType>>) {
        self.app.camera_free_look(enabled, target);
    }

    #[wasm_bindgen(js_name = getCameraStatus)]
    pub fn get_camera_status(&mut self) -> Option<CameraStatus> {
        if let Some(cam_st) = self.app.get_camera_status() {
            let mut status: Vec<CameraStatusType> = vec![];
            cam_st.status.iter().for_each(|st| {
                status.push((*st).into());
            });

            Some(CameraStatus { status })
        } else {
            None
        }
    }

    #[wasm_bindgen(js_name = getCameraPositionLLE)]
    pub fn get_camera_position_lle(&mut self) -> Option<Vec<f64>> {
        self.app.get_camera_position_lle()
    }

    #[wasm_bindgen(js_name = getCameraPositionECEF)]
    pub fn get_camera_position_ecef(&mut self) -> Option<Vec<f64>> {
        self.app.get_camera_position_ecef()
    }

    #[wasm_bindgen(js_name = getCameraOrientation)]
    pub fn get_camera_orientation(&mut self) -> Option<CameraOrientation> {
        if let Some((heading, pitch, roll)) = self.app.get_camera_orientation() {
            return Some(CameraOrientation {
                heading,
                pitch,
                roll,
            });
        }
        None
    }

    /// Vertical field of view in radians as set via `setFrustum`.
    #[wasm_bindgen(js_name = getCameraFOV)]
    pub fn get_camera_fov(&mut self) -> Option<FloatType> {
        self.app.get_camera_fov()
    }

    #[wasm_bindgen(js_name = getZoomLevel)]
    pub fn get_zoom_level(&mut self) -> Option<FloatType> {
        self.app.get_zoom_level()
    }

    #[wasm_bindgen(js_name = rotateAroundAxis)]
    pub fn rotate_around_axis(&mut self, axis: Option<Vec<FloatType>>, angle: FloatType) {
        self.app.rotate_around_axis(axis, angle);
    }

    #[wasm_bindgen(js_name = sampleTerrainHeight)]
    pub fn sample_terrain_height(&mut self, lle: LLE) -> Option<FloatType> {
        self.app.sample_terrain_height((&lle).into())
    }

    #[wasm_bindgen(js_name = registerSampleTerrainHeightEvent)]
    pub fn register_sample_terrain_height_event(&mut self, lle: LLE) -> u64 {
        self.app.add_terrain_height_observer((&lle).into())
    }

    #[wasm_bindgen(js_name = unregisterSampleTerrainHeightEvent)]
    pub fn unregister_sample_terrain_height_event(&mut self, bits: u64) {
        self.app.remove_terrain_height_observer(bits);
    }

    #[wasm_bindgen(js_name = setFrustum)]
    pub fn set_frustum(
        &mut self,
        fov: Option<FloatType>,
        near: Option<FloatType>,
        far: Option<FloatType>,
    ) {
        self.app.set_frustum(fov, near, far);
    }

    #[wasm_bindgen(js_name = setCameraControl)]
    pub fn set_camera_control(&mut self, event: navara_wasm_types::CameraControlUpdateEvent) {
        self.app.set_camera_control(event.into());
    }

    // === Globe definition ===

    #[wasm_bindgen(js_name = getGlobe)]
    pub fn get_globe(&self) -> Option<Globe> {
        self.app.get_globe().map(|g| g.into())
    }

    #[wasm_bindgen(js_name = getGlobeTransparent)]
    pub fn get_globe_transparent(&self) -> Option<bool> {
        self.app.get_globe().map(|g| g.transparent)
    }

    #[wasm_bindgen(js_name = getGlobeMaxSse)]
    pub fn get_globe_max_sse(&self) -> Option<f32> {
        self.app.get_globe().map(|g| g.max_sse)
    }

    #[wasm_bindgen(js_name = getGlobeSegments)]
    pub fn get_globe_segments(&self) -> Option<f32> {
        self.app.get_globe().map(|g| g.segments as f32)
    }

    #[wasm_bindgen(js_name = getGlobeColor)]
    pub fn get_globe_color(&self) -> Option<u32> {
        self.app.get_globe().map(|g| g.color)
    }

    #[wasm_bindgen(js_name = getGlobeHideUnderground)]
    pub fn get_globe_hide_underground(&self) -> Option<bool> {
        self.app.get_globe().map(|g| g.hide_underground)
    }

    #[wasm_bindgen(js_name = getGlobeUseNormal)]
    pub fn get_globe_use_normal(&self) -> Option<bool> {
        self.app.get_globe().map(|g| g.use_normal)
    }

    #[wasm_bindgen(js_name = getGlobeOpacity)]
    pub fn get_globe_opacity(&self) -> Option<f32> {
        self.app.get_globe().map(|g| g.opacity)
    }

    #[wasm_bindgen(js_name = getGlobeWireframe)]
    pub fn get_globe_wireframe(&self) -> Option<bool> {
        self.app.get_globe().map(|g| g.wireframe)
    }

    #[wasm_bindgen(js_name = getGlobeElevationColormap)]
    pub fn get_globe_elevation_colormap(&self) -> Option<Vec<f32>> {
        self.app.get_globe().map(|g| g.elevation_colormap.clone())
    }

    /// Updates the LOD fog parameters (distance-based screen-space-error
    /// relaxation: far tiles tolerate a larger error and stay coarser). This
    /// only affects tile LOD selection, never visual fog rendering.
    #[wasm_bindgen(js_name = setLodFog)]
    pub fn set_lod_fog(&mut self, enabled: bool, density: f64, sse_factor: f64) {
        self.app.set_lod_fog(enabled, density, sse_factor);
    }

    /// Updates the dynamic screen-space-error relaxation; see [`DynamicSse`].
    #[wasm_bindgen(js_name = setDynamicSse)]
    pub fn set_dynamic_sse(&mut self, settings: DynamicSse) {
        self.app.set_dynamic_sse(
            settings.enabled,
            settings.density,
            settings.sse_factor,
            settings.height_falloff,
            settings.min_height,
            settings.max_height,
        );
    }

    /// Caps the number of in-flight data fetches per tile pipeline (raster /
    /// terrain / vector / 3D Tiles / hillshade each apply it independently).
    #[wasm_bindgen(js_name = setMaxPendingRequests)]
    pub fn set_max_pending_requests(&mut self, value: u32) {
        self.app.set_max_pending_requests(value);
    }

    /// Sets the memory-pressure SSE multiplier range. `min` is the resting
    /// base (far tiles always coarser; >1 on mobile), `max` the ceiling the
    /// degrade rises to under memory pressure.
    #[wasm_bindgen(js_name = setSseMultiplierRange)]
    pub fn set_sse_multiplier_range(&mut self, min: f32, max: f32) {
        self.app.set_sse_multiplier_range(min, max);
    }

    /// Sets the memory budget for tile caches in bytes. Passing `undefined`
    /// disables budgeting (tiles are destroyed as soon as they leave the
    /// view, the original behavior).
    #[wasm_bindgen(js_name = setCacheBytes)]
    pub fn set_cache_bytes(&mut self, bytes: Option<f64>) {
        self.app.set_cache_bytes(bytes);
    }

    /// Overrides GPU cost estimates that only the JS side knows precisely
    /// (the composite atlas size depends on device options).
    #[wasm_bindgen(js_name = setMemoryCostHints)]
    pub fn set_memory_cost_hints(&mut self, atlas_tile_bytes: f64, raster_tile_bytes: f64) {
        self.app
            .set_memory_cost_hints(atlas_tile_bytes, raster_tile_bytes);
    }

    /// Reports the estimated GPU bytes of fixed, screen-sized allocations
    /// (the postprocessing render-target stack). Counted in the ledger's
    /// usage so the tile budget binds against the remaining memory. The JS
    /// side re-reports on init, resize, and pass-list changes.
    #[wasm_bindgen(js_name = setFixedGpuBytes)]
    pub fn set_fixed_gpu_bytes(&mut self, bytes: f64) {
        self.app.set_fixed_gpu_bytes(bytes);
    }

    #[wasm_bindgen(js_name = getMemoryStats)]
    pub fn get_memory_stats(&mut self) -> Option<MemoryStats> {
        self.app.memory_stats().map(|s| MemoryStats {
            buffer_total_bytes: s.buffer_total_bytes as f64,
            external_buffer_bytes: s.external_buffer_bytes as f64,
            buffer_count: s.buffer_count,
            gpu_bytes_est: s.gpu_bytes_est as f64,
            external_cpu_bytes: s.external_cpu_bytes as f64,
            reserved_bytes: s.reserved_bytes as f64,
            fixed_gpu_bytes: s.fixed_gpu_bytes as f64,
            budget_bytes: s.budget_bytes.map(|b| b as f64),
            evicted_count: s.evicted_count as f64,
            sse_multiplier: s.sse_multiplier,
            retained_vector: s.retained_vector,
            retained_terrain: s.retained_terrain,
            retained_raster: s.retained_raster,
            retained_tiles3d: s.retained_tiles3d,
        })
    }

    #[wasm_bindgen(js_name = setGlobeTransparent)]
    pub fn set_globe_transparent(&mut self, value: bool) {
        self.app.set_globe_transparent(value);
    }

    #[wasm_bindgen(js_name = setGlobeMaxSse)]
    pub fn set_globe_max_sse(&mut self, value: f32) {
        self.app.set_globe_max_sse(value);
    }

    #[wasm_bindgen(js_name = setGlobeSegments)]
    pub fn set_globe_segments(&mut self, value: f32) {
        self.app.set_globe_segments(value as usize);
    }

    #[wasm_bindgen(js_name = setGlobeColor)]
    pub fn set_globe_color(&mut self, value: u32) {
        self.app.set_globe_color(value);
    }

    #[wasm_bindgen(js_name = setGlobeHideUnderground)]
    pub fn set_globe_hide_underground(&mut self, value: bool) {
        self.app.set_globe_hide_underground(value);
    }

    #[wasm_bindgen(js_name = setGlobeUseNormal)]
    pub fn set_globe_use_normal(&mut self, value: bool) {
        self.app.set_globe_use_normal(value);
    }

    #[wasm_bindgen(js_name = setGlobeOpacity)]
    pub fn set_globe_opacity(&mut self, value: f32) {
        self.app.set_globe_opacity(value);
    }

    #[wasm_bindgen(js_name = setGlobeWireframe)]
    pub fn set_globe_wireframe(&mut self, value: bool) {
        self.app.set_globe_wireframe(value);
    }

    #[wasm_bindgen(js_name = setGlobeElevationColormap)]
    pub fn set_globe_elevation_colormap(&mut self, value: Vec<f32>) {
        self.app.set_globe_elevation_colormap(value);
    }

    // === Globe definition ===
}

#[wasm_bindgen(js_name = generateId)]
pub fn generate_id() -> String {
    let mut rng = rand::rng();
    let id: u128 = rng.random();
    format!("{:032x}", id)
}

#[wasm_bindgen(start)]
pub fn start() {
    set_panic_hook();
    log("init navara_wasm");
}

// fn app<T>(id: String, f: impl FnOnce(&mut App) -> T) -> T {
//     static APP: OnceLock<Mutex<HashMap<String, App>>> = OnceLock::new();
//     let mut map = APP
//         .get_or_init(|| Mutex::new(HashMap::new()))
//         .lock()
//         .unwrap();

//     let app = map
//         .entry(id.to_string())
//         .or_insert_with(|| Mutex::new(App::new()))
//         .get_mut()
//         .unwrap();

//     f(app)
// }
