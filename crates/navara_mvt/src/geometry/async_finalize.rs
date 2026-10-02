//! Finalize worker-parsed MVT groups on the main thread.
//!
//! When the `delegated_worker` feature is enabled, `MvtSource::construct_geometry`
//! spawns a parse task instead of parsing inline (see `source.rs`). On worker
//! completion this system turns the returned plain buffers into batched feature
//! entities — reusing the same finalize path as the synchronous code — and links
//! them back to their `RenderedTile`.

use std::sync::Arc;

use bevy_ecs::{
    entity::Entity,
    query::{With, Without},
    system::{Commands, Query, ResMut},
};
use geozero::mvt::tile;
use navara_buffer_store::{BufferStore, Handle};
use navara_component::{Deleted, OrderByDistance};
use navara_core::{Aabb, Angle, Extent, Radians, TileXYZ};
use navara_feature_component::batch::BatchTable;
use navara_material::Appearance;
use navara_math::{FloatType, Vec3};
use navara_parser::mvt::{
    LayerParseConfig, LayerParseKind, MvtLayerData, PackedMvtStreamsCursor, ParsedMvtGroupHeader,
    UnpackedMvtGroup,
};
use navara_tile_component::TileHandle;
use navara_vector_tile::{RenderedTile, TileCacheManager};
use navara_worker::{
    WorkerTaskCompleted, WorkerTaskDelegateeMarker,
    parse_mvt_tile::{
        ParseMvtTileMarker, ParseMvtTileParameters, ParseMvtTileResult,
        ParseMvtTileWorkerTaskBundle,
    },
};

use crate::source::OwnedMatchedLayerInfo;

use super::process::{
    build_accumulated_geometry, layer_parse_config, spawn_finalized_group, to_appearance_kind,
};

/// Spawn a delegated MVT parse task and its finalize context. Shared by the
/// plain MVT source and the PMTiles decoder so both offload parsing (and, via
/// `compression`, gzip decompression) to the same worker task. Returns `None`
/// (the caller reports "no synchronous features"); features are linked to the
/// tile on completion by [`finalize_parsed_mvt`].
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_parse_mvt_task(
    commands: &mut Commands,
    buf: &mut BufferStore,
    rendered_tile: Entity,
    tile_handle: TileHandle,
    coords: TileXYZ,
    tile_extent: Extent<FloatType, Radians>,
    order: &OrderByDistance,
    layers: &[OwnedMatchedLayerInfo],
    pbf_handle: Handle,
    compression: u8,
) -> Option<Vec<Entity>> {
    let configs: Vec<LayerParseConfig> = layers
        .iter()
        .map(|l| layer_parse_config(&l.as_ref()))
        .collect();
    if configs.is_empty() {
        // No task (and thus no finalize) will ever consume the pbf; free it now
        // instead of leaving it resident until the tile's data requester is
        // torn down (the synchronous path consumes it here too).
        buf.remove(&pbf_handle);
        return None;
    }

    // Appearance snapshot per layer: `Arc`-shared with the source, so spawning
    // a parse per tile costs a layer-id string and an `Arc` bump, not a copy of
    // the appearance data.
    let appearances: Vec<(String, Arc<Vec<Appearance>>)> = layers
        .iter()
        .map(|l| (l.layer_id.clone(), Arc::clone(&l.appearances)))
        .collect();

    commands.spawn((
        ParseMvtTileWorkerTaskBundle::new(
            ParseMvtTileMarker,
            ParseMvtTileParameters {
                pbf_handle,
                x: coords.x,
                y: coords.y,
                z: coords.z,
                tile_extent: Some(tile_extent),
                configs,
                compression,
            },
        ),
        order.clone(),
        MvtParseFinalizeContext {
            rendered_tile,
            tile_handle,
            tile_extent: Some(tile_extent),
            order: order.clone(),
            appearances,
            pbf_handle,
        },
    ));

    None
}

