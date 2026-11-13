---
title: TimeSeriesFloodMeshDesc
description: Mesh descriptor that draws a time series of flood water surfaces.
sidebar:
  order: 1
since: nightly
---

The `TimeSeriesFloodMeshDesc` class is a mesh descriptor that draws a water surface changing over time, such as the result of a flood simulation. It reads a time series of water-surface heights on a regular latitude/longitude grid from a [Zarr](https://zarr.dev/) store, with `loadTimeSeriesFlood` or, given a `url`, by itself in a worker. Every frame is kept on the GPU, so changing `frame` does not reload or rebuild anything.

Register it with `view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc)` after `view.init()` and before adding it. The surface shades as Navara's water, with waves, a Fresnel sky reflection, and the sun's glitter. It reflects the sky env map when the view has a `sky: { envMap: true }` mesh, and the light probe's low-frequency sky otherwise.

In addition to the properties below, the common properties from the base class (`visible` and others) are available. See [MeshDesc](../../../three_default_descs/mesh-desc/mesh-desc-base/) for details.

## Properties

### series

**Type:** `TimeSeriesFloodSeries`

**Description:** The series to draw, from `loadTimeSeriesFlood`. Give either `series` or `url`. Neither can be replaced with `update()`. To show another series, delete the mesh and add a new one (see [Switching Scenarios](../../usage-examples/#switching-scenarios)).

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
  }
}
```

### url

**Type:** `string | URL`

**Description:** URL of a Zarr group the mesh loads, in a worker, as `loadTimeSeriesFlood` does. A relative URL resolves against the page. The surface shows once the series has loaded, which the `load` event passes on (see [Events](#events)). While loading, the engine's worker pool leaves the worker one core. The other properties can be updated meanwhile and take effect when the surface shows. To send requests with `fetch` or read a `store`, load the series with `loadTimeSeriesFlood` and pass it as `series` instead.

**Example:**

```typescript
{
  timeSeriesFlood: {
    url: "https://example.com/flood.zarr",
  }
}
```

### variables

**Type:** `TimeSeriesFloodVariables | undefined`

**Description:** With `url`, the names of the arrays to read (see [TimeSeriesFloodVariables](../series-functions/#timeseriesfloodvariables)).

**Example:**

```typescript
{
  timeSeriesFlood: {
    url: "https://example.com/flood.zarr",
    variables: { waterLevel: "level" },
  }
}
```

### frame

**Type:** `number | undefined`

**Description:** Index of the frame to show. An integer shows that frame as the data gives it. A fractional value shows the state between frame `Math.floor(frame)` and the next one: the surface blends the heights of the two frames and moves the shoreline from one frame's to the next along the distance to them. The in-between shape is geometric and does not model how water flows; pass `Math.floor(frame)` to show only the frames of the data. `timeToFrame` gives the frame showing a time.

**Default:** `0`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    frame: 12.5,
  }
}
```

### extent

**Type:** `"frame" | "max" | undefined`

**Description:** What the surface covers. `"frame"` draws the water of the frame shown. `"max"` draws every cell the water reaches in any frame, at its highest level, with each property that changes over time at its maximum, and ignores `frame`: a map of the flood as a whole, such as the arrival time, the hours wet or the maximum depth.

**Default:** `"frame"`

**Example:**

```typescript
// The maximum depth over the flood, in the hazard-map classes.
water.update({
  timeSeriesFlood: {
    extent: "max",
    colorBy: {
      property: "depth",
      scale: { type: "threshold", breaks: [0.5, 3, 5, 10, 20], colors },
    },
  },
});
```

### heightOffset

**Type:** `number | undefined`

**Description:** Meters added to the water-surface heights, for example to fit the water to a terrain on another vertical datum.

**Default:** `0`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    heightOffset: -0.5,
  }
}
```

### showUnderground

**Type:** `number | undefined`

**Description:** Meters the terrain may rise above the water and still show it. Where a terrain differs from the ground of the simulation, shallow water can lie just below the terrain and be hidden; water whose terrain in front rises less than this above it is drawn on the terrain's surface. Water farther below, such as the sea behind a hill, stays hidden. `0` hides all water below the terrain. Buildings in front of the water hide it in either case.

The height is taken along the line of sight, so from a camera close to the horizon, water a little behind a low bank can show over the bank.

**Default:** `0`

**Example:**

```typescript
// Shallow inland flooding on 5 m cells, over a terrain from another elevation model.
{
  timeSeriesFlood: {
    series,
    showUnderground: 2,
  }
}
```

### color

**Type:** `Color | undefined`

**Description:** Color of the water. Deep water is drawn darker than this color.

**Default:** `#5a3f1c`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  timeSeriesFlood: {
    series,
    color: new Color().setStyle("#3f6f8f"),
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** Opacity where the water is deep.

**Default:** `0.9`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    opacity: 0.95,
  }
}
```

### shallowOpacity

**Type:** `number | undefined`

**Description:** Opacity where the water is shallow. The surface goes from `shallowOpacity` to `opacity` as the water between the surface and the terrain behind it gets thicker. Buildings under the water are covered like the terrain behind them, so only their parts above the surface stay visible.

**Default:** `0.2`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    shallowOpacity: 0.3,
  }
}
```

### absorption

**Type:** `number | undefined`

**Description:** How fast the water turns opaque with thickness, per meter along the view ray. A larger value makes shallower water look deep.

