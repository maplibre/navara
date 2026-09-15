use navara_core::{Angle, Ellipsoid, Extent, LLE, Meters, PoleSides, Radians};
use navara_math::{FloatType, Vec3};

use crate::Geometry;

/// Append height-zero polar caps to the separate skirt buffers, after skirts.
/// Main-grid seam indices are shared; pinned UVs must never enter upsample data.
pub fn add_pole_extension(
    geometry: &mut Geometry,
    ellipsoid: Ellipsoid<FloatType>,
    extent: &Extent<FloatType, Radians>,
    rtc_translation: Vec3,
    sides: PoleSides,
) {
    for (enabled, north) in [(sides.north, true), (sides.south, false)] {
        if !enabled {
            continue;
        }
        let v = if north { 1.0 } else { 0.0 };
        let sign = if north { 1.0 } else { -1.0 };
        let mut boundary: Vec<_> = geometry
            .uvs
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
            .filter(|(_, uv)| uv[1] == v)
            .map(|(i, uv)| (uv[0], i as u32))
            .collect();
        boundary.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
        boundary.dedup_by(|a, b| a.0 == b.0);
        assert!(
            boundary.len() >= 2,
            "polar boundary needs at least two columns"
        );

        let main_count = geometry.vertices.len() / 3;
        let vertices = geometry.skirt_vertices.get_or_insert_default();
        let uvs = geometry.skirt_uvs.get_or_insert_default();
        let indices = geometry.skirt_indices.get_or_insert_default();
        let mut normals = if geometry.normals.is_some() {
            Some(geometry.skirt_normals.get_or_insert_default())
        } else {
            None
        };
        let mut append_vertex = |u: f32, latitude: f64| {
            let index = (main_count + vertices.len() / 3) as u32;
            let longitude = if latitude.abs() == 90.0 {
                0.0
            } else if u == 1.0 {
                extent.east.val()
            } else {
                extent.west.val() + (extent.east.val() - extent.west.val()) * u as f64
            };
            let lle = LLE {
                lng: Angle::new(longitude),
                lat: Angle::new(latitude.to_radians()),
                height: Meters::new(0.),
            };
            let xyz = lle.to_xyz(ellipsoid);
            vertices.extend_from_slice(&[
                (xyz.x.val() - rtc_translation.x) as f32,
                (xyz.y.val() - rtc_translation.y) as f32,
                (xyz.z.val() - rtc_translation.z) as f32,
            ]);
            uvs.extend_from_slice(&[u, v]);
            if let Some(normals) = &mut normals {
                let n = ellipsoid.geodetic_surface_normal_from_lle(lle);
                normals.extend_from_slice(&[n.x.val() as f32, n.y.val() as f32, n.z.val() as f32]);
            }
            index
        };
        let mut triangle = |a, b, c| {
            indices.extend_from_slice(&if north { [a, b, c] } else { [b, a, c] });
        };
        let mut previous: Vec<_> = boundary.iter().map(|&(_, i)| i).collect();
        for latitude in [86.0, 87.0, 88.0, 89.0, 89.6] {
            let row: Vec<_> = boundary
                .iter()
                .map(|&(u, _)| append_vertex(u, sign * latitude))
                .collect();
            for i in 0..row.len() - 1 {
                triangle(previous[i], previous[i + 1], row[i]);
                triangle(previous[i + 1], row[i + 1], row[i]);
            }
            previous = row;
        }
        let pole = append_vertex(0.5, sign * 90.0);
        for pair in previous.windows(2) {
            triangle(pair[0], pair[1], pole);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        UpsamplableTerrainGeometry, UpsampledTerrainGeometry, add_skirt_separate,
        tile_triangles_flat,
    };
    use navara_core::{TileRegion, TileXYZ, TilingScheme, WGS84_64};

    fn extent(x: usize, y: usize, z: usize) -> Extent<f64, Radians> {
        TilingScheme::default().tile_extent(TileXYZ { x, y, z })
    }

    fn check_cap(geometry: &Geometry, first_index: usize, v: f32, center: Vec3) {
        let main_count = geometry.vertices.len() / 3;
        let mut positions = geometry.vertices.clone();
        positions.extend(geometry.skirt_vertices.as_ref().unwrap());
        let indices = &geometry.skirt_indices.as_ref().unwrap()[first_index..];
        let mut seam = std::collections::BTreeSet::new();
        for triangle in indices.as_chunks::<3>().0 {
            let points: Vec<_> = triangle
                .iter()
                .map(|&i| {
                    if (i as usize) < main_count {
                        assert_eq!(geometry.uvs[i as usize * 2 + 1], v);
                        seam.insert(i);
                    }
                    let p = &positions[i as usize * 3..][..3];
                    Vec3::new(p[0] as f64, p[1] as f64, p[2] as f64) + center
                })
                .collect();
            let normal = (points[1] - points[0]).cross(points[2] - points[0]);
            assert!(normal.dot(points[0]) > 0., "degenerate or inward triangle");
        }
        let expected: std::collections::BTreeSet<_> = geometry
            .uvs
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
            .filter(|(_, uv)| uv[1] == v)
            .map(|(i, _)| i as u32)
            .collect();
        assert_eq!(seam, expected);
    }

    #[test]
    fn shares_seams_and_appends_after_skirts_with_normals() {
        for (y, v) in [(0, 1.), (3, 0.)] {
            let e = extent(1, y, 2);
            let (mut g, center) = tile_triangles_flat(WGS84_64, &e, 8, 120., true);
            g.normals = Some(vec![1.; g.vertices.len()]);
            let main = g.clone();
            add_skirt_separate(&mut g, 50., &|_, _| [0., 0., -1.]);
            let skirt = g.clone();
            let first = g.skirt_indices.as_ref().unwrap().len();
            let first_vertex = g.skirt_vertices.as_ref().unwrap().len();
            add_pole_extension(
                &mut g,
                WGS84_64,
                &e,
                center,
                PoleSides::from_extent(&TilingScheme::default(), &e),
            );
            assert_eq!(g.vertices, main.vertices);
            assert_eq!(g.uvs, main.uvs);
            assert_eq!(g.indices, main.indices);
            assert_eq!(
                &g.skirt_vertices.as_ref().unwrap()[..first_vertex],
                skirt.skirt_vertices.as_ref().unwrap()
            );
            assert_eq!(
                g.skirt_normals.as_ref().unwrap().len(),
                g.skirt_vertices.as_ref().unwrap().len()
            );
            assert!(
                g.skirt_uvs.as_ref().unwrap()[first_vertex / 3 * 2..]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .all(|uv| uv[1] == v)
            );
            for n in g.skirt_normals.as_ref().unwrap()[first_vertex..]
                .as_chunks::<3>()
                .0
            {
                assert!((n.iter().map(|v| v * v).sum::<f32>() - 1.).abs() < 1e-6);
            }
            check_cap(&g, first, v, center);
        }
    }

    #[test]
    fn root_closes_both_poles_and_nonpolar_tiles_are_unchanged() {
        let e = extent(0, 0, 0);
        let (mut g, center) = tile_triangles_flat(WGS84_64, &e, 32, 0., true);
        add_pole_extension(
            &mut g,
            WGS84_64,
            &e,
            center,
            PoleSides::from_extent(&TilingScheme::default(), &e),
        );
        let vertices_per_cap = 5 * 33 + 1;
        assert_eq!(
            g.skirt_vertices.as_ref().unwrap().len(),
            vertices_per_cap * 2 * 3
        );
        let cap_indices = (5 * 32 * 2 + 32) * 3;
        let mut north = g.clone();
        north.skirt_indices.as_mut().unwrap().truncate(cap_indices);
        check_cap(&north, 0, 1., center);
        check_cap(&g, cap_indices, 0., center);
        let before = g.clone();
        add_pole_extension(&mut g, WGS84_64, &e, center, PoleSides::default());
        assert_eq!(g, before);
    }

    #[test]
    fn mixed_zoom_neighbors_share_meridian_ladder() {
        for (coarse_y, fine_y) in [(0, 0), (3, 7)] {
            let mut meridians = Vec::new();
            for (e, u) in [(extent(1, coarse_y, 2), 1.), (extent(4, fine_y, 3), 0.)] {
                let (mut g, _) = tile_triangles_flat(WGS84_64, &e, 4, 0., true);
                // A common RTC origin isolates exact ECEF construction from f32 RTC rounding.
                add_pole_extension(
                    &mut g,
                    WGS84_64,
                    &e,
                    Vec3::ZERO,
                    PoleSides::from_extent(&TilingScheme::default(), &e),
                );
                let points: Vec<_> = g
                    .skirt_vertices
                    .unwrap()
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .zip(g.skirt_uvs.unwrap().as_chunks::<2>().0.iter())
                    .filter(|(_, uv)| uv[0] == u)
                    .map(|(p, _)| p.to_vec())
                    .collect();
                meridians.push(points);
            }
            assert_eq!(meridians[0].len(), 5);
            assert_eq!(meridians[0], meridians[1]);
        }
    }

    #[test]
    fn upsampled_child_gets_its_own_cap() {
        let parent_extent = extent(1, 0, 2);
        let child_extent = extent(2, 0, 3);
        let (mut parent, center) = tile_triangles_flat(WGS84_64, &parent_extent, 8, 50., true);
        add_pole_extension(
            &mut parent,
            WGS84_64,
            &parent_extent,
            center,
            PoleSides {
                north: true,
                south: false,
            },
        );
        let heights = vec![50.; parent.vertices.len() / 3];
        let mut child = UpsampledTerrainGeometry::new(
            UpsamplableTerrainGeometry {
                uvs: &parent.uvs,
                heights: &heights,
                indices: &parent.indices,
                normals: None,
                watermask: None,
            },
            &TileRegion::NorthWest,
        );
        let (mut g, child_heights) =
            child.construct_geometry(WGS84_64, &child_extent, &center, true);
        assert!(g.skirt_vertices.is_none());
        let before = g.clone();
        add_pole_extension(
            &mut g,
            WGS84_64,
            &child_extent,
            center,
            PoleSides {
                north: true,
                south: false,
            },
        );
        assert_eq!(g.vertices, before.vertices);
        assert_eq!(g.vertices.len() / 3, child_heights.len());
        check_cap(&g, 0, 1., center);
    }
}
