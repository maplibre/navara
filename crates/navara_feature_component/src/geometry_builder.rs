use bevy_ecs::entity::Entity;
use bevy_ecs::system::Commands;
use bevy_log::warn;
use navara_buffer_store::BufferStore;
use navara_core::CRS;
use navara_geometry::{Hierarchy, WindingOrder};
use navara_layer::LayerId;
use navara_material::Appearance;
use navara_math::{Transform, Vec3};

use crate::{
    BatchedFeatureMarker,
    batch::{BatchedFeature, FeatureBatchId, GlobalBatchIds},
    batched_geometry::{
        EncodedPointPositions, PointGeometryAccumulator, PolygonGeometryAccumulator,
        PolylineGeometryAccumulator,
    },
    billboard::{BillboardGeometry, BillboardMarker},
    id::FeatureId,
    point::{PointGeometry, PointMarker},
    polygon::PolygonMarker,
    polyline::PolylineMarker,
    text::{TextGeometry, TextMarker},
};

/// Identifies which geometry-appearance combination a group belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum GeometryAppearanceKind {
    Point,
    Billboard,
    Text,
    Polyline,
    Polygon,
}

/// Pre-accumulated geometry data using Vec-based accumulators.
/// Converted to handle-based ECS components at finalize time.
pub enum AccumulatedGeometry {
    None,
    Points(PointGeometryAccumulator),
    Polylines(PolylineGeometryAccumulator),
    Polygons(PolygonGeometryAccumulator),
}

/// A group of features sharing the same [`GeometryAppearanceKind`], accumulating
/// geometry and batch state during construction.
///
/// # Lifecycle
///
/// 1. A format-specific builder (e.g., `GeometryBuilder` for GeoJSON,
///    `MvtGeometryBuilder` for MVT) calls [`GeometryGroups::register_kind`] to
///    create a `GeometryGroup` for each appearance kind encountered.
/// 2. For each feature, the builder calls [`GeometryGroups::begin_feature`] to
///    reset the `committed` flag, then calls one of the `track_*` methods
///    (`track_point_rtc`, `track_point_rte`, `track_polyline`, `track_polygon`)
///    to accumulate geometry into this group's [`AccumulatedGeometry`].
/// 3. On the first geometry item for a feature within this kind,
///    `committed` is set to `true`, `feature_count` is incremented, and
///    `current_batch_index` is assigned. Subsequent geometry items from the
///    same feature (e.g., points in a MultiPoint) reuse the same batch index.
/// 4. [`GeometryGroups::finalize`] converts each group's accumulated data into
///    handle-based ECS components and spawns a `BatchedFeature` entity with
///    the appropriate marker and material.
///
pub struct GeometryGroup {
    pub kind: GeometryAppearanceKind,
    /// Per-geometry-item unique IDs used for GPU picking.
    /// For point-like kinds with MultiPoint geometries, this contains one
    /// entry per vertex (not per feature).
    pub global_batch_ids: Vec<u32>,
    /// The [`BatchTable`](crate::batch::BatchTable) row ID for this kind's
    /// batch, used for property/tag storage.
    pub batch_id: u32,
    /// Number of distinct features accumulated (one per `begin_feature` that
    /// produced geometry for this kind).
    pub feature_count: u32,
    /// Whether the current feature has been committed to this kind's batch.
    pub committed: bool,
    /// Batch index assigned to the current feature for this kind, shared by
    /// all geometry items of that feature within this kind.
    pub current_batch_index: u32,
    /// Pre-accumulated geometry data.
    pub accumulated: AccumulatedGeometry,
}

/// Accumulates feature entities grouped by appearance kind during geometry
/// construction.
///
/// Used by both GeoJSON and MVT builders to collect geometry into groups
/// before spawning `BatchedFeature` parents.
///
/// # Usage
///
/// ```rust,ignore
/// let mut groups = GeometryGroups::new();
///
/// // Register kinds (called by format-specific builder's ensure_kind)
/// groups.register_kind(GeometryAppearanceKind::Point, batch_id);
///
/// // Per feature:
/// groups.begin_feature();
/// groups.track_point_rte(kind, coords, crs, high, low, global_batch_id);
///
/// // After all features:
/// let entities = groups.finalize(commands, buf, appearances, layer_id, true);
/// // `entities` are BatchedFeature entities with geometry components,
/// // ready to be picked up by navara_feature's transfer_batched_mesh systems.
/// ```
pub struct GeometryGroups {
    pub groups: Vec<GeometryGroup>,
}

