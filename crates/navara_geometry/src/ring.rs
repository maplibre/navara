//! Shared helpers for polygon-ring closing.
//!
//! Every pipeline that derives boundary polylines or per-vertex points from
//! polygon rings needs the same two questions answered: "does this ring already
//! repeat its first vertex at the end?" and "close it if not". Keeping the
//! answers here (with a single tolerance) prevents the per-pipeline copies from
//! drifting apart.

use navara_math::EPSILON10;

/// Tolerance for deciding whether a ring's closing vertex coincides with its
/// first vertex. Matches the epsilon the geojson-vt clipper uses when closing
/// clipped rings, so a ring considered closed by the clipper is also considered
/// closed here.
pub const RING_CLOSE_EPSILON: f64 = EPSILON10;

/// Whether two ring endpoints coincide on x/y within [`RING_CLOSE_EPSILON`].
pub fn ring_endpoints_coincide(a: (f64, f64), b: (f64, f64)) -> bool {
    (a.0 - b.0).abs() <= RING_CLOSE_EPSILON && (a.1 - b.1).abs() <= RING_CLOSE_EPSILON
}

/// Whether a flat `[x, y, z, ...]` ring repeats its first vertex at the end
/// (compared on x/y within [`RING_CLOSE_EPSILON`]).
pub fn is_closed_flat_ring(ring: &[f64]) -> bool {
    if ring.len() < 6 {
        return false;
    }
    let last = ring.len() - 3;
    ring_endpoints_coincide((ring[0], ring[1]), (ring[last], ring[last + 1]))
}

/// Close an open flat `[x, y, z, ...]` ring in place by repeating its first
/// vertex. Sources like MVT `ClosePath` and clipped rings may omit the closing
/// duplicate; already-closed (or degenerate, < 2 vertex) rings are untouched.
pub fn close_flat_ring(ring: &mut Vec<f64>) {
    if ring.len() >= 6 && !is_closed_flat_ring(ring) {
        let (x, y, z) = (ring[0], ring[1], ring[2]);
        ring.extend([x, y, z]);
    }
}

/// Vertex count of a ring once its closing duplicate (the first vertex
/// repeated at the end, compared on x/y within [`RING_CLOSE_EPSILON`] via
/// `xy`) is stripped. Open, empty and degenerate (single-vertex) rings keep
/// their full length. Shared by every pipeline that needs run indices or
/// derived points over unique ring vertices, so the guard cannot drift
/// between them.
pub fn open_ring_len<T>(ring: &[T], xy: impl Fn(&T) -> (f64, f64)) -> usize {
    match (ring.first(), ring.last()) {
        (Some(first), Some(last))
            if ring.len() > 1 && ring_endpoints_coincide(xy(first), xy(last)) =>
        {
            ring.len() - 1
        }
        _ => ring.len(),
    }
}

/// Split a tile-space polygon ring into the vertex-index runs worth rendering
/// as boundary polylines, dropping edges introduced by tile clipping.
pub fn tile_ring_boundary_runs<I>(ring: I, extent: f64) -> Vec<Vec<usize>>
where
    I: IntoIterator<Item = (f64, f64)>,
{
    kept_edge_runs(&tile_ring_kept_edges(ring, extent))
}

pub fn tile_ring_kept_edges<I>(ring: I, extent: f64) -> Vec<bool>
where
    I: IntoIterator<Item = (f64, f64)>,
{
    let clip_edge = |a: (f64, f64), b: (f64, f64)| {
        (a.0 <= 0. && b.0 <= 0.)
            || (a.0 >= extent && b.0 >= extent)
            || (a.1 <= 0. && b.1 <= 0.)
            || (a.1 >= extent && b.1 >= extent)
    };
    let mut vertices = ring.into_iter();
    let Some(first) = vertices.next() else {
        return Vec::new();
    };
    let mut kept = Vec::with_capacity(vertices.size_hint().0 + 1);
    let mut prev = first;
    for v in vertices {
        kept.push(!clip_edge(prev, v));
        prev = v;
    }
    if kept.is_empty() {
        return Vec::new();
    }
    kept.push(!clip_edge(prev, first));
    kept
}

