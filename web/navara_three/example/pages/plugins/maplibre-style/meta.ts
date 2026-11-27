import type { DevPageMeta } from "../../../helpers/devPageMeta";

export default {
  covers: ["web/navara_maplibre_style/**"],
  lookFor:
    "The MapLibre demotiles globe style (https://demotiles.maplibre.org/globe.json) rendered through MapLibreStylePlugin on an ellipsoid terrain, with Open Sans font overrides and forceMapLibreFov; compare with maplibre-gl-js (pnpm test:maplibre for the render tests).",
  params: {},
  evidenceFor: [752, 820, 853, 873],
} satisfies DevPageMeta;