**Default:** `0.5`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    absorption: 1.0,
  }
}
```

### waveStrength

**Type:** `number | undefined`

**Description:** Sets the size, steepness, and speed of the waves. About `1` is a calm ripple, `5` is moderate, and `20` is a storm. Waves move only while frames render, for example with `animation: true` on the view.

**Default:** `5`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveStrength: 2,
  }
}
```

### waveDirection

**Type:** `number | undefined`

**Description:** The direction the waves travel, in degrees clockwise from north.

**Default:** `0`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveDirection: 90,
  }
}
```

### flowSpeed

**Type:** `number | undefined`

**Description:** The speed in m/s of a current that carries the waves along `waveDirection` over the whole surface, without changing their size or slope. A series with a [flow](../../how-it-works/#flow) follows that instead and ignores this.

**Default:** `0`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveDirection: 90,
    flowSpeed: 2,
  }
}
```

### waveExaggeration

**Type:** `number | undefined`

**Description:** Scales only the slopes of the waves, keeping their size and speed. `0` makes a still mirror.

**Default:** `1`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveExaggeration: 0.5,
  }
}
```

### waterScale

**Type:** `"ocean" | "large" | "medium" | "small" | undefined`

**Description:** The open water the waves grow over, which sets their size. `"ocean"` grows them as far as `waveStrength` allows, `"large"` assumes about 20 km, `"medium"` about 2 km, and `"small"` about 200 m.

**Default:** `"medium"`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    waterScale: "small",
  }
}
```

### doubleSide

**Type:** `boolean | undefined`

**Description:** Also draws the surface from below, so it stays visible to a camera under the water, for example at street level in a deep flood. From below, the surface shows the water's body and reflects nothing.

**Default:** `false`

**Example:**

```typescript
{
  timeSeriesFlood: {
    series,
    doubleSide: true,
  }
}
```

### colorBy

**Type:** `TimeSeriesFloodColorBy | null | undefined`

**Description:** Colors the surface by a property of the series instead of drawing it as water. The colored surface is unlit and reflects nothing, so its colors can be read against a legend, and its opacity is the same at every depth. `null` draws the water again. Changing it cross-fades the colors over `transition` milliseconds.

| Property      | Type                        | Default   | Description                                                                                                                                                                                                                                                                 |
| ------------- | --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `property`    | `string`                    | —         | A name in `series.properties`                                                                                                                                                                                                                                               |
| `scale`       | `TimeSeriesFloodColorScale` | —         | How a value picks its color (below)                                                                                                                                                                                                                                         |
| `interpolate` | `boolean \| undefined`      | see below | Whether the value varies smoothly between the cell centers and the frames. Off, each cell shows its own value at frame `Math.floor(frame)`, or at the next frame where the cell is still dry then, inside the moving shoreline. On by default except for a `category` scale |
| `opacity`     | `number \| undefined`       | `0.85`    | Opacity of the colored surface                                                                                                                                                                                                                                              |
| `missing`     | `Color \| undefined`        | `#808080` | Color where the property has no value                                                                                                                                                                                                                                       |
| `transition`  | `number \| undefined`       | `300`     | Milliseconds the colors cross-fade over when `colorBy` changes                                                                                                                                                                                                              |

A `TimeSeriesFloodColorScale` is one of:

- `{ type: "linear", stops: [value, Color][] }`: a gradient through the stops, clamped at the ends. The colors are interpolated in linear RGB.
- `{ type: "threshold", breaks: number[], colors: Color[] }`: ordered classes, with `colors[i]` for values from `breaks[i - 1]` up to `breaks[i]`, so one more color than breaks (at most 32 breaks). With interpolation on, the class boundaries follow the interpolated value, like contours.
- `{ type: "category", values: number[], colors: Color[], other?: Color }`: one color per listed value and `other` for the rest (at most 32 values). Interpolation is off by default, so a cell never shows a value between two categories.

The colors pass through the view's tone mapping like everything else drawn. They are divided by the exposure beforehand so a neutral tone mapping shows them as given.

**Example:**

```typescript
import { Color } from "@navaramap/three";

const color = (style: string) => new Color().setStyle(style);

// The hazard-map depth classes.
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

// Hours until wet, over every cell the water reaches.
const { max, units } = series.properties.arrival;
water.update({
  timeSeriesFlood: {
    extent: "max",
    colorBy: {
      property: "arrival",
      scale: {
        type: "linear",
        stops: [
          [0, color("#30123b")],
          [max / 2, color("#72fe5e")],
          [max, color("#7a0403")],
        ],
      },
    },
  },
});
legend.title = `Arrival (${units})`;

// Back to water.
water.update({ timeSeriesFlood: { colorBy: null, extent: "frame" } });
```

## Events

The descriptor emits these events, listened to with `handle.ref.on()`. They report the loading of a `url`. Its `series` property holds the series drawn, `undefined` while a `url` loads.

| Event      | Listener                                  | Description                                                               |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `progress` | `(fraction: number) => void`              | The loading advances, with a rough share of the work done, from 0 up to 1 |
| `load`     | `(series: TimeSeriesFloodSeries) => void` | The series has loaded and the surface shows                               |
| `error`    | `(error: unknown) => void`                | The loading failed                                                        |

**Example:**

```typescript
const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "https://example.com/flood.zarr" },
});
water.ref.on("progress", (fraction) => {
  status.textContent = `Loading ${Math.round(fraction * 100)}%`;
});
water.ref.on("load", (series) => {
  slider.max = series.times.length - 1;
});
water.ref.on("error", (error) => {
  status.textContent = `Failed to load: ${String(error)}`;
});
```
