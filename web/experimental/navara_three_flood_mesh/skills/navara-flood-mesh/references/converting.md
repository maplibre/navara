# Converting a simulation to a flood Zarr group

Exact option tables: https://navara.world/docs/three_flood_mesh/api/converters/ and `ConvertConfig` in `dist/convert.d.ts`. Worked examples: https://navara.world/docs/three_flood_mesh/preparing-data/.

## 1. Inspect the input

Look before configuring; every answer below maps to an option.

| Look at                   | How                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CSV header and first rows | `head -5 f.csv`; Japanese outputs are often Shift_JIS: `head -5 f.csv \| iconv -f CP932 -t UTF-8` (the converter detects UTF-8/Shift_JIS itself)                         |
| File naming of the steps  | `ls dir \| head; ls dir \| wc -l` — the time usually lives in the name (`_00030m.csv`, `eta_01800.nc`); note files to exclude (`_MAX.CSV`)                               |
| netCDF grid layout        | `ncdump -h f.nc` (or `gmt grdinfo`, Python `xarray.open_dataset`): variable names, dims, `units`, `_FillValue`, netCDF-4 vs classic                                      |
| netCDF mesh               | `ncdump -h`: UGRID's `mesh_topology` variable, `location` (node/face) of each variable, `time:units`; or `volumes` over `x`/`y` + `xllcorner`, with `stage`, `elevation` |
| HDF5 (e.g. HEC-RAS)       | `h5ls -r f.p01.hdf`                                                                                                                                                      |
| CZML packets              | `jq length f.czml; jq '.[1] \| {availability, polygon: (.polygon \| keys), properties}' f.czml`                                                                          |

Then decide:

- **Shape** → `"type"` (see SKILL.md table). Points on no regular grid are `mesh` (Delaunay with `maxEdge`), not `rasters`.
- **Position**: CSV cell corners (`corners`, two opposite or all four, each `[lng, lat]`) or centers (`center`); degrees, or projected coordinates (`projection` + `resolution`).
- **Water**: a level column/variable (`level`), or ground + depth (`ground` + `depth`, which add up to the level).
- **Time**: a column (`time`) or the file name (`timePattern`, first capture group), its unit (`timeUnit`: `"seconds"`/`"minutes"`/`"hours"` or seconds per unit such as `0.02` for model steps), and what it counts from (`epoch`). netCDF meshes carry `time:units`.
- **Vertical datum** of the levels and the ground (see §2).
- **Properties worth storing**: anything the simulation computed per cell (speed, flow components, hazard-relevant values). Not classes derived from depth.
- **Flow**: both velocity components present? Their axes and signs (east/north positive)?

## 2. Coordinates, heights and time — the silent failure points

