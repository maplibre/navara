---
title: Converting Data
description: Writing the Zarr group TimeSeriesFloodMeshDesc reads from flood simulation output, with the navara-flood-zarr command or the convert API.
sidebar:
  order: 4
since: nightly
---

The `@navaramap/three-flood-mesh/convert` entry writes the Zarr group this package reads, with a precomputed `signed_distance`. It runs in browsers and Node alike and needs neither `three` nor `@navaramap/three`. The inputs are files read on demand: a browser `File`, or a `{ name, read }` pair. The output is an empty, writable zarrita store, such as a `Map` in the browser or a `FileSystemStore` in Node. The `navara-flood-zarr` command (Node) runs the converters over paths, as a configuration file says (see [The Command](#the-command)). The browser entry `@navaramap/three-flood-mesh` includes neither.

[Preparing Flood Data](../preparing-data/) converts a real dataset of each kind and helps choose the converter.

| Converter         | `"type"`     | `"format"`          | Input                                                                                           |
| ----------------- | ------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| `convertRasters`  | `"rasters"`  | `"csv"`, `"netcdf"` | Values on a regular grid per time step: CSV files of the wet cells, or a netCDF raster per step |
| `convertMesh`     | `"mesh"`     | `"csv"`, `"netcdf"` | The values on an unstructured mesh per time step, as CSV files or a netCDF file                 |
| `convertPolygons` | `"polygons"` | `"czml"`            | A CZML file of the wet-area outlines per time step                                              |

`"type"` is the shape of the data, which picks the converter, and `"format"` the format it is read from, by default the one the extension of the input names (`.csv` for CSV, `.nc`, `.grd` or `.sww` for netCDF, and `.czml` for CZML).

Each converter's options are listed in [Converters](../api/converters/).

Each resolves to what it wrote (`FloodZarrInfo`): the grid size, the frames kept, the cells ever wet, and `textureBytes`, the GPU memory a viewer needs for the water surface and for each stored property while shown (see [GPU Memory](../how-it-works/#gpu-memory)).

## Heights

`loadTimeSeriesFlood` takes heights above the WGS84 ellipsoid. A `VerticalDatum` converts the input heights to them by adding its height above the ellipsoid, which the converter samples once, at the center of every cell ever wet. `TileGeoid` reads it from a `raster-dem` source, the way the command samples terrain. The CSV and raster converters default to orthometric heights over EGM2008 (`Egm2008Geoid`), as in Japanese simulation outputs, and `convertPolygons` to the ellipsoid (`Ellipsoid`), as in CZML. In Node, the EGM2008 tiles are read with the optional peer dependency `sharp`. A browser decodes them itself.

Given the ground height, a converter stores it as the `ground` property, in the same datum as the levels, and names it in the group's `ground` attribute, so `loadTimeSeriesFlood` derives `depth` from it.

Data without the ground height, such as a CZML whose vertices carry only the water surface, can sample it from terrain (`terrain`, for `convertRasters` and `convertPolygons`). The terrain is a `raster-dem` source as `addSource` takes it, of heights above the ellipsoid, or a `TerrainSampler`. The converter samples it once, at the center of every cell ever wet, and stores the heights. A `raster-dem` source is sampled as `sampleTerrainMostDetailed` of `@navaramap/three` does, with the engine's WASM, in a browser and in Node, where `ThreeView` does not run; Node decodes the tiles with `sharp`. A `TerrainSampler` has the shape of `sampleTerrainMostDetailed`, so with a `ThreeView`, `(positions) => view.sampleTerrainMostDetailed(terrainSource, positions)` samples the terrain the view shows, as long as no terrain layer exaggerates it. The terrain is not the ground the simulation ran on, so where the water is shallow, its difference from that ground outweighs the depth: a cell can be wet with its water surface below the terrain, and its depth is then 0.

Coordinates in a projection are converted with a `Projection` (`projection`). `PlaneRectangular` is the Japan Plane Rectangular Coordinate System of JGD2011 (EPSG:6669 to EPSG:6687), which takes each pair as easting and northing: the survey's Y column, then its X column.

## The Command

The command takes one argument, a configuration file holding the options of a converter (`ConvertConfig`) with its `"type"`, and `"format"` where the extension does not tell it. Paths and glob patterns are relative to the file. A JSON file covers the common case. A JavaScript module default-exporting the same object may also hold a `properties` callback, a `VerticalDatum` and a `Projection` instance.

The configuration writes some options differently from the API:

- `interval`: seconds, or a duration such as `"30m"` or `"1h"`.
- `maxLevelError` and `maxErrorShare` (default `0.01`): the fields of `tolerance`.
- `properties`: maps each name to its source name, or to its `source`, `precision`, `units` and `label`.
- `datum`: `"egm2008"`, `"ellipsoid"` or the path of a module default-exporting a `VerticalDatum`.
- `terrain`: a `raster-dem` source as `addSource` takes it. Its `elevationDecoder` names one of the engine's, such as `"terrarium"` for `ElevationDecoder.terrarium()` (`"japanGSI"`, `"mapbox"` or `"terrarium"`), or gives every field of one. A module may give a `TerrainSampler` instead.
- `projection`: a JGD2011 plane rectangular zone by its EPSG code (`"EPSG:6669"` to `"EPSG:6687"`), or the path of a module default-exporting a `Projection`.
- `timePattern`: the pattern as a string.
- `epoch`: a date string.

It prints what the converter wrote, and replaces the group at `output` only once the conversion succeeds. It needs Node 22 or later. The optional peer dependencies are not installed with the package: install `sharp` to convert heights over EGM2008 or to sample terrain, and `h5wasm` to read netCDF-4.

```sh
# With the package installed:
npx navara-flood-zarr flood.json
# Without:
npx -p @navaramap/three-flood-mesh@nightly -p sharp navara-flood-zarr flood.json
```

```json
{
  "type": "rasters",
  "inputs": ["csv/flood_*m.csv"],
  "output": "flood.zarr",
  "corners": [
    ["west", "south"],
    ["east", "north"]
  ],
  "ground": "ground",
  "depth": "depth",
  "timePattern": "_(\\d+)m\\.csv$",
  "timeUnit": "minutes",
  "epoch": "2026-01-01T00:00:00Z",
  "interval": "30m",
  "maxLevelError": 0.05,
  "properties": {
    "speed": {
      "source": "speed",
      "precision": 0.001,
      "units": "m/s",
      "label": "flow speed"
    }
  }
}
```

A CZML without the ground height, with the ground from [Re:Earth Terrain](https://terrain.reearth.land/)'s Mapbox Terrain-RGB tiles of heights above the ellipsoid:

```json
{
  "type": "polygons",
  "input": "flood-simulation.czml",
  "output": "flood.zarr",
  "terrain": {
    "type": "raster-dem",
    "url": "https://terrain.reearth.land/mapterhorn-egm08/mapbox/ellipsoid/{z}/{x}/{y}.webp",
    "maxZoom": 14,
    "elevationDecoder": "mapbox"
  }
}
```

Cells of a 25 m grid in plane rectangular zone 9, with T.P. heights:

```json
{
  "type": "rasters",
  "inputs": ["result_*.csv"],
  "output": "flood.zarr",
  "center": ["Y", "X"],
  "projection": "EPSG:6677",
  "resolution": 25,
  "level": "level",
  "timePattern": "_(\\d+)\\.csv$",
  "timeUnit": "minutes",
  "epoch": "2024-06-01T00:00:00Z"
}
```

netCDF rasters of a tsunami simulation, as a module that stores the flow velocity from its rasters, from which the flow speed is derived on load:

```javascript
export default {
  type: "rasters",
  output: "tsunami.zarr",
  inputs: ["eta/eta_*.nc"],
  series: { u: ["u/u_*.nc"], v: ["v/v_*.nc"] },
  ground: "bathymetry.nc",
  groundScale: -1,
  projection: "EPSG:6674",
  resolution: 5,
  timePattern: "_(\\d+)\\.nc$",
  timeUnit: "seconds",
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  properties: ({ u, v }) => ({ flow_east: u, flow_north: v }),
  precision: { flow_east: 0.01, flow_north: 0.01 },
  units: { flow_east: "m/s", flow_north: "m/s" },
};
```

## Using the API

In Node, through the API, over files:

```typescript
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import FileSystemStore from "@zarrita/storage/fs";
import {
  convertRasters,
  VerticalDatum,
  type TerrainPosition,
} from "@navaramap/three-flood-mesh/convert";

// Orthometric heights over a geoid 40 m above the ellipsoid.
class ConstantGeoid extends VerticalDatum {
  readonly name = "geoid at 40 m";
  offsets(positions: TerrainPosition[]) {
    return positions.map(() => 40);
  }
}

await convertRasters({
  inputs: ["flood.csv"].map((path) => ({
    name: basename(path),
    read: () => readFile(path),
  })),
  output: new FileSystemStore("flood.zarr"),
  corners: [
    ["west", "south"],
    ["east", "north"],
  ],
  level: "level",
  time: "time",
  datum: new ConstantGeoid(),
  // The columns but the position and the time, as numbers.
  properties: ({ speed, depth }) => ({
    speed,
    rank: Number(depth) >= 3 ? 2 : Number(depth) >= 0.5 ? 1 : 0,
  }),
  precision: { speed: 0.01, rank: 1 },
  units: { speed: "m/s" },
});
```

In a browser, from a file the user picked, into memory with the ground from the terrain a `ThreeView` shows, then shown:

```typescript
import { convertPolygons } from "@navaramap/three-flood-mesh/convert";
import { loadTimeSeriesFlood } from "@navaramap/three-flood-mesh";

const store = new Map<string, Uint8Array>();
await convertPolygons({
  input: fileInput.files[0],
  output: store,
  resolution: 25,
  terrain: (positions) =>
    view.sampleTerrainMostDetailed(terrainSource, positions),
  properties: ["depth"],
  precision: { depth: 0.01 },
});
const series = await loadTimeSeriesFlood({ store });
```
