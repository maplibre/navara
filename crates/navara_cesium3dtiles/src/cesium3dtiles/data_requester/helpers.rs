use bevy_ecs::{component::Component, entity::Entity, system::Commands};
use bevy_log::error;
use navara_buffer_store::BufferStore;
use navara_component::Priority;
use navara_data_requester::{DataRequester, RequestOrder};
use url::Url;

use crate::{
    Cesium3dTileContent, TileOrderByDistance,
    b3dm::B3dmDataRequesterMarker,
    cesium3dtiles::{ContentKind, resolve_content_url, types::Cesium3dTileContentRequesterQuery},
    glb::GlbDataRequesterMarker,
    gltf_features::GltfFeaturesDataRequesterMarker,
    pnts::PntsDataRequesterMarker,
};

#[derive(Component)]
pub struct Cesium3dTilesMetadataDataRequesterMarker(pub Entity);

#[derive(Component)]
pub struct Cesium3dTileContentDataRequesterMarker;

/// Layer (tileset) entity that owns a content data requester, attached at
/// spawn so the dispatch-time reservation (`filter_requestable_data_requester`)
/// can key the per-tileset cost estimator — different tilesets have wildly
/// different content sizes, so their landed-cost statistics must not be
/// pooled globally.
#[derive(Component, Clone, Copy)]
pub struct Cesium3dTileContentLayerId(pub Entity);

/// Marker for the [`DataRequester`] that fetches a *nested* `tileset.json`.
///
/// Distinguishes nested-tileset metadata requesters from the layer's root
/// metadata requester so `construct_cesium_3d_tiles_tree` can route them
/// differently (root → spawn tree entity; nested → insert into the
/// [`Cesium3dTilesNestedTreeMap`](crate::Cesium3dTilesNestedTreeMap)).
#[derive(Component)]
pub struct Cesium3dTilesNestedMetadataDataRequesterMarker;

/// Spawns a data requester for every renderable content of `tile` that has
/// none alive.
// TODO: Request again if the request failed.
#[allow(clippy::too_many_arguments)]
pub(crate) fn request_tile_content(
    commands: &mut Commands,
    buf: &mut BufferStore,
    base_url: &Url,
    tile: &mut Cesium3dTileContent,
    requesters: &Cesium3dTileContentRequesterQuery,
    priority: Priority,
    is_v1_1: bool,
    layer_id: Entity,
) {
    let request_order = RequestOrder(TileOrderByDistance {
        distance_from_camera: tile.state.distance_from_camera,
        sse: tile.state.sse,
    });
    for slot in &mut tile.contents {
        // A nested tileset is requested by the traversal.
        if slot.kind == ContentKind::Json
            || slot
                .data_requester_id
                .is_some_and(|id| requesters.contains(id))
        {
            continue;
        }
        let content_url = match resolve_content_url(base_url, &slot.uri) {
            Ok(url) => url.to_string(),
            Err(e) => {
                error!("{}", e);
                continue;
            }
        };
        let mut entity = commands.spawn((
            Cesium3dTileContentDataRequesterMarker,
            Cesium3dTileContentLayerId(layer_id),
            priority,
            request_order.clone(),
            DataRequester::from_store(content_url, buf, slot.kind.data_requester_extension()),
        ));
        match slot.kind {
            ContentKind::Pnts => entity.insert(PntsDataRequesterMarker),
            ContentKind::B3dm => entity.insert(B3dmDataRequesterMarker),
            ContentKind::Glb | ContentKind::Gltf if is_v1_1 => {
                entity.insert(GltfFeaturesDataRequesterMarker)
            }
            ContentKind::Glb | ContentKind::Gltf => entity.insert(GlbDataRequesterMarker),
            ContentKind::Json => unreachable!(),
        };
        slot.data_requester_id = Some(entity.id());
    }
}
