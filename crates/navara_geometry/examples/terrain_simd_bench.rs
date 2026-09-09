//! WASM benchmark of the production terrain path. Run with
//! `node scripts/bench-terrain-simd.mjs`; no exports enter the shipped engine.
use navara_core::{
    Aabb, Angle, CRS, ElevationDecoder, Extent, JAPAN_GSI_ELEVATION_DECODER, LLE,
    MAPBOX_ELEVATION_DECODER, Meters, Radians, TERRARIUM_ELEVATION_DECODER, WGS84_64,
};
use navara_geometry::{
    PolylineGeometry, PolylineGeometryOptions, ReturnedConstructedTerrainMesh,
    create_polyline_geometry, decode_height_from_dem, mercator_y, mercator_y_to_lat,
    tile_triangles_with_terrain,
};
use std::hint::black_box;
use wasm_bindgen::prelude::*;

fn decoder(kind: u32) -> ElevationDecoder {
    match kind {
        0 => MAPBOX_ELEVATION_DECODER,
        1 => TERRARIUM_ELEVATION_DECODER,
        _ => JAPAN_GSI_ELEVATION_DECODER,
    }
}

fn pixels() -> Vec<u8> {
    let mut state = 42_u32;
    (0..256 * 256 * 4)
        .map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (state >> 24) as u8
        })
        .collect()
}

#[wasm_bindgen]
pub fn bench_decode(kind: u32, iterations: u32) -> f64 {
    let pixels = pixels();
    let decoder = black_box(decoder(kind));
    let mut heights = vec![0.; pixels.len() / 4];
    for _ in 0..iterations {
        for (pixel, height) in black_box(&pixels)
            .as_chunks::<4>()
            .0
            .iter()
            .zip(&mut heights)
        {
            *height = decode_height_from_dem(
                pixel[0] as i64,
                pixel[1] as i64,
                pixel[2] as i64,
                12.5,
                &decoder,
            );
        }
        black_box(&heights);
    }
    heights.iter().sum()
}

#[wasm_bindgen]
pub fn bench_mesh(kind: u32, iterations: u32) -> f64 {
    let pixels = pixels();
    let decoder = black_box(decoder(kind));
    let mut checksum = 0.;
    for _ in 0..iterations {
        let mesh = mesh(black_box(&pixels), &decoder);
        checksum = mesh
            .geometry
            .vertices
            .iter()
            .map(|&v| v as f64)
            .sum::<f64>()
            + mesh.heights.iter().map(|&h| h as f64).sum::<f64>()
            + mesh.min_height
            + mesh.max_height;
        black_box(mesh);
    }
    checksum
}

fn mesh(pixels: &[u8], decoder: &ElevationDecoder) -> ReturnedConstructedTerrainMesh {
    let extent = Extent {
        west: Angle::new(0.50),
        south: Angle::new(0.52),
        east: Angle::new(0.51),
        north: Angle::new(0.53),
    };
    tile_triangles_with_terrain(
        WGS84_64,
        black_box(&extent),
        64,
        12.5,
        pixels,
        256,
        256,
        decoder,
        9000.,
        true,
    )
}

/// Compare complete outputs outside the timed region, including DEM boundary cases.
#[wasm_bindgen]
pub fn verify_output(kind: u32) -> Vec<f64> {
    let decoder = decoder(kind);
    let mesh = mesh(&pixels(), &decoder);
    let mut output: Vec<f64> = mesh.geometry.vertices.iter().map(|&v| v as f64).collect();
    output.extend(mesh.geometry.uvs.iter().map(|&v| v as f64));
    output.extend(mesh.geometry.indices.iter().map(|&v| v as f64));
    output.extend(mesh.heights.iter().map(|&v| v as f64));
    output.extend([mesh.min_height, mesh.max_height]);
    output.extend(mesh.rtc_translation.unwrap().to_array());
    // Zero, Mapbox's boundary and neighbors, GSI's boundary and neighbors,
    // maximum RGB, and Terrarium's sea-level encoding. Preserve current semantics.
    for rgb in [
        0_u32,
        9999,
        10000,
        10001,
        8388607,
        8388608,
        8388609,
        16777215,
        32768 << 8,
    ] {
        output.push(decode_height_from_dem(
            ((rgb >> 16) & 255) as i64,
            ((rgb >> 8) & 255) as i64,
            (rgb & 255) as i64,
            12.5,
            &decoder,
        ));
    }
    output
}