/// Main-thread context needed to finalize a parsed tile: which tile the result
/// belongs to and the appearance data required to spawn entities. Attached to
/// the delegator entity by `MvtSource::construct_geometry`.
#[derive(bevy_ecs::component::Component, Clone)]
pub struct MvtParseFinalizeContext {
    /// The exact RenderedTile entity this parse belongs to. Used for identity so
    /// a result never links to a different tile that later reused the handle.
    pub rendered_tile: Entity,
    pub tile_handle: TileHandle,
    pub tile_extent: Option<Extent<FloatType, Radians>>,
    pub order: OrderByDistance,
    /// Appearances per matched layer id (last matching id wins, as in the parse
    /// core), `Arc`-shared with the source's layer list.
    pub appearances: Vec<(String, Arc<Vec<Appearance>>)>,
    /// BufferStore handle to the pbf bytes, freed once finalized.
    pub pbf_handle: navara_buffer_store::Handle,
}

/// Consume completed parse results and spawn their feature entities.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
pub(crate) fn finalize_parsed_mvt(
    mut commands: Commands,
    mut batch_table: ResMut<BatchTable>,
    mut buf: ResMut<BufferStore>,
    mut completed: Query<
        (Entity, &mut ParseMvtTileResult, &MvtParseFinalizeContext),
        (With<WorkerTaskCompleted>, Without<Deleted>),
    >,
    mut tile_caches: Query<&mut TileCacheManager>,
    mut rendered_tiles: Query<&mut RenderedTile>,
    layers: Query<(Entity, &navara_vector_tile::LayerResources)>,
    mut estimates: ResMut<navara_memory::ReserveEstimates>,
) {
    for (delegator, mut result, ctx) in &mut completed {
        // Only finalize if this parse's RenderedTile is *still* the canonical
        // tile for its handle. If the tile was evicted (handle absent) or the
        // handle was reused by a newer tile (maps to a different entity), the
        // result is stale: drop it without spawning orphan/duplicate features.
        let is_current = tile_caches.iter_mut().any(|mut tc| {
            if tc.rendered_tile_caches.get(&ctx.tile_handle) == Some(&ctx.rendered_tile) {
                // Force a re-traversal so the freshly linked features get
                // activated even when the camera is static by the time parsing
                // finishes (activation only runs while tiles are traversed).
                tc.needs_update = true;
                true
            } else {
                false
            }
        });

        // Always take the packed streams out of the BufferStore — also on the
        // stale path, where dropping them here is what prevents a leak.
        let (f64_stream, f32_stream, u32_stream, u8_stream) = result.take_streams(&mut buf);

        if is_current {
            let rtc_center = ctx.tile_extent.map(worker_rtc_center).unwrap_or(Vec3::ZERO);
            let tile_info = ctx.tile_extent.map(|ext| (ctx.tile_handle, ext));

            // Measure the geometry bytes this finalize writes into the store.
            // The packed worker streams were already taken out above, so from
            // here the only store growth is the built geometry buffers (which
            // Three.js later uploads and drops from the CPU store, so they
            // persist only on the GPU). The store delta is therefore the pure
            // geometry size — the same quantity the synchronous path charges in
            // `transfer_mesh` — so both paths agree on a tile's cost.
            let buf_before = buf.total_bytes() as u64;

            let mut cursor =
                PackedMvtStreamsCursor::new(f64_stream, f32_stream, u32_stream, u8_stream);
            // Move the meta out (no clone): the property tables flow straight
            // into the batch table.
            let meta = std::mem::take(&mut result.meta);
            // Rebuild each layer's property table into `Arc`-shared keys/values
            // once; every group of that layer shares the same pair below, so
            // the batch table stores one table per layer like the synchronous
            // path does.
            let mut layer_properties: Vec<(Arc<Vec<String>>, Arc<Vec<tile::Value>>)> =
                Vec::with_capacity(meta.layer_properties.len());
            for props in meta.layer_properties {
                layer_properties.push(props.into_shared_parts());
            }

            // Parsed, so no longer pending even when nothing matched: the
            // traversal reads `None` as "still parsing" and would keep the
            // parent tile on screen in this one's place forever.
            if let Ok(mut rt) = rendered_tiles.get_mut(ctx.rendered_tile) {
                rt.feature_ids.get_or_insert_with(Vec::new);
            }

            for header in meta.headers {
                // Slice the group out even when no appearance matches: the
                // cursor must advance past every group's segments.
                let Some(group) = cursor.next_group(&header) else {
                    // Headers and streams disagree; nothing after this point
                    // can be sliced reliably.
                    break;
                };

                let Some(appearances) = ctx
                    .appearances
                    .iter()
                    .rev()
                    .find(|(id, _)| id == &header.layer_id)
                    .map(|(_, a)| a.as_slice())
                else {
                    continue;
                };

                let Some((keys, values)) = layer_properties.get(header.properties_index as usize)
                else {
                    // Corrupt meta: the header points past the property tables.
                    continue;
                };

                let entities = finalize_group(
                    &mut commands,
                    &mut batch_table,
                    &mut buf,
                    header,
                    group,
                    Arc::clone(keys),
                    Arc::clone(values),
                    appearances,
                    rtc_center,
                    tile_info,
                    &ctx.order,
                );

                if let Ok(mut rt) = rendered_tiles.get_mut(ctx.rendered_tile) {
                    rt.feature_ids.get_or_insert_with(Vec::new).extend(entities);
                }
            }

            // Charge the freshly built geometry to the memory ledger on the
            // *rendered tile* entity — the same entity `clear_caches` reads the
            // `TileCost` from when it retains the tile, and `enforce_memory_budget`
            // credits back on eviction. Without this, worker-delegated MVT tiles
            // (the default build) carried zero GPU cost, so the budget never saw
            // vector geometry and eviction/SSE pressure never triggered.
            let geometry_bytes = buf.total_bytes().saturating_sub(buf_before as usize) as u64;
            if rendered_tiles.get(ctx.rendered_tile).is_ok() {
                let cost = navara_vector_tile::estimate_vector_tile_cost(geometry_bytes);
                commands.entity(ctx.rendered_tile).insert(cost);

                // FIX 3: warm the per-layer reservation EMA with this landed
                // cost. In the default delegated_worker build the only other
                // record site (`transfer_mesh`) is dead code (construct_geometry
                // returns None), so without this the `ReserveKey::VectorLayer` EMA
                // never warms and vector reservations stay at the 512KB seed
                // forever. The key must match the RESERVATION site's derivation
                // (`data_requester/system.rs`): the first `LayerResources` entity
                // whose `tile_cache_manager` holds this tile. Both sites reduce
                // to the same first-matching layer for a shared manager.
                let layer_entity = layers.iter().find_map(|(layer_entity, layer)| {
                    let tc = tile_caches.get(layer.tile_cache_manager).ok()?;
                    (tc.rendered_tile_caches.get(&ctx.tile_handle) == Some(&ctx.rendered_tile))
                        .then_some(layer_entity)
                });
                if let Some(layer_entity) = layer_entity {
                    estimates.record(
                        navara_memory::ReserveKey::VectorLayer(layer_entity),
                        geometry_bytes,
                    );
                }

                // FIX 4: if the tile is already in the retention pool (it was
                // retained during the multi-frame worker parse, when `clear_caches`
                // pooled it with a zero `TileCost` because the cost lands only
                // now), refresh the pooled entry's cost so the evictable-pool
                // total and eviction credit converge to the real cost.
                for mut tc in tile_caches.iter_mut() {
                    if tc.rendered_tile_caches.get(&ctx.tile_handle) == Some(&ctx.rendered_tile) {
                        if let Some(entry) = tc.retained.get_mut(&ctx.tile_handle) {
                            entry.cost = cost;
                        }
                        break;
                    }
                }
            }
        }

        // The dispatch frees the pbf when it transfers it to the worker; this is
        // a no-op safety net for the path where it was never dispatched.
        buf.remove(&ctx.pbf_handle);
        // Mark the delegator for cleanup by the worker plugin's `remove` system.
        commands.entity(delegator).insert(Deleted);
    }
}

