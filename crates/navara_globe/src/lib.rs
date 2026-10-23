#![doc = include_str!("../README.md")]

use bevy_app::{App, Plugin};
use bevy_ecs::prelude::Resource;
use navara_core::TilingScheme;
use serde::{Deserialize, Serialize};

/// Globe resource that manages shared properties across different material types.
///
/// This resource provides centralized configuration for VectorTile, TerrainTile,
/// and RasterTerrain materials, replacing individual material properties with
/// a unified globe configuration.
#[derive(Debug, Clone, PartialEq, Resource, Serialize, Deserialize)]
pub struct Globe {
    /// Screen-space error threshold for level of detail (LOD) calculations.
    /// Used by the raster and terrain tile pipelines; vector-tile traversal uses
    /// the source's `max_sse` (or this value for clamp-to-ground features).
    pub max_sse: f32,

    /// Number of segments for mesh tessellation.
    /// Used by RasterMaterial.
    /// TerrainMaterial maintains individual segment control.
    pub segments: usize,

    /// Base color for the globe surface (RGB as u32, e.g., 0xffffff for white).
    /// Used by RasterMaterial and TerrainMaterial.
    pub color: u32,

    /// Whether to hide underground geometry.
    /// Used by RasterMaterial and TerrainMaterial.
    pub hide_underground: bool,

    /// Whether to use normals
    pub use_normal: bool,

    /// Whether materials should be transparent.
    /// Used by RasterMaterial and TerrainMaterial.
    pub transparent: bool,

    /// Global opacity for materials (0.0 to 1.0).
    /// Used by RasterMaterial and TerrainMaterial.
    /// Note: This is different from RasterMaterial's per-texture opacity used for blending.
    pub opacity: f32,

    /// Whether to render materials in wireframe mode.
    /// Used by RasterMaterial and TerrainMaterial.
    pub wireframe: bool,

    /// Tiling scheme for the quadtree.
    /// `WebMercator` (default): single root (0,0,0), WM extents.
    /// `Geographic`: two roots (0,0,0) and (1,0,0), equal-degree extents.
    pub tiling_scheme: TilingScheme,
}

impl Default for Globe {
    fn default() -> Self {
        Self {
            max_sse: 2.0,
            segments: 10,
            color: 0xffffff,
            hide_underground: true,
            use_normal: false,
            transparent: false,
            opacity: 1.0,
            wireframe: false,
            tiling_scheme: TilingScheme::WebMercator { tms: false },
        }
    }
}

/// Plugin that adds the Globe resource to the Bevy app.
pub struct GlobePlugin;

impl Plugin for GlobePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Globe>();
    }
}