impl GeometryGroups {
    pub fn new() -> Self {
        Self { groups: Vec::new() }
    }

    /// Check if a kind has already been registered.
    pub fn has_kind(&self, kind: GeometryAppearanceKind) -> bool {
        self.groups.iter().any(|g| g.kind == kind)
    }

    /// Register a new kind with its batch_id, creating its group.
    pub fn register_kind(&mut self, kind: GeometryAppearanceKind, batch_id: u32) {
        self.groups.push(GeometryGroup {
            kind,
            global_batch_ids: Vec::new(),
            batch_id,
            feature_count: 0,
            committed: false,
            current_batch_index: 0,
            accumulated: AccumulatedGeometry::None,
        });
    }

    /// Reset committed flags for all groups. Call once per feature.
    pub fn begin_feature(&mut self) {
        for group in &mut self.groups {
            group.committed = false;
        }
    }

    /// Accumulate a point with RTC-encoded position.
    /// `rtc_pos`: pre-computed `(world_pos - center)` as f32 triplet.
    /// Returns `(batch_index, commit_batch_id)`.
    pub fn track_point_rtc(
        &mut self,
        kind: GeometryAppearanceKind,
        coords: Vec3,
        crs: CRS,
        rtc_pos: [f32; 3],
        rtc_center: Vec3,
        global_batch_id: u32,
    ) -> (u32, Option<u32>) {
        let group = self.groups.iter_mut().find(|g| g.kind == kind).unwrap();
        let (batch_index, commit_batch_id) = Self::advance_feature(group, global_batch_id);
        Self::ensure_point_geom(&mut group.accumulated, &crs);
        let geom = match &mut group.accumulated {
            AccumulatedGeometry::Points(g) => g,
            _ => unreachable!(),
        };
        geom.coords.push(coords);
        geom.batch_indices.push(batch_index);
        geom.batch_ids.push(global_batch_id as f32);
        geom.encoded
            .push_rtc(rtc_pos[0], rtc_pos[1], rtc_pos[2], rtc_center);
        (batch_index, commit_batch_id)
    }

    /// Accumulate a point with RTE-encoded position.
    /// `high`/`low`: pre-computed `EncodedVec3` f32 triplets.
    /// Returns `(batch_index, commit_batch_id)`.
    pub fn track_point_rte(
        &mut self,
        kind: GeometryAppearanceKind,
        coords: Vec3,
        crs: CRS,
        high: [f32; 3],
        low: [f32; 3],
        global_batch_id: u32,
    ) -> (u32, Option<u32>) {
        let group = self.groups.iter_mut().find(|g| g.kind == kind).unwrap();
        let (batch_index, commit_batch_id) = Self::advance_feature(group, global_batch_id);
        Self::ensure_point_geom(&mut group.accumulated, &crs);
        let geom = match &mut group.accumulated {
            AccumulatedGeometry::Points(g) => g,
            _ => unreachable!(),
        };
        geom.coords.push(coords);
        geom.batch_indices.push(batch_index);
        geom.batch_ids.push(global_batch_id as f32);
        geom.encoded.push_rte(high, low);
        (batch_index, commit_batch_id)
    }

    /// Advance the per-feature batch index for a group.
    fn advance_feature(group: &mut GeometryGroup, global_batch_id: u32) -> (u32, Option<u32>) {
        let commit_batch_id = if !group.committed {
            group.current_batch_index = group.feature_count;
            group.feature_count += 1;
            group.committed = true;
            Some(group.batch_id)
        } else {
            None
        };
        let batch_index = group.current_batch_index;
        group.global_batch_ids.push(global_batch_id);
        (batch_index, commit_batch_id)
    }

    /// Ensure the accumulated geometry is initialized as Points.
    fn ensure_point_geom(accumulated: &mut AccumulatedGeometry, crs: &CRS) {
        if !matches!(accumulated, AccumulatedGeometry::Points(_)) {
            *accumulated = AccumulatedGeometry::Points(PointGeometryAccumulator::new(crs.clone()));
        }
    }

