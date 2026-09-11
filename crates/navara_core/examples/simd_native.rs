//! Native CPU benchmark of production Rust APIs with deterministic mock data.
//! Run through `node scripts/bench-simd-native.mjs`; no WASM or JS timing.
use navara_core::{Aabb, EncodedVec3, LLE, Plane, WGS84_64};
use navara_math::{Quat, Transform, Vec3};
use std::{hint::black_box, time::Instant};

const ITEMS: usize = 16_384;

// Stable symbols make the optimized LLVM IR and assembly easy to inspect.
// The batch loops are mock workloads; the operations inside are production APIs.
#[unsafe(no_mangle)]
#[inline(never)]
pub fn bench_planes(input: &[Vec3], output: &mut [f64]) {
    let normal = Vec3::new(0.36, 0.48, 0.8);
    for (point, out) in input.iter().zip(output.as_chunks_mut::<4>().0.iter_mut()) {
        let plane = Plane::from_point_normal(*point, normal);
        out.copy_from_slice(&[
            plane.normal.x as f64,
            plane.normal.y as f64,
            plane.normal.z as f64,
            plane.distance,
        ]);
    }
}

#[unsafe(no_mangle)]
#[inline(never)]
pub fn bench_culling(input: &[Vec3], output: &mut [f64]) {
    let plane = Plane::from_point_normal(Vec3::new(100., 200., 300.), Vec3::new(0.36, 0.48, 0.8));
    for (point, out) in input.iter().zip(output.iter_mut()) {
        let bounds = Aabb {
            center: *point,
            extents: Vec3::new(200., 300., 400.),
        };
        *out = if bounds.is_on_or_forward_plane(&plane) {
            1.
        } else {
            0.
        };
    }
}

#[unsafe(no_mangle)]
#[inline(never)]
pub fn bench_transforms(input: &[Vec3], output: &mut [f64]) {
    let transform = Transform::from_translation_rotation_scale(
        Vec3::new(6_371_000., 120., -340.),
        Quat::from_xyzw(0., 0., 0.6, 0.8),
        Vec3::new(1.2, 0.8, 1.1),
    );
    for (point, out) in input.iter().zip(output.as_chunks_mut::<3>().0.iter_mut()) {
        out.copy_from_slice(&transform.transform_point(*point).to_array());
    }
}

#[unsafe(no_mangle)]
#[inline(never)]
pub fn bench_encoding(input: &[Vec3], output: &mut [f64]) {
    for (point, out) in input.iter().zip(output.as_chunks_mut::<6>().0.iter_mut()) {
        let encoded = EncodedVec3::encode(*point);
        out[..3].copy_from_slice(&encoded.high.to_array());
        out[3..].copy_from_slice(&encoded.low.to_array());
    }
}

#[unsafe(no_mangle)]
#[inline(never)]
pub fn bench_geodetic(input: &[Vec3], output: &mut [f64]) {
    for (point, out) in input.iter().zip(output.as_chunks_mut::<3>().0.iter_mut()) {
        let position: Vec3 = WGS84_64
            .lle_to_xyz(LLE::from_float(point.y, point.x, point.z))
            .into();
        out.copy_from_slice(&position.to_array());
    }
}

fn measure(name: &str, kernel: fn(&[Vec3], &mut [f64]), width: usize, duration_ms: u64) {
    let input: Vec<_> = (0..ITEMS)
        .map(|i| {
            let t = i as f64 / ITEMS as f64;
            if name == "geodetic" {
                Vec3::new(-1.2 + t * 2.4, -3. + t * 6., t * 2000.)
            } else {
                Vec3::new(-6_371_000. + t * 12_742_000., t * 8000. - 4000., t * 12000.)
            }
        })
        .collect();
    let mut output = vec![0.; ITEMS * width];
    let mut batch = || {
        kernel(black_box(&input), black_box(&mut output));
        black_box(&output);
    };
    let warmup = Instant::now();
    while warmup.elapsed().as_millis() < 50 {
        batch();
    }
    let start = Instant::now();
    let mut iterations = 0;
    while start.elapsed().as_millis() < duration_ms as u128 {
        batch();
        iterations += 1;
    }
    let ms = start.elapsed().as_secs_f64() * 1000. / iterations as f64;
    // Hash every output value outside timing; the runner requires equal results.
    let checksum = output.iter().fold(0xcbf29ce484222325_u64, |hash, value| {
        assert!(value.is_finite());
        (hash ^ value.to_bits()).wrapping_mul(0x100000001b3)
    });
    println!(
        "{{\"kernel\":\"{name}\",\"items\":{ITEMS},\"ms\":{ms},\"iterations\":{iterations},\"checksum\":\"{checksum:016x}\"}}"
    );
}

fn main() {
    let duration_ms = std::env::args().nth(1).map_or(200, |v| v.parse().unwrap());
    assert!(duration_ms > 0);
    measure("planes", bench_planes, 4, duration_ms);
    measure("culling", bench_culling, 1, duration_ms);
    measure("transforms", bench_transforms, 3, duration_ms);
    measure("encoding", bench_encoding, 6, duration_ms);
    measure("geodetic", bench_geodetic, 3, duration_ms);
}
