use bevy_ecs::prelude::*;
use bevy_ecs::system::SystemParam;
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, Order, OrderByDistance, Priority, Rendered};
use navara_core::{Aabb, PoleSides, TileXYZ, TilingScheme, WGS84_64, vec3_to_xyz};
use navara_data_requester::{DataManager, DataRequester, DataRequesterStatus};
use navara_fog::{DynamicSse, Fog};
use navara_frame::FrameManager;
use navara_geometry::{
    TileUvTransform, add_pole_extension, add_skirt_separate, calculate_skirt_height,
    make_wgs84_down_dir_fn, tile_triangles_flat, uv_transform,
};
use navara_material::RasterTileInternalMaterial;
use navara_math::{FloatType, Transform};
use navara_memory::{
    GPU_GEOMETRY_RESIDENCY_FACTOR, MemoryLedger, ReserveEstimates, ReserveKey, RetainedEntry,
    TileCost,
};

use navara_mesh::{CachedMeshHandle, Mesh, MeshBundle, ObjectBundle};
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;

use navara_camera::{CameraFrustum, CameraMarker};
use navara_tile_component::{
    ChangedTileTerrainDataRequesterQuery, ChangedTileTextureFragmentQuery, TerrainInformation,
    TerrainInformationQuadtree, TerrainTile, TerrainTileGpuCost, TerrainTileQuadtree, Tile,
    TileHandle, TileMeshMarker, TileTerrainDataRequesterQuery, TileTextureFragmentMarker,
    TileTextureFragmentQuery,
};
use navara_window::Window;
use navara_worker::{
    WorkerTaskCompleted, WorkerTaskResultConsumed,
    construct_terrain_mesh::{
        ConstructTerrainMeshMarker, ConstructTerrainMeshParameters, ConstructTerrainMeshResult,
        ConstructTerrainMeshWorkerTaskBundle,
    },
    upsample_terrain_mesh::{
        UpsampleTerrainMeshMarker, UpsampleTerrainMeshParameters, UpsampleTerrainMeshResult,
        UpsampleTerrainMeshWorkerTaskBundle,
    },
};

use crate::texture_fragment::request_hillshade_data_requester;

use super::{
    event::MeshPreparedEvent,
    render::RenderedTile,
    tile_cache_manager::TileCacheManager,
    traverse::{TraversalResult, prepare_tile_resource, spawn_tile_entity, traverse_terrain},
};

use navara_layer::{
    DeleteRasterTileLayerMarker, DeleteTerrainLayerMarker, TerrainLayer, TilesLayer,
    UpdateRasterTileLayerMarker, UpdateTerrainLayerMarker,
};

/// System parameter that groups BufferStore and DataManager to reduce parameter count
#[derive(SystemParam)]
pub struct DataResources<'w> {
    pub buf: ResMut<'w, BufferStore>,
    pub data_manager: ResMut<'w, DataManager>,
}

