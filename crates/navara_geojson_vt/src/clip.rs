use std::sync::Arc;

use crate::types::{BBox, InternalFeature, InternalGeometry, Ring};

/// Clips features to an axis-aligned bounding box.
///
/// - `k1`, `k2`: clipping range along the specified axis
/// - `axis`: 0 for x-axis, 1 for y-axis
/// - `intersect`: function that computes the intersection point
/// - `buffer`: padding in normalized coordinates for points/lines
pub fn clip(
    features: &[Arc<InternalFeature>],
    k1: f64,
    k2: f64,
    axis: usize,
    intersect: fn(&[f64], &[f64], f64) -> f64,
    buffer: f64,
) -> Vec<Arc<InternalFeature>> {
    let mut clipped = Vec::with_capacity(features.len());

    for feature in features {
        let a = if axis == 0 {
            feature.bbox.min_x
        } else {
            feature.bbox.min_y
        };
        let b = if axis == 0 {
            feature.bbox.max_x
        } else {
            feature.bbox.max_y
        };

        // Trivial reject using half-open interval [k1, k2):
        // - `a >= k2 + buffer`: feature starts at or past the end boundary
        // - `b < k1 - buffer`: feature ends strictly before the start boundary
        if a >= k2 + buffer || b < k1 - buffer {
            continue;
        }

        // Trivial accept: entirely inside [k1, k2) without buffer
        if a >= k1 && b < k2 {
            clipped.push(Arc::clone(feature));
            continue;
        }

        match &feature.geometry {
            InternalGeometry::Point(coords) => {
                clip_point(coords, k1, k2, axis, buffer, feature, &mut clipped);
            }
            InternalGeometry::MultiPoint(coords) => {
                clip_multi_point(coords, k1, k2, axis, buffer, feature, &mut clipped);
            }
            InternalGeometry::LineString(ring) => {
                let mut new_rings = Vec::new();
                clip_line(
                    &ring.coords,
                    k1,
                    k2,
                    axis,
                    intersect,
                    false,
                    ring.size,
                    ring.line_start,
                    &mut new_rings,
                );
                if !new_rings.is_empty() {
                    let mut bbox = BBox::new();
                    for r in &new_rings {
                        update_bbox_from_coords(&r.coords, &mut bbox);
                    }
                    if new_rings.len() == 1 {
                        clipped.push(Arc::new(InternalFeature {
                            geometry: InternalGeometry::LineString(new_rings.remove(0)),
                            bbox,
                            properties: feature.properties.clone(),
                            source_index: feature.source_index,
                        }));
                    } else {
                        clipped.push(Arc::new(InternalFeature {
                            geometry: InternalGeometry::MultiLineString(new_rings),
                            bbox,
                            properties: feature.properties.clone(),
                            source_index: feature.source_index,
                        }));
                    }
                }
            }
            InternalGeometry::MultiLineString(rings) => {
                let mut new_rings = Vec::new();
                for ring in rings {
                    clip_line(
                        &ring.coords,
                        k1,
                        k2,
                        axis,
                        intersect,
                        false,
                        ring.size,
                        ring.line_start,
                        &mut new_rings,
                    );
                }
                if !new_rings.is_empty() {
                    let mut bbox = BBox::new();
                    for r in &new_rings {
                        update_bbox_from_coords(&r.coords, &mut bbox);
                    }
                    clipped.push(Arc::new(InternalFeature {
                        geometry: InternalGeometry::MultiLineString(new_rings),
                        bbox,
                        properties: feature.properties.clone(),
                        source_index: feature.source_index,
                    }));
                }
            }
            InternalGeometry::Polygon(rings) => {
                let new_rings = clip_polygon(rings, k1, k2, axis, intersect);
                if !new_rings.is_empty() {
                    let mut bbox = BBox::new();
                    for r in &new_rings {
                        update_bbox_from_coords(&r.coords, &mut bbox);
                    }
                    clipped.push(Arc::new(InternalFeature {
                        geometry: InternalGeometry::Polygon(new_rings),
                        bbox,
                        properties: feature.properties.clone(),
                        source_index: feature.source_index,
                    }));
                }
            }
            InternalGeometry::MultiPolygon(polygons) => {
                let mut new_polygons = Vec::new();
                for polygon in polygons {
                    let new_rings = clip_polygon(polygon, k1, k2, axis, intersect);
                    if !new_rings.is_empty() {
                        new_polygons.push(new_rings);
                    }
                }
                if !new_polygons.is_empty() {
                    let mut bbox = BBox::new();
                    for polygon in &new_polygons {
                        for r in polygon {
                            update_bbox_from_coords(&r.coords, &mut bbox);
                        }
                    }
                    clipped.push(Arc::new(InternalFeature {
                        geometry: InternalGeometry::MultiPolygon(new_polygons),
                        bbox,
                        properties: feature.properties.clone(),
                        source_index: feature.source_index,
                    }));
                }
            }
        }
    }

    clipped
}

fn clip_point(
    coords: &[f64],
    k1: f64,
    k2: f64,
    axis: usize,
    buffer: f64,
    feature: &Arc<InternalFeature>,
    clipped: &mut Vec<Arc<InternalFeature>>,
) {
    let v = coords[axis];
    if v >= k1 - buffer && v <= k2 + buffer {
        clipped.push(Arc::clone(feature));
    }
}

