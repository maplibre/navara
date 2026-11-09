---
title: ThreeView Class
description: API Reference for ThreeView Class Overview and Constructor
sidebar:
  order: 910
---

ThreeView is the main class for creating and managing 3D map visualizations using Three.js and WebGL. It provides a comprehensive API for layer management, camera control, rendering, and event handling.

## Example

```tsx
import ThreeView, { JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { Vector3 } from "three";

// Create ThreeView instance
const view = new ThreeView({
  shadow: true,
  animation: true,
  backgroundColor: 0x0a0a0f,
  logarithmicDepthBuffer: true,
});
const plugin = new DefaultPlugin();
view.addPlugin(plugin);

// Initialize the view
await view.init();

// Add default photorealistic objects (sky, stars, sun, light probe)
const defaultLayers = plugin.addDefaultPhotorealScene();

// Add terrain layer
const terrainSource = view.addSource({
  type: "raster-dem",
  url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  maxZoom: 15,
  minZoom: 5,
});
view.addLayer({
  type: "terrain",
  source: terrainSource,
  terrain: {
    castShadow: true,
    receiveShadow: true,
  },
});

// Add hillshade layer
const hillshadeSource = view.addSource({
  type: "raster-dem",
  // Credit:
  // - Geospatial Information Authority of Japan Tiles - Digital Elevation Map
  //   https://maps.gsi.go.jp/development/ichiran.html
  url: "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png",
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  minZoom: 6,
  maxZoom: 15,
});
view.addLayer({
  type: "raster",
  source: hillshadeSource,
  hillshade: {},
});

// Add raster tile layer
const rasterSource = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 23,
});
view.addLayer({
  type: "raster",
  source: rasterSource,
  raster: {
    color: new Color().setHex(0xffffff),
    opacity: 1,
  },
});

// Set camera position
view.setCamera({
  lng: 139.7,
  lat: 35.7,
  height: 1000,
  pitch: -45,
  heading: 0,
  roll: 0,
});
```

## Multiple Views

A page can run several `ThreeView` instances at once, for example to compare two maps side by side. Give each view its own canvas. The views can be initialized concurrently, and disposing one does not interrupt the others.

```tsx
const left = new ThreeView({ canvas: leftCanvas });
const right = new ThreeView({ canvas: rightCanvas });
await Promise.all([left.init(), right.init()]);
```

All views on a page share one pool of background workers, so their tile processing competes for the same CPU cores instead of multiplying them. The first view to call `init()` creates the pool, and its `workerPoolSize`, `mobileOptimization` and `memoryBudget.maxWorkerHeapBytes` decide the pool size and worker heap budget. The same options passed to a later view do not change the pool while it exists, and a console warning reports when they differ. The pool is shut down when the last view is disposed, and the next view to initialize creates a new one.

Everything else belongs to each view: the WebGL context, the tile cache (`cacheBytes`), the remaining `memoryBudget` limits, and the font worker. Memory use therefore grows with the number of views, and data shown in two views is downloaded and decoded once per view. When showing several views on a memory-constrained device, lower `cacheBytes` on each of them.

## Properties

### container

**Type:** `HTMLElement | undefined`

**Description:** The HTML container element for rendering the view. When specified, ThreeView adds a canvas within this container.

**Example:**

```typescript
const view = new ThreeView({
  container: document.getElementById("map") ?? undefined,
});
```

### canvas

**Type:** `HTMLCanvasElement | OffscreenCanvas | undefined`

**Description:** The canvas element used for rendering. When specified, this canvas is used. When not specified, a new canvas is created.

**Example:**

```typescript
const view = new ThreeView({
  canvas: document.getElementById("canvas") as HTMLCanvasElement,
});
```

### pixelRatio

**Type:** `number | undefined`

**Description:** Override for the device pixel ratio. Affects rendering quality on high-DPI displays. When not specified, the device's default value is used.

**Example:**

```typescript
const view = new ThreeView({
  pixelRatio: 2,
});
```

### disableAutoResize

**Type:** `boolean | undefined`

**Description:** Whether to disable automatic resize handling on window resize events. When `true`, the view is not automatically resized when the window size changes.

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  disableAutoResize: true,
});
```

### debug

**Type:** `boolean | undefined`

**Description:** Whether to enable debug mode. When `true`, additional debug information such as performance statistics overlays is displayed.

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  debug: true,
});
```

### atmosphere

**Type:** `AtmosphereOptions | undefined`

**Description:** Configuration options for atmospheric rendering. Configures the sky, sun, and atmospheric scattering effects. Sun and moon positions are automatically calculated based on the date specified in the `date` property and reflected in related Descriptors such as `SunLightDesc`.

```typescript
export type AtmosphereOptions = {
  atmosphereAssetsUrl?: string; // URL for atmosphere asset files
  stbnUrl?: string; // URL for STBN textures
  date?: Date; // Date and time used for sun/moon position calculations
};
```

**Example:**

