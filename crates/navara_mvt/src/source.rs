use std::any::Any;
use std::sync::Arc;

use bevy_ecs::{entity::Entity, system::Commands};
use navara_buffer_store::BufferStore;
use navara_component::{OrderByDistance, Priority};
use navara_data_requester::{DataRequester, DataRequesterStatus};
use navara_feature_component::batch::BatchTable;
use navara_material::Appearance;
use navara_tile_component::{TileHandle, VectorTile};
use navara_vector_tile::{
    ReadyState, TileCacheManager, VectorTileSource, data_requester::VectorTileDataRequesterQuery,
    max_feature_height,
};

use crate::data_requester::request_mvt_data;
use crate::geometry::MatchedLayerInfo;
#[cfg(not(feature = "delegated_worker"))]
use crate::geometry::construct_geometry_multi_layer;

/// Owned version of layer info for storage in MvtSource.
pub struct OwnedMatchedLayerInfo {
    pub layer_id: String,
    /// `Arc`-shared so every in-flight parse task snapshots the appearances by
    /// reference instead of cloning them per tile; appearance updates
    /// copy-on-write via `Arc::make_mut`, leaving in-flight snapshots intact.
    pub appearances: Arc<Vec<Appearance>>,
    pub limit_layers: Option<Vec<String>>,
}

impl OwnedMatchedLayerInfo {
    pub fn as_ref(&self) -> MatchedLayerInfo<'_> {
        MatchedLayerInfo {
            layer_id: &self.layer_id,
            appearances: self.appearances.as_slice(),
            limit_layers: &self.limit_layers,
        }
    }
}

/// MVT tile source implementing the VectorTileSource trait.
pub struct MvtSource {
    pub url: String,
    pub layers: Vec<OwnedMatchedLayerInfo>,
}

impl VectorTileSource for MvtSource {
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn prepare_tile(
        &mut self,
        commands: &mut Commands,
        tile: &mut VectorTile,
        handle: TileHandle,
        tc: &mut TileCacheManager,
        buf: &mut BufferStore,
        data_requesters: &VectorTileDataRequesterQuery,
        priority: Priority,
    ) -> bool {
        let requested = request_mvt_data(
            commands,
            tile,
            buf,
            &self.url,
            handle,
            data_requesters,
            priority,
        );
        if let Some(e) = requested {
            tc.requested_tile_caches.insert(handle, e);
        }
        requested.is_some()
    }

    fn construct_geometry(
        &mut self,
        commands: &mut Commands,
        batch_table: &mut BatchTable,
        buf: &mut BufferStore,
        tile: &VectorTile,
        _tile_handle: TileHandle,
        rendered_tile: Entity,
        order: &OrderByDistance,
        data_requester: Option<&DataRequester>,
    ) -> Option<Vec<Entity>> {
        let data_req = data_requester?;

        #[cfg(feature = "delegated_worker")]
        {
            // Offload parsing to the shared parse-mvt worker task. Plain MVT is
            // uncompressed (compression code 0). The pbf bytes stay in the
            // BufferStore until finalize frees them; features are linked to the
            // tile on completion (see `geometry::finalize_parsed_mvt`).
            let _ = &batch_table;
            crate::geometry::spawn_parse_mvt_task(
                commands,
                buf,
                rendered_tile,
                _tile_handle,
                tile.coords,
                tile.extent,
                order,
                &self.layers,
                data_req.handle,
                0,
            )
        }

        #[cfg(not(feature = "delegated_worker"))]
        {
            let _ = rendered_tile;
            let mvt_bin = buf.remove_u8(&data_req.handle)?;

            let matched_layers: Vec<MatchedLayerInfo> =
                self.layers.iter().map(|l| l.as_ref()).collect();

            construct_geometry_multi_layer(
                commands,
                batch_table,
                buf,
                mvt_bin,
                tile.coords,
                &matched_layers,
                Some((_tile_handle, tile.extent)),
                order,
            )
        }
    }

    fn ready_state(
        &self,
        tile: &VectorTile,
        data_requesters: &VectorTileDataRequesterQuery,
    ) -> ReadyState {
        let data_requester = tile
            .data_requester_entity_id
            .and_then(|e| data_requesters.get(e).ok());
        match data_requester {
            Some((_, dr)) if tile.is_ready(&dr.status) => ReadyState::Success,
            Some((_, dr)) if matches!(dr.status, DataRequesterStatus::Fail) => ReadyState::Failed,
            _ => ReadyState::Pending,
        }
    }

    fn max_feature_height(&self) -> f64 {
        max_feature_height(self.layers.iter().flat_map(|l| l.appearances.iter()))
    }
}
