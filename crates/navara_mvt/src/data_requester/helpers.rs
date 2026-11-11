use bevy_ecs::{entity::Entity, system::Commands};
use navara_buffer_store::BufferStore;
use navara_component::{OrderByDistance, Priority};
use navara_core::TilingScheme;
use navara_data_requester::{DataRequester, DataRequesterExtension};
use navara_tile_component::{TileHandle, VectorTile};

use super::{MvtDataRequesterMarker, MvtDataRequesterQuery};

pub(crate) fn request_mvt_data(
    commands: &mut Commands,
    tile: &mut VectorTile,
    buf: &mut BufferStore,
    url: &str,
    handle: TileHandle,
    data_requesters: &MvtDataRequesterQuery,
    priority: Priority,
) -> Option<Entity> {
    // A requester spawned earlier this frame is not in the query yet, so a
    // second call in the same pass must not spawn another.
    if matches!(tile.data_requester_entity_id, Some(e) if data_requesters.contains(e) || commands.get_entity(e).is_ok())
    {
        return None;
    }

    let e = commands
        .spawn((
            MvtDataRequesterMarker(handle),
            DataRequester::from_store(
                TilingScheme::WebMercator { tms: false }.tile_url(url, tile.coords),
                buf,
                DataRequesterExtension::Mvt,
            ),
            OrderByDistance {
                sse: tile.sse,
                distance: tile.distance_from_camera,
            },
            priority,
        ))
        .id();
    tile.data_requester_entity_id = Some(e);

    Some(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_ecs::{system::RunSystemOnce, world::World};
    use navara_core::TileXYZ;

    /// Two calls in one pass spawn one requester: the first one is not in
    /// the query yet.
    #[test]
    fn it_should_not_request_a_tile_twice_in_one_pass() {
        let mut world = World::new();
        let mut tile = VectorTile::new(TileXYZ { x: 0, y: 0, z: 0 }, 0., 0.);
        let mut buf = BufferStore::default();
        let url = "https://example.com/{z}/{x}/{y}.mvt";
        let (first, second) = world
            .run_system_once(move |mut commands: Commands, q: MvtDataRequesterQuery| {
                let mut request = |commands: &mut Commands, q: &MvtDataRequesterQuery| {
                    request_mvt_data(commands, &mut tile, &mut buf, url, 0, q, Priority::Medium)
                };
                let first = request(&mut commands, &q);
                let second = request(&mut commands, &q);
                (first, second)
            })
            .unwrap();
        assert!(first.is_some());
        assert_eq!(second, None);
    }
}
