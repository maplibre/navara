use bevy_ecs::entity::Entity;
use martini::Martini;
use navara_buffer_store::{BufferStore, Handle};
use navara_core::{
    Aabb, Ellipsoid, Extent, LLE, LngLat, Meters, Radians, TileRegion, TilingScheme, XYZ,
};
use navara_geometry::{
    Geometry, ReturnedConstructedTerrainMesh, UpsamplableTerrainGeometry, UpsampledTerrainGeometry,
    sample_mesh_height,
};
use navara_math::FloatType;
use quantized_mesh::{DecodedMesh, WaterMask};

use crate::terrain_data_requester::TileTerrainDataRequesterQuery;

use super::{TerrainConstructContext, TerrainData};

const QUANTIZED_MAX: f64 = 32767.0;

#[derive(Debug, Clone, Default)]
pub struct QuantizedMeshData {
    pub data_requester_entity_id: Option<Entity>,
    pub current_max_height: Option<FloatType>,
    pub current_min_height: Option<FloatType>,
    // Cached decoded heights: interleaved (u_norm, v_norm, height) as f32, stride 3
    pub heights_handle: Option<Handle>,
    // Triangle indices into the cached heights: sampling interpolates across
    // the triangle containing the point, so it needs the mesh's topology.
    pub indices_handle: Option<Handle>,
    // Triangle that answered the previous sample — a moving point almost
    // always lands in the same one again.
    pub last_hit_triangle: usize,
    pub tiling_scheme: TilingScheme,
}

impl QuantizedMeshData {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn new_with_tiling_scheme(tiling_scheme: TilingScheme) -> Self {
        Self {
            tiling_scheme,
            ..Self::default()
        }
    }

    fn decode_mesh(bytes: &[u8]) -> Option<DecodedMesh> {
        DecodedMesh::decode(bytes).ok()
    }
}

impl TerrainData for QuantizedMeshData {
    fn data_requester_entity_id(&self) -> Option<Entity> {
        self.data_requester_entity_id
    }

    fn set_data_requester_entity_id(&mut self, e: Option<Entity>) {
        self.data_requester_entity_id = e;
    }

    fn construct_terrain_mesh(
        &self,
        ellipsoid: Ellipsoid<FloatType>,
        ctx: &TerrainConstructContext,
        bytes: &[u8],
        _geoid_height: FloatType,
        _martini: Option<&mut Martini>,
    ) -> ReturnedConstructedTerrainMesh {
        let Some(decoded) = Self::decode_mesh(bytes) else {
            return ReturnedConstructedTerrainMesh {
                geometry: Geometry::default(),
                max_height: 0.0,
                min_height: 0.0,
                heights: vec![],
                rtc_translation: None,
                watermask: None,
            };
        };

        let min_height = decoded.header.min_height as f64;
        let max_height = decoded.header.max_height as f64;

        // ctx.extent is already the correct tile extent (geographic for geographic tiles,
        // WebMercator for WM tiles) because the quadtree uses TilingScheme::tile_extent().
        let west = ctx.extent.west.val();
        let south = ctx.extent.south.val();
        let east = ctx.extent.east.val();
        let north = ctx.extent.north.val();
        let aabb = Aabb::from_extent_f64(ctx.extent, min_height, max_height);
        let tile_center = aabb.center;

        let n = decoded.vertices.u.len();
        let mut positions: Vec<(f32, f32, f32)> = Vec::with_capacity(n);
        let mut uvs: Vec<f32> = Vec::with_capacity(n * 2);
        let mut heights: Vec<f32> = Vec::with_capacity(n);
        let mut actual_max_height = f64::NEG_INFINITY;
        let mut actual_min_height = f64::INFINITY;

        for i in 0..n {
            let u = decoded.vertices.u[i] as f64 / QUANTIZED_MAX;
            let v = decoded.vertices.v[i] as f64 / QUANTIZED_MAX;
            let h_norm = decoded.vertices.height[i] as f64 / QUANTIZED_MAX;

            let lng = west + u * (east - west);
            let lat = south + v * (north - south);
            let h = min_height + h_norm * (max_height - min_height);

            let XYZ { x, y, z } = ellipsoid.lle_to_xyz(LLE {
                lng: navara_core::Angle::new(lng),
                lat: navara_core::Angle::new(lat),
                height: Meters::new(h),
            });

            positions.push((
                (x.val() - tile_center.x) as f32,
                (y.val() - tile_center.y) as f32,
                (z.val() - tile_center.z) as f32,
            ));
            uvs.push(u as f32);
            uvs.push(v as f32);
            heights.push(h as f32);
            actual_max_height = actual_max_height.max(h);
            actual_min_height = actual_min_height.min(h);
        }

        let vertices: Vec<f32> = positions.iter().flat_map(|&(x, y, z)| [x, y, z]).collect();

        // Oct-decoded per-vertex normals in ECEF unit-vector form.
        let normals = decoded
            .extensions
            .normals
            .as_ref()
            .filter(|nv| nv.len() == n)
            .map(|nv| {
                nv.iter()
                    .flat_map(|v| [v[0], v[1], v[2]])
                    .collect::<Vec<f32>>()
            });

        // Watermask: 1 byte for uniform, 65536 bytes for 256x256 grid.
        let watermask = decoded.extensions.water_mask.as_ref().map(|w| match w {
            WaterMask::Uniform(v) => vec![*v],
            WaterMask::Grid(g) => g.to_vec(),
        });

        ReturnedConstructedTerrainMesh {
            geometry: Geometry {
                vertices,
                indices: decoded.indices,
                uvs,
                normals,
                ..Default::default()
            },
            max_height: actual_max_height,
            min_height: actual_min_height,
            heights,
            rtc_translation: Some(tile_center),
            watermask,
        }
    }

