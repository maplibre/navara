#![doc = include_str!("../README.md")]

mod order;
mod priority;

pub use order::*;
pub use priority::*;

use bevy_ecs::component::Component;

#[derive(Component)]
pub struct Deleted;

#[derive(Component)]
pub struct Requested;

/// A data request its pipeline holds back until it has a request slot for
/// it. The senders skip it.
#[derive(Component)]
pub struct Waiting;

/// A data request its pipeline held back with [`Waiting`] and has now given a
/// request slot. The senders send it like a newly added one.
#[derive(Component)]
pub struct Resumed;

#[derive(Component)]
pub struct Completed;

#[derive(Component)]
pub struct Ignored;

#[derive(Component)]
pub struct Rendered;
