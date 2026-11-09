import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";
import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

/**
 * Render activity polled by the Playwright spec, which also tracks network
 * requests, to decide when a frame is final.
 */
type HarnessState = {
  lastRender: number;
  idleCount: number;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- global augmentation needs declaration merging
  interface Window {
    harness: {
      state: HarnessState;
      run: (style: object | string) => Promise<void>;
    };
  }
}

const state: HarnessState = {
  lastRender: performance.now(),
  idleCount: 0,
};

/** The checkout made by render/setup.ts, served by Vite. */
const UPSTREAM_URL = `${location.origin}/maplibre-gl-js/test/integration`;
/** maplibre-gl-js serves `local://` from test/integration/assets the same way. */
const ASSETS_URL = `${UPSTREAM_URL}/assets/`;

function localizeUrls(value: unknown): unknown {
  if (typeof value === "string") {
    return value.startsWith("local://")
      ? ASSETS_URL + value.slice("local://".length)
      : value;
  }
  if (Array.isArray(value)) return value.map(localizeUrls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, localizeUrls(v)]),
    );
  }
  return value;
}

/**
 * Navara shades fill-extrusion and hillshade only through scene lights. The
 * sun follows `atmosphere.date`, so it is pinned to the equinox at noon over
 * 30°N (60° elevation, from the south, like MapLibre's default 30° polar
 * light) and shifted to the same elevation over the style center.
 */
const SUN_DATE = new Date("2024-03-20T12:00:00Z");
const SUN_REFERENCE = { lat: 30, lng: 0 };
// Tuned so lit faces keep the style color (three's Lambert divides by π).
const SUN_INTENSITY = 1.8;
const AMBIENT_INTENSITY = 1.6;

/**
 * Takes the style itself (the spec reads it from disk) or, for manual runs in
 * the dev server, a case id (a directory under render/tests/) without `#`.
 */
async function run(input: object | string) {
  const raw: unknown =
    typeof input === "string"
      ? await (
          await fetch(`${UPSTREAM_URL}/render/tests/${input}/style.json`)
        ).json()
      : input;
  const style = localizeUrls(raw) as StyleSpecification;
  // The plugin keeps the current camera for root camera properties the style
  // omits, as MapLibre's jumpTo(style) does. maplibre-gl-js starts from a new
  // Map, so start from its defaults.
  style.center ??= [0, 0];
  style.zoom ??= 0;
  style.bearing ??= 0;
  style.pitch ??= 0;
  style.roll ??= 0;
  const [lng, lat] = style.center;

  const view = new ThreeView<DefaultDescriptions>({
    // Matches pixelmatch, which blends transparent expected pixels onto white.
    backgroundColor: new Color().setRGB(1, 1, 1),
    defaultAttribution: false,
    picking: false,
    idleThreshold: 300,
    // LOD fog relaxes SSE by ~2 px even for the nearest tiles at these camera
    // distances, which costs DEM cases a level of detail (hillshade and
    // color-relief look blurry). The harness does not need its savings.
    ...(Object.values(style.sources ?? {}).some(
      (s) => s.type === "raster-dem",
    ) && {
      lodFog: { enabled: false },
    }),
  });
  view.on("postRender", () => {
    state.lastRender = performance.now();
  });
  view.on("idle", () => {
    state.idleCount++;
  });
  view.atmosphere.date = SUN_DATE;
  view.atmosphere.setElevationAt(SUN_REFERENCE, { lng, lat });
  view.addPlugin(new DefaultPlugin());
  view.addPlugin(new MapLibreStylePlugin(style, { forceMapLibreFov: true }));
  await view.init();
  view.addLight({
    // A fixed white sun; MapLibre casts no shadows.
    sun: {
      intensity: SUN_INTENSITY,
      applyColor: true,
      castShadow: false,
    },
  });
  view.addLight({ ambient: { intensity: AMBIENT_INTENSITY } });
  if (!style.terrain) {
    view.addLayer({ type: "terrain", ellipsoid: {} });
  }
}

window.harness = { state, run };
