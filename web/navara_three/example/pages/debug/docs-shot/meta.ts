import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: [
    "docs/src/content/docs/three/Tutorial/realistic-atmosphere.mdx",
    "docs/src/content/docs/three/Tutorial/interior-explore.md",
    "docs/src/content/docs/three/Tutorial/basic-visualization.mdx",
  ],
  lookFor:
    "Screenshot rig for the docs tutorials: each mode renders the scene of the matching tutorial snippet (clouds, rain, snow, water, SSR, interior walk, basic terrain and GeoJSON), so the published images stay in sync with the code shown.",
  params: {
    m: "mode: clouds | rain | snow | water | ssr (realistic-atmosphere), interior (interior-explore), basic-terrain | basic-geojson (basic-visualization); default clouds",
    exp: "overrides toneMappingExposure",
    lng: "overrides the camera longitude",
    lat: "overrides the camera latitude",
    h: "overrides the camera height (m)",
    hd: "overrides the camera heading (deg)",
    p: "overrides the camera pitch (deg)",
  },
  evidenceFor: [],
} satisfies DevPageMeta;
