mod task;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::entity::ReconstructableEntity;

#[wasm_bindgen]
#[derive(Debug, Clone, Serialize)]
pub struct WorkerTaskDelegatedEvent {
    pub ind: u32,
    pub r#gen: u32,
    pub bits: u64,
    /// Dispatch urgency: 0 is the most urgent (see `Priority::rank`). The
    /// platform keeps its pending stack sorted by this so a terrain mesh task
    /// overtakes older, less urgent work waiting for a worker.
    pub priority: u8,

    #[wasm_bindgen(getter_with_clone)]
    pub task: DelegatedWorkerTasksParameters,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Default, Serialize)]
pub struct DelegatedWorkerTasksParameters {
    #[wasm_bindgen(getter_with_clone)]
    pub delegator_id: ReconstructableEntity,
    #[wasm_bindgen(getter_with_clone)]
    pub construct_terrain_mesh:
        Option<task::construct_terrain_mesh::ConstructTerrainMeshParameters>,
    #[wasm_bindgen(getter_with_clone)]
    pub upsample_terrain_mesh: Option<task::upsample_terrain_mesh::UpsampleTerrainMeshParameters>,
    #[wasm_bindgen(getter_with_clone)]
    pub construct_polygon_batched_feature:
        Option<task::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureParameters>,
    #[wasm_bindgen(getter_with_clone)]
    pub construct_polyline_batched_feature:
        Option<task::construct_polyline_batched_feature::ConstructPolylineBatchedFeatureParameters>,
    #[wasm_bindgen(getter_with_clone)]
    pub parse_mvt_tile: Option<task::parse_mvt_tile::ParseMvtTileParameters>,
}

impl<'a>
    From<
        navara_event_store::ReconstructableComponentEvent<(
            &'a navara_worker::DelegatedWorkerTasksParameters,
            &'a navara_component::Priority,
        )>,
    > for WorkerTaskDelegatedEvent
{
    fn from(
        ev: navara_event_store::ReconstructableComponentEvent<(
            &'a navara_worker::DelegatedWorkerTasksParameters,
            &'a navara_component::Priority,
        )>,
    ) -> Self {
        let (task, priority) = ev.comp;
        Self {
            ind: ev.ind,
            r#gen: ev.r#gen,
            bits: ev.bits,
            priority: priority.rank(),
            task: task.into(),
        }
    }
}

