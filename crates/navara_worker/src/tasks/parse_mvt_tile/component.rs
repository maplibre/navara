use bevy_ecs::component::Component;
use navara_buffer_store::{BufferStore, Handle};
use navara_core::{Extent, Radians};
use navara_math::FloatType;
use navara_parser::mvt::{LayerParseConfig, ParsedMvtTileMeta};

use crate::component::{FreeResultBuffers, WorkerTaskBundle, free_unconsumed_buffers};

#[derive(Component)]
pub struct ParseMvtTileMarker;

/// Worker inputs for parsing an MVT tile. Carries only what the (off-thread)
/// parse core needs; the main-thread finalize context lives separately on the
/// delegator entity (see `navara_mvt`).
#[derive(Component, Clone, Debug)]
pub struct ParseMvtTileParameters {
    /// BufferStore handle to the raw pbf bytes.
    pub pbf_handle: Handle,
    pub x: usize,
    pub y: usize,
    pub z: usize,
    pub tile_extent: Option<Extent<FloatType, Radians>>,
    pub configs: Vec<LayerParseConfig>,
    /// Tile-payload compression code (0 = none/plain, see
    /// `navara_parser::pmtiles::compression_from_code`). The worker decompresses
    /// before parsing, so gzip (PMTiles) is handled off the main thread too.
    pub compression: u8,
}

/// The parsed tile returned by the worker, awaiting finalization.
///
/// The bulk geometry lives in the `BufferStore` as four packed per-type
/// streams (see `navara_parser::mvt::pack_parsed_mvt_groups` for the segment
/// order); this component carries only their handles plus the tile meta
/// (per-group headers and one property table per layer), keeping ECS storage
/// and event cloning cheap. The handles are not reference-counted: the
/// finalize system consumes the streams via [`take_streams`], and the
/// `on_remove` hook frees whatever is still resident when the component is
/// dropped unconsumed (e.g. its tile was evicted in the same frame the result
/// arrived, so finalize never matched). After a normal finalize the entries
/// are already gone and handles are never reused, so the hook is a no-op then
/// (finalize never marks `WorkerTaskResultConsumed`; it doesn't need to).
///
/// [`take_streams`]: ParseMvtTileResult::take_streams
#[derive(Component, Clone, Debug)]
#[component(on_remove = free_unconsumed_buffers::<ParseMvtTileResult>)]
pub struct ParseMvtTileResult {
    pub f64_handle: Handle,
    pub f32_handle: Handle,
    pub u32_handle: Handle,
    pub u8_handle: Handle,
    pub meta: ParsedMvtTileMeta,
}

impl ParseMvtTileResult {
    /// Take ownership of the four packed streams for finalization, removing
    /// their `BufferStore` entries.
    pub fn take_streams(&self, buf: &mut BufferStore) -> (Vec<f64>, Vec<f32>, Vec<u32>, Vec<u8>) {
        (
            buf.remove_f64(&self.f64_handle).unwrap_or_default(),
            buf.remove_f32(&self.f32_handle).unwrap_or_default(),
            buf.remove_u32(&self.u32_handle).unwrap_or_default(),
            buf.remove_u8(&self.u8_handle).unwrap_or_default(),
        )
    }
}

impl FreeResultBuffers for ParseMvtTileResult {
    /// Free the stream buffers without reading them (leak-prevention path for
    /// results whose delegator disappeared before finalization).
    fn remove_from_buf(&self, buf: &mut BufferStore) {
        buf.remove(&self.f64_handle);
        buf.remove(&self.f32_handle);
        buf.remove(&self.u32_handle);
        buf.remove(&self.u8_handle);
    }
}

pub type ParseMvtTileWorkerTaskBundle =
    WorkerTaskBundle<ParseMvtTileMarker, ParseMvtTileParameters>;

#[cfg(test)]
mod test {
    use bevy_ecs::world::World;
    use navara_buffer_store::BufferStore;

    use super::ParseMvtTileResult;

    /// A parse result dropped before finalization (tile evicted in the same
    /// frame the result arrived) must not leak its packed streams when its
    /// entity is despawned.
    #[test]
    fn it_should_free_unconsumed_parse_streams_on_despawn() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let result = ParseMvtTileResult {
            f64_handle: buf.new_f64(vec![1.0, 2.0]),
            f32_handle: buf.new_f32(vec![1.0]),
            u32_handle: buf.new_u32(vec![1]),
            u8_handle: buf.new_u8(vec![1]),
            meta: Default::default(),
        };
        assert_eq!(buf.len(), 4);
        world.insert_resource(buf);
        let e = world.spawn(result).id();

        world.despawn(e);

        assert!(world.resource::<BufferStore>().is_empty());
    }

    /// Streams already taken by a normal finalize leave stale handles behind;
    /// despawning afterwards must stay a no-op (handles are never reused).
    #[test]
    fn it_should_not_touch_other_buffers_after_a_consumed_result() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let result = ParseMvtTileResult {
            f64_handle: buf.new_f64(vec![1.0]),
            f32_handle: buf.new_f32(vec![1.0]),
            u32_handle: buf.new_u32(vec![1]),
            u8_handle: buf.new_u8(vec![1]),
            meta: Default::default(),
        };
        // Simulate finalization plus an unrelated buffer that must survive.
        result.take_streams(&mut buf);
        let live = buf.new_f32(vec![9.0]);
        world.insert_resource(buf);
        let e = world.spawn(result).id();

        world.despawn(e);

        let buf = world.resource::<BufferStore>();
        assert_eq!(buf.len(), 1);
        assert!(buf.get_f32(&live).is_some());
    }
}