- **Datum** (`datum`): `"egm2008"` (orthometric, Japanese T.P.; default for `rasters`/`mesh`), `"ellipsoid"` (default for `polygons`), or a module default-exporting a subclass of `VerticalDatum` from `@navaramap/three-flood-mesh/convert` (`name` + `offsets(positions)`: the datum's height above the ellipsoid at each `{ lng, lat }`, called once with every wet cell center; `TileGeoid(name, rasterDemSource)` for a geoid served as `raster-dem` tiles). The files almost never say — check the model's report. Wrong datum = water tens of meters off. MLIT flood inundation CSVs (浸水想定) give 標高 in T.P., the default. Sanity checks without documentation: the levels should be about ground (T.P.) + the geoid height (~35–45 m in Japan) when ellipsoidal, and about the ground itself when orthometric. For a model with sea, the quiet offshore level before the wave arrives is its still-water zero. netCDF grids may record how derived grids were made in their `history` / `source` attributes (`ncdump -h`), e.g. a ground grid made as the terrain plus a datum offset.
- **A constant offset to the datum** (a tsunami model counting from H.W.L. or the initial tide): `datumOffset` (netCDF rasters), added to the levels **and** the ground — there is no separate ground offset, so pick the ground grid on the same zero as the levels (a grid relative to T.P. would come out `datumOffset` too high). Ground stored as a depth below the datum: `groundScale: -1`.
- **Ground lowered by the earthquake**: tsunami models often subside the ground at the start, while the delivered ground grid is pre-quake. Symptoms: wet cells with a level below the ground, flat water below zero in sheltered areas early on. The derived `depth` is then too small (clamped to 0) and thin water hides under the viewer's terrain. Use a post-quake ground if delivered; otherwise convert as is and document it — do not estimate the subsidence.
- **Japan Plane Rectangular** (`"projection": "EPSG:6669"`…`"EPSG:6687"`) takes each pair as **easting, northing** — the survey **Y column first, then X** (`"center": ["Y", "X"]`). Swapping them puts the flood in the wrong place without an error. netCDF grids take `x` as easting and `y` as northing (no swap option). Verify the CRS by converting a few grid points and comparing the ground with an independent elevation (e.g. the GSI elevation API): the right zone and order agree within meters, a wrong one by hundreds. Other projections: a module default-exporting `{ name, toGeographic(x, y) { return [lng, lat]; } }`.
- **Projected coordinates need `resolution`** (meters) for `rasters`; `mesh` always needs it — pick a size near the model's finest elements.
- **Epoch time zone**: a date without a zone is read as **UTC**. When the data gives a real local date (JST), write the zone: `"epoch": "2026-01-01T09:00:00+09:00"`.
- **Elapsed-only times** (minutes since the breach, model steps since the earthquake): the epoch is arbitrary and only places the frames in time. Pick a time and say it is a stand-in, and label playback with the elapsed time (see visualizing.md).
- **CZML step timing**: steps are timed by the start of `availability`; outputs that stamp the end need `"time": "end"`. Tell which by comparing a packet's `name` (e.g. "破堤後0時間0分経過") with its `availability` start. Trust `availability` for the times: PLATEAU names drop the day and restart at 0時間 after 24 h.
- **Ground missing** (PLATEAU CZML carries only the water surface): `terrain` samples it from a `raster-dem` source of ellipsoidal heights, e.g.

  ```json
  "terrain": {
    "type": "raster-dem",
    "url": "https://terrain.reearth.land/mapterhorn-egm08/mapbox/ellipsoid/{z}/{x}/{y}.webp",
    "maxZoom": 14,
    "elevationDecoder": "mapbox"
  }
  ```

  `elevationDecoder` is required (`"mapbox"`, `"terrarium"`, `"japanGSI"`, or every field). A tile service of orthometric heights would make the depth wrong by the geoid height.

  The derived depth inherits every difference between that terrain and the simulation's ground (DEM, geoid model: PLATEAU uses GSIGEO2011, the terrain above EGM2008). On one PLATEAU flood CZML it came out about 0.5–0.9 m deeper in shallow water than the depth class the CZML encodes in its polygon colors, so only about a third of the cells fell in the same class. Where the CZML colors its polygons by depth class, compare against them (`polygon.material.solidColor`) before presenting depth as a hazard map, and say the depth is derived from terrain.

## 3. Write the config

JSON for the common case. Use an `.mjs` module (default export of the same object) when you need a `properties` callback, a custom `VerticalDatum`/`Projection` instance, or a `TerrainSampler`. Command-only spellings: `interval` in seconds or `"30m"`/`"1h"`; `maxLevelError` / `maxErrorShare` instead of `tolerance`; `timePattern` and `epoch` as strings; `properties` as `{ name: "source" }` or `{ name: { source, precision, units, label } }` (or, in a module, a callback with `precision`/`units`/`labels` maps beside it).

**Grid cells in CSV, each row with two opposite corners:**

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
      "label": "Flow speed"
    }
  }
}
```

The pattern `_(\d+)m\.csv$` also excludes a maxima file such as `flood_MAX.CSV`. The header row is found by the column names asked for, so lines before it, such as a row count, are skipped. Steps are often denser at the breach onset (e.g. every 10 min, later 30 min or 1 h): `interval: "30m"` drops them, so leave it out when the onset matters. A per-cell maxima file is a ready check of `extent: "max"`. `minDepth` would drop the shallowest rows: leave it unset (convert as is) unless the model itself defines a wet threshold.

**Projected cell centers:** `"center": ["Y", "X"], "projection": "EPSG:6677", "resolution": 25, "level": "level"`.

**One raster per step (netCDF grids of a tsunami model) — a module, because flow components need a callback.** The values are illustrative; derive yours — `groundScale`, `datumOffset`, `projection` and the flow signs come from checks like those below, not from the files:

```javascript
export default {
  type: "rasters",
  output: "tsunami.zarr",
  inputs: ["eta/eta_*.nc"],
  series: { u: ["u/u_*.nc"], v: ["v/v_*.nc"] },
  ground: "bathymetry.nc",
  groundScale: -1, // bathymetry stored as depth below the datum
  datumOffset: 1, // the model counts from T.P. +1 m
  buildings: "buildings.nc", // nonzero where the model keeps cells dry
  projection: "EPSG:6674",
  resolution: 5,
  timePattern: "_(\\d+)\\.nc$", // file name = seconds since the earthquake
  timeUnit: "seconds",
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  maxLevelError: 0.05,
  properties: ({ u, v }) => ({ flow_east: u, flow_north: v }), // check each sign
  precision: { flow_east: 0.01, flow_north: 0.01 },
  units: { flow_east: "m/s", flow_north: "m/s" },
};
```

Check a flow sign the files don't document against the model docs, or by mass continuity: `dη/dt` correlates with `-div(h v)` only with the right signs, and the regression slope gives the seconds per file-number unit, i.e. `timeUnit` (block-average, e.g. 15×15 cells, to remove noise; velocities may be 0 rather than missing on dry cells). `buildings` counts any nonzero value, negative heights included.

Reading is the cost: about 1 s per netCDF-4 file of a few million cells. With `timePattern`, `interval` skips the files of the steps it leaves out, so it thins the reading too; a narrower input glob does the same. Try a short run first (a glob matching ~30 steps) to measure.

**Unstructured mesh, netCDF (triangles `volumes` over `x`/`y`, e.g. ANUGA `.sww`; UGRID names variables, e.g. `"level": "mesh2d_s1"`):**

```javascript
export default {
  type: "mesh",
  input: "dam-break.nc",
  output: "dam-break.zarr",
  projection: "EPSG:6674", // or a module default-exporting a Projection for local coordinates
  resolution: 20,
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  maxLevelError: 0.05,
  properties: ({ stage, elevation, xmomentum, ymomentum }) => ({
    speed: Math.hypot(xmomentum, ymomentum) / Math.max(stage - elevation, 0.01),
  }),
  precision: { speed: 0.01 },
  units: { speed: "m/s" },
};
```

With `volumes`, `level`/`ground` default to `stage`/`elevation`. The whole file is read into memory.

**Unstructured mesh from any other format** (TELEMAC `.slf`, HEC-RAS HDF5, MIKE `.dfsu`): export with the format's own library to `nodes.csv` (`id`, position, static columns such as ground), `faces.csv` (`id`, node ids around the face) and one values CSV per step (`id`, level or depth, properties; wet rows only), then:

```json
{
  "type": "mesh",
  "nodes": "nodes.csv",
  "faces": "faces.csv",
  "inputs": ["values/run_*s.csv"],
  "output": "run.zarr",
  "position": ["lng", "lat"],
  "resolution": 20,
  "level": "level",
  "ground": "ground",
  "timePattern": "_(\\d+)s\\.csv$",
  "timeUnit": "seconds",
  "epoch": "2026-01-01T00:00:00Z",
  "maxLevelError": 0.05
}
```

Values on faces/cells (e.g. HEC-RAS cell water surface): `"valuesOn": "faces"`. Points with no faces: omit `faces`, set `maxEdge` (m), and include dry points as rows without a level so the water reaches the wet edge.

**Polygons (PLATEAU flood CZML):** often just `{ "type": "polygons", "input": "….czml", "output": "flood.zarr" }`, plus `terrain` for the ground (§2) and `"time": "end"` where needed. Properties come only from each packet's `properties`; a class shown only by polygon color is not read.

## 4. Run and read the report

```
source 141 × 347 cells; grid 28.5 × 23.1 m (standard mesh / 40), 143 × 349 cells, 11 of 13 frames, 38349 wet cells in 5 tiles
GPU textures: 2.0 MB for the water surface, 1.0 MB for speed while shown, 0.1 MB for ground while shown
```

| Symptom in the report                                  | Fix                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `grid` cell size differs from the simulation's         | Wrong position columns (corners vs center), missing `projection`, or swapped easting/northing   |
| `grid` cell count smaller than the source domain       | Expected: the grid covers only the area ever wet                                                |
| `polygons`: `cell-steps outside the triangulation` > 0 | Outlines overlap or don't follow a grid: set a `resolution`                                     |
| `mesh`: many triangles "longer than maxEdge dropped"   | `maxEdge` too small, or dry points missing from bare-point input                                |
| Too many frames / GPU MB too high                      | Raise `interval`, then `maxLevelError` (0.05 m is a good start); fast tsunamis keep most frames |
| Too few frames (motion looks jumpy)                    | Lower `maxLevelError` or `interval`                                                             |
| Warning about non-finite property values               | Expected for blank cells; otherwise check the source column                                     |
| Error "matches no file"                                | Glob is relative to the config file                                                             |

`X of Y frames`: `Y` is the steps left after `interval`, `X` the frames `maxLevelError` keeps of them. `maxLevelError` picks frames by the water level alone, so a faster-changing property is sampled only at those frames, and its maxima can fall short of the source's.

## Converting in a browser or through the API

The `/convert` entry runs in browsers too: inputs are `File` objects or `{ name, read }`, output any writable zarrita store (a `Map` in memory), and `terrain` takes the same `raster-dem` source as the command (sampled with the engine's WASM) or `(positions) => view.sampleTerrainMostDetailed(terrainSource, positions)` with a `ThreeView` (only while no terrain layer exaggerates it). Pass the in-memory store straight to `loadTimeSeriesFlood({ store })`. Each converter resolves to `FloodZarrInfo` (grid, frames, wet cells, `textureBytes`). Examples: https://navara.world/docs/three_flood_mesh/converting-data/#using-the-api.