pub fn kept_edge_runs(kept: &[bool]) -> Vec<Vec<usize>> {
    let n = kept.len();
    if n == 0 {
        return Vec::new();
    }
    let Some(first_dropped) = kept.iter().position(|&k| !k) else {
        let mut run: Vec<usize> = (0..n).collect();
        run.push(0);
        return vec![run];
    };

    // Walk the edges starting right after a dropped edge so a kept run that
    // wraps around the ring start stays contiguous.
    let mut runs = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for offset in 0..n {
        let e = (first_dropped + 1 + offset) % n;
        if kept[e] {
            if current.is_empty() {
                current.push(e);
            }
            current.push((e + 1) % n);
        } else if !current.is_empty() {
            runs.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        runs.push(current);
    }
    runs
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn open_ring_is_closed_in_place() {
        let mut ring = vec![0., 0., 0., 1., 0., 0., 1., 1., 0.];
        close_flat_ring(&mut ring);
        assert_eq!(ring.len(), 12);
        assert_eq!(&ring[9..], &[0., 0., 0.]);
    }

    #[test]
    fn closed_ring_is_untouched() {
        let mut ring = vec![0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 0., 0.];
        close_flat_ring(&mut ring);
        assert_eq!(ring.len(), 12);
    }

    #[test]
    fn near_closed_ring_within_epsilon_counts_as_closed() {
        // A clipper-produced closing vertex may differ below the epsilon.
        let mut ring = vec![0., 0., 0., 1., 0., 0., 1., 1., 0., 1e-12, -1e-12, 0.];
        assert!(is_closed_flat_ring(&ring));
        close_flat_ring(&mut ring);
        assert_eq!(ring.len(), 12);
    }

    #[test]
    fn degenerate_ring_is_untouched() {
        let mut ring = vec![0., 0., 0.];
        close_flat_ring(&mut ring);
        assert_eq!(ring.len(), 3);
        assert!(!is_closed_flat_ring(&ring));
    }

    #[test]
    fn open_ring_len_strips_only_the_closing_duplicate() {
        let closed = [(0., 0.), (1., 0.), (1., 1.), (0., 0.)];
        assert_eq!(open_ring_len(&closed, |p| *p), 3);
        let open = [(0., 0.), (1., 0.), (1., 1.)];
        assert_eq!(open_ring_len(&open, |p| *p), 3);
        let empty: [(f64, f64); 0] = [];
        assert_eq!(open_ring_len(&empty, |p| *p), 0);
        let single = [(0., 0.)];
        assert_eq!(open_ring_len(&single, |p| *p), 1);
    }

    #[test]
    fn fully_inside_ring_keeps_one_closed_run() {
        let ring = [(10., 10.), (100., 10.), (100., 100.), (10., 100.)];
        let runs = tile_ring_boundary_runs(ring, 4096.);
        assert_eq!(runs, vec![vec![0, 1, 2, 3, 0]]);
    }

    #[test]
    fn clip_edge_along_tile_buffer_is_dropped() {
        // A polygon clipped on the left: vertices 3 and 0 sit in the buffer
        // zone (x = -64), so the closing edge between them is a clip artifact.
        let ring = [(-64., 10.), (100., 10.), (100., 100.), (-64., 100.)];
        let runs = tile_ring_boundary_runs(ring, 4096.);
        // One open run over the real boundary; the buffer-line edge is gone.
        assert_eq!(runs, vec![vec![0, 1, 2, 3]]);
    }

    #[test]
    fn ring_clipped_on_two_sides_yields_two_runs() {
        // Clipped left and right: two vertical clip edges drop, leaving the
        // top and bottom edges as separate open runs.
        let ring = [(-64., 10.), (4160., 10.), (4160., 100.), (-64., 100.)];
        let runs = tile_ring_boundary_runs(ring, 4096.);
        assert_eq!(runs.len(), 2);
        for run in &runs {
            assert_eq!(run.len(), 2);
        }
    }

    #[test]
    fn clip_edge_exactly_on_tile_border_is_dropped() {
        // A buffer-less tileset (e.g. tippecanoe --buffer=0) clamps clipped
        // vertices exactly onto the tile border; the border-coincident closing
        // edge is a clip artifact, not a polygon boundary.
        let ring = [(0., 10.), (100., 10.), (100., 100.), (0., 100.)];
        let runs = tile_ring_boundary_runs(ring, 4096.);
        assert_eq!(runs, vec![vec![0, 1, 2, 3]]);
    }

    #[test]
    fn ring_entirely_in_buffer_yields_no_runs() {
        let ring = [(-64., 10.), (-10., 10.), (-10., 100.), (-64., 100.)];
        let runs = tile_ring_boundary_runs(ring, 4096.);
        assert!(runs.is_empty());
    }
}
