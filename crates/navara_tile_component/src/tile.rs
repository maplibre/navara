use std::fmt::Debug;

use navara_camera::CameraFrustum;
use navara_core::{
    Aabb, Ellipsoid, Extent, LLE, Meters, Radians, TileXYZ, TilingScheme, vec3_to_xyz, xyz_to_vec3,
};
use navara_fog::{DynamicSseTerm, Fog, fog};
use navara_math::{FloatType, Transform, Vec3};
use navara_occluder::ellipsoidal_occluder::EllipsoidalOccluder;
use navara_quadtree::{Coords, Quadtree, num::PrimInt, to_int};
use navara_window::Window;

use crate::{TileBoundingRegion, TileHandle};

pub trait Tile {
    type CoordUnit: PrimInt + Default + Sync + Send + 'static;

    fn occludee_point_in_scaled_space(&self) -> Option<&Vec3>;
    fn set_occludee_point_in_scaled_space(&mut self, p: Option<Vec3>);

    fn extent(&self) -> &Extent<FloatType, Radians>;
    fn coords(&self) -> &TileXYZ;
    fn bounding_region(&self) -> Option<&TileBoundingRegion<FloatType>>;
    fn aabb(&self) -> &Aabb;
    fn max_height(&self) -> FloatType;
    fn min_height(&self) -> FloatType;
    fn update_heights(&mut self, max_height: FloatType, min_height: FloatType);
    fn has_terrain(&self) -> bool;

    /// This is cached children, the children might be removed after the tile is cleared.
    /// If you want to traverse all children correctly, you need to use [`Tile::traversable_children`].
    fn children(&self) -> &[TileHandle];
    fn set_children(&mut self, children: Vec<TileHandle>);

    fn update_tile_occludee_point(
        &mut self,
        ellipsoid: &Ellipsoid<FloatType>,
        occluder: &EllipsoidalOccluder,
    ) {
        if self.occludee_point_in_scaled_space().is_some() {
            return;
        }

        let extent = self
            .bounding_region()
            .map_or_else(|| self.extent(), |r| &r.extent);
        let center = self.aabb().center;
        let max_height = Meters::new(self.bounding_region().map_or_else(
            || self.max_height(),
            |r| self.max_height().max(r.maximum_height),
        ));

        let positions = vec![
            xyz_to_vec3(ellipsoid.lle_to_xyz(LLE {
                lng: extent.west,
                lat: extent.south,
                height: max_height,
            })),
            xyz_to_vec3(ellipsoid.lle_to_xyz(LLE {
                lng: extent.east,
                lat: extent.south,
                height: max_height,
            })),
            xyz_to_vec3(ellipsoid.lle_to_xyz(LLE {
                lng: extent.west,
                lat: extent.north,
                height: max_height,
            })),
            xyz_to_vec3(ellipsoid.lle_to_xyz(LLE {
                lng: extent.east,
                lat: extent.north,
                height: max_height,
            })),
        ];

        self.set_occludee_point_in_scaled_space(
            occluder.compute_horizontal_culling_point(ellipsoid, center, positions),
        );
    }

    fn is_root(&self) -> bool {
        let coords = self.coords();
        self.tiling_scheme()
            .root_tiles()
            .iter()
            .any(|r| r.x == coords.x && r.y == coords.y && r.z == coords.z)
    }

    fn intersect_with_camera_frustum(&self, frustum: &CameraFrustum) -> bool {
        frustum.intersection_with_aabb(self.aabb())||
		// Avoid frustum culling with root tile
		self.is_root()
    }

    fn calc_distance_from_camera(
        &self,
        camera: &Transform,
        ellipsoid: &Ellipsoid<FloatType>,
    ) -> FloatType {
        let camera_pos = camera.transform_point(Vec3::ZERO);
        self.bounding_region()
            .unwrap()
            .distance_to_camera(camera_pos, ellipsoid.xyz_to_lle(vec3_to_xyz(camera_pos)))
    }

    fn get_level_maximum_geometric_error(
        &self,
        ellipsoid: &Ellipsoid<FloatType>,
        height_map_width: FloatType,
    ) -> FloatType;

    // Ref: https://github.com/CesiumGS/cesium/blob/3b393448d7e976165c0260fab9ea90843583c3a7/packages/engine/Source/Scene/QuadtreePrimitive.js#L1245
    #[allow(clippy::too_many_arguments)]
    fn calc_sse(
        &self,
        frustum: &CameraFrustum,
        window: &Window,
        ellipsoid: &Ellipsoid<FloatType>,
        height_map_width: FloatType,
        distance_from_camera: FloatType,
        fog_comp: &Fog,
        dynamic_sse: DynamicSseTerm,
    ) -> FloatType {
        let max_geometric_error =
            self.get_level_maximum_geometric_error(ellipsoid, height_map_width);

        let mut error = (max_geometric_error * window.height)
            / (distance_from_camera * frustum.sse_denominator);

        if fog_comp.enabled {
            error -= fog(distance_from_camera, fog_comp.density) * fog_comp.sse_factor;
        }

        // Tilt-scaled relaxation for horizon views (no-op when disabled).
        // Ref: https://github.com/CesiumGS/cesium/blob/9e93c9b6aa44a8a490f5ed9aa175a7e92348aaa2/packages/engine/Source/Scene/Cesium3DTile.js#L950-L954
        error -= dynamic_sse.relaxation(distance_from_camera);

        error / window.pixel_ratio
    }

    /// Tiling scheme for this tile. Default: `WebMercator`.
    /// Override to propagate a different scheme (e.g. `Geographic`) to child tiles.
    fn tiling_scheme(&self) -> TilingScheme {
        TilingScheme::WebMercator { tms: false }
    }

    fn new_child(
        coords: Coords<Self::CoordUnit>,
        max_height: f64,
        min_height: f64,
        tiling_scheme: TilingScheme,
    ) -> Self;

    /// This is used to align children, because a child might be removed in quadtree.
    fn traversable_children(
        qt: &mut Quadtree<Self::CoordUnit, Self>,
        handle: TileHandle,
    ) -> Option<Vec<TileHandle>>
    where
        Self: Sized + Sync + Send + 'static + Debug,
    {
        let tile = qt.qt.get(handle).unwrap();
        let children = tile.children().to_vec();
        let coords = tile.coords();
        let coords = (to_int(coords.x), to_int(coords.y), to_int(coords.z));
        let parent_max_height = tile.max_height();
        let parent_min_height = tile.min_height();
        let tiling_scheme = tile.tiling_scheme();

        let init = |coords| {
            Self::new_child(
                coords,
                parent_max_height,
                parent_min_height,
                tiling_scheme.clone(),
            )
        };

        if children.is_empty() {
            let children = qt.qt.initialize_children(coords, &init)?;
            let tile = qt.qt.get_mut(handle).unwrap();
            tile.set_children(children.clone());
            return Some(children);
        }

        let mut new_children = Vec::with_capacity(4);
        for (i, c) in children.iter().enumerate() {
            let c = *c;
            let is_tile_some = match qt.qt.get_mut(c) {
                Some(tile) => {
                    if !tile.has_terrain() {
                        tile.update_heights(parent_max_height, parent_min_height);
                    }
                    true
                }
                None => false,
            };

            if is_tile_some {
                new_children.push(c);
                continue;
            }
            new_children.push(qt.qt.initialize_child(coords, to_int(i), &init)?);
        }
        Some(new_children)
    }
}
