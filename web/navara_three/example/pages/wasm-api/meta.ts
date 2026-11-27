import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/terrain/sampleTerrainMostDetailed*",
    "web/navara_three/src/terrain/terrainHeightEvent*",
    "web/navara_three/src/pick/pickTerrain*",
    "web/navara_three_api/**",
    "crates/navara_wasm_api",
  ],
  lookFor:
    "Geodetic utilities on terrain: a model on the surface normal, frame transforms (northUpEast and others), geodesic distance and interpolation between two points, a ball under the cursor from screen-to-world or sampleTerrainMostDetailed, sampleTerrainHeight readouts, terrain-height events placing the Fuji and Kita models, and frustum fov/near/far. Placed objects should sit on the rendered surface and readouts should match it.",
  params: {},
  evidenceFor: [
    191, 194, 195, 197, 199, 207, 208, 212, 213, 238, 241, 250, 318, 404, 432,
    539, 774, 806, 1030,
  ],
} satisfies DevPageMeta;