fn clip_multi_point(
    coords: &[f64],
    k1: f64,
    k2: f64,
    axis: usize,
    buffer: f64,
    feature: &Arc<InternalFeature>,
    clipped: &mut Vec<Arc<InternalFeature>>,
) {
    let mut new_coords = Vec::new();
    let mut bbox = BBox::new();

    let n = coords.len() / 3;
    for i in 0..n {
        let v = coords[i * 3 + axis];
        if v >= k1 - buffer && v <= k2 + buffer {
            let x = coords[i * 3];
            let y = coords[i * 3 + 1];
            let z = coords[i * 3 + 2];
            new_coords.extend_from_slice(&[x, y, z]);
            bbox.extend(x, y);
        }
    }

    if !new_coords.is_empty() {
        clipped.push(Arc::new(InternalFeature {
            geometry: InternalGeometry::MultiPoint(new_coords),
            bbox,
            properties: feature.properties.clone(),
            source_index: feature.source_index,
        }));
    }
}

/// Clips a line (flat coords [x,y,z,...]) to a 1D range [k1, k2] along the given axis.
/// Produces zero or more Ring segments. `orig_size` is inherited by new Ring segments
/// for the small-geometry simplification check. `line_start` is the distance along the
/// original line at `coords`' first point; each new segment records its own.
#[allow(clippy::too_many_arguments)]
fn clip_line(
    coords: &[f64],
    k1: f64,
    k2: f64,
    axis: usize,
    intersect: fn(&[f64], &[f64], f64) -> f64,
    is_polygon: bool,
    orig_size: f64,
    line_start: f64,
    result: &mut Vec<Ring>,
) {
    let n = coords.len() / 3;
    if n == 0 {
        return;
    }

    let new_ring = |start: f64| {
        let mut r = Ring::new();
        r.size = orig_size;
        r.line_start = start;
        r.coords.reserve(coords.len());
        r
    };

    let mut current_ring: Option<Ring> = None;
    // Distance along the original line at the previous point.
    let mut b_distance = line_start;

    for i in 0..n {
        let ax = coords[i * 3];
        let ay = coords[i * 3 + 1];
        let az = coords[i * 3 + 2];
        let ak = if axis == 0 { ax } else { ay };

        if i == 0 {
            // First point: just add it if inside
            if ak >= k1 && ak <= k2 {
                let ring = current_ring.get_or_insert_with(|| new_ring(line_start));
                ring.coords.extend_from_slice(&[ax, ay, az]);
            }
            continue;
        }

        let bx = coords[(i - 1) * 3];
        let by = coords[(i - 1) * 3 + 1];
        let bz = coords[(i - 1) * 3 + 2];
        let bk = if axis == 0 { bx } else { by };

        let a_inside = ak >= k1 && ak <= k2;
        let b_inside = bk >= k1 && bk <= k2;

        let a_pt = &[ax, ay, az];
        let b_pt = &[bx, by, bz];

        let segment_length = ((ax - bx).powi(2) + (ay - by).powi(2)).sqrt();
        // Distance along the original line at `a + (b - a) * t`.
        let distance_at = |t: f64| b_distance + segment_length * (1.0 - t);

        if b_inside != a_inside {
            // Edge crosses at least one boundary
            if b_inside {
                // Exiting: b is inside, a is outside
                // Find which boundary we cross
                let boundary = if ak < k1 { k1 } else { k2 };
                let t = intersect(a_pt, b_pt, boundary);
                let (ix, iy, iz) = interp_point(a_pt, b_pt, t, axis, boundary);
                if let Some(ref mut ring) = current_ring {
                    ring.coords.extend_from_slice(&[ix, iy, iz]);
                }
                // For lines, push completed segment when exiting
                if !is_polygon
                    && let Some(ring) = current_ring.take()
                    && !ring.is_empty()
                {
                    result.push(ring);
                }
            } else {
                // Entering: b is outside, a is inside
                let boundary = if bk < k1 { k1 } else { k2 };
                let t = intersect(a_pt, b_pt, boundary);
                let (ix, iy, iz) = interp_point(a_pt, b_pt, t, axis, boundary);
                let ring = current_ring.get_or_insert_with(|| new_ring(distance_at(t)));
                ring.coords.extend_from_slice(&[ix, iy, iz]);
                ring.coords.extend_from_slice(&[ax, ay, az]);
            }
        } else if a_inside {
            // Both inside: just add current point
            let ring = current_ring.get_or_insert_with(|| new_ring(distance_at(0.0)));
            ring.coords.extend_from_slice(&[ax, ay, az]);
        } else {
            // Both outside - but the segment might pass through the clip region
            // This happens when b < k1 and a > k2, or b > k2 and a < k1
            if (bk < k1 && ak > k2) || (bk > k2 && ak < k1) {
                // Crosses both boundaries: add entry and exit intersections
                let (entry_k, exit_k) = if bk < k1 { (k1, k2) } else { (k2, k1) };

                let t1 = intersect(a_pt, b_pt, entry_k);
                let (ix1, iy1, iz1) = interp_point(a_pt, b_pt, t1, axis, entry_k);

                let t2 = intersect(a_pt, b_pt, exit_k);
                let (ix2, iy2, iz2) = interp_point(a_pt, b_pt, t2, axis, exit_k);

                // Add in order from b to a (t1 closer to b, t2 closer to a)
                let ring = current_ring.get_or_insert_with(|| new_ring(distance_at(t1.max(t2))));
                // Entry and exit in order along the segment (b→a)
                if t1 > t2 {
                    ring.coords.extend_from_slice(&[ix1, iy1, iz1]);
                    ring.coords.extend_from_slice(&[ix2, iy2, iz2]);
                } else {
                    ring.coords.extend_from_slice(&[ix2, iy2, iz2]);
                    ring.coords.extend_from_slice(&[ix1, iy1, iz1]);
                }

                if !is_polygon
                    && let Some(ring) = current_ring.take()
                    && !ring.is_empty()
                {
                    result.push(ring);
                }
            }
            // else: both outside on the same side, skip
        }
        b_distance += segment_length;
    }

    if let Some(ring) = current_ring.take()
        && !ring.is_empty()
    {
        result.push(ring);
    }
}