/// Ensures the quadtree roots exist for the current tiling scheme. A newly added
/// TerrainLayer dictates the scheme (its source's scheme); on terrain delete
/// `sync_terrain_layer_changes` restores the default `Globe.tiling_scheme` and
/// drains the tiling, which this system then re-seeds. The seed loop is a cheap
/// no-op once the roots for the current scheme are present.
pub fn init_globe_tiling(
    mut commands: Commands,
    terrain_layer: Query<&navara_layer::TerrainLayer, Added<navara_layer::TerrainLayer>>,
    mut globe: ResMut<navara_globe::Globe>,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut buf: ResMut<BufferStore>,
    source_store: Res<navara_source::SourceStore>,
    mut raster_revision: ResMut<crate::raster::RasterResolveRevision>,
) {
    if let Some(layer) = terrain_layer.iter().next() {
        // A source-less (ellipsoid) terrain keeps the current globe scheme.
        let scheme = layer
            .source_id
            .as_deref()
            .and_then(|id| source_store.get(id))
            .map(|source| source.tiling_scheme());

        if let Some(scheme) = scheme
            && scheme != globe.tiling_scheme
        {
            // The new terrain source uses a different tiling scheme (e.g. geographic
            // quantized-mesh vs WebMercator raster-dem). Each quadtree tile bakes its
            // extent from the scheme at creation, so a scheme change requires
            // rebuilding the tiling: drop every tile (freeing its buffers) and
            // re-seed the roots below for the new scheme. Rendered-tile entities and
            // caches were already cleared by `sync_terrain_layer_changes`, which runs
            // earlier this frame on the same `Added<TerrainLayer>`.
            for mut tile in qt.qt.drain() {
                tile.destroy(&mut commands, &mut buf);
            }
            globe.tiling_scheme = scheme;
            // The scheme gates whether raster layers drape via baked slots
            // (`snapshot_raster_bake_inputs` snapshots nothing on non-Geographic
            // globes): without a bump, a snapshot built under the old scheme
            // would go stale and every raster/heatmap layer would resolve empty
            // (fully transparent) until some unrelated bump. Runs before the
            // snapshot system, so this is captured the same frame.
            raster_revision.bump();
        }
    }

    for root in globe.tiling_scheme.root_tiles() {
        let coords = (root.x, root.y, root.z);
        if qt.qt.leaf(coords).is_none() {
            let scheme = globe.tiling_scheme.clone();
            qt.qt.initialize_leaf(coords, &|(x, y, z)| {
                TerrainTile::new_with_scheme(TileXYZ { x, y, z }, 0., 0., scheme.clone())
            });
        }
    }
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn update_terrain(
    mut commands: Commands,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut tc: ResMut<TileCacheManager>,
    mut data_resources: DataResources,
    frame: Res<FrameManager>,
    window: Res<Window>,
    // Bundled to stay within Bevy's per-system parameter limit.
    globe: (Res<navara_globe::Globe>, Res<navara_memory::SsePressure>),
    source_store: Res<navara_source::SourceStore>,
    mut tiles_set: ParamSet<(Query<(&TilesLayer, &Order)>, Query<(), Changed<TilesLayer>>)>,
    mut terrain_layer_set: ParamSet<(Query<&TerrainLayer>, Query<(), Added<TerrainLayer>>)>,
    mut camera_set: ParamSet<(
        Query<(Ref<Transform>, Ref<CameraFrustum>), With<CameraMarker>>,
        Query<(Ref<Fog>, Ref<DynamicSse>)>,
    )>,
    changed_texture_fragment: ChangedTileTextureFragmentQuery,
    mut data_requesters_set: ParamSet<(
        Query<&DataRequester>,
        Query<
            &DataRequester,
            (
                With<TileTextureFragmentMarker>,
                Or<(Added<DataRequester>, Changed<DataRequester>)>,
            ),
        >,
    )>,
    mut terrain_data_requester_set: ParamSet<(
        TileTerrainDataRequesterQuery,
        ChangedTileTerrainDataRequesterQuery,
    )>,
    occluder: Query<Ref<EllipsoidalOccluder>>,
    mut meshes_set: ParamSet<(
        // All meshes
        Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
        // All changed meshes
        Query<
            &Mesh,
            (
                Or<(Added<Mesh>, Changed<Mesh>)>,
                With<TileMeshMarker>,
                Without<Deleted>,
            ),
        >,
    )>,
) {
    let is_texture_fragment_changed = !changed_texture_fragment.is_empty();
    let is_data_requester_changed = !terrain_data_requester_set.p1().is_empty();
    let is_texture_data_requester_changed = !data_requesters_set.p1().is_empty();
    let is_mesh_changed = !meshes_set.p1().is_empty();
    let is_tile_layer_added = !tiles_set.p1().is_empty();
    let is_terrain_layer_added = !terrain_layer_set.p1().is_empty();

    let mut meshes = meshes_set.p0();
    let terrain_data_requester = terrain_data_requester_set.p0();
    let data_requesters = data_requesters_set.p0();

    // TODO: Think how to support multiple terrain layer.(Is it possible?)
    let terrain_layer = terrain_layer_set.p0();
    let terrain_layer = terrain_layer.iter().next();

    let occluder = occluder.iter().next().unwrap();

    let (fog, dynamic_sse, is_fog_changed) = {
        let fog_query = camera_set.p1();
        let (fog, dynamic_sse) = fog_query.single().unwrap();
        (
            Fog::clone(&fog),
            DynamicSse::clone(&dynamic_sse),
            fog.is_changed() || dynamic_sse.is_changed(),
        )
    };
    let (globe, pressure) = globe;
    let camera = camera_set.p0();
    let (camera, frustum) = camera.single().unwrap();

    // Since TilesLayer is added asynchronously, we need to check if it's changed at last frame by ourself.
    let tiles = &tiles_set.p0();
    let tiles_len = tiles.iter().len();
    let is_layers_len_changed = tiles_len != tc.prev_layers_len;
    // A terrain layer teardown (`sync_terrain_layer_changes`) sets this so
    // terrain re-traverses even with a static camera and re-meshes the tiles back
    // to the flat ellipsoid once the `TerrainLayer` is gone. Consume it here.
    let is_source_changed = tc.force_update;
    tc.force_update = false;

    let needs_update = is_texture_fragment_changed
        || is_data_requester_changed
        || is_texture_data_requester_changed
        || is_mesh_changed
        || tc.is_updated_in_this_frame
        || camera.is_added()
        || camera.is_changed()
        || frustum.is_changed()
        || occluder.is_changed()
        || is_tile_layer_added
        || is_terrain_layer_added
        || is_layers_len_changed
        || is_source_changed
        || is_fog_changed
        || pressure.is_changed();
    if !needs_update {
        return;
    }

    tc.is_updated_in_this_frame = true;
    tc.last_rendered_frame = frame.rendered_frame();
    tc.prev_layers_len = tiles_len;

    // Memory-pressure LOD degrade, weighted by distance relative to the
    // camera's height above the ellipsoid.
    let camera_pos = camera.transform_point(navara_math::Vec3::ZERO);
    let camera_height = WGS84_64.xyz_to_lle(vec3_to_xyz(camera_pos)).height.val();
    let degrade = navara_memory::SseDegrade::new(
        pressure.multiplier,
        camera_height,
        pressure.min,
        pressure.max,
    );
    let dynamic_sse = dynamic_sse.term(camera_pos, camera.forward(), camera_height);

    let root_coords: Vec<TileXYZ> = globe.tiling_scheme.root_tiles();

    // Sort the layer list once per run; the traversal touches every visited tile.
    let sorted_layers: Vec<_> = tiles.iter().sort::<&Order>().collect();

    let is_over_min_z = if !sorted_layers.is_empty() {
        sorted_layers
            .iter()
            .filter_map(|(t, _)| t.source_id.as_deref().and_then(|id| source_store.get(id)))
            .any(|s| s.is_over_min_zoom(0))
    } else {
        true
    };

    for root in &root_coords {
        let coords = (root.x, root.y, root.z);
        let Some(root_handle) = qt.qt.leaf(coords).map(|n| n.handle()) else {
            continue;
        };

        let is_texture_ready = qt.qt.get_mut(root_handle).unwrap().is_hillshade_ready(
            &data_requesters,
            &sorted_layers,
            &source_store,
        );

        let traversal_result = traverse_terrain(
            &mut commands,
            &sorted_layers,
            &terrain_layer,
            &source_store,
            root_handle,
            &mut tc,
            &mut qt,
            &mut data_resources.buf,
            &mut data_resources.data_manager,
            &frame,
            &camera,
            &frustum,
            &data_requesters,
            &terrain_data_requester,
            &window,
            &WGS84_64,
            &occluder,
            &mut meshes,
            &fog,
            dynamic_sse,
            globe.max_sse as f64,
            degrade,
            false,
            false,
            is_texture_ready.then_some(root_handle),
            None,
            0,
            !(pressure.load_gate_closed || pressure.prefetch_gate_closed),
        );

        // Skip rendering root tile if below minimum zoom, but allow traversal above.
        if !is_over_min_z {
            continue;
        }

        match traversal_result {
            TraversalResult::TileRendered => {
                spawn_tile_entity(
                    &mut commands,
                    &mut tc,
                    &frame,
                    qt.qt.get_mut(root_handle).unwrap(),
                    root_handle,
                    None,
                    None,
                    false,
                );
                if tc.is_rendered_tile_prepared(&root_handle) {
                    tc.activate_rendered_tile(&root_handle, &mut meshes, true);
                }
            }
            TraversalResult::NotFound => {
                prepare_tile_resource(
                    &mut commands,
                    &mut qt,
                    &mut data_resources.buf,
                    &mut data_resources.data_manager,
                    &terrain_layer,
                    root_handle,
                    &mut tc,
                    &sorted_layers,
                    &source_store,
                    &data_requesters,
                    &terrain_data_requester,
                    Priority::Extreme,
                );
                let tile = qt.qt.get_mut(root_handle).unwrap();
                request_hillshade_data_requester(
                    &mut commands,
                    tile,
                    &sorted_layers,
                    &source_store,
                    root_handle,
                    &data_requesters,
                    Priority::High,
                    &mut data_resources.buf,
                    &mut data_resources.data_manager,
                );
            }
            TraversalResult::ChildrenMeshesPrepared => {
                tc.activate_rendered_tile(&root_handle, &mut meshes, false);
            }
            _ => {}
        }
    }
}

fn attach_rendered(commands: &mut Commands, e: Entity) {
    commands.entity(e).insert(Rendered);
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn transfer_mesh(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    mut tc: ResMut<TileCacheManager>,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut terrain_qt: ResMut<TerrainInformationQuadtree>,
    mut rendered_tiles: Query<
        (Entity, &mut RenderedTile, &OrderByDistance),
        Or<(Added<RenderedTile>, Without<Rendered>)>,
    >,
    data_requesters: Query<&DataRequester>,
    terrain_data_requester: TileTerrainDataRequesterQuery,
    tile_layers: Query<(&TilesLayer, &Order)>,
    terrain_layer: Query<&TerrainLayer>,
    terrain_mesh_constructors: Query<&ConstructTerrainMeshResult, Without<Deleted>>,
    terrain_mesh_upsamplers: Query<&UpsampleTerrainMeshResult, Without<Deleted>>,
    globe: Res<navara_globe::Globe>,
    source_store: Res<navara_source::SourceStore>,
) {
    if !tc.is_updated_in_this_frame {
        return;
    }

    // TODO: Support mutiple terrain layers
    let terrain_layer = terrain_layer.iter().next();
    // The terrain's fetch/geometry config (tile size, tiling scheme, zoom range)
    // is read live from the referenced source.
    let terrain_source = terrain_layer
        .and_then(|l| l.source_id.as_deref())
        .and_then(|id| source_store.get(id));

    let tile_size = terrain_source.map(|s| s.tile_size());

    // Sort the layer list once per run; the loop below runs per rendered tile.
    let sorted_layers: Vec<_> = tile_layers.iter().sort::<&Order>().collect();

    for (rendered_tile_id, mut rendered_tile, order) in
        rendered_tiles.iter_mut().sort::<&OrderByDistance>()
    {
        let needs_update = rendered_tile.is_added()
            || rendered_tile
                .terrain_mesh_constructor
                .is_some_and(|c| terrain_mesh_constructors.contains(c))
            || rendered_tile
                .terrain_mesh_upsampler
                .is_some_and(|c| terrain_mesh_upsamplers.contains(c));
        if !needs_update {
            continue;
        }

        let tile = qt.qt.get(rendered_tile.tile_handle).unwrap();
        let tile_aabb = tile.aabb().clone();
        let is_root = tile.is_root();
        let render_order = if is_root { -1 } else { 0 };

        let ready_parent_tile = tc
            .rendered_tile_caches
            .get(&rendered_tile.tile_handle)
            .and_then(|t| t.ready_parent_tile_handle);

        if terrain_qt.qt.get(rendered_tile.tile_handle).is_none() {
            terrain_qt
                .qt
                .initialize_leaf((tile.coords.x, tile.coords.y, tile.coords.z), &|_coords| {
                    TerrainInformation::new()
                });
        }

        let extent = tile.extent;

        let should_render_terrain = terrain_layer.is_some();
        let is_ellipsoid_terrain = terrain_layer
            .map(|l| matches!(l.terrain_type, navara_layer::TerrainDataType::Ellipsoid))
            .unwrap_or(false);
        let is_quantized_mesh = terrain_layer
            .map(|l| matches!(l.terrain_type, navara_layer::TerrainDataType::QuantizedMesh))
            .unwrap_or(false);
        let qm_geographic = terrain_source.is_some_and(|s| s.tiling_scheme().is_geographic());
        let qm_tms = terrain_source.is_some_and(|s| s.tiling_scheme().tms());

        let tile_layers_len = sorted_layers.len();
        let mut shows = Vec::with_capacity(tile_layers_len);
        let mut opacities = Vec::with_capacity(tile_layers_len);
        let mut colors = Vec::with_capacity(tile_layers_len);

        // Elevation Heatmap fields
        let mut is_elevation_heatmaps = Vec::with_capacity(tile_layers_len);
        let mut shared_heatmap_config = None;
        // DEM decoder is fetch config: read live from the source, not the layer.
        let mut shared_heatmap_decoder = None;

        // Hillshade fields
        let mut is_hillshades = Vec::with_capacity(tile_layers_len);
        let mut layer_uv_transforms = Vec::with_capacity(tile_layers_len);
        let mut shared_hillshade_config = None;
        let mut shared_hillshade_decoder = None;
        let mut tile_show_bounding_box = false;

        // Resolve a raster layer's DEM decoder live from its referenced source.
        let layer_decoder = |l: &TilesLayer| {
            l.source_id
                .as_deref()
                .and_then(|id| source_store.get(id))
                .and_then(|s| s.elevation_decoder().copied())
        };

        for (i, (l, _)) in sorted_layers.iter().enumerate() {
            // The initial material only reflects terrain-owned hillshade readiness;
            // regular raster textures are draped later in `update_mesh_material`.
            let mut should_show = false;
            if let Some(hill_entity) = tile
                .hillshade_entity_ids
                .as_ref()
                .and_then(|ids| ids.get(i))
                .and_then(|&e| e)
                && let Ok(dr) = data_requesters.get(hill_entity)
            {
                should_show = dr.is_succeeded();
            }

            let a = l.appearance().unwrap();
            shows.push(should_show && a.show);
            opacities.push(a.opacity.clamp(0., 1.));
            colors.push(a.color);
            tile_show_bounding_box = tile_show_bounding_box || a.show_bounding_box;

            // Mark whether this layer is an elevation heatmap
            if let Some(heatmap_config) = &l.elevation_heatmap_config {
                is_elevation_heatmaps.push(true);
                // Use the first heatmap config as shared configuration
                if shared_heatmap_config.is_none() {
                    shared_heatmap_config = Some(heatmap_config);
                    shared_heatmap_decoder = layer_decoder(l);
                }
            } else {
                is_elevation_heatmaps.push(false);
            }

            // Mark whether this layer is a hillshade
            if let Some(hillshade_config) = &l.hillshade_config {
                is_hillshades.push(true);
                // Use the first hillshade config as shared configuration
                if shared_hillshade_config.is_none() {
                    shared_hillshade_config = Some(hillshade_config);
                    shared_hillshade_decoder = layer_decoder(l);
                }
            } else {
                is_hillshades.push(false);
            }

            // Per-layer UV transform is finalized in `update_mesh_material` once each
            // layer's actual parent (LayerParent) is resolved.
            layer_uv_transforms.push(None);
        }

        // Extract shared elevation heatmap configuration (or use defaults)
        let (cast_shadow, receive_shadow, lit, terrain_show_bounding_box) = terrain_layer
            .and_then(|l| l.appearance.as_ref())
            .map_or((false, false, None, false), |appearance| {
                (
                    appearance.cast_shadow,
                    appearance.receive_shadow,
                    appearance.lit,
                    appearance.show_bounding_box,
                )
            });

        // The initial material carries only terrain-owned hillshade entities;
        // regular raster textures are pulled by extent in `update_mesh_material`.
        let merged_texture_fragments = tile.hillshade_entity_ids.clone();

        // Reprojection is resolved per raster slot in `update_mesh_material`; the
        // initial (hillshade-only) material never reprojects.
        let layer_reproject = vec![false; shows.len()];

        let appearance = RasterTileInternalMaterial {
            shows,
            opacities,
            colors,
            texture_fragments: merged_texture_fragments,
            cast_shadow: Some(cast_shadow),
            receive_shadow: Some(receive_shadow),
            lit,
            show_bounding_box: Some(tile_show_bounding_box || terrain_show_bounding_box),

            // Elevation Heatmap fields
            is_elevation_heatmaps,
            elevation_heatmap_config: shared_heatmap_config.cloned(),
            heatmap_elevation_decoder: shared_heatmap_decoder,

            // Hillshade fields
            is_hillshades,
            hillshade_config: shared_hillshade_config.cloned(),
            hillshade_elevation_decoder: shared_hillshade_decoder,
            layer_uv_transforms,
            layer_reproject,
            terrain_lat_range: None,
        };

        let terrain_req = match tile.terrain_data.as_ref() {
            Some(t) => t
                .data_requester_entity_id()
                .and_then(|e| terrain_data_requester.get(e).map_or(None, |v| Some(v.1))),
            None => None,
        };
        let is_terrain_failed = matches!(
            terrain_req.map(|t| &t.status),
            Some(&DataRequesterStatus::Fail)
        );

        // Take the upsample branch either when we're in the configured upsample band
        // OR when our own DEM request failed but the parent terrain is ready.
        let should_upsample_terrain = terrain_layer.is_some()
            && tile.is_upsamplable(&qt, &terrain_data_requester, &terrain_layer)
            && (terrain_source.is_some_and(|s| s.should_overscale(tile.coords.z))
                || is_terrain_failed);

        if !should_render_terrain
            || is_ellipsoid_terrain
            || (terrain_source.is_some_and(|s| !s.is_over_min_zoom(tile.coords.z))
                || (!should_upsample_terrain && is_terrain_failed))
        {
            // TODO: Move these tile construction process to worker.
            let (mut triangles, rtc_translation) = tile_triangles_flat(
                WGS84_64,
                &extent,
                if is_root { 65 } else { globe.segments },
                0.,
                matches!(globe.tiling_scheme, TilingScheme::WebMercator { .. }),
            );

            // Render the skirt as well if the terrain layer is also used.
            let (skirt, skirt_exaggeration) = terrain_layer
                .and_then(|l| l.appearance.as_ref())
                .map_or((true, 1.0), |appearance| {
                    (appearance.skirt, appearance.skirt_exaggeration)
                });
            if should_render_terrain && skirt {
                // Use terrain tile_size if available, otherwise default to 256
                let skirt_height =
                    calculate_skirt_height(&WGS84_64, tile.coords.z, skirt_exaggeration);
                let down_dir_fn = make_wgs84_down_dir_fn(WGS84_64, Some(rtc_translation));
                add_skirt_separate(&mut triangles, skirt_height, &down_dir_fn);
            }
            add_pole_extension(
                &mut triangles,
                WGS84_64,
                &extent,
                rtc_translation,
                PoleSides::from_extent(&globe.tiling_scheme, &extent),
            );
            let v_skirt_handle = triangles.skirt_vertices.map(|b| buf.new_f32(b));
            let i_skirt_handle = triangles.skirt_indices.map(|b| buf.new_u32(b));
            let u_skirt_handle = triangles.skirt_uvs.map(|b| buf.new_f32(b));

            let vhandle = buf.new_f32(triangles.vertices);
            let ihandle = buf.new_u32(triangles.indices);
            let uvshandle = buf.new_f32(triangles.uvs);
            {
                if let Some(t) = qt.qt.get_mut(rendered_tile.tile_handle) {
                    t.cached_mesh_handle = Some(CachedMeshHandle {
                        vertices: vhandle,
                        indices: ihandle,
                        uvs: uvshandle,
                        heights: None,
                        normals: None,
                        watermask: None,
                    });
                };
            }

            attach_rendered(&mut commands, rendered_tile_id);

            let e = commands.spawn((
                TileMeshMarker {
                    handle: rendered_tile.tile_handle,
                    ready_parent_tile_handle: ready_parent_tile,
                },
                MeshBundle {
                    mesh: Mesh {
                        vertices: vhandle,
                        indices: ihandle,
                        uvs: uvshandle,
                        active: false,
                        render_order,
                        aabb: Aabb {
                            center: Transform::from_translation(-rtc_translation)
                                .transform_point(tile_aabb.center),
                            extents: tile_aabb.extents,
                        },
                        // Flat tiles don't carry quantized-mesh normals or watermask.
                        normals: None,
                        skirt_vertices: v_skirt_handle,
                        skirt_uvs: u_skirt_handle,
                        skirt_indices: i_skirt_handle,
                        skirt_normals: None,
                        watermask: None,
                    },
                    material: appearance,
                    object: ObjectBundle {
                        transform: Transform::from_translation(rtc_translation),
                        marker: Default::default(),
                    },
                },
            ));

            if let Some(cache) = tc.rendered_tile_caches.get_mut(&rendered_tile.tile_handle) {
                cache.mesh_entity = Some(e.id());
            } else {
                panic!("Mesh duplication error");
            };
            continue;
        }

        fn postupdate_tile(
            tile: &mut TerrainTile,
            terrain_info: &mut TerrainInformation,
            max_height: FloatType,
            min_height: FloatType,
        ) {
            let terrain_data = tile
                .terrain_data
                .as_mut()
                .expect("This line is invoked only in the tile has terrain");
            terrain_data.set_current_max_height(max_height);
            terrain_data.set_current_min_height(min_height);
            tile.update_heights(max_height, min_height);

            terrain_info.max_height = max_height;
            terrain_info.min_height = min_height;
        }

        // Get skirt settings from terrain layer
        let (skirt, skirt_exaggeration) = terrain_layer
            .and_then(|l| l.appearance.as_ref())
            .map_or((true, 1.0), |appearance| {
                (appearance.skirt, appearance.skirt_exaggeration)
            });

        let sides = PoleSides::from_extent(&tile.tiling_scheme, &tile.extent);
        let pole_sides = (sides.north, sides.south);
        if should_upsample_terrain {
            let terrain_mesh_upsampler_id = match rendered_tile.terrain_mesh_upsampler {
                Some(e) => e,
                None => {
                    let terrain_mesh_upsampler = commands
                        .spawn((
                            UpsampleTerrainMeshWorkerTaskBundle::new(
                                UpsampleTerrainMeshMarker,
                                UpsampleTerrainMeshParameters {
                                    tile_handle: rendered_tile.tile_handle,
                                    skirt,
                                    pole_sides,
                                    skirt_exaggeration,
                                    is_quantized_mesh,
                                    geographic: qm_geographic,
                                    tms: qm_tms,
                                },
                            ),
                            order.clone(),
                        ))
                        .id();
                    rendered_tile.terrain_mesh_upsampler = Some(terrain_mesh_upsampler);
                    continue;
                }
            };
            let terrain_mesh_upsampler =
                match terrain_mesh_upsamplers.get(terrain_mesh_upsampler_id) {
                    Ok(t) => t,
                    Err(_) => unreachable!(),
                };

            rendered_tile.terrain_mesh_upsampler = None;
            // The result's handles move into the tile mesh below, so mark the
            // task consumed or its `on_remove` hook would free live buffers.
            commands
                .entity(terrain_mesh_upsampler_id)
                .insert((Deleted, WorkerTaskResultConsumed));

            let min_height = terrain_mesh_upsampler.min_height;
            let max_height = terrain_mesh_upsampler.max_height;
            let rtc_translation = terrain_mesh_upsampler.rtc_translation.unwrap_or_default();

            let vhandle = terrain_mesh_upsampler.geometry.vertices;
            let ihandle = terrain_mesh_upsampler.geometry.indices;
            let uvshandle = terrain_mesh_upsampler.geometry.uvs;
            let heights_handle = terrain_mesh_upsampler.heights;
            {
                if let Some(t) = qt.qt.get_mut(rendered_tile.tile_handle) {
                    t.cached_mesh_handle = Some(CachedMeshHandle {
                        vertices: vhandle,
                        indices: ihandle,
                        uvs: uvshandle,
                        heights: Some(heights_handle),
                        normals: terrain_mesh_upsampler.geometry.normals,
                        watermask: terrain_mesh_upsampler.watermask,
                    });
                    t.upsampled = true;
                };
            }

            attach_rendered(&mut commands, rendered_tile_id);

            let e = commands.spawn((
                TileMeshMarker {
                    handle: rendered_tile.tile_handle,
                    ready_parent_tile_handle: ready_parent_tile,
                },
                MeshBundle {
                    mesh: Mesh {
                        vertices: vhandle,
                        indices: ihandle,
                        uvs: uvshandle,
                        active: false,
                        render_order,
                        aabb: Aabb {
                            center: Transform::from_translation(-rtc_translation)
                                .transform_point(tile_aabb.center),
                            extents: tile_aabb.extents,
                        },
                        normals: terrain_mesh_upsampler.geometry.normals,
                        skirt_vertices: terrain_mesh_upsampler.geometry.skirt_vertices,
                        skirt_uvs: terrain_mesh_upsampler.geometry.skirt_uvs,
                        skirt_indices: terrain_mesh_upsampler.geometry.skirt_indices,
                        skirt_normals: terrain_mesh_upsampler.geometry.skirt_normals,
                        watermask: terrain_mesh_upsampler.watermask,
                    },
                    material: appearance,
                    object: ObjectBundle {
                        transform: Transform::from_translation(rtc_translation),
                        marker: Default::default(),
                    },
                },
            ));

            if let Some(cache) = tc.rendered_tile_caches.get_mut(&rendered_tile.tile_handle) {
                cache.mesh_entity = Some(e.id());
            } else {
                panic!("Mesh duplication error");
            };
            let tile = qt.qt.get_mut(rendered_tile.tile_handle).unwrap();
            let terrain_info = terrain_qt.qt.get_mut(rendered_tile.tile_handle).unwrap();
            postupdate_tile(tile, terrain_info, max_height, min_height);

            continue;
        }

        let terrain_req = terrain_req.unwrap();

        let terrain_mesh_constructor_id = match rendered_tile.terrain_mesh_constructor {
            Some(e) => e,
            None => {
                let terrain_mesh_constructor = commands
                    .spawn((
                        ConstructTerrainMeshWorkerTaskBundle::new(
                            ConstructTerrainMeshMarker,
                            ConstructTerrainMeshParameters {
                                tile_size: tile_size.unwrap(),
                                bytes_handle: terrain_req.handle,
                                tile_handle: rendered_tile.tile_handle,
                                skirt,
                                pole_sides,
                                skirt_exaggeration,
                                is_quantized_mesh,
                                geographic: qm_geographic,
                                tms: qm_tms,
                            },
                        ),
                        order.clone(),
                    ))
                    .id();
                rendered_tile.terrain_mesh_constructor = Some(terrain_mesh_constructor);
                continue;
            }
        };
        let terrain_mesh_constructor =
            match terrain_mesh_constructors.get(terrain_mesh_constructor_id) {
                Ok(t) => t,
                Err(_) => unreachable!(),
            };

        rendered_tile.terrain_mesh_constructor = None;
        // The result's handles move into the tile mesh below, so mark the
        // task consumed or its `on_remove` hook would free live buffers.
        commands
            .entity(terrain_mesh_constructor_id)
            .insert((Deleted, WorkerTaskResultConsumed));

        let min_height = terrain_mesh_constructor.min_height;
        let max_height = terrain_mesh_constructor.max_height;
        let rtc_translation = terrain_mesh_constructor.rtc_translation.unwrap_or_default();

        let vhandle = terrain_mesh_constructor.geometry.vertices;
        let ihandle = terrain_mesh_constructor.geometry.indices;
        let uvshandle = terrain_mesh_constructor.geometry.uvs;
        let heights_handle = terrain_mesh_constructor.heights;
        {
            if let Some(t) = qt.qt.get_mut(rendered_tile.tile_handle) {
                t.cached_mesh_handle = Some(CachedMeshHandle {
                    vertices: vhandle,
                    indices: ihandle,
                    uvs: uvshandle,
                    heights: Some(heights_handle),
                    normals: terrain_mesh_constructor.geometry.normals,
                    watermask: terrain_mesh_constructor.watermask,
                })
            };
        }

        attach_rendered(&mut commands, rendered_tile_id);

        let e = commands.spawn((
            TileMeshMarker {
                handle: rendered_tile.tile_handle,
                ready_parent_tile_handle: ready_parent_tile,
            },
            MeshBundle {
                mesh: Mesh {
                    vertices: vhandle,
                    indices: ihandle,
                    uvs: uvshandle,
                    active: false,
                    render_order,
                    aabb: Aabb {
                        center: Transform::from_translation(-rtc_translation)
                            .transform_point(tile_aabb.center),
                        extents: tile_aabb.extents,
                    },
                    normals: terrain_mesh_constructor.geometry.normals,
                    skirt_vertices: terrain_mesh_constructor.geometry.skirt_vertices,
                    skirt_uvs: terrain_mesh_constructor.geometry.skirt_uvs,
                    skirt_indices: terrain_mesh_constructor.geometry.skirt_indices,
                    skirt_normals: terrain_mesh_constructor.geometry.skirt_normals,
                    watermask: terrain_mesh_constructor.watermask,
                },
                material: appearance,
                object: ObjectBundle {
                    transform: Transform::from_translation(rtc_translation),
                    marker: Default::default(),
                },
            },
        ));

        if let Some(cache) = tc.rendered_tile_caches.get_mut(&rendered_tile.tile_handle) {
            cache.mesh_entity = Some(e.id());
        } else {
            panic!("Mesh duplication error");
        };

        let tile = qt.qt.get_mut(rendered_tile.tile_handle).unwrap();
        let terrain_info = terrain_qt.qt.get_mut(rendered_tile.tile_handle).unwrap();
        postupdate_tile(tile, terrain_info, max_height, min_height);
    }
}

pub fn update_layer(
    mut commands: Commands,
    updated: Query<(Entity, &UpdateRasterTileLayerMarker)>,
    mut layers: Query<&mut TilesLayer>,
) {
    for (e, u) in &updated {
        let layer_id = u.layer_id.clone();
        for mut layer in &mut layers {
            if layer.layer_id != layer_id {
                continue;
            }

            if let Some(a) = &mut layer.appearance {
                a.set(&u.appearance);
            }

            // Update elevation_heatmap_config if provided
            if u.elevation_heatmap_config.is_some() {
                layer.elevation_heatmap_config = u.elevation_heatmap_config.clone();
            }

            // Update hillshade_config if provided
            if u.hillshade_config.is_some() {
                layer.hillshade_config = u.hillshade_config.clone();
            }
        }
        commands.entity(e).despawn();
    }
}

pub fn delete_layer(
    mut commands: Commands,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut raster_qt: ResMut<navara_tile_component::RasterTileQuadtree>,
    raster_tc: Res<crate::raster::RasterTileCacheManager>,
    mut rendered_tiles: Query<&mut RenderedTile, With<Rendered>>,
    deleted: Query<(Entity, &DeleteRasterTileLayerMarker)>,
    layers: Query<(Entity, &TilesLayer, &Order)>,
) {
    if deleted.is_empty() {
        return;
    }

    for (e, u) in &deleted {
        let layer_id = u.0.clone();
        for (le, layer, _) in &layers {
            if layer.layer_id != layer_id {
                continue;
            }
            commands.entity(le).despawn();
            break;
        }
        commands.entity(e).despawn();
    }

    // The compaction below relies on `idx - removed_idx` to translate an
    // original sorted-layer index into its current (already-shifted) position.
    // That arithmetic is only correct when the indices are strictly increasing:
    // duplicates (e.g. two delete markers spawned for the same layer in one
    // frame) would either over-remove slots or underflow `usize`.
    //
    // Collecting the marker ids into a set and filtering the sorted layers in a
    // single pass yields strictly increasing, duplicate-free indices by
    // construction, so no later sort/dedup is needed (and it avoids the
    // per-layer linear scan over every marker).
    let deleted_ids: std::collections::HashSet<&String> =
        deleted.iter().map(|(_, u)| &u.0).collect();
    let deleted_layers: Vec<usize> = layers
        .iter()
        .sort::<&Order>()
        .enumerate()
        .filter_map(|(i, (_, layer, _))| deleted_ids.contains(&layer.layer_id).then_some(i))
        .collect();

    // Per-layer arrays are indexed by the sorted-layer position, so a deleted
    // layer's slot must be removed (shifting the rest down) from BOTH the
    // terrain-side hillshade array AND the raster-side texture array, or the two
    // sides fall out of alignment and `resolve_raster_texture` reads the wrong
    // layer — breaking layer (z) order.
    for rendered_tile in &mut rendered_tiles {
        let tile = qt.qt.get_mut(rendered_tile.tile_handle).unwrap();
        for (removed_idx, idx) in deleted_layers.iter().enumerate() {
            let target_idx = idx - removed_idx;

            if let Some(hill) = tile.hillshade_entity_ids.as_mut()
                && target_idx < hill.len()
                && let Some(e) = hill.remove(target_idx)
            {
                commands.entity(e).insert(Deleted);
            }
        }
    }

    // Compact the same slot out of every live raster tile's texture array.
    // `active_handles` covers the visited tiles (including the ancestors that
    // `resolve_raster_texture` can fall back to); the retention pool must be
    // compacted too — retained tiles keep their quadtree node and fragments
    // alive for a cheap revisit, so a stale slot layout would resolve the
    // deleted layer's texture for every layer after it once the camera
    // returns (wrong layer order on revisited tiles). A revisited handle
    // transiently sits in BOTH sets (until `enforce_memory_budget` purges its
    // retained entry) and must be compacted exactly once, or the shift
    // arithmetic removes a second, wrong slot.
    let active_handles = &raster_tc.active_handles;
    for handle in active_handles.iter().chain(
        raster_tc
            .retained
            .keys()
            .filter(|h| !active_handles.contains(h)),
    ) {
        let Some(raster_tile) = raster_qt.qt.get_mut(*handle) else {
            continue;
        };
        for (removed_idx, idx) in deleted_layers.iter().enumerate() {
            let target_idx = idx - removed_idx;

            if let Some(tex) = raster_tile.texture_fragment_entity_ids.as_mut()
                && target_idx < tex.len()
                && let Some(e) = tex.remove(target_idx)
            {
                commands.entity(e).insert(Deleted);
            }
        }
    }
}

/// Applies a terrain layer appearance update to the live scene.
///
/// Terrain has no per-layer geometry: the tile meshes are the shared globe and
/// the terrain material fields (`cast_shadow`/`receive_shadow`/`show_bounding_box`)
/// are baked once into each tile's [`RasterTileInternalMaterial`] in
/// [`transfer_mesh`]. `force_update` re-traversal does not re-bake existing tiles
/// (its gate is `Added<RenderedTile> || Without<Rendered>`), so a material-only
/// update must mutate the live tile materials directly here. Geometry-shaping
/// fields (`skirt`/`skirt_exaggeration`) are stored on the layer for future tiles
/// but are not re-applied to existing meshes. A source change is not handled here
/// — it rebuilds the layer (see `Core::update_layer`).
pub fn update_terrain_layer(
    mut commands: Commands,
    updated: Query<(Entity, &UpdateTerrainLayerMarker)>,
    mut layers: Query<&mut TerrainLayer>,
    mut tile_materials: Query<
        &mut RasterTileInternalMaterial,
        (With<TileMeshMarker>, Without<Deleted>),
    >,
) {
    for (e, u) in &updated {
        let mut matched = false;
        for mut layer in &mut layers {
            if layer.layer_id != u.layer_id {
                continue;
            }
            // Store the new appearance so future tiles bake the updated config.
            layer.appearance = Some(u.material.clone());
            matched = true;
        }

        // Re-apply the render-only fields to every already-baked terrain tile.
        // `Changed<RasterTileInternalMaterial>` (in `navara_mesh`) triggers the
        // redraw, so only touch a material when a value actually differs —
        // otherwise a no-op update marks every tile `Changed` and forces a
        // whole-globe redraw that buys nothing.
        if matched {
            let cast_shadow = Some(u.material.cast_shadow);
            let receive_shadow = Some(u.material.receive_shadow);
            let lit = u.material.lit;
            let show_bounding_box = Some(u.material.show_bounding_box);
            for mut material in &mut tile_materials {
                if material.cast_shadow != cast_shadow
                    || material.receive_shadow != receive_shadow
                    || material.lit != lit
                    || material.show_bounding_box != show_bounding_box
                {
                    material.cast_shadow = cast_shadow;
                    material.receive_shadow = receive_shadow;
                    material.lit = lit;
                    material.show_bounding_box = show_bounding_box;
                }
            }
        }

        commands.entity(e).despawn();
    }
}

/// Keeps the globe in sync when the terrain layer set changes.
///
/// Terrain tiling is a single global (the tile meshes are the shared globe
/// geometry, not owned by the terrain layer). Whenever a terrain layer is torn
/// down OR (re-)added — an outright delete, a re-add after delete, or the
/// delete+re-add halves of a source switch / `updateSource` reset — every
/// already-rendered tile must be reset so it re-bakes against the current terrain.
/// Handling both the delete marker AND `Added<TerrainLayer>` in one system means
/// the reset runs exactly once per change (a same-frame delete+add resets once, a
/// two-frame reset re-runs on the re-add frame; the re-add is also where
/// `init_globe_tiling` rebuilds the tiling if the new source's scheme differs).
///
/// The reset is required because `transfer_mesh` bakes each tile's mesh exactly
/// once (its gate is `Added<RenderedTile> || Without<Rendered>`, and `Rendered` is
/// never otherwise removed), so an already-rendered tile keeps its stale geometry
/// across a terrain change. We mirror how `clear_caches` evicts a stale tile —
/// mark its mesh `Deleted`, despawn the `RenderedTile`, drop its cache entries, and
/// free its cached mesh + DEM data — but KEEP the quadtree tile (removing roots
/// would break traversal, since `init_globe_tiling` re-seeds the roots for the
/// current scheme), clearing `terrain_data` so `request_terrain_data` re-issues
/// instead of short-circuiting on the stale (destroyed) entry. In-flight
/// (requested-but-not-yet-rendered) tiles are torn down the same way so a pending
/// fetch against the old source can't complete and bake stale geometry.
///
/// When a delete removes the LAST terrain layer, the globe falls back to the
/// default tiling scheme (WebMercator) so a terrain-less map traverses the correct
/// roots; a differing scheme means rebuilding the tiling (drained here, re-seeded
/// by `init_globe_tiling`).
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn sync_terrain_layer_changes(
    mut commands: Commands,
    mut tc: ResMut<TileCacheManager>,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut terrain_qt: ResMut<TerrainInformationQuadtree>,
    mut buf: ResMut<BufferStore>,
    mut globe: ResMut<navara_globe::Globe>,
    deleted: Query<(Entity, &DeleteTerrainLayerMarker)>,
    added: Query<(), Added<TerrainLayer>>,
    layers: Query<(Entity, &TerrainLayer)>,
    mut rendered_tiles: Query<(Entity, &mut RenderedTile)>,
    meshes: Query<&Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    mut raster_revision: ResMut<crate::raster::RasterResolveRevision>,
) {
    if deleted.is_empty() && added.is_empty() {
        return;
    }

    // Despawn the torn-down terrain layer(s) — dropping their `LiveLayer` tag so
    // `flush_layer_reloads` can observe the teardown — and consume the markers.
    // A source switch re-adds with the SAME `layer_id`, but the re-add is deferred
    // until `flush_layer_reloads` sees this teardown complete (a later frame), so
    // the re-added entity does not exist yet and cannot be matched here.
    for (e, u) in &deleted {
        for (le, layer) in &layers {
            if layer.layer_id != u.layer_id {
                continue;
            }
            commands.entity(le).despawn();
            break;
        }
        commands.entity(e).despawn();
    }

    // Fall back to the default tiling scheme when a TRUE user delete removes the
    // last terrain layer. A source switch is a delete + queued re-add (flagged
    // `reset` on the marker); skipping it here avoids draining and flipping the
    // scheme to default only to rebuild for the new source moments later — the
    // re-add lets `init_globe_tiling` adopt the new source's scheme via
    // `Added<TerrainLayer>`. The despawns above are deferred, so compute "no
    // terrain remains" from the live layers minus the ids being deleted. Only
    // rebuild when the scheme actually changes: each tile bakes its extent from the
    // scheme at creation, so drop every tile here and let `init_globe_tiling`
    // re-seed the default roots.
    let any_reset = deleted.iter().any(|(_, u)| u.reset);
    if added.is_empty() && !any_reset {
        let terrain_remains = layers
            .iter()
            .any(|(_, l)| !deleted.iter().any(|(_, u)| u.layer_id == l.layer_id));
        let default_scheme = navara_globe::Globe::default().tiling_scheme;
        if !terrain_remains && default_scheme != globe.tiling_scheme {
            for mut tile in qt.qt.drain() {
                tile.destroy(&mut commands, &mut buf);
            }
            let _ = terrain_qt.qt.drain();
            globe.tiling_scheme = default_scheme;
            // Falling back to WebMercator switches raster layers from baked to
            // direct drape slots; bump so the web re-queries the (now empty)
            // baked states and `snapshot_raster_bake_inputs` clears its snapshot.
            raster_revision.bump();
        }
    }

    // Reset every rendered tile so the next (forced) traversal re-spawns it and
    // `transfer_mesh` re-bakes it against the now-current terrain. (When the scheme
    // fallback above drained the tiling, `qt`/`terrain_qt` lookups are already gone
    // and this only cleans up the ECS-side rendered state and caches.)
    for (rendered_tile_entity, mut rendered_tile) in rendered_tiles.iter_mut() {
        let handle = rendered_tile.tile_handle;

        if let Some(cache) = tc.rendered_tile_caches.get(&handle)
            && let Some(mesh_entity) = cache.mesh_entity
        {
            if let Ok(mesh) = meshes.get(mesh_entity) {
                free_mesh_only_buffers(mesh, &mut buf);
            }
            commands.entity(mesh_entity).insert(Deleted);
        }
        commands.entity(rendered_tile_entity).despawn();
        tc.rendered_tile_caches.remove(&handle);
        tc.requested_tile_caches.remove(&handle);

        // Drop pending terrain-mesh worker tasks tied to this tile.
        rendered_tile.destroy(&mut commands);

        if let Some(tile) = qt.qt.get_mut(handle) {
            tile.destroy(&mut commands, &mut buf);
            tile.terrain_data = None;
        }
        // Stale per-tile elevation metadata; re-seeded on the next bake.
        terrain_qt.qt.remove(handle);
    }

    // Tear down in-flight (requested-but-not-yet-rendered) tiles the same way. The
    // rendered-tile loop above already dropped its own handles from
    // `requested_tile_caches`, leaving only the in-flight ones here. Without this,
    // a pending fetch against the OLD source would complete after the reset and
    // bake stale terrain. The quadtree tile is kept (roots must survive traversal)
    // with `terrain_data` cleared so `request_terrain_data` re-issues.
    let in_flight: Vec<_> = tc.requested_tile_caches.drain().collect();
    for handle in in_flight {
        if let Some(tile) = qt.qt.get_mut(handle) {
            tile.destroy(&mut commands, &mut buf);
            tile.terrain_data = None;
        }
    }

    tc.force_update = true;
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn update_mesh_material(
    mut tc: ResMut<TileCacheManager>,
    qt: ResMut<TerrainTileQuadtree>,
    raster_qt: Res<navara_tile_component::RasterTileQuadtree>,
    source_store: Res<navara_source::SourceStore>,
    rendered_tiles: Query<(&RenderedTile, &OrderByDistance), With<Rendered>>,
    mut texture_fragment: ParamSet<(TileTextureFragmentQuery, ChangedTileTextureFragmentQuery)>,
    mut data_requesters: ParamSet<(
        Query<&DataRequester>,
        Query<
            &DataRequester,
            (
                With<TileTextureFragmentMarker>,
                Or<(Added<DataRequester>, Changed<DataRequester>)>,
            ),
        >,
    )>,
    mut tile_layers: ParamSet<(
        Query<(&TilesLayer, &Order)>,
        Query<&TilesLayer, Changed<TilesLayer>>,
        RemovedComponents<TilesLayer>,
    )>,
    mut appearances: Query<
        (
            &mut TileMeshMarker,
            &mut Mesh,
            &mut RasterTileInternalMaterial,
        ),
        Without<Deleted>,
    >,
) {
    let are_tile_layers_updated = !tile_layers.p1().is_empty();
    let are_tile_layers_removed = !tile_layers.p2().is_empty();
    let are_texture_fragments_updated = !texture_fragment.p1().is_empty();
    let are_data_requesters_updated = !data_requesters.p1().is_empty();
    let has_tiles_needing_material_update = tc
        .rendered_tile_caches
        .values()
        .any(|cache| cache.needs_material_update);

    if !are_tile_layers_updated
        && !are_texture_fragments_updated
        && !are_tile_layers_removed
        && !are_data_requesters_updated
        && !has_tiles_needing_material_update
    {
        return;
    }

    let tile_layers = tile_layers.p0();
    let texture_fragment = texture_fragment.p0();
    let data_requesters = data_requesters.p0();

    // Sort the layer list once per run; the loop below runs per rendered tile.
    let sorted_layers: Vec<_> = tile_layers.iter().sort::<&Order>().collect();

    // Every branch below emits exactly one composite slot per layer: hillshade
    // is terrain-side, Geographic drapes bake their N overlapping WM tiles into
    // one render target, and a WebMercator drape is a single identity/ancestor
    // tile by construction.
    let max_slots = sorted_layers.len();

    for (rendered_tile, _) in rendered_tiles.iter().sort::<&OrderByDistance>() {
        let Some(tile) = qt.qt.get(rendered_tile.tile_handle) else {
            continue;
        };

        let Some(cached_rendered_tile) = tc.rendered_tile_caches.get(&rendered_tile.tile_handle)
        else {
            continue;
        };

        let Some((tile_mesh_marker, _, appearance)) = cached_rendered_tile
            .mesh_entity
            .and_then(|e| appearances.get(e).ok())
        else {
            continue;
        };

        let needs_update = are_tile_layers_removed
            // If it has a different parent tile, it should be updated.
            || tile_mesh_marker.ready_parent_tile_handle
                != cached_rendered_tile.ready_parent_tile_handle;

        // Per-composite-slot arrays, one slot per layer: hillshade resolves
        // terrain-side, a Geographic drape binds its baked render target, and a
        // WebMercator drape is a single identity (or ancestor-fallback) tile.
        // Layers are emitted in sorted order, so z-stacking is preserved.
        let terrain_extent = tile.extent;
        // WebMercator raster draped on a Geographic terrain tile must be
        // reprojected (Mercator) on the latitude axis in the composite shader;
        // the linear affine UV alone stretches it.
        let terrain_is_geographic = tile.tiling_scheme.is_geographic();
        let mut shows = Vec::with_capacity(max_slots);
        let mut opacities = Vec::with_capacity(max_slots);
        let mut colors = Vec::with_capacity(max_slots);
        let mut is_elevation_heatmaps = Vec::with_capacity(max_slots);
        let mut is_hillshades = Vec::with_capacity(max_slots);
        let mut layer_fragments: Vec<Option<Entity>> = Vec::with_capacity(max_slots);
        let mut layer_uv_transforms: Vec<Option<TileUvTransform>> = Vec::with_capacity(max_slots);
        let mut layer_reproject = Vec::with_capacity(max_slots);
        let mut elevation_heatmap_config = None;
        let mut hillshade_config = None;
        // DEM decoder is fetch config: read live from the source, not the layer.
        let mut heatmap_elevation_decoder = None;
        let mut hillshade_elevation_decoder = None;

        // Resolve a raster layer's DEM decoder live from its referenced source.
        let layer_decoder = |l: &TilesLayer| {
            l.source_id
                .as_deref()
                .and_then(|id| source_store.get(id))
                .and_then(|s| s.elevation_decoder().copied())
        };

        for (i, (l, _)) in sorted_layers.iter().enumerate() {
            let a = l.appearance().unwrap();
            let is_heatmap = l.elevation_heatmap_config.is_some();

            if l.hillshade_config.is_some() {
                let own_entity = tile
                    .hillshade_entity_ids
                    .as_ref()
                    .and_then(|ids| ids.get(i).copied().flatten());
                let own_ready = own_entity
                    .is_some_and(|e| TerrainTile::is_hillshade_entity_ready(e, &data_requesters));
                let (entity, uv, ready) = if own_ready {
                    (own_entity, None, true)
                } else if let Some(parent) = cached_rendered_tile
                    .layer_parents
                    .as_ref()
                    .and_then(|v| v.get(i).copied().flatten())
                {
                    // Cached ancestor fallback: re-check readiness since the
                    // parent's hillshade may have been pruned across frames.
                    let ready =
                        TerrainTile::is_hillshade_entity_ready(parent.entity, &data_requesters);
                    (
                        Some(parent.entity),
                        Some(uv_transform(tile.coords, parent.zoom)),
                        ready,
                    )
                } else {
                    (None, None, false)
                };

                shows.push(ready && a.show);
                opacities.push(a.opacity.clamp(0., 1.));
                colors.push(a.color);
                is_elevation_heatmaps.push(false);
                is_hillshades.push(true);
                layer_fragments.push(entity);
                layer_uv_transforms.push(uv);
                // Hillshade is terrain-side; cross-scheme reprojection is out of
                // scope for it, so its slot is never reprojected.
                layer_reproject.push(false);

                if hillshade_config.is_none() {
                    hillshade_config = l.hillshade_config.clone();
                    hillshade_elevation_decoder = layer_decoder(l);
                }
            } else if terrain_is_geographic {
                // Baked drape (non-hillshade raster on Geographic terrain, elevation
                // heatmaps included): the N:M overlapping WM tiles are baked into ONE
                // render target per layer on the web side (resolved by
                // `get_raster_tiles` — mirroring the texturized-vector drape), so the
                // layer costs exactly one composite slot instead of one per
                // overlapping tile. The k-th baked slot emitted here pairs with
                // `layer_ordinal == k` in the resolved states: both come from the same
                // sorted layer list with the same non-hillshade filter.
                //
                // fragment None + identity UV: the web binds the baked render target
                // (spanning the terrain tile's Mercator-projected extent) to this slot;
                // `layer_reproject` with identity UV reprojects it by exactly the
                // terrain `[south, north]` band, like a vector drape slot. Heatmap
                // slots reproject the same way — the bake copies the encoded DEM
                // texels raw (nearest, no color conversion), so the composite decode
                // stays valid.
                shows.push(a.show);
                opacities.push(a.opacity.clamp(0., 1.));
                colors.push(a.color);
                is_elevation_heatmaps.push(is_heatmap);
                is_hillshades.push(false);
                layer_fragments.push(None);
                layer_uv_transforms.push(None);
                layer_reproject.push(true);

                if is_heatmap && elevation_heatmap_config.is_none() {
                    elevation_heatmap_config = l.elevation_heatmap_config.clone();
                    heatmap_elevation_decoder = layer_decoder(l);
                }
            } else {
                // WebMercator terrain (the Geographic case is the baked branch
                // above): the drape is same-scheme, so the resolve yields at
                // most one tile — the terrain tile's identity WM tile, or its
                // nearest loaded ancestor — and never reprojects.
                let lng_span = (terrain_extent.east - terrain_extent.west).val();
                // Max zoom now lives on the referenced source.
                let max_zoom = l
                    .source_id
                    .as_deref()
                    .and_then(|id| source_store.get(id))
                    .map(|s| s.max_zoom())
                    .unwrap_or(20);
                let target_z = navara_core::wm_zoom_for_lng_span(lng_span, max_zoom);
                // The raster pull only returns a fragment that has loaded.
                let resolved = crate::raster::resolve_raster_texture(
                    &raster_qt,
                    &terrain_extent,
                    target_z,
                    i,
                    &texture_fragment,
                );
                if let Some(r) = resolved {
                    shows.push(a.show);
                    opacities.push(a.opacity.clamp(0., 1.));
                    colors.push(a.color);
                    is_elevation_heatmaps.push(is_heatmap);
                    is_hillshades.push(false);
                    layer_fragments.push(Some(r.entity));
                    layer_uv_transforms.push(Some(r.uv_transform));
                    layer_reproject.push(false);
                }

                if is_heatmap && elevation_heatmap_config.is_none() {
                    elevation_heatmap_config = l.elevation_heatmap_config.clone();
                    heatmap_elevation_decoder = layer_decoder(l);
                }
            }
        }

        let terrain_lat_range = terrain_is_geographic.then(|| {
            [
                terrain_extent.south.val() as f32,
                terrain_extent.north.val() as f32,
            ]
        });

        let needs_update = needs_update
            || cached_rendered_tile.needs_material_update
            || appearance.texture_fragments.as_ref() != Some(&layer_fragments)
            || appearance.shows != shows
            || appearance.opacities != opacities
            || appearance.colors != colors
            || appearance.is_elevation_heatmaps != is_elevation_heatmaps
            || appearance.is_hillshades != is_hillshades
            || appearance.layer_uv_transforms != layer_uv_transforms
            || appearance.layer_reproject != layer_reproject
            || appearance.terrain_lat_range != terrain_lat_range
            || appearance.elevation_heatmap_config != elevation_heatmap_config
            || appearance.hillshade_config != hillshade_config
            || appearance.heatmap_elevation_decoder != heatmap_elevation_decoder
            || appearance.hillshade_elevation_decoder != hillshade_elevation_decoder;

        if !needs_update {
            continue;
        }

        let Some((mut tile_mesh_marker, _mesh, mut appearance)) = cached_rendered_tile
            .mesh_entity
            .and_then(|e| appearances.get_mut(e).ok())
        else {
            continue;
        };

        tile_mesh_marker.ready_parent_tile_handle = cached_rendered_tile.ready_parent_tile_handle;

        appearance.texture_fragments = Some(layer_fragments);

        appearance.shows = shows;
        appearance.opacities = opacities;
        appearance.colors = colors;
        appearance.is_elevation_heatmaps = is_elevation_heatmaps;
        appearance.elevation_heatmap_config = elevation_heatmap_config;
        appearance.heatmap_elevation_decoder = heatmap_elevation_decoder;
        appearance.is_hillshades = is_hillshades;
        appearance.hillshade_config = hillshade_config;
        appearance.hillshade_elevation_decoder = hillshade_elevation_decoder;
        appearance.layer_uv_transforms = layer_uv_transforms;
        appearance.layer_reproject = layer_reproject;
        appearance.terrain_lat_range = terrain_lat_range;

        // Clear needs_material_update flag now that material has been updated
        if let Some(cache) = tc.rendered_tile_caches.get_mut(&rendered_tile.tile_handle) {
            cache.needs_material_update = false;
        }
    }
}

pub fn handle_prepared_mesh_event(
    mut events: MessageReader<MeshPreparedEvent>,
    mut tc: ResMut<TileCacheManager>,
) {
    for e in events.read() {
        if let Some(t) = tc.rendered_tile_caches.get_mut(&e.tile_handle) {
            t.mesh_prepared = true;
        } else {
            continue;
        }
        tc.is_updated_in_this_frame = true;
    }
}

#[allow(clippy::type_complexity)]
pub fn handle_tile_worker_task_completed(
    mut tc: ResMut<TileCacheManager>,
    worker_tasks: Query<
        (),
        (
            Or<(
                With<ConstructTerrainMeshMarker>,
                With<UpsampleTerrainMeshMarker>,
            )>,
            With<WorkerTaskCompleted>,
        ),
    >,
) {
    if worker_tasks.is_empty() {
        return;
    }
    tc.is_updated_in_this_frame = true;
}

/// Assigns a fresh topmost `Order` to newly added tiles layers. A layer spawned
/// WITH an `Order` already — the reset re-add restoring its pre-teardown
/// z-position (see `AddLayerEvent::restore_order`) — is left untouched, so a
/// source update does not move the layer to the top like a user add would.
pub fn add_order_to_tiles_layer(
    mut commands: Commands,
    tiles_layers: Query<Entity, (Added<TilesLayer>, Without<Order>)>,
    existing_orders: Query<&Order, With<TilesLayer>>,
) {
    // Find the maximum existing order value
    let max_order = existing_orders.iter().map(|o| o.0).max().unwrap_or(0);

    // Assign incremental order values to each new layer
    for (i, entity) in tiles_layers.iter().enumerate() {
        let order_value = max_order + i + 1;
        commands.entity(entity).insert(Order(order_value));
    }
}

/// Frees the BufferStore handles that exist only on the `Mesh` component
/// (skirts). The vertex/index/uv/normal/watermask handles are shared with
/// the quadtree tile's `CachedMeshHandle` (the watermask is kept there for
/// upsample propagation) and freed by `TerrainTile::destroy`; nothing frees
/// the mesh-only handles when the mesh entity despawns, so every mesh
/// teardown must call this or they leak.
pub(crate) fn free_mesh_only_buffers(mesh: &Mesh, buf: &mut BufferStore) {
    for handle in [
        mesh.skirt_vertices,
        mesh.skirt_uvs,
        mesh.skirt_indices,
        mesh.skirt_normals,
    ]
    .into_iter()
    .flatten()
    {
        buf.remove(&handle);
    }
}

/// Destroys a rendered terrain tile: marks its mesh `Deleted`, despawns the
/// rendered-tile entity, and removes the tile from both quadtrees. This is
/// the single destroy path shared by `clear_caches` (budget disabled) and
/// `enforce_memory_budget` (eviction).
#[allow(clippy::too_many_arguments)]
fn destroy_terrain_tile(
    commands: &mut Commands,
    tc: &mut TileCacheManager,
    qt: &mut TerrainTileQuadtree,
    terrain_qt: &mut TerrainInformationQuadtree,
    buf: &mut BufferStore,
    meshes: &Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    rendered_tile_entity_id: Entity,
    rendered_tile: &mut RenderedTile,
) {
    if let Some(cache) = tc.rendered_tile_caches.get(&rendered_tile.tile_handle)
        && let Some(mesh_entity) = cache.mesh_entity
    {
        if let Ok(mesh) = meshes.get(mesh_entity) {
            free_mesh_only_buffers(mesh, buf);
        }
        commands.entity(mesh_entity).insert(Deleted);
    }
    commands.entity(rendered_tile_entity_id).despawn();
    tc.rendered_tile_caches.remove(&rendered_tile.tile_handle);
    tc.requested_tile_caches.remove(&rendered_tile.tile_handle);
    tc.retained.remove(&rendered_tile.tile_handle);

    rendered_tile.destroy(commands);
    qt.qt
        .remove(rendered_tile.tile_handle)
        .unwrap()
        .destroy(commands, buf);

    terrain_qt.qt.remove(rendered_tile.tile_handle);
}

/// Attaches a [`TileCost`] to newly spawned terrain meshes so the memory
/// ledger tracks their GPU footprint. The JS-side GPU buffers mirror the
/// mesh's BufferStore contents, so their byte lengths are the estimate.
///
/// The `drape` contribution is seeded with the composite-atlas cost, which
/// EVERY terrain tile pays: the atlas is acquired eagerly in the JS `TileMesh`
/// constructor (per terrain tile, regardless of whether it drapes any vector
/// layers), so a raster-only terrain scene still holds one atlas per tile. If
/// this seed were omitted, that ~3MB/tile would be invisible to the budget
/// (JS only reports the atlas via `report_terrain_drape_gpu_bytes` once the
/// tile actually drapes something), and a typical raster+terrain mobile scene
/// would silently exceed the budget.
///
/// When the tile later drapes clamp-to-ground vectors, JS reports the full
/// drape footprint (composite atlas + one render target per live layer) via
/// [`report_terrain_drape_gpu_bytes`], which REPLACES the `drape` term
/// wholesale — its value already includes the atlas, so seeding the atlas here
/// never double-counts. See [`TerrainTileGpuCost`].
#[allow(clippy::type_complexity)]
pub fn attach_terrain_mesh_cost(
    mut commands: Commands,
    buf: Res<BufferStore>,
    ledger: Res<MemoryLedger>,
    mut estimates: ResMut<ReserveEstimates>,
    meshes: Query<(Entity, &Mesh), (With<TileMeshMarker>, Added<Mesh>)>,
) {
    for (entity, mesh) in &meshes {
        let handles = [
            Some(mesh.vertices),
            Some(mesh.indices),
            Some(mesh.uvs),
            mesh.normals,
            mesh.skirt_vertices,
            mesh.skirt_uvs,
            mesh.skirt_indices,
            mesh.skirt_normals,
            mesh.watermask,
        ];
        let mesh_bytes: u64 = handles
            .into_iter()
            .flatten()
            .filter_map(|h| buf.get(&h).map(|b| b.byte_len() as u64))
            .sum();
        // The mesh is handed to Three.js and uploaded to the GPU. Three.js now
        // releases the CPU-side typed array via `onUpload` after the upload
        // (see the web `releaseGeometryArraysAfterUpload`), so only the GPU
        // copy stays resident (factor 1). The WASM `BufferStore` copy kept for
        // upsampling is counted separately in `cpu_bytes`.
        let geometry = mesh_bytes.saturating_mul(GPU_GEOMETRY_RESIDENCY_FACTOR);
        // Seed `drape` with the composite atlas every terrain tile pays (see
        // the doc comment); `report_terrain_drape_gpu_bytes` overwrites it with
        // the measured atlas+RT total once the tile drapes, so no double-count.
        let cost = TerrainTileGpuCost {
            geometry,
            drape: ledger.cost_hints.atlas_tile_bytes,
        };
        commands.entity(entity).insert((
            cost,
            TileCost {
                cpu: 0,
                gpu_est: cost.total(),
            },
        ));
        // Feed the terrain reservation estimator with the landed actual cost
        // (geometry + atlas) — this is what the dispatch-time `ReservedCost`
        // was standing in for. Re-meshes (e.g. upsample → real data) record
        // again, which is fine: the EMA tracks the cost of meshes currently
        // being produced.
        estimates.record(ReserveKey::Terrain, cost.total());
    }
}

/// Clears tile caches for tiles that are no longer visible.
///
/// When a memory budget is set, non-visited tiles are deactivated and moved
/// to the retention pool instead of being destroyed; `enforce_memory_budget`
/// evicts them later if the budget is exceeded. Retained terrain tiles keep
/// their quadtree nodes, so they stay valid as upsample sources and for
/// height queries.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn clear_caches(
    mut commands: Commands,
    ledger: Res<MemoryLedger>,
    mut tc: ResMut<TileCacheManager>,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut terrain_qt: ResMut<TerrainInformationQuadtree>,
    mut buf: ResMut<BufferStore>,
    mut rendered_tiles: Query<(Entity, &mut RenderedTile, &OrderByDistance)>,
    tile_costs: Query<&TileCost>,
    mut meshes: Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
) {
    // If the budget was disabled at runtime (`setCacheBytes(undefined)`),
    // retained terrain tiles would otherwise leak forever: the loop below only
    // deactivates newly-stale tiles, and `enforce_memory_budget` returns early
    // with no budget, so nothing ever destroys the retention pool. Drain it
    // here to restore the original destroy-on-unvisited behavior. Mirrors
    // `clear_raster_caches`; runs regardless of `is_updated_in_this_frame` so
    // the drain is not deferred until the next traversal on an idle page.
    if !ledger.enabled() && !tc.retained.is_empty() {
        let retained: Vec<TileHandle> = tc.retained.keys().copied().collect();
        for handle in retained {
            let Some(entity) = tc
                .rendered_tile_caches
                .get(&handle)
                .map(|cache| cache.rendered_tile_entity)
            else {
                // No rendered tile backing this entry; just drop it.
                tc.retained.remove(&handle);
                continue;
            };
            let Ok((_, mut rendered_tile, _)) = rendered_tiles.get_mut(entity) else {
                tc.retained.remove(&handle);
                continue;
            };
            destroy_terrain_tile(
                &mut commands,
                &mut tc,
                &mut qt,
                &mut terrain_qt,
                &mut buf,
                &meshes,
                entity,
                &mut rendered_tile,
            );
        }
    }

    if !tc.is_updated_in_this_frame {
        tc.is_updated_in_this_frame = false;
        return;
    }
    tc.is_updated_in_this_frame = false;

    for (rendered_tile_entity_id, mut rendered_tile, _) in
        rendered_tiles.iter_mut().sort::<&OrderByDistance>().rev()
    {
        let visited_at = {
            let tile = qt.qt.get(rendered_tile.tile_handle).unwrap();
            tile.visited_at
        };

        if tc.last_rendered_frame <= visited_at + 1 {
            continue;
        }

        if !tc
            .rendered_tile_caches
            .contains_key(&rendered_tile.tile_handle)
        {
            continue;
        }

        if ledger.enabled() {
            // Retain: hide the mesh but keep the entity, the quadtree nodes,
            // and the terrain data alive so a revisit reactivates the tile
            // without refetching.
            if !tc.retained.contains_key(&rendered_tile.tile_handle) {
                tc.activate_rendered_tile(&rendered_tile.tile_handle, &mut meshes, false);
                let cost = tc
                    .rendered_tile_caches
                    .get(&rendered_tile.tile_handle)
                    .and_then(|cache| cache.mesh_entity)
                    .and_then(|e| tile_costs.get(e).ok())
                    .copied()
                    .unwrap_or_default();
                let retained_at = tc.last_rendered_frame;
                tc.retained.insert(
                    rendered_tile.tile_handle,
                    RetainedEntry { retained_at, cost },
                );
            }
            continue;
        }

        destroy_terrain_tile(
            &mut commands,
            &mut tc,
            &mut qt,
            &mut terrain_qt,
            &mut buf,
            &meshes,
            rendered_tile_entity_id,
            &mut rendered_tile,
        );
    }

    let mut removed_handles = vec![];
    for handle in tc.requested_tile_caches.iter() {
        let tile_handle = *handle;

        // Retained tiles keep their `requested_tile_caches` entry; their
        // quadtree node must stay alive until eviction. Rendered tiles are
        // handled (retained or destroyed) by the loop above.
        if tc.retained.contains_key(&tile_handle)
            || tc.rendered_tile_caches.contains_key(&tile_handle)
        {
            continue;
        }

        let visited_at = {
            let tile = qt.qt.get(tile_handle).unwrap();
            tile.visited_at
        };

        if tc.last_rendered_frame <= visited_at + 1 {
            continue;
        }

        qt.qt
            .remove(tile_handle)
            .unwrap()
            .destroy(&mut commands, &mut buf);

        removed_handles.push(tile_handle);
    }

    for removed in removed_handles {
        tc.requested_tile_caches.remove(&removed);
    }
}

/// Evicts retained terrain tiles, oldest-visited first, until usage drops to
/// the hysteresis target. Runs right after `clear_caches`.
#[allow(clippy::too_many_arguments)]
pub fn enforce_memory_budget(
    mut commands: Commands,
    mut ledger: ResMut<MemoryLedger>,
    pressure: Res<navara_memory::SsePressure>,
    frame: Res<FrameManager>,
    mut tc: ResMut<TileCacheManager>,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut terrain_qt: ResMut<TerrainInformationQuadtree>,
    mut buf: ResMut<BufferStore>,
    mut rendered_tiles: Query<(Entity, &mut RenderedTile, &OrderByDistance)>,
    meshes: Query<&mut Mesh, (With<TileMeshMarker>, Without<Deleted>)>,
    tile_costs: Query<&TileCost>,
) {
    // Purge entries that were revisited (traversal reactivated them) or
    // whose tile no longer exists. `survives_purge` shares the one-frame
    // revisit grace with the other layer caches (see `navara_memory::eviction`).
    let last_rendered_frame = tc.last_rendered_frame;
    let rendered_tile_caches = std::mem::take(&mut tc.rendered_tile_caches);
    tc.retained.retain(|handle, _| {
        let Some(tile) = qt.qt.get(*handle) else {
            return false;
        };
        rendered_tile_caches.contains_key(handle)
            && navara_memory::eviction::survives_purge(tile.visited_at, last_rendered_frame)
    });
    tc.rendered_tile_caches = rendered_tile_caches;

    if ledger.budget_bytes.is_none() {
        return;
    }

    // While the load gate is closed, evict down to the reopen target even when
    // not over budget, or usage stranded in the hysteresis band would keep the
    // gate closed (and all new tile loads blocked) forever.
    let usage_est = ledger.usage(buf.total_bytes() as u64);
    if !ledger.needs_eviction(usage_est, pressure.load_gate_closed) {
        return;
    }

    let current_frame = frame.rendered_frame();

    // Speculative prefetch meshes (spawned for horizon-occluded tiles, never
    // shown — see `prefetch_occluded_tile`) go first: dropping one costs at
    // most a re-prefetch once headroom returns (the prefetch gate stays
    // closed at this usage level, so eviction cannot kick off a refetch
    // loop), while dropping a retained tile loses zoom history a revisit
    // would reuse. Deepest first — coarse cover protects the most area per
    // byte.
    let mut prefetched: Vec<(TileHandle, usize, u64)> = tc
        .rendered_tile_caches
        .iter()
        .filter(|(handle, cache)| {
            cache.prefetched
                && !tc.retained.contains_key(handle)
                // Never touch a mesh that is on screen.
                && !cache
                    .mesh_entity
                    .is_some_and(|e| meshes.get(e).is_ok_and(|m| m.active))
        })
        .filter_map(|(handle, cache)| {
            let tile = qt.qt.get(*handle)?;
            let gpu_est = cache
                .mesh_entity
                .and_then(|e| tile_costs.get(e).ok())
                .map(|c| c.gpu_est)
                .unwrap_or_default();
            Some((*handle, tile.coords.z, gpu_est))
        })
        .collect();
    prefetched.sort_by_key(|b| std::cmp::Reverse(b.1));

    let mut candidates: Vec<(TileHandle, usize, f64, u64)> = tc
        .retained
        .iter()
        .filter(|(_, entry)| {
            navara_memory::eviction::is_evictable(entry.retained_at, current_frame)
        })
        .filter_map(|(handle, entry)| {
            let tile = qt.qt.get(*handle)?;
            let cache = tc.rendered_tile_caches.get(handle)?;
            let distance = rendered_tiles
                .get(cache.rendered_tile_entity)
                .map(|(_, _, order)| order.distance)
                .unwrap_or(0.);
            Some((*handle, tile.visited_at, distance, entry.cost.gpu_est))
        })
        .collect();

    // Oldest visit first; evict the farthest tiles first among equals.
    candidates.sort_by(|a, b| navara_memory::eviction::order((a.1, a.2), (b.1, b.2)));

    let mut budget = navara_memory::eviction::EvictBudget::new(usage_est, ledger.evict_target());
    for (handle, gpu_est) in prefetched
        .into_iter()
        .map(|(handle, _, gpu_est)| (handle, gpu_est))
        .chain(
            candidates
                .into_iter()
                .map(|(handle, _, _, gpu_est)| (handle, gpu_est)),
        )
    {
        if !budget.over_target() {
            break;
        }

        let Some(entity) = tc
            .rendered_tile_caches
            .get(&handle)
            .map(|cache| cache.rendered_tile_entity)
        else {
            continue;
        };
        let Ok((_, mut rendered_tile, _)) = rendered_tiles.get_mut(entity) else {
            continue;
        };

        // `destroy_terrain_tile` frees this tile's BufferStore bytes
        // SYNCHRONOUSLY (via `free_mesh_only_buffers` and the quadtree node's
        // `destroy(.., buf)`), so snapshot the store around the call and
        // credit the real freed delta — matching the CPU term of
        // `MemoryLedger::usage`. Crediting only `gpu_est` would ignore the
        // freed CPU bytes and make the loop believe it is still far over budget,
        // over-evicting well past the hysteresis target.
        let buf_before = buf.total_bytes() as u64;
        destroy_terrain_tile(
            &mut commands,
            &mut tc,
            &mut qt,
            &mut terrain_qt,
            &mut buf,
            &meshes,
            entity,
            &mut rendered_tile,
        );
        let cpu_freed = buf_before.saturating_sub(buf.total_bytes() as u64);

        // GPU bytes are freed through the deferred `TileCost` component hooks
        // (subtracted via `gpu_est`); CPU bytes are already gone from the store
        // (`cpu_freed`). Together this mirrors what `usage` summed, no double-count.
        budget.credit(gpu_est, cpu_freed);
        // Credit the ledger too so the OTHER pipelines' enforce systems this
        // frame see this eviction (their `EvictBudget` is stack-local); the mesh
        // despawn that actually subtracts `gpu_est` from `gpu_bytes_est` is
        // deferred to next frame's `remove_removed_mesh`.
        ledger.credit_pending_eviction(gpu_est);
        ledger.evicted_count += 1;
    }
}

#[cfg(test)]
mod memory_budget_tests {
    use super::*;
    use crate::tile::tile_cache_manager::RenderedTileCache;
    use bevy_app::{App, Update};
    use navara_frame::FramePlugin;

    struct Setup {
        rendered_tile_entity: Entity,
        mesh_entity: Entity,
        handle: TileHandle,
    }

    /// One rendered, non-visited terrain tile (`visited_at == 0`,
    /// `last_rendered_frame == 2` to clear the +1 grace).
    fn setup(app: &mut App, gpu_est: u64) -> Setup {
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();

        let mesh_entity = app
            .world_mut()
            .spawn((
                TileMeshMarker {
                    handle,
                    ready_parent_tile_handle: None,
                },
                Mesh {
                    vertices: 0,
                    uvs: 0,
                    indices: 0,
                    active: true,
                    render_order: 0,
                    aabb: Aabb::default(),
                    normals: None,
                    skirt_vertices: None,
                    skirt_uvs: None,
                    skirt_indices: None,
                    skirt_normals: None,
                    watermask: None,
                },
                TileCost { cpu: 0, gpu_est },
            ))
            .id();

        let rendered_tile_entity = app
            .world_mut()
            .spawn((
                RenderedTile {
                    tile_handle: handle,
                    terrain_mesh_constructor: None,
                    terrain_mesh_upsampler: None,
                },
                OrderByDistance {
                    sse: 0.,
                    distance: 0.,
                },
            ))
            .id();

        let mut tc = TileCacheManager::default();
        tc.rendered_tile_caches.insert(
            handle,
            RenderedTileCache {
                mesh_entity: Some(mesh_entity),
                ready_parent_tile_handle: None,
                layer_parents: None,
                rendered_tile_entity,
                mesh_prepared: true,
                needs_material_update: false,
                prefetched: false,
            },
        );
        tc.last_rendered_frame = 2;
        tc.is_updated_in_this_frame = true;
        app.insert_resource(tc);
        app.insert_resource(qt);

        Setup {
            rendered_tile_entity,
            mesh_entity,
            handle,
        }
    }

    fn new_app(budget_bytes: Option<u64>) -> App {
        let mut app = App::new();
        app.add_plugins(FramePlugin);
        app.init_resource::<BufferStore>();
        app.init_resource::<navara_memory::SsePressure>();
        app.init_resource::<ReserveEstimates>();
        app.insert_resource(TerrainInformationQuadtree::new_with_linear_qt());
        app.insert_resource(MemoryLedger {
            budget_bytes,
            ..Default::default()
        });
        app
    }

    #[test]
    fn clear_caches_destroys_when_budget_disabled() {
        let mut app = new_app(None);
        let setup = setup(&mut app, 100);
        app.add_systems(Update, clear_caches);

        app.update();

        assert!(app.world().get_entity(setup.rendered_tile_entity).is_err());
        assert!(
            app.world().get::<Deleted>(setup.mesh_entity).is_some(),
            "mesh should be marked Deleted"
        );
        let tc = app.world().resource::<TileCacheManager>();
        assert!(tc.rendered_tile_caches.is_empty());
        assert!(tc.retained.is_empty());
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(qt.qt.get(setup.handle).is_none());
    }

    #[test]
    fn clear_caches_retains_when_budget_enabled() {
        let mut app = new_app(Some(u64::MAX));
        let setup = setup(&mut app, 100);
        app.add_systems(Update, clear_caches);

        app.update();

        assert!(app.world().get_entity(setup.rendered_tile_entity).is_ok());
        assert!(app.world().get::<Deleted>(setup.mesh_entity).is_none());
        assert!(
            !app.world().get::<Mesh>(setup.mesh_entity).unwrap().active,
            "retained tile's mesh should be deactivated"
        );
        let tc = app.world().resource::<TileCacheManager>();
        assert!(tc.rendered_tile_caches.contains_key(&setup.handle));
        assert!(tc.retained.contains_key(&setup.handle));
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(qt.qt.get(setup.handle).is_some());
    }

    #[test]
    fn enforce_memory_budget_evicts_after_min_retain_frames() {
        let mut app = new_app(Some(50));
        let setup = setup(&mut app, 100);
        {
            let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
            tc.retained.insert(
                setup.handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost {
                        cpu: 0,
                        gpu_est: 100,
                    },
                },
            );
        }
        app.add_systems(Update, enforce_memory_budget);

        // Protected while younger than MIN_RETAIN_FRAMES.
        for _ in 0..navara_memory::MIN_RETAIN_FRAMES - 1 {
            app.update();
            assert!(app.world().get_entity(setup.rendered_tile_entity).is_ok());
        }
        app.update();

        assert!(app.world().get_entity(setup.rendered_tile_entity).is_err());
        let ledger = app.world().resource::<MemoryLedger>();
        assert_eq!(ledger.evicted_count, 1);
        // The mesh entity still exists (Deleted marker, despawned by the
        // mesh cleanup elsewhere), so its TileCost is still accounted.
        assert!(app.world().get::<Deleted>(setup.mesh_entity).is_some());
        let tc = app.world().resource::<TileCacheManager>();
        assert!(tc.retained.is_empty());
    }

    /// Prefetched (never-activated) meshes are evictable even though their
    /// tiles are still visited every frame: without this they would sit
    /// outside both the retention pool and the budget's reach for as long as
    /// the camera keeps them in the occluded ring.
    #[test]
    fn enforce_memory_budget_evicts_prefetched_mesh() {
        let mut app = new_app(Some(50));
        let setup = setup(&mut app, 100);
        {
            let world = app.world_mut();
            world.get_mut::<Mesh>(setup.mesh_entity).unwrap().active = false;
            let mut tc = world.resource_mut::<TileCacheManager>();
            tc.rendered_tile_caches
                .get_mut(&setup.handle)
                .unwrap()
                .prefetched = true;
        }
        app.add_systems(Update, enforce_memory_budget);
        app.update();

        assert!(
            app.world().get_entity(setup.rendered_tile_entity).is_err(),
            "prefetched mesh is evicted without waiting for retention"
        );
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 1);
    }

    /// The prefetched eviction pass must never touch a mesh that is on
    /// screen (e.g. a prefetched tile that was activated before the visible
    /// path cleared the flag).
    #[test]
    fn enforce_memory_budget_keeps_active_prefetched_mesh() {
        let mut app = new_app(Some(50));
        let setup = setup(&mut app, 100);
        {
            let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
            tc.rendered_tile_caches
                .get_mut(&setup.handle)
                .unwrap()
                .prefetched = true;
        }
        app.add_systems(Update, enforce_memory_budget);
        app.update();

        assert!(app.world().get_entity(setup.rendered_tile_entity).is_ok());
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 0);
    }

    /// Eviction must free every BufferStore handle the tile holds: the shared
    /// vertex/index/uv/heights/normals/watermask handles cached on the
    /// quadtree tile AND the skirt handles that exist only on the `Mesh`
    /// component (the leak this guards: skirts were freed by nobody).
    #[test]
    fn eviction_frees_all_mesh_buffers() {
        let mut app = new_app(Some(50));
        let setup = setup(&mut app, 100);
        {
            let world = app.world_mut();
            let (vertices, indices, uvs, heights, normals, skirt_v, skirt_u, skirt_i, watermask) = {
                let mut buf = world.resource_mut::<BufferStore>();
                (
                    buf.new_f32(vec![0.; 9]),
                    buf.new_u32(vec![0; 3]),
                    buf.new_f32(vec![0.; 6]),
                    buf.new_f32(vec![0.; 4]),
                    buf.new_f32(vec![0.; 9]),
                    buf.new_f32(vec![0.; 9]),
                    buf.new_f32(vec![0.; 6]),
                    buf.new_u32(vec![0; 3]),
                    buf.new_u8(vec![0; 1]),
                )
            };
            let mut mesh = world.get_mut::<Mesh>(setup.mesh_entity).unwrap();
            mesh.vertices = vertices;
            mesh.indices = indices;
            mesh.uvs = uvs;
            mesh.skirt_vertices = Some(skirt_v);
            mesh.skirt_uvs = Some(skirt_u);
            mesh.skirt_indices = Some(skirt_i);
            mesh.watermask = Some(watermask);
            let mut qt = world.resource_mut::<TerrainTileQuadtree>();
            qt.qt.get_mut(setup.handle).unwrap().cached_mesh_handle = Some(CachedMeshHandle {
                vertices,
                indices,
                uvs,
                heights: Some(heights),
                normals: Some(normals),
                watermask: Some(watermask),
            });
            let mut tc = world.resource_mut::<TileCacheManager>();
            tc.retained.insert(
                setup.handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost {
                        cpu: 0,
                        gpu_est: 100,
                    },
                },
            );
        }
        app.add_systems(Update, enforce_memory_budget);

        for _ in 0..navara_memory::MIN_RETAIN_FRAMES + 1 {
            app.update();
        }

        assert!(
            app.world().get_entity(setup.rendered_tile_entity).is_err(),
            "tile should have been evicted"
        );
        let buf = app.world().resource::<BufferStore>();
        assert!(
            buf.is_empty(),
            "eviction must free every mesh buffer, {} left",
            buf.len()
        );
    }

    /// FIX 1: every terrain mesh must be charged the composite-atlas cost the
    /// JS `TileMesh` acquires eagerly, even before any vector layer drapes.
    #[test]
    fn attach_terrain_mesh_cost_includes_atlas_baseline() {
        let mut app = new_app(Some(u64::MAX));
        // Non-default atlas hint so the assertion is unambiguous.
        let atlas = 3 * 1024 * 1024;
        app.world_mut()
            .resource_mut::<MemoryLedger>()
            .cost_hints
            .atlas_tile_bytes = atlas;

        let handle = {
            let mut qt = TerrainTileQuadtree::new_with_linear_qt();
            qt.qt
                .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
            let h = qt.qt.zero().unwrap().handle();
            app.insert_resource(qt);
            h
        };

        let mesh_entity = app
            .world_mut()
            .spawn((
                TileMeshMarker {
                    handle,
                    ready_parent_tile_handle: None,
                },
                Mesh {
                    vertices: 0,
                    uvs: 0,
                    indices: 0,
                    active: true,
                    render_order: 0,
                    aabb: Aabb::default(),
                    normals: None,
                    skirt_vertices: None,
                    skirt_uvs: None,
                    skirt_indices: None,
                    skirt_normals: None,
                    watermask: None,
                },
            ))
            .id();

        app.add_systems(Update, attach_terrain_mesh_cost);
        // `Added<Mesh>` fires on the frame after insertion.
        app.update();
        app.update();

        let gpu_cost = app
            .world()
            .get::<TerrainTileGpuCost>(mesh_entity)
            .expect("TerrainTileGpuCost attached");
        // Buffers are all handle 0 with no bytes, so geometry is 0 and the
        // whole cost is the seeded atlas baseline.
        assert_eq!(gpu_cost.drape, atlas, "atlas must be seeded into drape");
        assert_eq!(gpu_cost.total(), atlas);
        let tile_cost = app.world().get::<TileCost>(mesh_entity).unwrap();
        assert_eq!(tile_cost.gpu_est, atlas);
        // The component hook must have folded the atlas into the ledger.
        assert_eq!(
            app.world().resource::<MemoryLedger>().gpu_bytes_est,
            atlas,
            "atlas must be visible to the budget"
        );
    }

    #[test]
    fn attach_terrain_mesh_cost_feeds_the_reservation_estimator() {
        let mut app = new_app(Some(u64::MAX));
        app.add_systems(Update, attach_terrain_mesh_cost);

        // Empty-buffer meshes: geometry is 0, so each landed cost is exactly
        // the atlas baseline — distinguishable from the seed (raster + atlas).
        for _ in 0..navara_memory::RESERVE_MIN_SAMPLES {
            app.world_mut().spawn((
                TileMeshMarker {
                    handle: 0,
                    ready_parent_tile_handle: None,
                },
                Mesh {
                    vertices: 0,
                    uvs: 0,
                    indices: 0,
                    active: true,
                    render_order: 0,
                    aabb: Aabb::default(),
                    normals: None,
                    skirt_vertices: None,
                    skirt_uvs: None,
                    skirt_indices: None,
                    skirt_normals: None,
                    watermask: None,
                },
            ));
        }
        // `Added<Mesh>` fires on the frame after insertion.
        app.update();
        app.update();

        let hints = app.world().resource::<MemoryLedger>().cost_hints;
        let estimate = app
            .world()
            .resource::<ReserveEstimates>()
            .estimate(ReserveKey::Terrain, hints.terrain_reserve_seed());
        assert_eq!(
            estimate, hints.atlas_tile_bytes,
            "recorded mesh costs (atlas-only here) must replace the seed"
        );
    }

    /// FIX 3: eviction must subtract the SYNCHRONOUSLY-freed BufferStore bytes,
    /// not just the GPU estimate, or it over-evicts far past the hysteresis
    /// target. Two retained tiles, budget just over one tile's real cost: the
    /// loop must stop after evicting exactly ONE.
    #[test]
    fn eviction_stops_at_target_without_over_evicting() {
        let mut app = new_app(Some(6000)); // final budget set below after sizing
        // Build two independent rendered+mesh tiles, each holding real CPU
        // bytes in the BufferStore, no GPU estimate (isolates the CPU delta).
        let child_handles;
        {
            let mut qt = TerrainTileQuadtree::new_with_linear_qt();
            qt.qt
                .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
            child_handles = qt
                .qt
                .initialize_children((0, 0, 0), &|(x, y, z)| {
                    TerrainTile::new(TileXYZ { x, y, z }, 0., 0.)
                })
                .expect("children initialized");
            app.insert_resource(qt);
        }
        assert!(child_handles.len() >= 2);
        let handles = [child_handles[0], child_handles[1]];

        let bytes_per_tile;
        let mut rendered_entities = vec![];
        {
            let world = app.world_mut();
            // 1000 f32 = 4000 bytes per tile. Buffers must live on the quadtree
            // node's `cached_mesh_handle` — those are what `destroy(.., buf)`
            // frees SYNCHRONOUSLY (skirts on the Mesh are the only ones
            // `free_mesh_only_buffers` touches).
            bytes_per_tile = 4000u64;
            for handle in handles.iter() {
                let vbuf = world.resource_mut::<BufferStore>().new_f32(vec![0.; 1000]);
                world
                    .resource_mut::<TerrainTileQuadtree>()
                    .qt
                    .get_mut(*handle)
                    .unwrap()
                    .cached_mesh_handle = Some(CachedMeshHandle {
                    vertices: vbuf,
                    indices: vbuf,
                    uvs: vbuf,
                    heights: None,
                    normals: None,
                    watermask: None,
                });
            }

            let mut tc = TileCacheManager::default();
            for (i, handle) in handles.iter().enumerate() {
                let mesh_entity = world
                    .spawn((
                        TileMeshMarker {
                            handle: *handle,
                            ready_parent_tile_handle: None,
                        },
                        Mesh {
                            vertices: 0,
                            uvs: 0,
                            indices: 0,
                            active: false,
                            render_order: 0,
                            aabb: Aabb::default(),
                            normals: None,
                            skirt_vertices: None,
                            skirt_uvs: None,
                            skirt_indices: None,
                            skirt_normals: None,
                            watermask: None,
                        },
                        TileCost { cpu: 0, gpu_est: 0 },
                    ))
                    .id();
                let rendered_tile_entity = world
                    .spawn((
                        RenderedTile {
                            tile_handle: *handle,
                            terrain_mesh_constructor: None,
                            terrain_mesh_upsampler: None,
                        },
                        OrderByDistance {
                            sse: 0.,
                            distance: i as FloatType, // tile 1 farther → evicted first
                        },
                    ))
                    .id();
                rendered_entities.push(rendered_tile_entity);
                tc.rendered_tile_caches.insert(
                    *handle,
                    RenderedTileCache {
                        mesh_entity: Some(mesh_entity),
                        ready_parent_tile_handle: None,
                        layer_parents: None,
                        rendered_tile_entity,
                        mesh_prepared: true,
                        needs_material_update: false,
                        prefetched: false,
                    },
                );
                tc.retained.insert(
                    *handle,
                    RetainedEntry {
                        retained_at: 0,
                        cost: TileCost { cpu: 0, gpu_est: 0 },
                    },
                );
            }
            tc.last_rendered_frame = 2;
            world.insert_resource(tc);
        }

        // Two retained tiles hold 4000 CPU bytes each → usage 8000. With
        // budget 6000 the hysteresis target is 0.85*6000 = 5100: freeing ONE
        // tile drops real usage to 4000 (≤ target) so the loop must stop.
        // The old code subtracted only `gpu_est` (== 0 here) and never saw the
        // freed CPU bytes, so `usage_est` stayed at 8000 and it evicted BOTH.
        assert_eq!(bytes_per_tile, 4000);
        app.world_mut().resource_mut::<MemoryLedger>().budget_bytes = Some(6000);

        app.add_systems(Update, enforce_memory_budget);
        for _ in 0..navara_memory::MIN_RETAIN_FRAMES + 1 {
            app.update();
        }

        let alive: usize = rendered_entities
            .iter()
            .filter(|e| app.world().get_entity(**e).is_ok())
            .count();
        assert_eq!(
            alive, 1,
            "must evict exactly one tile, not over-evict the pool"
        );
        assert_eq!(app.world().resource::<MemoryLedger>().evicted_count, 1);
    }

    /// FIX 4: disabling the budget at runtime must drain the terrain retention
    /// pool immediately, even on an idle frame (`is_updated_in_this_frame ==
    /// false`), mirroring `clear_raster_caches`.
    #[test]
    fn clear_caches_drains_retention_pool_when_budget_disabled() {
        let mut app = new_app(None); // budget disabled
        let setup = setup(&mut app, 100);
        {
            let mut tc = app.world_mut().resource_mut::<TileCacheManager>();
            // Simulate an idle frame with a leftover retained tile.
            tc.is_updated_in_this_frame = false;
            tc.retained.insert(
                setup.handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost {
                        cpu: 0,
                        gpu_est: 100,
                    },
                },
            );
        }
        app.add_systems(Update, clear_caches);

        app.update();

        assert!(
            app.world().get_entity(setup.rendered_tile_entity).is_err(),
            "retained tile must be destroyed when budget is disabled"
        );
        let tc = app.world().resource::<TileCacheManager>();
        assert!(tc.retained.is_empty(), "retention pool must be drained");
        assert!(tc.rendered_tile_caches.is_empty());
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(qt.qt.get(setup.handle).is_none());
    }
}