/// Cancel pending parse tasks whose tile has been evicted (its handle no longer
/// maps to a live `RenderedTile`). Marking the delegator `Deleted` lets the
/// worker plugin tear down the delegatee and cancel the JS worker-pool promise
/// (via `WorkerTaskRemovedEvent`), avoiding wasted parsing and orphan features.
#[allow(clippy::type_complexity)]
pub(crate) fn cancel_evicted_parse_tasks(
    mut commands: Commands,
    mut buf: ResMut<BufferStore>,
    tile_caches: Query<&TileCacheManager>,
    pending: Query<
        (
            Entity,
            &MvtParseFinalizeContext,
            Option<&WorkerTaskDelegateeMarker>,
        ),
        (Without<WorkerTaskCompleted>, Without<Deleted>),
    >,
) {
    for (delegator, ctx, delegatee) in &pending {
        // Still valid only while the handle maps to *this* RenderedTile. Covers
        // eviction (handle gone) and evict + re-add (handle now maps to a newer
        // tile entity).
        let still_current = tile_caches
            .iter()
            .any(|tc| tc.rendered_tile_caches.get(&ctx.tile_handle) == Some(&ctx.rendered_tile));
        if !still_current {
            // Free the pbf in case it was never dispatched (the dispatch frees it
            // otherwise; this is a no-op then), and cancel the task.
            buf.remove(&ctx.pbf_handle);
            // Marking the delegator is enough for cleanup (the worker plugin's
            // `remove` propagates to the delegatee at the despawn point), but
            // marking the delegatee here too aborts the in-flight worker-pool
            // promise one frame sooner.
            if let Some(delegatee) = delegatee {
                commands.entity(delegatee.0).insert(Deleted);
            }
            commands.entity(delegator).insert(Deleted);
        }
    }
}

