use bevy_ecs::query::Without;
use bevy_ecs::{
    entity::Entity,
    query::{Added, With},
    system::{Commands, Query, Res, ResMut},
};
use navara_buffer_store::BufferStore;
use navara_component::Deleted;
use navara_core::WGS84_32;
use navara_geometry::TransferableGeometry;
use navara_tile_component::TerrainTileQuadtree;

use super::{UpsampleTerrainMeshParameters, UpsampleTerrainMeshResult};
use crate::WorkerTaskMarker;

#[allow(clippy::type_complexity)]
#[cfg(not(feature = "delegated_worker"))]
pub(crate) fn upsample_terrain_mesh(
    mut commands: Commands,
    qt: Res<TerrainTileQuadtree>,
    mut buf: ResMut<BufferStore>,
    constructors: Query<
        (Entity, &UpsampleTerrainMeshParameters),
        (
            Added<WorkerTaskMarker>,
            With<WorkerTaskMarker>,
            Without<Deleted>,
        ),
    >,
) {
    use navara_geometry::UpsamplableTerrainGeometry;

    for (e, constructor) in &constructors {
        let tile = match qt.qt.get(constructor.tile_handle) {
            Some(t) => t,
            None => continue,
        };
        let source = match qt.qt.get(constructor.source_tile_handle) {
            Some(t) => t,
            None => continue,
        };

        let cached_mesh_handle = match &source.cached_mesh_handle {
            Some(c) => c,
            None => continue,
        };

        let (uvs, heights, indices) = match (
            buf.get_f32(&cached_mesh_handle.uvs),
            cached_mesh_handle.heights.and_then(|h| buf.get_f32(&h)),
            buf.get_u32(&cached_mesh_handle.indices),
        ) {
            (Some(u), Some(h), Some(i)) => (u, h, i),
            _ => continue,
        };
        let watermask = cached_mesh_handle.watermask.and_then(|h| buf.get_u8(&h));

        let returned = tile
            .upsample(
                WGS84_32,
                source,
                UpsamplableTerrainGeometry {
                    uvs,
                    heights,
                    indices,
                    normals: None,
                    watermask,
                },
            )
            .unwrap();

        commands.entity(e).insert(UpsampleTerrainMeshResult {
            geometry: TransferableGeometry::with_buf(&mut buf, returned.geometry),
            heights: buf.new_f32(returned.heights),
            max_height: returned.max_height,
            min_height: returned.min_height,
            rtc_translation: returned.rtc_translation,
            watermask: returned.watermask.map(|w| buf.new_u8(w)),
        });
    }
}