/// Compute an interpolated intersection point along the segment a→b.
/// The `boundary` value is placed on the clipping axis; other coordinates are interpolated.
/// z-coordinate is always set to 1.0 (intersection points are always important for
/// simplification — matches JS behavior where clip pushes z=1 for intersections).
fn interp_point(a: &[f64], b: &[f64], t: f64, axis: usize, boundary: f64) -> (f64, f64, f64) {
    let ix = if axis == 0 {
        boundary
    } else {
        a[0] + (b[0] - a[0]) * t
    };
    let iy = if axis == 1 {
        boundary
    } else {
        a[1] + (b[1] - a[1]) * t
    };
    (ix, iy, 1.0)
}

/// Clips polygon rings to a 1D range.
fn clip_polygon(
    rings: &[Ring],
    k1: f64,
    k2: f64,
    axis: usize,
    intersect: fn(&[f64], &[f64], f64) -> f64,
) -> Vec<Ring> {
    let mut result = Vec::new();

    for ring in rings {
        let clipped_ring = clip_polygon_ring(&ring.coords, k1, k2, axis, intersect);
        if !clipped_ring.is_empty() {
            let mut new_ring = Ring {
                coords: clipped_ring,
                area: ring.area,
                dist: ring.dist,
                size: ring.size, // Preserve original size for small-geometry check
                line_start: 0.0,
            };
            // Recalculate area for clipped ring (needed for winding direction)
            new_ring.area = calc_ring_area_from_coords(&new_ring.coords);
            result.push(new_ring);
        }
    }

    result
}

/// Clips a polygon ring using Sutherland-Hodgman style clipping against two parallel lines.
fn clip_polygon_ring(
    coords: &[f64],
    k1: f64,
    k2: f64,
    axis: usize,
    intersect: fn(&[f64], &[f64], f64) -> f64,
) -> Vec<f64> {
    // First clip against k1 (keep points with coord[axis] >= k1)
    let clipped = clip_ring_against_boundary(coords, k1, axis, intersect, true);
    if clipped.is_empty() {
        return Vec::new();
    }
    // Then clip against k2 (keep points with coord[axis] <= k2)
    clip_ring_against_boundary(&clipped, k2, axis, intersect, false)
}

/// Clips a ring against a single boundary line using Sutherland-Hodgman.
/// If `keep_greater` is true, keeps points where coord[axis] >= boundary.
/// If false, keeps points where coord[axis] <= boundary.
fn clip_ring_against_boundary(
    coords: &[f64],
    boundary: f64,
    axis: usize,
    intersect: fn(&[f64], &[f64], f64) -> f64,
    keep_greater: bool,
) -> Vec<f64> {
    let n = coords.len() / 3;
    if n == 0 {
        return Vec::new();
    }

    let mut result = Vec::with_capacity(coords.len() + 6);

    let is_inside = |k: f64| -> bool {
        if keep_greater {
            k >= boundary
        } else {
            k <= boundary
        }
    };

    let mut j = n - 1;
    for i in 0..n {
        let ax = coords[i * 3];
        let ay = coords[i * 3 + 1];
        let az = coords[i * 3 + 2];
        let ak = if axis == 0 { ax } else { ay };

        let bx = coords[j * 3];
        let by = coords[j * 3 + 1];
        let bz = coords[j * 3 + 2];
        let bk = if axis == 0 { bx } else { by };

        let a_inside = is_inside(ak);
        let b_inside = is_inside(bk);

        if a_inside != b_inside {
            // Edge crosses boundary - add intersection
            let a_pt = &[ax, ay, az];
            let b_pt = &[bx, by, bz];
            let t = intersect(a_pt, b_pt, boundary);
            let (ix, iy, iz) = interp_point(a_pt, b_pt, t, axis, boundary);
            result.extend_from_slice(&[ix, iy, iz]);
        }

        if a_inside {
            result.extend_from_slice(&[ax, ay, az]);
        }

        j = i;
    }

    // Close the ring if needed
    if result.len() >= 6 {
        let first_x = result[0];
        let first_y = result[1];
        let first_z = result[2];
        let last_x = result[result.len() - 3];
        let last_y = result[result.len() - 2];
        if (first_x - last_x).abs() > 1e-10 || (first_y - last_y).abs() > 1e-10 {
            result.push(first_x);
            result.push(first_y);
            result.push(first_z);
        }
    }

    result
}

