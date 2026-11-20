//! [`MvtPmtilesDecoder`]: the MVT payload decoder injected into a
//! `navara_pmtiles::PmtilesSource`. It reuses the exact MVT decode path used for
//! `{z}/{x}/{y}` tiles, so a PMTiles archive carrying MVT renders identically to
//! a templated MVT source.

use std::any::Any;

use bevy_ecs::{entity::Entity, system::Commands};
use navara_buffer_store::{BufferStore, Handle};
use navara_component::OrderByDistance;
use navara_feature_component::batch::BatchTable;
use navara_parser::pmtiles::Compression;
use navara_pmtiles::TilePayloadDecoder;
use navara_tile_component::{TileHandle, VectorTile};

#[cfg(not(feature = "delegated_worker"))]
use crate::geometry::{MatchedLayerInfo, construct_geometry_multi_layer};
use crate::source::OwnedMatchedLayerInfo;

/// Decodes MVT tile payloads pulled from a PMTiles archive into geometry.
pub struct MvtPmtilesDecoder {
    /// Per-layer styling/filtering, identical to what `MvtSource` holds.
    pub layers: Vec<OwnedMatchedLayerInfo>,
}

impl TilePayloadDecoder for MvtPmtilesDecoder {
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }

    #[allow(clippy::too_many_arguments)]
    fn decode(
        &self,
        commands: &mut Commands,
        batch_table: &mut BatchTable,
        buf: &mut BufferStore,
        pbf_handle: Handle,
        compression: Compression,
        tile: &VectorTile,
        tile_handle: TileHandle,
        rendered_tile: Entity,
        order: &OrderByDistance,
    ) -> Option<Vec<Entity>> {
        #[cfg(feature = "delegated_worker")]
        {
            // Offload decompression + parsing to the shared worker task; the raw
            // bytes stay in the BufferStore until finalize frees them.
            let _ = &batch_table;
            crate::geometry::spawn_parse_mvt_task(
                commands,
                buf,
                rendered_tile,
                tile_handle,
                tile.coords,
                tile.extent,
                order,
                &self.layers,
                pbf_handle,
                navara_parser::pmtiles::compression_to_code(compression),
            )
        }

        #[cfg(not(feature = "delegated_worker"))]
        {
            let _ = rendered_tile;
            let raw = buf.remove_u8(&pbf_handle)?;
            let payload = match compression {
                Compression::None => raw,
                _ => navara_parser::pmtiles::decompress(compression, &raw).ok()?,
            };

            let matched_layers: Vec<MatchedLayerInfo> = self
                .layers
                .iter()
                .map(OwnedMatchedLayerInfo::as_ref)
                .collect();

            construct_geometry_multi_layer(
                commands,
                batch_table,
                buf,
                payload,
                tile.coords,
                &matched_layers,
                Some((tile_handle, tile.extent)),
                order,
            )
        }
    }

    fn max_feature_height(&self) -> f64 {
        navara_vector_tile::max_feature_height(
            self.layers.iter().flat_map(|l| l.appearances.iter()),
        )
    }
}