#[cfg(test)]
mod delete_layer_tests {
    use super::*;
    use bevy_app::{App, Update};
    use navara_material::{Appearance, RasterMaterial};
    use navara_tile_component::{RasterTile, RasterTileQuadtree};

    use crate::raster::RasterTileCacheManager;

    fn raster_layer(layer_id: &str) -> TilesLayer {
        TilesLayer {
            layer_id: layer_id.to_string(),
            source_id: None,
            appearance: Some(Appearance::TerrainTile(RasterMaterial::default())),
            elevation_heatmap_config: None,
            hillshade_config: None,
        }
    }

    /// Deleting a middle raster layer must compact that slot out of the raster
    /// tile's `texture_fragment_entity_ids`, keeping the remaining layers aligned
    /// with the new sorted-layer order (the layer-ordering regression this guards).
    #[test]
    fn delete_layer_compacts_raster_texture_slots() {
        let mut app = App::new();
        app.insert_resource(TerrainTileQuadtree::new_with_linear_qt());

        // A raster tile carrying one texture entity per layer [A, B, C].
        let ea = app.world_mut().spawn_empty().id();
        let eb = app.world_mut().spawn_empty().id();
        let ec = app.world_mut().spawn_empty().id();

        let mut raster_qt = RasterTileQuadtree::new_with_linear_qt();
        raster_qt
            .qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = raster_qt.qt.zero().unwrap().handle();
        raster_qt
            .qt
            .get_mut(handle)
            .unwrap()
            .texture_fragment_entity_ids = Some(vec![Some(ea), Some(eb), Some(ec)]);
        app.insert_resource(raster_qt);

        let mut raster_tc = RasterTileCacheManager::default();
        raster_tc.active_handles.insert(handle);
        app.insert_resource(raster_tc);

        // Layers A(0), B(1), C(2); delete the middle one (B).
        app.world_mut().spawn((raster_layer("A"), Order(0)));
        app.world_mut().spawn((raster_layer("B"), Order(1)));
        app.world_mut().spawn((raster_layer("C"), Order(2)));
        app.world_mut()
            .spawn(DeleteRasterTileLayerMarker("B".to_string()));

        app.add_systems(Update, delete_layer);
        app.update();

        let raster_qt = app.world().resource::<RasterTileQuadtree>();
        let tex = raster_qt
            .qt
            .get(handle)
            .unwrap()
            .texture_fragment_entity_ids
            .as_ref()
            .unwrap();

        // B's slot is gone; A and C keep their relative order, now at indices 0,1.
        assert_eq!(tex, &vec![Some(ea), Some(ec)]);
    }

