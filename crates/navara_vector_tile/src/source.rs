use std::any::Any;

use bevy_ecs::{entity::Entity, prelude::Component, system::Commands};
use navara_buffer_store::BufferStore;
use navara_component::{OrderByDistance, Priority};
use navara_data_requester::DataRequester;
use navara_feature_component::batch::BatchTable;
use navara_material::Appearance;
use navara_tile_component::{TileHandle, VectorTile};

use crate::{
    data_requester::VectorTileDataRequesterQuery, layer::tile_cache_manager::TileCacheManager,
};

/// Tile readiness state, determined by the source.
pub enum ReadyState {
    /// Data available and ready to render.
    Success,
    /// No data at this location (e.g., empty GeoJSON area, server 404).
    Failed,
    /// Waiting for data (e.g., network request in flight).
    Pending,
}

/// Trait for providing tile data from different sources (MVT, GeoJSON, etc.).
#[allow(clippy::too_many_arguments)]
pub trait VectorTileSource: Send + Sync + 'static {
    /// Returns self as `&mut dyn Any` for downcasting.
    fn as_any_mut(&mut self) -> &mut dyn Any;

    /// Check tile availability and create a DataRequester entity.
    /// Returns true if a request was initiated.
    fn prepare_tile(
        &mut self,
        commands: &mut Commands,
        tile: &mut VectorTile,
        handle: TileHandle,
        tc: &mut TileCacheManager,
        buf: &mut BufferStore,
        data_requesters: &VectorTileDataRequesterQuery,
        priority: Priority,
    ) -> bool;

    /// Construct geometry entities from tile data.
    /// Returns entity IDs of spawned feature entities, or None if no features.
    fn construct_geometry(
        &mut self,
        commands: &mut Commands,
        batch_table: &mut BatchTable,
        buf: &mut BufferStore,
        tile: &VectorTile,
        tile_handle: TileHandle,
        rendered_tile: Entity,
        order: &OrderByDistance,
        data_requester: Option<&DataRequester>,
    ) -> Option<Vec<Entity>>;

    /// Check tile readiness. Each source defines its own logic:
    fn ready_state(
        &self,
        tile: &VectorTile,
        data_requesters: &VectorTileDataRequesterQuery,
    ) -> ReadyState;

    /// Whether this tile should be upscaled from a parent tile.
    fn should_upscale(&self, _tile: &VectorTile) -> bool {
        true
    }

    /// Called when tiles are evicted from the viewport cache.
    /// Sources should release any internal caches for these tiles.
    fn evict_tile(&mut self, _handles: TileHandle) {}

    /// How high above the ground this source's features are drawn, in meters,
    /// from its layers' materials (see [`max_feature_height`]).
    fn max_feature_height(&self) -> f64 {
        0.
    }
}

/// How high above the ground features styled by `appearances` are drawn, in
/// meters: the largest `height` plus the largest polygon `extruded_height`.
/// Clamped-to-ground materials do not count.
pub fn max_feature_height<'a>(appearances: impl IntoIterator<Item = &'a Appearance>) -> f64 {
    let (mut height, mut extruded_height) = (0f32, 0f32);
    for appearance in appearances {
        let (h, e) = match appearance {
            Appearance::Point(m) if !m.clamp_to_ground => (m.height, 0.),
            Appearance::Billboard(m) if !m.clamp_to_ground => (m.height, 0.),
            Appearance::Text(m) if !m.clamp_to_ground => (m.height, 0.),
            Appearance::Polyline(m) if !m.clamp_to_ground => (m.height, 0.),
            Appearance::Polygon(m) if !m.clamp_to_ground => {
                (m.height, m.extruded_height.unwrap_or(0.))
            }
            _ => continue,
        };
        height = height.max(h);
        extruded_height = extruded_height.max(e);
    }
    (height + extruded_height) as f64
}

/// Component wrapping a boxed `VectorTileSource` implementation.
#[derive(Component)]
pub struct TileSource(pub Box<dyn VectorTileSource>);

impl TileSource {
    /// Downcast the inner source to a concrete type.
    pub fn downcast_mut<T: VectorTileSource>(&mut self) -> Option<&mut T> {
        self.0.as_any_mut().downcast_mut::<T>()
    }
}

#[cfg(test)]
mod test {
    use navara_material::{PolygonMaterial, PolylineMaterial, TextMaterial};

    use super::*;

    #[test]
    fn it_should_add_the_largest_extrusion_to_the_largest_height() {
        let appearances = [
            Appearance::Text(TextMaterial {
                height: 300.,
                clamp_to_ground: false,
                ..Default::default()
            }),
            Appearance::Polygon(PolygonMaterial {
                height: 10.,
                extruded_height: Some(200.),
                clamp_to_ground: false,
                ..Default::default()
            }),
        ];
        assert_eq!(max_feature_height(&appearances), 500.);
    }

    #[test]
    fn it_should_leave_out_clamped_to_ground_materials() {
        let appearances = [Appearance::Polyline(PolylineMaterial {
            height: 1000.,
            clamp_to_ground: true,
            ..Default::default()
        })];
        assert_eq!(max_feature_height(&appearances), 0.);
    }
}
