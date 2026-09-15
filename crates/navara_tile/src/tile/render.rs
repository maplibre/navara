use bevy_ecs::{component::Component, entity::Entity, system::Commands};

use navara_component::Deleted;
use navara_tile_component::TileHandle;

#[derive(Component, Default)]
pub struct RenderedTile {
    pub(crate) tile_handle: TileHandle,
    pub(crate) terrain_mesh_constructor: Option<Entity>,
    pub(crate) terrain_mesh_upsampler: Option<Entity>,
}

impl RenderedTile {
    pub fn destroy(&mut self, commands: &mut Commands) {
        for task in [
            self.terrain_mesh_constructor.take(),
            self.terrain_mesh_upsampler.take(),
        ]
        .into_iter()
        .flatten()
        {
            // Failed or cancelled tasks may be removed before their tile.
            if let Ok(mut entity) = commands.get_entity(task) {
                entity.try_insert(Deleted);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_ecs::{system::RunSystemOnce, world::World};

    #[test]
    fn destroy_cancels_live_tasks_and_tolerates_already_removed_tasks() {
        let mut world = World::new();
        let removed = world.spawn_empty().id();
        world.despawn(removed);
        let replacement = world.spawn_empty().id();
        let live = world.spawn_empty().id();
        let mut tile = RenderedTile {
            terrain_mesh_constructor: Some(live),
            terrain_mesh_upsampler: Some(removed),
            ..Default::default()
        };
        world
            .run_system_once(move |mut commands: Commands| {
                tile.destroy(&mut commands);
                assert!(tile.terrain_mesh_constructor.is_none());
                assert!(tile.terrain_mesh_upsampler.is_none());
            })
            .unwrap();
        assert!(world.get::<Deleted>(live).is_some());
        assert!(world.get::<Deleted>(replacement).is_none());
    }

    #[test]
    fn destroy_tolerates_a_task_despawn_queued_in_the_same_frame() {
        let mut world = World::new();
        let task = world.spawn_empty().id();
        let mut tile = RenderedTile {
            terrain_mesh_upsampler: Some(task),
            ..Default::default()
        };
        world
            .run_system_once(move |mut commands: Commands| {
                commands.entity(task).despawn();
                tile.destroy(&mut commands);
            })
            .unwrap();
        assert!(world.get_entity(task).is_err());
    }
}
