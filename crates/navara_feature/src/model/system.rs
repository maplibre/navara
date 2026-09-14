use bevy_ecs::{
    entity::Entity,
    query::{Added, With},
    system::{Commands, Query, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::Deleted;
use navara_core::{Aabb, WGS84_64};
use navara_feature_component::{
    DeletedFeatureMarker,
    batch::{BatchTable, FeatureBatchId, FeatureBatchIdMap, GlobalBatchIds},
    id::FeatureId,
    render::{ModelRenderInformation, RenderableFeature, TransferableModelGeometry},
};
use navara_layer::{LayerId, LayerStore};
use navara_material::ModelMaterial;
use navara_math::{Quat, Transform, Vec3};

use navara_feature_component::model::{ModelBin, ModelGeometry, ModelMarker};

use navara_geometry::TransferableFloatAttribute;

#[allow(clippy::type_complexity)]
pub fn transfer_mesh(
    mut commands: Commands,
    mut feature_batch_id_map: ResMut<FeatureBatchIdMap>,
    mut models: Query<
        (
            Entity,
            &LayerId,
            &FeatureBatchId,
            &GlobalBatchIds,
            Option<&mut FeatureId>,
            &ModelGeometry,
            &mut ModelMaterial,
            // For GLB
            Option<&ModelBin>,
            Option<&Transform>,
            Option<&Aabb>,
            // For glTF
            // Option<&ModelJson>,
            Option<&DeletedFeatureMarker>,
        ),
        Added<ModelGeometry>,
    >,
    mut layer_store: ResMut<LayerStore>,
) {
    for (
        entity,
        layer_id,
        feature_batch_id,
        global_batch_ids,
        mut feature_id,
        geometry,
        mut material,
        bin,
        adjustment_transform,
        aabb,
        deleted_marker,
    ) in &mut models
    {
        if deleted_marker.is_some() {
            continue;
        }

        let position: Vec3 = if material
            .internal
            .as_ref()
            .is_some_and(|internal| internal.point_cloud)
        {
            geometry.coords
        } else {
            geometry
                .crs
                .to_vec3(WGS84_64, geometry.coords, material.height)
        };

        let transform = if material.should_rotate_in_default {
            let lnglat = geometry.crs.to_lng_lat(WGS84_64, geometry.coords);
            let lng = lnglat.lng.val();
            let lat = lnglat.lat.val();
            let rotation_y = Quat::from_rotation_y(-lat);
            let rotation_z = Quat::from_rotation_z(lng);
            let adjust_model = Quat::from_rotation_z(-std::f64::consts::PI / 2.0);
            let rotation = rotation_z * rotation_y * adjust_model;
            Transform::from_translation(position)
                .with_rotation(rotation)
                .with_scale(Vec3::new(
                    material.size as f64,
                    material.size as f64,
                    material.size as f64,
                ))
        } else {
            Transform::from_translation(position).with_scale(Vec3::new(
                material.size as f64,
                material.size as f64,
                material.size as f64,
            ))
        };
        let transform = match adjustment_transform {
            Some(a) => {
                if material
                    .internal
                    .as_ref()
                    .is_some_and(|internal| internal.point_cloud)
                {
                    a.mul_transform(transform)
                } else {
                    transform.mul_transform(*a)
                }
            }
            None => transform,
        };

        let model_transform_inv = transform.compute_matrix().inverse();
        let aabb = match aabb {
            Some(aabb) => Aabb {
                center: model_transform_inv.transform_point3(aabb.center),
                extents: aabb.extents,
            },
            None => Aabb::default(),
        };
        if let Some(material_internal) = material.internal.as_mut() {
            let geodetic_normal = WGS84_64
                .geodetic_surface_normal_from_vec3(transform.transform_point(Vec3::ZERO).into())
                .into();

            material_internal.point_cloud_geodetic_normal = Vec3::normalize(geodetic_normal);
        }

        let entity = commands.spawn((
            ModelMarker,
            layer_id.clone(),
            RenderableFeature::Model {
                coordinates: geometry.coords,
                crs: geometry.crs.clone(),
                material: material.clone(),
                transform,
                feature_id: entity,
                render_info: ModelRenderInformation { is_rendered: false },
                bin: bin.cloned(),
                geometry: TransferableModelGeometry {
                    batch_ids: Some(TransferableFloatAttribute {
                        data: global_batch_ids.handle,
                        size: 1,
                    }),
                },
                aabb,
                feature_batch_id: feature_batch_id.0,
                active: true,
                batch_length: global_batch_ids.batch_length,
            },
        ));

        if let Some(f) = feature_id.as_mut() {
            f.0 = Some(entity.id());
        }

        layer_store.add(layer_id.0.clone(), entity.id());

        feature_batch_id_map.add(entity.id(), global_batch_ids.clone());
    }
}

#[allow(clippy::type_complexity)]
pub fn remove_batched_feature(
    mut commands: Commands,
    mut removed_renderable_features: Query<&mut RenderableFeature>,
    removed_features: Query<
        (
            Entity,
            &FeatureId,
            &ModelBin,
            Option<&FeatureBatchId>,
            Option<&GlobalBatchIds>,
        ),
        With<Deleted>,
    >,
    mut buf: ResMut<BufferStore>,
    mut batch_table_res: ResMut<BatchTable>,
    mut feature_batch_id_map: ResMut<FeatureBatchIdMap>,
) {
    for (feature_id, rendered_feature_id, model_bin, feature_batch_id, global_batch_ids) in
        &removed_features
    {
        if let Some(rendered_feature_id) = rendered_feature_id.0 {
            feature_batch_id_map.remove(&rendered_feature_id, &mut buf, &mut batch_table_res);
            if let Ok(mut feature) = removed_renderable_features.get_mut(rendered_feature_id) {
                feature.destroy(&mut buf, &mut batch_table_res);
            }
        }

        if let Some(global_batch_ids) = global_batch_ids {
            global_batch_ids.destroy(&mut buf, &mut batch_table_res);
        }
        if let Some(feature_batch_id) = feature_batch_id {
            batch_table_res.remove(&feature_batch_id.0);
        }

        buf.remove(&model_bin.0);
        commands.entity(feature_id).despawn();
    }
}