/// Build one batched feature entity from a group sliced out of the packed
/// worker streams. `keys`/`values` are the layer's property table, shared via
/// `Arc` across all of the layer's groups.
#[allow(clippy::too_many_arguments)]
fn finalize_group(
    commands: &mut Commands,
    batch_table: &mut BatchTable,
    buf: &mut BufferStore,
    header: ParsedMvtGroupHeader,
    group: UnpackedMvtGroup,
    keys: Arc<Vec<String>>,
    values: Arc<Vec<tile::Value>>,
    appearances: &[Appearance],
    rtc_center: Vec3,
    tile_info: Option<(TileHandle, Extent<FloatType, Radians>)>,
    order: &OrderByDistance,
) -> Vec<Entity> {
    let Some(kind) = LayerParseKind::from_u8(header.kind).map(to_appearance_kind) else {
        return Vec::new();
    };

    let batch_id = batch_table
        .init_mvt(
            Some(header.layer_id.clone()),
            MvtLayerData::from_raw(
                keys,
                values,
                group.feature_tags_flat,
                &group.feature_tag_sizes,
            ),
        )
        .unwrap_or(0);

    let item_count = group.geometry.item_count();
    let mut global_batch_ids = Vec::with_capacity(item_count);
    for _ in 0..item_count {
        global_batch_ids.push(batch_table.gen_global_batch_id().unwrap_or(0));
    }

    // The cursor already lowered the group into a `ParsedGeometry`, so the
    // accumulator construction is shared with the synchronous path as-is.
    let accumulated = build_accumulated_geometry(group.geometry, &global_batch_ids, rtc_center);

    spawn_finalized_group(
        commands,
        buf,
        kind,
        global_batch_ids,
        batch_id,
        header.feature_count,
        accumulated,
        appearances,
        &header.layer_id,
        tile_info,
        order,
    )
}

/// Re-derive the RTC center the worker used to encode point offsets.
///
/// The tile extent is truncated to f32 (`ExtentRadianF32`) when it crosses the
/// worker boundary, so the worker computes its center from an f32-precision
/// extent. Finalizing here must round the extent the same way before computing
/// the center: the encoded f32 offsets are added back to *this* origin, so the
/// two centers must be identical. Using the raw f64 extent instead would shift
/// every point by up to ~f32 epsilon in world space (~sub-meter on Earth).
fn worker_rtc_center(ext: Extent<FloatType, Radians>) -> Vec3 {
    let rounded = Extent {
        west: Angle::new(ext.west.val() as f32 as f64),
        south: Angle::new(ext.south.val() as f32 as f64),
        east: Angle::new(ext.east.val() as f32 as f64),
        north: Angle::new(ext.north.val() as f32 as f64),
    };
    Aabb::from_extent_f64(rounded, 0., 1.).center
}