    /// A layer spawned with a pre-set `Order` (the reset re-add restoring its
    /// pre-teardown z-position) must keep it; only order-less layers get the
    /// fresh topmost value — which must also count the restored order in `max`.
    #[test]
    fn add_order_skips_layers_with_restored_order() {
        let mut app = App::new();
        // A reset re-add restoring Order(5) plus a plain user add, same frame.
        let restored = app
            .world_mut()
            .spawn((raster_layer("reset"), Order(5)))
            .id();
        let added = app.world_mut().spawn(raster_layer("user-add")).id();

        app.add_systems(Update, add_order_to_tiles_layer);
        app.update();

        assert_eq!(
            app.world().get::<Order>(restored),
            Some(&Order(5)),
            "restored z-order must survive the assign system"
        );
        assert_eq!(
            app.world().get::<Order>(added),
            Some(&Order(6)),
            "fresh order goes on top of the restored one"
        );
    }

    /// Deleting a middle layer must also compact raster tiles in the retention
    /// pool: they keep their quadtree node and fragments alive for a revisit, so
    /// a stale slot layout would resolve the deleted layer's texture for every
    /// layer after it once the camera returns. A revisited handle transiently
    /// sits in BOTH `active_handles` and `retained` (until
    /// `enforce_memory_budget` purges the retained entry) and must be compacted
    /// exactly once.
    #[test]
    fn delete_layer_compacts_retained_raster_tiles_exactly_once() {
        let mut app = App::new();
        app.insert_resource(TerrainTileQuadtree::new_with_linear_qt());

        // Root = retained-only tile; child (0,0,1) = revisited tile living in
        // both sets. Each carries one texture entity per layer [A, B, C].
        let init = |(x, y, z): (usize, usize, usize)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.);
        let mut raster_qt = RasterTileQuadtree::new_with_linear_qt();
        raster_qt.qt.initialize_zero(&init);
        raster_qt.qt.initialize_children((0, 0, 0), &init);
        let retained_handle = raster_qt.qt.zero().unwrap().handle();
        let revisited_handle = raster_qt.qt.leaf((0, 0, 1)).unwrap().handle();

