# Visualizing a flood series

Exact properties: https://navara.world/docs/three_flood_mesh/api/time-series-flood-mesh-desc/ and https://navara.world/docs/three_flood_mesh/api/series-functions/.

## Scene

```typescript
import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import type { SkyMeshDesc } from "@navaramap/three-default-descs";
import {
  TimeSeriesFloodMeshDesc,
  type TimeSeriesFloodMeshConfig,
  type TimeSeriesFloodSeries,
} from "@navaramap/three-flood-mesh";

type Descriptions = DefaultDescriptions | { mesh: TimeSeriesFloodMeshConfig };

const view = new ThreeView<Descriptions>({ animation: true });
const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
await view.init();
view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc); // after init()

defaultPlugin.addDefaultPhotorealScene();
view.addMesh<SkyMeshDesc>({ sky: { envMap: true } }); // the water reflects this sky
// About 10 am local solar time at longitude `lng` of the site.
view.atmosphere.date = new Date(
  Date.UTC(2024, 9, 21, 10) - (lng / 15) * 3_600_000,
);
// + ellipsoidal terrain, imagery, buildings: the navara-usage photoreal recipe
```

- **Type the view with the union** above. `ThreeView<DefaultDescriptions>` alone rejects `addMesh({ timeSeriesFlood })` (TS2353).
- **Daylight**: at the default date the scene can be night-dark over the site, and the water unreadable. Set `view.atmosphere.date` to a daytime instant for the site, as above (see navara-usage on `atmosphere.date`).

- `animation: true`: waves and flow drift move only while frames render, and playback driven from `preUpdate` needs continuous frames.
- Without a `sky: { envMap: true }` mesh, the water reflects only the light probe's low-frequency sky.
- **Terrain datum**: the water is in ellipsoidal heights. Use an ellipsoidal terrain (Re:Earth Terrain `…/cesium-mesh/ellipsoid/…`); over terrain on another datum, compensate with `heightOffset` (meters).
- **Shallow water hidden by the terrain** (inland flooding tens of centimeters deep, a terrain from another elevation model than the simulation's): `showUnderground: 2` draws water up to 2 m below the terrain on it, while water deep below (behind a hill) stays hidden. Use it only once the extent is known to be right; it does not fix the data, and `heightOffset` would lift all the water instead.
- Buildings (3D Tiles) under the water are covered like the terrain; only their parts above the surface stay visible.
- A tsunami drawdown (sea levels below 0) is drawn under the terrain's own sea surface (`requestWaterMask`) and looks missing: expected. Show it with `colorBy`, or without the water mask.

## Loading: `url` or `loadTimeSeriesFlood`

| Use                                          | When                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeSeriesFlood: { url }`                   | Default. Loads in a worker of its own; the page stays responsive. Listen to `water.ref.on("progress" \| "load" \| "error")`. A query string (token) is kept on every request.                                                                                                                                        |
| `series: await loadTimeSeriesFlood({ url })` | You need a custom `fetch` (headers, signed URLs — functions can't be posted to the mesh's worker), an in-memory `store` from a converter, an `AbortSignal`, or the series before adding the mesh. Runs on the calling thread: move it into your own worker for large series (a series is plain data and posts back). |

```typescript
const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "/flood.zarr", frame: 0 },
});
const series = await new Promise<TimeSeriesFloodSeries>((resolve, reject) => {
  water.ref.on("load", resolve);
  water.ref.on("error", reject);
});
```

Other properties can be updated while it loads; they apply when the surface shows. `series`/`url` are fixed for the mesh's life: to switch scenarios, `water.delete()` and add a new mesh.

## Fit the camera to the flood

```typescript
const { west, south, east, north } = series.bounds;
const lat = (south + north) / 2;
const size = Math.max(
  (east - west) * 111_320 * Math.cos((lat * Math.PI) / 180),
  (north - south) * 110_950,
);
view.flyTo({ lng: (west + east) / 2, lat, distance: size, pitch: -45 });
```

With `distance`, `lng`/`lat` is the point looked at, not the camera position. A long, narrow river flood fitted by its longest side looks thin from there, and the default muddy water is hard to see from tens of kilometers over satellite imagery: check the first render with a `colorBy` view or from a few kilometers before concluding nothing is drawn.

## Playback

`frame` is a fractional index. A fractional frame blends the two frames' heights and moves the shoreline geometrically (not a flow model); `Math.floor(frame)` shows only the data's own frames. Frames may be unevenly spaced, so drive playback by **time**, not by frame index:

```typescript
import { frameToTime, timeToFrame } from "@navaramap/three-flood-mesh";

