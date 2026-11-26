use bevy_ecs::{
    entity::Entity,
    query::{Added, Or, With, Without},
    system::{Commands, Query, Res},
};
use navara_component::{Deleted, Ignored, Priority, Requested};
use navara_data_requester::{DataRequester, RequestOrder};

use crate::{
    Cesium3dTileContentDataRequesterMarker, Cesium3dTileContentLayerId,
    Cesium3dTilesMetadataDataRequesterMarker, TileOrderByDistance, b3dm::B3dmDataRequesterMarker,
    glb::GlbDataRequesterMarker, gltf_features::GltfFeaturesDataRequesterMarker,
    i3dm::I3dmDataRequesterMarker, pnts::PntsDataRequesterMarker,
};

#[allow(clippy::type_complexity)]
pub fn filter_requestable_data_requester(
    mut commands: Commands,
    data_requesters: Query<
        (
            Entity,
            &DataRequester,
            &Priority,
            &RequestOrder<TileOrderByDistance>,
            Option<&Cesium3dTileContentLayerId>,
        ),
        (
            With<DataRequester>,
            With<Cesium3dTileContentDataRequesterMarker>,
            Or<(
                With<B3dmDataRequesterMarker>,
                With<I3dmDataRequesterMarker>,
                With<PntsDataRequesterMarker>,
                With<GlbDataRequesterMarker>,
                With<GltfFeaturesDataRequesterMarker>,
            )>,
            Without<Cesium3dTilesMetadataDataRequesterMarker>,
            Added<DataRequester>,
            Without<Deleted>,
        ),
    >,
    requested_data_requesters: Query<
        Entity,
        (
            With<DataRequester>,
            With<Requested>,
            With<Cesium3dTileContentDataRequesterMarker>,
            Or<(
                With<B3dmDataRequesterMarker>,
                With<I3dmDataRequesterMarker>,
                With<PntsDataRequesterMarker>,
                With<GlbDataRequesterMarker>,
                With<GltfFeaturesDataRequesterMarker>,
            )>,
            Without<Cesium3dTilesMetadataDataRequesterMarker>,
            Without<Deleted>,
        ),
    >,
    limits: Res<navara_data_requester::RequestLimits>,
    pressure: Res<navara_memory::SsePressure>,
    ledger: Res<navara_memory::MemoryLedger>,
) {
    let pendings = requested_data_requesters.iter().count();
    // Load gate: when the memory budget is exhausted, start ZERO new fetches
    // and settle on the already-loaded tiles instead of evicting → refetching
    // in an endless loop. In-flight requests proceed; forcing `num_skip == 0`
    // rejects every newly-Added requester this frame so none is dispatched.
    let num_skip = if pressure.load_gate_closed {
        0
    } else {
        (limits.max_pendings as i32 - pendings as i32).max(0)
    };

    let dispatched: Vec<_> = data_requesters
        .iter()
        .sort::<(&Priority, &RequestOrder<TileOrderByDistance>)>()
        .collect();

    // Reserve the per-tileset adaptive estimate (resolved by the
    // `ReservedCost` on_insert hook — EMA of previously landed content payload
    // costs keyed by the requester's layer entity, seeded by the 3D Tiles
    // constant while cold). Only the admitted prefix, not the rejected tail
    // below, is reserved.
    if ledger.enabled() {
        for (e, _, _, _, layer) in dispatched.iter().take(num_skip as usize) {
            let reservation = match layer {
                Some(l) => navara_memory::ReservedCost::for_key(
                    navara_memory::ReserveKey::Tiles3dLayer(l.0),
                ),
                // No layer stamp → no EMA pool; reserve the flat seed.
                None => {
                    navara_memory::ReservedCost::fixed(navara_memory::DEFAULT_TILES3D_RESERVE_BYTES)
                }
            };
            commands.entity(*e).try_insert(reservation);
        }
    }

    // Limit the number of content requests in this frame
    for (e, _, _, _, _) in dispatched.into_iter().skip(num_skip as usize) {
        commands.entity(e).insert((Deleted, Ignored));
    }
}

#[allow(clippy::type_complexity)]
pub fn filter_requestable_metadata_requester(
    mut commands: Commands,
    data_requesters: Query<
        (
            Entity,
            &DataRequester,
            &Priority,
            &RequestOrder<TileOrderByDistance>,
        ),
        (
            With<DataRequester>,
            With<Cesium3dTileContentDataRequesterMarker>,
            With<Cesium3dTilesMetadataDataRequesterMarker>,
            Added<DataRequester>,
            Without<Deleted>,
        ),
    >,
    requested_data_requesters: Query<
        Entity,
        (
            With<DataRequester>,
            With<Requested>,
            With<Cesium3dTileContentDataRequesterMarker>,
            With<Cesium3dTilesMetadataDataRequesterMarker>,
            Without<Deleted>,
        ),
    >,
    limits: Res<navara_data_requester::RequestLimits>,
    pressure: Res<navara_memory::SsePressure>,
) {
    let pendings = requested_data_requesters.iter().count();
    // Load gate: when the memory budget is exhausted, start ZERO new fetches
    // and settle on the already-loaded tiles instead of evicting → refetching
    // in an endless loop. In-flight requests proceed; forcing `num_skip == 0`
    // rejects every newly-Added requester this frame so none is dispatched.
    let num_skip = if pressure.load_gate_closed {
        0
    } else {
        (limits.max_pendings as i32 - pendings as i32).max(0)
    };

    // Limit the number of metadata requests in this frame
    for (e, _, _, _) in data_requesters
        .iter()
        .sort::<(&Priority, &RequestOrder<TileOrderByDistance>)>()
        .skip(num_skip as usize)
    {
        commands.entity(e).insert((Deleted, Ignored));
    }
}

#[cfg(test)]
mod load_gate_tests {
    use super::*;
    use bevy_app::{App, Update};
    use navara_data_requester::RequestLimits;
    use navara_memory::{MemoryLedger, SsePressure};

    fn spawn_content_requester(app: &mut App) -> Entity {
        app.world_mut()
            .spawn((
                DataRequester::default(),
                Cesium3dTileContentDataRequesterMarker,
                B3dmDataRequesterMarker,
                Priority::High,
                RequestOrder(TileOrderByDistance::default()),
            ))
            .id()
    }

    fn setup(gate_closed: bool) -> App {
        let mut app = App::new();
        app.init_resource::<RequestLimits>();
        app.init_resource::<MemoryLedger>();
        app.init_resource::<navara_memory::ReserveEstimates>();
        app.insert_resource(SsePressure {
            multiplier: 1.0,
            load_gate_closed: gate_closed,
            ..Default::default()
        });
        app.add_systems(Update, filter_requestable_data_requester);
        app
    }

    #[test]
    fn closed_gate_rejects_new_content_request() {
        let mut app = setup(true);
        let e = spawn_content_requester(&mut app);
        // `Added` sees the previous frame; two ticks so the filter observes it.
        app.update();
        app.update();
        // Gate closed → rejected this frame (no fetch dispatched).
        assert!(app.world().get::<Deleted>(e).is_some());
    }

    #[test]
    fn open_gate_admits_new_content_request() {
        let mut app = setup(false);
        let e = spawn_content_requester(&mut app);
        app.update();
        app.update();
        // Gate open, under the pending limit → admitted (not rejected).
        assert!(app.world().get::<Deleted>(e).is_none());
    }
}
