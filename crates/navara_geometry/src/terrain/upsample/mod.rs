mod clip;
mod dem_grid;

pub use dem_grid::*;

use rustc_hash::FxHashMap;

use clip::{ClippedIndex, clip_2d_triangle_at_threshold};
use radians::{Angle, Radians};

use navara_core::{Ellipsoid, Extent, LLE, Meters, TileRegion, lerp};

use crate::{Geometry, mercator_y, mercator_y_to_lat};

use navara_math::{FloatType, Vec3};

#[derive(Debug)]
pub struct UpsamplableTerrainGeometry<'a> {
    pub uvs: &'a [f32],
    pub heights: &'a [f32],
    pub indices: &'a [u32],
    /// Optional per-vertex normals from the parent (stride 3).
    pub normals: Option<&'a [f32]>,
    /// Optional quantized-mesh watermask from the parent (1 byte uniform or
    /// 65536 byte 256x256 grid).
    pub watermask: Option<&'a [u8]>,
}

/// Upsample a terrain mesh which is one of the four split child tiles.
/// The upsampled mesh have to be same size.
/// | 1 | 2 |  upsample 1  |       |
/// ---------     =>       |   1   |
/// | 3 | 4 |              |       |
///
/// A descendant deeper than one level is reached with
/// [`UpsampledTerrainGeometry::new_from_path`], which applies this quadrant
/// clip once per level so a tile can be upsampled straight from any ready
/// ancestor without materializing the levels in between.
#[derive(Debug)]
pub struct UpsampledTerrainGeometry {
    pub uvs: Option<Vec<FloatType>>,
    pub heights: Option<Vec<f32>>,
    pub indices: Option<Vec<u32>>,
    pub normals: Option<Vec<f32>>,
    /// Watermask cropped from the parent to this child's quadrant.
    pub watermask: Option<Vec<u8>>,
    pub max_height: FloatType,
    pub min_height: FloatType,
    is_east: bool,
    is_north: bool,
}

/// An intermediate level of a multi-level upsample: a clipped mesh already
/// remapped into its own tile's UV space, owned so the next clip can borrow it.
struct ChildSpaceGeometry {
    uvs: Vec<f32>,
    heights: Vec<f32>,
    indices: Vec<u32>,
    normals: Option<Vec<f32>>,
    watermask: Option<Vec<u8>>,
}

impl ChildSpaceGeometry {
    fn as_upsamplable(&self) -> UpsamplableTerrainGeometry<'_> {
        UpsamplableTerrainGeometry {
            uvs: &self.uvs,
            heights: &self.heights,
            indices: &self.indices,
            normals: self.normals.as_deref(),
            watermask: self.watermask.as_deref(),
        }
    }
}

impl UpsampledTerrainGeometry {
    pub fn new(upsamplable_geometry: UpsamplableTerrainGeometry, tile_region: &TileRegion) -> Self {
        let uvs = &upsamplable_geometry.uvs;
        let heights = &upsamplable_geometry.heights;
        let indices = &upsamplable_geometry.indices;
        let normals = upsamplable_geometry.normals;

        let (is_east, is_north) = match tile_region {
            TileRegion::NorthEast => (true, true),
            TileRegion::SouthEast => (true, false),
            TileRegion::SouthWest => (false, false),
            TileRegion::NorthWest => (false, true),
        };

        let (new_uvs, new_heights, new_normals, new_indices, max_height, min_height) =
            clip(uvs, heights, normals, indices, is_east, is_north);

        let watermask = upsamplable_geometry
            .watermask
            .and_then(|w| upsample_watermask(w, is_east, is_north));

        Self {
            uvs: Some(new_uvs),
            heights: Some(new_heights),
            indices: Some(new_indices),
            normals: new_normals,
            watermask,
            max_height,
            min_height,
            is_east,
            is_north,
        }
    }

    /// Upsample along a quadrant path from an ancestor down to the target tile,
    /// `regions[0]` being the ancestor's child on the way and the last entry the
    /// target itself. Every intermediate level is clipped and remapped into its
    /// own UV space before the next clip, so the result is what upsampling
    /// level by level would produce. Returns `None` for an empty path.
    pub fn new_from_path(
        upsamplable_geometry: UpsamplableTerrainGeometry,
        regions: &[TileRegion],
    ) -> Option<Self> {
        let (last, intermediates) = regions.split_last()?;

        let mut current: Option<ChildSpaceGeometry> = None;
        for region in intermediates {
            let clipped = match &current {
                Some(c) => Self::new(c.as_upsamplable(), region),
                None => Self::new(
                    UpsamplableTerrainGeometry {
                        uvs: upsamplable_geometry.uvs,
                        heights: upsamplable_geometry.heights,
                        indices: upsamplable_geometry.indices,
                        normals: upsamplable_geometry.normals,
                        watermask: upsamplable_geometry.watermask,
                    },
                    region,
                ),
            };
            current = Some(clipped.into_child_space());
        }

        Some(match &current {
            Some(c) => Self::new(c.as_upsamplable(), last),
            None => Self::new(upsamplable_geometry, last),
        })
    }