    fn upsample(
        &self,
        regions: &[TileRegion],
        upsamplable_geometry: UpsamplableTerrainGeometry,
    ) -> Option<UpsampledTerrainGeometry> {
        UpsampledTerrainGeometry::new_from_path(upsamplable_geometry, regions)
    }

    fn compute_height_at_point(
        &mut self,
        extent: &Extent<FloatType, Radians>,
        buf: &mut BufferStore,
        terrain_data_requesters: &TileTerrainDataRequesterQuery,
        point: &LngLat<FloatType, Radians>,
    ) -> Option<FloatType> {
        if self.heights_handle.is_none() {
            let (_, data_requester) = terrain_data_requesters
                .get(self.data_requester_entity_id()?)
                .ok()?;
            let bytes = buf.get_u8(&data_requester.handle)?;
            let decoded = Self::decode_mesh(bytes)?;

            let min_h = decoded.header.min_height;
            let max_h = decoded.header.max_height;
            let n = decoded.vertices.u.len();
            let mut result = Vec::with_capacity(n * 3);
            for i in 0..n {
                let u = decoded.vertices.u[i] as f32 / QUANTIZED_MAX as f32;
                let v = decoded.vertices.v[i] as f32 / QUANTIZED_MAX as f32;
                let h = min_h
                    + (decoded.vertices.height[i] as f32 / QUANTIZED_MAX as f32) * (max_h - min_h);
                result.push(u);
                result.push(v);
                result.push(h);
            }
            self.heights_handle = Some(buf.new_f32(result));
            self.indices_handle = Some(buf.new_u32(decoded.indices));
        }
        let interleaved = buf.get_f32(self.heights_handle.as_ref()?)?;
        let indices = buf.get_u32(self.indices_handle.as_ref()?)?;

        let east = extent.east;
        let west = extent.west;
        let north = extent.north;
        let south = extent.south;
        let dist_ew = (east - west).val() as f32;
        let dist_ns = (north - south).val() as f32;

        if dist_ew == 0.0 || dist_ns == 0.0 {
            return None;
        }

        let query_u = ((point.lng - west).val() as f32) / dist_ew;
        let query_v = ((point.lat - south).val() as f32) / dist_ns;

        let mut search_hint = self.last_hit_triangle;
        let height = sample_mesh_height(interleaved, indices, query_u, query_v, &mut search_hint);
        self.last_hit_triangle = search_hint;

        Some(height as FloatType)
    }

    fn current_max_height(&self) -> Option<FloatType> {
        self.current_max_height
    }

    fn set_current_max_height(&mut self, h: FloatType) {
        self.current_max_height = Some(h);
    }

    fn current_min_height(&self) -> Option<FloatType> {
        self.current_min_height
    }

    fn set_current_min_height(&mut self, h: FloatType) {
        self.current_min_height = Some(h);
    }

    fn destroy(&mut self, buf: &mut BufferStore) {
        if let Some(handle) = self.heights_handle.take() {
            buf.remove(&handle);
        }
        if let Some(handle) = self.indices_handle.take() {
            buf.remove(&handle);
        }
    }

    fn box_clone(&self) -> Box<dyn TerrainData> {
        Box::new(self.clone())
    }

    fn tiling_scheme(&self) -> navara_core::TilingScheme {
        self.tiling_scheme.clone()
    }
}
