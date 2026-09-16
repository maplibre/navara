use bevy_ecs::{
    entity::Entity,
    query::{Added, With, Without},
    system::{Commands, Query, Res, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::Deleted;
use navara_feature_component::{
    BatchedFeatureMarker,
    batch::{BatchTable, BatchedFeature, FeatureBatchId, FeatureBatchIdMap, GlobalBatchIds},
    batched_geometry::BatchedPointGeometry,
    id::FeatureId,
    render::{PointRenderInformation, RenderableFeature, TransferablePointGeometry},
};
use navara_layer::{LayerId, LayerStore};
use navara_material::PointMaterial;
use navara_math::{Transform, Vec3};
use navara_window::Window;

use navara_camera::{CameraFrustum, CameraMarker};
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;
use navara_tile_component::{
    TerrainTileQuadtree, TileExtent, TileMeshMarker, TileTerrainDataRequesterQuery,
};

use navara_feature_component::point::PointMarker;

use crate::geometry::point::{
    PositionBuffer, collect_changed_tile_extents, resolve_absolute_heights_and_build_positions,
    resolve_tiled_heights_and_build_positions, should_update_for_changed_terrain,
};

#[allow(clippy::type_complexity)]
pub fn transfer_batched_mesh(
    mut commands: Commands,
    mut feature_batch_id_map: ResMut<FeatureBatchIdMap>,
    mut batched_features: Query<
        (
            Entity,
            &LayerId,
            &PointMaterial,
            &BatchedFeature,
            &BatchedPointGeometry,
            &FeatureBatchId,
            &GlobalBatchIds,
            &mut FeatureId,
        ),
        (With<PointMarker>, Added<BatchedFeature>, Without<Deleted>),
    >,
    mut layer_store: ResMut<LayerStore>,
    mut buf: ResMut<BufferStore>,
) {
    for (
        batched_feature_entity,
        layer_id,
        material,
        batched_feature,
        batched_point_geom,
        feature_batch_id,
        global_batch_ids,
        mut feature_id,
    ) in &mut batched_features
    {
        let feature_len = batched_point_geom.coords.len();
        let transform = batched_point_geom.transform;

        let geometry = TransferablePointGeometry::from(batched_point_geom);

        let crs = batched_point_geom.crs.clone();

        let terrain_heights = buf.new_f64(vec![0.0; feature_len]);

        // Create the renderable feature entity
        let entity = commands
            .spawn((
                PointMarker,
                BatchedFeatureMarker,
                layer_id.clone(),
                RenderableFeature::Point {
                    coordinates: Vec3::ZERO,
                    crs,
                    material: material.clone(),
                    transform,
                    feature_id: batched_feature_entity,
                    render_info: PointRenderInformation {
                        terrain_heights,
                        is_rendered: false,
                        should_recalculate_height: true,
                    },
                    geometry,
                    active: batched_feature.default_active,
                    feature_batch_id: feature_batch_id.0,
                    batch_length: feature_len as u32,
                },
            ))
            .id();

        feature_id.0 = Some(entity);

        layer_store.add(layer_id.0.clone(), entity);

        feature_batch_id_map.add(entity, global_batch_ids.clone());
    }
}

/// Update terrain heights for batched point features.
/// Uses TileExtent-based batch lookup for tiled (MVT) features,
/// and per-point traversal for GeoJSON features.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn update_height_by_terrain_for_batched(
    mut qt: ResMut<TerrainTileQuadtree>,
    mut buf: ResMut<BufferStore>,
    mut renderable_features: Query<
        (&PointMarker, &mut RenderableFeature),
        With<BatchedFeatureMarker>,
    >,
    batched_features: Query<
        (&BatchedPointGeometry, Option<&TileExtent>),
        (With<PointMarker>, Without<Deleted>),
    >,
    tile_meshes: Query<&TileMeshMarker, Added<TileMeshMarker>>,
    terrain_data_requester: TileTerrainDataRequesterQuery,
    camera_query: Query<(&CameraFrustum, &Transform), With<CameraMarker>>,
    occluder_query: Query<&EllipsoidalOccluder>,
    window: Res<Window>,
) {
    let changed_extents = collect_changed_tile_extents(&qt, tile_meshes.iter());
    let camera = camera_query.iter().next();
    let frustum = camera.map(|(f, _)| f);
    let camera_position = camera
        .map(|(_, t)| t.transform_point(Vec3::ZERO))
        .unwrap_or(Vec3::ZERO);
    let occluder = occluder_query.iter().next();
    let screen_height = window.height;

    for (_, mut feature) in &mut renderable_features {
        let (show, clamp_to_ground, is_rendered, active, feature_id, should_recalculate) =
            match feature.as_ref() {
                RenderableFeature::Point {
                    material,
                    active,
                    feature_id,
                    render_info,
                    ..
                } => (
                    material.show,
                    material.clamp_to_ground,
                    render_info.is_rendered,
                    *active,
                    *feature_id,
                    render_info.should_recalculate_height,
                ),
                _ => continue,
            };

        if !is_rendered || !show || !active {
            continue;
        }
        let Ok((batched_point_geom, tile_extent)) = batched_features.get(feature_id) else {
            continue;
        };
        if !should_recalculate
            && !should_update_for_changed_terrain(
                clamp_to_ground,
                &changed_extents,
                batched_point_geom,
                tile_extent,
            )
        {
            continue;
        }

        match feature.as_mut() {
            RenderableFeature::Point {
                material,
                render_info,
                geometry,
                transform,
                ..
            } => {
                render_info.should_recalculate_height = false;

                let feature_len = batched_point_geom.coords.len();
                let rtc_center = if geometry.position_3d_high.is_some() {
                    None
                } else {
                    Some(transform.translation)
                };
                let mut positions = PositionBuffer::new(rtc_center, feature_len);
                let mut heights = buf.remove_f64(&render_info.terrain_heights).unwrap();

                if let Some(te) = tile_extent {
                    resolve_tiled_heights_and_build_positions(
                        &te.extent,
                        &batched_point_geom.coords,
                        &batched_point_geom.crs,
                        material.clamp_to_ground,
                        &mut heights,
                        &mut qt,
                        &mut buf,
                        &terrain_data_requester,
                        &mut positions,
                    );
                } else {
                    resolve_absolute_heights_and_build_positions(
                        &batched_point_geom.coords,
                        &batched_point_geom.crs,
                        material.height,
                        material.clamp_to_ground,
                        material.size,
                        material.size_in_meters,
                        frustum,
                        occluder,
                        camera_position,
                        screen_height,
                        &mut heights,
                        &mut qt,
                        &mut buf,
                        &terrain_data_requester,
                        &mut positions,
                    );
                }

                buf.set_f64(render_info.terrain_heights, heights);
                positions.apply_to(&mut buf, geometry);
            }
            _ => unreachable!(),
        };
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
            &FeatureBatchId,
            &GlobalBatchIds,
            Option<&BatchedPointGeometry>,
        ),
        (With<BatchedFeature>, With<PointMarker>, With<Deleted>),
    >,
    mut buf: ResMut<BufferStore>,
    mut batch_table_res: ResMut<BatchTable>,
    mut feature_batch_id_map: ResMut<FeatureBatchIdMap>,
) {
    for (feature_id, rendered_feature_id, feature_batch_id, global_batch_ids, batched_geom) in
        &removed_features
    {
        // Clean up RenderableFeature if it exists
        if let Some(rendered_feature_id) = rendered_feature_id.0 {
            if let Ok(mut feature) = removed_renderable_features.get_mut(rendered_feature_id) {
                feature.destroy(&mut buf, &mut batch_table_res);
            }
            feature_batch_id_map.remove(&rendered_feature_id, &mut buf, &mut batch_table_res);
            // Mark RenderableFeature as Deleted so event::despawn will clean it up
            commands.entity(rendered_feature_id).insert(Deleted);
        }

        // Clean up BatchedPointGeometry handles in BufferStore
        if let Some(geom) = batched_geom {
            geom.remove_from_buf(&mut buf);
        }

        // Always clean up BatchTable, GlobalBatchIds, and despawn the BatchedFeature entity
        batch_table_res.remove(&feature_batch_id.0);
        global_batch_ids.destroy(&mut buf, &mut batch_table_res);
        commands.entity(feature_id).despawn();
    }
}
