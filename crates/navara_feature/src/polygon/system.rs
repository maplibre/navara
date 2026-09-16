use bevy_ecs::{
    change_detection::DetectChanges,
    entity::Entity,
    query::{Added, With, Without},
    system::{Commands, Query, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::{Deleted, OrderByDistance};
use navara_core::{Aabb, BoundingSphere, CRS, WGS84_64};
use navara_feature_component::{
    batch::{BatchTable, FeatureBatchId, FeatureBatchIdMap, GlobalBatchIds},
    polygon::{PolygonMarker, UpdatePolygon},
};
use navara_layer::{LayerId, LayerStore};
use navara_material::{PolygonInternalMaterial, PolygonMaterial};
use navara_math::{Transform, Vec3};
use navara_tile_component::{OverscaledTileHandle, TileExtent};

use navara_feature_component::{
    batch::BatchedFeature,
    id::FeatureId,
    render::{PolygonRenderInformation, RenderableFeature},
};
use navara_worker::{
    WorkerTaskResultConsumed,
    construct_polygon_batched_feature::{
        ConstructPolygonBatchedFeatureMarker, ConstructPolygonBatchedFeatureParameters,
        ConstructPolygonBatchedFeatureResult, ConstructPolygonBatchedFeatureWorkerTaskBundle,
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
            &PolygonMaterial,
            &mut BatchedFeature,
            &FeatureBatchId,
            &GlobalBatchIds,
            Option<&mut FeatureId>,
            Option<&OverscaledTileHandle>,
            Option<&TileExtent>,
            Option<&OrderByDistance>,
        ),
        (With<PolygonMarker>, Without<Deleted>),
    >,
    mut layer_store: ResMut<LayerStore>,
    construct_polygon_feature_tasks: Query<
        (Entity, &ConstructPolygonBatchedFeatureResult),
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
            || batched_feature
                .construct_polygon_feature
                .is_some_and(|c: Entity| {
                    construct_polygon_feature_tasks.contains(c)
                        && feature_id.as_ref().is_none_or(|f| f.0.is_none())
                });
        if !needs_update {
            continue;
        }

        if batched_feature.construct_polygon_feature.is_none() {
            let order = order.cloned().unwrap_or(OrderByDistance {
                sse: 0.,
                distance: 0.,
            });
            let task_entity = commands
                .spawn((
                    ConstructPolygonBatchedFeatureWorkerTaskBundle::new(
                        ConstructPolygonBatchedFeatureMarker,
                        ConstructPolygonBatchedFeatureParameters {
                            batched_feature: batched_feature_entity,
                            // If it uses `clamp_to_ground` and it is tile, it should be flat.
                            flat: material.clamp_to_ground && tile_coordinates.is_some(),
                            tile_extent: tile_extent_component.map(|t| t.extent),
                        },
                    ),
                    order,
                ))
                .id();
            batched_feature.construct_polygon_feature = Some(task_entity);
            continue;
        }

        let (
            task_entity,
            ConstructPolygonBatchedFeatureResult {
                extent,
                geometry,
                outline_geometry,
                rtc_translation,
            },
        ) = construct_polygon_feature_tasks
            .get(batched_feature.construct_polygon_feature.unwrap())
            .unwrap();

        let mut material = material.clone();
        material.internal = Some(PolygonInternalMaterial {
            min_max_heights: vec![0., 0.],
        });

        let (distance_to_center_from_ellipsoid_surface, bounding_sphere) = match extent {
            Some(extent) => {
                let aabb = Aabb::from_extent_f64(*extent, 0., 0.);
                let distance = WGS84_64
                    .scale_to_geodetic_surface(aabb.center)
                    .map(|surface_point| -aabb.center.distance(surface_point));
                let sphere = get_bounding_sphere(&aabb);
                (distance, Some(sphere))
            }
            None => (None, None),
        };

        // Use RTC translation for coordinates if available
        // This positions the mesh at the tile center in world space
        let translation = rtc_translation.unwrap_or(Vec3::new(0., 0., 0.));

        let clamp_to_ground = material.clamp_to_ground;
        let mut entity_cmd = commands.spawn((
            PolygonMarker,
            layer_id.clone(),
            RenderableFeature::Polygon {
                // TODO: Calculate coordinate to update transform
                coordinates: Vec3::new(0., 0., 0.),
                crs: CRS::Geocentric,
                material,
                geometry: geometry.clone(),
                outline_geometry: outline_geometry.clone(),
                transform: Transform::from_translation(translation),
                feature_id: batched_feature_entity,
                render_info: PolygonRenderInformation {
                    should_recalculate_height: true,
                    distance_to_center_from_ellipsoid_surface,
                    is_rendered: false,
                    should_be_texturized: clamp_to_ground && tile_coordinates.is_some(),
                },
                extent: *extent,
                bounding_sphere,
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

pub fn update_polygon(
    mut commands: Commands,
    updated_polygons: Query<(Entity, &UpdatePolygon), Added<UpdatePolygon>>,
    mut features: Query<&mut RenderableFeature>,
) {
    for (e, updated) in &updated_polygons {
        let mut f = match features.get_mut(updated.feature_id) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let f = f.as_mut();

        if let RenderableFeature::Polygon {
            material,
            render_info,
            extent,
            bounding_sphere,
            ..
        } = f
        {
            let should_recalculate_height = material.clamp_to_ground
                != updated.material.clamp_to_ground
                || material.height != updated.material.height
                || material.extruded_height != updated.material.extruded_height;
            material.update(&updated.material);
            render_info.should_recalculate_height = should_recalculate_height;

            if should_recalculate_height && let Some(extent) = extent {
                let aabb = Aabb::from_extent_f64(*extent, 0., 0.);
                *bounding_sphere = Some(get_bounding_sphere(&aabb));
            }
        }
        commands.entity(e).remove::<UpdatePolygon>();
    }
}

#[allow(clippy::too_many_arguments)]
pub fn update_height_by_terrain(
    mut renderable_features: Query<(&PolygonMarker, &mut RenderableFeature)>,
) {
    for (_, mut feature) in &mut renderable_features {
        match feature.as_ref() {
            RenderableFeature::Polygon {
                render_info,
                material,
                active,
                ..
            } => {
                if render_info.should_be_texturized {
                    continue;
                }

                // Unlike polyline, the clamped height derives from
                // `distance_to_center_from_ellipsoid_surface`, which is fixed at
                // spawn — not from sampled terrain — so the flag alone gates all
                // inputs and clamp_to_ground needs no per-frame recompute.
                if !render_info.should_recalculate_height {
                    continue;
                }

                if !material.show || !active {
                    continue;
                }
            }
            _ => continue,
        };
        match feature.as_mut() {
            RenderableFeature::Polygon {
                material,
                extent,
                render_info,
                bounding_sphere,
                ..
            } => {
                render_info.should_recalculate_height = false;

                let Some(distance_to_center_from_ellipsoid_surface) =
                    render_info.distance_to_center_from_ellipsoid_surface
                else {
                    continue;
                };
                let Some(extent) = extent else {
                    continue;
                };

                let (min_height, max_height) = (
                    material.height as f64,
                    material.extruded_height.unwrap_or(0.) as f64,
                );

                let internal = material.internal.as_mut().unwrap();
                internal.min_max_heights = calc_min_max_height(
                    min_height,
                    max_height,
                    material.clamp_to_ground,
                    distance_to_center_from_ellipsoid_surface,
                );

                let aabb = Aabb::from_extent_f64(*extent, 0., 0.);
                *bounding_sphere = Some(get_bounding_sphere(&aabb));
            }
            _ => unreachable!(),
        };
    }
}

fn calc_min_max_height(
    height: f64,
    extruded_height: f64,
    clamp_to_ground: bool,
    distance_to_center_from_ellipsoid_surface: f64,
) -> Vec<f64> {
    let height = if clamp_to_ground {
        height.min(distance_to_center_from_ellipsoid_surface)
    } else {
        height
    };
    let extruded_height = if clamp_to_ground {
        extruded_height
    } else {
        height + extruded_height
    };

    vec![height, extruded_height]
}

fn get_bounding_sphere(aabb: &Aabb) -> BoundingSphere {
    // Use AABB center and extents directly without height adjustment
    let bs_center = aabb.center;
    let bs_radius = aabb.extents.length();

    BoundingSphere {
        center: bs_center,
        radius: bs_radius,
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
            Option<&navara_feature_component::batched_geometry::BatchedPolygonGeometry>,
        ),
        (With<PolygonMarker>, With<Deleted>),
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
        } else if let Some(task_entity) = batched_feature.construct_polygon_feature {
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

        // Clean up BatchedPolygonGeometry handles in BufferStore
        if let Some(geom) = batched_geom {
            geom.remove_from_buf(&mut buf);
        }

        // Always clean up BatchTable, GlobalBatchIds, and despawn the BatchedFeature entity
        batch_table_res.remove(&feature_batch_id.0);
        global_batch_ids.destroy(&mut buf, &mut batch_table_res);
        commands.entity(feature_id).despawn();
    }
}
