//! ECS-free MVT geometry parse core.
//!
//! Decodes an MVT tile, projects tile coordinates to geographic/center space and
//! aggregates the vertices of each matched target layer into plain `Vec` buffers.
//! No batch-id assignment, tag registration or entity spawning happens here: the
//! output is pure data that the main thread finalizes (or that is transferred out
//! of a Web Worker). See [`parse_mvt_tile`].

use std::sync::Arc;

use geozero::GeomProcessor;
use geozero::mvt::{Message, Tile as MvtTile, process_geom, tile};
use navara_core::{CRS, TileXYZ, WGS84_64};
use navara_geometry::{
    Hierarchy, WindingOrder, is_closed_flat_ring, open_ring_len, tile_ring_boundary_runs,
};
use navara_math::{FloatType, Vec3};

use super::config::{LayerParseConfig, LayerParseKind, PointEmitter};
use super::pos_converter::PosConverter;

// ============================================================================
// Output types
// ============================================================================

/// Plain, ECS-free geometry payload for one parsed group.
///
/// The field layout intentionally mirrors the builder-side accumulators in
/// `navara_feature_component` so finalization is a direct field move.
#[derive(Debug, PartialEq)]
pub enum ParsedGeometry {
    Points {
        /// Geographic coordinates (lon, lat, 0) kept for terrain height updates.
        coords: Vec<Vec3>,
        batch_indices: Vec<u32>,
        /// RTC-encoded positions relative to the tile center (3 f32 per vertex).
        encoded_coords: Vec<f32>,
    },
    Polylines {
        points: Vec<f64>,
        points_sizes: Vec<u32>,
        batch_indices: Vec<u32>,
    },
    Polygons {
        outer_rings: Vec<f64>,
        outer_ring_sizes: Vec<u32>,
        holes: Vec<f64>,
        holes_total_sizes: Vec<u32>,
        holes_sizes: Vec<u32>,
        holes_boundaries: Vec<u32>,
        expected_winding_orders: Vec<u8>,
        batch_indices: Vec<u32>,
    },
}

impl ParsedGeometry {
    /// Number of geometry items. One global batch id must be generated per item
    /// during finalization; this equals `batch_indices.len()` for every kind.
    pub fn item_count(&self) -> usize {
        match self {
            ParsedGeometry::Points { batch_indices, .. } => batch_indices.len(),
            ParsedGeometry::Polylines { batch_indices, .. } => batch_indices.len(),
            ParsedGeometry::Polygons { batch_indices, .. } => batch_indices.len(),
        }
    }
}

/// One parsed geometry group for a single (layer, kind) pair.
pub struct ParsedLayerGroup {
    pub layer_id: String,
    pub kind: LayerParseKind,
    /// Number of distinct features that produced geometry for this kind.
    pub feature_count: u32,
    /// All per-feature MVT tag pairs concatenated, in commit order.
    pub feature_tags_flat: Vec<u32>,
    /// Per-feature tag counts, parallel to `feature_count`.
    pub feature_tag_sizes: Vec<u32>,
    pub keys: Arc<Vec<String>>,
    pub values: Arc<Vec<tile::Value>>,
    pub geometry: ParsedGeometry,
}

/// Flatten geographic `Vec3` coordinates into a packed `[x, y, z, ...]` buffer.
///
/// Inverse of [`unflatten_vec3`]. Both live here so the pack order is single-
/// sourced: the Web Worker packs point coordinates with this before transfer and
/// the main thread unpacks them with `unflatten_vec3` on completion.
pub fn flatten_vec3(coords: Vec<Vec3>) -> Vec<f64> {
    let mut out = Vec::with_capacity(coords.len() * 3);
    for c in coords {
        out.push(c.x);
        out.push(c.y);
        out.push(c.z);
    }
    out
}

/// Unpack a packed `[x, y, z, ...]` buffer into `Vec3`s. Inverse of [`flatten_vec3`].
///
/// `flat.len()` must be a multiple of 3 — always true for buffers produced by
/// [`flatten_vec3`]; a remainder means the packed streams and their meta got out
/// of sync (version skew or a corrupt tile), which would otherwise surface only
/// as silently mismatched coordinate/batch-index lengths downstream.
pub fn unflatten_vec3(flat: &[f64]) -> Vec<Vec3> {
    debug_assert!(
        flat.len().is_multiple_of(3),
        "packed vec3 stream length {} is not a multiple of 3",
        flat.len()
    );
    flat.as_chunks::<3>()
        .0
        .iter()
        .map(|&[x, y, z]| Vec3::new(x, y, z))
        .collect()
}

// ============================================================================
// Internal per-kind accumulation
// ============================================================================

/// Growing plain buffers for a single geometry kind.
enum GeomBuf {
    Points {
        coords: Vec<Vec3>,
        batch_indices: Vec<u32>,
        encoded_coords: Vec<f32>,
    },
    Polylines {
        points: Vec<f64>,
        points_sizes: Vec<u32>,
        batch_indices: Vec<u32>,
    },
    Polygons {
        outer_rings: Vec<f64>,
        outer_ring_sizes: Vec<u32>,
        holes: Vec<f64>,
        holes_total_sizes: Vec<u32>,
        holes_sizes: Vec<u32>,
        holes_boundaries: Vec<u32>,
        expected_winding_orders: Vec<u8>,
        batch_indices: Vec<u32>,
    },
}

impl GeomBuf {
    fn new(kind: LayerParseKind) -> Self {
        match kind {
            LayerParseKind::Point | LayerParseKind::Billboard | LayerParseKind::Text => {
                GeomBuf::Points {
                    coords: Vec::new(),
                    batch_indices: Vec::new(),
                    encoded_coords: Vec::new(),
                }
            }
            LayerParseKind::Polyline => GeomBuf::Polylines {
                points: Vec::new(),
                points_sizes: Vec::new(),
                batch_indices: Vec::new(),
            },
            LayerParseKind::Polygon => GeomBuf::Polygons {
                outer_rings: Vec::new(),
                outer_ring_sizes: Vec::new(),
                holes: Vec::new(),
                holes_total_sizes: Vec::new(),
                holes_sizes: Vec::new(),
                holes_boundaries: Vec::new(),
                expected_winding_orders: Vec::new(),
                batch_indices: Vec::new(),
            },
        }
    }

    fn into_parsed(self) -> ParsedGeometry {
        match self {
            GeomBuf::Points {
                coords,
                batch_indices,
                encoded_coords,
            } => ParsedGeometry::Points {
                coords,
                batch_indices,
                encoded_coords,
            },
            GeomBuf::Polylines {
                points,
                points_sizes,
                batch_indices,
            } => ParsedGeometry::Polylines {
                points,
                points_sizes,
                batch_indices,
            },
            GeomBuf::Polygons {
                outer_rings,
                outer_ring_sizes,
                holes,
                holes_total_sizes,
                holes_sizes,
                holes_boundaries,
                expected_winding_orders,
                batch_indices,
            } => ParsedGeometry::Polygons {
                outer_rings,
                outer_ring_sizes,
                holes,
                holes_total_sizes,
                holes_sizes,
                holes_boundaries,
                expected_winding_orders,
                batch_indices,
            },
        }
    }
}

