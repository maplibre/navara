use bevy_ecs::{component::Component, entity::Entity};
use navara_core::{Extent, LLE, Radians};
use navara_math::FloatType;

use crate::TileHandle;

#[derive(Debug, Default, Component)]
pub struct TileMeshMarker {
    pub handle: TileHandle,
    pub ready_parent_tile_handle: Option<TileHandle>,
}

/// GPU byte breakdown for a terrain tile mesh, split so the two contributions
/// can be updated independently. `geometry` is measured from the mesh's GPU
/// buffers when the mesh spawns. `drape` is the footprint of draping
/// clamp-to-ground vectors onto this tile — the shared composite atlas plus one
/// render target per live draped layer — reported from JS, which owns those
/// lazily-allocated targets and knows the live count. Both scale with terrain
/// subdivision past the vector maxZoom, which per-vector-tile accounting cannot
/// see. The owning `TileCost.gpu_est` is kept equal to `geometry + drape`.
#[derive(Debug, Default, Clone, Copy, Component)]
pub struct TerrainTileGpuCost {
    pub geometry: u64,
    pub drape: u64,
}

impl TerrainTileGpuCost {
    pub fn total(&self) -> u64 {
        self.geometry.saturating_add(self.drape)
    }
}

#[derive(Debug, Clone, Component)]
pub struct OverscaledTileHandle {
    pub handle: TileHandle,
}

impl OverscaledTileHandle {
    pub fn new(handle: TileHandle) -> Self {
        Self { handle }
    }
}

#[derive(Debug, Clone, Component)]
pub struct TileExtent {
    pub extent: Extent<FloatType, Radians>,
}

impl TileExtent {
    pub fn new(extent: Extent<FloatType, Radians>) -> Self {
        Self { extent }
    }
}

#[derive(Component, Debug, Clone)]
pub struct TerrainHeightObserver {
    pub lle: LLE<FloatType, Radians>,
    pub height: Option<FloatType>,
}

/// Watches the [`crate::terrain_height_range`] of `extent`. `range` is `None`
/// until first computed.
#[derive(Component, Debug, Clone)]
pub struct TerrainHeightRangeObserver {
    pub extent: Extent<FloatType, Radians>,
    pub range: Option<(FloatType, FloatType)>,
}

/// Data for a single hillshade backfill event
/// Contains all information needed to update hillshade textures in JS
#[derive(Debug, Clone, Copy)]
pub struct HillshadeBackfillEventData {
    pub tile_handle: u64,
    /// Edge data handle for updating edges
    /// -1 when only creating initial texture (no edge update)
    pub edge_data_handle: i32,
    /// Original DEM data handle (256×256 RGBA)
    /// Some() when texture needs to be created for the first time
    /// None when only updating edges
    pub original_handle: Option<i32>,
    /// Target entity (DataRequester entity) that owns the texture
    /// For edge updates, this points to the actual DataRequester
    pub target_entity: Option<Entity>,
    /// Edge direction: 0=Left, 1=Right, 2=Top, 3=Bottom
    /// 255 when not applicable (initialization)
    pub edge_direction: u8,
}

/// Component storing multiple hillshade backfill events for a single entity
/// Attached to the main DataRequester entity when backfill events are generated
#[derive(Component, Debug, Clone)]
pub struct HillshadeBackfillEvents {
    pub events: Vec<HillshadeBackfillEventData>,
}

/// Marker component indicating that hillshade edges have been extracted
/// Once this is added, the original DEM data has been deleted and only edge data remains
#[derive(Component, Debug, Clone, Copy)]
pub struct HillshadeEdgesExtracted;

/// One-shot marker inserted by `RasterTile::destroy` to request a hillshade
/// cancel event for an entity. Drained by `emit_hillshade_canceled` in the
/// same frame, which pushes the entity to `EventStore.hillshade_canceled` and
/// removes the marker.
///
/// Scopes cancel emission to the RasterTile destruction path so it can't
/// double-fire texture teardown that `texture_fragment_removed` already owns.
#[derive(Component, Debug, Clone, Copy)]
pub struct HillshadeCancelRequested;

/// Component storing handles to the 4 edge buffers of a hillshade tile
/// Each edge is 256×4 bytes (RGBA) for a 256×256 DEM texture
/// Edges are extracted after first load to save memory (4KB instead of 256KB per tile)
#[derive(Component, Debug, Clone, Copy)]
pub struct HillshadeEdges {
    pub left: i32,   // Edge direction 0
    pub right: i32,  // Edge direction 1
    pub top: i32,    // Edge direction 2
    pub bottom: i32, // Edge direction 3
}