fn calc_ring_area_from_coords(coords: &[f64]) -> f64 {
    crate::convert::calc_ring_area(coords)
}

fn update_bbox_from_coords(coords: &[f64], bbox: &mut BBox) {
    let n = coords.len() / 3;
    for i in 0..n {
        bbox.extend(coords[i * 3], coords[i * 3 + 1]);
    }
}

/// Intersection function for the x-axis.
/// Returns the interpolation parameter t for the intersection.
pub fn intersect_x(a: &[f64], b: &[f64], x: f64) -> f64 {
    let dx = b[0] - a[0];
    if dx.abs() < 1e-15 {
        0.0
    } else {
        (x - a[0]) / dx
    }
}

/// Intersection function for the y-axis.
/// Returns the interpolation parameter t for the intersection.
pub fn intersect_y(a: &[f64], b: &[f64], y: f64) -> f64 {
    let dy = b[1] - a[1];
    if dy.abs() < 1e-15 {
        0.0
    } else {
        (y - a[1]) / dy
    }
}

/// Distributes features into 4 tile quadrants in a single pass.
///
/// Instead of calling `clip()` 6 times (2 x-clips + 4 y-clips), classifies each
/// feature's bbox against the midpoints and only clips features that actually
/// straddle a boundary. Features fully within one quadrant are `Arc::clone`d.
///
/// Returns `[top-left, bottom-left, top-right, bottom-right]`.
#[allow(clippy::too_many_arguments)]
pub fn clip_to_quadrants(
    features: &[Arc<InternalFeature>],
    x_min: f64,
    x_mid: f64,
    x_max: f64,
    y_min: f64,
    y_mid: f64,
    y_max: f64,
    buf: f64,
) -> [Vec<Arc<InternalFeature>>; 4] {
    let cap = features.len() / 2 + 1;
    let mut tl = Vec::with_capacity(cap);
    let mut bl = Vec::with_capacity(cap);
    let mut tr = Vec::with_capacity(cap);
    let mut br = Vec::with_capacity(cap);

    for feature in features {
        let a_x = feature.bbox.min_x;
        let b_x = feature.bbox.max_x;

        // Left half: clip range [x_min - buf, x_mid + buf] with buffer=buf
        let left_reject = a_x >= x_mid + 2.0 * buf || b_x < x_min - 2.0 * buf;
        let left_accept = !left_reject && a_x >= x_min - buf && b_x < x_mid + buf;

        // Right half: clip range [x_mid - buf, x_max + buf] with buffer=buf
        let right_reject = a_x >= x_max + 2.0 * buf || b_x < x_mid - 2.0 * buf;
        let right_accept = !right_reject && a_x >= x_mid - buf && b_x < x_max + buf;

        if !left_reject {
            if left_accept {
                distribute_y_feature(feature, y_min, y_mid, y_max, buf, &mut tl, &mut bl);
            } else {
                let clipped = clip(
                    std::slice::from_ref(feature),
                    x_min - buf,
                    x_mid + buf,
                    0,
                    intersect_x,
                    buf,
                );
                for f in &clipped {
                    distribute_y_feature(f, y_min, y_mid, y_max, buf, &mut tl, &mut bl);
                }
            }
        }

        if !right_reject {
            if right_accept {
                distribute_y_feature(feature, y_min, y_mid, y_max, buf, &mut tr, &mut br);
            } else {
                let clipped = clip(
                    std::slice::from_ref(feature),
                    x_mid - buf,
                    x_max + buf,
                    0,
                    intersect_x,
                    buf,
                );
                for f in &clipped {
                    distribute_y_feature(f, y_min, y_mid, y_max, buf, &mut tr, &mut br);
                }
            }
        }
    }

    [tl, bl, tr, br]
}