        let spawn_slots = |app: &mut App| -> Vec<Option<Entity>> {
            (0..3)
                .map(|_| Some(app.world_mut().spawn_empty().id()))
                .collect()
        };
        let retained_slots = spawn_slots(&mut app);
        let revisited_slots = spawn_slots(&mut app);
        raster_qt
            .qt
            .get_mut(retained_handle)
            .unwrap()
            .texture_fragment_entity_ids = Some(retained_slots.clone());
        raster_qt
            .qt
            .get_mut(revisited_handle)
            .unwrap()
            .texture_fragment_entity_ids = Some(revisited_slots.clone());
        app.insert_resource(raster_qt);

        let mut raster_tc = RasterTileCacheManager::default();
        raster_tc.active_handles.insert(revisited_handle);
        for handle in [retained_handle, revisited_handle] {
            raster_tc.retained.insert(
                handle,
                RetainedEntry {
                    retained_at: 0,
                    cost: TileCost::default(),
                },
            );
        }
        app.insert_resource(raster_tc);

        // Layers A(0), B(1), C(2); delete the middle one (B).
        app.world_mut().spawn((raster_layer("A"), Order(0)));
        app.world_mut().spawn((raster_layer("B"), Order(1)));
        app.world_mut().spawn((raster_layer("C"), Order(2)));
        app.world_mut()
            .spawn(DeleteRasterTileLayerMarker("B".to_string()));

