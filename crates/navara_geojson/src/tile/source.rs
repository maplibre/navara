use std::any::Any;

use bevy_ecs::{entity::Entity, system::Commands};
use navara_buffer_store::BufferStore;
use navara_component::{OrderByDistance, Priority};
use navara_data_requester::DataRequester;
use navara_feature_component::batch::BatchTable;
use navara_geojson_vt::{GeoJsonVt, PredictState, TileKey};
use navara_material::Appearance;
use navara_tile_component::{TileHandle, VectorTile};
use navara_vector_tile::{
    ReadyState, TileCacheManager, VectorTileSource, data_requester::VectorTileDataRequesterQuery,
    max_feature_height,
};
use rustc_hash::FxHashSet;

use super::geometry::construct_geojson_tile_geometry;

/// GeoJSON tile source implementing the VectorTileSource trait.
///
/// Wraps a `GeoJsonVt` spatial index and provides tile data
/// without network fetches (immediate in-memory lookups).
pub(crate) struct GeoJsonTileSource {
    pub vt: GeoJsonVt,
    pub extent: u32,
    pub layer_id: String,
    pub appearances: Vec<Appearance>,
    pub prepared: FxHashSet<TileKey>,
}

impl VectorTileSource for GeoJsonTileSource {
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    fn prepare_tile(
        &mut self,
        _commands: &mut Commands,
        tile: &mut VectorTile,
        _handle: TileHandle,
        tc: &mut TileCacheManager,
        _buf: &mut BufferStore,
        _data_requesters: &VectorTileDataRequesterQuery,
        _priority: Priority,
    ) -> bool {
        let key = self
            .vt
            .key(
                tile.coords.z as u32,
                tile.coords.x as u32,
                tile.coords.y as u32,
            )
            .expect("The tile key is overflowed");

        // Check if already prepared
        if self.prepared.contains(&key) {
            return false;
        }

        self.vt.get_tile(
            tile.coords.z as u32,
            tile.coords.x as u32,
            tile.coords.y as u32,
        );

        tc.needs_update = true;

        self.prepared.insert(key);

        true
    }

    fn construct_geometry(
        &mut self,
        commands: &mut Commands,
        batch_table: &mut BatchTable,
        buf: &mut BufferStore,
        tile: &VectorTile,
        tile_handle: TileHandle,
        _rendered_tile: Entity,
        order: &OrderByDistance,
        _data_requester: Option<&DataRequester>,
    ) -> Option<Vec<Entity>> {
        let tile_data = self.vt.get_tile(
            tile.coords.z as u32,
            tile.coords.x as u32,
            tile.coords.y as u32,
        )?;

        construct_geojson_tile_geometry(
            commands,
            batch_table,
            buf,
            tile_data,
            self.extent,
            &self.layer_id,
            &self.appearances,
            Some((tile_handle, tile.extent)),
            order,
        )
    }

    fn ready_state(
        &self,
        tile: &VectorTile,
        _data_requesters: &VectorTileDataRequesterQuery,
    ) -> ReadyState {
        let key = self
            .vt
            .key(
                tile.coords.z as u32,
                tile.coords.x as u32,
                tile.coords.y as u32,
            )
            .expect("The tile key is overflowed");

        if self.vt.has_tile(
            tile.coords.z as u32,
            tile.coords.x as u32,
            tile.coords.y as u32,
        ) {
            ReadyState::Success
        } else if self.prepared.contains(&key) {
            // prepare_tile was called but no tile was generated — area has no features.
            ReadyState::Failed
        } else {
            // Not yet prepared (or was evicted). Return Pending so the traversal
            // calls prepare_tile() instead of treating the tile as permanently failed.
            ReadyState::Pending
        }
    }

    fn should_upscale(&self, tile: &VectorTile) -> bool {
        !matches!(
            self.vt.predict(
                tile.coords.z as u32,
                tile.coords.x as u32,
                tile.coords.y as u32,
            ),
            PredictState::NotFound
        )
    }

    fn evict_tile(&mut self, handle: TileHandle) {
        self.vt.remove_tile(handle);
        self.prepared.remove(&handle);
    }

    fn max_feature_height(&self) -> f64 {
        max_feature_height(&self.appearances)
    }
}
