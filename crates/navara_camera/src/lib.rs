#![doc = include_str!("../README.md")]

mod comp;
mod event;
mod fit_bounds;
mod follow;
mod helpers;
mod plugin;
mod system;

pub use comp::*;
pub use event::*;
pub use fit_bounds::{
    FitBoundsFrame, FitBoundsPose, FitBoundsTarget, FitBoundsTargets, MIN_FIT_DISTANCE,
    compute_fit_bounds_camera, fit_bounds_positions,
};
pub use helpers::*;
pub use plugin::CameraPlugin;
