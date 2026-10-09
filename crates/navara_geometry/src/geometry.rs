use navara_buffer_store::{BufferStore, Handle};
use navara_math::{FloatType, Vec3};
use serde::Serialize;

/// A struct to construct a geometry.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Geometry {
    /// Vector of vertex. The stride is 3.
    pub vertices: Vec<f32>,
    /// Vector of UV for a texture. The stride is 2.
    pub uvs: Vec<f32>,
    /// Vector of index that constructs a triangle.
    pub indices: Vec<u32>,
    /// Per-vertex normals (terrain only) in world space (ECEF). Stride is 3.
    /// Skirt normals are stored separately as [`Self::skirt_normals`].
    pub normals: Option<Vec<f32>>,
    /// Vector of skirt vertex. The stride is 3.
    /// These are separate from main vertices to allow different shadow/normal handling.
    pub skirt_vertices: Option<Vec<f32>>,
    /// Vector of skirt UV. The stride is 2.
    pub skirt_uvs: Option<Vec<f32>>,
    /// Vector of skirt index that constructs a triangle.
    pub skirt_indices: Option<Vec<u32>>,
    /// Per-vertex skirt normals (copied from corresponding edge vertices). Stride is 3.
    pub skirt_normals: Option<Vec<f32>>,
    /// Per-vertex terrain height (meters, unexaggerated) of every skirt vertex.
    /// Set whenever `skirt_vertices` is set.
    pub skirt_heights: Option<Vec<f32>>,
}

#[derive(Clone, Debug, Serialize)]
/// You should use this struct if you want to store [`Geometry`] to Bevy component.
pub struct TransferableGeometry {
    pub vertices: Handle,
    pub uvs: Handle,
    pub indices: Handle,
    pub normals: Option<Handle>,
    pub skirt_vertices: Option<Handle>,
    pub skirt_uvs: Option<Handle>,
    pub skirt_indices: Option<Handle>,
    pub skirt_normals: Option<Handle>,
    pub skirt_heights: Option<Handle>,
}

impl TransferableGeometry {
    pub fn with_buf(buf: &mut BufferStore, geo: Geometry) -> Self {
        Self {
            vertices: buf.new_f32(geo.vertices),
            uvs: buf.new_f32(geo.uvs),
            indices: buf.new_u32(geo.indices),
            normals: geo.normals.map(|v| buf.new_f32(v)),
            skirt_vertices: geo.skirt_vertices.map(|v| buf.new_f32(v)),
            skirt_uvs: geo.skirt_uvs.map(|v| buf.new_f32(v)),
            skirt_indices: geo.skirt_indices.map(|v| buf.new_u32(v)),
            skirt_normals: geo.skirt_normals.map(|v| buf.new_f32(v)),
            skirt_heights: geo.skirt_heights.map(|v| buf.new_f32(v)),
        }
    }

    pub fn remove_from_buf(&self, buf: &mut BufferStore) {
        buf.remove(&self.vertices);
        buf.remove(&self.uvs);
        buf.remove(&self.indices);
        let _ = self.normals.map(|i| buf.remove(&i));
        let _ = self.skirt_vertices.map(|i| buf.remove(&i));
        let _ = self.skirt_uvs.map(|i| buf.remove(&i));
        let _ = self.skirt_indices.map(|i| buf.remove(&i));
        let _ = self.skirt_normals.map(|i| buf.remove(&i));
        let _ = self.skirt_heights.map(|i| buf.remove(&i));
    }
}

pub struct ReturnedConstructedTerrainMesh {
    pub geometry: Geometry,
    pub max_height: FloatType,
    pub min_height: FloatType,
    pub heights: Vec<f32>,
    pub rtc_translation: Option<Vec3>,
    /// Optional watermask (1 byte for uniform, or 256x256 = 65536 bytes for grid).
    pub watermask: Option<Vec<u8>>,
}
