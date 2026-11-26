use bevy_ecs::{
    query::{Added, Changed, Or, With, Without},
    system::Query,
};
use navara_component::Deleted;
use navara_data_requester::DataRequester;

use crate::{
    Cesium3dTilesMetadataDataRequesterMarker, b3dm::B3dmDataRequesterMarker,
    glb::GlbDataRequesterMarker, gltf_features::GltfFeaturesDataRequesterMarker,
    i3dm::I3dmDataRequesterMarker, pnts::PntsDataRequesterMarker,
};

use super::Cesium3dTileContentDataRequesterMarker;

pub type Cesium3dTileContentRequesterQuery<'a, 'world, 'state> = Query<
    'world,
    'state,
    (
        &'a Cesium3dTileContentDataRequesterMarker,
        &'a DataRequester,
    ),
    (
        Or<(
            With<B3dmDataRequesterMarker>,
            With<I3dmDataRequesterMarker>,
            With<PntsDataRequesterMarker>,
            With<GlbDataRequesterMarker>,
            With<GltfFeaturesDataRequesterMarker>,
            With<Cesium3dTilesMetadataDataRequesterMarker>,
        )>,
        Without<Deleted>,
    ),
>;

pub type ChangedCesium3dTileContentRequesterQuery<'a, 'world, 'state> = Query<
    'world,
    'state,
    (
        &'a Cesium3dTileContentDataRequesterMarker,
        &'a DataRequester,
    ),
    (
        Or<(
            With<B3dmDataRequesterMarker>,
            With<I3dmDataRequesterMarker>,
            With<PntsDataRequesterMarker>,
            With<GlbDataRequesterMarker>,
            With<GltfFeaturesDataRequesterMarker>,
            With<Cesium3dTilesMetadataDataRequesterMarker>,
        )>,
        Or<(Added<DataRequester>, Changed<DataRequester>)>,
        Without<Deleted>,
    ),
>;