    /// Accumulate polyline geometry without spawning a child entity.
    /// `ring` marks a polygon ring, whose repeated first vertex is a seam to
    /// join rather than two ends to cap.
    /// Returns `(batch_index, commit_batch_id)`.
    pub fn track_polyline(
        &mut self,
        kind: GeometryAppearanceKind,
        points: Vec<f64>,
        crs: CRS,
        global_batch_id: u32,
        ring: bool,
    ) -> (u32, Option<u32>) {
        let group = self.groups.iter_mut().find(|g| g.kind == kind).unwrap();

        let commit_batch_id = if !group.committed {
            group.current_batch_index = group.feature_count;
            group.feature_count += 1;
            group.committed = true;
            Some(group.batch_id)
        } else {
            None
        };

        let batch_index = group.current_batch_index;
        group.global_batch_ids.push(global_batch_id);

        let acc = match &mut group.accumulated {
            AccumulatedGeometry::Polylines(g) => g,
            _ => {
                group.accumulated =
                    AccumulatedGeometry::Polylines(PolylineGeometryAccumulator::new(crs.clone()));
                match &mut group.accumulated {
                    AccumulatedGeometry::Polylines(g) => g,
                    _ => unreachable!(),
                }
            }
        };
        acc.points_sizes.push(points.len() as u32);
        acc.points.extend(points);
        acc.batch_indices.push(batch_index);
        acc.ring_flags.push(ring as u8);

        (batch_index, commit_batch_id)
    }

    /// Accumulate polygon geometry without spawning a child entity.
    /// Returns `(batch_index, commit_batch_id)`.
    pub fn track_polygon(
        &mut self,
        kind: GeometryAppearanceKind,
        outer_ring: Vec<f64>,
        holes: &[Hierarchy],
        winding_order: WindingOrder,
        crs: CRS,
        global_batch_id: u32,
    ) -> (u32, Option<u32>) {
        let group = self.groups.iter_mut().find(|g| g.kind == kind).unwrap();

        let commit_batch_id = if !group.committed {
            group.current_batch_index = group.feature_count;
            group.feature_count += 1;
            group.committed = true;
            Some(group.batch_id)
        } else {
            None
        };

        let batch_index = group.current_batch_index;
        group.global_batch_ids.push(global_batch_id);

        let acc = match &mut group.accumulated {
            AccumulatedGeometry::Polygons(g) => g,
            _ => {
                group.accumulated =
                    AccumulatedGeometry::Polygons(PolygonGeometryAccumulator::new(crs.clone()));
                match &mut group.accumulated {
                    AccumulatedGeometry::Polygons(g) => g,
                    _ => unreachable!(),
                }
            }
        };
        acc.add(outer_ring, holes, winding_order, batch_index);

        (batch_index, commit_batch_id)
    }

    /// Finalize by spawning `BatchedFeature` parent entities.
    ///
    /// Point positions must be pre-encoded by the caller (via `track_point_rtc`
    /// or `track_point_rte`) before calling this method.
    pub fn finalize(
        self,
        commands: &mut Commands,
        buf: &mut BufferStore,
        appearances: &[Appearance],
        layer_id: &str,
        default_active: bool,
    ) -> Vec<Entity> {
        let mut result = Vec::new();

        for group in self.groups {
            if group.global_batch_ids.is_empty() {
                continue;
            }

            // Check the appearance match before allocating the batch-id
            // buffer: `spawn_batched_entity` drops unmatched kinds, which
            // would leak the freshly created handle.
            if find_matching_appearance(group.kind, appearances).is_none() {
                continue;
            }

            let batch_length = group.global_batch_ids.len() as u32;

            let batched = BatchedFeature {
                default_active,
                ..Default::default()
            };

            // When a feature produced more than one geometry item (MultiPoint,
            // MultiPolygon, per-ring polylines, ...), the per-instance global
            // batch ids no longer line up with the per-feature property rows.
            // Keep the instance -> feature mapping so property lookups by
            // global batch id resolve to the owning feature's row.
            let instance_feature_indices = if batch_length == group.feature_count {
                None
            } else {
                match &group.accumulated {
                    AccumulatedGeometry::Points(acc) => Some(&acc.batch_indices),
                    AccumulatedGeometry::Polylines(acc) => Some(&acc.batch_indices),
                    AccumulatedGeometry::Polygons(acc) => Some(&acc.batch_indices),
                    AccumulatedGeometry::None => None,
                }
                .map(|batch_indices| buf.new_u32(batch_indices.clone()))
            };

            let global_batch_ids = GlobalBatchIds {
                handle: buf.new_u32(group.global_batch_ids),
                batch_length,
                instance_feature_indices,
            };

            if let Some(entity) = spawn_batched_entity(
                commands,
                batched,
                group.kind,
                appearances,
                layer_id,
                FeatureBatchId(group.batch_id),
                global_batch_ids,
            ) {
                // Convert accumulator to handle-based component and insert.
                match group.accumulated {
                    AccumulatedGeometry::Points(mut acc) => {
                        set_point_transform(&mut acc, appearances, group.kind);
                        commands.entity(entity).insert(acc.into_component(buf));
                    }
                    AccumulatedGeometry::Polylines(acc) => {
                        commands.entity(entity).insert(acc.into_component(buf));
                    }
                    AccumulatedGeometry::Polygons(acc) => {
                        commands.entity(entity).insert(acc.into_component(buf));
                    }
                    AccumulatedGeometry::None => {}
                }
                result.push(entity);
            }
        }

        result
    }
}

