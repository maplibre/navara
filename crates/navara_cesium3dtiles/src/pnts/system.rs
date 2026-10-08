//! PNTS standalone layer systems.
//!
//! These systems handle PNTS files loaded directly as layers (not via 3D Tiles).
//! The 3D Tiles pipeline uses the generic construct and cleanup systems instead.

use bevy_ecs::{
    entity::Entity,
    query::{Added, Changed, With, Without},
    system::{Commands, Query, Res, ResMut},
};

use navara_buffer_store::{BufferStore, Handle};
use navara_component::{Deleted, Priority};
use navara_core::CRS;
use navara_data_requester::{DataRequester, DataRequesterExtension, DataRequesterStatus};
use navara_feature_component::{
    batch::{FeatureBatchId, GlobalBatchIds},
    id::FeatureId,
    model::{ModelBin, ModelGeometry},
    render::RenderableFeature,
};
use navara_layer::{DeletePntsLayerMarker, LayerId, LayerStore, PntsLayer, UpdatePntsLayerMarker};
use navara_material::{Appearance, ModelInternalMaterial, ModelMaterial};
use navara_math::{Transform, Vec3};

use super::parser::get_geometry_info_from_pnts;
use super::requester::PntsLayerDataRequesterMarker;

pub fn request_model_by_pnts_layer(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    source_store: Res<navara_source::SourceStore>,
    pnts_layers: Query<(Entity, &PntsLayer), Added<PntsLayer>>,
) {
    for (e, layer) in &pnts_layers {
        // Resolve the content URL live from the referenced source.
        let Some(base_url) = layer
            .source_id
            .as_deref()
            .and_then(|id| source_store.get(id))
            .and_then(|s| s.url())
        else {
            continue;
        };
        commands.spawn((
            PntsLayerDataRequesterMarker(e),
            Priority::Medium,
            DataRequester::from_store(base_url.to_owned(), &mut buf, DataRequesterExtension::Pnts),
        ));
    }
}

#[allow(clippy::type_complexity)]
pub fn construct_model_by_pnts_layer(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    requesters: Query<
        (Entity, &PntsLayerDataRequesterMarker, &DataRequester),
        (Changed<DataRequester>, Without<Deleted>),
    >,
    pnts_layers: Query<&PntsLayer>,
) {
    for (e, marker, req) in &requesters {
        if !matches!(req.status, DataRequesterStatus::Pending) {
            commands.entity(e).despawn();
        }

        // TODO: Handle fail
        if !matches!(req.status, DataRequesterStatus::Success) {
            continue;
        }
        let layer = match pnts_layers.get(marker.0) {
            Ok(l) => l,
            Err(_) => unreachable!(),
        };
        let mut appearance = Appearance::clone_model_or_default(&layer.appearances);
        appearance.should_rotate_in_default = false;

        let (draco_attributes, positions_center, positions_handle) =
            match get_geometry_info_from_pnts(&mut buf, req.handle) {
                Some(r) => r,
                None => continue,
            };

        appearance.internal = Some(ModelInternalMaterial {
            draco_attributes,
            point_cloud: true,
            point_cloud_geodetic_normal: Vec3::ZERO,
        });

        commands.spawn((
            LayerId(layer.layer_id.to_owned()),
            FeatureId::default(),
            FeatureBatchId(0), // Dummy value,
            GlobalBatchIds {
                // Dummy value
                handle: Handle::default(),
                batch_length: 0,
                instance_feature_indices: None,
            },
            ModelGeometry {
                coords: positions_center,
                crs: CRS::Geocentric,
            },
            appearance,
            ModelBin(positions_handle),
            Transform::IDENTITY,
        ));

        buf.remove(&req.handle);
    }
}

pub fn update_model_by_pnts_layer(
    mut commands: Commands,
    layer_store: Res<LayerStore>,
    updated: Query<(Entity, &UpdatePntsLayerMarker)>,
    mut features: Query<&mut RenderableFeature>,
) {
    for (e, u) in &updated {
        let layer_id = u.layer_id.clone();
        if let Some(ids) = layer_store.get(&layer_id) {
            for id in ids {
                let mut f = match features.get_mut(*id) {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                if let RenderableFeature::Model { material, .. } = f.as_mut() {
                    *material = u.material.clone();
                }
            }
        }
        commands.entity(e).despawn();
    }
}

#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub fn delete_model_by_pnts_layer(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    mut layer_store: ResMut<LayerStore>,
    deleted: Query<(Entity, &DeletePntsLayerMarker)>,
    pnts_layers: Query<(Entity, &PntsLayer)>,
    features: Query<
        &ModelBin,
        (
            With<LayerId>,
            With<ModelGeometry>,
            With<ModelMaterial>,
            With<Transform>,
        ),
    >,
) {
    for (e, d) in &deleted {
        let entities = match layer_store.get(&d.0.clone()) {
            Some(e) => e,
            None => continue,
        };

        for e in entities {
            if let Ok(f) = features.get(*e) {
                buf.remove(&f.0);
            };
            commands.entity(*e).despawn();
        }

        // Despawn only the PNTS layer entity being deleted, not every PNTS
        // layer: `d.0` is the target layer id, so match on it.
        for (le, layer) in &pnts_layers {
            if layer.layer_id == d.0 {
                commands.entity(le).despawn();
            }
        }
        layer_store.remove(&d.0);
        commands.entity(e).despawn();
    }
}
