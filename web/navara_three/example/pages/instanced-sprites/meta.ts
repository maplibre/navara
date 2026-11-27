import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "web/navara_three/src/mesh/sprite/**",
    "web/navara_three/src/material/enhancer/instancedSprite/**",
    "shaders/glsl/instancedSprite*",
    "shaders/glsl/chunks/rtc_sprite_vertex.glsl",
    "shaders/glsl/chunks/sprite_height_pars_vertex.glsl",
  ],
  lookFor:
    "Instanced sprites sized in meters and clamped to the ground: GeoJSON MultiPoint billboards (bottom-anchored image, alpha test) and GSI vector-tile points; the material pane edits each layer, and clicking a sprite selects its feature. Sprites should keep their size in meters while zooming and not z-fight with the ground.",
  params: {},
  evidenceFor: [434, 444, 690, 800],
} satisfies DevPageMeta;