// ---------------------------------------------------------------------------
// Workloads beyond terrain. Static analysis of the shipped modules (see
// guide/SIMD.md) showed the vector instructions that actually carry lane math
// land in the polyline builder and in `miniz_oxide`'s inflate loop, not in the
// terrain path. These measure those two, plus a prototype that hoists the
// per-row/per-column transcendentals out of the terrain vertex loop, to size
// the scalar alternative against SIMD.
// ---------------------------------------------------------------------------

/// A polyline long enough to dominate the fixed setup cost, in radians.
fn polyline_positions() -> Vec<LLE<f64, Radians>> {
    (0..2048)
        .map(|i| {
            let t = i as f64 / 2048.;
            LLE {
                lng: Angle::new(0.50 + t * 0.40),
                lat: Angle::new(0.52 + (t * 12.).sin() * 0.05),
                height: Meters::new(100. + (t * 30.).cos() * 50.),
            }
        })
        .collect()
}

fn polyline() -> PolylineGeometry {
    create_polyline_geometry(
        WGS84_64,
        PolylineGeometryOptions {
            positions: black_box(polyline_positions()),
            granularity: 9999.,
            crs: CRS::Geographic,
            clamp_to_ground: false,
            use_rte: true,
        },
    )
    .expect("polyline geometry")
}

#[wasm_bindgen]
pub fn bench_polyline(_kind: u32, iterations: u32) -> f64 {
    let mut checksum = 0.;
    for _ in 0..iterations {
        let geometry = polyline();
        checksum = polyline_checksum(&geometry);
        black_box(&geometry);
    }
    checksum
}

fn polyline_checksum(geometry: &PolylineGeometry) -> f64 {
    geometry
        .attributes
        .position
        .data
        .iter()
        .map(|&v| v as f64)
        .sum::<f64>()
        + geometry.indices.iter().map(|&i| i as f64).sum::<f64>()
}

/// Gzip payload shaped like a vector tile: repeated structure with varying
/// bytes, so inflate spends its time in both literal and match copies.
fn gzip_payload() -> Vec<u8> {
    use flate2::{Compression, write::GzEncoder};
    use std::io::Write;
    let mut raw = Vec::with_capacity(1 << 20);
    let mut state = 7_u32;
    while raw.len() < (1 << 20) {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let run = 4 + (state >> 28) as usize;
        let byte = (state >> 16) as u8;
        raw.extend(std::iter::repeat_n(byte, run));
        raw.extend_from_slice(b"\x1a\x08\x01\x12\x04\x08\x01\x10");
    }
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&raw).expect("gzip write");
    encoder.finish().expect("gzip finish")
}

#[wasm_bindgen]
pub fn bench_inflate(_kind: u32, iterations: u32) -> f64 {
    use flate2::read::GzDecoder;
    use std::io::Read;
    let payload = gzip_payload();
    let mut checksum = 0.;
    for _ in 0..iterations {
        let mut output = Vec::new();
        GzDecoder::new(black_box(&payload[..]))
            .read_to_end(&mut output)
            .expect("gzip read");
        checksum = output.len() as f64;
        black_box(&output);
    }
    checksum
}

/// Same vertex math as `tile_triangles`, with `mercator_y_to_lat` and the
/// per-vertex `sin`/`cos` pairs hoisted to per-row and per-column tables. The
/// arithmetic is unchanged, so outputs stay bit-identical; only the number of
/// transcendental calls differs (O(n) instead of O(n^2)).
struct HoistedMesh {
    vertices: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
    heights: Vec<f32>,
    min_height: f64,
    max_height: f64,
}

