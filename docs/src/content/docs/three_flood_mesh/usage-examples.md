---
title: Usage Examples
description: Recipes for playing, loading, and switching flood series with TimeSeriesFloodMeshDesc.
sidebar:
  order: 3
since: nightly
---

## Playing a Flood Simulation

```typescript
import ThreeView from "@navaramap/three";
import {
  loadTimeSeriesFlood,
  TimeSeriesFloodMeshDesc,
  timeToFrame,
} from "@navaramap/three-flood-mesh";

const view = new ThreeView({
  animation: true,
});
await view.init();
view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc);

const series = await loadTimeSeriesFlood({
  url: "https://example.com/flood.zarr",
  onProgress: (fraction) => {
    status.textContent = `Loading ${Math.round(fraction * 100)}%`;
  },
});

// Look at the whole flood.
const { west, south, east, north } = series.bounds;
const lat = (south + north) / 2;
const size = Math.max(
  (east - west) * 111_320 * Math.cos((lat * Math.PI) / 180),
  (north - south) * 110_950,
);
view.flyTo({ lng: (west + east) / 2, lat, distance: size, pitch: -45 });

const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { series, frame: 0 },
});

// Ten simulated minutes per second, at an even pace however the frames are
// spaced.
const start = series.times[0].getTime();
const end = series.times[series.times.length - 1].getTime();
const startedAt = performance.now();
view.on("preUpdate", () => {
  const elapsed = (performance.now() - startedAt) * 600;
  const time = start + (elapsed % (end - start));
  water.update({ timeSeriesFlood: { frame: timeToFrame(series, time) } });
});
```

## Loading from a Private Server

```typescript
const series = await loadTimeSeriesFlood({
  url: "https://data.example.com/flood.zarr",
  fetch: (request) => {
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(new Request(request, { headers }));
  },
});
```

## Loading in a Worker

Loading decodes every chunk and derives the properties, and without a stored signed distance, it also measures the distance to the shoreline. On a large series, this blocks the thread for seconds. A mesh given a `url` loads in a worker of its own, which leaves the page responsive:

```typescript
const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "https://example.com/flood.zarr", frame: 0 },
});
const series = await new Promise<TimeSeriesFloodSeries>((resolve, reject) => {
  water.ref.on("load", resolve);
  water.ref.on("error", reject);
});
```

A series holds only plain data, so `loadTimeSeriesFlood` can also run in a worker of yours, such as one that sends requests with `fetch`, which cannot be posted to a worker:

```typescript
// flood-worker.ts
import { loadTimeSeriesFlood } from "@navaramap/three-flood-mesh";

self.onmessage = async ({ data: url }: MessageEvent<string>) => {
  self.postMessage(await loadTimeSeriesFlood({ url }));
};

// main.ts
const worker = new Worker(new URL("./flood-worker.ts", import.meta.url), {
  type: "module",
});
worker.postMessage("https://example.com/flood.zarr");
const series = await new Promise<TimeSeriesFloodSeries>((resolve) => {
  worker.onmessage = (event) => resolve(event.data);
});
```

## Switching Scenarios

A mesh draws one series. To show another, such as another breach point, delete the mesh and add one for the new series:

```typescript
let water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { series: scenarios[0] },
});

const show = (series: TimeSeriesFloodSeries) => {
  water.delete();
  water = view.addMesh<TimeSeriesFloodMeshDesc>({
    timeSeriesFlood: { series, frame: 0 },
  });
};
```
