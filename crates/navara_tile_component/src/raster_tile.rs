use bevy_ecs::prelude::*;
use navara_component::Deleted;
use navara_core::{
    Aabb, Ellipsoid, Extent, Radians, TileXYZ, TilingScheme, WGS84_64,
    get_ellipsoid_terrain_level_zero_maximum_geometric_error, get_level_maximum_geometric_error,
};
use navara_math::Vec3;

use navara_quadtree::Coords;

use crate::{Tile, TileHandle};

use navara_math::FloatType;

use super::tile_bounding_region::TileBoundingRegion;

// A lightweight tile that only owns raster texture fragments. Unlike
// [`TerrainTile`](crate::TerrainTile) it carries no terrain geometry, mesh, or
// height data: raster tiles are traversed in their own WebMercator quadtree
// ([`RasterTileQuadtree`]) and the resolved textures are pulled into the
// terrain tiles by extent at material-build time.
//
// Note Tile have to keep light size for caching efficiently.
// So if you want to store large data in this struct, use [`BufferStore`].
#[derive(Debug)]
pub struct RasterTile {
    pub coords: TileXYZ,
    pub extent: Extent<FloatType, Radians>,
    pub aabb: Aabb,
    pub bounding_region: Option<TileBoundingRegion<FloatType>>,
    pub children: Vec<TileHandle>,
    pub visited_at: usize,
    /// Per-layer texture fragment entities, indexed by the sorted layer `Order`.
    /// Hillshade layers are resolved on the terrain side, so their slots stay
    /// `None` here.
    pub texture_fragment_entity_ids: Option<Vec<Option<Entity>>>,
    pub occludee_point_in_scaled_space: Option<Vec3>,
    pub max_height: f64,
    pub min_height: f64,
    pub distance_from_camera: FloatType,
    pub sse: FloatType,
}

impl Clone for RasterTile {
    fn clone(&self) -> Self {
        Self {
            coords: self.coords,
            extent: self.extent,
            aabb: self.aabb.clone(),
            bounding_region: self.bounding_region.clone(),
            // Note: `children` needs to be updated dynamically.
            children: vec![],
            visited_at: self.visited_at,
            texture_fragment_entity_ids: self.texture_fragment_entity_ids.clone(),
            occludee_point_in_scaled_space: self.occludee_point_in_scaled_space,
            max_height: self.max_height,
            min_height: self.min_height,
            distance_from_camera: 0.,
            sse: 0.,
        }
    }
}

impl RasterTile {
    pub fn new(coords: TileXYZ, max_height: f64, min_height: f64) -> Self {
        // Raster tiles are always WebMercator.
        let extent = TilingScheme::WebMercator { tms: false }.tile_extent(coords);

        Self {
            coords,
            extent,
            aabb: Aabb::from_extent_f64(extent, min_height, max_height),
            bounding_region: Some(TileBoundingRegion::from_extent_f64(extent, WGS84_64)),
            visited_at: 0,
            texture_fragment_entity_ids: None,
            occludee_point_in_scaled_space: None,
            children: Vec::with_capacity(4),
            max_height,
            min_height,
            distance_from_camera: 0.,
            sse: 0.,
        }
    }

    // This function will be invoked before this tile is destroyed.
    pub fn destroy(&mut self, commands: &mut Commands) {
        if let Some(fragments) = self.texture_fragment_entity_ids.take() {
            for fragment in fragments.into_iter().flatten() {
                commands.entity(fragment).insert(Deleted);
            }
        }
    }
}

impl Tile for RasterTile {
    type CoordUnit = usize;

    fn aabb(&self) -> &Aabb {
        &self.aabb
    }

    fn bounding_region(&self) -> Option<&TileBoundingRegion<FloatType>> {
        self.bounding_region.as_ref()
    }

    fn coords(&self) -> &TileXYZ {
        &self.coords
    }

    fn extent(&self) -> &Extent<FloatType, Radians> {
        &self.extent
    }

    fn children(&self) -> &[TileHandle] {
        &self.children
    }

    fn set_children(&mut self, children: Vec<TileHandle>) {
        self.children = children;
    }

    fn occludee_point_in_scaled_space(&self) -> Option<&Vec3> {
        self.occludee_point_in_scaled_space.as_ref()
    }

    fn set_occludee_point_in_scaled_space(&mut self, p: Option<Vec3>) {
        self.occludee_point_in_scaled_space = p;
    }

    fn max_height(&self) -> f64 {
        self.max_height
    }

    fn min_height(&self) -> f64 {
        self.min_height
    }

    fn update_heights(&mut self, max_height: f64, min_height: f64) {
        if self.max_height == max_height && self.min_height == min_height {
            return;
        }
        self.max_height = max_height;
        self.min_height = min_height;
        if let Some(bounding_region) = &mut self.bounding_region {
            bounding_region.maximum_height = max_height;
            bounding_region.minimum_height = min_height;
        }
        self.aabb.update(self.extent, min_height, max_height);
        self.occludee_point_in_scaled_space = None;
    }

    /// `traverse_raster` sets the heights from the terrain on entry.
    fn inherits_parent_heights(&self) -> bool {
        false
    }

    fn get_level_maximum_geometric_error(
        &self,
        ellipsoid: &Ellipsoid<FloatType>,
        height_map_width: FloatType,
    ) -> FloatType {
        get_level_maximum_geometric_error(
            self.coords.z,
            get_ellipsoid_terrain_level_zero_maximum_geometric_error(ellipsoid, height_map_width),
        )
    }

    fn new_child(
        (x, y, z): Coords<Self::CoordUnit>,
        max_height: f64,
        min_height: f64,
        _tiling_scheme: TilingScheme,
    ) -> Self {
        Self::new(TileXYZ { x, y, z }, max_height, min_height)
    }
}