/// Per-kind group state, tracking per-feature batch indices while accumulating.
struct GroupAccum {
    kind: LayerParseKind,
    feature_count: u32,
    committed: bool,
    current_batch_index: u32,
    feature_tags_flat: Vec<u32>,
    feature_tag_sizes: Vec<u32>,
    geom: GeomBuf,
}

impl GroupAccum {
    fn new(kind: LayerParseKind) -> Self {
        Self {
            kind,
            feature_count: 0,
            committed: false,
            current_batch_index: 0,
            feature_tags_flat: Vec::new(),
            feature_tag_sizes: Vec::new(),
            geom: GeomBuf::new(kind),
        }
    }
}

// ============================================================================
// GeomProcessor
// ============================================================================

/// Accumulation state for one matched target layer: its parse config plus one
/// [`GroupAccum`] per geometry kind it has emitted so far.
///
/// Several target layers can share a single MVT sublayer. They are all walked
/// in one pass — the tile is decoded and projected once — and only feature
/// emission fans out into one `LayerAccum` per layer.
struct LayerAccum<'a> {
    config: &'a LayerParseConfig,
    groups: Vec<GroupAccum>,
}

impl LayerAccum<'_> {
    /// Ensure a group for `kind` exists, commit the current feature into it on
    /// first use, and return `(group_index, batch_index)`. Returning the index
    /// lets callers address the group directly via `groups[idx]` instead of
    /// re-scanning `groups` for `kind` on every accumulated item.
    fn commit_group(&mut self, kind: LayerParseKind, pending_tags: &[u32]) -> (usize, u32) {
        let idx = match self.groups.iter().position(|g| g.kind == kind) {
            Some(idx) => idx,
            None => {
                self.groups.push(GroupAccum::new(kind));
                self.groups.len() - 1
            }
        };
        let group = &mut self.groups[idx];
        if !group.committed {
            group.current_batch_index = group.feature_count;
            group.feature_count += 1;
            group.committed = true;
            group.feature_tags_flat.extend_from_slice(pending_tags);
            group.feature_tag_sizes.push(pending_tags.len() as u32);
        }
        (idx, group.current_batch_index)
    }
}

/// Which source geometry a point is being emitted from, selecting the matching
/// opt-in flag on a [`PointEmitter`].
#[derive(Clone, Copy)]
enum PointSource {
    /// Native point/multipoint geometry.
    Points,
    /// Derived from line-string vertices.
    Lines,
    /// Derived from polygon-ring vertices.
    Polygons,
}

impl PointSource {
    fn enabled(self, emitter: &PointEmitter) -> bool {
        match self {
            PointSource::Points => emitter.from_points,
            PointSource::Lines => emitter.from_lines,
            PointSource::Polygons => emitter.from_polygons,
        }
    }
}

/// Projection modes a layer's geometry can be expressed in. Indexes the
/// processor's per-mode vertex buffers and consumer tables, so layers sharing a
/// mode also share the projected vertices instead of re-projecting per layer.
const GEOGRAPHIC: usize = 0;
const FLAT: usize = 1;
const PROJECTIONS: usize = 2;

/// Projection mode index for a config (`flat` drapes on the tile center).
fn projection_of(config: &LayerParseConfig) -> usize {
    if config.flat { FLAT } else { GEOGRAPHIC }
}

/// Vertex buffers for a single projection mode, shared by every layer using it.
#[derive(Default)]
struct RingBufs {
    /// Pre-projected coordinates for the current linestring/ring.
    projected: Vec<FloatType>,
    /// Polygon outer ring.
    outer_ring: Vec<FloatType>,
    /// Polygon hole rings, built during `linestring_end`.
    holes: Vec<Hierarchy>,
}

/// A [`GeomProcessor`] that walks MVT geometry commands and aggregates vertices
/// into per-(layer, kind) plain buffers, projecting coordinates via
/// [`PosConverter`].
struct MvtFeatureProcessor<'a> {
    layers: Vec<LayerAccum<'a>>,
    converter: &'a PosConverter,
    rtc_center: Vec3,

    /// Vertex buffers per projection mode ([`GEOGRAPHIC`] / [`FLAT`]).
    rings: [RingBufs; PROJECTIONS],

    /// Tags of the feature currently being processed (committed lazily per kind).
    pending_tags: Option<Vec<u32>>,
    /// Whether we are inside a point/multipoint geometry.
    in_point: bool,
    /// Whether `linestring_end` should push to rings (polygon) vs a polyline.
    in_polygon: bool,
    /// Raw (unprojected) vertices of the current linestring/ring, collected
    /// only when a point emitter derives from line/polygon geometry. Points
    /// always project geographically, so the flat-projected buffer cannot be
    /// reused for them.
    raw_ring: Vec<(f64, f64)>,

    // --- Dispatch tables, derived from the configs once per MVT sublayer. ---
    /// Every layer's point emitters as `(layer index, emitter)` pairs.
    emitters: Vec<(usize, PointEmitter)>,
    /// Layer indices consuming line geometry as polylines, per projection mode.
    line_consumers: [Vec<usize>; PROJECTIONS],
    /// Layer indices consuming polygon geometry as fills, per projection mode.
    polygon_consumers: [Vec<usize>; PROJECTIONS],
    /// Layer indices deriving boundary polylines from polygon rings.
    ring_polyline_consumers: Vec<usize>,
    /// Whether any layer needs the projection mode at that index filled.
    projection_used: [bool; PROJECTIONS],
    /// Whether any point emitter derives from native point geometry.
    derive_points_from_points: bool,
    /// Whether any point emitter derives from line-string vertices.
    derive_points_from_lines: bool,
    /// Whether any point emitter derives from polygon-ring vertices.
    derive_points_from_polygons: bool,
    /// Whether any layer's derived boundary polylines render as real (non-draped)
    /// geometry, which requires splitting rings at tile-clip edges (the raw ring
    /// is collected alongside `projected` for the split).
    derive_boundary_runs: bool,
    /// Memo of `height -> world position` for the coordinate being emitted, so
    /// emitters sharing a height (the common case across layers) pay for the
    /// geographic-to-cartesian conversion once.
    height_cache: Vec<(f32, Vec3)>,
}

