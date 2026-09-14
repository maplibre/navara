use bevy_ecs::{
    change_detection::DetectChanges,
    entity::Entity,
    query::{Added, With, Without},
    system::{Commands, Query, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, OrderByDistance};
use navara_core::CRS;
use navara_feature_component::{
    batch::{BatchTable, BatchedFeature, FeatureBatchId, FeatureBatchIdMap, GlobalBatchIds},
    id::FeatureId,
    render::{PolylineRenderInformation, RenderableFeature},
};
use navara_layer::{LayerId, LayerStore};
use navara_material::{PolylineInternalMaterial, PolylineMaterial};
use navara_math::{Transform, Vec3};

use navara_feature_component::polyline::PolylineMarker;
use navara_tile_component::{
    OverscaledTileHandle, TerrainTileQuadtree, TileExtent, TileMeshMarker,
    sample_terrain_height_within_extent,
};
use navara_worker::{
    WorkerTaskResultConsumed,
    construct_polyline_batched_feature::{
        ConstructPolylineBatchedFeatureMarker, ConstructPolylineBatchedFeatureParameters,
        ConstructPolylineBatchedFeatureResult, ConstructPolylineBatchedFeatureWorkerTaskBundle,
    },
};

#[allow(clippy::type_complexity)]
pub fn transfer_batched_mesh(
    mut commands: Commands,
    mut feature_batch_id_map: ResMut<FeatureBatchIdMap>,
    mut batched_features: Query<
        (
            Entity,
            &LayerId,
            &PolylineMaterial,
            &mut BatchedFeature,
            &FeatureBatchId,
            &GlobalBatchIds,
            Option<&mut FeatureId>,
            Option<&OverscaledTileHandle>,
            Option<&TileExtent>,
            Option<&OrderByDistance>,
        ),
        (With<PolylineMarker>, Without<Deleted>),
    >,
    mut layer_store: ResMut<LayerStore>,
    construct_polyline_feature_tasks: Query<
        (Entity, &ConstructPolylineBatchedFeatureResult),
        Without<Deleted>,
    >,
) {
    for (
        batched_feature_entity,
        layer_id,
        material,
        mut batched_feature,
        feature_batch_id,
        global_batch_ids,
        feature_id,
        tile_coordinates,
        tile_extent_component,
        order,
    ) in &mut batched_features
    {
        let needs_update = batched_feature.is_added()
            || batched_feature.construct_polyline_feature.is_some_and(|c| {
                construct_polyline_feature_tasks.contains(c)
                    && feature_id.as_ref().is_none_or(|f| f.0.is_none())
            });
        if !needs_update {
            continue;
        }

        if batched_feature.construct_polyline_feature.is_none() {
            let order = order.cloned().unwrap_or(OrderByDistance {
                sse: 0.,
                distance: 0.,
            });
            let task_entity = commands
                .spawn((
                    ConstructPolylineBatchedFeatureWorkerTaskBundle::new(
                        ConstructPolylineBatchedFeatureMarker,
                        ConstructPolylineBatchedFeatureParameters {
                            batched_feature: batched_feature_entity,
                            // If it uses `clamp_to_ground` and it is tile, it should be flat.
                            flat: material.clamp_to_ground && tile_coordinates.is_some(),
                            tile_extent: tile_extent_component.map(|t| t.extent),
                        },
                    ),
                    order,
                ))
                .id();
            batched_feature.construct_polyline_feature = Some(task_entity);
            continue;
        }

        let (task_entity, ConstructPolylineBatchedFeatureResult { extent, geometry }) =
            construct_polyline_feature_tasks
                .get(batched_feature.construct_polyline_feature.unwrap())
                .unwrap();

        let mut material = material.clone();
        material.internal = Some(PolylineInternalMaterial {
            min_max_heights: vec![0., 0.],
        });

        let clamp_to_ground = material.clamp_to_ground;
        let mut entity_cmd = commands.spawn((
            PolylineMarker,
            layer_id.clone(),
            RenderableFeature::Polyline {
                // TODO: Calculate coordinate to update transform
                coordinates: Vec3::new(0., 0., 0.),
                crs: CRS::Geocentric,
                material,
                geometry: geometry.clone(),
                extent: *extent,
                transform: Transform::default(),
                feature_id: batched_feature_entity,
                render_info: PolylineRenderInformation {
                    should_recalculate_height: true,
                    is_rendered: false,
                    should_be_texturized: clamp_to_ground && tile_coordinates.is_some(),
                },
                active: batched_feature.default_active,
                feature_batch_id: feature_batch_id.0,
                batch_length: global_batch_ids.batch_length,
            },
        ));

        if let Some(coords) = tile_coordinates {
            entity_cmd.insert(coords.clone());
        }

        let entity = entity_cmd.id();

        if let Some(mut feature_id) = feature_id {
            feature_id.0 = Some(entity);
        }

        layer_store.add(layer_id.0.clone(), entity);

        feature_batch_id_map.add(entity, global_batch_ids.clone());

        // The result's geometry handles now live in the spawned feature, so
        // mark the task consumed or its `on_remove` hook would free live
        // buffers when the worker plugin despawns it.
        commands
            .entity(task_entity)
            .insert((Deleted, WorkerTaskResultConsumed));
    }
}

// TODO: This system is executed whenever a tile is added.
//       This isn't efficient, so we need to update this system
//       to execute only when the layer's bounding box is within the camera frustum.
#[allow(clippy::too_many_arguments)]
pub fn update_height_by_terrain(
    mut qt: ResMut<TerrainTileQuadtree>,
    mut renderable_features: Query<(&PolylineMarker, &mut RenderableFeature)>,
    tile_meshes: Query<&TileMeshMarker, Added<TileMeshMarker>>,
) {
    let is_tile_meshes_empty = tile_meshes.is_empty();

    for (_, mut feature) in &mut renderable_features {
        match feature.as_ref() {
            RenderableFeature::Polyline {
                render_info,
                material,
                active,
                ..
            } => {
                if render_info.should_be_texturized {
                    continue;
                }

                if is_tile_meshes_empty && material.clamp_to_ground {
                    continue;
                }

                if !material.clamp_to_ground && !render_info.should_recalculate_height {
                    continue;
                }

                if !material.show || !active {
                    continue;
                }
            }
            _ => continue,
        };
        match feature.as_mut() {
            RenderableFeature::Polyline {
                material,
                extent,
                render_info,
                ..
            } => {
                render_info.should_recalculate_height = false;

                let (min_height, max_height) =
                    if material.clamp_to_ground && !render_info.should_be_texturized {
                        let (min, max) = sample_terrain_height_within_extent(&mut qt, *extent);
                        (min, max)
                    } else {
                        (0., 0.)
                    };

                let internal = material.internal.as_mut().unwrap();
                internal.min_max_heights = vec![min_height, max_height];
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
            &BatchedFeature,
            &FeatureBatchId,
            &GlobalBatchIds,
            Option<&navara_feature_component::batched_geometry::BatchedPolylineGeometry>,
        ),
        (With<PolylineMarker>, With<Deleted>),
    >,
    mut buf: ResMut<BufferStore>,
    mut batch_table_res: ResMut<BatchTable>,
    mut feature_batch_id_map: ResMut<FeatureBatchIdMap>,
) {
    for (
        feature_id,
        rendered_feature_id,
        batched_feature,
        feature_batch_id,
        global_batch_ids,
        batched_geom,
    ) in &removed_features
    {
        // Clean up RenderableFeature if it exists (tessellation completed and transferred)
        if let Some(rendered_feature_id) = rendered_feature_id.0 {
            if let Ok(mut feature) = removed_renderable_features.get_mut(rendered_feature_id) {
                feature.destroy(&mut buf, &mut batch_table_res);
            }
            feature_batch_id_map.remove(&rendered_feature_id, &mut buf, &mut batch_table_res);
            // Mark RenderableFeature as Deleted so event::despawn will clean it up
            commands.entity(rendered_feature_id).insert(Deleted);
        } else if let Some(task_entity) = batched_feature.construct_polyline_feature {
            // The tessellation was never transferred: cancel the task. An
            // unconsumed result frees its buffers via the component's
            // `on_remove` hook when the worker plugin despawns the entity
            // (freeing it here instead would race that despawn), and a result
            // arriving after this lands is freed by the worker plugin's
            // `handle_completed_event`.
            let _ = commands
                .get_entity(task_entity)
                .as_mut()
                .map(|e| e.insert(Deleted));
        }

        // Clean up BatchedPolylineGeometry handles in BufferStore
        if let Some(geom) = batched_geom {
            geom.remove_from_buf(&mut buf);
        }

        // Always clean up BatchTable, GlobalBatchIds, and despawn the BatchedFeature entity
        batch_table_res.remove(&feature_batch_id.0);
        global_batch_ids.destroy(&mut buf, &mut batch_table_res);
        commands.entity(feature_id).despawn();
    }
}
