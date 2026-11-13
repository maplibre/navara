---
title: Series Functions
description: loadTimeSeriesFlood, sampleTimeSeriesFlood, timeToFrame and frameToTime.
sidebar:
  order: 2
since: nightly
---

## loadTimeSeriesFlood

**Type:** `(options: TimeSeriesFloodSeriesOptions) => Promise<TimeSeriesFloodSeries>`

**Description:** Loads a water-surface series from a Zarr group. The returned series is passed to the `series` property.

**Example:**

```typescript
import { loadTimeSeriesFlood } from "@navaramap/three-flood-mesh";

const series = await loadTimeSeriesFlood({
  url: "https://example.com/flood.zarr",
  variables: { waterLevel: "level", signedDistance: "shore_distance" },
});
```

### TimeSeriesFloodSeriesOptions

Give either `url` or `store`.

| Property     | Type                                                     | Description                                                                                                                         |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `url`        | `string \| URL`                                          | URL of the Zarr group. A relative URL resolves against the page. A query string, such as an access token, is kept on every request  |
| `fetch`      | `((request: Request) => Promise<Response>) \| undefined` | With `url`, sends each request instead of `fetch`, such as to add a header or sign the URL. A 404 response reads as a missing chunk |
| `store`      | `Readable`                                               | A [zarrita](https://zarrita.dev/) store holding the group at its root, such as the `Map` a converter writes                         |
| `variables`  | `TimeSeriesFloodVariables \| undefined`                  | Names of the arrays to read                                                                                                         |
| `signal`     | `AbortSignal \| undefined`                               | Aborts the loading, which then rejects with the signal's reason                                                                     |
| `onProgress` | `((fraction: number) => void) \| undefined`              | Called as the loading advances with a rough share of the work done, from 0 up to 1                                                  |

### TimeSeriesFloodVariables

| Property         | Type                                         | Default         | Description                                                                                                                                                |
| ---------------- | -------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waterLevel`     | `string \| undefined`                        | `"water_level"` | Water-surface heights                                                                                                                                      |
| `time`           | `string \| undefined`                        | `"time"`        | Time coordinate                                                                                                                                            |
| `lat`            | `string \| undefined`                        | `"lat"`         | Latitude coordinate                                                                                                                                        |
| `lng`            | `string \| undefined`                        | `"lon"`         | Longitude coordinate                                                                                                                                       |
| `signedDistance` | `string \| undefined`                        | —               | Precomputed signed distance to the shoreline. The group's `signed_distance` attribute names it when absent                                                 |
| `properties`     | `string[] \| undefined`                      | —               | Property arrays to load. The group's `properties` attribute lists them when absent                                                                         |
| `ground`         | `string \| undefined`                        | —               | The array holding the ground height above the WGS84 ellipsoid, which `depth` is derived from. The group's `ground` attribute names it when absent          |
| `flow`           | `[east: string, north: string] \| undefined` | —               | The arrays of the flow velocity, eastward and northward in m/s (see [Flow](../../how-it-works/#flow)). The group's `flow` attribute names them when absent |

### TimeSeriesFloodSeries

| Property     | Type                                                           | Description                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `times`      | `readonly Date[]`                                              | Time of each frame                                                                                                                                                                                                                                                    |
| `changes`    | `readonly number[]`                                            | Number of cells that turn wet or dry between frame `k` and `k + 1`, for example to slow playback down where the water moves most                                                                                                                                      |
| `bounds`     | `{ west: number; south: number; east: number; north: number }` | The area in degrees of the cells the water reaches in any frame                                                                                                                                                                                                       |
| `properties` | `Record<string, TimeSeriesFloodProperty>`                      | The properties the surface can be colored by, stored and derived: `min` and `max`, the range of their values over the whole series. `low` and `high`, their 2nd and 98th percentiles, for a color scale that leaves the outliers out. `units` and `label`, when known |

A series holds only plain data, so it can be posted from a worker (see [Loading in a Worker](../../usage-examples/#loading-in-a-worker)).

## sampleTimeSeriesFlood

**Type:** `(series: TimeSeriesFloodSeries, position: { lng: number; lat: number }, frame: number | "max") => TimeSeriesFloodSample | undefined`

**Description:** The water at a point in degrees, as the surface draws it, for example to show the depth where the user clicks. A point takes its cell's values. A fractional `frame` interpolates to the next frame, as the surface does. `"max"` gives each value's maximum over the series, as the surface shows with `extent: "max"`. Returns `undefined` where the water never reaches.

| Property     | Type                     | Description                                                                                                                           |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `wet`        | `boolean`                | Whether the point is under water                                                                                                      |
| `level`      | `number \| undefined`    | Water-surface height in meters above the WGS84 ellipsoid where wet. `heightOffset` is not added                                       |
| `properties` | `Record<string, number>` | The values of the series' properties: a property that does not change over time wherever it has a value, one that does only where wet |

**Example:**

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
  );
  console.log(sample?.properties.depth);
});

// The depth at a point in every frame, for a chart.
const depths = series.times.map(
  (_, k) => sampleTimeSeriesFlood(series, { lng, lat }, k)?.properties.depth,
);
```

## timeToFrame / frameToTime

**Type:** `(series: TimeSeriesFloodSeries, time: Date | number) => number` / `(series: TimeSeriesFloodSeries, frame: number) => Date`

**Description:** Convert between a time (a `Date` or epoch milliseconds) and the fractional frame showing it, interpolating between the frames around it, which need not be evenly spaced. Both clamp to the first and last frame.

**Example:**

```typescript
import { frameToTime, timeToFrame } from "@navaramap/three-flood-mesh";

water.update({
  timeSeriesFlood: {
    frame: timeToFrame(series, new Date("2024-10-21T03:00:00Z")),
  },
});
label.textContent = frameToTime(series, frame).toLocaleString();
```