impl<'a> MvtFeatureProcessor<'a> {
    fn new(
        converter: &'a PosConverter,
        configs: &[&'a LayerParseConfig],
        rtc_center: Vec3,
    ) -> Self {
        let mut emitters = Vec::new();
        let mut line_consumers: [Vec<usize>; PROJECTIONS] = Default::default();
        let mut polygon_consumers: [Vec<usize>; PROJECTIONS] = Default::default();
        let mut ring_polyline_consumers = Vec::new();
        let mut projection_used = [false; PROJECTIONS];
        let mut derive_points_from_points = false;
        let mut derive_points_from_lines = false;
        let mut derive_points_from_polygons = false;
        let mut derive_boundary_runs = false;

        for (index, config) in configs.iter().enumerate() {
            let projection = projection_of(config);
            for emitter in &config.point_emitters {
                emitters.push((index, *emitter));
                derive_points_from_points |= emitter.from_points;
                derive_points_from_lines |= emitter.from_lines;
                derive_points_from_polygons |= emitter.from_polygons;
            }
            if config.polyline {
                line_consumers[projection].push(index);
                projection_used[projection] = true;
            }
            if config.polygon {
                polygon_consumers[projection].push(index);
                projection_used[projection] = true;
            }
            if config.polyline_from_polygons {
                ring_polyline_consumers.push(index);
                projection_used[projection] = true;
                derive_boundary_runs |= projection == GEOGRAPHIC;
            }
        }

        Self {
            layers: configs
                .iter()
                .map(|config| LayerAccum {
                    config,
                    groups: Vec::new(),
                })
                .collect(),
            converter,
            rtc_center,
            rings: Default::default(),
            pending_tags: None,
            in_point: false,
            in_polygon: false,
            raw_ring: Vec::new(),
            emitters,
            line_consumers,
            polygon_consumers,
            ring_polyline_consumers,
            projection_used,
            derive_points_from_points,
            derive_points_from_lines,
            derive_points_from_polygons,
            derive_boundary_runs,
            height_cache: Vec::new(),
        }
    }

    fn begin_feature(&mut self, tags: Vec<u32>) {
        self.pending_tags = Some(tags);
        for layer in &mut self.layers {
            for group in &mut layer.groups {
                group.committed = false;
            }
        }
    }

    /// Commit the current feature into layer `index`'s group for `kind`.
    /// Borrows the pending tags and the target layer disjointly (distinct
    /// fields) so the tags are appended without an intermediate clone.
    fn commit(&mut self, index: usize, kind: LayerParseKind) -> (usize, u32) {
        let Self {
            layers,
            pending_tags,
            ..
        } = self;
        layers[index].commit_group(kind, pending_tags.as_deref().unwrap_or(&[]))
    }

    /// Push one already-projected point into layer `index`'s group for `kind`.
    fn push_point(&mut self, index: usize, kind: LayerParseKind, coords: Vec3, world_pos: Vec3) {
        let rtc = [
            (world_pos.x - self.rtc_center.x) as f32,
            (world_pos.y - self.rtc_center.y) as f32,
            (world_pos.z - self.rtc_center.z) as f32,
        ];
        let (group_index, batch_index) = self.commit(index, kind);
        if let GeomBuf::Points {
            coords: c,
            batch_indices,
            encoded_coords,
        } = &mut self.layers[index].groups[group_index].geom
        {
            c.push(coords);
            batch_indices.push(batch_index);
            encoded_coords.extend_from_slice(&rtc);
        }
    }

    /// Whether any point emitter derives points from `source`, resolved from
    /// the flags computed once per MVT sublayer.
    fn derives_points(&self, source: PointSource) -> bool {
        match source {
            PointSource::Points => self.derive_points_from_points,
            PointSource::Lines => self.derive_points_from_lines,
            PointSource::Polygons => self.derive_points_from_polygons,
        }
    }

    /// Project a single tile coordinate and emit it for every emitter (of every
    /// layer) that opted into `source`. The projection and the per-height world
    /// position are computed once and reused, so a second layer costs one push
    /// per emitter rather than a second projection.
    fn emit_points(&mut self, x: f64, y: f64, source: PointSource) {
        // Bail before projecting: a layer whose point material opts out of this
        // source (`geometryTypes` without the matching type) must not pay a
        // projection per coordinate.
        if !self.derives_points(source) {
            return;
        }
        let (px, py) = self.converter.project_point(x, y);
        let coords = Vec3::new(px, py, 0.0 as FloatType);
        self.height_cache.clear();
        for i in 0..self.emitters.len() {
            let (index, emitter) = self.emitters[i];
            if !source.enabled(&emitter) {
                continue;
            }
            let world_pos = match self.height_cache.iter().find(|(h, _)| *h == emitter.height) {
                Some(&(_, world_pos)) => world_pos,
                None => {
                    let world_pos = CRS::Geographic.to_vec3(WGS84_64, coords, emitter.height);
                    self.height_cache.push((emitter.height, world_pos));
                    world_pos
                }
            };
            self.push_point(index, emitter.kind, coords, world_pos);
        }
    }

    /// Emit derived points for the raw vertices collected for the current
    /// linestring/ring, honoring each emitter's `from_lines`/`from_polygons`.
    /// Polygon rings skip the closing duplicate vertex when present.
    fn emit_derived_ring_points(&mut self, is_polygon_ring: bool) {
        let source = if is_polygon_ring {
            PointSource::Polygons
        } else {
            PointSource::Lines
        };
        if !self.derives_points(source) || self.raw_ring.is_empty() {
            return;
        }
        let ring = std::mem::take(&mut self.raw_ring);
        let count = if is_polygon_ring {
            open_ring_len(&ring, |p| *p)
        } else {
            ring.len()
        };
        for &(x, y) in &ring[..count] {
            self.emit_points(x, y, source);
        }
        // Hand the buffer (and its capacity) back for the next ring.
        self.raw_ring = ring;
        self.raw_ring.clear();
    }

    /// Push one polyline into layer `index`'s polyline group.
    fn push_polyline(&mut self, index: usize, points: Vec<f64>) {
        if points.is_empty() {
            return;
        }
        let (group_index, batch_index) = self.commit(index, LayerParseKind::Polyline);
        if let GeomBuf::Polylines {
            points: p,
            points_sizes,
            batch_indices,
        } = &mut self.layers[index].groups[group_index].geom
        {
            points_sizes.push(points.len() as u32);
            p.extend(points);
            batch_indices.push(batch_index);
        }
    }

    /// Emit the current linestring as a polyline for every layer consuming line
    /// geometry. Each projection buffer moves into its last consumer, so a
    /// single layer per projection stays copy-free.
    fn accumulate_polyline(&mut self) {
        for projection in 0..PROJECTIONS {
            let count = self.line_consumers[projection].len();
            for i in 0..count {
                let index = self.line_consumers[projection][i];
                let points = if i + 1 == count {
                    std::mem::take(&mut self.rings[projection].projected)
                } else {
                    self.rings[projection].projected.clone()
                };
                self.push_polyline(index, points);
            }
        }
    }

    /// Classify the current ring's tile-clip edges into the vertex runs that
    /// survive. Non-draped boundaries render as real geometry, so edges
    /// introduced by tile clipping must not be drawn: they would trace the tile
    /// outline through polygon interiors. The runs depend only on the raw ring,
    /// so they are computed once per ring and shared by every geographic
    /// consumer. Draped boundaries keep the whole ring — the bake clips the
    /// buffer zone anyway — and get no runs.
    fn ring_boundary_runs(&self) -> Vec<Vec<usize>> {
        if !self.derive_boundary_runs || self.rings[GEOGRAPHIC].projected.is_empty() {
            return Vec::new();
        }
        debug_assert_eq!(
            self.raw_ring.len() * 3,
            self.rings[GEOGRAPHIC].projected.len()
        );
        // Strip a closing duplicate so run indices address unique vertices.
        let n = open_ring_len(&self.raw_ring, |p| *p);
        tile_ring_boundary_runs(self.raw_ring[..n].iter().copied(), self.converter.extent())
    }

    /// Accumulate the current projected ring as a closed polyline for layer
    /// `index` (polygon-boundary derivation). MVT rings close via `ClosePath`
    /// without repeating the first vertex, so the ring is closed here when
    /// needed. The ring is copied, never moved: the polygon fill still consumes
    /// it afterwards. `runs` are this ring's surviving vertex runs from
    /// [`Self::ring_boundary_runs`], used by non-draped (geographic) layers.
    fn accumulate_ring_polyline(&mut self, index: usize, runs: &[Vec<usize>]) {
        let projection = projection_of(self.layers[index].config);
        if self.rings[projection].projected.is_empty() {
            return;
        }
        if projection == GEOGRAPHIC {
            for run in runs {
                let mut points = Vec::with_capacity(run.len() * 3);
                for &i in run {
                    points.extend_from_slice(&self.rings[projection].projected[i * 3..i * 3 + 3]);
                }
                self.push_polyline(index, points);
            }
            return;
        }
        let needs_close = self.rings[projection].projected.len() >= 6
            && !is_closed_flat_ring(&self.rings[projection].projected);
        let (group_index, batch_index) = self.commit(index, LayerParseKind::Polyline);
        // Extend the group buffer straight from `projected` (disjoint field
        // borrows) instead of cloning the ring into a temporary Vec.
        let Self { layers, rings, .. } = self;
        if let GeomBuf::Polylines {
            points,
            points_sizes,
            batch_indices,
        } = &mut layers[index].groups[group_index].geom
        {
            let projected = &rings[projection].projected;
            let closing = if needs_close { 3 } else { 0 };
            points_sizes.push((projected.len() + closing) as u32);
            points.extend_from_slice(projected);
            if needs_close {
                points.extend_from_slice(&projected[..3]);
            }
            batch_indices.push(batch_index);
        }
    }

    /// Push one polygon (outer ring plus holes) into layer `index`'s polygon group.
    fn push_polygon(&mut self, index: usize, outer: Vec<FloatType>, holes: Vec<Hierarchy>) {
        let winding_order = if self.layers[index].config.flat {
            WindingOrder::CounterClockwise
        } else {
            WindingOrder::Clockwise
        };
        let (group_index, batch_index) = self.commit(index, LayerParseKind::Polygon);
        if let GeomBuf::Polygons {
            outer_rings,
            outer_ring_sizes,
            holes: hole_buf,
            holes_total_sizes,
            holes_sizes,
            holes_boundaries,
            expected_winding_orders,
            batch_indices,
        } = &mut self.layers[index].groups[group_index].geom
        {
            outer_ring_sizes.push(outer.len() as u32);
            outer_rings.extend(outer);
            expected_winding_orders.push(winding_order as u8);

            let mut total_hole_size: u32 = 0;
            let hole_count = holes.len() as u32;
            for hole in &holes {
                let hole_size = hole.outer_ring.len() as u32;
                hole_buf.extend_from_slice(&hole.outer_ring);
                holes_sizes.push(hole_size);
                expected_winding_orders.push(hole.expected_winding_order as u8);
                total_hole_size += hole_size;
            }
            holes_total_sizes.push(total_hole_size);
            holes_boundaries.push(hole_count);
            batch_indices.push(batch_index);
        }
    }

    /// Emit the current polygon for every layer consuming polygon geometry.
    /// Each projection's rings move into that projection's last consumer.
    fn accumulate_polygon(&mut self) {
        for projection in 0..PROJECTIONS {
            let count = self.polygon_consumers[projection].len();
            if !self.rings[projection].outer_ring.is_empty() {
                for i in 0..count {
                    let index = self.polygon_consumers[projection][i];
                    let (outer, holes) = if i + 1 == count {
                        (
                            std::mem::take(&mut self.rings[projection].outer_ring),
                            std::mem::take(&mut self.rings[projection].holes),
                        )
                    } else {
                        (
                            self.rings[projection].outer_ring.clone(),
                            self.rings[projection].holes.clone(),
                        )
                    };
                    self.push_polygon(index, outer, holes);
                }
            }
            self.rings[projection].outer_ring.clear();
            self.rings[projection].holes.clear();
        }
    }
}

impl GeomProcessor for MvtFeatureProcessor<'_> {
    fn multi_dim(&self) -> bool {
        true
    }

