use bevy_ecs::prelude::*;
use navara_buffer_store::BufferStore;
use navara_camera::CameraController;
use navara_core::{Extent, LngLat, Radians};
use navara_event_store::{EventStore, TerrainExaggerationUpdated};
use navara_layer::TerrainLayer;
use navara_math::{EPSILON3, EqualEpsilon, FloatType};
use navara_tile_component::TerrainTileQuadtree;
use navara_tile_component::{
    TerrainExaggeration, TerrainHeightObserver, TerrainHeightRangeObserver, TileMeshMarker,
    TileTerrainDataRequesterQuery, compute_terrain_height_at_point, terrain_height_range,
};

/// Extents of the terrain tiles whose real heights landed this frame: a new
/// mesh, or an upsampled mesh replaced in place by its DEM. The in-place
/// replacement keeps its `TileMeshMarker`, so it shows up only as
/// `mesh_geometry_replaced`. A new upsampled mesh is skipped, since it repeats
/// its ancestor's heights.
fn landed_terrain_extents<'a>(
    qt: &'a TerrainTileQuadtree,
    events: &'a EventStore,
    added_meshes: &'a Query<&TileMeshMarker, Added<TileMeshMarker>>,
    meshes: &'a Query<&TileMeshMarker>,
) -> impl Iterator<Item = Extent<FloatType, Radians>> + 'a {
    let replaced = events
        .mesh_geometry_replaced
        .iter()
        .filter_map(|&entity| meshes.get(entity).ok());
    added_meshes
        .iter()
        .chain(replaced)
        .filter_map(|marker| qt.qt.get(marker.handle))
        .filter(|tile| !tile.upsampled)
        .map(|tile| tile.extent)
}

/// Samples new observers and re-samples the observers inside a terrain tile
/// whose real heights landed this frame (see [`landed_terrain_extents`]), or
/// every observer when the exaggeration changed.
#[allow(clippy::too_many_arguments)]
pub fn update_height_observers(
    mut events: ResMut<EventStore>,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut buf: ResMut<BufferStore>,
    mut query: Query<(Entity, &mut TerrainHeightObserver)>,
    added_meshes: Query<&TileMeshMarker, Added<TileMeshMarker>>,
    meshes: Query<&TileMeshMarker>,
    terrain_data_requester: TileTerrainDataRequesterQuery,
    exaggeration: Res<TerrainExaggeration>,
) {
    if query.is_empty() {
        return;
    }
    // Collected: checked against every observer while `qt` is borrowed mutably.
    let landed: Vec<_> = landed_terrain_extents(&qt, &events, &added_meshes, &meshes).collect();
    for (entity, mut observer) in query.iter_mut() {
        let point = LngLat {
            lng: observer.lle.lng,
            lat: observer.lle.lat,
        };
        let stale = observer.is_added()
            || exaggeration.is_changed()
            || landed.iter().any(|extent| extent.contains(&point));
        if !stale {
            continue;
        }

        let terrain_height = compute_terrain_height_at_point(
            &mut qt,
            &mut buf,
            &terrain_data_requester,
            &exaggeration,
            &LngLat::new(observer.lle.lat.val(), observer.lle.lng.val()),
        );

        // Update observer height only if it has changed significantly
        if !observer.height.equal_diff_epsilon(terrain_height, EPSILON3) {
            observer.height = terrain_height;

            events.update_sample_terrain_height.push(entity);
        }
    }
}

/// Recomputes the range of new observers and of observers overlapping a
/// terrain tile whose real heights landed this frame (see
/// [`landed_terrain_extents`]), or of every observer when the exaggeration
/// changed.
pub fn update_terrain_height_range_observers(
    mut events: ResMut<EventStore>,
    qt: Res<TerrainTileQuadtree>,
    mut observers: Query<(Entity, &mut TerrainHeightRangeObserver)>,
    added_meshes: Query<&TileMeshMarker, Added<TileMeshMarker>>,
    meshes: Query<&TileMeshMarker>,
    exaggeration: Res<TerrainExaggeration>,
) {
    if observers.is_empty() {
        return;
    }
    // Collected: checked against every observer.
    let landed: Vec<_> = landed_terrain_extents(&qt, &events, &added_meshes, &meshes).collect();
    for (entity, mut observer) in observers.iter_mut() {
        let stale = observer.is_added()
            || exaggeration.is_changed()
            || landed
                .iter()
                .any(|extent| extent.intersects(observer.extent));
        if !stale {
            continue;
        }

        let (min, max) = terrain_height_range(&qt, &exaggeration, observer.extent);
        let changed = observer.range.is_none_or(|(prev_min, prev_max)| {
            !prev_min.equal_diff_epsilon(min, EPSILON3)
                || !prev_max.equal_diff_epsilon(max, EPSILON3)
        });
        if changed {
            observer.range = Some((min, max));
            events.update_terrain_height_range.push(entity);
        }
    }
}

