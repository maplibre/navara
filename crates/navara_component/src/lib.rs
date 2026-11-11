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
/// it. The senders skip it; the pipeline sends it itself when it releases it.
#[derive(Component)]
pub struct Waiting;

#[derive(Component)]
pub struct Completed;

#[derive(Component)]
pub struct Ignored;

#[derive(Component)]
pub struct Rendered;