        app.add_systems(Update, delete_layer);
        app.update();

        let raster_qt = app.world().resource::<RasterTileQuadtree>();
        for (name, handle, slots) in [
            ("retained", retained_handle, &retained_slots),
            ("revisited", revisited_handle, &revisited_slots),
        ] {
            let tex = raster_qt
                .qt
                .get(handle)
                .unwrap()
                .texture_fragment_entity_ids
                .as_ref()
                .unwrap();
            assert_eq!(
                tex,
                &vec![slots[0], slots[2]],
                "{name} tile: middle slot removed exactly once"
            );
        }
    }

    /// Two delete markers for the *same* layer in one frame must compact exactly
    /// one slot. Without sort+dedup of the index list, the duplicate index makes
    /// `idx - removed_idx` over-remove a slot (and underflow `usize` when the
    /// duplicated layer sits at index 0).
    #[test]
    fn delete_layer_handles_duplicate_markers_for_same_layer() {
        let mut app = App::new();
        app.insert_resource(TerrainTileQuadtree::new_with_linear_qt());

        let ea = app.world_mut().spawn_empty().id();
        let eb = app.world_mut().spawn_empty().id();
        let ec = app.world_mut().spawn_empty().id();

        let mut raster_qt = RasterTileQuadtree::new_with_linear_qt();
        raster_qt
            .qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = raster_qt.qt.zero().unwrap().handle();
        raster_qt
            .qt
            .get_mut(handle)
            .unwrap()
            .texture_fragment_entity_ids = Some(vec![Some(ea), Some(eb), Some(ec)]);
        app.insert_resource(raster_qt);

        let mut raster_tc = RasterTileCacheManager::default();
        raster_tc.active_handles.insert(handle);
        app.insert_resource(raster_tc);

        // Delete the *first* layer (A, index 0) so a mishandled duplicate would
        // underflow `usize` on the second pass (0 - 1).
        app.world_mut().spawn((raster_layer("A"), Order(0)));
        app.world_mut().spawn((raster_layer("B"), Order(1)));
        app.world_mut().spawn((raster_layer("C"), Order(2)));
        app.world_mut()
            .spawn(DeleteRasterTileLayerMarker("A".to_string()));
        app.world_mut()
            .spawn(DeleteRasterTileLayerMarker("A".to_string()));

        app.add_systems(Update, delete_layer);
        app.update();

        let raster_qt = app.world().resource::<RasterTileQuadtree>();
        let tex = raster_qt
            .qt
            .get(handle)
            .unwrap()
            .texture_fragment_entity_ids
            .as_ref()
            .unwrap();

        // Exactly one slot (A) removed; B and C remain intact and in order.
        assert_eq!(tex, &vec![Some(eb), Some(ec)]);
    }

    /// Deleting the terrain layer must reset every rendered tile so the forced
    /// re-traversal re-bakes the globe against the current terrain (or the flat
    /// ellipsoid): the `TerrainLayer` + `RenderedTile` are despawned, the tile's
    /// cache entries are dropped, its old mesh is marked `Deleted`, the quadtree
    /// tile is KEPT (roots must survive) with `terrain_data` cleared, the
    /// per-tile terrain info is removed, and `force_update` is set.
    #[test]
    fn sync_terrain_layer_changes_resets_tiles_on_delete() {
        use crate::tile::tile_cache_manager::RenderedTileCache;

        let mut app = App::new();
        app.insert_resource(BufferStore::default());
        app.init_resource::<crate::raster::RasterResolveRevision>();
        // Default (WebMercator) globe: deleting an ellipsoid terrain keeps the
        // scheme, so the scheme-fallback path does not drain the tiling here.
        app.insert_resource(navara_globe::Globe::default());

        // A globe tile in the terrain quadtree.
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        app.insert_resource(qt);

        // Per-tile terrain info present; the reset must drop it.
        let mut terrain_qt = TerrainInformationQuadtree::new_with_linear_qt();
        terrain_qt
            .qt
            .initialize_zero(&|_c| TerrainInformation::new());
        app.insert_resource(terrain_qt);

        // A rendered tile with a baked mesh entity tracked by the cache manager.
        let mesh_entity = app.world_mut().spawn_empty().id();
        let rendered_tile_entity = app
            .world_mut()
            .spawn(RenderedTile {
                tile_handle: handle,
                ..Default::default()
            })
            .id();
        let mut tc = TileCacheManager::default();
        tc.rendered_tile_caches.insert(
            handle,
            RenderedTileCache {
                rendered_tile_entity,
                ready_parent_tile_handle: None,
                layer_parents: None,
                mesh_entity: Some(mesh_entity),
                mesh_prepared: true,
                needs_material_update: false,
                prefetched: false,
            },
        );
        tc.requested_tile_caches.insert(handle);
        app.insert_resource(tc);

        // The terrain layer being torn down, plus its teardown marker.
        app.world_mut().spawn(TerrainLayer {
            layer_id: "t".into(),
            source_id: None,
            terrain_type: navara_layer::TerrainDataType::Ellipsoid,
            appearance: None,
        });
        app.world_mut().spawn(DeleteTerrainLayerMarker {
            layer_id: "t".to_string(),
            reset: false,
        });

        app.add_systems(Update, sync_terrain_layer_changes);
        app.update();

        // TerrainLayer + RenderedTile despawned.
        assert_eq!(
            app.world_mut()
                .query::<&TerrainLayer>()
                .iter(app.world())
                .count(),
            0,
        );
        assert_eq!(
            app.world_mut()
                .query::<&RenderedTile>()
                .iter(app.world())
                .count(),
            0,
        );

        let tc = app.world().resource::<TileCacheManager>();
        assert!(!tc.rendered_tile_caches.contains_key(&handle));
        assert!(!tc.requested_tile_caches.contains(&handle));
        assert!(tc.force_update, "a re-traversal must be forced");

        // Quadtree tile kept (roots must survive); per-tile terrain info removed.
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(qt.qt.get(handle).is_some());
        assert!(qt.qt.get(handle).unwrap().terrain_data.is_none());
        let terrain_qt = app.world().resource::<TerrainInformationQuadtree>();
        assert!(terrain_qt.qt.get(handle).is_none());

        // Old mesh entity marked for removal.
        assert!(app.world().get::<Deleted>(mesh_entity).is_some());
    }

    /// Adding (or re-adding) a terrain layer while flat tiles are already
    /// rendered must ALSO reset them, so they re-bake against the newly-present
    /// terrain instead of keeping their (flat) geometry. The layer itself is kept
    /// (only a delete marker despawns a layer).
    #[test]
    fn sync_terrain_layer_changes_resets_tiles_on_add() {
        use crate::tile::tile_cache_manager::RenderedTileCache;

        let mut app = App::new();
        app.insert_resource(BufferStore::default());
        app.init_resource::<crate::raster::RasterResolveRevision>();
        // An add keeps the scheme (fallback only fires on the last delete).
        app.insert_resource(navara_globe::Globe::default());

        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        app.insert_resource(qt);

        let mut terrain_qt = TerrainInformationQuadtree::new_with_linear_qt();
        terrain_qt
            .qt
            .initialize_zero(&|_c| TerrainInformation::new());
        app.insert_resource(terrain_qt);

        let mesh_entity = app.world_mut().spawn_empty().id();
        let rendered_tile_entity = app
            .world_mut()
            .spawn(RenderedTile {
                tile_handle: handle,
                ..Default::default()
            })
            .id();
        let mut tc = TileCacheManager::default();
        tc.rendered_tile_caches.insert(
            handle,
            RenderedTileCache {
                rendered_tile_entity,
                ready_parent_tile_handle: None,
                layer_parents: None,
                mesh_entity: Some(mesh_entity),
                mesh_prepared: true,
                needs_material_update: false,
                prefetched: false,
            },
        );
        app.insert_resource(tc);

        // A freshly-added terrain layer, with NO delete marker.
        app.world_mut().spawn(TerrainLayer {
            layer_id: "t".into(),
            source_id: None,
            terrain_type: navara_layer::TerrainDataType::Ellipsoid,
            appearance: None,
        });

        app.add_systems(Update, sync_terrain_layer_changes);
        app.update();

        // The added layer is KEPT; the rendered tile is reset for a re-bake.
        assert_eq!(
            app.world_mut()
                .query::<&TerrainLayer>()
                .iter(app.world())
                .count(),
            1,
        );
        assert_eq!(
            app.world_mut()
                .query::<&RenderedTile>()
                .iter(app.world())
                .count(),
            0,
        );
        let tc = app.world().resource::<TileCacheManager>();
        assert!(!tc.rendered_tile_caches.contains_key(&handle));
        assert!(tc.force_update);
        assert!(app.world().get::<Deleted>(mesh_entity).is_some());
    }

    /// Adding a terrain layer whose source uses a DIFFERENT tiling scheme than the
    /// current globe (e.g. switching to geographic quantized-mesh from a
    /// WebMercator globe) must rebuild the tiling: drop the old-scheme tiles and
    /// re-seed the roots for the new scheme. Each tile bakes its extent from the
    /// scheme at creation, so kept tiles would otherwise render with wrong extents.
    #[test]
    fn init_globe_tiling_rebuilds_on_scheme_change() {
        use navara_core::TilingScheme;

        let mut app = App::new();
        app.insert_resource(BufferStore::default());
        app.init_resource::<crate::raster::RasterResolveRevision>();
        // Globe starts at the default WebMercator scheme.
        app.insert_resource(navara_globe::Globe::default());

        // Seed a WebMercator root plus a subdivided child (proves the drain).
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt.initialize_leaf((0, 0, 0), &|(x, y, z)| {
            TerrainTile::new(TileXYZ { x, y, z }, 0., 0.)
        });
        qt.qt.initialize_leaf((0, 0, 1), &|(x, y, z)| {
            TerrainTile::new(TileXYZ { x, y, z }, 0., 0.)
        });
        app.insert_resource(qt);

        // A geographic quantized-mesh source, referenced by a new terrain layer.
        let mut source_store = navara_source::SourceStore::new();
        source_store.add(
            "s".to_string(),
            navara_source::Source::QuantizedMesh(navara_source::QuantizedMeshSource {
                source_id: "s".to_string(),
                url: String::new(),
                tiling_scheme: TilingScheme::Geographic { tms: true },
                request_vertex_normals: false,
                request_water_mask: false,
                token: None,
                min_zoom: 0,
                max_zoom: 14,
                overscaled_max_zoom: 14,
            }),
        );
        app.insert_resource(source_store);

        app.world_mut().spawn(navara_layer::TerrainLayer {
            layer_id: "t".into(),
            source_id: Some("s".into()),
            terrain_type: navara_layer::TerrainDataType::QuantizedMesh,
            appearance: None,
        });

        app.add_systems(Update, init_globe_tiling);
        app.update();

        // Globe adopts the geographic scheme.
        assert!(
            app.world()
                .resource::<navara_globe::Globe>()
                .tiling_scheme
                .is_geographic()
        );

        let qt = app.world().resource::<TerrainTileQuadtree>();
        // Geographic roots (0,0,0) + (1,0,0) are seeded...
        assert!(qt.qt.leaf((0, 0, 0)).is_some());
        assert!(qt.qt.leaf((1, 0, 0)).is_some());
        // ...and the stale subdivided WebMercator tile was drained.
        assert!(qt.qt.leaf((0, 0, 1)).is_none());
        // The flip switches raster layers to baked drape slots, so the resolve
        // revision must bump or `snapshot_raster_bake_inputs` keeps the stale
        // (empty) pre-flip snapshot and every raster layer resolves transparent.
        assert_ne!(
            app.world()
                .resource::<crate::raster::RasterResolveRevision>()
                .0,
            0,
        );
    }

    /// Seeds a geographic globe + tile and a terrain layer (added a frame earlier),
    /// then deletes it with the given `reset` flag. Returns the app after the delete
    /// frame so callers can assert on the scheme / tiling.
    fn run_last_terrain_delete(reset: bool) -> App {
        use navara_core::TilingScheme;

        let mut app = App::new();
        app.insert_resource(BufferStore::default());
        app.init_resource::<crate::raster::RasterResolveRevision>();

        let globe = navara_globe::Globe {
            tiling_scheme: TilingScheme::Geographic { tms: true },
            ..Default::default()
        };
        app.insert_resource(globe);

        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt.initialize_leaf((0, 0, 0), &|(x, y, z)| {
            TerrainTile::new(TileXYZ { x, y, z }, 0., 0.)
        });
        app.insert_resource(qt);

        let mut terrain_qt = TerrainInformationQuadtree::new_with_linear_qt();
        terrain_qt
            .qt
            .initialize_zero(&|_c| TerrainInformation::new());
        app.insert_resource(terrain_qt);

        app.insert_resource(TileCacheManager::default());
        app.add_systems(Update, sync_terrain_layer_changes);

        // The terrain layer, added a frame earlier: the first update clears its
        // `Added` flag (a true delete acts on a layer that is no longer `Added`).
        app.world_mut().spawn(TerrainLayer {
            layer_id: "t".into(),
            source_id: Some("s".into()),
            terrain_type: navara_layer::TerrainDataType::QuantizedMesh,
            appearance: None,
        });
        app.update();

        app.world_mut().spawn(DeleteTerrainLayerMarker {
            layer_id: "t".to_string(),
            reset,
        });
        app.update();
        app
    }

    /// A TRUE user delete of the last terrain layer whose source used a non-default
    /// scheme (geographic) must restore the default WebMercator scheme and drain the
    /// geographic tiling so `init_globe_tiling` re-seeds the WM roots — otherwise a
    /// terrain-less map keeps traversing the wrong (geographic) roots.
    #[test]
    fn sync_terrain_layer_changes_restores_default_scheme_on_user_delete() {
        let app = run_last_terrain_delete(false);

        let globe = app.world().resource::<navara_globe::Globe>();
        assert_eq!(
            globe.tiling_scheme,
            navara_globe::Globe::default().tiling_scheme,
        );
        // The whole geographic tiling was drained (re-seeded by `init_globe_tiling`).
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(qt.qt.leaf((0, 0, 0)).is_none(), "geographic tiling drained");
        assert!(app.world().resource::<TileCacheManager>().force_update);
        // Raster layers switch from baked back to direct drape slots on the
        // scheme fallback; the resolve revision must reflect that.
        assert_ne!(
            app.world()
                .resource::<crate::raster::RasterResolveRevision>()
                .0,
            0,
        );
    }

    /// A source switch's delete half (marker `reset: true`) must NOT fall back to
    /// the default scheme: a re-add with the new source is queued, so flipping to
    /// the default here would force an extra full-tiling rebuild and buffer churn.
    #[test]
    fn sync_terrain_layer_changes_keeps_scheme_on_reset_delete() {
        use navara_core::TilingScheme;

        let app = run_last_terrain_delete(true);

        let globe = app.world().resource::<navara_globe::Globe>();
        assert_eq!(
            globe.tiling_scheme,
            TilingScheme::Geographic { tms: true },
            "a reset teardown keeps the scheme for the queued re-add",
        );
        // The tiling is not drained by the scheme fallback (rendered-tile reset only
        // touches rendered tiles; this seeded root is untouched).
        let qt = app.world().resource::<TerrainTileQuadtree>();
        assert!(
            qt.qt.leaf((0, 0, 0)).is_some(),
            "tiling kept for the re-add"
        );
    }
}