/// Mirror the exaggeration of the first terrain layer the query yields into
/// [`TerrainExaggeration`], the single value every height-dependent system
/// reads. Without a terrain layer the surface is not exaggerated. Reported on
/// the first frame too, since the renderer's horizon culling has no default of
/// its own.
// TODO: Supporting several terrain layers at once needs one exaggeration per
// rendered surface: tile bounds, height queries, clamped features, the
// raster/vector SSE height borrow and the camera floor all assume one value,
// and adjacent layers with different values would leave a step at their seam.
pub fn sync_terrain_exaggeration(
    layers: Query<&TerrainLayer>,
    mut exaggeration: ResMut<TerrainExaggeration>,
    mut events: ResMut<EventStore>,
) {
    let next = layers
        .iter()
        .next()
        .map(TerrainExaggeration::of_layer)
        .unwrap_or_default();
    if exaggeration.set_if_neq(next) || exaggeration.is_added() {
        events.terrain_exaggeration_updated = Some(TerrainExaggerationUpdated {
            scale: next.scale(),
            relative_height: next.relative_height(),
            horizon_minimum_height: next.horizon_minimum_height(),
        });
    }
}

/// Lower the camera's zoom floor to where the exaggeration moves sea level,
/// so the camera can reach terrain sunk below the ellipsoid.
#[allow(clippy::type_complexity)]
pub fn sync_camera_surface_floor(
    exaggeration: Res<TerrainExaggeration>,
    mut controllers: ParamSet<(
        Query<&mut CameraController>,
        Query<&mut CameraController, Added<CameraController>>,
    )>,
) {
    let floor = exaggeration.apply(0.).min(0.);
    if exaggeration.is_changed() {
        for mut controller in &mut controllers.p0() {
            controller.surface_floor = floor;
        }
    } else {
        for mut controller in &mut controllers.p1() {
            controller.surface_floor = floor;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_app::{App, PostUpdate, Update};
    use navara_core::{Angle, LLE, TileXYZ};
    use navara_tile_component::TerrainTile;

    fn app() -> App {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<BufferStore>();
        app.init_resource::<TerrainExaggeration>();
        let mut qt = TerrainTileQuadtree::new_with_linear_qt();
        qt.qt
            .initialize_zero(&|(x, y, z)| TerrainTile::new(TileXYZ { x, y, z }, 0., 0.));
        app.insert_resource(qt);
        app.add_systems(
            PostUpdate,
            (
                update_height_observers,
                update_terrain_height_range_observers,
            ),
        );
        app
    }

    #[test]
    fn reports_a_new_range_observer_once() {
        let mut app = app();
        let extent = Extent {
            west: Angle::new(0.1),
            south: Angle::new(0.1),
            east: Angle::new(0.11),
            north: Angle::new(0.11),
        };
        let observer = app
            .world_mut()
            .spawn(TerrainHeightRangeObserver {
                extent,
                range: None,
            })
            .id();

        app.update();
        let events = app.world().resource::<EventStore>();
        assert_eq!(events.update_terrain_height_range, vec![observer]);
        assert_eq!(
            app.world()
                .get::<TerrainHeightRangeObserver>(observer)
                .unwrap()
                .range,
            Some((0., 0.)),
            "the ellipsoid surface before any terrain loads"
        );

        app.world_mut().resource_mut::<EventStore>().clear();
        app.update();
        assert!(
            app.world()
                .resource::<EventStore>()
                .update_terrain_height_range
                .is_empty()
        );
    }

    #[test]
    fn samples_a_new_height_observer_without_a_landed_mesh() {
        let mut app = app();
        // No real sampling produces it, so the first sample shows up as a
        // change.
        let stale_height = Some(5.);
        let observer = app
            .world_mut()
            .spawn(TerrainHeightObserver {
                lle: LLE::from_float(0.1, 0.1, 0.),
                height: stale_height,
            })
            .id();

        app.update();
        assert_eq!(
            app.world()
                .resource::<EventStore>()
                .update_sample_terrain_height,
            vec![observer]
        );
        assert_ne!(
            app.world()
                .get::<TerrainHeightObserver>(observer)
                .unwrap()
                .height,
            stale_height
        );
    }

    #[test]
    fn observers_skip_new_upsampled_meshes_but_not_their_replacement() {
        // Both observers watch the root tile: the height observer at its
        // centre, the range observer over its extent.
        let mut app = app();
        let handle = app
            .world()
            .resource::<TerrainTileQuadtree>()
            .qt
            .zero()
            .unwrap()
            .handle();
        let extent = app
            .world()
            .resource::<TerrainTileQuadtree>()
            .qt
            .get(handle)
            .unwrap()
            .extent;
        let lle = LLE::from_float(
            (extent.west.val() + extent.east.val()) / 2.,
            (extent.south.val() + extent.north.val()) / 2.,
            0.,
        );
        let height_observer = app
            .world_mut()
            .spawn(TerrainHeightObserver { lle, height: None })
            .id();
        let range_observer = app
            .world_mut()
            .spawn(TerrainHeightRangeObserver {
                extent,
                range: None,
            })
            .id();
        // Lets the new observers take their first values.
        app.update();

        // Stale values that no real sampling produces, so a recompute shows
        // up as a change.
        let stale_height = Some(5.);
        let stale_range = Some((1., 1.));
        app.world_mut()
            .get_mut::<TerrainHeightObserver>(height_observer)
            .unwrap()
            .height = stale_height;
        app.world_mut()
            .get_mut::<TerrainHeightRangeObserver>(range_observer)
            .unwrap()
            .range = stale_range;
        let observed = |app: &App| {
            (
                app.world()
                    .get::<TerrainHeightObserver>(height_observer)
                    .unwrap()
                    .height,
                app.world()
                    .get::<TerrainHeightRangeObserver>(range_observer)
                    .unwrap()
                    .range,
            )
        };

        // A new upsampled mesh repeats its ancestor's heights, so neither
        // observer recomputes.
        app.world_mut()
            .resource_mut::<TerrainTileQuadtree>()
            .qt
            .get_mut(handle)
            .unwrap()
            .upsampled = true;
        let mesh = app
            .world_mut()
            .spawn(TileMeshMarker {
                handle,
                ready_parent_tile_handle: None,
            })
            .id();
        app.update();
        assert_eq!(observed(&app), (stale_height, stale_range));

        // Its DEM replaces it in place, as `commit_tile_mesh` does: the marker
        // is no longer `Added` and only `mesh_geometry_replaced` reports it,
        // yet both observers recompute.
        app.world_mut()
            .resource_mut::<TerrainTileQuadtree>()
            .qt
            .get_mut(handle)
            .unwrap()
            .upsampled = false;
        app.world_mut()
            .resource_mut::<EventStore>()
            .mesh_geometry_replaced
            .push(mesh);
        app.update();
        let (height, range) = observed(&app);
        assert_ne!(height, stale_height);
        assert_ne!(range, stale_range);
    }

    #[test]
    fn observers_recompute_when_the_exaggeration_changes() {
        let mut app = app();
        let extent = Extent {
            west: Angle::new(0.1),
            south: Angle::new(0.1),
            east: Angle::new(0.11),
            north: Angle::new(0.11),
        };
        let height_observer = app
            .world_mut()
            .spawn(TerrainHeightObserver {
                lle: LLE::from_float(0.1, 0.1, 0.),
                height: None,
            })
            .id();
        let range_observer = app
            .world_mut()
            .spawn(TerrainHeightRangeObserver {
                extent,
                range: None,
            })
            .id();
        // Lets the new observers take their first values.
        app.update();

        // Stale values that no real sampling produces, so a recompute shows
        // up as a change.
        app.world_mut()
            .get_mut::<TerrainHeightObserver>(height_observer)
            .unwrap()
            .height = Some(5.);
        app.world_mut()
            .get_mut::<TerrainHeightRangeObserver>(range_observer)
            .unwrap()
            .range = Some((1., 1.));
        app.world_mut().resource_mut::<EventStore>().clear();

        // Scale 2 around 100 m moves the flat surface to -100 m.
        *app.world_mut().resource_mut::<TerrainExaggeration>() = TerrainExaggeration::new(2., 100.);
        app.update();

        let events = app.world().resource::<EventStore>();
        assert_eq!(events.update_sample_terrain_height, vec![height_observer]);
        assert_eq!(events.update_terrain_height_range, vec![range_observer]);
        assert_eq!(
            app.world()
                .get::<TerrainHeightRangeObserver>(range_observer)
                .unwrap()
                .range,
            Some((-100., -100.))
        );
    }

    #[test]
    fn exaggeration_follows_the_terrain_layer() {
        use navara_material::TerrainMaterial;

        let mut app = App::new();
        app.init_resource::<TerrainExaggeration>()
            .init_resource::<EventStore>()
            .add_systems(Update, sync_terrain_exaggeration);
        let take_event = |app: &mut App| {
            app.world_mut()
                .resource_mut::<EventStore>()
                .terrain_exaggeration_updated
                .take()
        };
        let layer = app
            .world_mut()
            .spawn(TerrainLayer {
                appearance: Some(TerrainMaterial {
                    exaggeration: 3.,
                    exaggeration_relative_height: 500.,
                    ..Default::default()
                }),
                ..Default::default()
            })
            .id();

        app.update();
        assert_eq!(
            *app.world().resource::<TerrainExaggeration>(),
            TerrainExaggeration::new(3., 500.)
        );
        assert_eq!(
            take_event(&mut app),
            Some(TerrainExaggerationUpdated {
                scale: 3.,
                relative_height: 500.,
                horizon_minimum_height: -2500.,
            })
        );

        // An unchanged value is not reported again.
        app.update();
        assert_eq!(take_event(&mut app), None);

        // A negative layer value reads as 0.
        app.world_mut()
            .get_mut::<TerrainLayer>(layer)
            .unwrap()
            .appearance
            .as_mut()
            .unwrap()
            .exaggeration = -1.;
        app.update();
        assert_eq!(app.world().resource::<TerrainExaggeration>().scale(), 0.);

        // Without a terrain layer the surface is not exaggerated.
        app.world_mut().despawn(layer);
        app.update();
        assert_eq!(
            *app.world().resource::<TerrainExaggeration>(),
            TerrainExaggeration::default()
        );
        assert_eq!(
            take_event(&mut app),
            Some(TerrainExaggerationUpdated {
                scale: 1.,
                relative_height: 0.,
                horizon_minimum_height: -500.,
            })
        );
    }

    #[test]
    fn exaggeration_is_reported_on_the_first_frame_without_a_terrain_layer() {
        let mut app = App::new();
        app.init_resource::<TerrainExaggeration>()
            .init_resource::<EventStore>()
            .add_systems(Update, sync_terrain_exaggeration);

        app.update();
        assert_eq!(
            app.world_mut()
                .resource_mut::<EventStore>()
                .terrain_exaggeration_updated
                .take(),
            Some(TerrainExaggerationUpdated {
                scale: 1.,
                relative_height: 0.,
                horizon_minimum_height: -500.,
            })
        );

        app.update();
        assert_eq!(
            app.world_mut()
                .resource_mut::<EventStore>()
                .terrain_exaggeration_updated
                .take(),
            None
        );
    }

    #[test]
    fn camera_surface_floor_follows_the_sunken_sea_level() {
        let mut app = App::new();
        app.init_resource::<TerrainExaggeration>()
            .add_systems(Update, sync_camera_surface_floor);
        let camera = app.world_mut().spawn(CameraController::default()).id();

        app.update();
        assert_eq!(
            app.world()
                .get::<CameraController>(camera)
                .unwrap()
                .surface_floor,
            0.
        );

        // Scale 5 around 2000 m moves sea level to -8000 m.
        *app.world_mut().resource_mut::<TerrainExaggeration>() =
            TerrainExaggeration::new(5., 2000.);
        app.update();
        assert_eq!(
            app.world()
                .get::<CameraController>(camera)
                .unwrap()
                .surface_floor,
            -8000.
        );

        // A camera spawned while the exaggeration is unchanged gets the floor.
        let late = app.world_mut().spawn(CameraController::default()).id();
        app.update();
        assert_eq!(
            app.world()
                .get::<CameraController>(late)
                .unwrap()
                .surface_floor,
            -8000.
        );

        // A raised sea level never lifts the floor above the ellipsoid.
        *app.world_mut().resource_mut::<TerrainExaggeration>() =
            TerrainExaggeration::new(0.5, 2000.);
        app.update();
        assert_eq!(
            app.world()
                .get::<CameraController>(camera)
                .unwrap()
                .surface_floor,
            0.
        );
    }
}