    fn coordinate(
        &mut self,
        x: f64,
        y: f64,
        _z: Option<f64>,
        _m: Option<f64>,
        _t: Option<f64>,
        _tm: Option<u64>,
        _idx: usize,
    ) -> geozero::error::Result<()> {
        if self.in_point {
            self.emit_points(x, y, PointSource::Points);
        } else {
            if self.projection_used[GEOGRAPHIC] {
                let (gx, gy) = self.converter.project_point(x, y);
                self.rings[GEOGRAPHIC]
                    .projected
                    .extend_from_slice(&[gx, gy, 0.0]);
            }
            if self.projection_used[FLAT] {
                let (cx, cy) = self.converter.project_point_on_center(x, y);
                self.rings[FLAT].projected.extend_from_slice(&[cx, cy, 0.0]);
            }
            // Keep the raw vertex around for point derivation (points always
            // project geographically regardless of `flat`) and for splitting
            // non-draped boundary polylines at tile-clip edges.
            if if self.in_polygon {
                self.derive_points_from_polygons || self.derive_boundary_runs
            } else {
                self.derive_points_from_lines
            } {
                self.raw_ring.push((x, y));
            }
        }
        Ok(())
    }

    fn point_begin(&mut self, _idx: usize) -> geozero::error::Result<()> {
        self.in_point = true;
        Ok(())
    }

    fn point_end(&mut self, _idx: usize) -> geozero::error::Result<()> {
        self.in_point = false;
        Ok(())
    }

    fn multipoint_begin(&mut self, _size: usize, _idx: usize) -> geozero::error::Result<()> {
        self.in_point = true;
        Ok(())
    }

    fn multipoint_end(&mut self, _idx: usize) -> geozero::error::Result<()> {
        self.in_point = false;
        Ok(())
    }

    fn linestring_begin(
        &mut self,
        _tagged: bool,
        size: usize,
        _idx: usize,
    ) -> geozero::error::Result<()> {
        for projection in 0..PROJECTIONS {
            self.rings[projection].projected.clear();
            if self.projection_used[projection] {
                self.rings[projection].projected.reserve(size * 3);
            }
        }
        self.raw_ring.clear();
        Ok(())
    }

    fn linestring_end(&mut self, _tagged: bool, _idx: usize) -> geozero::error::Result<()> {
        if self.in_polygon {
            // Derived representations read the ring before it moves into the
            // polygon buffers.
            let runs = self.ring_boundary_runs();
            for i in 0..self.ring_polyline_consumers.len() {
                let index = self.ring_polyline_consumers[i];
                self.accumulate_ring_polyline(index, &runs);
            }
            self.emit_derived_ring_points(true);
            for projection in 0..PROJECTIONS {
                if !self.projection_used[projection] {
                    continue;
                }
                let ring = std::mem::take(&mut self.rings[projection].projected);
                if self.rings[projection].outer_ring.is_empty() {
                    self.rings[projection].outer_ring = ring;
                } else {
                    self.rings[projection].holes.push(Hierarchy {
                        outer_ring: ring,
                        holes: None,
                        expected_winding_order: if projection == FLAT {
                            WindingOrder::Clockwise
                        } else {
                            WindingOrder::CounterClockwise
                        },
                    });
                }
            }
        } else {
            self.emit_derived_ring_points(false);
            self.accumulate_polyline();
        }
        Ok(())
    }

