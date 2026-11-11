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
    let data_requester_entity_id = tile.data_requester_entity_id;
    if matches!(data_requester_entity_id, Some(e) if data_requesters.contains(e)) {
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
