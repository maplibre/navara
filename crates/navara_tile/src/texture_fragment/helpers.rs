use bevy_ecs::system::{Commands, Query};
use url::Url;

use navara_buffer_store::BufferStore;
use navara_component::{Order, OrderByDistance, Priority, Requested};
use navara_core::TilingScheme;
use navara_data_requester::{DataManager, DataRequester, DataRequesterExtension};
use navara_layer::TilesLayer;
use navara_tile_component::{TerrainTile, TileHandle, TileTextureFragmentMarker};

use crate::hillshade::HillshadeTextureMarker;

/// Request hillshade textures for a terrain tile, one `DataRequester` per in-zoom hillshade layer.
/// `sorted_tiles` is the layer list sorted by `Order`, collected once per system
/// run (this helper is called per terrain tile).
#[allow(clippy::too_many_arguments)]
pub(crate) fn request_hillshade_data_requester(
    commands: &mut Commands,
    leaf: &mut TerrainTile,
    sorted_tiles: &[(&TilesLayer, &Order)],
    source_store: &navara_source::SourceStore,
    handle: TileHandle,
    data_requesters: &Query<&DataRequester>,
    priority: Priority,
    buf: &mut BufferStore,
    data_manager: &mut DataManager,
) {
    let tiles_len = sorted_tiles.len();
    if tiles_len == 0 {
        return;
    }

    let coords = leaf.coords;
    let sse = leaf.sse;
    let distance_from_camera = leaf.distance_from_camera;

    // The hillshade array must match `tiles_len`. Filter systems clear rejected
    // slots to None (rather than removing) so layer-index alignment is preserved
    // across frames. When a layer is added between calls, `add_order_to_tiles_layer`
    // assigns it the highest Order, so extending with trailing Nones keeps
    // existing layer indices intact; `delete_layer` handles shrinking.
    let hill_ids = leaf
        .hillshade_entity_ids
        .get_or_insert_with(|| vec![None; tiles_len]);
    if hill_ids.len() < tiles_len {
        hill_ids.resize(tiles_len, None);
    }

    // Check whether every hillshade layer is already handled. Regular (texture)
    // layers are owned by the raster pipeline and are never requested here.
    // Out-of-zoom layers stay None; hillshade layers must have a queryable DataRequester.
    let all_layers_requested = {
        let hill_ids = leaf.hillshade_entity_ids.as_ref().unwrap();
        sorted_tiles.iter().enumerate().all(|(i, (layer, _))| {
            if layer.hillshade_config.is_none() {
                return true;
            }
            let Some(source) = layer
                .source_id
                .as_deref()
                .and_then(|id| source_store.get(id))
            else {
                return true;
            };
            if !source.is_over_min_zoom(coords.z) || source.is_over_max_zoom(coords.z) {
                return true;
            }
            hill_ids[i].is_some_and(|e| data_requesters.get(e).is_ok())
        })
    };
    if all_layers_requested {
        return;
    }

    for (i, (layer, _)) in sorted_tiles.iter().enumerate() {
        // Regular texture layers are handled by the raster pipeline.
        if layer.hillshade_config.is_none() {
            continue;
        }
        // Resolve the referenced source; skip the layer if it is missing.
        let Some(source) = layer
            .source_id
            .as_deref()
            .and_then(|id| source_store.get(id))
        else {
            continue;
        };
        // Skip layers whose zoom range excludes this tile. The slot stays None.
        if !source.is_over_min_zoom(coords.z) || source.is_over_max_zoom(coords.z) {
            continue;
        }
        // Skip layers that already have a valid in-flight or completed entity.
        let already_requested = {
            let hill_ids = leaf.hillshade_entity_ids.as_ref().unwrap();
            hill_ids[i].is_some_and(|e| data_requesters.get(e).is_ok())
        };
        if already_requested {
            continue;
        }

        let Some(url_template) = source.url() else {
            continue;
        };
        let url = TilingScheme::WebMercator { tms: source.tms() }.tile_url(url_template, coords);

        // Hillshade texture: use DataRequester so Rust can backfill edges.
        let extension = Url::parse(&url)
            .ok()
            .map(|parsed_url| DataRequesterExtension::from_url(&parsed_url))
            .unwrap_or(DataRequesterExtension::Png); // Fallback to PNG if URL parsing fails

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
            TileTextureFragmentMarker(handle),
            HillshadeTextureMarker,
            DataRequester::new_with_status(shared_handle, url, extension, initial_status),
            OrderByDistance {
                sse,
                distance: distance_from_camera,
            },
            priority,
        ));

        // If another consumer already enqueued a fetch AND we're still pending,
        // insert Requested marker so this consumer waits for the shared fetch.
        if should_wait_for_fetch {
            entity_commands.insert(Requested);
        }

        leaf.hillshade_entity_ids.as_mut().unwrap()[i] = Some(entity_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_app::{App, Update};
    use bevy_ecs::{
        entity::Entity,
        prelude::Resource,
        system::{Res, ResMut},
    };
    use navara_core::TileXYZ;
    use navara_material::{Appearance, HillshadeConfig, RasterMaterial};

    /// A raster-DEM-style source carrying the layer's zoom range (zoom now lives
    /// on the source, not the material). The id matches the layer's `source_id`.
    fn layer_source(id: &str, min_zoom: usize, max_zoom: usize) -> navara_source::Source {
        navara_source::Source::RasterTile(navara_source::RasterTileSource {
            source_id: id.to_string(),
            url: "https://example.com/{z}/{x}/{y}.png".to_string(),
            tms: false,
            min_zoom,
            max_zoom,
            overscaled_max_zoom: 24,
        })
    }

    fn regular_layer(
        layer_id: &str,
        min_zoom: usize,
        max_zoom: usize,
    ) -> (TilesLayer, navara_source::Source) {
        let layer = TilesLayer {
            layer_id: layer_id.to_string(),
            source_id: Some(layer_id.to_string()),
            appearance: Some(Appearance::TerrainTile(RasterMaterial::default())),
            elevation_heatmap_config: None,
            hillshade_config: None,
        };
        (layer, layer_source(layer_id, min_zoom, max_zoom))
    }

    fn hillshade_layer(
        layer_id: &str,
        min_zoom: usize,
        max_zoom: usize,
    ) -> (TilesLayer, navara_source::Source) {
        let layer = TilesLayer {
            layer_id: layer_id.to_string(),
            source_id: Some(layer_id.to_string()),
            appearance: Some(Appearance::TerrainTile(RasterMaterial::default())),
            elevation_heatmap_config: None,
            hillshade_config: Some(HillshadeConfig { exaggeration: 1.0 }),
        };
        (layer, layer_source(layer_id, min_zoom, max_zoom))
    }

    #[derive(Resource, Default, Clone)]
    struct CapturedSlots {
        hill_ids: Vec<Option<Entity>>,
    }

    /// Run a single update where the caller can mutate a freshly-built `TerrainTile`
    /// before and after the call to `request_hillshade_data_requester`. The
    /// post-call state of `hillshade_entity_ids` is captured into `CapturedSlots`.
    fn run_request<F>(
        layers: Vec<((TilesLayer, navara_source::Source), Order)>,
        tile_z: usize,
        prepare: F,
    ) -> CapturedSlots
    where
        F: FnOnce(&mut TerrainTile) + Send + Sync + 'static,
    {
        let mut app = App::new();
        app.init_resource::<BufferStore>();
        app.init_resource::<CapturedSlots>();
        app.init_resource::<DataManager>();

        let mut store = navara_source::SourceStore::new();
        for ((layer, source), order) in layers {
            store.add(source.source_id().to_string(), source);
            app.world_mut().spawn((layer, order));
        }
        app.insert_resource(store);

        let prepare = std::sync::Mutex::new(Some(prepare));
        app.add_systems(
            Update,
            move |mut commands: Commands,
                  mut buf: ResMut<BufferStore>,
                  mut data_manager: ResMut<DataManager>,
                  tiles: Query<(&TilesLayer, &Order)>,
                  data_requesters: Query<&DataRequester>,
                  source_store: Res<navara_source::SourceStore>,
                  mut out: ResMut<CapturedSlots>| {
                let mut tile = TerrainTile::new(
                    TileXYZ {
                        x: 0,
                        y: 0,
                        z: tile_z,
                    },
                    0.,
                    0.,
                );
                let prepare = prepare.lock().unwrap().take().unwrap();
                prepare(&mut tile);

                let sorted_tiles: Vec<_> = tiles.iter().sort::<&Order>().collect();
                request_hillshade_data_requester(
                    &mut commands,
                    &mut tile,
                    &sorted_tiles,
                    &source_store,
                    0,
                    &data_requesters,
                    Priority::High,
                    &mut buf,
                    &mut data_manager,
                );

                out.hill_ids = tile.hillshade_entity_ids.clone().unwrap_or_default();
            },
        );
        app.update();
        app.world().resource::<CapturedSlots>().clone()
    }

    /// The terrain-side helper only requests hillshade layers; regular (texture)
    /// layers are owned by the raster pipeline and are never touched here.
    #[test]
    fn only_hillshade_layers_are_requested() {
        let captured = run_request(
            vec![
                (regular_layer("a", 0, 20), Order(0)),
                (regular_layer("c", 0, 20), Order(2)),
                (hillshade_layer("b", 0, 20), Order(1)),
            ],
            5,
            |_| {},
        );

        assert_eq!(captured.hill_ids.len(), 3);

        // Only the hillshade layer (index 1) gets a hillshade entity.
        assert!(captured.hill_ids[0].is_none());
        assert!(captured.hill_ids[1].is_some());
        assert!(captured.hill_ids[2].is_none());
    }

    /// When the hillshade filter has cleared a hillshade slot to None, the next
    /// call must refill it into `hillshade_entity_ids`.
    #[test]
    fn rejected_hillshade_slot_refills_into_hillshade_array() {
        let captured = run_request(
            vec![
                (regular_layer("a", 0, 20), Order(0)),
                (hillshade_layer("b", 0, 20), Order(1)),
            ],
            5,
            |tile| {
                tile.hillshade_entity_ids = Some(vec![None, None]);
            },
        );

        // Layer 0 (regular) — untouched by the terrain helper.
        assert!(captured.hill_ids[0].is_none());

        // Layer 1 (hillshade) is refilled into the hillshade array.
        assert!(captured.hill_ids[1].is_some());
    }

    /// When a layer is added after the tile already has shorter arrays, the
    /// function must extend them (not panic). The new hillshade layer is always
    /// appended by `add_order_to_tiles_layer`, so trailing Nones preserve
    /// existing layer-to-index alignment.
    #[test]
    fn new_layer_with_shorter_existing_arrays_extends_without_panic() {
        let captured = run_request(
            vec![
                (regular_layer("a", 0, 20), Order(0)),
                (regular_layer("b", 0, 20), Order(1)),
                (hillshade_layer("c", 0, 20), Order(2)),
            ],
            5,
            |tile| {
                // Tile was previously built with only 2 layers; layer c was
                // added later. Without resize, accessing hill_ids[2] would panic.
                tile.hillshade_entity_ids = Some(vec![None, None]);
            },
        );

        assert_eq!(captured.hill_ids.len(), 3);
        assert!(
            captured.hill_ids[2].is_some(),
            "newly appended hillshade layer must be spawned"
        );
    }

    /// Out-of-zoom hillshade layers must keep their slot as `None` — no entity
    /// is spawned for them.
    #[test]
    fn out_of_zoom_hillshade_layer_leaves_slot_none() {
        // tile is at z=2; hillshade layer 1 has min_zoom=10 → out of range.
        let captured = run_request(
            vec![
                (hillshade_layer("a", 0, 20), Order(0)),
                (regular_layer("c", 0, 20), Order(2)),
                (hillshade_layer("b", 10, 20), Order(1)),
            ],
            2,
            |_| {},
        );

        assert_eq!(captured.hill_ids.len(), 3);

        // In-zoom hillshade spawns.
        assert!(captured.hill_ids[0].is_some());
        // Out-of-zoom hillshade leaves slot None.
        assert!(
            captured.hill_ids[1].is_none(),
            "out-of-zoom hillshade layer must not spawn"
        );
    }

    /// Hillshade layers past max_zoom must not spawn a hillshade entity — the slot stays None,
    /// allowing the tile to use its parent's hillshade via ready_hillshade_parents.
    #[test]
    fn hillshade_beyond_max_zoom_leaves_hillshade_slot_none() {
        // Create a hillshade layer with max_zoom=10
        let layer = hillshade_layer("hillshade", 0, 10);

        // Tile at z=15 is beyond max_zoom (15 > 10): no hillshade requester should spawn.
        let captured = run_request(vec![(layer, Order(0))], 15, |_| {});

        assert_eq!(captured.hill_ids.len(), 1);

        // No hillshade entity should be spawned in the overscale zone
        assert!(
            captured.hill_ids[0].is_none(),
            "hillshade in overscale zone must not spawn DataRequester"
        );
    }
}
