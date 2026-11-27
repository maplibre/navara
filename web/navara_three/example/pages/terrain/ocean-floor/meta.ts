import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/tile/terrainExaggeration*",
    "web/navara_three/src/terrain/exaggeration*",
    "shaders/glsl/chunks/terrain_exaggeration*",
    "crates/navara_tile_component/src/terrain_exaggeration.rs",
  ],
  lookFor:
    "Sea-floor stations and a transect clamped to AWS Terrarium terrain below the ellipsoid along the Suruga and Nankai Troughs; the points and line should sit on the ocean floor at every exaggeration and relativeHeight, including negative ones, and the camera buttons give oblique and straight-down views.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
