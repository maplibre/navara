---
title: Converters
description: Options of convertRasters, convertMesh and convertPolygons from @navaramap/three-flood-mesh/convert.
sidebar:
  order: 3
since: nightly
---

## Common Options

| Property     | Type                                          | Description                                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `output`     | `FloodStore`                                  | The store to write the group to                                                                                                                                                                                                                                                                       |
| `interval`   | `number \| undefined`                         | Seconds the steps are thinned to no closer than                                                                                                                                                                                                                                                       |
| `tolerance`  | `FloodTolerance \| undefined`                 | Keeps only the steps that interpolation between the others does not reproduce: a cell's level may be off by `maxLevelError` meters in up to `maxErrorShare` of a frame's wet cells. The frames are chosen on the water level alone, so a property that changes faster is sampled at those frames only |
| `datum`      | `VerticalDatum \| undefined`                  | Vertical datum of the input heights (see [Heights](../../converting-data/#heights))                                                                                                                                                                                                                   |
| `properties` | `string[] \| PropertiesCallback \| undefined` | Numeric properties to store with each cell, to color the surface by: the names of the input's own to take as they are, or a callback deriving them from a record of the input's values (see each converter for what the record holds)                                                                 |
| `precision`  | `Record<string, number> \| undefined`         | Per property, the step it is packed at. A property without one is stored as float32                                                                                                                                                                                                                   |
| `units`      | `Record<string, string> \| undefined`         | Per property, its unit, such as `"m/s"`                                                                                                                                                                                                                                                               |
| `labels`     | `Record<string, string> \| undefined`         | Per property, its description                                                                                                                                                                                                                                                                         |

A property value that is not a finite number is stored as missing and counted in a warning. A property with no numeric value at all is not written. A property that never changes over time is stored without the time dimension, and each property records the range of its values (see [Properties](../../how-it-works/#properties)).

The CSV and raster converters time each step by a column or by its file name:

| Property      | Type                                                       | Description                                                                                                                                         |
| ------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`        | `string \| undefined`                                      | Column holding the time. CSV only                                                                                                                   |
| `timePattern` | `RegExp \| undefined`                                      | A pattern whose first group picks the time out of each file name, instead of `time`. With it, `interval` skips the files of the steps it leaves out |
| `timeUnit`    | `"seconds" \| "minutes" \| "hours" \| number \| undefined` | Unit of a numeric time, or the seconds it lasts, such as `0.02` for model steps of 0.02 s. Default `"seconds"`                                      |
| `epoch`       | `Date \| undefined`                                        | What a numeric time counts from. A time that is not a number is parsed as a date, in UTC when it names no time zone                                 |

## convertRasters

Converts the water levels on a regular grid per time step: CSV files of the wet cells, such as of a Japanese standard mesh, or a netCDF raster per step. `format` (`"csv"` or `"netcdf"`) says which, and without it, the extension of the first input does.

With a `resolution`, the source cells are sampled on a grid of cells that size. Each cell averages the source cells within it, or takes the nearest where they are larger than it. It is wet where at least half of them are, at their mean level, and the other values are the means over its wet source cells. Without a `resolution`, the source cells, in degrees, are the cells.

| Property     | Type                             | Description                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputs`     | `Input[]`                        | The CSV files, or the rasters of the water level, one per time step                                                                                                                                                                                                                     |
| `format`     | `"csv" \| "netcdf" \| undefined` | The format of `inputs`                                                                                                                                                                                                                                                                  |
| `projection` | `Projection \| undefined`        | Projection of the coordinates                                                                                                                                                                                                                                                           |
| `resolution` | `number \| undefined`            | Cell size in meters to sample the source cells at. Needed for coordinates in a projection                                                                                                                                                                                               |
| `terrain`    | `Terrain \| undefined`           | For data without the ground height, a `raster-dem` source or a `TerrainSampler` to sample it from at the center of each cell ever wet, as `sampleTerrainMostDetailed` of `@navaramap/three` does. It is stored as the `ground` property (see [Heights](../../converting-data/#heights)) |

### CSV

Each row is a wet cell at a time step, and a cell without a row is dry. The grid is detected from the cells in their own coordinates: degrees, or with `projection`, a projected grid. Points that lie on no regular grid are converted by `convertMesh`.

| Property   | Type                               | Description                                                                                                                                                                                                                   |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputs`   | `Input[]`                          | CSV files with one row per wet cell and time step. The header is the first line naming every column asked for, and lines before it are skipped. UTF-8 and Shift_JIS are recognized. A field may be quoted, but not span lines |
| `corners`  | `CoordinateColumns[] \| undefined` | Columns of two opposite corners of the cell or all four, as `[lng, lat]` each. They also give the cell size                                                                                                                   |
| `center`   | `CoordinateColumns \| undefined`   | Columns of the cell's center, instead of `corners`. The cell size then comes from the centers' spacing                                                                                                                        |
| `level`    | `string \| undefined`              | Column of the water level                                                                                                                                                                                                     |
| `ground`   | `string \| undefined`              | Column of the ground height, which adds up to the level with `depth`, instead of `level`                                                                                                                                      |
| `depth`    | `string \| undefined`              | Column of the depth                                                                                                                                                                                                           |
| `minDepth` | `number \| undefined`              | With `depth`, drops the cells shallower than this                                                                                                                                                                             |

A `properties` callback is given the row's columns but the position and the time, as numbers, or with a `resolution`, their means over the cell's wet source cells. A column without a number is `undefined`.

### netCDF

Each raster is a netCDF file: a 2-D variable with 1-D coordinates named `x`, `lon`, `longitude` or `easting` and `y`, `lat`, `latitude` or `northing`, or the legacy layout of `z` placed by `x_range`, `y_range` and `dimension`. Classic netCDF is read as it is. netCDF-4 is HDF5, read with the optional peer dependency `h5wasm`. The fill value is read as missing, and CF `scale_factor` and `add_offset` are applied. Every raster must lie on the grid of the first level raster. A missing level is dry. The rasters are timed by `timePattern`.

| Property      | Type                                   | Description                                                                                                                                                                                                               |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `series`      | `Record<string, Input[]> \| undefined` | More rasters per time step by name, such as the flow velocity, timed by `timePattern` as well. `properties` takes them by these names, or a callback is given their cell means                                            |
| `ground`      | `Input \| undefined`                   | Raster of the ground height                                                                                                                                                                                               |
| `groundScale` | `number \| undefined`                  | Multiplies the ground raster, such as by `-1` for a depth below the datum, as tsunami models store the bathymetry. Default `1`                                                                                            |
| `buildings`   | `Input \| undefined`                   | Raster that is nonzero where buildings stand, which a simulation keeps dry. Their source cells are left out of each cell's share of wet cells and of its means, so a cell among buildings is wet where its open ground is |
| `datumOffset` | `number \| undefined`                  | Height in `datum` of the level the heights count from, such as the tide a simulation starts at. Added to the levels and the ground. Default `0`                                                                           |
| `variable`    | `string \| undefined`                  | The variable to read from a file holding more than one 2-D variable                                                                                                                                                       |

## convertPolygons

Converts the polygons per time step of a CZML file. The cells inside an outline take the heights of its vertices, interpolated linearly over its triangulation. The polygons of one time step must not overlap.

| Property     | Type                            | Description                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`      | `Input`                         | The CZML file. The vertices carry the water-surface height, and `properties` are taken from the packet's `properties`                                                                                                                                                                   |
| `resolution` | `number \| undefined`           | Cell size in meters to sample the outlines at. Outlines that follow a grid are taken as the simulation cells without it                                                                                                                                                                 |
| `time`       | `"start" \| "end" \| undefined` | Which end of its availability interval times a step. Default `"start"`                                                                                                                                                                                                                  |
| `terrain`    | `Terrain \| undefined`          | For data without the ground height, a `raster-dem` source or a `TerrainSampler` to sample it from at the center of each cell ever wet, as `sampleTerrainMostDetailed` of `@navaramap/three` does. It is stored as the `ground` property (see [Heights](../../converting-data/#heights)) |

## convertMesh

Converts the values on an unstructured mesh per time step by sampling them on a grid of `resolution`-meter cells. Values at the nodes are interpolated linearly over the triangles, and a face of more nodes is split into triangles. Where some nodes of a triangle are dry and the ground is known, the depth is interpolated as 0 at the dry nodes, so the water thins out towards them.

The mesh and its values come from CSV files (`inputs`) or from one netCDF file (`input`). These options apply to both:

| Property     | Type                      | Description                                                                                                                                                                                                        |
| ------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projection` | `Projection \| undefined` | Projection of the node positions                                                                                                                                                                                   |
| `resolution` | `number`                  | Cell size in meters of the grid the mesh is sampled at                                                                                                                                                             |
| `maxEdge`    | `number \| undefined`     | Without faces, the longest triangle edge in meters kept, so that separate wet areas are not bridged. Without `nodes` too, the dry points need rows without a level for the water to reach the edge of the wet area |
| `level`      | `string \| undefined`     | Column (or variable) of the water level                                                                                                                                                                            |
| `ground`     | `string \| undefined`     | Column (or variable) of the ground height                                                                                                                                                                          |
| `depth`      | `string \| undefined`     | Column (or variable) of the depth, which adds up to the level with `ground`, instead of `level`                                                                                                                    |
| `minDepth`   | `number \| undefined`     | Depth in meters below which a node or a cell is dry. Default `0.01`                                                                                                                                                |

### CSV

| Property    | Type                              | Description                                                                                                                                                                                                                              |
| ----------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputs`    | `Input[]`                         | CSV files of the values, with one row per wet node (or face) and time step. A node without a row is dry. Read as the CSV files of `convertRasters`                                                                                       |
| `nodes`     | `Input \| undefined`              | CSV of the nodes: their `id`, their `position` and any column that does not change over time, such as the ground. A column is looked up in the value row, then in the node's row. Without it, each value row carries its node's position |
| `faces`     | `Input \| undefined`              | CSV of the faces: their `id` and the ids of their nodes in order around them. Without it, the nodes are triangulated (Delaunay)                                                                                                          |
| `faceNodes` | `string[] \| undefined`           | Columns of `faces` holding the node ids, an empty field ending a face of fewer nodes. All the columns but `id` by default                                                                                                                |
| `id`        | `string \| undefined`             | Column holding the ids of nodes, faces and value rows. Default `"id"`                                                                                                                                                                    |
| `valuesOn`  | `"nodes" \| "faces" \| undefined` | Whether the values are at the nodes or at the faces, each taken over its face. Default `"nodes"`                                                                                                                                         |
| `position`  | `CoordinateColumns`               | Columns of a node's position in degrees, or with `projection`, its easting and northing                                                                                                                                                  |

A `properties` callback is given the value row merged over the node's (or face's) row, keyed by column, with the fields as strings.

### netCDF

| Property | Type                  | Description                                                                                                                      |
| -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `input`  | `Input`               | A netCDF file holding the mesh and its values over time: following the UGRID conventions, or triangles in `x`, `y` and `volumes` |
| `mesh`   | `string \| undefined` | The UGRID mesh topology variable, when the file holds more than one 2-D mesh                                                     |
| `epoch`  | `Date \| undefined`   | What the times count from when their `units` name no date                                                                        |

`level`, `ground` and `depth` name variables: the level (or depth) over time, `[time, nodes]` or `[time, faces]`, and the ground on the same nodes or faces, not over time. A node (or face) is wet where it is at least `minDepth` deep, or without the ground, where its level is not missing.

- UGRID: the mesh is the variable with `cf_role = "mesh_topology"` and `topology_dimension = 2`. Its `node_coordinates` and `face_node_connectivity` give the nodes and faces, with the connectivity's `start_index` and `_FillValue`. A variable is on the nodes or the faces by its `location`. Coordinates with `standard_name = "longitude"` or `units = "degrees_east"` are in degrees. Others need `projection`.
- Triangles in `volumes`, as in a `.sww`: the nodes are `x` and `y` plus the `xllcorner` and `yllcorner` attributes, the triangles `volumes`. `level` and `ground` default to `stage` and `elevation`. The positions are in the model's projection, so `projection` is needed.
- The times are the variable `time` (or with `standard_name = "time"`). Units of `<unit> since <date>` give dates. Otherwise they are seconds since `epoch`, plus the file's `starttime` attribute, if any.
- `properties` names variables on the same nodes (or faces), or a callback is given each such variable's value at a wet node, by name, such as `({ stage, elevation, xmomentum, ymomentum }) => ({ speed: Math.hypot(xmomentum, ymomentum) / (stage - elevation) })`.
- The file is read into memory whole, and a step at a time from there. See [convertRasters](#convertrasters) for the netCDF versions read.