impl<'a> From<&'a navara_worker::DelegatedWorkerTasksParameters>
    for DelegatedWorkerTasksParameters
{
    fn from(v: &'a navara_worker::DelegatedWorkerTasksParameters) -> Self {
        match v {
            navara_worker::DelegatedWorkerTasksParameters::ConstructTerrainMesh(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                construct_terrain_mesh: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksParameters::UpsampleTerrainMesh(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                upsample_terrain_mesh: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksParameters::ConstructPolygonBatchedFeature(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                construct_polygon_batched_feature: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksParameters::ConstructPolylineBatchedFeature(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                construct_polyline_batched_feature: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksParameters::ParseMvtTile(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                parse_mvt_tile: Some(value.into()),
                ..Default::default()
            },
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Default, Serialize)]
pub struct DelegatedWorkerTasksResult {
    #[wasm_bindgen(getter_with_clone)]
    pub delegator_id: ReconstructableEntity,
    #[wasm_bindgen(getter_with_clone)]
    pub construct_terrain_mesh: Option<task::construct_terrain_mesh::ConstructTerrainMeshResult>,
    #[wasm_bindgen(getter_with_clone)]
    pub upsample_terrain_mesh: Option<task::upsample_terrain_mesh::UpsampleTerrainMeshResult>,
    #[wasm_bindgen(getter_with_clone)]
    pub construct_polygon_batched_feature:
        Option<task::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureResult>,
    #[wasm_bindgen(getter_with_clone)]
    pub construct_polyline_batched_feature:
        Option<task::construct_polyline_batched_feature::ConstructPolylineBatchedFeatureResult>,
    // Holds plain geometry Vecs (not Serialize); it only ever flows JS -> Rust.
    #[serde(skip)]
    #[wasm_bindgen(getter_with_clone)]
    pub parse_mvt_tile: Option<task::parse_mvt_tile::ParseMvtTileResult>,
}

#[wasm_bindgen]
impl DelegatedWorkerTasksResult {
    #[wasm_bindgen(js_name = "withConstructTerrainMesh")]
    pub fn with_construct_terrain_mesh(
        delegator_id: ReconstructableEntity,
        construct_terrain_mesh: Option<task::construct_terrain_mesh::ConstructTerrainMeshResult>,
    ) -> Self {
        Self {
            delegator_id,
            construct_terrain_mesh,
            upsample_terrain_mesh: None,
            construct_polygon_batched_feature: None,
            construct_polyline_batched_feature: None,
            parse_mvt_tile: None,
        }
    }

    #[wasm_bindgen(js_name = "withUpsampleTerrainMesh")]
    pub fn with_upsample_terrain_mesh(
        delegator_id: ReconstructableEntity,
        upsample_terrain_mesh: Option<task::upsample_terrain_mesh::UpsampleTerrainMeshResult>,
    ) -> Self {
        Self {
            delegator_id,
            construct_terrain_mesh: None,
            upsample_terrain_mesh,
            construct_polygon_batched_feature: None,
            construct_polyline_batched_feature: None,
            parse_mvt_tile: None,
        }
    }

    #[wasm_bindgen(js_name = "withConstructPolygonBatchedFeature")]
    pub fn with_construct_polygon_batched_feature(
        delegator_id: ReconstructableEntity,
        construct_polygon_batched_feature: Option<
            task::construct_polygon_batched_feature::ConstructPolygonBatchedFeatureResult,
        >,
    ) -> Self {
        Self {
            delegator_id,
            construct_terrain_mesh: None,
            upsample_terrain_mesh: None,
            construct_polygon_batched_feature,
            construct_polyline_batched_feature: None,
            parse_mvt_tile: None,
        }
    }

    #[wasm_bindgen(js_name = "withConstructPolylineBatchedFeature")]
    pub fn with_construct_polyline_batched_feature(
        delegator_id: ReconstructableEntity,
        construct_polyline_batched_feature: Option<
            task::construct_polyline_batched_feature::ConstructPolylineBatchedFeatureResult,
        >,
    ) -> Self {
        Self {
            delegator_id,
            construct_terrain_mesh: None,
            upsample_terrain_mesh: None,
            construct_polygon_batched_feature: None,
            construct_polyline_batched_feature,
            parse_mvt_tile: None,
        }
    }

    #[wasm_bindgen(js_name = "withParseMvtTile")]
    pub fn with_parse_mvt_tile(
        delegator_id: ReconstructableEntity,
        parse_mvt_tile: Option<task::parse_mvt_tile::ParseMvtTileResult>,
    ) -> Self {
        Self {
            delegator_id,
            construct_terrain_mesh: None,
            upsample_terrain_mesh: None,
            construct_polygon_batched_feature: None,
            construct_polyline_batched_feature: None,
            parse_mvt_tile,
        }
    }
}

impl<'a> From<&'a navara_worker::DelegatedWorkerTasksResult> for DelegatedWorkerTasksResult {
    fn from(v: &'a navara_worker::DelegatedWorkerTasksResult) -> Self {
        match v {
            navara_worker::DelegatedWorkerTasksResult::ConstructTerrainMesh(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                construct_terrain_mesh: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksResult::UpsampleTerrainMesh(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                upsample_terrain_mesh: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksResult::ConstructPolygonBatchedFeature(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                construct_polygon_batched_feature: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksResult::ConstructPolylineBatchedFeature(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                construct_polyline_batched_feature: Some(value.into()),
                ..Default::default()
            },
            navara_worker::DelegatedWorkerTasksResult::ParseMvtTile(
                navara_worker::DelegatedWorkerTask {
                    delegator_id,
                    value,
                },
            ) => Self {
                delegator_id: ReconstructableEntity(delegator_id.to_bits()),
                parse_mvt_tile: Some(value.into()),
                ..Default::default()
            },
        }
    }
}