impl Default for GeometryGroups {
    fn default() -> Self {
        Self::new()
    }
}

/// Set the transform on a `PointGeometryAccumulator` from its encoded center + material size.
fn set_point_transform(
    acc: &mut PointGeometryAccumulator,
    appearances: &[Appearance],
    kind: GeometryAppearanceKind,
) {
    let size = match kind {
        GeometryAppearanceKind::Point => appearances.iter().find_map(|a| {
            if let Appearance::Point(m) = a {
                Some(m.size)
            } else {
                None
            }
        }),
        GeometryAppearanceKind::Billboard => appearances.iter().find_map(|a| {
            if let Appearance::Billboard(m) = a {
                Some(m.size)
            } else {
                None
            }
        }),
        GeometryAppearanceKind::Text => appearances.iter().find_map(|a| {
            if let Appearance::Text(m) = a {
                Some(m.size)
            } else {
                None
            }
        }),
        _ => None,
    }
    .unwrap_or(1.0);

    let scale = Vec3::new(size as f64, size as f64, size as f64);
    acc.transform = match &acc.encoded {
        EncodedPointPositions::Rtc { center, .. } => {
            Transform::from_translation(*center).with_scale(scale)
        }
        _ => Transform::from_scale(scale),
    };
}

/// Spawn a point-like child entity with the appropriate geometry component.
///
/// Handles Point, Billboard, and Text kinds. Panics if called with Polyline or Polygon.
pub fn spawn_point_entity(
    commands: &mut Commands,
    coords: Vec3,
    crs: CRS,
    kind: GeometryAppearanceKind,
) -> Entity {
    match kind {
        GeometryAppearanceKind::Point => commands
            .spawn((BatchedFeatureMarker, PointGeometry { coords, crs }))
            .id(),
        GeometryAppearanceKind::Billboard => commands
            .spawn((BatchedFeatureMarker, BillboardGeometry { coords, crs }))
            .id(),
        GeometryAppearanceKind::Text => commands
            .spawn((BatchedFeatureMarker, TextGeometry { coords, crs }))
            .id(),
        _ => unreachable!("spawn_point_entity called with non-point kind: {:?}", kind),
    }
}

/// The first appearance whose variant matches `kind`, if any.
fn find_matching_appearance(
    kind: GeometryAppearanceKind,
    appearances: &[Appearance],
) -> Option<&Appearance> {
    appearances.iter().find(|a| {
        matches!(
            (kind, a),
            (GeometryAppearanceKind::Point, Appearance::Point(_))
                | (GeometryAppearanceKind::Billboard, Appearance::Billboard(_))
                | (GeometryAppearanceKind::Text, Appearance::Text(_))
                | (GeometryAppearanceKind::Polyline, Appearance::Polyline(_))
                | (GeometryAppearanceKind::Polygon, Appearance::Polygon(_))
        )
    })
}

