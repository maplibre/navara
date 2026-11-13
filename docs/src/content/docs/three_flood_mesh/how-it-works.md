---
title: How It Works
description: How TimeSeriesFloodMeshDesc stores and draws a flood series, from its data format to the GPU memory it takes.
sidebar:
  order: 2
since: nightly
---

A flood series is a time series of water-surface heights on a regular latitude/longitude grid. `loadTimeSeriesFlood` reads it from a Zarr group and keeps only the nodes the water ever reaches (the cells ever wet and the cells next to them). Every frame is uploaded to the GPU at once, so changing `frame` on [TimeSeriesFloodMeshDesc](../api/time-series-flood-mesh-desc/) does not reload or rebuild anything. Between two frames, the surface blends their heights and moves the shoreline along the distance to each frame's shoreline (see [frame](../api/time-series-flood-mesh-desc/#frame)).

## Data Format

`loadTimeSeriesFlood` reads a Zarr group (Zarr v2 or v3) holding the arrays below. The array names are the defaults and can be changed with `variables`.

| Array         | Shape              | Content                                                                                                                                                                              |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `water_level` | `[time, lat, lon]` | Water-surface height in meters above the WGS84 ellipsoid. A cell is dry where the value is NaN or the array's fill value. CF `scale_factor` and `add_offset` attributes are applied. |
| `time`        | `[time]`           | Time of each frame. The `units` attribute follows CF, for example `"seconds since 1970-01-01T00:00:00Z"`. A reference time without a time zone is read as UTC.                       |
| `lat`         | `[lat]`            | Latitude of the cell centers in degrees, evenly spaced, ascending or descending.                                                                                                     |
| `lon`         | `[lon]`            | Longitude of the cell centers in degrees, evenly spaced, ascending or descending.                                                                                                    |

Chunks that hold no water can be left out of the store: a missing chunk is read as dry. The gzip, zlib, zstd, Blosc, and LZ4 compressors are supported. The converters write zstd, whose decoder (about 250 KB gzipped) is loaded with the first chunk that needs it.

The frames need not be evenly spaced in time. Between two frames, the shoreline moves along the signed distance to each frame's shoreline. Without a precomputed distance array, `loadTimeSeriesFlood` computes it while loading, which can take several seconds for hundreds of thousands of cells (see [Loading in a Worker](../usage-examples/#loading-in-a-worker)). To skip that, store a `[time, lat, lon]` array of the signed distance in meters (negative where wet) and name it in the group's `signed_distance` attribute or in `variables.signedDistance`.

### Properties

The surface can be colored by numeric properties of the cells (see `colorBy`), such as the flow speed or the depth a simulation gives. Each property is one more array of the group, `[time, lat, lon]`, or `[lat, lon]` when its value does not change over time, with CF `scale_factor` and `add_offset` applied and the fill value for a missing value. The group's `properties` attribute lists their names, and `variables.properties` names them instead when given. A property's CF `units` and `long_name` attributes, when present, become its `units` and `label` in `series.properties`, for a legend.

A property is packed as the smallest integer type its range fits at the precision it is converted with (see [Converters](../api/converters/#common-options)): a byte, a 16-bit integer, or float32 without a precision. Its `actual_range` and `robust_range` attributes, when present, give `series.properties` the range of its values and their 2nd and 98th percentiles, so they need not be measured on load.

The ground height named by the group's `ground` attribute (or `variables.ground`) is read to derive `depth` and is not offered as a property itself, unless `variables.properties` lists it. Besides the stored properties, `loadTimeSeriesFlood` derives these, each unless the store already has one of the same name:

| Property   | Shape              | Content                                                                                                                                                                           |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depth`    | `[time, lat, lon]` | Water depth in meters, from the water level and the ground height above the WGS84 ellipsoid                                                                                       |
| `speed`    | `[time, lat, lon]` | Flow speed in m/s, from the [flow](#flow)                                                                                                                                         |
| `arrival`  | `[lat, lon]`       | Hours after the first frame until the cell is first wet                                                                                                                           |
| `duration` | `[lat, lon]`       | Hours the cell is wet over the series                                                                                                                                             |
| `rate`     | `[time, lat, lon]` | Meters per hour the water level changes by until the next frame, held over that interval as the drawn level changes at that rate throughout (the last frame repeats the previous) |

### Flow

The waves can drift with the flow of the simulation. Store its velocity as two more arrays, eastward and northward in m/s, each `[time, lat, lon]`, or `[lat, lon]` when it does not change over time, and name them in the group's `flow` attribute as `[east, north]` or in `variables.flow`. The converters do this for properties named `flow_east` and `flow_north`. A model's own axes may differ: rotate them when they are turned from north, and negate a component that counts the other way, such as `y` counting south.

`loadTimeSeriesFlood` takes the velocity only where a cell is wet and has both components, and continues it past the shoreline. The arrays are not offered as properties themselves, unless `variables.properties` lists them. With `extent: "max"`, each node takes its fastest flow.

The waves drift at the true speed on top of their own motion, whatever rate the frames play at, while frames render. They fade out by about 2 km from the camera, and with them the drift. A series with a flow samples twice as many wave texels per pixel.

A series without both components, such as one storing only `speed`, has no flow: `waveDirection`, `waveStrength` and `flowSpeed` set the waves over the whole surface.

### GPU Memory

Every frame is uploaded at once. A series of `N` nodes (the cells ever wet and the cells next to them) and `F` frames takes `R = 2048 × ⌈N / 2048⌉` texels per layer and these textures:

- **Water surface**: `R × (F + 1) × 4` bytes, always.
- **Flow**: `R × (F + 1) × 4` bytes, always, for a series with a flow.
- **Property while shown**: `R × (F + 1) × 2` bytes when it changes over time, `R × 2` bytes when not. The three most recently shown are kept for reuse.

The GPU limits their size. The rows, `⌈N / 2048⌉`, and those of the node lookup over the `W × H` cells around the water, `⌈W × H / 2048⌉`, must not exceed its `MAX_TEXTURE_SIZE`, and the layers, `F + 1`, its `MAX_ARRAY_TEXTURE_LAYERS`. WebGL 2 guarantees at least 2048 and 256. A series beyond them fails to load with an error.

For example, 200,000 nodes over 100 frames take about 81 MB for the water and 40 MB for `depth` while shown. The converters report these sizes for the group they write (`textureBytes`). Thin the frames (`interval`, `tolerance`) to fit the devices you target.
