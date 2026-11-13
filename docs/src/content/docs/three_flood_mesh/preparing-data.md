---
title: Preparing Flood Data
description: Converting each kind of flood simulation output into a series, with an example of each.
sidebar:
  order: 5
since: nightly
---

`loadTimeSeriesFlood` reads a Zarr group of water-surface heights on a regular latitude/longitude grid. The `navara-flood-zarr` command writes that group from flood simulation output. This page goes through each kind of input with an example, from the source files to a series the viewer plays. The options themselves are listed in [Converters](../api/converters/).

## Choosing a Converter

| Your data                                                                                      | `type` and format  | Typical sources                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| One CSV row per wet grid cell and time step, with the cell's corners or center                 | `rasters`, CSV     | MLIT flood inundation simulation CSVs (25 m mesh), plane rectangular grid outputs                    |
| One netCDF raster file per time step                                                           | `rasters`, netCDF  | Tsunami and flood models on a regular grid                                                           |
| Values on an unstructured mesh per time step, as a netCDF file or CSV, or bare points          | `mesh`, netCDF/CSV | Hydraulic models such as TELEMAC, ANUGA and HEC-RAS 2D (see [Mesh](#mesh-unstructured-model-output)) |
| Wet-area outlines per time step as CZML polygons whose vertices carry the water-surface height | `polygons`, CZML   | PLATEAU flood simulation CZMLs                                                                       |

`type` is the shape of the data and picks the converter (`convertRasters`, `convertMesh`, `convertPolygons`). The format is the extension's unless `format` gives it.

What each one keeps differs:

- **`rasters`** takes the values of each cell as the simulation computed them, from the CSV rows or the rasters. Any numeric column or other raster of the same steps, such as the flow speed, can be stored as a property, and the velocity as the [flow](../how-it-works/#flow). With a `resolution`, each cell of the grid you choose averages the source cells within it, which suits cells finer than the grid. The heights are orthometric (EGM2008) by default, as in Japanese simulation outputs. With the ground height, the depth is derived on load rather than stored.
- **`polygons`** takes the water-surface heights at the outline vertices and interpolates them over the cells inside, so the heights are as smooth as the outlines. A property can only come from the packet's `properties`. A class shown only by the polygon's color is not read. The heights are above the WGS84 ellipsoid by default, as in CZML.
- **`mesh`** takes the values at the mesh nodes (or faces) and interpolates them over the triangles onto a grid of the cell size you choose. Properties and the ground are stored as by `rasters`, from the file's variables or the node and value rows.

## Workflow

1. Look at the input: its columns or packets, its encoding, how a step's time is given, and the vertical datum of its heights.
2. Write a configuration file with the converter's options: JSON, or a JavaScript module where a callback derives a property. Paths and glob patterns are relative to the file.
3. Run the command:

   ```sh
   npx -p @navaramap/three-flood-mesh@nightly -p sharp navara-flood-zarr flood.json
   ```

4. Read the report it prints (see [The Report](#the-report)) and tune the options if the grid, the frame count or the GPU memory is off.
5. Serve the Zarr group as static files and load it with `loadTimeSeriesFlood({ url })`. The server must answer 404 for a chunk that is not there, as an empty chunk is not written. A single-page-app fallback that answers every path with a page breaks the loading.

### The Report

For the [CSV example](#rasters-grid-cells-in-csv) below, the command prints:

```
source 141 × 347 cells; grid 28.5 × 23.1 m (standard mesh / 40), 143 × 349 cells, 11 of 13 frames, 38349 wet cells in 5 tiles
GPU textures: 2.0 MB for the water surface, 1.0 MB for speed while shown, 0.1 MB for ground while shown
```

- `source`: the size of the grid the input is read onto, in its cells across and down.
- `grid`: the cell size, and whether it is a division of the Japanese standard mesh, `sampled` at a `resolution`, or neither. A size other than the simulation's means the grid was detected wrongly.
- `11 of 13 frames`: the frames kept out of the steps read. `interval` thins the steps, and `maxLevelError` then keeps only the steps the others do not interpolate to.
- `wet cells`: the cells wet at any time.
- `GPU textures`: the memory a viewer needs. Fewer frames make it smaller.

## Rasters: Grid Cells in CSV

Suppose a levee breach simulation writes one CSV per step, every 10 minutes for 6 hours, named by the minutes since the breach (`flood_0000m.csv`, `flood_0010m.csv`, …). Each row is a wet cell of a grid that divides the Japanese standard mesh by 40, with its southwest and northeast corners:

```
cell,ground,depth,speed,west,south,east,north
10800,10.00,0.10,0.00,135.0000000,35.0056250,135.0003125,35.0058333
10801,10.03,0.10,0.00,135.0003125,35.0056250,135.0006250,35.0058333
```

`ground` and `depth` are in meters, the ground as an orthometric height, and `speed` is the flow speed in m/s.

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

- `corners`: two opposite corners give the cell's center and size.
- `ground` and `depth`: they add up to the water level. The ground is stored too, so `loadTimeSeriesFlood` derives `depth`, and the viewer can color by the depth or its maximum.
- `timePattern`, `timeUnit` and `epoch`: the first group of the pattern picks the minutes out of the file name, counted from `epoch`, here a stand-in for the breach time.
- `interval` and `maxLevelError`: the 37 steps are thinned to every 30 minutes (13 steps), then to the 11 frames that keep the interpolated level within 5 cm of the others.
- `properties`: the flow speed is stored as `speed`, packed to 1 mm/s.

The report shows the grid as the standard mesh divided by 40. Store only what the simulation computed. A class such as the hazard map's depth rank is a threshold on the depth, which the viewer applies with `colorBy` breaks.

For a grid given by its cell centers, use `"center": ["lng", "lat"]` instead of `corners`. The cell size then comes from the centers' spacing. A grid in plane rectangular coordinates is not a latitude/longitude grid, so give `projection` and a `resolution` to sample it at (see the examples under [The Command](../converting-data/#the-command)).

## Polygons: Flood Outlines in CZML

Suppose a flood simulation gives a CZML whose packets outline each step's wet area along the grid cells, valid for the step's availability interval, with the water-surface height above the ellipsoid at each vertex:

```json
{
  "id": "step-1",
  "availability": "2026-01-01T00:00:00Z/2026-01-01T01:00:00Z",
  "polygon": {
    "positions": {
      "cartographicDegrees": [135.0, 35.0, 48.5, 135.0003125, 35.0, 48.5, …]
    },
    "perPositionHeight": true
  }
}
```

The configuration needs only the files:

```json
{
  "type": "polygons",
  "input": "flood.czml",
  "output": "flood.zarr"
}
```

Outlines that follow a grid give it to the converter, and the report names it, such as `standard mesh / 40`. The report's cell-steps outside the triangulation should be 0. Otherwise the outlines overlap or do not follow a grid, and a `resolution` samples them onto one instead.

A step is timed by the start of its availability interval. For a CZML that times each state by the end of its interval instead, add `"time": "end"`.

Water a few tens of centimeters deep often lies below a terrain from another elevation model, which hides it. [`showUnderground`](../api/time-series-flood-mesh-desc/#showunderground) draws such water on the terrain.

## Mesh: Unstructured Model Output

A model on an unstructured mesh gives its values at nodes (or faces) whose spacing varies across the domain. `mesh` samples them on a grid of `resolution`-meter cells, interpolating linearly over the mesh triangles. It reads a netCDF file of the mesh and its values over time, following the UGRID conventions or with triangles in `x`, `y` and `volumes`, or CSV files written from any other format.

### netCDF: a Dam Break

Suppose a dam break simulation writes a netCDF file, `dam-break.nc`, saved every 2 s: the nodes `x` and `y` in plane rectangular zone 6, the triangles `volumes`, the ground `elevation`, and at each node and step the water level `stage` and the momentum `xmomentum` and `ymomentum`. A module converts it, so that a callback derives the flow speed:

```js
// dam-break.mjs
export default {
  type: "mesh",
  input: "dam-break.nc",
  output: "dam-break.zarr",
  projection: "EPSG:6674",
  resolution: 20,
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  maxLevelError: 0.05,
  properties: ({ stage, elevation, xmomentum, ymomentum }) => ({
    speed: Math.hypot(xmomentum, ymomentum) / Math.max(stage - elevation, 0.01),
  }),
  precision: { speed: 0.01 },
  units: { speed: "m/s" },
  labels: { speed: "Flow speed" },
};
```

- `level` and `ground` default to `stage` and `elevation` with `volumes`. Where some nodes of a triangle are dry, the depth is interpolated as 0 at them, so the water thins out towards the dry side. A node or cell shallower than `minDepth` (0.01 m) is dry.
- `projection`: the nodes are the easting and northing in the zone. A model in its own local coordinates takes the path of a module default-exporting a `Projection` instead.
- `epoch`: the file counts the times in seconds from the start of the run, here a stand-in for the dam's failure.
- `interval` keeps a step every 20 s, before `maxLevelError` picks the keyframes.
- `resolution`: pick a cell size near the model's finest elements. Coarser elements are interpolated over, so the grid can be finer than they are.

A UGRID file names its variables in `level`, `ground` or `depth`, such as `"level": "mesh2d_s1"`. Values on the faces are taken over each face.

### CSV

Any other format is written as three kinds of CSV:

- `nodes.csv`: one row per node, with its `id`, its position and any column that does not change over time, such as the ground height.
- `faces.csv`: one row per face, with its `id` and the ids of its nodes in order around it. A face of more than three nodes, such as a quadrilateral cell, is split into triangles.
- the values per time step: one row per wet node, with its `id` and the level or depth, and any property. A node without a row is dry.

This script writes them from the netCDF file above, every 20 s and the wet nodes only, and shows how a format's nodes, faces and values map to them:

```python
import os

import numpy as np
import netCDF4

d = netCDF4.Dataset("dam-break.nc")
x = np.asarray(d["x"][:])
y = np.asarray(d["y"][:])
ground = np.asarray(d["elevation"][:])

with open("nodes.csv", "w") as f:
    f.write("id,x,y,ground\n")
    for i in range(len(x)):
        f.write(f"{i},{x[i]:.2f},{y[i]:.2f},{ground[i]:.3f}\n")
with open("faces.csv", "w") as f:
    f.write("id,n1,n2,n3\n")
    for k, (a, b, c) in enumerate(d["volumes"][:]):
        f.write(f"{k},{a},{b},{c}\n")

os.makedirs("values", exist_ok=True)
for k, t in enumerate(d["time"][:]):
    if t % 20:
        continue
    stage = np.asarray(d["stage"][k])
    depth = stage - ground
    speed = np.hypot(d["xmomentum"][k], d["ymomentum"][k]) / np.maximum(depth, 0.01)
    wet = depth > 0.01
    with open(f"values/step_{int(t):05d}s.csv", "w") as f:
        f.write("id,level,speed\n")
        for i in np.nonzero(wet)[0]:
            f.write(f"{i},{stage[i]:.3f},{speed[i]:.2f}\n")
```

```json
{
  "type": "mesh",
  "nodes": "nodes.csv",
  "faces": "faces.csv",
  "inputs": ["values/step_*s.csv"],
  "output": "dam-break.zarr",
  "position": ["x", "y"],
  "projection": "EPSG:6674",
  "resolution": 20,
  "level": "level",
  "ground": "ground",
  "timePattern": "_(\\d+)s\\.csv$",
  "timeUnit": "seconds",
  "epoch": "2026-01-01T00:00:00Z",
  "maxLevelError": 0.05,
  "properties": {
    "speed": {
      "source": "speed",
      "precision": 0.01,
      "units": "m/s",
      "label": "Flow speed"
    }
  }
}
```

Values at the faces, such as water levels at cell centers, take `"valuesOn": "faces"`: each value row then names a face, whose value covers it.

### Other Formats

Each model's output holds the same three things under other names. A netCDF file following UGRID or with triangles in `x`, `y` and `volumes` is read as it is. For the others, read them with the format's library and write the CSVs as above. For example:

| Model      | Format            | Library                 | Nodes and faces                                       | Values                                                  |
| ---------- | ----------------- | ----------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| ANUGA      | `.sww` (NetCDF-3) | read as it is (`input`) | `x`, `y` (plus `xllcorner`, `yllcorner`), `volumes`   | `stage`, `xmomentum`, `ymomentum` at the nodes          |
| TELEMAC    | `.slf` (SELAFIN)  | TELEMAC's Python API    | the coordinates and the connectivity table (`IKLE`)   | `FREE SURFACE`, `WATER DEPTH`, … at the nodes           |
| HEC-RAS 2D | `.p##.hdf` (HDF5) | `h5py`, `ras-commander` | the face points and each cell's face points           | water surface at the cell centers (`valuesOn: "faces"`) |
| D-Flow FM  | UGRID (NetCDF-4)  | read as it is (`input`) | `mesh2d_node_x`, `mesh2d_node_y`, `mesh2d_face_nodes` | `mesh2d_s1` at the faces                                |
| MIKE 21 FM | `.dfsu`           | `mikeio`                | the element table                                     | `Surface elevation` at the elements                     |

### Bare Points

Points without faces, such as cell centers exported without their mesh, are triangulated (Delaunay). Give `maxEdge`, the longest triangle edge in meters to keep, so that wet areas apart are not bridged across dry land, and leave out `faces`. Without `nodes`, each value row carries its point's position (the `position` columns), and the rows at one position are one node. The dry points need rows too, without a level, for the water to reach the edge of the wet area, because the triangulation of the wet points alone ends at the outermost ones. The report counts the triangles dropped as longer than `maxEdge`.

## Rasters: Tsunami Grids

Suppose a tsunami simulation writes netCDF grids on a 2 m grid in plane rectangular zone 6: one file per output step, every 10 s and named by the seconds since the earthquake, for the water level and for each component of the flow velocity, besides the static grids of the bathymetry and the buildings. The model counts its heights from a datum 1 m above T.P.:

```
eta/eta_00000.nc    water level in m, missing where dry
u/u_00000.nc        flow velocity along x (east), m/s
v/v_00000.nc        flow velocity along y (north), m/s
bathymetry.nc       depth below the model's datum in m, negative on land
buildings.nc        nonzero where buildings stand
```

`ncdump -h` shows how a grid is laid out. A grid in netCDF-4 needs the `h5wasm` package (`npm install h5wasm`).

```javascript
export default {
  type: "rasters",
  output: "tsunami.zarr",
  inputs: ["eta/eta_*.nc"],
  series: { u: ["u/u_*.nc"], v: ["v/v_*.nc"] },
  ground: "bathymetry.nc",
  groundScale: -1,
  datumOffset: 1,
  buildings: "buildings.nc",
  projection: "EPSG:6674",
  resolution: 5,
  timePattern: "_(\\d+)\\.nc$",
  timeUnit: "seconds",
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  maxLevelError: 0.05,
  properties: ({ u, v }) => ({ flow_east: u, flow_north: v }),
  precision: { flow_east: 0.01, flow_north: 0.01 },
  units: { flow_east: "m/s", flow_north: "m/s" },
};
```

- A module: the callback that turns the velocity rasters into `flow_east` and `flow_north` cannot be held in JSON. These two properties become the flow the waves drift with, and the flow speed is derived from them on load.
- `flow_east` and `flow_north`: the files rarely record which way each component counts. Check it against the model's documentation or by mass continuity: `dη/dt` correlates with `-div(h v)` only when the signs are right.
- `resolution`: each 5 m cell averages the 2 m source cells within it. The level of a cell is the mean of its wet source cells.
- `ground`, `groundScale` and `datumOffset`: the bathymetry is a depth below the model's datum, so it is negated, and both the ground and the levels are raised by 1 m to T.P. Check the datum of the levels with the model's documentation, as the files do not record it.
- `buildings`: the model keeps the building cells dry. Leaving them out keeps a cell among buildings wet where its streets are.
- `interval` and `maxLevelError`: a tsunami changes fast, so few steps interpolate within 5 cm. An `interval` of 20 s halves the frames and the GPU memory of steps every 10 s.

The sea is wet in such a simulation, so its surface is drawn as well, up to the edge of the grid.
