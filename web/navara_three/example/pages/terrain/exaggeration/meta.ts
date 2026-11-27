import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/tile/terrainExaggeration*",
    "web/navara_three/src/terrain/exaggeration*",
    "shaders/glsl/chunks/terrain_exaggeration*",
    "crates/navara_tile_component/src/terrain_exaggeration.rs",
  ],
  lookFor:
    "Mt. Fuji under terrain exaggeration with a ground-clamped summit marker; the exaggeration and relativeHeight bindings should raise the surface and the marker together, and the summit height readout should report the exaggerated surface.",
  params: {},
  evidenceFor: [],
} satisfies DevPageMeta;