    /// Remap the clipped geometry from the parent's UV space into this tile's
    /// own `[0, 1]` UV space, as `construct_geometry` does, but keep it as
    /// plain buffers so it can serve as the parent of the next clip.
    fn into_child_space(mut self) -> ChildSpaceGeometry {
        let (min_u, max_u) = if self.is_east { (0.5, 1.) } else { (0., 0.5) };
        let (min_v, max_v) = if self.is_north { (0.5, 1.) } else { (0., 0.5) };
        let offset_u = if self.is_east { 1. } else { 0. };
        let offset_v = if self.is_north { 1. } else { 0. };

        let uvs = self
            .uvs
            .take()
            .unwrap_or_default()
            .chunks(2)
            .flat_map(|uv| {
                [
                    (uv[0].clamp(min_u, max_u) * 2. - offset_u) as f32,
                    (uv[1].clamp(min_v, max_v) * 2. - offset_v) as f32,
                ]
            })
            .collect();

        ChildSpaceGeometry {
            uvs,
            heights: self.heights.take().unwrap_or_default(),
            indices: self.indices.take().unwrap_or_default(),
            normals: self.normals.take(),
            watermask: self.watermask.take(),
        }
    }

    /// Construct geometry with optional RTC translation.
    /// You can run this function only once.
    ///
    /// `mercator_v` matches the parent mesh's UV semantics (see
    /// `tile_triangles`): WebMercator tiles carry Mercator-fraction UVs, so the
    /// child vertex latitude is recovered through the Mercator lerp; Geographic
    /// tiles lerp latitude directly.
    pub fn construct_geometry(
        &mut self,
        ellipsoid: Ellipsoid<FloatType>,
        extent: &Extent<FloatType, Radians>,
        center: &Vec3,
        mercator_v: bool,
    ) -> (Geometry, Vec<f32>) {
        let mut vertices = vec![];
        let mut uvs = vec![];

        let (min_u, max_u) = if self.is_east { (0.5, 1.) } else { (0., 0.5) };
        let (min_v, max_v) = if self.is_north { (0.5, 1.) } else { (0., 0.5) };

        let offset_u = if self.is_east { 1. } else { 0. };
        let offset_v = if self.is_north { 1. } else { 0. };

        fn clamp_uv(v: FloatType, min: FloatType, max: FloatType, offset: FloatType) -> FloatType {
            v.clamp(min, max) * 2. - offset
        }

        let heights = self.heights.take().unwrap();

        let merc_south = mercator_y(extent.south.val());
        let merc_north = mercator_y(extent.north.val());

        for (i, uv) in self.uvs.take().unwrap().chunks(2).enumerate() {
            let u = clamp_uv(uv[0], min_u, max_u, offset_u);
            let v = clamp_uv(uv[1], min_v, max_v, offset_v);
            let lat = if mercator_v {
                mercator_y_to_lat(lerp(merc_south, merc_north, v))
            } else {
                lerp(extent.south.val(), extent.north.val(), v)
            };
            let lle = LLE {
                lng: Angle::new(lerp(extent.west.val(), extent.east.val(), u)),
                lat: Angle::new(lat),
                height: Meters::new(heights[i] as f64),
            };
            let xyz = lle.to_xyz(ellipsoid);

            vertices.push((xyz.x.val() - center.x) as f32);
            vertices.push((xyz.y.val() - center.y) as f32);
            vertices.push((xyz.z.val() - center.z) as f32);

            uvs.push(u as f32);
            uvs.push(v as f32);
        }

        (
            Geometry {
                vertices,
                uvs,
                indices: self.indices.take().unwrap(),
                normals: self.normals.take(),
                ..Default::default()
            },
            heights,
        )
    }
}

const WATERMASK_SIZE: usize = 256;