#[cfg(test)]
mod test {
    use bevy_ecs::system::RunSystemOnce;
    use bevy_ecs::world::World;
    use navara_buffer_store::BufferStore;
    use navara_component::Deleted;
    use navara_worker::DelegatedWorkerTaskMarker;

    use super::*;

    /// A cancelled parse marks both the delegator and its delegatee `Deleted`
    /// in the same pass. The worker plugin's `remove` would propagate to the
    /// delegatee at the delegator's despawn anyway; marking it here directly
    /// aborts the in-flight worker-pool promise one frame sooner.
    #[test]
    fn it_should_cancel_the_delegatee_together_with_the_delegator() {
        let mut world = World::new();
        let mut buf = BufferStore::new();
        let pbf_handle = buf.new_u8(vec![1, 2, 3]);
        world.insert_resource(buf);

        let rendered_tile = world.spawn_empty().id();
        let delegatee = world.spawn(DelegatedWorkerTaskMarker).id();
        let delegator = world
            .spawn((
                MvtParseFinalizeContext {
                    rendered_tile,
                    tile_handle: 0,
                    tile_extent: None,
                    order: OrderByDistance {
                        sse: 0.,
                        distance: 0.,
                    },
                    appearances: Vec::new(),
                    pbf_handle,
                },
                WorkerTaskDelegateeMarker(delegatee),
            ))
            .id();

        // No TileCacheManager exists, so the tile is not current: the task
        // must be cancelled.
        world.run_system_once(cancel_evicted_parse_tasks).unwrap();

        assert!(world.entity(delegator).contains::<Deleted>());
        assert!(world.entity(delegatee).contains::<Deleted>());
        assert!(world.resource::<BufferStore>().is_empty());
    }

    /// FIX 1 (worker path): finalizing a worker-parsed MVT tile must charge the
    /// built geometry to the ledger by inserting a `TileCost` on the *rendered
    /// tile* entity — the same entity `clear_caches`/`enforce_memory_budget`
    /// read the cost from. In the default `delegated_worker` build,
    /// `construct_geometry` only spawns the parse task (returns `None`), so
    /// `transfer_mesh` inserts nothing; without this, worker MVT tiles carried
    /// zero GPU cost and the budget never saw vector geometry.
    #[test]
    fn it_should_charge_a_tile_cost_when_finalizing_worker_geometry() {
        use std::sync::Arc;

        use bevy_ecs::system::RunSystemOnce;
        use geozero::mvt::tile;
        use navara_material::{Appearance, PointMaterial};
        use navara_math::Vec3;
        use navara_memory::MemoryLedger;
        use navara_parser::mvt::{
            LayerParseKind, ParsedGeometry, ParsedLayerGroup, pack_parsed_mvt_groups,
        };
        use navara_vector_tile::{RenderedTile, TileCacheManager};
        use navara_worker::{WorkerTaskCompleted, parse_mvt_tile::ParseMvtTileResult};

        let mut world = World::new();
        world.init_resource::<BatchTable>();
        world.init_resource::<MemoryLedger>();
        world.init_resource::<navara_memory::ReserveEstimates>();

        // A single point group, packed exactly as the worker would hand it back.
        let group = ParsedLayerGroup {
            layer_id: "poi".to_string(),
            kind: LayerParseKind::Point,
            feature_count: 2,
            feature_tags_flat: vec![],
            feature_tag_sizes: vec![0, 0],
            keys: Arc::new(vec![]),
            values: Arc::new(vec![] as Vec<tile::Value>),
            geometry: ParsedGeometry::Points {
                coords: vec![Vec3::new(1.0, 2.0, 0.0), Vec3::new(3.0, 4.0, 0.0)],
                batch_indices: vec![0, 1],
                encoded_coords: vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
                bearings: vec![],
                scale_bands: vec![],
                path_samples: vec![],
                path_meta: vec![],
            },
        };
        let packed = pack_parsed_mvt_groups(vec![group]);

        let mut buf = BufferStore::new();
        let result = ParseMvtTileResult {
            f64_handle: buf.new_f64(packed.f64_stream),
            f32_handle: buf.new_f32(packed.f32_stream),
            u32_handle: buf.new_u32(packed.u32_stream),
            u8_handle: buf.new_u8(packed.u8_stream),
            meta: packed.meta,
        };
        // Stand-in pbf (freed by finalize's safety-net remove).
        let pbf_handle = buf.new_u8(vec![0u8; 8]);
        world.insert_resource(buf);

        let handle: TileHandle = 0;
        let rendered_tile = world
            .spawn(RenderedTile {
                tile_handle: handle,
                feature_ids: None,
            })
            .id();

        // The tile must be the canonical rendered tile for its handle so the
        // finalize path treats the result as current and builds geometry.
        let mut tc = TileCacheManager::default();
        tc.rendered_tile_caches.insert(handle, rendered_tile);
        world.spawn(tc);

        world.spawn((
            result,
            WorkerTaskCompleted,
            MvtParseFinalizeContext {
                rendered_tile,
                tile_handle: handle,
                tile_extent: None,
                order: OrderByDistance {
                    sse: 0.,
                    distance: 0.,
                },
                appearances: vec![(
                    "poi".to_string(),
                    Arc::new(vec![Appearance::Point(PointMaterial::default())]),
                )],
                pbf_handle,
            },
        ));

        world.run_system_once(finalize_parsed_mvt).unwrap();

        // A real, non-zero cost was charged on the rendered tile...
        let cost = world
            .entity(rendered_tile)
            .get::<navara_memory::TileCost>()
            .expect("a TileCost must be inserted on the rendered tile");
        assert!(
            cost.gpu_est > 0,
            "worker-built geometry must carry a non-zero GPU estimate, got {cost:?}"
        );
        // ...and the component hook mirrored it into the ledger.
        assert_eq!(
            world.resource::<MemoryLedger>().gpu_bytes_est,
            cost.gpu_est,
            "the TileCost hook must have added the geometry to the ledger"
        );
    }

