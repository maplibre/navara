import type { DevPageMeta } from "../../helpers/devPageMeta";

export default {
  covers: [
    "crates/navara_pmtiles",
    "crates/pmtiles",
    "crates/navara_vector_tile",
    "crates/navara_mvt",
    "crates/navara_parser/src/mvt/**",
    "web/navara_three/src/tasks/parseMvt*",
    "web/navara_worker/src/tasks/parseMvtTile.ts",
    "web/navara_three/src/mesh/tile/vectorDrapeResolver*",
  ],
  lookFor:
    "One Protomaps PMTiles archive of Florence feeds five clamp-to-ground vector layers (earth, boundaries, water, roads, buildings) draped on a plain ellipsoid. Look for missing source layers, tiles that never load, or the draping order (earth below the rest) breaking.",
  params: {},
  evidenceFor: [637, 679],
} satisfies DevPageMeta;