/// Crop a parent quantized-mesh watermask to one child quadrant.
///
/// A uniform mask (1 byte) is inherited as-is. A 256x256 grid is cropped to
/// the child's 128x128 quadrant and upscaled back to 256x256 with nearest
/// neighbor, so the child mask keeps the same layout a directly decoded mask
/// has. Row 0 is the NORTH edge (masks are uploaded with `flipY` and sampled
/// at tile UVs where v=0 is the south edge), so a north child reads the first
/// 128 rows. Returns `None` for unexpected sizes.
pub fn upsample_watermask(parent: &[u8], is_east: bool, is_north: bool) -> Option<Vec<u8>> {
    match parent.len() {
        1 => Some(vec![parent[0]]),
        len if len == WATERMASK_SIZE * WATERMASK_SIZE => {
            const HALF: usize = WATERMASK_SIZE / 2;
            let src_row0 = if is_north { 0 } else { HALF };
            let src_col0 = if is_east { HALF } else { 0 };
            let mut out = vec![0u8; WATERMASK_SIZE * WATERMASK_SIZE];
            for y in 0..WATERMASK_SIZE {
                let src_row = (src_row0 + y / 2) * WATERMASK_SIZE;
                let dst_row = y * WATERMASK_SIZE;
                for x in 0..WATERMASK_SIZE {
                    out[dst_row + x] = parent[src_row + src_col0 + x / 2];
                }
            }
            Some(out)
        }
        _ => None,
    }
}

