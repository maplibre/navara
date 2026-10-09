use bevy_ecs::system::Commands;

use navara_camera::CameraFrustum;
use navara_component::{Order, Priority};
use navara_core::Ellipsoid;
use navara_fog::{DynamicSseTerm, Fog};
use navara_frame::FrameManager;
use navara_layer::TilesLayer;
use navara_math::{FloatType, Transform};
use navara_memory::SseDegrade;
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;
use navara_source::SourceStore;
use navara_tile_component::{
    RasterTile, RasterTileQuadtree, TerrainExaggeration, TerrainTileQuadtree, Tile, TileHandle,
    TileTextureFragmentQuery, terrain_height_for_tile,
};
use navara_window::Window;

use super::request::request_raster_texture_fragment;
use super::tile_cache_manager::RasterTileCacheManager;

/// Raster (texture) tile traversal in the WebMercator quadtree.
///
/// Unlike the terrain traversal this is intentionally lenient and stateless:
/// raster tiles own no mesh and are never "rendered" directly — the terrain
/// tiles pull the resolved textures by extent at material-build time, walking up
/// to the nearest ready ancestor when a selected tile isn't loaded yet. So this
/// traversal only needs to:
///   1. mark visited tiles alive (so `clear_raster_caches` keeps the fallback
///      chain),
///   2. request the texture fragments along the selected LOD path (idempotent),
///   3. stop descending once the screen-space error is satisfied or all layers
///      are beyond their max zoom.
#[allow(clippy::too_many_arguments)]
pub fn traverse_raster(
    command: &mut Commands,
    // The layer list sorted by `Order`, collected once per system run — this
    // function runs per traversed tile, so it must not sort per call.
    sorted_layers: &[(&TilesLayer, &Order)],
    source_store: &SourceStore,
    handle: TileHandle,
    qt: &mut RasterTileQuadtree,
    tc: &mut RasterTileCacheManager,
    terrain_qt: &TerrainTileQuadtree,
    terrain_exaggeration: &TerrainExaggeration,
    frame: &FrameManager,
    camera: &Transform,
    frustum: &CameraFrustum,
    window: &Window,
    ellipsoid: &Ellipsoid<FloatType>,
    occluder: &EllipsoidalOccluder,
    texture_fragment: &TileTextureFragmentQuery,
    fog: &Fog,
    dynamic_sse: DynamicSseTerm,
    max_sse: f64,
    degrade: SseDegrade,
    terrain_present: bool,
) {
    let coords = match qt.qt.get(handle) {
        Some(tile) => tile.coords,
        None => return,
    };

    // Borrow the terrain elevation so the SSE matches the terrain's
    // subdivision depth instead of treating the tile as flat at sea level.
    let (max_height, min_height) =
        terrain_height_for_tile(terrain_qt, terrain_exaggeration, coords);

    let tile = qt.qt.get_mut(handle).unwrap();
    tile.update_heights(max_height, min_height);
    tile.visited_at = frame.rendered_frame();
    tile.update_tile_occludee_point(ellipsoid, occluder);
    tc.active_handles.insert(handle);

    let is_culled_by_occlusion = tile.is_occluded_by_horizon(occluder);
    if is_culled_by_occlusion {
        return;
    }

    let is_culled_by_frustum = !tile.intersect_with_camera_frustum(frustum);

    let distance_from_camera = tile.calc_distance_from_camera(camera, ellipsoid).abs();
    let sse = tile.calc_sse(
        frustum,
        window,
        ellipsoid,
        if terrain_present { 65. } else { 64. },
        distance_from_camera,
        fog,
        dynamic_sse,
    );
    let tile = qt.qt.get_mut(handle).unwrap();
    tile.sse = sse;
    tile.distance_from_camera = distance_from_camera;

    let coords_z = tile.coords.z;
    let is_over_min_z = sorted_layers
        .iter()
        .filter(|(t, _)| t.hillshade_config.is_none())
        .filter_map(|(t, _)| t.source_id.as_deref().and_then(|id| source_store.get(id)))
        .any(|s| s.is_over_min_zoom(coords_z));

    // Request this level's textures along the selected path (idempotent: the
    // request helper skips layers that already have an in-flight/loaded
    // fragment). This gives the terrain pull a coarse fallback while finer
    // children load. Frustum-culled tiles still request (parent backfill) but
    // demoted, so in-view tiles win the pending-request slots.
    if is_over_min_z {
        let tile = qt.qt.get_mut(handle).unwrap();
        request_raster_texture_fragment(
            command,
            tile,
            sorted_layers,
            source_store,
            handle,
            texture_fragment,
            if is_culled_by_frustum {
                Priority::Medium.demote()
            } else {
                Priority::Medium
            },
        );
    }

    let meets_sse =
        sse <= degrade.effective_max_sse(max_sse, distance_from_camera) && is_over_min_z;

    // Once the screen-space error is satisfied, stop: no need for finer tiles.
    // Beyond max zoom, the layer overscales (parent texture stretched), so we
    // also stop fetching new tiles there.
    let any_under_max = sorted_layers
        .iter()
        .filter(|(t, _)| t.hillshade_config.is_none())
        .filter_map(|(t, _)| t.source_id.as_deref().and_then(|id| source_store.get(id)))
        .any(|s| !s.is_over_max_zoom(coords_z + 1));
    if meets_sse || !any_under_max {
        return;
    }

    // Frustum-culled tiles do not descend.
    if is_culled_by_frustum {
        return;
    }

    if let Some(children) = RasterTile::traversable_children(qt, handle) {
        for child in children {
            traverse_raster(
                command,
                sorted_layers,
                source_store,
                child,
                qt,
                tc,
                terrain_qt,
                terrain_exaggeration,
                frame,
                camera,
                frustum,
                window,
                ellipsoid,
                occluder,
                texture_fragment,
                fog,
                dynamic_sse,
                max_sse,
                degrade,
                terrain_present,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use bevy_app::{App, Update};
    use bevy_ecs::prelude::{Query, Res, ResMut, Resource};

    use navara_core::{Angle, TileXYZ, WGS84_64, WGS84_A_64};
    use navara_material::{Appearance, HillshadeConfig, RasterMaterial};
    use navara_math::Vec3;
    use navara_mesh::CachedMeshHandle;
    use navara_texture_fragment::TextureFragment;
    use navara_tile_component::{TerrainTile, TileTextureFragmentMarker};

    /// A terrain quadtree whose WebMercator root tile carries the given heights
    /// and a (dummy) cached mesh, so `terrain_height_for_tile` resolves it.
    fn terrain_qt_with_root_height(max_height: f64, min_height: f64) -> TerrainTileQuadtree {
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt.initialize_zero(&|(x, y, z)| {
            let mut t = TerrainTile::new(TileXYZ { x, y, z }, max_height, min_height);
            t.cached_mesh_handle = Some(CachedMeshHandle {
                vertices: 0,
                indices: 0,
                uvs: 0,
                heights: None,
                normals: None,
                watermask: None,
            });
            t
        });
        qt
    }

    // ----- traverse_raster ----------------------------------------------------

    /// The raster tile `traverse_raster` should visit. Passed via a resource so a
    /// single system can drive both the valid and the stale-handle scenarios.
    #[derive(Resource)]
    struct TargetHandle(TileHandle);

    /// Drives the screen-space-error threshold and `terrain_present` flag for the
    /// traversal so tests can force the "stop" vs "subdivide" decisions without
    /// fiddling with the camera geometry.
    #[derive(Resource)]
    struct TraverseConfig {
        max_sse: f64,
        terrain_present: bool,
    }

    /// Run `traverse_raster` from a Bevy system so its `Commands`/`Query`
    /// system-params are supplied. The camera sits at twice the Earth radius
    /// looking at the globe centre, which keeps the WebMercator root tile in view.
    #[allow(clippy::too_many_arguments)]
    fn run_traverse_system(
        mut commands: Commands,
        tiles: Query<(&TilesLayer, &Order)>,
        texture_fragment: TileTextureFragmentQuery,
        mut qt: ResMut<RasterTileQuadtree>,
        mut tc: ResMut<RasterTileCacheManager>,
        terrain_qt: Res<TerrainTileQuadtree>,
        frame: Res<FrameManager>,
        window: Res<Window>,
        target: Res<TargetHandle>,
        config: Res<TraverseConfig>,
        source_store: Res<SourceStore>,
    ) {
        let camera_ecef = Vec3::new(WGS84_A_64 * 2.0, 0.0, 0.0);
        let camera = Transform::from_translation(camera_ecef).looking_at(Vec3::ZERO, Vec3::Y);
        let frustum = CameraFrustum::new(&camera, 0.1, 1e9, Angle::new(60.0).rad().val(), 1.0);
        let occluder = EllipsoidalOccluder::new(&camera_ecef, WGS84_64);
        let fog = Fog {
            enabled: false,
            density: 0.,
            sse_factor: 1.0,
        };
        let sorted_layers: Vec<_> = tiles.iter().sort::<&Order>().collect();
        traverse_raster(
            &mut commands,
            &sorted_layers,
            &source_store,
            target.0,
            &mut qt,
            &mut tc,
            &terrain_qt,
            &TerrainExaggeration::default(),
            &frame,
            &camera,
            &frustum,
            &window,
            &WGS84_64,
            &occluder,
            &texture_fragment,
            &fog,
            DynamicSseTerm::NONE,
            config.max_sse,
            SseDegrade::NONE,
            config.terrain_present,
        );
    }

    /// App with the raster root tile, the terrain quadtree, and the supporting
    /// resources `traverse_raster` reads. `FramePlugin` advances the frame counter
    /// so `visited_at` becomes a meaningful non-zero value.
    fn app_with_root(terrain_qt: TerrainTileQuadtree) -> (App, TileHandle) {
        let mut app = App::new();
        app.add_plugins(navara_frame::FramePlugin);

        let mut qt = RasterTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| RasterTile::new(TileXYZ { x, y, z }, 0., 0.));
        let handle = qt.qt.zero().unwrap().handle();
        app.insert_resource(qt);

        app.insert_resource(RasterTileCacheManager::default());
        app.insert_resource(terrain_qt);
        app.insert_resource(Window {
            width: 800.,
            height: 600.,
            pixel_ratio: 1.,
        });
        // Default: a huge SSE threshold so the root always satisfies the error and
        // the traversal stays at the root unless a test lowers it.
        app.insert_resource(TraverseConfig {
            max_sse: 1e30,
            terrain_present: false,
        });
        // Layers register their own sources via `spawn_layer`.
        app.insert_resource(SourceStore::new());

        (app, handle)
    }

    /// A raster source carrying the layer's zoom range (zoom lives on the source
    /// now). The id matches the layer's `source_id`.
    fn layer_source(id: &str, min_zoom: usize, max_zoom: usize) -> navara_source::Source {
        navara_source::Source::RasterTile(navara_source::RasterTileSource {
            source_id: id.to_string(),
            url: "https://example.com/{z}/{x}/{y}.png".to_string(),
            tms: false,
            min_zoom,
            max_zoom,
            overscaled_max_zoom: max_zoom,
        })
    }

    /// A regular (non-hillshade) raster layer with the given zoom range, paired
    /// with its source.
    fn raster_layer(
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

    /// A hillshade layer. Hillshade is resolved on the terrain side, so the raster
    /// traversal must skip it entirely.
    fn hillshade_layer(layer_id: &str) -> (TilesLayer, navara_source::Source) {
        let (mut layer, source) = raster_layer(layer_id, 0, 20);
        layer.hillshade_config = Some(HillshadeConfig { exaggeration: 1.0 });
        (layer, source)
    }

    /// Register the layer's source in the store and spawn the layer entity.
    fn spawn_layer(app: &mut App, layer: (TilesLayer, navara_source::Source), order: Order) {
        let (layer, source) = layer;
        app.world_mut()
            .resource_mut::<SourceStore>()
            .add(source.source_id().to_string(), source);
        app.world_mut().spawn((layer, order));
    }

    /// URLs of every (non-deleted) texture fragment currently in the world.
    fn requested_urls(app: &mut App) -> Vec<String> {
        let mut q = app.world_mut().query::<&TextureFragment>();
        let mut urls: Vec<String> = q.iter(app.world()).map(|t| t.url.clone()).collect();
        urls.sort();
        urls
    }

    #[test]
    fn traverse_raster_marks_root_visited_and_borrows_terrain_height() {
        let (mut app, handle) = app_with_root(terrain_qt_with_root_height(1000., -50.));
        app.insert_resource(TargetHandle(handle));

        app.add_systems(Update, run_traverse_system);
        app.update();

        let frame = app.world().resource::<FrameManager>().rendered_frame();
        assert!(frame > 0, "FramePlugin should have advanced the frame");

        let qt = app.world().resource::<RasterTileQuadtree>();
        let tile = qt.qt.get(handle).unwrap();
        // The flat sea-level heights are replaced by the terrain elevation.
        assert_eq!((tile.max_height, tile.min_height), (1000., -50.));
        // The tile is stamped with the current frame...
        assert_eq!(tile.visited_at, frame);

        // ...and kept alive for the cache pruner.
        let tc = app.world().resource::<RasterTileCacheManager>();
        assert!(tc.active_handles.contains(&handle));
    }

    #[test]
    fn traverse_raster_ignores_unknown_handle() {
        let (mut app, _) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());

        // A handle the quadtree no longer holds: create a child leaf, capture its
        // handle, then drop it from the tree.
        let stale = {
            let mut qt = app.world_mut().resource_mut::<RasterTileQuadtree>();
            qt.qt.initialize_children((0, 0, 0), &|(x, y, z)| {
                RasterTile::new(TileXYZ { x, y, z }, 0., 0.)
            });
            let stale = qt.qt.leaf((0, 0, 1)).unwrap().handle();
            qt.qt.remove(stale);
            stale
        };
        app.insert_resource(TargetHandle(stale));

        app.add_systems(Update, run_traverse_system);
        app.update();

        // Unknown handle is a no-op: nothing is marked alive.
        let tc = app.world().resource::<RasterTileCacheManager>();
        assert!(
            tc.active_handles.is_empty(),
            "an unknown handle must not touch the cache"
        );
    }

    // ----- tile requests ------------------------------------------------------

    #[test]
    fn traverse_raster_requests_texture_for_in_zoom_layer() {
        let (mut app, handle) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());
        app.insert_resource(TargetHandle(handle));
        spawn_layer(&mut app, raster_layer("a", 0, 20), Order(0));

        app.add_systems(Update, run_traverse_system);
        app.update();

        // Exactly one fragment, built from the root tile's own coordinates.
        assert_eq!(
            requested_urls(&mut app),
            vec!["https://example.com/0/0/0.png".to_string()]
        );

        // The fragment is tagged with the root tile handle...
        let mut markers = app.world_mut().query::<&TileTextureFragmentMarker>();
        let owners: Vec<TileHandle> = markers.iter(app.world()).map(|m| m.0).collect();
        assert_eq!(owners, vec![handle]);

        // ...and the tile records the entity in the single layer slot.
        let qt = app.world().resource::<RasterTileQuadtree>();
        let slots = qt
            .qt
            .get(handle)
            .unwrap()
            .texture_fragment_entity_ids
            .as_ref()
            .unwrap();
        assert_eq!(slots.len(), 1);
        assert!(slots[0].is_some());
    }

    #[test]
    fn traverse_raster_request_is_idempotent() {
        let (mut app, handle) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());
        app.insert_resource(TargetHandle(handle));
        spawn_layer(&mut app, raster_layer("a", 0, 20), Order(0));

        app.add_systems(Update, run_traverse_system);
        // Two passes with the same camera: the second must not re-spawn a fragment
        // for a layer that already has a queryable one.
        app.update();
        app.update();

        assert_eq!(
            requested_urls(&mut app),
            vec!["https://example.com/0/0/0.png".to_string()]
        );
    }

    #[test]
    fn traverse_raster_skips_hillshade_layer() {
        let (mut app, handle) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());
        app.insert_resource(TargetHandle(handle));
        // Regular layer at slot 0, hillshade layer at slot 1.
        spawn_layer(&mut app, raster_layer("regular", 0, 20), Order(0));
        spawn_layer(&mut app, hillshade_layer("hill"), Order(1));

        app.add_systems(Update, run_traverse_system);
        app.update();

        // Only the regular layer is fetched on the raster side.
        assert_eq!(
            requested_urls(&mut app),
            vec!["https://example.com/0/0/0.png".to_string()]
        );

        // The hillshade slot stays empty; the regular slot is filled.
        let qt = app.world().resource::<RasterTileQuadtree>();
        let slots = qt
            .qt
            .get(handle)
            .unwrap()
            .texture_fragment_entity_ids
            .as_ref()
            .unwrap();
        assert!(slots[0].is_some(), "regular layer slot should be requested");
        assert!(slots[1].is_none(), "hillshade slot must stay None");
    }

    #[test]
    fn traverse_raster_skips_layer_below_min_zoom() {
        let (mut app, handle) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());
        app.insert_resource(TargetHandle(handle));
        // A layer that only exists from zoom 2 upward. The root (z=0) and z=1 are
        // below its min zoom, so requests must only appear once the traversal
        // reaches z=2 (subdivision is forced to reach the layer's data).
        spawn_layer(&mut app, raster_layer("a", 2, 20), Order(0));

        app.add_systems(Update, run_traverse_system);
        app.update();

        let urls = requested_urls(&mut app);
        assert!(
            !urls.is_empty(),
            "the layer should be fetched at its min zoom"
        );
        assert!(
            urls.iter().all(|u| u.starts_with("https://example.com/2/")),
            "no fetch below min zoom; got {urls:?}"
        );
    }

    // ----- screen-space error & max zoom subdivision --------------------------

    #[test]
    fn traverse_raster_stops_when_sse_satisfied() {
        let (mut app, handle) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());
        app.insert_resource(TargetHandle(handle));
        spawn_layer(&mut app, raster_layer("a", 0, 20), Order(0));
        // Huge threshold: the root's error is always acceptable.
        app.insert_resource(TraverseConfig {
            max_sse: 1e30,
            terrain_present: false,
        });

        app.add_systems(Update, run_traverse_system);
        app.update();

        // No subdivision: the z=1 children were never created.
        let qt = app.world().resource::<RasterTileQuadtree>();
        assert!(qt.qt.leaf((0, 0, 1)).is_none());
        let tc = app.world().resource::<RasterTileCacheManager>();
        assert_eq!(tc.active_handles.len(), 1);
    }

    #[test]
    fn traverse_raster_subdivides_when_sse_exceeds_threshold() {
        let (mut app, handle) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());
        app.insert_resource(TargetHandle(handle));
        // max_zoom=2 bounds how deep the forced subdivision goes.
        spawn_layer(&mut app, raster_layer("a", 0, 2), Order(0));
        // Zero threshold: the error is never satisfied, so the traversal descends.
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            terrain_present: false,
        });

        app.add_systems(Update, run_traverse_system);
        app.update();

        // The root was subdivided into its children.
        let qt = app.world().resource::<RasterTileQuadtree>();
        assert!(
            qt.qt.leaf((0, 0, 1)).is_some(),
            "root should have subdivided"
        );
        let tc = app.world().resource::<RasterTileCacheManager>();
        assert!(tc.active_handles.len() > 1, "children must be visited");
    }

    #[test]
    fn traverse_raster_stops_subdividing_at_max_zoom() {
        let (mut app, handle) = app_with_root(TerrainTileQuadtree::new_with_linear_qt());
        app.insert_resource(TargetHandle(handle));
        // Layer maxes out at zoom 0, so even an unsatisfiable error must not fetch
        // finer tiles past the max zoom.
        spawn_layer(&mut app, raster_layer("a", 0, 0), Order(0));
        app.insert_resource(TraverseConfig {
            max_sse: 0.,
            terrain_present: false,
        });

        app.add_systems(Update, run_traverse_system);
        app.update();

        // Beyond max zoom there is no subdivision despite the zero threshold.
        let qt = app.world().resource::<RasterTileQuadtree>();
        assert!(
            qt.qt.leaf((0, 0, 1)).is_none(),
            "must not descend past max zoom"
        );
        let tc = app.world().resource::<RasterTileCacheManager>();
        assert_eq!(tc.active_handles.len(), 1);
    }
}
