use bevy_ecs::prelude::*;
use navara_buffer_store::BufferStore;
use navara_core::{Extent, LngLat, Radians};
use navara_event_store::EventStore;
use navara_math::{EPSILON3, EqualEpsilon, FloatType};
use navara_tile_component::TerrainTileQuadtree;
use navara_tile_component::{
    TerrainHeightObserver, TerrainHeightRangeObserver, TileMeshMarker,
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
/// whose real heights landed this frame (see [`landed_terrain_extents`]).
pub fn update_height_observers(
    mut events: ResMut<EventStore>,
    mut qt: ResMut<TerrainTileQuadtree>,
    mut buf: ResMut<BufferStore>,
    mut query: Query<(Entity, &mut TerrainHeightObserver)>,
    added_meshes: Query<&TileMeshMarker, Added<TileMeshMarker>>,
    meshes: Query<&TileMeshMarker>,
    terrain_data_requester: TileTerrainDataRequesterQuery,
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
        let stale = observer.is_added() || landed.iter().any(|extent| extent.contains(&point));
        if !stale {
            continue;
        }

        let terrain_height = compute_terrain_height_at_point(
            &mut qt,
            &mut buf,
            &terrain_data_requester,
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
/// [`landed_terrain_extents`]).
pub fn update_terrain_height_range_observers(
    mut events: ResMut<EventStore>,
    qt: Res<TerrainTileQuadtree>,
    mut observers: Query<(Entity, &mut TerrainHeightRangeObserver)>,
    added_meshes: Query<&TileMeshMarker, Added<TileMeshMarker>>,
    meshes: Query<&TileMeshMarker>,
) {
    if observers.is_empty() {
        return;
    }
    // Collected: checked against every observer.
    let landed: Vec<_> = landed_terrain_extents(&qt, &events, &added_meshes, &meshes).collect();
    for (entity, mut observer) in observers.iter_mut() {
        let stale = observer.is_added()
            || landed
                .iter()
                .any(|extent| extent.intersects(observer.extent));
        if !stale {
            continue;
        }

        let (min, max) = terrain_height_range(&qt, observer.extent);
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

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_app::{App, PostUpdate};
    use navara_core::{Angle, LLE, TileXYZ};
    use navara_tile_component::TerrainTile;

    fn app() -> App {
        let mut app = App::new();
        app.init_resource::<EventStore>();
        app.init_resource::<BufferStore>();
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
}