// TODO: Execute this function in worker
#[allow(clippy::type_complexity)]
fn clip(
    uvs: &[f32],
    heights: &[f32],
    normals: Option<&[f32]>,
    indices: &[u32],
    is_east: bool,
    is_north: bool,
) -> (Vec<f64>, Vec<f32>, Option<Vec<f32>>, Vec<u32>, f64, f64) {
    let threashold = 0.5;

    let mut clipped_coord_map = ClippedCoordMap::new();

    // A quadrant keeps roughly a quarter of the triangles; over-reserve a
    // little so the edge splits don't trigger a regrow.
    let est_vertices = uvs.len() / 2 / 3 + 16;
    let mut new_uvs = Vec::with_capacity(est_vertices * 2);
    let mut new_heights = Vec::with_capacity(est_vertices);
    let mut new_normals: Option<Vec<f32>> = normals.map(|_| Vec::with_capacity(est_vertices * 3));
    let mut new_indices = Vec::with_capacity(indices.len() / 3 + 16);

    let mut max_height = 0.0;
    let mut min_height = 99999.0;

    let read_normal = |idx: u32| -> Option<[f64; 3]> {
        normals.map(|src| {
            let base = idx as usize * 3;
            [src[base] as f64, src[base + 1] as f64, src[base + 2] as f64]
        })
    };

    for polygon_indices in indices.chunks(3) {
        let [u0, v0] = [
            uvs[polygon_indices[0] as usize * 2],
            uvs[polygon_indices[0] as usize * 2 + 1],
        ];
        let [u1, v1] = [
            uvs[polygon_indices[1] as usize * 2],
            uvs[polygon_indices[1] as usize * 2 + 1],
        ];
        let [u2, v2] = [
            uvs[polygon_indices[2] as usize * 2],
            uvs[polygon_indices[2] as usize * 2 + 1],
        ];

        let h0 = heights[polygon_indices[0] as usize];
        let h1 = heights[polygon_indices[1] as usize];
        let h2 = heights[polygon_indices[2] as usize];

        let origin_u_coords = [u0 as f64, u1 as f64, u2 as f64];
        let origin_v_coords = [v0 as f64, v1 as f64, v2 as f64];
        let origin_h_coords = [h0 as f64, h1 as f64, h2 as f64];

        let origin_normals = read_normal(polygon_indices[0]).map(|n0| {
            let n1 = read_normal(polygon_indices[1]).unwrap();
            let n2 = read_normal(polygon_indices[2]).unwrap();
            [
                [n0[0], n1[0], n2[0]],
                [n0[1], n1[1], n2[1]],
                [n0[2], n1[2], n2[2]],
            ]
        });

        let clipped_u_indices =
            clip_2d_triangle_at_threshold(threashold, is_east, &origin_u_coords);
        if clipped_u_indices.is_empty() {
            continue;
        }

        let interpolated_u_coords = [
            clipped_u_indices[0].interpolate(&origin_u_coords),
            clipped_u_indices[1].interpolate(&origin_u_coords),
            clipped_u_indices[2].interpolate(&origin_u_coords),
        ];
        let interpolated_v_coords = [
            clipped_u_indices[0].interpolate(&origin_v_coords),
            clipped_u_indices[1].interpolate(&origin_v_coords),
            clipped_u_indices[2].interpolate(&origin_v_coords),
        ];
        let interpolated_h_coords = [
            clipped_u_indices[0].interpolate(&origin_h_coords),
            clipped_u_indices[1].interpolate(&origin_h_coords),
            clipped_u_indices[2].interpolate(&origin_h_coords),
        ];
        let interpolated_normals = origin_normals.map(|comps| {
            [
                [
                    clipped_u_indices[0].interpolate(&comps[0]),
                    clipped_u_indices[1].interpolate(&comps[0]),
                    clipped_u_indices[2].interpolate(&comps[0]),
                ],
                [
                    clipped_u_indices[0].interpolate(&comps[1]),
                    clipped_u_indices[1].interpolate(&comps[1]),
                    clipped_u_indices[2].interpolate(&comps[1]),
                ],
                [
                    clipped_u_indices[0].interpolate(&comps[2]),
                    clipped_u_indices[1].interpolate(&comps[2]),
                    clipped_u_indices[2].interpolate(&comps[2]),
                ],
            ]
        });

        let clipped_transformed_v_indices =
            clip_2d_triangle_at_threshold(threashold, is_north, &interpolated_v_coords);
        if clipped_transformed_v_indices.is_empty() {
            continue;
        }

        construct_polygon(
            &clipped_transformed_v_indices,
            &mut new_uvs,
            &mut new_heights,
            new_normals.as_mut(),
            &mut new_indices,
            [
                interpolated_u_coords,
                interpolated_v_coords,
                interpolated_h_coords,
            ],
            interpolated_normals,
            &mut clipped_coord_map,
            (&mut max_height, &mut min_height),
        );

        if clipped_u_indices.len() == 4 {
            let interpolated_u_coords = [
                interpolated_u_coords[0],
                interpolated_u_coords[2],
                clipped_u_indices[3].interpolate(&origin_u_coords),
            ];
            let interpolated_v_coords = [
                interpolated_v_coords[0],
                interpolated_v_coords[2],
                clipped_u_indices[3].interpolate(&origin_v_coords),
            ];
            let interpolated_h_coords = [
                interpolated_h_coords[0],
                interpolated_h_coords[2],
                clipped_u_indices[3].interpolate(&origin_h_coords),
            ];
            let interpolated_normals2 = origin_normals.map(|comps| {
                [
                    [
                        interpolated_normals.as_ref().unwrap()[0][0],
                        interpolated_normals.as_ref().unwrap()[0][2],
                        clipped_u_indices[3].interpolate(&comps[0]),
                    ],
                    [
                        interpolated_normals.as_ref().unwrap()[1][0],
                        interpolated_normals.as_ref().unwrap()[1][2],
                        clipped_u_indices[3].interpolate(&comps[1]),
                    ],
                    [
                        interpolated_normals.as_ref().unwrap()[2][0],
                        interpolated_normals.as_ref().unwrap()[2][2],
                        clipped_u_indices[3].interpolate(&comps[2]),
                    ],
                ]
            });

            let clipped_transformed_v_indices =
                clip_2d_triangle_at_threshold(threashold, is_north, &interpolated_v_coords);
            if clipped_transformed_v_indices.is_empty() {
                continue;
            }

            construct_polygon(
                &clipped_transformed_v_indices,
                &mut new_uvs,
                &mut new_heights,
                new_normals.as_mut(),
                &mut new_indices,
                [
                    interpolated_u_coords,
                    interpolated_v_coords,
                    interpolated_h_coords,
                ],
                interpolated_normals2,
                &mut clipped_coord_map,
                (&mut max_height, &mut min_height),
            );
        }
    }

    (
        new_uvs,
        new_heights,
        new_normals,
        new_indices,
        max_height,
        min_height,
    )
}

