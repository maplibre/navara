use std::str::FromStr;

use bevy_ecs::system::Commands;

use navara_buffer_store::BufferStore;
use navara_component::{OrderByDistance, Priority, Requested};
use navara_data_requester::{DataManager, DataRequester, DataRequesterExtension};
use navara_layer::{TerrainDataType, TerrainLayer};
use navara_tile_component::{
    QuantizedMeshData, RasterDEMData, TerrainData, TerrainDataRequesterMarker, TerrainTile,
    TileHandle, TileTerrainDataRequesterQuery,
};

#[allow(clippy::too_many_arguments)]
pub(crate) fn request_terrain_data(
    commands: &mut Commands,
    tile: &mut TerrainTile,
    buf: &mut BufferStore,
    data_manager: &mut DataManager,
    terrain_layer: &Option<&TerrainLayer>,
    source_store: &navara_source::SourceStore,
    handle: TileHandle,
    terrain_data_requester: &TileTerrainDataRequesterQuery,
    priority: Priority,
) {
    let data_requester_entity_id = tile
        .terrain_data
        .as_ref()
        .and_then(|t| t.data_requester_entity_id());
    if matches!(data_requester_entity_id, Some(e) if terrain_data_requester.contains(e)) {
        return;
    }
    if let Some(t) = terrain_layer {
        // Skip data loading for terrain types that don't need it
        match &t.terrain_type {
            TerrainDataType::Ellipsoid => return, // Ellipsoid terrain doesn't need data loading
            TerrainDataType::Unknown => return,
            _ => {}
        }

        // All terrain fetch config (URL, tiling scheme, decoder, quantized-mesh
        // extensions, token) is read live from the referenced source.
        let Some(source) = t.source_id.as_deref().and_then(|id| source_store.get(id)) else {
            return;
        };
        let scheme = source.tiling_scheme();
        let Some(url_template) = source.url() else {
            return;
        };
        let url = scheme.tile_url(url_template, tile.coords);
        let extension = DataRequesterExtension::from_url(&url::Url::from_str(&url).unwrap());

        let request_vertex_normals = source.request_vertex_normals();
        let request_water_mask = source.request_water_mask();
        let token = source.token().map(|s| s.to_string());

        // Spawn entity first to get entity ID
        let entity_id = commands.spawn_empty().id();

        // Register with DataManager to get shared handle.
        // is_new=true means this is the first consumer for this URL.
        // fetch_already_enqueued=true means another consumer already triggered a fetch.
        let (shared_handle, is_new, fetch_already_enqueued) =
            data_manager.register_consumer(url.clone(), None, entity_id, buf);

        // Check if data already exists in BufferStore (loaded by previous consumer)
        let data_exists = buf.get_u8(&shared_handle).is_some();

        // Determine initial status: Success if data already loaded, otherwise Pending
        let initial_status = if !is_new && data_exists {
            navara_data_requester::DataRequesterStatus::Success
        } else {
            navara_data_requester::DataRequesterStatus::Pending
        };

        // Check if we should wait for an in-flight fetch before moving initial_status
        let should_wait_for_fetch = fetch_already_enqueued
            && initial_status == navara_data_requester::DataRequesterStatus::Pending;

        // Insert components with shared handle.
        let mut entity_commands = commands.entity(entity_id);
        entity_commands.insert((
            TerrainDataRequesterMarker(handle),
            DataRequester::new_with_status(shared_handle, url, extension, initial_status)
                .with_quantized_mesh_extensions(request_vertex_normals, request_water_mask)
                .with_token(token),
            OrderByDistance {
                sse: tile.sse,
                distance: tile.distance_from_camera,
            },
            priority,
        ));

        // If another consumer already enqueued a fetch AND we're still pending,
        // insert Requested marker so this consumer waits for the shared fetch.
        if should_wait_for_fetch {
            entity_commands.insert(Requested);
        }

        // An upsampled tile already carries requester-less terrain data of this
        // type (see `prepare_upsamplable_terrain_data`) holding the height range
        // of its current mesh: attach the fetch to it instead of replacing it.
        let terrain_data = tile
            .terrain_data
            .get_or_insert_with(|| match &t.terrain_type {
                TerrainDataType::RasterDEM => {
                    Box::new(RasterDEMData::new(*source.elevation_decoder().unwrap()))
                        as Box<dyn TerrainData>
                }
                TerrainDataType::QuantizedMesh => {
                    Box::new(QuantizedMeshData::new_with_tiling_scheme(scheme.clone()))
                }
                TerrainDataType::Ellipsoid | TerrainDataType::Unknown => unreachable!(),
            });
        terrain_data.set_data_requester_entity_id(Some(entity_id));
    }
}