/// Spawn a `BatchedFeature` parent entity with the appropriate marker and material.
fn spawn_batched_entity(
    commands: &mut Commands,
    batched: BatchedFeature,
    kind: GeometryAppearanceKind,
    appearances: &[Appearance],
    layer_id: &str,
    feature_batch_id: FeatureBatchId,
    global_batch_ids: GlobalBatchIds,
) -> Option<Entity> {
    let appearance = find_matching_appearance(kind, appearances)?;

    let mut ec = commands.spawn((
        batched,
        FeatureId::default(),
        LayerId(layer_id.to_string()),
        feature_batch_id,
        global_batch_ids,
    ));

    match appearance {
        Appearance::Point(mat) => {
            ec.insert((PointMarker, mat.clone()));
        }
        Appearance::Billboard(mat) => {
            ec.insert((BillboardMarker, mat.clone()));
        }
        Appearance::Text(mat) => {
            ec.insert((TextMarker, mat.clone()));
        }
        Appearance::Polyline(mat) => {
            ec.insert((PolylineMarker, mat.clone()));
        }
        Appearance::Polygon(mat) => {
            ec.insert((PolygonMarker, mat.clone()));
        }
        Appearance::Model(_) => {
            warn!("Model material isn't supported");
        }
        _ => {}
    }

    Some(ec.id())
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::batched_geometry::{BatchedPointGeometry, BatchedPolygonGeometry};
    use bevy_app::{App, Update};
    use bevy_ecs::prelude::Resource;
    use bevy_ecs::system::{Commands, ResMut};
    use navara_geometry::WindingOrder;

    #[test]
    fn register_kind_creates_group() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Point, 42);
        groups.register_kind(GeometryAppearanceKind::Polyline, 99);

        assert!(groups.has_kind(GeometryAppearanceKind::Point));
        assert!(groups.has_kind(GeometryAppearanceKind::Polyline));
        assert!(!groups.has_kind(GeometryAppearanceKind::Polygon));
        assert_eq!(groups.groups.len(), 2);
        assert_eq!(groups.groups[0].batch_id, 42);
        assert_eq!(groups.groups[1].batch_id, 99);
    }

    #[test]
    fn begin_feature_resets_committed_flags() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Point, 1);

        groups.groups[0].committed = true;

        groups.begin_feature();
        assert!(!groups.groups[0].committed);
    }

    // ── track_point / track_polyline / track_polygon tests ───────────

    #[test]
    fn track_point_accumulates_coords_and_indices() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Point, 42);

        groups.begin_feature();
        let (idx0, commit0) = groups.track_point_rte(
            GeometryAppearanceKind::Point,
            Vec3::new(1., 2., 0.),
            CRS::Geographic,
            [0.; 3],
            [0.; 3],
            100,
        );
        assert_eq!(idx0, 0);
        assert_eq!(commit0, Some(42));

        groups.begin_feature();
        let (idx1, commit1) = groups.track_point_rte(
            GeometryAppearanceKind::Point,
            Vec3::new(3., 4., 0.),
            CRS::Geographic,
            [0.; 3],
            [0.; 3],
            101,
        );
        assert_eq!(idx1, 1);
        assert_eq!(commit1, Some(42));

        let group = &groups.groups[0];
        assert_eq!(group.global_batch_ids, vec![100, 101]);

        match &group.accumulated {
            AccumulatedGeometry::Points(acc) => {
                assert_eq!(acc.coords.len(), 2);
                assert_eq!(acc.coords[0], Vec3::new(1., 2., 0.));
                assert_eq!(acc.coords[1], Vec3::new(3., 4., 0.));
                assert_eq!(acc.batch_indices, vec![0, 1]);
            }
            _ => panic!("expected AccumulatedGeometry::Points"),
        }
    }

    #[test]
    fn track_point_multipoint_shares_batch_index() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Point, 1);

        // First feature has two points (multipoint)
        groups.begin_feature();
        let (idx0, commit0) = groups.track_point_rte(
            GeometryAppearanceKind::Point,
            Vec3::new(1., 1., 0.),
            CRS::Geographic,
            [0.; 3],
            [0.; 3],
            10,
        );
        assert_eq!(idx0, 0);
        assert_eq!(commit0, Some(1));

        let (idx0b, commit0b) = groups.track_point_rte(
            GeometryAppearanceKind::Point,
            Vec3::new(2., 2., 0.),
            CRS::Geographic,
            [0.; 3],
            [0.; 3],
            11,
        );
        assert_eq!(idx0b, 0); // same batch index for same feature
        assert!(commit0b.is_none());

        // Second feature
        groups.begin_feature();
        let (idx1, _) = groups.track_point_rte(
            GeometryAppearanceKind::Point,
            Vec3::new(3., 3., 0.),
            CRS::Geographic,
            [0.; 3],
            [0.; 3],
            12,
        );
        assert_eq!(idx1, 1);

        match &groups.groups[0].accumulated {
            AccumulatedGeometry::Points(acc) => {
                assert_eq!(acc.coords.len(), 3);
                assert_eq!(acc.batch_indices, vec![0, 0, 1]);
            }
            _ => panic!("expected Points"),
        }
    }

    #[test]
    fn track_point_rtc_accumulates_encoded_positions() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Point, 1);

        let center = Vec3::new(100., 200., 300.);

        groups.begin_feature();
        groups.track_point_rtc(
            GeometryAppearanceKind::Point,
            Vec3::new(1., 2., 0.),
            CRS::Geographic,
            [10.0, 20.0, 30.0],
            center,
            100,
        );

        groups.begin_feature();
        groups.track_point_rtc(
            GeometryAppearanceKind::Point,
            Vec3::new(3., 4., 0.),
            CRS::Geographic,
            [40.0, 50.0, 60.0],
            center,
            101,
        );

        match &groups.groups[0].accumulated {
            AccumulatedGeometry::Points(acc) => {
                assert_eq!(acc.coords.len(), 2);
                assert_eq!(acc.batch_ids, vec![100.0, 101.0]);
                match &acc.encoded {
                    EncodedPointPositions::Rtc { coords, center: c } => {
                        assert_eq!(coords, &[10.0, 20.0, 30.0, 40.0, 50.0, 60.0]);
                        assert_eq!(*c, center);
                    }
                    _ => panic!("expected Rtc"),
                }
            }
            _ => panic!("expected Points"),
        }
    }

    #[test]
    fn track_point_rte_accumulates_encoded_positions() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Point, 1);

        groups.begin_feature();
        groups.track_point_rte(
            GeometryAppearanceKind::Point,
            Vec3::new(1., 2., 0.),
            CRS::Geographic,
            [1.0, 2.0, 3.0],
            [0.1, 0.2, 0.3],
            100,
        );

        match &groups.groups[0].accumulated {
            AccumulatedGeometry::Points(acc) => {
                assert_eq!(acc.coords.len(), 1);
                match &acc.encoded {
                    EncodedPointPositions::Rte { high, low } => {
                        assert_eq!(high, &[1.0, 2.0, 3.0]);
                        assert_eq!(low, &[0.1, 0.2, 0.3]);
                    }
                    _ => panic!("expected Rte"),
                }
            }
            _ => panic!("expected Points"),
        }
    }

    #[test]
    fn track_polyline_accumulates_flat_arrays() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Polyline, 5);

        groups.begin_feature();
        let line1 = vec![0., 0., 0., 1., 1., 0.]; // 2 points * 3 coords
        let (idx0, _) = groups.track_polyline(
            GeometryAppearanceKind::Polyline,
            line1,
            CRS::Geographic,
            50,
            false,
        );
        assert_eq!(idx0, 0);

        groups.begin_feature();
        let line2 = vec![2., 2., 0., 3., 3., 0., 4., 4., 0.]; // 3 points
        let (idx1, _) = groups.track_polyline(
            GeometryAppearanceKind::Polyline,
            line2,
            CRS::Geographic,
            51,
            true,
        );
        assert_eq!(idx1, 1);

        match &groups.groups[0].accumulated {
            AccumulatedGeometry::Polylines(acc) => {
                assert_eq!(acc.points.len(), 15); // 6 + 9
                assert_eq!(acc.points_sizes, vec![6, 9]);
                assert_eq!(acc.batch_indices, vec![0, 1]);
                // The ring intent rides along per polyline.
                assert_eq!(acc.ring_flags, vec![0, 1]);
            }
            _ => panic!("expected Polylines"),
        }
    }

    #[test]
    fn track_polygon_accumulates_with_holes() {
        let mut groups = GeometryGroups::new();
        groups.register_kind(GeometryAppearanceKind::Polygon, 10);

        // Feature 1: polygon with no holes
        groups.begin_feature();
        let outer1 = vec![0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0.]; // 4 verts
        let (idx0, _) = groups.track_polygon(
            GeometryAppearanceKind::Polygon,
            outer1,
            &[],
            WindingOrder::Clockwise,
            CRS::Geographic,
            60,
        );
        assert_eq!(idx0, 0);

        // Feature 2: polygon with 1 hole
        groups.begin_feature();
        let outer2 = vec![10., 10., 0., 20., 10., 0., 20., 20., 0.]; // 3 verts
        let hole = Hierarchy {
            outer_ring: vec![12., 12., 0., 18., 12., 0., 18., 18., 0.],
            holes: None,
            expected_winding_order: WindingOrder::CounterClockwise,
        };
        let (idx1, _) = groups.track_polygon(
            GeometryAppearanceKind::Polygon,
            outer2,
            &[hole],
            WindingOrder::Clockwise,
            CRS::Geographic,
            61,
        );
        assert_eq!(idx1, 1);

        match &groups.groups[0].accumulated {
            AccumulatedGeometry::Polygons(acc) => {
                assert_eq!(acc.outer_ring_sizes, vec![12, 9]);
                assert_eq!(acc.outer_rings.len(), 21); // 12 + 9
                assert_eq!(acc.holes_boundaries, vec![0, 1]); // 0 holes, 1 hole
                assert_eq!(acc.holes_total_sizes, vec![0, 9]); // 0, 9 floats
                assert_eq!(acc.holes_sizes, vec![9]); // 1 hole of 9 floats
                assert_eq!(acc.holes.len(), 9);
                assert_eq!(acc.batch_indices, vec![0, 1]);
                // outer1 CW, outer2 CW, hole CCW
                assert_eq!(
                    acc.expected_winding_orders,
                    vec![
                        WindingOrder::Clockwise as u8,
                        WindingOrder::Clockwise as u8,
                        WindingOrder::CounterClockwise as u8,
                    ]
                );
            }
            _ => panic!("expected Polygons"),
        }
    }

    #[test]
    fn finalize_inserts_batched_point_geometry_on_parent() {
        use navara_material::PointMaterial;

        let mut app = App::new();
        app.init_resource::<BufferStore>();

        #[derive(Resource, Default)]
        struct Out(Vec<Entity>);
        app.init_resource::<Out>();

        app.add_systems(
            Update,
            |mut commands: Commands, mut buf: ResMut<BufferStore>, mut out: ResMut<Out>| {
                let mut groups = GeometryGroups::new();
                groups.register_kind(GeometryAppearanceKind::Point, 1);

                groups.begin_feature();
                groups.track_point_rte(
                    GeometryAppearanceKind::Point,
                    Vec3::new(1., 2., 0.),
                    CRS::Geographic,
                    [0.; 3],
                    [0.; 3],
                    100,
                );

                groups.begin_feature();
                groups.track_point_rte(
                    GeometryAppearanceKind::Point,
                    Vec3::new(3., 4., 0.),
                    CRS::Geographic,
                    [0.; 3],
                    [0.; 3],
                    101,
                );

                let appearances = vec![Appearance::Point(PointMaterial::default())];
                out.0 = groups.finalize(&mut commands, &mut buf, &appearances, "test", false);
            },
        );
        app.update();

        let out = app.world().resource::<Out>();
        assert_eq!(out.0.len(), 1);

        // Verify BatchedPointGeometry is on the parent entity
        let mut query = app
            .world_mut()
            .query::<(&BatchedPointGeometry, &BatchedFeature)>();
        let (geom, _batched) = query.iter(app.world()).next().unwrap();
        assert_eq!(geom.coords.len(), 2);
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0, 1]);
    }

    #[test]
    fn finalize_keeps_instance_feature_indices_for_multipoint() {
        use crate::batch::GlobalBatchIds;
        use navara_material::PointMaterial;

        let mut app = App::new();
        app.init_resource::<BufferStore>();

        #[derive(Resource, Default)]
        struct Out(Vec<Entity>);
        app.init_resource::<Out>();

        app.add_systems(
            Update,
            |mut commands: Commands, mut buf: ResMut<BufferStore>, mut out: ResMut<Out>| {
                let mut groups = GeometryGroups::new();
                groups.register_kind(GeometryAppearanceKind::Point, 1);

                // Feature 0 is a MultiPoint spanning two instances.
                groups.begin_feature();
                for id in [100, 101] {
                    groups.track_point_rte(
                        GeometryAppearanceKind::Point,
                        Vec3::new(1., 2., 0.),
                        CRS::Geographic,
                        [0.; 3],
                        [0.; 3],
                        id,
                    );
                }
                groups.begin_feature();
                groups.track_point_rte(
                    GeometryAppearanceKind::Point,
                    Vec3::new(3., 4., 0.),
                    CRS::Geographic,
                    [0.; 3],
                    [0.; 3],
                    102,
                );

                let appearances = vec![Appearance::Point(PointMaterial::default())];
                out.0 = groups.finalize(&mut commands, &mut buf, &appearances, "test", false);
            },
        );
        app.update();

        let out_entity = app.world().resource::<Out>().0[0];
        let ids = app
            .world()
            .get::<GlobalBatchIds>(out_entity)
            .expect("GlobalBatchIds missing")
            .clone();
        assert_eq!(ids.batch_length, 3);
        let buf = app.world().resource::<BufferStore>();
        let handle = ids
            .instance_feature_indices
            .expect("multi-instance group must keep the instance -> feature mapping");
        assert_eq!(buf.get_u32(&handle).unwrap(), &[0, 0, 1]);
    }

    #[test]
    fn finalize_skips_instance_feature_indices_for_one_to_one_features() {
        use crate::batch::GlobalBatchIds;
        use navara_material::PointMaterial;

        let mut app = App::new();
        app.init_resource::<BufferStore>();

        #[derive(Resource, Default)]
        struct Out(Vec<Entity>);
        app.init_resource::<Out>();

        app.add_systems(
            Update,
            |mut commands: Commands, mut buf: ResMut<BufferStore>, mut out: ResMut<Out>| {
                let mut groups = GeometryGroups::new();
                groups.register_kind(GeometryAppearanceKind::Point, 1);
                for (i, id) in [100, 101].into_iter().enumerate() {
                    groups.begin_feature();
                    groups.track_point_rte(
                        GeometryAppearanceKind::Point,
                        Vec3::new(i as f64, 0., 0.),
                        CRS::Geographic,
                        [0.; 3],
                        [0.; 3],
                        id,
                    );
                }
                let appearances = vec![Appearance::Point(PointMaterial::default())];
                out.0 = groups.finalize(&mut commands, &mut buf, &appearances, "test", false);
            },
        );
        app.update();

        let out_entity = app.world().resource::<Out>().0[0];
        let ids = app.world().get::<GlobalBatchIds>(out_entity).unwrap();
        assert!(ids.instance_feature_indices.is_none());
    }

    #[test]
    fn finalize_inserts_batched_polygon_geometry_on_parent() {
        use navara_material::PolygonMaterial;

        let mut app = App::new();
        app.init_resource::<BufferStore>();

        #[derive(Resource, Default)]
        struct Out(Vec<Entity>);
        app.init_resource::<Out>();

        app.add_systems(
            Update,
            |mut commands: Commands, mut buf: ResMut<BufferStore>, mut out: ResMut<Out>| {
                let mut groups = GeometryGroups::new();
                groups.register_kind(GeometryAppearanceKind::Polygon, 1);

                groups.begin_feature();
                groups.track_polygon(
                    GeometryAppearanceKind::Polygon,
                    vec![0., 0., 0., 1., 0., 0., 1., 1., 0.],
                    &[],
                    WindingOrder::Clockwise,
                    CRS::Geographic,
                    200,
                );

                let appearances = vec![Appearance::Polygon(PolygonMaterial::default())];
                out.0 = groups.finalize(&mut commands, &mut buf, &appearances, "test", false);
            },
        );
        app.update();

        let out = app.world().resource::<Out>();
        assert_eq!(out.0.len(), 1);

        let mut query = app
            .world_mut()
            .query::<(&BatchedPolygonGeometry, &BatchedFeature)>();
        let (geom, _batched) = query.iter(app.world()).next().unwrap();
        let buf = app.world().resource::<BufferStore>();
        assert_eq!(geom.feature_count(buf), 1);
        assert_eq!(geom.batch_indices(buf).unwrap(), &[0]);
    }
}
