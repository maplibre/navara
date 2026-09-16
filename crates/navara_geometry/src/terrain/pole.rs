use navara_core::{Angle, Ellipsoid, Extent, LLE, Meters, PoleSides, Radians};
use navara_math::{FloatType, Vec3};

use crate::{Geometry, compute_boundary_edges};

/// |Latitude| of the intermediate cap rings, in degrees.
///
/// This is two schedules spliced together. 86..89 is a *curvature* schedule:
/// the chord between 1°-spaced rings sags ~244 m below the ellipsoid, against
/// ~5,967 m for a single span from the Web Mercator seam (±85.05113°) straight
/// to the pole — deeper than Everest is tall, and enough to punch through
/// neighbouring terrain. 89.6 is a *fan-convergence* step, confining the apex
/// triangles' pinwheel `u` interpolation to the innermost ring instead of
/// smearing it over the cap's full ~550 km.
const RING_LATITUDES: [f64; 5] = [86.0, 87.0, 88.0, 89.0, 89.6];

/// Append height-zero polar caps to the separate skirt buffers, after skirts.
///
/// The radial cap/grid seam is bit-exact because the main-grid seam indices are
/// shared; pinned UVs must never enter upsample data.
///
/// The wedge's two meridian edges share nothing, though. Every polar tile
/// builds its own full-length wedge in its own RTC frame, and `rtc_translation`
/// leaves the pole ~553 km from the origin of any tile at z >= 8, where the f32
/// ulp is 6.25 cm. Neighbouring wedges therefore disagree by ~1-2 cm along the
/// shared meridian and at the apex, which reads as radial cracks converging on
/// the pole. Exact agreement is impossible across different RTC frames, so
/// `seam_skirt_height` hangs a curtain down those two edges — the wedges
/// overlap instead of abutting, the same way the grid skirt hides the identical
/// disagreement at ordinary tile boundaries.
pub fn add_pole_extension(
    geometry: &mut Geometry,
    ellipsoid: Ellipsoid<FloatType>,
    extent: &Extent<FloatType, Radians>,
    rtc_translation: Vec3,
    sides: PoleSides,
    seam_skirt_height: f32,
) {
    for (enabled, north) in [(sides.north, true), (sides.south, false)] {
        if !enabled {
            continue;
        }
        let v = if north { 1.0 } else { 0.0 };
        let sign = if north { 1.0 } else { -1.0 };
        let seam_latitude = if north { extent.north } else { extent.south };
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
        let with_normals = geometry.normals.is_some();
        // Cap indices use the final combined numbering the web side assembles:
        // main grid first, then the whole skirt buffer (grid skirt, then cap).
        let base = main_count + geometry.skirt_vertices.as_ref().map_or(0, |b| b.len()) / 3;

        let longitude_of = |u: f32| {
            if u == 1.0 {
                extent.east.val()
            } else {
                extent.west.val() + (extent.east.val() - extent.west.val()) * u as f64
            }
        };

        let mut vertices: Vec<f32> = Vec::new();
        let mut uvs: Vec<f32> = Vec::new();
        // Geodetic surface normals for every cap vertex. Always built, even
        // when the geometry carries no normal attribute: the curtain needs them
        // as its "down" direction.
        let mut normals: Vec<f32> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();

        {
            let mut append_vertex = |u: f32, latitude: f64| {
                let index = (base + vertices.len() / 3) as u32;
                let longitude = if latitude.abs() == 90.0 {
                    0.0
                } else {
                    longitude_of(u)
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
                let n = ellipsoid.geodetic_surface_normal_from_lle(lle);
                normals.extend_from_slice(&[n.x.val() as f32, n.y.val() as f32, n.z.val() as f32]);
                index
            };
            let mut triangle = |a, b, c| {
                indices.extend_from_slice(&if north { [a, b, c] } else { [b, a, c] });
            };
            let mut previous: Vec<_> = boundary.iter().map(|&(_, i)| i).collect();
            for latitude in RING_LATITUDES {
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

        // Hang a curtain down the wedge's meridian edges. `compute_boundary_edges`
        // orients each boundary edge by the triangle that owns it, so reusing
        // `generate_skirt`'s index pattern below keeps the curtain facing
        // outward without re-deriving the winding per pole side.
        let mut curtain_vertices: Vec<f32> = Vec::new();
        let mut curtain_uvs: Vec<f32> = Vec::new();
        let mut curtain_normals: Vec<f32> = Vec::new();
        let mut curtain_indices: Vec<u32> = Vec::new();
        {
            let cap_count = vertices.len() / 3;
            let position_of = |i: u32| {
                let (buf, slot) = if (i as usize) < main_count {
                    (&geometry.vertices, i as usize)
                } else {
                    (&vertices, i as usize - base)
                };
                let o = slot * 3;
                [buf[o], buf[o + 1], buf[o + 2]]
            };
            let uv_of = |i: u32| {
                let (buf, slot) = if (i as usize) < main_count {
                    (&geometry.uvs, i as usize)
                } else {
                    (&uvs, i as usize - base)
                };
                let o = slot * 2;
                [buf[o], buf[o + 1]]
            };
            // A seam vertex carries terrain height, but the geodetic surface
            // normal depends only on lat/lng, so it is reconstructible from the
            // seam latitude and the column's `u` even when the main geometry
            // has no normal attribute.
            let normal_of = |i: u32| {
                if (i as usize) >= main_count {
                    let o = (i as usize - base) * 3;
                    return [normals[o], normals[o + 1], normals[o + 2]];
                }
                let n = ellipsoid.geodetic_surface_normal_from_lle(LLE {
                    lng: Angle::new(longitude_of(geometry.uvs[i as usize * 2])),
                    lat: seam_latitude,
                    height: Meters::new(0.),
                });
                [n.x.val() as f32, n.y.val() as f32, n.z.val() as f32]
            };

            let mut hung = 0u32;
            for edge in compute_boundary_edges(&indices) {
                // The rest of the cap's boundary is the seam row, which shares
                // the main grid's vertices and so is already sealed.
                if (edge.v0 as usize) < main_count && (edge.v1 as usize) < main_count {
                    continue;
                }
                for i in [edge.v0, edge.v1] {
                    let p = position_of(i);
                    let n = normal_of(i);
                    curtain_vertices.extend_from_slice(&[
                        p[0] - n[0] * seam_skirt_height,
                        p[1] - n[1] * seam_skirt_height,
                        p[2] - n[2] * seam_skirt_height,
                    ]);
                    curtain_uvs.extend_from_slice(&uv_of(i));
                    curtain_normals.extend_from_slice(&n);
                }
                let hung0 = (base + cap_count) as u32 + hung;
                let hung1 = hung0 + 1;
                hung += 2;
                curtain_indices.extend_from_slice(&[edge.v0, hung1, edge.v1]);
                curtain_indices.extend_from_slice(&[edge.v0, hung0, hung1]);
            }
        }

        let skirt_vertices = geometry.skirt_vertices.get_or_insert_default();
        skirt_vertices.extend_from_slice(&vertices);
        skirt_vertices.extend_from_slice(&curtain_vertices);
        let skirt_uvs = geometry.skirt_uvs.get_or_insert_default();
        skirt_uvs.extend_from_slice(&uvs);
        skirt_uvs.extend_from_slice(&curtain_uvs);
        let skirt_indices = geometry.skirt_indices.get_or_insert_default();
        skirt_indices.extend_from_slice(&indices);
        skirt_indices.extend_from_slice(&curtain_indices);
        if with_normals {
            let skirt_normals = geometry.skirt_normals.get_or_insert_default();
            skirt_normals.extend_from_slice(&normals);
            skirt_normals.extend_from_slice(&curtain_normals);
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

    /// Cap surface triangles per pole for an `n`-segment grid: five ladder rows
    /// of quads, then the apex fan.
    fn surface_triangles(n: usize) -> usize {
        RING_LATITUDES.len() * n * 2 + n
    }

    /// Cap vertices per pole, excluding the curtain: one ring per ladder row
    /// plus the apex.
    fn surface_vertices(n: usize) -> usize {
        RING_LATITUDES.len() * (n + 1) + 1
    }

    /// Curtain triangles per pole: two quads' worth per meridian edge, over the
    /// ladder rows plus the apex edge, on each of the two meridians.
    fn curtain_triangles() -> usize {
        (RING_LATITUDES.len() + 1) * 2 * 2
    }

    const SKIRT: f32 = 50.;

    fn extent(x: usize, y: usize, z: usize) -> Extent<f64, Radians> {
        TilingScheme::default().tile_extent(TileXYZ { x, y, z })
    }

    /// Assert the cap surface is outward-facing and shares exactly the main
    /// grid's seam row, and that the curtain hangs below that surface.
    fn check_cap(geometry: &Geometry, first_index: usize, v: f32, center: Vec3) {
        let main_count = geometry.vertices.len() / 3;
        // Distinct seam columns, matching the dedup in `add_pole_extension`.
        // Derived rather than passed: an upsampled child's grid is coarser than
        // the parent it was built from.
        let mut columns: Vec<f32> = geometry
            .uvs
            .as_chunks::<2>()
            .0
            .iter()
            .filter(|uv| uv[1] == v)
            .map(|uv| uv[0])
            .collect();
        columns.sort_unstable_by(|a, b| a.total_cmp(b));
        columns.dedup();
        let n = columns.len() - 1;
        let mut positions = geometry.vertices.clone();
        positions.extend(geometry.skirt_vertices.as_ref().unwrap());
        let point = |i: u32| {
            let p = &positions[i as usize * 3..][..3];
            Vec3::new(p[0] as f64, p[1] as f64, p[2] as f64) + center
        };
        let all = &geometry.skirt_indices.as_ref().unwrap()[first_index..];
        let (surface, curtain) = all.split_at(surface_triangles(n) * 3);

        let mut seam = std::collections::BTreeSet::new();
        for triangle in surface.as_chunks::<3>().0 {
            let points: Vec<_> = triangle
                .iter()
                .map(|&i| {
                    if (i as usize) < main_count {
                        assert_eq!(geometry.uvs[i as usize * 2 + 1], v);
                        seam.insert(i);
                    }
                    point(i)
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

        // The curtain must hang inward: every hung vertex sits closer to the
        // ellipsoid centre than the edge vertex it was displaced from, by the
        // skirt height. That is what turns a neighbour's cm-scale RTC
        // disagreement into an overlap instead of a crack.
        assert_eq!(curtain.len(), curtain_triangles() * 3);
        let mut hung_seen = 0;
        for triangle in curtain.as_chunks::<3>().0 {
            let mut depths: Vec<_> = triangle.iter().map(|&i| point(i).length()).collect();
            depths.sort_by(|a, b| a.total_cmp(b));
            assert!(
                depths[depths.len() - 1] - depths[0] > SKIRT as f64 * 0.5,
                "curtain triangle is not hanging below the cap surface"
            );
            hung_seen += 1;
        }
        assert_eq!(hung_seen, curtain_triangles());
    }

    #[test]
    fn shares_seams_and_appends_after_skirts_with_normals() {
        for (y, v) in [(0, 1.), (3, 0.)] {
            let e = extent(1, y, 2);
            let (mut g, center) = tile_triangles_flat(WGS84_64, &e, 8, 120., true);
            g.normals = Some(vec![1.; g.vertices.len()]);
            let main = g.clone();
            add_skirt_separate(&mut g, SKIRT, &|_, _| [0., 0., -1.]);
            let skirt = g.clone();
            let first = g.skirt_indices.as_ref().unwrap().len();
            let first_vertex = g.skirt_vertices.as_ref().unwrap().len();
            add_pole_extension(
                &mut g,
                WGS84_64,
                &e,
                center,
                PoleSides::from_extent(&TilingScheme::default(), &e),
                SKIRT,
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
            SKIRT,
        );
        let per_cap = surface_vertices(32) + curtain_triangles() / 2 * 2;
        assert_eq!(
            g.skirt_vertices.as_ref().unwrap().len(),
            per_cap * 2 * 3,
            "each cap contributes its surface vertices plus two hung vertices per curtain edge"
        );
        let cap_indices = (surface_triangles(32) + curtain_triangles()) * 3;
        let mut north = g.clone();
        north.skirt_indices.as_mut().unwrap().truncate(cap_indices);
        check_cap(&north, 0, 1., center);
        check_cap(&g, cap_indices, 0., center);
        let before = g.clone();
        add_pole_extension(&mut g, WGS84_64, &e, center, PoleSides::default(), SKIRT);
        assert_eq!(g, before);
    }

    #[test]
    fn mixed_zoom_neighbors_share_meridian_ladder() {
        for (coarse_y, fine_y) in [(0, 0), (3, 7)] {
            let mut meridians = Vec::new();
            for (e, u) in [(extent(1, coarse_y, 2), 1.), (extent(4, fine_y, 3), 0.)] {
                let (mut g, _) = tile_triangles_flat(WGS84_64, &e, 4, 0., true);
                // A common RTC origin isolates exact ECEF construction from f32
                // RTC rounding. The divergence that rounding causes between
                // real per-tile frames is what the curtain exists to hide, and
                // is measured in `neighbor_frames_diverge_within_curtain`.
                add_pole_extension(
                    &mut g,
                    WGS84_64,
                    &e,
                    Vec3::ZERO,
                    PoleSides::from_extent(&TilingScheme::default(), &e),
                    SKIRT,
                );
                // Only the cap surface: the curtain duplicates these UVs at a
                // hung position by design.
                let surface = surface_vertices(4) * 3;
                let points: Vec<_> = g.skirt_vertices.unwrap()[..surface]
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .zip(g.skirt_uvs.unwrap()[..surface / 3 * 2].as_chunks::<2>().0)
                    .filter(|(_, uv)| uv[0] == u)
                    .map(|(p, _)| p.to_vec())
                    .collect();
                meridians.push(points);
            }
            assert_eq!(meridians[0].len(), RING_LATITUDES.len());
            assert_eq!(meridians[0], meridians[1]);
        }
    }

    /// The bug the curtain fixes: two neighbouring polar tiles place the same
    /// logical apex at different f32 positions because each subtracts its own
    /// RTC origin, and the pole is ~553 km from both. The disagreement must be
    /// non-zero (otherwise the curtain is unnecessary) and far smaller than the
    /// curtain depth (otherwise the curtain does not cover it).
    #[test]
    fn neighbor_frames_diverge_within_curtain() {
        let mut apexes = Vec::new();
        for x in [4, 5] {
            let e = extent(x, 0, 3);
            let (mut g, center) = tile_triangles_flat(WGS84_64, &e, 4, 0., true);
            add_pole_extension(
                &mut g,
                WGS84_64,
                &e,
                center,
                PoleSides::from_extent(&TilingScheme::default(), &e),
                SKIRT,
            );
            // The apex is the last vertex of the cap surface.
            let apex = (surface_vertices(4) - 1) * 3;
            let p = &g.skirt_vertices.as_ref().unwrap()[apex..][..3];
            apexes.push(Vec3::new(p[0] as f64, p[1] as f64, p[2] as f64) + center);
        }
        let gap = (apexes[0] - apexes[1]).length();
        assert!(gap > 0., "expected f32 RTC divergence between tile frames");
        assert!(
            gap < SKIRT as f64,
            "curtain depth {SKIRT} must cover the {gap} m apex divergence"
        );
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
            SKIRT,
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
            SKIRT,
        );
        assert_eq!(g.vertices, before.vertices);
        assert_eq!(g.vertices.len() / 3, child_heights.len());
        check_cap(&g, 0, 1., center);
    }
}