#[allow(clippy::too_many_arguments)]
fn construct_polygon(
    clipped_indices: &[ClippedIndex],
    new_uvs: &mut Vec<FloatType>,
    new_heights: &mut Vec<f32>,
    new_normals: Option<&mut Vec<f32>>,
    new_indices: &mut Vec<u32>,
    [
        interpolated_u_coords,
        interpolated_v_coords,
        interpolated_h_coords,
    ]: [[FloatType; 3]; 3],
    interpolated_normal_coords: Option<[[FloatType; 3]; 3]>,
    clipped_coord_map: &mut ClippedCoordMap,
    (max_height, min_height): (&mut FloatType, &mut FloatType),
) {
    let mut new_polygon_indices = [0u32; 4];
    let mut new_polygon_len = 0usize;
    let mut new_normals = new_normals;
    for i in clipped_indices {
        let new_index = new_uvs.len() / 2;
        let u = i.interpolate(&interpolated_u_coords);
        let v = i.interpolate(&interpolated_v_coords);
        let h = i.interpolate(&interpolated_h_coords);

        let new_index = if let Some(index) = clipped_coord_map.get(u, v, h) {
            *index
        } else {
            clipped_coord_map.insert(u, v, h, new_index);

            new_uvs.push(u);
            new_uvs.push(v);
            new_heights.push(h as f32);

            if let (Some(dst), Some(comps)) =
                (new_normals.as_deref_mut(), interpolated_normal_coords)
            {
                let nx = i.interpolate(&comps[0]);
                let ny = i.interpolate(&comps[1]);
                let nz = i.interpolate(&comps[2]);
                let len = (nx * nx + ny * ny + nz * nz).sqrt();
                if len > 0.0 {
                    dst.push((nx / len) as f32);
                    dst.push((ny / len) as f32);
                    dst.push((nz / len) as f32);
                } else {
                    dst.push(0.0);
                    dst.push(0.0);
                    dst.push(1.0);
                }
            }

            new_index
        };

        *max_height = max_height.max(h);
        *min_height = min_height.min(h);

        new_polygon_indices[new_polygon_len] = new_index as u32;
        new_polygon_len += 1;
    }
    let new_polygon_indices = &new_polygon_indices[..new_polygon_len];

    if count_unique(new_polygon_indices) < 3 {
        return;
    }

    if new_polygon_indices.len() == 3 {
        // A triangle.
        if let Some(v) = construct_indices([
            new_polygon_indices[0],
            new_polygon_indices[1],
            new_polygon_indices[2],
        ]) {
            new_indices.extend_from_slice(&v);
        };
    } else {
        // Two triangles.
        if let Some(v) = construct_indices([
            new_polygon_indices[0],
            new_polygon_indices[1],
            new_polygon_indices[2],
        ]) {
            new_indices.extend_from_slice(&v);
        };

        if let Some(v) = construct_indices([
            new_polygon_indices[0],
            new_polygon_indices[2],
            new_polygon_indices[3],
        ]) {
            new_indices.extend_from_slice(&v);
        };
    }
}

/// Number of distinct values among at most four indices, without allocating.
fn count_unique(idxs: &[u32]) -> usize {
    let mut n = 0;
    for (i, a) in idxs.iter().enumerate() {
        if !idxs[..i].contains(a) {
            n += 1;
        }
    }
    n
}

fn construct_indices(idxs: [u32; 3]) -> Option<[u32; 3]> {
    if count_unique(&idxs) < 3 {
        None
    } else {
        Some(idxs)
    }
}

// This is used to avoid duplicating a coordinate.
struct ClippedCoordMap(FxHashMap<(u16, u16, u64), usize>);

impl ClippedCoordMap {
    const SCALE_U16: FloatType = 32767.;

    fn new() -> Self {
        Self(FxHashMap::default())
    }
    fn get(&mut self, u: FloatType, v: FloatType, h: FloatType) -> Option<&usize> {
        self.0.get(&Self::make_key(u, v, h))
    }
    fn insert(&mut self, u: FloatType, v: FloatType, h: FloatType, idx: usize) {
        self.0.insert(Self::make_key(u, v, h), idx);
    }
    fn make_key(u: FloatType, v: FloatType, h: FloatType) -> (u16, u16, u64) {
        (
            Self::quantize_float(u),
            Self::quantize_float(v),
            h.to_bits(),
        )
    }
    fn quantize_float(v: FloatType) -> u16 {
        (v * Self::SCALE_U16) as u16
    }
}

#[cfg(test)]
mod test {
    use approx::assert_abs_diff_eq;
    use navara_core::{Extent, LngLat, Rad, TileRegion, WGS84_64};
    use navara_math::{EPSILON5, Vec3};

    use crate::UpsamplableTerrainGeometry;

    use super::UpsampledTerrainGeometry;

