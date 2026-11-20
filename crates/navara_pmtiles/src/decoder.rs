use std::any::Any;

use bevy_ecs::{entity::Entity, system::Commands};
use navara_buffer_store::{BufferStore, Handle};
use navara_component::OrderByDistance;
use navara_feature_component::batch::BatchTable;
use navara_parser::pmtiles::Compression;
use navara_tile_component::{TileHandle, VectorTile};

/// Turns a resolved, already-decompressed PMTiles tile payload into ECS geometry
/// entities.
///
/// PMTiles is a *container*: the bytes a tile points at may be MVT, raster, etc.
/// [`PmtilesSource`](crate::PmtilesSource) owns the container concerns — fetching
/// byte ranges, resolving directories, and decompressing the payload — then hands
/// the plain payload bytes to a decoder. The decoder is format-specific and lives
/// in whichever crate owns that format (the MVT decoder lives in `navara_mvt`),
/// which is exactly what keeps `navara_pmtiles` free of any payload-format
/// dependency and lets the dependency point `navara_mvt → navara_pmtiles`.
///
/// `decode` mirrors
/// [`VectorTileSource::construct_geometry`](navara_vector_tile::VectorTileSource::construct_geometry)
/// minus the data-requester/decompression steps the source has already handled.
pub trait TilePayloadDecoder: Send + Sync + 'static {
    /// Downcast hook so the owning format crate can reach decoder-specific state
    /// (e.g. per-layer styling) through the boxed trait object. Mirrors
    /// [`VectorTileSource::as_any_mut`](navara_vector_tile::VectorTileSource::as_any_mut).
    fn as_any_mut(&mut self) -> &mut dyn Any;

    /// Decode the tile whose (possibly compressed) bytes are stored in `buf`
    /// under `pbf_handle`, with the container's `compression`. The decoder owns
    /// decompression so it can either decompress + parse inline or hand the raw
    /// bytes + compression to a worker. `rendered_tile` identifies the target
    /// tile entity for asynchronous completion. Returns `None` if the tile
    /// yields no synchronous geometry.
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
    ) -> Option<Vec<Entity>>;

    /// Mirrors [`VectorTileSource::max_feature_height`](navara_vector_tile::VectorTileSource::max_feature_height).
    fn max_feature_height(&self) -> f64 {
        0.
    }
}