    /// A tile with nothing for the layers still finishes parsing. Its feature
    /// list must become empty rather than stay unset: unset is how the
    /// traversal tells a parse in flight, and a parent keeps drawing in place
    /// of children until every one of them has parsed.
    #[test]
    fn it_should_mark_a_tile_with_no_features_as_parsed() {
        use bevy_ecs::system::RunSystemOnce;
        use navara_memory::MemoryLedger;
        use navara_parser::mvt::pack_parsed_mvt_groups;
        use navara_vector_tile::{RenderedTile, TileCacheManager};
        use navara_worker::{WorkerTaskCompleted, parse_mvt_tile::ParseMvtTileResult};

        let mut world = World::new();
        world.init_resource::<BatchTable>();
        world.init_resource::<MemoryLedger>();
        world.init_resource::<navara_memory::ReserveEstimates>();

        let packed = pack_parsed_mvt_groups(vec![]);
        let mut buf = BufferStore::new();
        let result = ParseMvtTileResult {
            f64_handle: buf.new_f64(packed.f64_stream),
            f32_handle: buf.new_f32(packed.f32_stream),
            u32_handle: buf.new_u32(packed.u32_stream),
            u8_handle: buf.new_u8(packed.u8_stream),
            meta: packed.meta,
        };
        let pbf_handle = buf.new_u8(vec![0u8; 8]);
        world.insert_resource(buf);

        let handle: TileHandle = 0;
        let rendered_tile = world
            .spawn(RenderedTile {
                tile_handle: handle,
                feature_ids: None,
            })
            .id();
        let mut tc = TileCacheManager::default();
        tc.rendered_tile_caches.insert(handle, rendered_tile);
        world.spawn(tc);

        world.spawn((
            result,
            WorkerTaskCompleted,
            MvtParseFinalizeContext {
                rendered_tile,
                tile_handle: handle,
                tile_extent: None,
                order: OrderByDistance {
                    sse: 0.,
                    distance: 0.,
                },
                appearances: Vec::new(),
                pbf_handle,
            },
        ));

        world.run_system_once(finalize_parsed_mvt).unwrap();

        let rt = world.entity(rendered_tile).get::<RenderedTile>().unwrap();
        assert_eq!(rt.feature_ids.as_deref(), Some(&[][..]));
    }
}