    fn polygon_begin(
        &mut self,
        _tagged: bool,
        _size: usize,
        _idx: usize,
    ) -> geozero::error::Result<()> {
        self.in_polygon = true;
        for projection in 0..PROJECTIONS {
            self.rings[projection].outer_ring.clear();
            self.rings[projection].holes.clear();
        }
        Ok(())
    }

    fn polygon_end(&mut self, _tagged: bool, _idx: usize) -> geozero::error::Result<()> {
        self.accumulate_polygon();
        self.in_polygon = false;
        Ok(())
    }
}

// ============================================================================
// Entry points
// ============================================================================

/// Parse an MVT tile into plain per-(layer, kind) geometry groups.
///
/// `rtc_center` is the tile-relative center used to encode point positions; the
/// caller computes it from the tile extent (or `Vec3::ZERO` when unknown).
/// `configs` describes each matched target layer. Every config matching an MVT
/// sublayer is served from the same walk: the sublayer is decoded and projected
/// once and only feature emission fans out per layer, so pointing several layers
/// at one source costs geometry buffers, not a repeated parse.
pub fn parse_mvt_tile(
    mvt_bin: &[u8],
    xyz: TileXYZ,
    rtc_center: Vec3,
    configs: &[LayerParseConfig],
) -> Vec<ParsedLayerGroup> {
    if configs.is_empty() {
        return Vec::new();
    }
    let Ok(tile) = MvtTile::decode(mvt_bin) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for mvt_layer in tile.layers {
        parse_layer(mvt_layer, xyz, rtc_center, configs, &mut result);
    }
    result
}

/// Select the configs of every target layer that wants this MVT sublayer.
///
/// A layer id appearing twice keeps only its last config: the same layer cannot
/// render the same features twice, and the finalize side resolves a group's
/// appearances by last matching id.
fn matching_configs<'a>(
    configs: &'a [LayerParseConfig],
    sublayer: &str,
) -> Vec<&'a LayerParseConfig> {
    let mut matched: Vec<&LayerParseConfig> = Vec::new();
    for config in configs {
        if !config.matches_sublayer(sublayer) {
            continue;
        }
        match matched.iter().position(|c| c.layer_id == config.layer_id) {
            Some(existing) => matched[existing] = config,
            None => matched.push(config),
        }
    }
    matched
}