const label = document.querySelector("#time")!;
const start = series.times[0].getTime();
const end = series.times[series.times.length - 1].getTime();
const startedAt = performance.now();
view.on("preUpdate", () => {
  const time =
    start + (((performance.now() - startedAt) * 600) % (end - start)); // 10 sim-min per second
  const frame = timeToFrame(series, time);
  water.update({ timeSeriesFlood: { frame } });
  label.textContent = `+${((frameToTime(series, frame).getTime() - start) / 3_600_000).toFixed(1)} h`;
});
```

Label with the time elapsed since `series.times[0]` (or since the breach / earthquake) when the data gave only elapsed times and the `epoch` was chosen arbitrarily; show absolute dates only when the epoch is real.

`series.changes[k]` (cells turning wet/dry between `k` and `k + 1`) can slow playback where the water moves most.

## Look

| Goal                                  | Setting                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| River flood (muddy)                   | default `color` `#5a3f1c`                                                                                                     |
| Sea / tsunami                         | a blue-green `color`, e.g. `new Color().setStyle("#3f6f8f")`                                                                  |
| Street-level camera inside deep water | `doubleSide: true`                                                                                                            |
| Shallow sheets too faint/strong       | `shallowOpacity`, `opacity`, `absorption`                                                                                     |
| Waves without a stored flow           | `waveDirection` (deg from north), `waveStrength` (1 calm … 20 storm), `flowSpeed` (m/s), `waterScale` (`"small"` for streets) |
| Still mirror                          | `waveExaggeration: 0`                                                                                                         |

With a stored flow (`flow_east`/`flow_north`), the waves follow it and `flowSpeed` is ignored.

## Coloring by properties (hazard maps)

`series.properties` lists what can be colored: stored ones plus derived `depth` (needs ground), `speed` (needs flow), `arrival` (h from the **first frame** until first wet — not from the event, when the data starts later), `duration` (h wet), `rate` (m/h level change). The ground and the flow components (`flow_east`/`flow_north`) are read for `depth` and the waves but not listed, so they can be neither colored nor sampled; the report's "ground while shown" line does not mean it is offered. Each has `min`/`max`, `low`/`high` (2nd/98th percentiles — use these for linear scales so outliers don't wash out the colors), and `units`/`label` for a legend. Check a property exists before offering it. A stored property takes precedence over a derived one of the same name (a stored `speed` column is shown as stored).

The values and maxima (`max`, `extent: "max"`) cover only the frames kept by `interval` / `maxLevelError`, which are chosen on the water level: a short peak of another property, such as the speed at the breach, can be missed. Reconvert without thinning when a peak matters.

```typescript
const color = (style: string) => new Color().setStyle(style);

// Depth in the Japanese hazard-map classes (0.5 / 3 / 5 / 10 / 20 m), at the frame shown.
water.update({
  timeSeriesFlood: {
    colorBy: {
      property: "depth",
      scale: {
        type: "threshold",
        breaks: [0.5, 3, 5, 10, 20],
        colors: [
          "#f7f5a9",
          "#ffd8c0",
          "#ffb7b7",
          "#ff9191",
          "#f285c9",
          "#dc7adc",
        ].map(color),
      },
    },
  },
});

// Maximum depth over the whole flood: same scale with extent "max" (ignores frame).
// colorBy and extent may be set in one update or separately.
water.update({ timeSeriesFlood: { extent: "max" } });

// Flow speed, robust range.
const { low, high, units } = series.properties.speed;
water.update({
  timeSeriesFlood: {
    extent: "frame",
    colorBy: {
      property: "speed",
      scale: {
        type: "linear",
        stops: [
          [low, color("#2c7bb6")],
          [high, color("#d7191c")],
        ],
      },
    },
  },
});

// Back to water.
water.update({ timeSeriesFlood: { colorBy: null, extent: "frame" } });
```

- `threshold`: one more color than breaks (≤ 32 breaks). `category`: `values` + `colors` + `other` (≤ 32), interpolation off by default. `linear`: `stops` interpolated in linear RGB.
- `arrival` and `duration` do not change over time: show them with `extent: "max"` to cover every cell the water reaches.
- The colored surface is unlit with uniform opacity (`colorBy.opacity`, default 0.85), so it reads against a legend. Colors are pre-divided by the exposure so a neutral tone mapping shows them as given.
- Changing `colorBy` cross-fades over `transition` ms (default 300).

## Picking and charts

```typescript
import { vector3ToGeodetic } from "@navaramap/three";
import { sampleTimeSeriesFlood } from "@navaramap/three-flood-mesh";

view.on("click", (event) => {
  const picked = view.pickDepthPosition(event.clientX, event.clientY);
  if (!picked) return;
  const sample = sampleTimeSeriesFlood(
    series,
    vector3ToGeodetic(picked),
    frame,
  ); // or "max"
  // sample?.wet, sample?.level (ellipsoidal, without heightOffset), sample?.properties.depth
});

// Depth at one point over every frame:
const depths = series.times.map(
  (_, k) => sampleTimeSeriesFlood(series, { lng, lat }, k)?.properties.depth,
);
```

`undefined` means the water never reaches the point. With a `url` mesh, the series comes from the `load` event (or `water.ref.series`).

## Serving the Zarr group

- Serve the directory as static files. A chunk with no water is **not written**, so the server must answer **404** for it — a single-page-app fallback that returns `index.html` with 200 breaks loading.
- The browser console logs "Failed to load resource: 404" for those chunks. That is expected, not an error to chase.
- Vite: set `appType: "mpa"` (the default `"spa"` falls back to `index.html` for extensionless chunk paths). Put the group in `public/` or host it elsewhere with CORS.

## GPU memory

Every frame is on the GPU: with `R ≈ nodes` rounded up to 2048, water `R × (frames + 1) × 4` B, flow the same, each property shown `R × (frames + 1) × 2` B (static ones `R × 2`), three most recent properties cached. The converter report's `GPU textures` line gives the numbers. Too big → reconvert with a larger `interval` / `maxLevelError`; there is no runtime thinning.