```typescript
const view = new ThreeView({
  atmosphere: {
    atmosphereAssetsUrl: "/assets/atmosphere",
    date: new Date("2024-06-21T12:00:00"),
  },
});

// The date can be changed after initialization
await view.init();
view.atmosphere.date = new Date("2024-12-21T18:00:00");
```

:::tip[Related Documentation]
For details on the atmosphere system, see [Atmosphere Class](../../../three/api/atmosphere/).
:::

### backgroundColor

**Type:** `Color | undefined`

**Description:** The background color of the scene. Specify an instance of the `Color` class.

**Default:** `0x0a0a0f` (dark blue-gray)

**Example:**

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({
  backgroundColor: new Color().setHex(0x1a1a2e),
});
```

:::note
A numeric value (hexadecimal color code) can also be passed directly in the constructor, but it is internally processed as a `Color` object.
:::

### picking

**Type:** `boolean | undefined`

**Description:** Configuration option for feature picking. When enabled, the `featureClick` event fires when a feature is clicked or tapped, and the `featureHover` / `featureEnter` / `featureLeave` events fire as the pointer hovers features.

**Default:** `true`

**Example:**

```typescript
const view = new ThreeView({
  picking: true,
});

// Listen for pick events
view.on("featureClick", (info) => {
  if (info) {
    console.log("Selected feature:", info.properties);
  }
});
```

### animation

**Type:** `boolean | undefined`

**Description:** Whether to run the main loop every frame. When `true`, rendering occurs continuously. When `false`, rendering occurs only when changes are detected or `forceUpdate()` is called.

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  animation: true,
});
```

### multisampling

**Type:** `number | undefined`

**Description:** Number of MSAA (Multi-Sample Anti-Aliasing) samples. When 0, MSAA is disabled. Use with caution as it impacts performance.

**Default:** `0`

**Example:**

```typescript
const view = new ThreeView({
  multisampling: 4,
});
```

### halfFloat

**Type:** `boolean | undefined`

**Description:** Whether to use half-precision floating-point numbers (half-float) for post-processing. When `true`, rendering quality is improved.

**Default:** `true`

**Example:**

```typescript
const view = new ThreeView({
  halfFloat: true,
});
```

### logarithmicDepthBuffer

**Type:** `boolean | undefined`

**Description:** Whether to use a logarithmic depth buffer. When `true`, depth precision is improved at large scales. Some effects do not support this, so it should be set to `false` in such cases.

**Default:** `true`

**Example:**

```typescript
const view = new ThreeView({
  logarithmicDepthBuffer: true,
});
```

### shadow

**Type:** `boolean | undefined`

**Description:** Whether to enable shadow mapping. Must be specified at initialization and cannot be changed later.

**Default:** `false`

**Example:**

```typescript
const view = new ThreeView({
  shadow: true,
});
```

### idleThreshold

**Type:** `number | undefined`

**Description:** Milliseconds without data or tile processing activity that must elapse before the `idle` event fires. Continuous animations and effects do not count as activity. Lowering this value makes the engine report idle sooner. Raising it delays the notification until a longer quiet period has passed.

**Default:** `100`

**Example:**

```typescript
const view = new ThreeView({
  idleThreshold: 200,
});

view.on("idle", () => {
  console.log("Engine has been idle for 200 ms");
});
```