fn parse_layer(
    mut mvt_layer: tile::Layer,
    xyz: TileXYZ,
    rtc_center: Vec3,
    configs: &[LayerParseConfig],
    out: &mut Vec<ParsedLayerGroup>,
) {
    let matched = matching_configs(configs, &mvt_layer.name);
    if matched.is_empty() {
        return;
    }

    let extent = mvt_layer.extent.unwrap_or(4096);
    let converter = PosConverter::new(xyz, extent);

    let keys = Arc::new(std::mem::take(&mut mvt_layer.keys));
    let values = Arc::new(std::mem::take(&mut mvt_layer.values));

    let mut processor = MvtFeatureProcessor::new(&converter, &matched, rtc_center);
    for feature in &mut mvt_layer.features {
        let tags = std::mem::take(&mut feature.tags);
        processor.begin_feature(tags);
        let _ = process_geom(feature, &mut processor);
    }

    for layer in processor.layers {
        for group in layer.groups {
            let geometry = group.geom.into_parsed();
            if geometry.item_count() == 0 {
                continue;
            }
            out.push(ParsedLayerGroup {
                layer_id: layer.config.layer_id.clone(),
                kind: group.kind,
                feature_count: group.feature_count,
                feature_tags_flat: group.feature_tags_flat,
                feature_tag_sizes: group.feature_tag_sizes,
                keys: Arc::clone(&keys),
                values: Arc::clone(&values),
                geometry,
            });
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;

    /// Encode a zigzag integer (MVT spec parameter encoding).
    fn zigzag(n: i32) -> u32 {
        ((n << 1) ^ (n >> 31)) as u32
    }

    /// Build an MVT command integer.
    fn command(id: u32, count: u32) -> u32 {
        (count << 3) | id
    }

    fn point_feature(x: i32, y: i32, tags: Vec<u32>) -> tile::Feature {
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Point as i32),
            geometry: vec![command(1, 1), zigzag(x), zigzag(y)],
        }
    }

    fn multipoint_feature(points: &[(i32, i32)], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        if !points.is_empty() {
            geometry.push(command(1, points.len() as u32));
            let mut prev = (0i32, 0i32);
            for &(x, y) in points {
                geometry.push(zigzag(x - prev.0));
                geometry.push(zigzag(y - prev.1));
                prev = (x, y);
            }
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Point as i32),
            geometry,
        }
    }

    fn linestring_feature(points: &[(i32, i32)], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        if let Some(&(x0, y0)) = points.first() {
            geometry.push(command(1, 1));
            geometry.push(zigzag(x0));
            geometry.push(zigzag(y0));
            if points.len() > 1 {
                geometry.push(command(2, (points.len() - 1) as u32));
                let mut prev = (x0, y0);
                for &(x, y) in &points[1..] {
                    geometry.push(zigzag(x - prev.0));
                    geometry.push(zigzag(y - prev.1));
                    prev = (x, y);
                }
            }
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Linestring as i32),
            geometry,
        }
    }

    fn polygon_feature(ring: &[(i32, i32)], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        if let Some(&(x0, y0)) = ring.first() {
            geometry.push(command(1, 1));
            geometry.push(zigzag(x0));
            geometry.push(zigzag(y0));
            if ring.len() > 1 {
                geometry.push(command(2, (ring.len() - 1) as u32));
                let mut prev = (x0, y0);
                for &(x, y) in &ring[1..] {
                    geometry.push(zigzag(x - prev.0));
                    geometry.push(zigzag(y - prev.1));
                    prev = (x, y);
                }
            }
            geometry.push(command(7, 1)); // ClosePath
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Polygon as i32),
            geometry,
        }
    }

    /// A polygon feature with an outer ring followed by hole rings.
    fn polygon_with_holes_feature(rings: &[&[(i32, i32)]], tags: Vec<u32>) -> tile::Feature {
        let mut geometry = Vec::new();
        for ring in rings {
            if let Some(&(x0, y0)) = ring.first() {
                geometry.push(command(1, 1));
                geometry.push(zigzag(x0));
                geometry.push(zigzag(y0));
                if ring.len() > 1 {
                    geometry.push(command(2, (ring.len() - 1) as u32));
                    let mut prev = (x0, y0);
                    for &(x, y) in &ring[1..] {
                        geometry.push(zigzag(x - prev.0));
                        geometry.push(zigzag(y - prev.1));
                        prev = (x, y);
                    }
                }
                geometry.push(command(7, 1));
            }
        }
        tile::Feature {
            id: None,
            tags,
            r#type: Some(tile::GeomType::Polygon as i32),
            geometry,
        }
    }

    fn make_layer(name: &str, features: Vec<tile::Feature>) -> tile::Layer {
        tile::Layer {
            version: 2,
            name: name.to_string(),
            features,
            keys: vec!["name".to_string(), "class".to_string()],
            values: vec![],
            extent: Some(4096),
        }
    }

    fn encode_tile(layers: Vec<tile::Layer>) -> Vec<u8> {
        use geozero::mvt::Tile;
        Message::encode_to_vec(&Tile { layers })
    }

    fn xyz() -> TileXYZ {
        TileXYZ { x: 0, y: 0, z: 0 }
    }

    fn point_emitter() -> super::super::config::PointEmitter {
        super::super::config::PointEmitter {
            kind: LayerParseKind::Point,
            height: 0.0,
            from_points: true,
            from_lines: false,
            from_polygons: false,
        }
    }

    fn point_config() -> LayerParseConfig {
        LayerParseConfig {
            layer_id: "layer".to_string(),
            flat: false,
            point_emitters: vec![point_emitter()],
            polyline: false,
            polyline_from_polygons: false,
            polygon: false,
            limit_layers: None,
        }
    }

    fn polyline_config() -> LayerParseConfig {
        LayerParseConfig {
            layer_id: "layer".to_string(),
            flat: false,
            point_emitters: vec![],
            polyline: true,
            polyline_from_polygons: false,
            polygon: false,
            limit_layers: None,
        }
    }

    fn polygon_config() -> LayerParseConfig {
        LayerParseConfig {
            layer_id: "layer".to_string(),
            flat: false,
            point_emitters: vec![],
            polyline: false,
            polyline_from_polygons: false,
            polygon: true,
            limit_layers: None,
        }
    }

    #[test]
    fn parses_points_with_per_feature_batch_indices() {
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![
                point_feature(10, 20, vec![0, 0]),
                point_feature(30, 40, vec![0, 1]),
            ],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[point_config()]);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert_eq!(g.kind, LayerParseKind::Point);
        assert_eq!(g.feature_count, 2);
        assert_eq!(g.feature_tags_flat, vec![0, 0, 0, 1]);
        assert_eq!(g.feature_tag_sizes, vec![2, 2]);
        match &g.geometry {
            ParsedGeometry::Points {
                coords,
                batch_indices,
                encoded_coords,
            } => {
                assert_eq!(coords.len(), 2);
                assert_eq!(batch_indices, &vec![0, 1]);
                assert_eq!(encoded_coords.len(), 6);
            }
            _ => panic!("expected points"),
        }
    }

    #[test]
    fn multipoint_shares_batch_index() {
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![multipoint_feature(&[(1, 1), (2, 2), (3, 3)], vec![0, 0])],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[point_config()]);
        let g = &groups[0];
        assert_eq!(g.feature_count, 1);
        match &g.geometry {
            ParsedGeometry::Points {
                coords,
                batch_indices,
                ..
            } => {
                assert_eq!(coords.len(), 3);
                assert_eq!(batch_indices, &vec![0, 0, 0]);
            }
            _ => panic!("expected points"),
        }
    }

    #[test]
    fn parses_polylines() {
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![
                linestring_feature(&[(0, 0), (10, 10)], vec![0, 0]),
                linestring_feature(&[(20, 20), (30, 30), (40, 40)], vec![0, 1]),
            ],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[polyline_config()]);
        let g = &groups[0];
        assert_eq!(g.kind, LayerParseKind::Polyline);
        match &g.geometry {
            ParsedGeometry::Polylines {
                points,
                points_sizes,
                batch_indices,
            } => {
                assert_eq!(points_sizes, &vec![6, 9]); // 2 pts * 3, 3 pts * 3
                assert_eq!(points.len(), 15);
                assert_eq!(batch_indices, &vec![0, 1]);
            }
            _ => panic!("expected polylines"),
        }
    }

    #[test]
    fn parses_single_ring_polygon() {
        // Clockwise ring (MVT convention for outer rings).
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(0, 0), (100, 0), (100, 100), (0, 100)],
                vec![0, 0],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[polygon_config()]);
        let g = &groups[0];
        assert_eq!(g.kind, LayerParseKind::Polygon);
        assert_eq!(g.feature_count, 1);
        match &g.geometry {
            ParsedGeometry::Polygons {
                outer_ring_sizes,
                holes_boundaries,
                expected_winding_orders,
                batch_indices,
                ..
            } => {
                assert_eq!(outer_ring_sizes.len(), 1);
                assert_eq!(holes_boundaries, &vec![0]);
                assert_eq!(batch_indices, &vec![0]);
                assert_eq!(
                    expected_winding_orders,
                    &vec![WindingOrder::Clockwise as u8]
                );
            }
            _ => panic!("expected polygons"),
        }
    }

    #[test]
    fn multipolygon_shares_batch_index() {
        // Two exterior rings in a single feature (a multipolygon) accumulate as
        // two outer rings that share the feature's batch index.
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_with_holes_feature(
                &[
                    &[(0, 0), (100, 0), (100, 100), (0, 100)],
                    &[(200, 200), (300, 200), (300, 300), (200, 300)],
                ],
                vec![0, 0],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[polygon_config()]);
        let g = &groups[0];
        assert_eq!(g.feature_count, 1);
        match &g.geometry {
            ParsedGeometry::Polygons {
                outer_ring_sizes,
                batch_indices,
                ..
            } => {
                assert_eq!(outer_ring_sizes.len(), 2);
                assert_eq!(batch_indices, &vec![0, 0]);
            }
            _ => panic!("expected polygons"),
        }
    }

    #[test]
    fn limit_layers_selects_sublayer() {
        let bin = encode_tile(vec![
            make_layer("roads", vec![point_feature(1, 1, vec![])]),
            make_layer("buildings", vec![point_feature(2, 2, vec![])]),
        ]);
        let mut config = point_config();
        config.limit_layers = Some(vec!["buildings".to_string()]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        // Only the "buildings" sublayer matches.
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].geometry.item_count(), 1);
    }

    #[test]
    fn empty_configs_returns_nothing() {
        let bin = encode_tile(vec![make_layer("l", vec![point_feature(1, 1, vec![])])]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[]);
        assert!(groups.is_empty());
    }

    #[test]
    fn polyline_from_polygons_derives_closed_boundary_ring() {
        let mut config = polyline_config();
        config.polyline_from_polygons = true;
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(10, 10), (100, 10), (100, 100), (10, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert_eq!(g.kind, LayerParseKind::Polyline);
        assert_eq!(g.feature_count, 1);
        match &g.geometry {
            ParsedGeometry::Polylines {
                points,
                points_sizes,
                batch_indices,
            } => {
                // 4 ring vertices + closing vertex, 3 components each.
                assert_eq!(points_sizes, &vec![15]);
                assert_eq!(batch_indices, &vec![0]);
                // The derived boundary is closed: first vertex repeats at the end.
                assert_eq!(points[..3], points[points.len() - 3..]);
            }
            _ => panic!("expected polylines"),
        }
    }

    #[test]
    fn polyline_from_polygons_drops_border_coincident_clip_edges() {
        let mut config = polyline_config();
        config.polyline_from_polygons = true;
        // A buffer-less tileset clamps clipped vertices exactly onto the tile
        // border: the two edges lying on x = 0 and y = 0 are clip artifacts
        // and must not be stroked, leaving one open run over the real edges.
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(0, 0), (100, 0), (100, 100), (0, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 1);
        match &groups[0].geometry {
            ParsedGeometry::Polylines { points_sizes, .. } => {
                // One open run of 3 vertices: (100,0) -> (100,100) -> (0,100).
                assert_eq!(points_sizes, &vec![9]);
            }
            _ => panic!("expected polylines"),
        }
    }

    /// Stacking two non-draped boundary layers on one source (the outline
    /// recipe) classifies the ring's clip edges once and hands both layers the
    /// same runs.
    #[test]
    fn stacked_boundary_layers_get_identical_clip_edge_runs() {
        let mut first = polyline_config();
        first.layer_id = "first".to_string();
        first.polyline = false;
        first.polyline_from_polygons = true;
        let mut second = first.clone();
        second.layer_id = "second".to_string();

        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(0, 0), (100, 0), (100, 100), (0, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[first, second]);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].layer_id, "first");
        assert_eq!(groups[1].layer_id, "second");
        match (&groups[0].geometry, &groups[1].geometry) {
            (
                ParsedGeometry::Polylines {
                    points: a,
                    points_sizes: a_sizes,
                    ..
                },
                ParsedGeometry::Polylines {
                    points: b,
                    points_sizes: b_sizes,
                    ..
                },
            ) => {
                // Same single open run both layers see when parsed alone.
                assert_eq!(a_sizes, &vec![9]);
                assert_eq!(a_sizes, b_sizes);
                assert_eq!(a, b);
            }
            _ => panic!("expected polylines"),
        }
    }

    #[test]
    fn polyline_from_polygons_emits_ring_per_hole() {
        let mut config = polyline_config();
        config.polyline = false;
        config.polyline_from_polygons = true;
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_with_holes_feature(
                &[
                    &[(0, 0), (100, 0), (100, 100), (0, 100)],
                    &[(20, 20), (20, 80), (80, 80), (80, 20)],
                ],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert_eq!(g.kind, LayerParseKind::Polyline);
        match &g.geometry {
            ParsedGeometry::Polylines {
                points_sizes,
                batch_indices,
                ..
            } => {
                // Outer ring + hole ring share the feature's batch index.
                assert_eq!(points_sizes.len(), 2);
                assert_eq!(batch_indices, &vec![0, 0]);
            }
            _ => panic!("expected polylines"),
        }
    }

    #[test]
    fn non_draped_boundary_drops_tile_clip_edges() {
        // Two vertices sit in the tile's clip buffer (x = -64); the edge
        // between them is a clip artifact and must not render as geometry.
        let mut config = polyline_config();
        config.polyline = false;
        config.polyline_from_polygons = true;
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(-64, 10), (100, 10), (100, 100), (-64, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 1);
        match &groups[0].geometry {
            ParsedGeometry::Polylines {
                points,
                points_sizes,
                ..
            } => {
                // One open run over the four real vertices instead of a
                // closed five-vertex ring.
                assert_eq!(points_sizes, &vec![12]);
                assert_ne!(points[..3], points[points.len() - 3..]);
            }
            _ => panic!("expected polylines"),
        }
    }

    #[test]
    fn draped_boundary_keeps_full_ring_including_clip_edges() {
        // The draped bake clips the buffer zone itself, so the boundary stays
        // one closed ring even when it crosses the clip buffer.
        let mut config = polyline_config();
        config.flat = true;
        config.polyline = false;
        config.polyline_from_polygons = true;
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(-64, 10), (100, 10), (100, 100), (-64, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 1);
        match &groups[0].geometry {
            ParsedGeometry::Polylines {
                points,
                points_sizes,
                ..
            } => {
                assert_eq!(points_sizes, &vec![15]);
                assert_eq!(points[..3], points[points.len() - 3..]);
            }
            _ => panic!("expected polylines"),
        }
    }

    #[test]
    fn polygon_config_without_derivation_ignores_polygon_boundaries() {
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(0, 0), (100, 0), (100, 100), (0, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[polyline_config()]);
        assert!(groups.is_empty());
    }

    #[test]
    fn point_emitter_from_polygons_derives_ring_vertices() {
        let mut config = point_config();
        config.point_emitters[0].from_polygons = true;
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(0, 0), (100, 0), (100, 100), (0, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert_eq!(g.kind, LayerParseKind::Point);
        match &g.geometry {
            ParsedGeometry::Points { coords, .. } => {
                // 4 distinct ring vertices; the closing duplicate is skipped.
                assert_eq!(coords.len(), 4);
            }
            _ => panic!("expected points"),
        }
    }

    #[test]
    fn point_emitter_from_lines_derives_line_vertices() {
        let mut config = point_config();
        config.point_emitters[0].from_lines = true;
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![linestring_feature(&[(0, 0), (50, 50), (100, 0)], vec![])],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 1);
        match &groups[0].geometry {
            ParsedGeometry::Points { coords, .. } => {
                assert_eq!(coords.len(), 3);
            }
            _ => panic!("expected points"),
        }
    }

    #[test]
    fn point_emitter_can_opt_out_of_native_points() {
        let mut config = point_config();
        config.point_emitters[0].from_points = false;
        config.point_emitters[0].from_lines = true;
        let bin = encode_tile(vec![make_layer("l", vec![point_feature(1, 1, vec![])])]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert!(groups.is_empty());
    }

    #[test]
    fn derived_polyline_and_polygon_share_source_feature() {
        // A polygon feature rendered as both fill and boundary produces one
        // group per kind, each with its own batch index space.
        let mut config = polygon_config();
        config.polyline_from_polygons = true;
        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(0, 0), (100, 0), (100, 100), (0, 100)],
                vec![0, 0],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[config]);
        assert_eq!(groups.len(), 2);
        let kinds: Vec<_> = groups.iter().map(|g| g.kind).collect();
        assert!(kinds.contains(&LayerParseKind::Polygon));
        assert!(kinds.contains(&LayerParseKind::Polyline));
        for g in &groups {
            assert_eq!(g.feature_count, 1);
            assert_eq!(g.feature_tags_flat, vec![0, 0]);
        }
    }

    /// Two target layers on the same source must both render: one MVT sublayer
    /// feeds every matching config from a single walk.
    #[test]
    fn multiple_layers_share_one_sublayer() {
        let mut points = point_config();
        points.layer_id = "points".to_string();
        let mut polygons = polygon_config();
        polygons.layer_id = "polygons".to_string();

        let bin = encode_tile(vec![make_layer(
            "l",
            vec![
                point_feature(10, 20, vec![0, 0]),
                polygon_feature(&[(0, 0), (100, 0), (100, 100), (0, 100)], vec![0, 1]),
            ],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[points, polygons]);

        assert_eq!(groups.len(), 2);
        let point_group = groups
            .iter()
            .find(|g| g.layer_id == "points")
            .expect("point layer");
        assert_eq!(point_group.kind, LayerParseKind::Point);
        assert_eq!(point_group.geometry.item_count(), 1);
        // Batch indices are per group, so the polygon feature does not shift the
        // point layer's numbering.
        assert_eq!(point_group.feature_count, 1);
        assert_eq!(point_group.feature_tags_flat, vec![0, 0]);

        let polygon_group = groups
            .iter()
            .find(|g| g.layer_id == "polygons")
            .expect("polygon layer");
        assert_eq!(polygon_group.kind, LayerParseKind::Polygon);
        assert_eq!(polygon_group.geometry.item_count(), 1);
        assert_eq!(polygon_group.feature_count, 1);
        assert_eq!(polygon_group.feature_tags_flat, vec![0, 1]);
    }

    /// Two layers reading the same geometry kind each get their own group with
    /// identical vertices — the tile is walked and projected only once.
    #[test]
    fn layers_sharing_a_kind_get_identical_geometry() {
        let mut first = polyline_config();
        first.layer_id = "first".to_string();
        let mut second = polyline_config();
        second.layer_id = "second".to_string();

        let bin = encode_tile(vec![make_layer(
            "l",
            vec![linestring_feature(&[(0, 0), (10, 10), (20, 5)], vec![0, 0])],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[first, second]);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].layer_id, "first");
        assert_eq!(groups[1].layer_id, "second");
        match (&groups[0].geometry, &groups[1].geometry) {
            (
                ParsedGeometry::Polylines {
                    points: a,
                    points_sizes: a_sizes,
                    ..
                },
                ParsedGeometry::Polylines {
                    points: b,
                    points_sizes: b_sizes,
                    ..
                },
            ) => {
                assert_eq!(a_sizes, &vec![9]);
                assert_eq!(a, b);
                assert_eq!(a_sizes, b_sizes);
            }
            _ => panic!("expected polylines"),
        }
    }

    /// A clamped layer and a non-clamped layer project the same source ring
    /// differently, so each projection mode keeps its own vertex buffer.
    #[test]
    fn layers_with_different_projections_keep_their_own_vertices() {
        let mut geographic = polygon_config();
        geographic.layer_id = "geographic".to_string();
        let mut flat = polygon_config();
        flat.layer_id = "flat".to_string();
        flat.flat = true;

        let bin = encode_tile(vec![make_layer(
            "l",
            vec![polygon_feature(
                &[(0, 0), (100, 0), (100, 100), (0, 100)],
                vec![],
            )],
        )]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[geographic, flat]);

        assert_eq!(groups.len(), 2);
        let ring_of = |layer_id: &str| match &groups
            .iter()
            .find(|g| g.layer_id == layer_id)
            .expect("layer")
            .geometry
        {
            ParsedGeometry::Polygons {
                outer_rings,
                expected_winding_orders,
                ..
            } => (outer_rings.clone(), expected_winding_orders.clone()),
            _ => panic!("expected polygons"),
        };
        let (geographic_ring, geographic_winding) = ring_of("geographic");
        let (flat_ring, flat_winding) = ring_of("flat");

        assert_eq!(geographic_ring.len(), flat_ring.len());
        assert_ne!(geographic_ring, flat_ring);
        assert_eq!(geographic_winding, vec![WindingOrder::Clockwise as u8]);
        assert_eq!(flat_winding, vec![WindingOrder::CounterClockwise as u8]);
    }

    /// `limit_layers` stays per layer: each target layer sees only the MVT
    /// sublayers it asked for, even when they share a source.
    #[test]
    fn per_layer_sublayer_filters_apply_independently() {
        let mut roads = point_config();
        roads.layer_id = "roads".to_string();
        roads.limit_layers = Some(vec!["roads".to_string()]);
        let mut buildings = point_config();
        buildings.layer_id = "buildings".to_string();
        buildings.limit_layers = Some(vec!["buildings".to_string()]);
        let mut everything = point_config();
        everything.layer_id = "everything".to_string();

        let bin = encode_tile(vec![
            make_layer("roads", vec![point_feature(1, 1, vec![])]),
            make_layer("buildings", vec![point_feature(2, 2, vec![])]),
        ]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[roads, buildings, everything]);

        let items_for = |layer_id: &str| -> usize {
            groups
                .iter()
                .filter(|g| g.layer_id == layer_id)
                .map(|g| g.geometry.item_count())
                .sum()
        };
        assert_eq!(items_for("roads"), 1);
        assert_eq!(items_for("buildings"), 1);
        // The unfiltered layer takes both sublayers, as one group each.
        assert_eq!(items_for("everything"), 2);
        assert_eq!(groups.len(), 4);
    }

    /// The same layer id listed twice renders once: a layer cannot draw its own
    /// features twice, and the finalize side resolves appearances by last id.
    #[test]
    fn duplicate_layer_ids_render_once() {
        let bin = encode_tile(vec![make_layer("l", vec![point_feature(10, 20, vec![])])]);
        let groups = parse_mvt_tile(
            &bin,
            xyz(),
            Vec3::ZERO,
            &[point_config(), point_config(), polygon_config()],
        );
        // Three configs, one layer id: only the last one parses, and it wants
        // polygons, so a point-only tile yields nothing.
        assert!(groups.is_empty());
    }

    /// Emitters of different layers that share a height reuse one cartesian
    /// conversion, but different heights must still produce different positions.
    #[test]
    fn point_layers_keep_independent_heights() {
        let mut ground = point_config();
        ground.layer_id = "ground".to_string();
        let mut raised = point_config();
        raised.layer_id = "raised".to_string();
        raised.point_emitters[0].height = 1000.0;

        let bin = encode_tile(vec![make_layer("l", vec![point_feature(10, 20, vec![])])]);
        let groups = parse_mvt_tile(&bin, xyz(), Vec3::ZERO, &[ground, raised]);

        assert_eq!(groups.len(), 2);
        let encoded_of = |layer_id: &str| match &groups
            .iter()
            .find(|g| g.layer_id == layer_id)
            .expect("layer")
            .geometry
        {
            ParsedGeometry::Points {
                coords,
                encoded_coords,
                ..
            } => (coords.clone(), encoded_coords.clone()),
            _ => panic!("expected points"),
        };
        let (ground_coords, ground_encoded) = encoded_of("ground");
        let (raised_coords, raised_encoded) = encoded_of("raised");

        // The geographic coordinate is shared; only the encoded (height-bearing)
        // position differs.
        assert_eq!(ground_coords, raised_coords);
        assert_ne!(ground_encoded, raised_encoded);
    }

    #[test]
    fn unflatten_vec3_round_trips_flatten_vec3() {
        let coords = vec![Vec3::new(1., 2., 3.), Vec3::new(4., 5., 6.)];
        assert_eq!(unflatten_vec3(&flatten_vec3(coords.clone())), coords);
    }

    /// A stream whose length isn't a multiple of 3 means the packed streams and
    /// meta got out of sync; fail fast in debug instead of silently dropping the
    /// remainder.
    #[test]
    #[should_panic(expected = "not a multiple of 3")]
    #[cfg(debug_assertions)]
    fn unflatten_vec3_rejects_truncated_stream() {
        unflatten_vec3(&[1., 2., 3., 4.]);
    }
}