fn distribute_y_feature(
    feature: &Arc<InternalFeature>,
    y_min: f64,
    y_mid: f64,
    y_max: f64,
    buf: f64,
    top: &mut Vec<Arc<InternalFeature>>,
    bottom: &mut Vec<Arc<InternalFeature>>,
) {
    let a_y = feature.bbox.min_y;
    let b_y = feature.bbox.max_y;

    // Top half: clip range [y_min - buf, y_mid + buf] with buffer=buf
    let top_reject = a_y >= y_mid + 2.0 * buf || b_y < y_min - 2.0 * buf;
    let top_accept = !top_reject && a_y >= y_min - buf && b_y < y_mid + buf;

    // Bottom half: clip range [y_mid - buf, y_max + buf] with buffer=buf
    let bottom_reject = a_y >= y_max + 2.0 * buf || b_y < y_mid - 2.0 * buf;
    let bottom_accept = !bottom_reject && a_y >= y_mid - buf && b_y < y_max + buf;

    if !top_reject {
        if top_accept {
            top.push(Arc::clone(feature));
        } else {
            top.extend(clip(
                std::slice::from_ref(feature),
                y_min - buf,
                y_mid + buf,
                1,
                intersect_y,
                buf,
            ));
        }
    }

    if !bottom_reject {
        if bottom_accept {
            bottom.push(Arc::clone(feature));
        } else {
            bottom.extend(clip(
                std::slice::from_ref(feature),
                y_mid - buf,
                y_max + buf,
                1,
                intersect_y,
                buf,
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn make_feature(geometry: InternalGeometry, bbox: BBox) -> Arc<InternalFeature> {
        Arc::new(InternalFeature {
            geometry,
            bbox,
            properties: Arc::new(serde_json::Value::Null),
            source_index: 0,
        })
    }

    #[test]
    fn test_trivial_reject() {
        let feature = make_feature(
            InternalGeometry::Point([0.1, 0.1, 0.0]),
            BBox {
                min_x: 0.1,
                min_y: 0.1,
                max_x: 0.1,
                max_y: 0.1,
            },
        );

        let result = clip(&[feature], 0.5, 1.0, 0, intersect_x, 0.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_trivial_accept() {
        let feature = make_feature(
            InternalGeometry::Point([0.6, 0.5, 0.0]),
            BBox {
                min_x: 0.6,
                min_y: 0.5,
                max_x: 0.6,
                max_y: 0.5,
            },
        );

        let result = clip(&[feature], 0.5, 1.0, 0, intersect_x, 0.0);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_point_clipping_with_buffer() {
        let feature = make_feature(
            InternalGeometry::Point([0.49, 0.5, 0.0]),
            BBox {
                min_x: 0.49,
                min_y: 0.5,
                max_x: 0.49,
                max_y: 0.5,
            },
        );

        // Without buffer: rejected
        let result = clip(
            std::slice::from_ref(&feature),
            0.5,
            1.0,
            0,
            intersect_x,
            0.0,
        );
        assert!(result.is_empty());

        // With buffer: accepted
        let result = clip(&[feature], 0.5, 1.0, 0, intersect_x, 0.02);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_polygon_partial_clip() {
        // A square polygon from (0.25, 0.25) to (0.75, 0.75)
        let ring = Ring {
            coords: vec![
                0.25, 0.25, 0.0, 0.75, 0.25, 0.0, 0.75, 0.75, 0.0, 0.25, 0.75, 0.0, 0.25, 0.25, 0.0,
            ],
            area: 0.25,
            dist: 0.0,
            size: 0.25,
            line_start: 0.0,
        };

        let feature = make_feature(
            InternalGeometry::Polygon(vec![ring]),
            BBox {
                min_x: 0.25,
                min_y: 0.25,
                max_x: 0.75,
                max_y: 0.75,
            },
        );

        // Clip to x=[0.5, 1.0] - should get right half
        let result = clip(&[feature], 0.5, 1.0, 0, intersect_x, 0.0);
        assert_eq!(result.len(), 1);

        match &result[0].geometry {
            InternalGeometry::Polygon(rings) => {
                assert_eq!(rings.len(), 1);
                // All x coords should be >= 0.5
                let n = rings[0].coords.len() / 3;
                for i in 0..n {
                    assert!(
                        rings[0].coords[i * 3] >= 0.5 - 1e-10,
                        "x = {} should be >= 0.5",
                        rings[0].coords[i * 3]
                    );
                }
            }
            _ => panic!("Expected Polygon"),
        }
    }

    #[test]
    fn test_intersect_x() {
        let a = [0.0, 0.0, 0.0];
        let b = [1.0, 1.0, 0.0];
        let t = intersect_x(&a, &b, 0.5);
        assert!((t - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_intersect_y() {
        let a = [0.0, 0.0, 0.0];
        let b = [1.0, 1.0, 0.0];
        let t = intersect_y(&a, &b, 0.5);
        assert!((t - 0.5).abs() < 1e-10);
    }

    // ── clip_line direct unit tests ────────────────────────────────────

    #[test]
    fn clip_line_fully_inside() {
        // Line entirely within [0.25, 0.75]
        let coords = vec![0.3, 0.1, 0.0, 0.5, 0.2, 0.0, 0.7, 0.3, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.25,
            0.75,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].coords.len() / 3, 3); // all 3 points kept
    }

    #[test]
    fn clip_line_fully_outside() {
        // Line entirely outside [0.5, 1.0]
        let coords = vec![0.1, 0.1, 0.0, 0.2, 0.2, 0.0, 0.3, 0.3, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.5,
            1.0,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn clip_line_enters_and_exits() {
        // Line goes from outside to inside to outside: x = 0.0, 0.5, 1.0
        let coords = vec![0.0, 0.0, 0.0, 0.5, 0.5, 0.0, 1.0, 1.0, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.25,
            0.75,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 1);
        // First point should be the entry intersection at x=0.25
        assert!((result[0].coords[0] - 0.25).abs() < 1e-10);
        // Last point should be the exit intersection at x=0.75
        let last_idx = result[0].coords.len() - 3;
        assert!((result[0].coords[last_idx] - 0.75).abs() < 1e-10);
    }

    #[test]
    fn clip_line_multiple_segments() {
        // Line enters, exits, re-enters: produces 2 segments
        let coords = vec![
            0.3, 0.0, 0.0, // inside
            0.5, 0.1, 0.0, // inside
            0.8, 0.2, 0.0, // outside
            0.3, 0.3, 0.0, // inside again
            0.5, 0.4, 0.0, // inside
        ];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.2,
            0.7,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 2, "Expected 2 segments");
    }

    #[test]
    fn clip_line_crosses_both_boundaries() {
        // Single segment from x=0.0 to x=1.0 crossing both k1=0.25 and k2=0.75
        let coords = vec![0.0, 0.0, 0.0, 1.0, 1.0, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.25,
            0.75,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 1);
        // Should have exactly 2 points: entry and exit
        assert_eq!(result[0].coords.len() / 3, 2);
        assert!((result[0].coords[0] - 0.25).abs() < 1e-10);
        assert!((result[0].coords[3] - 0.75).abs() < 1e-10);
    }

    #[test]
    fn clip_line_records_where_each_piece_starts_on_the_line() {
        // Enters at x=0.25 between its first two points.
        let coords = vec![0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 1.0, 0.0, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.25,
            0.75,
            0,
            intersect_x,
            false,
            0.0,
            10.0,
            &mut result,
        );
        assert_eq!(result.len(), 1);
        assert!((result[0].line_start - 10.25).abs() < 1e-12);

        // Crosses both boundaries on one segment.
        let coords = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.25,
            0.75,
            0,
            intersect_x,
            false,
            0.0,
            10.0,
            &mut result,
        );
        assert!((result[0].line_start - 10.25).abs() < 1e-12);

        // Leaves and comes back: the second piece starts past the detour.
        let coords = vec![0.5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.5, 0.25, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.25,
            0.75,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].line_start, 0.0);
        let second = 0.5 + (0.25f64.powi(2) + 0.125f64.powi(2)).sqrt();
        assert!((result[1].line_start - second).abs() < 1e-12);
    }

    #[test]
    fn clip_line_z_at_intersection() {
        // Line from (0.0, 0.0, 10.0) to (1.0, 1.0, 20.0)
        // Clip at x=0.5: intersection z should be 1.0 (always important)
        let coords = vec![0.0, 0.0, 10.0, 1.0, 1.0, 20.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.5,
            1.0,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 1);
        // Intersection points always get z=1.0 (simplification importance)
        assert!(
            (result[0].coords[2] - 1.0).abs() < 1e-10,
            "z = {}, expected 1.0",
            result[0].coords[2]
        );
    }

    #[test]
    fn clip_line_empty_input() {
        let coords: Vec<f64> = Vec::new();
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.0,
            1.0,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn clip_line_single_point_inside() {
        let coords = vec![0.5, 0.5, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.0,
            1.0,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].coords.len() / 3, 1);
    }

    #[test]
    fn clip_line_single_point_outside() {
        let coords = vec![1.5, 0.5, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.0,
            1.0,
            0,
            intersect_x,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn clip_line_y_axis() {
        // Clip along y-axis
        let coords = vec![0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.5, 1.0, 0.0];
        let mut result = Vec::new();
        clip_line(
            &coords,
            0.25,
            0.75,
            1,
            intersect_y,
            false,
            0.0,
            0.0,
            &mut result,
        );
        assert_eq!(result.len(), 1);
        assert!((result[0].coords[1] - 0.25).abs() < 1e-10);
        let last_idx = result[0].coords.len() - 3;
        assert!((result[0].coords[last_idx + 1] - 0.75).abs() < 1e-10);
    }

    // ── Multi-geometry clipping tests ──────────────────────────────────

    #[test]
    fn clip_multipoint_filters_points() {
        // MultiPoint with 3 points, only 2 inside [0.3, 0.7]
        let feature = make_feature(
            InternalGeometry::MultiPoint(vec![
                0.2, 0.5, 0.0, // outside
                0.5, 0.5, 0.0, // inside
                0.6, 0.5, 0.0, // inside
            ]),
            BBox {
                min_x: 0.2,
                min_y: 0.5,
                max_x: 0.6,
                max_y: 0.5,
            },
        );

        let result = clip(&[feature], 0.3, 0.7, 0, intersect_x, 0.0);
        assert_eq!(result.len(), 1);
        match &result[0].geometry {
            InternalGeometry::MultiPoint(coords) => {
                assert_eq!(coords.len() / 3, 2); // 2 points kept
            }
            _ => panic!("Expected MultiPoint"),
        }
    }

    #[test]
    fn clip_linestring_basic() {
        // LineString crossing the clip boundary
        let ring = Ring {
            coords: vec![0.0, 0.5, 0.0, 0.5, 0.5, 0.0, 1.0, 0.5, 0.0],
            area: 0.0,
            dist: 0.0,
            size: 0.0,
            line_start: 0.0,
        };
        let feature = make_feature(
            InternalGeometry::LineString(ring),
            BBox {
                min_x: 0.0,
                min_y: 0.5,
                max_x: 1.0,
                max_y: 0.5,
            },
        );

        let result = clip(&[feature], 0.25, 0.75, 0, intersect_x, 0.0);
        assert_eq!(result.len(), 1);
        match &result[0].geometry {
            InternalGeometry::LineString(_) | InternalGeometry::MultiLineString(_) => {}
            other => panic!(
                "Expected LineString or MultiLineString, got {:?}",
                std::mem::discriminant(other)
            ),
        }
    }

    #[test]
    fn clip_multilinestring_basic() {
        let ring1 = Ring {
            coords: vec![0.0, 0.3, 0.0, 1.0, 0.3, 0.0],
            area: 0.0,
            dist: 0.0,
            size: 0.0,
            line_start: 0.0,
        };
        let ring2 = Ring {
            coords: vec![0.0, 0.7, 0.0, 1.0, 0.7, 0.0],
            area: 0.0,
            dist: 0.0,
            size: 0.0,
            line_start: 0.0,
        };
        let feature = make_feature(
            InternalGeometry::MultiLineString(vec![ring1, ring2]),
            BBox {
                min_x: 0.0,
                min_y: 0.3,
                max_x: 1.0,
                max_y: 0.7,
            },
        );

        let result = clip(&[feature], 0.25, 0.75, 0, intersect_x, 0.0);
        assert_eq!(result.len(), 1);
        match &result[0].geometry {
            InternalGeometry::MultiLineString(rings) => {
                assert_eq!(rings.len(), 2); // both lines clipped
            }
            _ => panic!("Expected MultiLineString"),
        }
    }

    // ── clip_to_quadrants tests ────────────────────────────────────────

    /// Helper: build a point feature with consistent bbox.
    fn make_point_feature(x: f64, y: f64) -> Arc<InternalFeature> {
        make_feature(
            InternalGeometry::Point([x, y, 0.0]),
            BBox {
                min_x: x,
                min_y: y,
                max_x: x,
                max_y: y,
            },
        )
    }

    /// Helper: build a rectangular polygon feature.
    fn make_rect_feature(x1: f64, y1: f64, x2: f64, y2: f64) -> Arc<InternalFeature> {
        let ring = Ring {
            #[rustfmt::skip]
            coords: vec![
                x1, y1, 0.0,
                x2, y1, 0.0,
                x2, y2, 0.0,
                x1, y2, 0.0,
                x1, y1, 0.0,
            ],
            area: (x2 - x1) * (y2 - y1),
            dist: 0.0,
            size: (x2 - x1) * (y2 - y1),
            line_start: 0.0,
        };
        make_feature(
            InternalGeometry::Polygon(vec![ring]),
            BBox {
                min_x: x1,
                min_y: y1,
                max_x: x2,
                max_y: y2,
            },
        )
    }

    #[test]
    fn quadrants_point_in_each_quadrant() {
        // Tile [0,0]-[1,1] split at (0.5, 0.5)
        let tl_pt = make_point_feature(0.2, 0.2); // top-left
        let bl_pt = make_point_feature(0.2, 0.7); // bottom-left
        let tr_pt = make_point_feature(0.7, 0.2); // top-right
        let br_pt = make_point_feature(0.7, 0.7); // bottom-right
        let features = vec![tl_pt, bl_pt, tr_pt, br_pt];

        let [tl, bl, tr, br] = clip_to_quadrants(&features, 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);

        assert_eq!(tl.len(), 1, "top-left should have 1 feature");
        assert_eq!(bl.len(), 1, "bottom-left should have 1 feature");
        assert_eq!(tr.len(), 1, "top-right should have 1 feature");
        assert_eq!(br.len(), 1, "bottom-right should have 1 feature");
    }

    #[test]
    fn quadrants_empty_input() {
        let [tl, bl, tr, br] = clip_to_quadrants(&[], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);
        assert!(tl.is_empty());
        assert!(bl.is_empty());
        assert!(tr.is_empty());
        assert!(br.is_empty());
    }

    #[test]
    fn quadrants_feature_fully_outside() {
        // Point far outside the tile
        let outside = make_point_feature(2.0, 2.0);
        let [tl, bl, tr, br] = clip_to_quadrants(&[outside], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);
        assert!(tl.is_empty());
        assert!(bl.is_empty());
        assert!(tr.is_empty());
        assert!(br.is_empty());
    }

    #[test]
    fn quadrants_polygon_straddling_x_midpoint() {
        // Rectangle spanning x=[0.3, 0.7], y=[0.1, 0.4]
        // Straddles x_mid=0.5, but fully in top half (y < 0.5)
        let rect = make_rect_feature(0.3, 0.1, 0.7, 0.4);
        let [tl, bl, tr, br] = clip_to_quadrants(&[rect], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);

        assert_eq!(tl.len(), 1, "left half of polygon in top-left");
        assert_eq!(tr.len(), 1, "right half of polygon in top-right");
        assert!(bl.is_empty());
        assert!(br.is_empty());

        // Verify clipped geometry: TL polygon should have max_x <= 0.5
        assert!(tl[0].bbox.max_x <= 0.5 + 1e-10);
        // TR polygon should have min_x >= 0.5
        assert!(tr[0].bbox.min_x >= 0.5 - 1e-10);
    }

    #[test]
    fn quadrants_polygon_straddling_y_midpoint() {
        // Rectangle spanning x=[0.1, 0.4], y=[0.3, 0.7]
        // Fully in left half, straddles y_mid=0.5
        let rect = make_rect_feature(0.1, 0.3, 0.4, 0.7);
        let [tl, bl, tr, br] = clip_to_quadrants(&[rect], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);

        assert_eq!(tl.len(), 1, "top portion in top-left");
        assert_eq!(bl.len(), 1, "bottom portion in bottom-left");
        assert!(tr.is_empty());
        assert!(br.is_empty());
    }

    #[test]
    fn quadrants_polygon_straddling_both_midpoints() {
        // Rectangle spanning all four quadrants: x=[0.2, 0.8], y=[0.2, 0.8]
        let rect = make_rect_feature(0.2, 0.2, 0.8, 0.8);
        let [tl, bl, tr, br] = clip_to_quadrants(&[rect], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);

        assert_eq!(tl.len(), 1, "top-left quadrant");
        assert_eq!(bl.len(), 1, "bottom-left quadrant");
        assert_eq!(tr.len(), 1, "top-right quadrant");
        assert_eq!(br.len(), 1, "bottom-right quadrant");
    }

    #[test]
    fn quadrants_multiple_features() {
        let features = vec![
            make_point_feature(0.1, 0.1), // TL
            make_point_feature(0.9, 0.9), // BR
            make_point_feature(0.1, 0.9), // BL
            make_point_feature(0.9, 0.1), // TR
            make_point_feature(0.3, 0.3), // TL
        ];

        let [tl, bl, tr, br] = clip_to_quadrants(&features, 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);

        assert_eq!(tl.len(), 2);
        assert_eq!(bl.len(), 1);
        assert_eq!(tr.len(), 1);
        assert_eq!(br.len(), 1);
    }

    #[test]
    fn quadrants_with_buffer() {
        // Point right at x_mid=0.5, y=0.2 — should appear in both left and right
        // with buffer, because buffer extends the acceptance range
        let pt = make_point_feature(0.5, 0.2);
        let buf = 0.02;
        let [tl, bl, tr, br] = clip_to_quadrants(&[pt], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, buf);

        // Point at x=0.5 is on the boundary — with buffer it should appear
        // in both left and right halves (top row since y=0.2 < 0.5)
        assert!(!tl.is_empty(), "should appear in top-left with buffer");
        assert!(!tr.is_empty(), "should appear in top-right with buffer");
        assert!(bl.is_empty());
        assert!(br.is_empty());
    }

    #[test]
    fn quadrants_line_straddling_x() {
        // Horizontal line from x=0.2 to x=0.8 at y=0.3
        let ring = Ring {
            coords: vec![0.2, 0.3, 0.0, 0.8, 0.3, 0.0],
            area: 0.0,
            dist: 0.0,
            size: 0.0,
            line_start: 0.0,
        };
        let feature = make_feature(
            InternalGeometry::LineString(ring),
            BBox {
                min_x: 0.2,
                min_y: 0.3,
                max_x: 0.8,
                max_y: 0.3,
            },
        );

        let [tl, bl, tr, br] = clip_to_quadrants(&[feature], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);

        assert_eq!(tl.len(), 1, "left half of line in top-left");
        assert_eq!(tr.len(), 1, "right half of line in top-right");
        assert!(bl.is_empty());
        assert!(br.is_empty());
    }

    #[test]
    fn quadrants_preserves_properties() {
        let props = Arc::new(serde_json::json!({"name": "test"}));
        let feature = Arc::new(InternalFeature {
            geometry: InternalGeometry::Point([0.2, 0.2, 0.0]),
            bbox: BBox {
                min_x: 0.2,
                min_y: 0.2,
                max_x: 0.2,
                max_y: 0.2,
            },
            properties: props.clone(),
            source_index: 42,
        });

        let [tl, _, _, _] = clip_to_quadrants(&[feature], 0.0, 0.5, 1.0, 0.0, 0.5, 1.0, 0.0);

        assert_eq!(tl.len(), 1);
        assert_eq!(*tl[0].properties, serde_json::json!({"name": "test"}));
        assert_eq!(tl[0].source_index, 42);
    }

    // ── Z-coordinate interpolation in polygon clipping ─────────────────

    #[test]
    fn clip_polygon_z_at_intersections() {
        // Polygon with z-values, check that intersection points get z=1.0
        let ring = Ring {
            #[rustfmt::skip]
            coords: vec![
                0.0, 0.0, 10.0,
                1.0, 0.0, 20.0,
                1.0, 1.0, 30.0,
                0.0, 1.0, 40.0,
                0.0, 0.0, 10.0,
            ],
            area: 1.0,
            dist: 0.0,
            size: 1.0,
            line_start: 0.0,
        };
        let feature = make_feature(
            InternalGeometry::Polygon(vec![ring]),
            BBox {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 1.0,
                max_y: 1.0,
            },
        );

        let result = clip(&[feature], 0.5, 1.0, 0, intersect_x, 0.0);
        assert_eq!(result.len(), 1);
        match &result[0].geometry {
            InternalGeometry::Polygon(rings) => {
                // Intersection points should have z=1.0
                let n = rings[0].coords.len() / 3;
                let mut has_z_one = false;
                for i in 0..n {
                    let z = rings[0].coords[i * 3 + 2];
                    if (z - 1.0).abs() < 1e-10 {
                        has_z_one = true;
                    }
                }
                assert!(has_z_one, "Expected z=1.0 at intersection points");
            }
            _ => panic!("Expected Polygon"),
        }
    }
}