    #[test]
    fn sw_and_se_should_have_different_clipped_uvs() {
        // Same parent mesh, two different u-halves. The clipped UVs (in parent UV
        // space, before clamp_uv) must differ: SW keeps u<=0.5, SE keeps u>=0.5.
        let uvs: Vec<f32> = (0..3)
            .flat_map(|j| (0..3).map(move |i| [(i as f32) * 0.5, (j as f32) * 0.5]))
            .flatten()
            .collect();
        let heights: Vec<f32> = (0..9).map(|i| i as f32 * 100.0).collect();
        let mut indices = Vec::new();
        for j in 0..2u32 {
            for i in 0..2u32 {
                let a = j * 3 + i;
                let b = a + 1;
                let c = a + 3;
                let d = c + 1;
                indices.extend_from_slice(&[a, b, d, a, d, c]);
            }
        }

        let sw = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &uvs,
                heights: &heights,
                indices: &indices,
                normals: None,
                watermask: None,
            },
            &TileRegion::SouthWest,
        );
        let se = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &uvs,
                heights: &heights,
                indices: &indices,
                normals: None,
                watermask: None,
            },
            &TileRegion::SouthEast,
        );

        let sw_uvs = sw.uvs.as_ref().unwrap();
        let se_uvs = se.uvs.as_ref().unwrap();

        // SW kept u in [0, 0.5]. Every u in SW's clipped output must satisfy u <= 0.5.
        for u in sw_uvs.iter().step_by(2) {
            assert!(
                *u <= 0.5 + 1e-9,
                "SW clip leaked vertex with u={} (should be u<=0.5)",
                u
            );
        }
        // SE kept u in [0.5, 1]. Every u in SE's clipped output must satisfy u >= 0.5.
        for u in se_uvs.iter().step_by(2) {
            assert!(
                *u >= 0.5 - 1e-9,
                "SE clip leaked vertex with u={} (should be u>=0.5)",
                u
            );
        }

        // The two clipped UV sets MUST differ — otherwise SW and SE render identical
        // geometry (the user-visible bug).
        assert_ne!(
            sw_uvs, se_uvs,
            "SW and SE produced identical clipped UVs — u-clip is not working"
        );
    }

    #[test]
    fn grandchild_upsample_clips_to_smaller_quadrant() {
        // Simulate a denser parent mesh (3×3 grid → 8 triangles).
        let mut uvs = Vec::new();
        let mut heights = Vec::new();
        for j in 0..3 {
            for i in 0..3 {
                uvs.push(i as f32 * 0.5);
                uvs.push(j as f32 * 0.5);
                heights.push((i * 10 + j * 100) as f32);
            }
        }
        let mut indices = Vec::new();
        for j in 0..2u32 {
            for i in 0..2u32 {
                let a = j * 3 + i;
                let b = a + 1;
                let c = a + 3;
                let d = c + 1;
                indices.extend_from_slice(&[a, b, d, a, d, c]);
            }
        }

        // First upsample: parent → NE child
        let mut child = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &uvs,
                heights: &heights,
                indices: &indices,
                normals: None,
                watermask: None,
            },
            &TileRegion::NorthEast,
        );

        // Run construct_geometry to remap child uvs to child space [0, 1].
        let parent_extent = Extent::from_points(&[
            LngLat {
                lng: Rad::new(2.41887_f64),
                lat: Rad::new(0.61610_f64),
            },
            LngLat {
                lng: Rad::new(2.41922_f64),
                lat: Rad::new(0.61645_f64),
            },
        ]);
        let mid_lng = (parent_extent.west.val() + parent_extent.east.val()) / 2.0;
        let mid_lat = (parent_extent.south.val() + parent_extent.north.val()) / 2.0;
        let child_extent = Extent::from_points(&[
            LngLat {
                lng: Rad::new(mid_lng),
                lat: Rad::new(mid_lat),
            },
            LngLat {
                lng: parent_extent.east,
                lat: parent_extent.north,
            },
        ]);
        let (child_geom, child_heights) =
            child.construct_geometry(WGS84_64, &child_extent, &Vec3::ZERO, false);

        // Second upsample: child → NE grandchild
        let grandchild = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &child_geom.uvs,
                heights: &child_heights,
                indices: &child_geom.indices,
                normals: None,
                watermask: None,
            },
            &TileRegion::NorthEast,
        );

        let clipped_uvs = grandchild.uvs.as_ref().unwrap();
        let clipped_indices = grandchild.indices.as_ref().unwrap();

        // Sanity: clip should produce *fewer* triangles than the child had.
        assert!(
            !clipped_indices.is_empty(),
            "grandchild produced no triangles"
        );

        // All referenced vertices must be in [0.5, 1] x [0.5, 1] of child UV.
        use std::collections::HashSet;
        let referenced: HashSet<u32> = clipped_indices.iter().copied().collect();
        for &idx in &referenced {
            let u = clipped_uvs[idx as usize * 2];
            let v = clipped_uvs[idx as usize * 2 + 1];
            assert!(
                u >= 0.5 - 1e-9 && v >= 0.5 - 1e-9,
                "grandchild referenced vertex {} ({}, {}) outside NE quadrant of child",
                idx,
                u,
                v
            );
        }
    }

    /// 3×3 grid mesh (8 triangles) with heights that vary across the grid.
    fn grid_mesh() -> (Vec<f32>, Vec<f32>, Vec<u32>) {
        let mut uvs = Vec::new();
        let mut heights = Vec::new();
        for j in 0..3 {
            for i in 0..3 {
                uvs.push(i as f32 * 0.5);
                uvs.push(j as f32 * 0.5);
                heights.push((i * 10 + j * 100) as f32);
            }
        }
        let mut indices = Vec::new();
        for j in 0..2u32 {
            for i in 0..2u32 {
                let a = j * 3 + i;
                let b = a + 1;
                let c = a + 3;
                let d = c + 1;
                indices.extend_from_slice(&[a, b, d, a, d, c]);
            }
        }
        (uvs, heights, indices)
    }

    #[test]
    fn path_of_one_region_matches_single_level_upsample() {
        let (uvs, heights, indices) = grid_mesh();
        let geometry = || UpsamplableTerrainGeometry {
            uvs: &uvs,
            heights: &heights,
            indices: &indices,
            normals: None,
            watermask: None,
        };

        let single = UpsampledTerrainGeometry::new(geometry(), &TileRegion::SouthEast);
        let path =
            UpsampledTerrainGeometry::new_from_path(geometry(), &[TileRegion::SouthEast]).unwrap();

        assert_eq!(single.uvs, path.uvs);
        assert_eq!(single.heights, path.heights);
        assert_eq!(single.indices, path.indices);
        assert_eq!(single.max_height, path.max_height);
        assert_eq!(single.min_height, path.min_height);
    }

    #[test]
    fn empty_path_yields_nothing() {
        let (uvs, heights, indices) = grid_mesh();
        let geometry = UpsamplableTerrainGeometry {
            uvs: &uvs,
            heights: &heights,
            indices: &indices,
            normals: None,
            watermask: None,
        };
        assert!(UpsampledTerrainGeometry::new_from_path(geometry, &[]).is_none());
    }

    #[test]
    fn two_level_path_matches_level_by_level_upsample() {
        let (uvs, heights, indices) = grid_mesh();
        let geometry = || UpsamplableTerrainGeometry {
            uvs: &uvs,
            heights: &heights,
            indices: &indices,
            normals: None,
            watermask: None,
        };

        // Level by level: clip to the NE child, remap into the child's UV space
        // through `construct_geometry`, then clip that child to its SW quadrant.
        let mut child = UpsampledTerrainGeometry::new(geometry(), &TileRegion::NorthEast);
        let extent = Extent::from_points(&[
            LngLat {
                lng: Rad::new(0.0_f64),
                lat: Rad::new(0.0_f64),
            },
            LngLat {
                lng: Rad::new(0.001_f64),
                lat: Rad::new(0.001_f64),
            },
        ]);
        let (child_geom, child_heights) =
            child.construct_geometry(WGS84_64, &extent, &Vec3::ZERO, false);
        let stepwise = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &child_geom.uvs,
                heights: &child_heights,
                indices: &child_geom.indices,
                normals: None,
                watermask: None,
            },
            &TileRegion::SouthWest,
        );

        let direct = UpsampledTerrainGeometry::new_from_path(
            geometry(),
            &[TileRegion::NorthEast, TileRegion::SouthWest],
        )
        .unwrap();

        assert_eq!(stepwise.indices, direct.indices);
        assert_eq!(stepwise.heights, direct.heights);
        let stepwise_uvs = stepwise.uvs.as_ref().unwrap();
        let direct_uvs = direct.uvs.as_ref().unwrap();
        assert_eq!(stepwise_uvs.len(), direct_uvs.len());
        for (a, b) in stepwise_uvs.iter().zip(direct_uvs.iter()) {
            assert!((a - b).abs() < EPSILON5, "{a} != {b}");
        }
        // The grandchild covers the SW quadrant of the NE child, i.e. the
        // [0.5, 0.75]² patch of the ancestor: heights `i * 10 + j * 100` sampled
        // at uv `(i * 0.5, j * 0.5)` interpolate to 110..=165 there.
        assert!(
            direct.min_height >= 110. - EPSILON5,
            "{}",
            direct.min_height
        );
        assert!(
            direct.max_height <= 165. + EPSILON5,
            "{}",
            direct.max_height
        );
    }

    #[test]
    fn it_should_construct_upsampled_coords() {
        let mesh = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &[0.1, 0.8, 0.4, 0.2, 0.8, 0.9],
                heights: &[0., 50., 100.],
                indices: &[0, 1, 2],
                normals: None,
                watermask: None,
            },
            &TileRegion::NorthEast,
        );

        fn assert_all_f32(results: &[f32], expects: &[f32]) {
            for (idx, result) in results.iter().enumerate() {
                assert_abs_diff_eq!(*result, expects[idx], epsilon = EPSILON5 as f32);
            }
        }
        fn assert_all_f64(results: &[f64], expects: &[f64]) {
            for (idx, result) in results.iter().enumerate() {
                assert_abs_diff_eq!(*result, expects[idx], epsilon = EPSILON5);
            }
        }

        assert_all_f64(
            &mesh.uvs.unwrap(),
            &[0.8, 0.9, 0.5, 0.85714287, 0.5, 0.5, 0.57142854, 0.5],
        );
        assert_all_f32(
            &mesh.heights.unwrap(),
            &[100.0, 57.14286, 61.111115, 71.42857],
        );
        assert_eq!(&mesh.indices.unwrap(), &[0, 1, 2, 0, 2, 3]);

        let mesh = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &[0., 1., 0., 0., 1., 0., 1., 1.],
                heights: &[0., 50., 100., 50.],
                indices: &[0, 1, 2, 0, 2, 3],
                normals: None,
                watermask: None,
            },
            &TileRegion::NorthEast,
        );

        assert_all_f64(
            &mesh.uvs.unwrap(),
            &[0.5, 0.5, 1.0, 1.0, 0.5, 1.0, 0.75, 0.5, 1.0, 0.5],
        );
        assert_all_f32(&mesh.heights.unwrap(), &[50.0, 50.0, 25.0, 62.5, 75.0]);
        assert_eq!(mesh.indices.unwrap(), [1, 2, 3, 1, 3, 4, 2, 0, 3]);
    }

    #[test]
    fn it_should_inherit_uniform_watermask() {
        assert_eq!(
            super::upsample_watermask(&[255], true, false),
            Some(vec![255])
        );
        assert_eq!(super::upsample_watermask(&[0], false, true), Some(vec![0]));
    }

    #[test]
    fn it_should_reject_unexpected_watermask_size() {
        assert_eq!(super::upsample_watermask(&[0; 100], true, true), None);
    }

    #[test]
    fn it_should_crop_grid_watermask_to_quadrant() {
        const SIZE: usize = 256;
        const HALF: usize = SIZE / 2;
        // Fill each quadrant of the parent with a distinct value. Row 0 is the
        // north edge, so rows [0, 128) are north and columns [128, 256) are east.
        let mut parent = vec![0u8; SIZE * SIZE];
        for y in 0..SIZE {
            for x in 0..SIZE {
                let north = y < HALF;
                let east = x >= HALF;
                parent[y * SIZE + x] = match (east, north) {
                    (false, true) => 10,  // NW
                    (true, true) => 20,   // NE
                    (false, false) => 30, // SW
                    (true, false) => 40,  // SE
                };
            }
        }

        for (is_east, is_north, expected) in [
            (false, true, 10u8),
            (true, true, 20),
            (false, false, 30),
            (true, false, 40),
        ] {
            let child = super::upsample_watermask(&parent, is_east, is_north).unwrap();
            assert_eq!(child.len(), SIZE * SIZE);
            assert!(
                child.iter().all(|&v| v == expected),
                "quadrant (east={}, north={}) should be uniformly {}",
                is_east,
                is_north,
                expected
            );
        }
    }

    #[test]
    fn it_should_upscale_cropped_watermask_with_nearest_neighbor() {
        const SIZE: usize = 256;
        // Single water texel at the parent's northwest corner (row 0, col 0).
        let mut parent = vec![0u8; SIZE * SIZE];
        parent[0] = 255;

        let child = super::upsample_watermask(&parent, false, true).unwrap();

        // The NW child doubles that texel into a 2x2 block at its own NW corner.
        for y in 0..SIZE {
            for x in 0..SIZE {
                let expected = if x < 2 && y < 2 { 255 } else { 0 };
                assert_eq!(child[y * SIZE + x], expected, "at ({}, {})", x, y);
            }
        }

        // The other children see no water at all.
        let se_child = super::upsample_watermask(&parent, true, false).unwrap();
        assert!(se_child.iter().all(|&v| v == 0));
    }
}
