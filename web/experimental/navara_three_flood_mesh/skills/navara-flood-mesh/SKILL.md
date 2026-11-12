---
name: navara-flood-mesh
description: >
  End-to-end workflow for showing a flood or tsunami simulation on a Navara 3D globe with
  @navaramap/three-flood-mesh: inspecting the simulation output (CSV grid cells, netCDF rasters,
  unstructured meshes in netCDF or CSV, CZML polygons), converting it to a Zarr group with the
  navara-flood-zarr command or the /convert API, then playing it with TimeSeriesFloodMeshDesc
  (playback, depth/arrival/speed coloring, picking). Use whenever converting flood simulation
  data, writing a navara-flood-zarr configuration, or writing code that uses
  TimeSeriesFloodMeshDesc, loadTimeSeriesFlood or sampleTimeSeriesFlood.
---

# Flood simulations on Navara (@navaramap/three-flood-mesh)

`@navaramap/three-flood-mesh` turns flood simulation output into a time series of water surfaces on Navara's globe, in two halves:

1. **Convert** (Node or browser, no `three` needed): the `navara-flood-zarr` command or `@navaramap/three-flood-mesh/convert` writes a Zarr group of water-surface heights on a regular lat/lng grid, with properties (speed, ground, …) and a precomputed shoreline distance.
2. **Visualize** (browser): `TimeSeriesFloodMeshDesc` uploads every frame to the GPU and plays them; `colorBy` turns it into a hazard map.

**Nightly only**: published only in Navara nightly builds (`npm install @navaramap/three@nightly @navaramap/three-flood-mesh@nightly`). It requires `@navaramap/three` of the **same nightly version** — pin both to the exact same version.

For the base scene (ThreeView setup, terrain, imagery, buildings, init order), follow the `navara-usage` skill shipped with `@navaramap/three`. This skill covers only the flood part.

## The workflow

1. **Inspect the input before writing anything.** Identify: the shape (grid cells / one raster per step / unstructured mesh / polygons), the columns or variables, the encoding, how each step's time is given, the coordinate system, and the vertical datum of the heights. → [references/converting.md](references/converting.md#1-inspect-the-input)
2. **Pick the converter** by the shape of the data (`"type"`), not the file extension:

   | Data                                                         | `"type"`     | Format                          |
   | ------------------------------------------------------------ | ------------ | ------------------------------- |
   | One row per wet grid cell and step (e.g. MLIT 25 m mesh CSV) | `"rasters"`  | CSV                             |
   | One raster per step (e.g. tsunami model `.nc`/`.grd`)        | `"rasters"`  | netCDF                          |
   | Unstructured mesh (e.g. TELEMAC, ANUGA, HEC-RAS, D-Flow FM)  | `"mesh"`     | netCDF (UGRID/`volumes`) or CSV |
   | Wet-area outlines per step (e.g. PLATEAU flood CZML)         | `"polygons"` | CZML                            |