:::tip[Related Documentation]
See the [`idle` event](../threeview-events#idle) for details on when this event fires.
:::

### mobileOptimization

**Type:** `boolean | undefined`

**Description:** Whether to enable optimizations for mobile devices. When `true`, settings suitable for mobile devices are applied, such as lower pixel ratios and lighter effects.

**Default:** Auto-detected from the device (mobile devices are optimized automatically). Set explicitly to override the detection.

**Example:**

```typescript
const view = new ThreeView({
  mobileOptimization: true,
});
```

### cacheBytes

**Type:** `number | undefined`

**Description:** Memory budget in bytes for tile caches (WASM buffers + estimated GPU cost). Tiles leaving the view are retained until the budget is exceeded, then evicted least-recently-visited first, so panning back is refetch-free while total usage stays capped.

**Default:** Device-dependent. Desktop: a quarter of the reported device memory capped at 2 GB. Mobile: 512 MB (256 MB when the device reports less than 4 GB). See `getDefaultCacheBytes()`.

**Example:**

```typescript
const view = new ThreeView({
  cacheBytes: 512 * 1024 * 1024, // 512 MB
});
```

:::tip[Related Documentation]
Can also be changed at runtime via the [`cacheBytes` property](../threeview-properties#cachebytes).
:::

### lodFog

**Type:** `Partial<LodFogSettings> | undefined`

**Description:** LOD fog: a distance-based screen-space-error relaxation used by tile LOD selection: far tiles tolerate a larger error and stay coarser while near tiles keep full resolution. Purely an LOD control. It never affects visual fog rendering. Partial values are merged over the device default.

```typescript
type LodFogSettings = {
  enabled: boolean;
  // Distance scale of the relaxation ramp (2.0e-4 ≈ 63% strength at 5km)
  density: number;
  // Maximum SSE relaxation (in pixels) at far distance
  sseFactor: number;
};
```

**Default:** Device-memory-dependent. Desktop: `{ density: 2.0e-4, sseFactor: 2.0 }`. Low-memory devices ship a stronger curve so the tile working set stays small. See `getDefaultLodFog()`.

**Example:**

```typescript
const view = new ThreeView({
  lodFog: { density: 2.5e-4, sseFactor: 3.0 },
});
```

### dynamicSse

**Type:** `Partial<DynamicSseSettings> | undefined`

**Description:** Dynamic screen-space error (CesiumJS `dynamicScreenSpaceError` equivalent): tilted, street-level horizon views tolerate a larger error for far tiles, cutting the tile working set in exactly the views that over-refine. Zero effect looking straight down. Fades out as the camera climbs past `maxHeight` meters. Partial values are merged over the default.

```typescript
type DynamicSseSettings = {
  enabled: boolean;
  // Distance scale of the relaxation ramp before tilt/height scaling
  density: number;
  // Maximum SSE relaxation (in pixels) at full tilt and saturation
  sseFactor: number;
  // Fraction of the height band below which the effect is at full strength
  heightFalloff: number;
  // Camera height band (meters above the ellipsoid) the effect fades across
  minHeight: number;
  maxHeight: number;
};
```

**Default:** `{ enabled: true, density: 2.0e-4, sseFactor: 24.0, heightFalloff: 0.25, minHeight: 0, maxHeight: 8000 }`. See `getDefaultDynamicSse()`.

**Example:**

```typescript
const view = new ThreeView({
  dynamicSse: { sseFactor: 16.0, maxHeight: 4000 },
});
```

### workerPoolSize

**Type:** `number | undefined`

**Description:** Number of background workers that decode tiles and build meshes. Each worker has its own JavaScript engine instance and WebAssembly heap, so a smaller pool uses less memory but loads tiles more slowly after fast camera moves. The value is clamped to the range from `1` to `navigator.hardwareConcurrency` and also applies with `mobileOptimization`. If the browser does not report `navigator.deviceMemory`, the default `memoryBudget.maxWorkerHeapBytes` is a fixed amount per worker, so a larger pool raises peak memory. All views on a page share one pool, so only the first view to call `init()` sets its size (see [Multiple Views](#multiple-views)).

**Default:** `navigator.hardwareConcurrency` (at most `2` with `mobileOptimization`)

**Example:**

```typescript
const view = new ThreeView({
  workerPoolSize: 4,
});
```

### memoryBudget

**Type:** `object | undefined`

**Description:** Overrides for the worker-side memory budgets and the memory-pressure LOD degrade. Defaults derive from the device memory together with `cacheBytes`. See `getDefaultMemoryBudgets()`.

```typescript
type MemoryBudgetOptions = {
  // WASM heap budget per tile worker; the pool recycles a worker above it
  maxWorkerHeapBytes?: number;
  // Font-worker cache budget (font data + atlas pixels; caps further growth)
  fontBudgetBytes?: number;
  // In-flight data fetch cap per tile pipeline
  maxPendingRequests?: number;
  // Resting (base) memory-pressure SSE multiplier; > 1 keeps far tiles coarser even without pressure
  sseMultiplierMin?: number;
  // Ceiling the dynamic memory-pressure SSE degrade can climb to
  sseMultiplierMax?: number;
};
```

**Example:**

```typescript
const view = new ThreeView({
  memoryBudget: {
    maxWorkerHeapBytes: 128 * 1024 * 1024,
    sseMultiplierMin: 1.0,
    sseMultiplierMax: 8.0,
  },
});
```

:::tip[Related Documentation]
The SSE multiplier range can also be changed at runtime via [`setSseMultiplierRange()`](../threeview-functions#setssemultiplierrange).
:::

### GlobeOptions

**Type:** `GlobeOptions`

**Description:** Additional options related to globe display. ThreeView constructor options inherit from GlobeOptions.

```typescript
type GlobeOptions = {
  maxSse?: number; // Screen space error threshold for LOD calculations (initialization only)
  segments?: number; // Number of segments for mesh tessellation (initialization only)
  color?: Color; // Base color of the globe surface
  hideUnderground?: boolean; // Whether to hide underground geometry
  shouldComputeNormalFromVertex?: boolean; // Whether to compute normals from vertex positions (initialization only)
  transparent?: boolean; // Whether to make the material transparent
  opacity?: number; // Global material opacity (0.0-1.0)
  wireframe?: boolean; // Whether to render in wireframe mode
};
```

:::warning
Disabling `hideUnderground` may cause unexpected behavior with some effect Descriptors.
:::

:::tip[Related Documentation]
For details and usage examples of each property, see [Globe Class](../../../three/api/globe/).
:::

**Example:**

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({
  maxSse: 1,
  segments: 10,
  color: new Color().setHex(0x1a1a2e),
  hideUnderground: true,
  wireframe: false,
});
```