fn mesh_hoisted(pixels: &[u8], decoder: &ElevationDecoder) -> HoistedMesh {
    let (west, south, east, north) = (0.50_f64, 0.52_f64, 0.51_f64, 0.53_f64);
    let segments = 64_usize;
    let (terrain_w, terrain_h) = (256_usize, 256_usize);
    let geoid_height = 12.5_f64;

    // Every input here is a literal, so without `black_box` LLVM folds the whole
    // row/column table at compile time — using the *host* libm, which both
    // removes the work being measured and shifts a vertex by an ULP against the
    // wasm libm the production path calls at runtime.
    let extent = black_box(Extent {
        west: Angle::new(west),
        south: Angle::new(south),
        east: Angle::new(east),
        north: Angle::new(north),
    });
    let center = Aabb::from_extent_f64(extent, 0., 9000.).center;

    let merc_south = mercator_y(extent.south.val());
    let merc_north = mercator_y(extent.north.val());
    // Per-row: one exp+atan and one sin/cos pair instead of one per vertex.
    // Angles go through `radians::Angle` exactly as `tile_triangles` does —
    // its `Add` wraps, so raw `f64` arithmetic here would shift a vertex by an
    // ULP and stop this from being a like-for-like comparison.
    let rows: Vec<(f64, f64)> = (0..=segments)
        .map(|j| {
            let f = j as f64 / segments as f64;
            let lat: Angle<f64, Radians> = Angle::new(mercator_y_to_lat(
                merc_south + (merc_north - merc_south) * f,
            ));
            (lat.sin(), lat.cos())
        })
        .collect();
    // `Angle / f64` and `Angle * f64` keep this in the same units and rounding
    // as `tile_triangles`.
    let dlng = (extent.east - extent.west) / segments as f64;
    let columns: Vec<(f64, f64)> = (0..=segments)
        .map(|i| {
            let lng = extent.west + dlng * i as f64;
            (lng.sin(), lng.cos())
        })
        .collect();

    let a = WGS84_64.semi_major_axis();
    let e2 = WGS84_64.eccentricity_squared();
    // Build every output `tile_triangles` builds, so the only difference from
    // the production path is where the transcendentals are evaluated.
    let vertices_count = (segments + 1) * (segments + 1);
    let mut vertices = Vec::with_capacity(vertices_count * 3);
    let mut uvs = Vec::with_capacity(vertices_count * 2);
    let mut indices = Vec::with_capacity(segments * segments * 6);
    let mut heights = Vec::with_capacity(vertices_count);
    let (mut min_height, mut max_height) = (9999_f64, 0_f64);
    for (i, &(sin_lng, cos_lng)) in columns.iter().enumerate() {
        for (j, &(sin_lat, cos_lat)) in rows.iter().enumerate() {
            let image_x = i * (terrain_w - 1) / segments;
            let image_y = (terrain_h - 1) - j * (terrain_h - 1) / segments;
            let k = (image_y * terrain_w + image_x) * 4;
            let h = decode_height_from_dem(
                pixels[k] as i64,
                pixels[k + 1] as i64,
                pixels[k + 2] as i64,
                geoid_height,
                decoder,
            );
            max_height = max_height.max(h);
            min_height = min_height.min(h);
            heights.push(h as f32);

            let n = a / (1. - e2 * sin_lat.powi(2)).sqrt();
            vertices.push(((n + h) * cos_lat * cos_lng - center.x) as f32);
            vertices.push(((n + h) * cos_lat * sin_lng - center.y) as f32);
            vertices.push(((n * (1. - e2) + h) * sin_lat - center.z) as f32);

            uvs.push(i as f32 / segments as f32);
            uvs.push(j as f32 / segments as f32);

            if i != segments && j != segments {
                let p = i * (segments + 1) + j;
                let q = (i + 1) * (segments + 1) + j;
                indices.extend([
                    p as u32,
                    q as u32,
                    (p + 1) as u32,
                    q as u32,
                    (q + 1) as u32,
                    (p + 1) as u32,
                ]);
            }
        }
    }
    HoistedMesh {
        vertices,
        uvs,
        indices,
        heights,
        min_height,
        max_height,
    }
}

#[wasm_bindgen]
pub fn bench_mesh_hoisted(kind: u32, iterations: u32) -> f64 {
    let pixels = pixels();
    let decoder = black_box(decoder(kind));
    let mut checksum = 0.;
    for _ in 0..iterations {
        let mesh = mesh_hoisted(black_box(&pixels), &decoder);
        checksum = mesh.vertices.iter().map(|&v| v as f64).sum::<f64>()
            + mesh.heights.iter().map(|&h| h as f64).sum::<f64>()
            + mesh.min_height
            + mesh.max_height;
        black_box(mesh);
    }
    checksum
}

/// Outputs of the extra workloads, compared across variants outside timing.
/// The hoisted prototype is also compared against the production vertex order
/// so the timing above is not measuring a different computation.
#[wasm_bindgen]
pub fn verify_extra(kind: u32) -> Vec<f64> {
    let decoder = decoder(kind);
    let pixels = pixels();

    let production = mesh(&pixels, &decoder);
    let hoisted = mesh_hoisted(&pixels, &decoder);
    assert_eq!(
        production.geometry.vertices, hoisted.vertices,
        "hoisted terrain prototype diverged from tile_triangles"
    );
    assert_eq!(production.geometry.uvs, hoisted.uvs);
    assert_eq!(production.geometry.indices, hoisted.indices);
    assert_eq!(production.heights, hoisted.heights);
    assert_eq!(production.min_height, hoisted.min_height);
    assert_eq!(production.max_height, hoisted.max_height);

    let mut output = vec![polyline_checksum(&polyline())];
    output.push(bench_inflate(kind, 1));
    output.extend(hoisted.vertices.iter().map(|&v| v as f64));
    output
}