3. **Write a config file** next to the data — JSON, or an `.mjs` module when a property must be derived by a callback or a custom projection/datum is needed. → [references/converting.md](references/converting.md#3-write-the-config)
4. **Run the command and read the report.** Check the grid size, frame count and GPU memory it prints; tune and rerun. → [references/converting.md](references/converting.md#4-run-and-read-the-report)
5. **Serve the group as static files** with 404 for missing chunks. → [references/visualizing.md](references/visualizing.md#serving-the-zarr-group)
6. **Show it**: register the descriptor, add the mesh, fly to `series.bounds`, drive `frame` from time, color by properties. → [references/visualizing.md](references/visualizing.md)

## Critical invariants (getting these wrong gives silently wrong output)

- **Heights end up above the WGS84 ellipsoid.** The converter adds the datum offset: `rasters`/`mesh` default to orthometric over EGM2008 (Japanese outputs: T.P.), `polygons` to the ellipsoid (CZML). Confirm the datum from the model's documentation — files rarely record it. A wrong datum shifts the water ~30–40 m in Japan.
- **The viewer's terrain must also be ellipsoidal** (e.g. Re:Earth Terrain's `/ellipsoid/` endpoint, as in the `navara-usage` photoreal recipe). Over a terrain on another datum the water floats or sinks; correct with `heightOffset`, never by changing the data.
- **Convert the source as it is.** Do not add filters that drop parts of the model (sea nodes, small puddles, "artifacts"); store only what the simulation computed. Derived classes (hazard depth ranks) belong in the viewer as `colorBy` `threshold` breaks, not as stored properties.
- **Store the ground when the data has it** (`ground` column/raster/variable, or `ground` + `depth`). `depth`, its maximum and the hazard map need it. Without any ground, `terrain` samples one from a `raster-dem` source (ellipsoidal heights) — this is not the simulation's ground, so shallow depths are unreliable.
- **Waves follow the data only with both flow components**, stored as properties named `flow_east` and `flow_north` (m/s, east and north positive). Rotate/negate model axes as needed (e.g. a `vy` counting south → `flow_north: -vy`). Never derive a direction from `speed` alone; without both components, set `waveDirection` / `waveStrength` / `flowSpeed` instead.
- **Thin the frames to fit GPU memory.** Every frame is uploaded at once: ~`nodes × (frames + 1) × 4` bytes for the water, the same again for a flow, `× 2` per property shown. Use `interval` then `maxLevelError` (e.g. `0.05`); target well under a few hundred MB for desktops, less for phones.
- **`series` / `url` cannot be changed with `update()`.** To switch scenarios, delete the mesh and add a new one.
- **`registerMesh` only after `await view.init()`.** The registries are created by `init()`; calling it before throws "Cannot read properties of undefined (reading 'mesh')".

## Running the command

```sh
# In a project with the package installed (add sharp/h5wasm as needed, see below):
npx navara-flood-zarr flood.json
# One-off, without installing — optional peers must be named explicitly:
npx -p @navaramap/three-flood-mesh@nightly -p sharp navara-flood-zarr flood.json
```

- Node 22 or later (the command uses `fs.glob`). Paths and glob patterns in the config are relative to the config file.
- **`sharp`** is an optional peer dependency needed in Node whenever heights are converted over EGM2008 (the default for `rasters` and `mesh`) or terrain is sampled; without it the command fails with "Reading height tiles needs the sharp package". EGM2008 tiles and terrain are fetched over the network.
- **`h5wasm`** is needed for netCDF-4 (HDF5) files, such as most step grids. Classic netCDF (`.sww`, the legacy `x_range`/`y_range` layout) reads without it.
- It prints nothing until it finishes: about 100 s for 220 CSV files (1.2 GB), seconds for a CZML, minutes for hundreds of large netCDF-4 grids.
- The output directory is replaced only on success; an existing non-Zarr directory at `output` is refused.
- Run without arguments for the built-in usage.

## Minimal viewer

```typescript
import ThreeView from "@navaramap/three";
import type { DefaultDescriptions } from "@navaramap/three-default-plugin";
import {
  TimeSeriesFloodMeshDesc,
  type TimeSeriesFloodMeshConfig,
  type TimeSeriesFloodSeries,
} from "@navaramap/three-flood-mesh";

// The union types `addMesh({ timeSeriesFlood })` next to the built-in descriptors.
type Descriptions = DefaultDescriptions | { mesh: TimeSeriesFloodMeshConfig };

const view = new ThreeView<Descriptions>({ animation: true }); // waves move only while frames render
await view.init();
view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc); // after init(): before it, it throws
// …base scene from navara-usage: ellipsoidal terrain, imagery, buildings, sky, a daytime atmosphere.date…

const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "/flood.zarr", frame: 0 }, // loads in its own worker
});
water.ref.on("load", (series: TimeSeriesFloodSeries) => {
  // series.times, series.bounds, series.properties — drive a slider, fit the camera
});
```

Playback, coloring, picking and legends: [references/visualizing.md](references/visualizing.md).

## Where to verify — never guess option names

- Docs (exhaustive, human-facing; if a page is not published yet, use the types below): https://navara.world/docs/three_flood_mesh/about/ — Converting Data, Preparing Flood Data (a worked example per input kind: grid-cell CSV, CZML polygons, netCDF and CSV meshes, tsunami netCDF grids), and the API pages for `TimeSeriesFloodMeshDesc`, the series functions and the converters.
- Types: `node_modules/@navaramap/three-flood-mesh/dist/index.d.ts` (viewer) and `dist/convert.d.ts` (converters, `ConvertConfig` for the command's JSON).
- In the Navara repository: docs source `docs/src/content/docs/three_flood_mesh/`, package `web/experimental/navara_three_flood_mesh/` (its `example/` plays several converted datasets).
