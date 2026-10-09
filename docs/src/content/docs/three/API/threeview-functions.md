---
title: ThreeView Functions
description: API Reference for ThreeView Class Functions
sidebar:
  order: 930
---

This page describes all functions (methods) available on a ThreeView instance.

## Methods

### addLayer()

Adds a new resource layer to navara_three. This method is used for resource layers only (vector, raster, terrain, 3d-tiles). Each resource layer references a [source](../../../three/source/about/) via its `source` property. For mesh, light, and effect descriptors, use `addMesh()`, `addLight()`, and `addEffect()` respectively.

**Syntax:**

```tsx
addLayer(l: LayerDescription): Layer
```

**Parameters:**

For layer configuration options, see [Layer Types](../../../three/layer/about/) and each layer type page.

**Returns:**

```tsx
Layer;
```

Returns a `Layer` instance for the added resource layer.

**Example:**

```tsx
const source = view.addSource({
  type: "raster-tile",
  url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
  maxZoom: 23,
});

const layer = view.addLayer({
  type: "raster",
  source,
  raster: {
    color: new Color().setStyle("#cccccc"),
  },
});
```

### addSource()

Registers a data [source](../../../three/source/about/) and returns a `Source` handle. A source describes where data comes from and how it is fetched/decoded. Reference it from a resource layer via the layer's `source` property (the handle or its `id`).

**Syntax:**

```tsx
addSource(s: SourceDescription): Source
```

**Parameters:**

For the available source types and their fields, see [About Source](../../../three/source/about/).

**Returns:**

```tsx
Source;
```

A `Source` handle exposing `id`, `type`, `update(s)`, and `delete()`.

**Example:**

```tsx
const imagery = view.addSource({
  type: "raster-tile",
  url: "https://example.com/{z}/{x}/{y}.png",
  maxZoom: 19,
});

view.addLayer({ type: "raster", source: imagery });

// Later
imagery.update({ type: "raster-tile", url: "https://example.com/new/{z}/{x}/{y}.png" });
imagery.delete();
```

### addMesh()

Adds a new mesh descriptor to navara_three. The mesh descriptor class must be registered with `registerMesh()` before calling this method.

**Syntax:**

```tsx
addMesh<L = unknown>(l: MeshDescription): MeshHandle<L>
```

**Returns:**

```tsx
MeshHandle<L>;
```

Returns a `MeshHandle<L>` for controlling the mesh descriptor.

**Example:**

```tsx
// SkyMeshDesc must be registered
const skyHandle = view.addMesh<SkyMeshDesc>({ sky: {} });
```

### addLight()

Adds a new light descriptor to navara_three. The light descriptor class must be registered with `registerLight()` before calling this method.

**Syntax:**

```tsx
addLight<L = unknown>(l: LightDescription): LightHandle<L>
```

**Returns:**

```tsx
LightHandle<L>;
```

Returns a `LightHandle<L>` for controlling the light descriptor.

**Example:**

```tsx
// SunLightDesc must be registered
const sunHandle = view.addLight<SunLightDesc>({ sun: { intensity: 1.0 } });
```

### addEffect()

Adds a new effect descriptor to navara_three. The effect descriptor class must be registered with `registerEffect()` before calling this method.

**Syntax:**

```tsx
addEffect<L = unknown>(l: EffectDescription): EffectHandle<L>
```

**Returns:**

```tsx
EffectHandle<L>;
```

Returns a `EffectHandle<L>` for controlling the effect descriptor.

**Example:**

```tsx
// FXAAEffectDesc must be registered
const fxaaHandle = view.addEffect<FXAAEffectDesc>({ fxaa: {} });
```

### updateLayerById()

Updates an existing resource layer's configuration by its ID.
Only works for resource layers added via `addLayer()`.

**Syntax:**

```tsx
updateLayerById(id: string, l: LayerDescription): void
```

**Parameters:**

- `id`: The unique identifier of the layer to update
- `l`: Specifies the properties to update

**Example:**

```tsx
const id = layer.id; // Get the layer ID from the addLayer return value

// `source` is the raster-tile source referenced by the layer.
view.updateLayerById(id, {
  type: "raster",
  source,
  raster: {
    color: new Color().setStyle("#ffffff"),
  },
});
```

### updateMeshById()

Updates an existing mesh descriptor's configuration by its ID.
Accepts the same descriptor shape as `addMesh()`.

**Syntax:**

```tsx
updateMeshById(id: string, updates: OmitType<MeshConfig | D["mesh"]>): void
```

**Parameters:**

- `id`: The unique identifier of the mesh to update
- `updates`: Configuration object with properties to update (same shape as `addMesh()`)

**Example:**

```tsx
const handle = view.addMesh<BoxMeshDesc>({ box: { width: 100 } });

view.updateMeshById(handle.id, { box: { width: 200 } });
```

### updateLightById()

Updates an existing light descriptor's configuration by its ID.
Accepts the same descriptor shape as `addLight()`.

**Syntax:**

```tsx
updateLightById(id: string, updates: OmitType<LightConfig | D["light"]>): void
```

**Parameters:**

- `id`: The unique identifier of the light to update
- `updates`: Configuration object with properties to update (same shape as `addLight()`)

**Example:**

```tsx
const handle = view.addLight<SunLightDesc>({ sun: { intensity: 1.0 } });

view.updateLightById(handle.id, { sun: { intensity: 0.5 } });
```

### updateEffectById()

Updates an existing effect descriptor's configuration by its ID.
Accepts the same descriptor shape as `addEffect()`.

**Syntax:**

```tsx
updateEffectById(id: string, updates: OmitType<BuiltInEffectDescription | EffectConfig | D["effect"]>): void
```

**Parameters:**

- `id`: The unique identifier of the effect to update
- `updates`: Configuration object with properties to update (same shape as `addEffect()`)

**Example:**

```tsx
const handle = view.addEffect<SSAOEffectDesc>({ ssao: { radius: 0.5 } });

view.updateEffectById(handle.id, { ssao: { radius: 1.0 } });
```

### deleteLayerById()

Deletes a resource layer from the scene by its ID.

**Syntax:**

```tsx
deleteLayerById(id: string): boolean
```

**Parameters:**

- `id`: The unique identifier of the layer to delete

**Returns:** `true` if the layer was found and deleted, `false` otherwise.

**Example:**

```tsx
const id = layer.id;

view.deleteLayerById(id);
```

### deleteMeshById()

Deletes a mesh descriptor from the scene by its ID.

**Syntax:**

```tsx
deleteMeshById(id: string): boolean
```

**Parameters:**

- `id`: The unique identifier of the mesh to delete

**Returns:** `true` if the mesh was found and deleted, `false` otherwise.

**Example:**

```tsx
view.deleteMeshById(handle.id);
```

### deleteLightById()

Deletes a light descriptor from the scene by its ID.

**Syntax:**

```tsx
deleteLightById(id: string): boolean
```

**Parameters:**

- `id`: The unique identifier of the light to delete

**Returns:** `true` if the light was found and deleted, `false` otherwise.

**Example:**

```tsx
view.deleteLightById(handle.id);
```

### deleteEffectById()

Deletes an effect descriptor from the scene by its ID.

**Syntax:**

```tsx
deleteEffectById(id: string): boolean
```

**Parameters:**

- `id`: The unique identifier of the effect to delete

**Returns:** `true` if the effect was found and deleted, `false` otherwise.

**Example:**

```tsx
view.deleteEffectById(handle.id);
```

### init()

Initializes the 3D engine and WASM modules, and starts the main rendering loop. You must call this method before using the view.

**Syntax:**

```tsx
async init(): Promise<void>
```

**Returns:**

A `Promise<void>` that resolves when initialization is complete.

**Example:**

```tsx
const view = new ThreeView();
await view.init();

// Add layers after init()
const osm = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 19,
});

view.addLayer({ type: "raster", source: osm });
```

### dispose()

Releases all resources and stops the rendering loop. Call this method when the view is no longer needed.

**Syntax:**

```tsx
dispose(): void
```

**Example:**

```tsx
// Cleanup on component unmount
view.dispose();
```

### resize()

Changes the renderer size and updates the camera aspect ratio. Automatically called on window resize unless `disableAutoResize` is `true`.

**Syntax:**

```tsx
resize(width?: number, height?: number, pixelRatio?: number): void
```

**Parameters:**

- `width`: New width (pixels). Uses canvas size when omitted
- `height`: New height (pixels). Uses canvas size when omitted
- `pixelRatio`: Device pixel ratio

**Example:**

```tsx
// Resize with explicit dimensions
view.resize(1920, 1080, 2);

// Resize using current canvas size (only updating pixel ratio)
view.resize(undefined, undefined, window.devicePixelRatio);
```

### setCamera()

Sets the camera position and orientation immediately. Moves the camera directly without animation.

**Syntax:**

```tsx
setCamera(camPos: CameraPosition): void
```

**Parameters:**

- `camPos`: Camera position and orientation

```tsx
type CameraPosition = {
  lng?: number;
  lat?: number;
  height?: number;
  pitch?: number;
  heading?: number;
  roll?: number;
  distance?: number;
};
```

| Field | Type | Description |
|---|---|---|
| `lng` | `number` | Longitude (degrees) |
| `lat` | `number` | Latitude (degrees) |
| `height` | `number` | Height above the ellipsoid (meters). When `distance` is also set, this is used as the **target point elevation**: the camera is placed `distance` meters from that elevated target. |
| `pitch` | `number` | Pitch angle (degrees) |
| `heading` | `number` | Heading angle (degrees) |
| `roll` | `number` | Roll angle (degrees) |
| `distance` | `number` | Distance from the target point along the camera forward direction (meters). When specified, the camera is placed so that its forward ray reaches the `lng`/`lat`/`height` target from this distance. If omitted, `height` is used as the camera's own altitude above the surface normal. |

**Example:**

```tsx
// Altitude-based: place the camera 1000 m above Tokyo along the surface normal
view.setCamera({
  lng: 139.7671,
  lat: 35.6812,
  height: 1000,
  pitch: -45,
  heading: 0,
  roll: 0,
});

// Distance-based: frame a mountain summit (height = 3776 m) from 5000 m away
view.setCamera({
  lng: 138.7274,
  lat: 35.3606,
  height: 3776,
  distance: 5000,
  pitch: -20,
  heading: 0,
});
```

### moveCamera()

Moves the camera in the specified direction by the specified amount.

**Syntax:**

```tsx
moveCamera(move: CameraDirection, amount: number): void
```

**Parameters:**

- `move`: Camera movement direction
- `amount`: Amount to move (meters)

`CameraDirection` is an enum with the following values:

```tsx
enum CameraDirection {
  Forward,
  Backward,
  Left,
  Right,
  Up,
  Down,
}
```

**Example:**

```tsx
import ThreeView, { CameraDirection } from "@navaramap/three";

view.moveCamera(CameraDirection.Forward, 100);
view.moveCamera(CameraDirection.Up, 50);
```

### moveCameraWithDirection()

Moves the camera with a custom direction vector.

**Syntax:**

```tsx
moveCameraWithDirection(dir: number[], amount: number): void
```

**Parameters:**

- `dir`: [x, y, z] direction vector
- `amount`: Amount to move (meters)

**Example:**

```tsx
view.moveCameraWithDirection([1, 0, 0], 100);
```

### flyTo()

Animates the camera to a target position. Moves smoothly along a flight arc: the longitude takes the short way across the antimeridian, and the height follows an arc that peaks at `maxHeight`.

The returned promise resolves to `true` when the flight completes, or `false` when it is interrupted by another camera operation, such as a newer `flyTo()` or a [`setCamera()`](#setcamera) call. Issuing a new `flyTo()` while a flight is in progress interrupts the current flight and starts the new one from the current camera pose.

**Syntax:**

```tsx
flyTo(
  camPos: CameraPosition &
    Required<Pick<CameraPosition, "lng" | "lat">> &
    ({ height: number } | { distance: number }),
  options?: FlyToOptions
): Promise<boolean>

type FlyToOptions = {
  duration?: number;
  maxHeight?: number;
  easing?: FlyToEasing;
};

type FlyToEasing =
  | "linear"
  | "quadInOut"
  | "cubicInOut"
  | "cubicOut"
  | "quinticInOut";
```

**Parameters:**

- `camPos`: Target position. `lng` and `lat` are required, plus either `height` or `distance`.
  - `lng`: Longitude (degrees), **required**
  - `lat`: Latitude (degrees), **required**
  - `height`: Height above the ellipsoid (meters). When `distance` is also set, this is used as the **target point elevation** rather than the camera's own altitude.
  - `pitch`: Pitch angle (degrees)
  - `heading`: Heading angle (degrees)
  - `roll`: Roll angle (degrees)
  - `distance`: Distance from the target point along the camera forward direction (meters). When specified, the camera is placed so that its forward ray reaches the `lng`/`lat`/`height` target from this distance. If omitted, `height` is used as the camera's own altitude above the surface normal.
- `options`: Flight options.
  - `duration`: Animation duration (milliseconds). When omitted, the duration is derived from the flight distance (2–3 seconds). Pass `0` to jump instantly.
  - `maxHeight`: Maximum height during the flight arc (meters)
  - `easing`: Easing preset applied to the flight time. When omitted, `"quinticInOut"` is used, or `"cubicOut"` when descending from above 11,500 m.

**Returns:** `Promise<boolean>`: `true` when the flight completed, `false` when it was interrupted.

**Example:**

```tsx
// Altitude-based: fly to Tokyo over 3 seconds (maximum height 5000 m)
const completed = await view.flyTo(
  {
    lng: 139.7671,
    lat: 35.6812,
    height: 1000,
    pitch: -45,
    heading: 0,
  },
  { duration: 3000, maxHeight: 5000 }
);
if (!completed) {
  // Interrupted by another camera operation (a newer flyTo, setCamera, etc.).
}

// Distance-based: approach Tokyo Tower (at ground level) from 2000 m away,
// with an explicit easing
view.flyTo(
  {
    lng: 139.7454,
    lat: 35.6586,
    height: 0,
    distance: 2000,
    pitch: -30,
    heading: 45,
  },
  { duration: 4000, easing: "cubicInOut" }
);
```

### lookAt()

Points the camera at a target position and places it at an offset position. The offset is specified in the East-North-Up (ENU) coordinate system.

**Syntax:**

```tsx
lookAt(target: LatLngHeight, offset: Vector3): void
```

**Parameters:**

- `target`: Target geodetic position
  - `lng`: Longitude (degrees)
  - `lat`: Latitude (degrees)
  - `height`: Height (meters)
- `offset`: Offset from the target (ENU coordinate system, meters)
  - `x`: East direction
  - `y`: North direction
  - `z`: Up direction

**Example:**

```tsx
import { Vector3 } from "three";

// Look down at Tokyo Tower from 1000m above
view.lookAt(
  { lng: 139.7454, lat: 35.6586, height: 0 },
  new Vector3(0, 0, 1000) // 1000m directly above
);

// View from a diagonal behind
view.lookAt(
  { lng: 139.7454, lat: 35.6586, height: 0 },
  new Vector3(500, -500, 500) // 500m east, 500m south, 500m up
);
```

### cameraFollow()

Enables or disables camera follow mode. When enabled, the camera moves centered on the specified target position.

**Syntax:**

```tsx
cameraFollow(enabled: boolean, target?: LatLngHeight, offset?: Vector3): void
```

**Parameters:**

- `enabled`: Whether to enable follow mode
- `target`: Target position to center on
  - `lng`: Longitude (degrees)
  - `lat`: Latitude (degrees)
  - `height`: Height (meters)
- `offset`: Offset from the target (ENU coordinate system, meters)

**Example:**

```tsx
import { Vector3 } from "three";

view.cameraFollow(
  true,
  { lng: 139.7671, lat: 35.6812, height: 100 },
  new Vector3(0, -200, 100) // 200m south, 100m up
);

// Disable follow mode
view.cameraFollow(false);
```

### cameraFreeLook()

Enables or disables position-locked free-look. The camera stays planted at the target position while mouse drag rotates orientation in place. Useful for first-person-view "look around" controls where the eye must not move.

**Syntax:**

```tsx
cameraFreeLook(enabled: boolean, target?: LatLngHeight): void
```

**Parameters:**

- `enabled`: Whether to enable free-look mode
- `target`: Target position the camera is locked to
  - `lng`: Longitude (degrees)
  - `lat`: Latitude (degrees)
  - `height`: Height (meters)

When the target moves between calls (e.g. the player walks), the camera translates with it. Orientation is preserved. Mouse wheel zoom is disabled in this mode (the camera is at zero distance from the pivot).

**Example:**

```tsx
// Lock the camera at the player's eye position; drag to look around
view.cameraFreeLook(true, { lng: 139.7671, lat: 35.6812, height: 105 });

// Disable free-look mode
view.cameraFreeLook(false);
```

### sampleTerrainHeight()

Synchronously gets the terrain height at a specified geodetic position. Returns `undefined` if terrain data has not yet been loaded. When [`exaggeration`](../../../three/material/terrain-material/#exaggeration) is set, the returned heights are exaggerated to match the rendered surface.

This reads only tiles already resident for rendering, so while the camera is far away it returns the height of a coarse LOD tile which can be tens of meters off the true ground height. When you need an accurate height regardless of the camera (for example to place an object on the ground), use [`sampleTerrainMostDetailed()`](#sampleterrainmostdetailed) instead.

**Syntax:**

```tsx
sampleTerrainHeight(pos: LatLng): number | undefined
```

**Parameters:**

- `pos`: Geodetic position
  - `lat`: Latitude (degrees)
  - `lng`: Longitude (degrees)

**Returns:**

Terrain height (meters), or `undefined` if terrain data is not available

**Example:**

```tsx
// Specify latitude and longitude in degrees
const lat = 35.6812;
const lng = 139.7671;

const height = view.sampleTerrainHeight({ lat, lng });

if (height !== undefined) {
  console.log(`Terrain height: ${height}m`);
} else {
  console.log("Terrain data has not been loaded yet");
}
```

### sampleTerrainMostDetailed()

Asynchronously samples terrain heights at the most detailed zoom level the terrain source provides, fetching the needed tiles over the network. Unlike `sampleTerrainHeight()`, which reads only tiles already resident for rendering, and therefore returns coarse heights (or `undefined`) while the camera is far away, this resolves accurate ground heights regardless of what the camera has streamed in. Use it to place objects on the ground before flying there. When the terrain layer rendering `source` sets [`exaggeration`](../../../three/material/terrain-material/#exaggeration), the returned heights are exaggerated to match the rendered surface.

Positions are grouped by tile and each unique tile is fetched once. Sampling starts at the source's `maxZoom` and falls back to parent tiles on 404 until data is found, so sources whose real coverage is shallower than the configured `maxZoom` still resolve. A `401`/`403` response rejects the whole call (a token problem should not silently degrade into coarse heights), while server errors are retried and then yield `height: undefined` for the affected positions.

**Syntax:**

```tsx
sampleTerrainMostDetailed(
  source: SourceRef,
  positions: LatLng[],
  options?: SampleTerrainOptions,
): Promise<SampledTerrainPosition[]>
```

**Parameters:**

- `source`: A registered `quantized-mesh` / `raster-dem` source: either the `Source` handle returned by `addSource`, or its id
- `positions`: Geodetic positions to sample
  - `lat`: Latitude (degrees)
  - `lng`: Longitude (degrees)
- `options.level`: Sample at this fixed zoom level instead of probing down from the source's `maxZoom`. With a fixed level there is no fallback to parent tiles.
- `options.signal`: `AbortSignal` to cancel in-flight tile fetches.

**Returns:**

A promise resolving to one result per input position, in the same order. Each result echoes `lat`/`lng` and carries `height` (meters, or `undefined` when no tile could be fetched or decoded) and `level` (the zoom level actually sampled).

**Example:**

```tsx
const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/{z}/{x}/{y}.terrain",
  maxZoom: 15,
});
view.addLayer({ type: "terrain", source: terrain });

const lat = 35.6812;
const lng = 139.7671;

const [ground] = await view.sampleTerrainMostDetailed(terrain, [{ lat, lng }]);
if (ground.height !== undefined) {
  // Place a model exactly on the terrain surface, even from far away
  const surface = geodeticToVector3({ lat, lng, height: ground.height });
  view.addMesh({
    gltfModel: { url: "https://example.com/model.glb" },
    matrixWorld: northUpEastToFixedFrame(surface),
  });
}
```

### observeTerrainHeightAt()

Monitors terrain height changes at a specific position. The callback is invoked once the height is first sampled, which happens right after registration when the terrain there is already loaded, and then whenever a terrain tile containing the position loads or the terrain exaggeration changes, and the height changes with it. When [`exaggeration`](../../../three/material/terrain-material/#exaggeration) is set, the returned heights are exaggerated to match the rendered surface.

**Syntax:**

```tsx
observeTerrainHeightAt(pos: LatLng, cb: (height: number) => void): () => void
```

**Parameters:**

- `pos`: Position to monitor
  - `lat`: Latitude (degrees)
  - `lng`: Longitude (degrees)
- `cb`: Callback invoked when the height is updated

**Returns:**

A cleanup function to stop monitoring

**Example:**

```tsx
// Specify latitude and longitude in degrees
const lat = 35.6812;
const lng = 139.7671;

const cleanup = view.observeTerrainHeightAt({ lat, lng }, (height) => {
  console.log(`Terrain height updated: ${height}m`);
});

// Stop monitoring later
cleanup();
```

### sampleTerrainHeightRange()

Synchronously gets the minimum and maximum height of the ground over a geographic extent. Like `sampleTerrainHeight()`, it reads only the terrain tiles already loaded for rendering, and it reports `0` for an area no terrain tile has loaded yet. Use it to size something that must enclose the ground, for example a volume reaching from below to above the terrain. When [`exaggeration`](../../../three/material/terrain-material/#exaggeration) is set, the range is exaggerated to match the rendered surface, and so is the `0` of an area not loaded yet.

**Syntax:**

```tsx
sampleTerrainHeightRange(
  extent: GeographicExtent,
): { min: number; max: number } | undefined
```

**Parameters:**

- `extent`: Geographic bounds
  - `west`: Western longitude (degrees)
  - `south`: Southern latitude (degrees)
  - `east`: Eastern longitude (degrees)
  - `north`: Northern latitude (degrees)

**Returns:**

The minimum and maximum height (meters, relative to the ellipsoid), or `undefined` before the engine has set up its terrain

**Example:**

```tsx
const range = view.sampleTerrainHeightRange({
  west: 138.7,
  south: 35.3,
  east: 138.8,
  north: 35.4,
});

if (range) {
  console.log(`Ground spans ${range.min}m to ${range.max}m`);
}
```

### observeTerrainHeightRange()

Monitors the result of [`sampleTerrainHeightRange()`](#sampleterrainheightrange) over an extent. The callback is invoked once the range is first computed, and then whenever a terrain tile overlapping the extent loads or the terrain exaggeration changes, and the range changes with it.

**Syntax:**

```tsx
observeTerrainHeightRange(
  extent: GeographicExtent,
  cb: (range: { min: number; max: number }) => void,
): () => void
```

**Parameters:**

- `extent`: Geographic bounds in degrees, as in `sampleTerrainHeightRange()`. `west` must not be greater than `east`, so an extent crossing the antimeridian is not supported.
- `cb`: Callback receiving the minimum and maximum height (meters, relative to the ellipsoid)

**Returns:**

A cleanup function to stop monitoring

**Example:**

```tsx
const cleanup = view.observeTerrainHeightRange(
  { west: 138.7, south: 35.3, east: 138.8, north: 35.4 },
  ({ min, max }) => {
    console.log(`Ground spans ${min}m to ${max}m`);
  },
);

// Stop monitoring later
cleanup();
```

### rotateAroundAxis()

Rotates the camera around a specified axis. Specifying a zero vector uses the default axis.

**Syntax:**

```tsx
rotateAroundAxis(axis: Vector3, angle: number): void
```

**Parameters:**

- `axis`: Rotation axis
- `angle`: Rotation angle (radians)

**Example:**

```tsx
import { Vector3 } from "three";

// Rotate 45 degrees around the Y axis
view.rotateAroundAxis(new Vector3(0, 1, 0), Math.PI / 4);
```

### rotateAround()

Rotates the camera around the current look-at point or the center of the view.

**Syntax:**

```tsx
rotateAround(angle: number): void
```

**Parameters:**

- `angle`: Rotation angle (radians)

**Example:**

```tsx
// Rotate 45 degrees
view.rotateAround(Math.PI / 4);

// Auto-rotation animation
const animate = () => {
  view.rotateAround(0.005);
  requestAnimationFrame(animate);
};
animate();
```

### forceUpdate()

Forces the scene to re-render on the next frame. Used to manually trigger an update when `animation: false`.

**Syntax:**

```tsx
forceUpdate(): void
```

**Example:**

```tsx
view.forceUpdate();
```

### pickTerrainPosition()

Picks the terrain position at the given screen coordinates. Uses the same CSS pixel coordinates as `clientX` and `clientY` from mouse events.

**Syntax:**

```tsx
pickTerrainPosition(x: number, y: number): Vector3 | null
```

**Parameters:**

- `x`: Screen X coordinate (CSS pixels, same as `MouseEvent.clientX`)
- `y`: Screen Y coordinate (CSS pixels, same as `MouseEvent.clientY`)

**Returns:**

World position (ECEF coordinates), or `null` if no terrain is hit

**Example:**

```tsx
// Get terrain coordinates at the click position
view.on("click", (event) => {
  const position = view.pickTerrainPosition(event.clientX, event.clientY);
  if (position) {
    console.log(`ECEF coordinates: ${position.x}, ${position.y}, ${position.z}`);
  } else {
    console.log("No terrain hit");
  }
});
```

### pickDepthPosition()

Picks the world position at the given screen coordinates using the full scene depth buffer. Unlike `pickTerrainPosition()`, this method reads from the combined depth texture that includes all rendered geometry (terrain, meshes, etc.), so it returns a hit even when non-terrain objects are in front of the terrain.

**Syntax:**

```tsx
pickDepthPosition(x: number, y: number): Vector3 | null
```

**Parameters:**

- `x`: Screen X coordinate (CSS pixels, same as `MouseEvent.clientX`)
- `y`: Screen Y coordinate (CSS pixels, same as `MouseEvent.clientY`)

**Returns:**

World position (ECEF coordinates), or `null` if nothing is hit

**Example:**

```tsx
view.on("click", (event) => {
  const position = view.pickDepthPosition(event.clientX, event.clientY);
  if (position) {
    console.log(`ECEF coordinates: ${position.x}, ${position.y}, ${position.z}`);
  } else {
    console.log("Nothing hit");
  }
});
```

### registerMesh()

Registers a custom mesh descriptor class.

**Syntax:**

```tsx
registerMesh(name: string, meshClass: MeshDescConstructor): void
```

**Parameters:**

- `name`: Name of the mesh descriptor to register
- `meshClass`: Constructor of the mesh descriptor

**Example:**

```tsx
class CustomMeshDesc extends MeshDesc {
  onCreate() {
    // Custom implementation
  }
}

view.registerMesh("customMesh", CustomMeshDesc);
```

### registerLight()

Registers a custom light descriptor class.

**Syntax:**

```tsx
registerLight(name: string, lightClass: LightDescConstructor): void
```

**Parameters:**

- `name`: Name of the light descriptor to register
- `lightClass`: Constructor of the light descriptor

**Example:**

```tsx
class CustomLightDesc extends LightDesc {
  onCreate() {
    // Custom implementation
  }
}

view.registerLight("customLight", CustomLightDesc);
```

### registerEffect()

Registers a custom effect descriptor class.

**Syntax:**

```tsx
registerEffect(name: string, effectClass: EffectDescConstructor): void
```

**Parameters:**

- `name`: Name of the effect descriptor to register
- `effectClass`: Constructor of the effect descriptor

**Example:**

```tsx
class CustomEffectDesc extends EffectDesc {
  onCreate() {
    // Custom implementation
  }
}

view.registerEffect("customEffect", CustomEffectDesc);
```

### addPlugin()

Registers a plugin. Must be called before `view.init()`.

**Syntax:**

```tsx
addPlugin(plugin: Plugin): this
```

**Parameters:**

- `plugin`: A `Plugin` instance

**Example:**

```typescript
const view = new ThreeView({});
view.addPlugin(pluginA).addPlugin(pluginB);
await view.init();
```

### addFontFamily()

Registers a font family composed of multiple faces. Each face covers a set of unicode ranges and points to a separate font file URL (ttf, otf, woff, or woff2). Once a family is registered, a text layer can reference it by its `family` name through [`material.font`](../../../three/material/text-material/#font). Only the faces whose unicode ranges cover the characters in the label's `text` are downloaded.

**Face priority and fallback:**

- Faces are evaluated in the order they appear in `faces`. For each codepoint in `text`, the first face whose `unicodeRanges` contain the codepoint is used, so if ranges overlap, the earlier entry wins.
- Codepoints that are not covered by any face fall back to the first face (`faces[0]`). This means the first face may also be downloaded for uncovered characters, even if its declared `unicodeRanges` do not include them.

To make this behavior predictable, put the face you want used as the fallback at index `0`. Then order the remaining faces after it so that, when their ranges overlap, earlier entries have higher priority.

Returns the `ThreeView` instance so calls can be chained.

**Syntax:**

```tsx
addFontFamily(family: FontFamily): this
```

**Parameters:**

- `family`: A `FontFamily` object.
  - `family`: Unique name used to reference the family from `material.font`.
  - `faces`: Array of `FontFace` entries, each with:
    - `url`: URL of the font file.
    - `unicodeRanges`: Array of `{ from, to }` code point ranges (inclusive) covered by this face.

**Example:**

```typescript
view.addFontFamily({
  family: "MapFont",
  faces: [
    {
      url: "/fonts/latin.woff2",
      unicodeRanges: [{ from: 0x0000, to: 0x024f }],
    },
    {
      url: "/fonts/cjk.woff2",
      unicodeRanges: [{ from: 0x4e00, to: 0x9fff }],
    },
  ],
});

const source = view.addSource({
  type: "geojson",
  url: "/cities.geojson",
});

const layer = view.addLayer({
  type: "vector",
  source,
  text: {
    font: "MapFont",
  },
});

layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      const name = properties?.["name"] as string | undefined;
      return { text: name ?? "", show: !!name };
    },
    { filters: ["name"] },
  );
});
```

:::tip[Recommended]
Instead of writing faces and ranges by hand, derive them from a stylesheet's `@font-face` rules (e.g. the Google Fonts CSS API) with [`fetchFontFamilyFromCss()`](../../../three/api/font-family-from-css/):

```typescript
view.addFontFamily(
  await fetchFontFamilyFromCss(
    "MapFont",
    "https://fonts.googleapis.com/css2?family=Noto+Sans&family=Noto+Sans+JP",
  ),
);
```

:::

### removeFontFamily()

Unregisters a previously added font family by name. Text layers that still reference the family will no longer be able to resolve it.

Returns the `ThreeView` instance so calls can be chained.

**Syntax:**

```tsx
removeFontFamily(family: string): this
```

**Parameters:**

- `family`: The `family` name passed to `addFontFamily()`.

**Example:**

```typescript
view.removeFontFamily("MapFont");
```

### setSseMultiplierRange()

Updates the memory-pressure SSE degrade range at runtime. `min` is the resting multiplier applied even without budget pressure (a value greater than 1 coarsens far tiles at rest). `max` is the ceiling the dynamic degrade can climb to under memory pressure. The next traversal re-selects tile LODs with the new range. Setting `min = max = 1` fully disables the pressure degrade.

**Syntax:**

```tsx
setSseMultiplierRange(min: number, max: number): void
```

**Parameters:**

- `min`: Resting (base) SSE multiplier applied without budget pressure
- `max`: Ceiling the dynamic memory-pressure degrade can climb to

**Example:**

```tsx
// Keep far tiles slightly coarse at rest, allow degrading up to 8x under pressure
view.setSseMultiplierRange(1.5, 8.0);

// Disable the memory-pressure degrade entirely
view.setSseMultiplierRange(1, 1);
```

:::tip[Related Documentation]
The device-dependent defaults can be set via the [`memoryBudget` option](../threeview-class#memorybudget) (`sseMultiplierMin` / `sseMultiplierMax`).
:::

### memoryStats()

Returns a snapshot of engine memory usage (WASM buffer bytes, GPU estimates, retained tile counts). Returns `undefined` before `init()`.

**Syntax:**

```tsx
memoryStats(): MemoryStats | undefined
```

**Returns:**

A plain `MemoryStats` object, or `undefined` before `init()`:

```tsx
type MemoryStats = {
  // Total bytes of tile payloads, geometry, and DEM buffers in WASM linear memory
  bufferTotalBytes: number;
  // Bytes held in the JS-side buffer store (fetched MVT pbf and worker-built
  // geometry that never enter WASM linear memory). Not part of bufferTotalBytes.
  externalBufferBytes: number;
  // Number of buffers tracked by the buffer store
  bufferCount: number;
  // Estimated GPU bytes (textures, geometry, render targets)
  gpuBytesEst: number;
  // CPU bytes outside the buffer store (chiefly feature-attribute tables)
  externalCpuBytes: number;
  // Reserved bytes for in-flight fetches (released when they land)
  reservedBytes: number;
  // Configured tile-cache budget; undefined when budgeting is disabled
  budgetBytes: number | undefined;
  // Cumulative count of evicted tiles
  evictedCount: number;
  // Current memory-pressure SSE multiplier (1 = no pressure)
  sseMultiplier: number;
  // Retained (deactivated but cached) tile counts per pipeline
  retainedVector: number;
  retainedTerrain: number;
  retainedRaster: number;
  retainedTiles3d: number;
};
```

**Example:**

```tsx
const stats = view.memoryStats();
if (stats) {
  const MB = 1024 * 1024;
  console.log(`WASM buffers: ${(stats.bufferTotalBytes / MB).toFixed(1)} MB`);
  console.log(`GPU estimate: ${(stats.gpuBytesEst / MB).toFixed(1)} MB`);
  console.log(`evicted: ${stats.evictedCount}, sse x${stats.sseMultiplier}`);
}
```

### workerMemoryStats()

Returns a snapshot of worker-side memory: per-tile-worker WASM heaps (point-in-time samples from the pool's post-task probes. This call also requests fresh probes, whose results show up on the *next* call) and the font worker's heap/cache breakdown. Returns `undefined` before `init()`.

**Syntax:**

```tsx
async workerMemoryStats(): Promise<WorkerMemoryStats | undefined>
```

**Returns:**

A `Promise` resolving to a `WorkerMemoryStats` object, or `undefined` before `init()`:

```tsx
type WorkerMemoryStats = {
  // Tile-worker pool heaps (undefined per slot until first probed)
  tileWorkers:
    | {
        // Last probed WASM heap per slot (undefined = not probed yet)
        perSlot: (number | undefined)[];
        // Sum of the probed heaps
        totalBytes: number;
        // The per-worker budget slots are recycled against
        maxWorkerHeapBytes: number;
      }
    | undefined;
  // Font worker heap/cache breakdown; undefined while no font is in use
  fontWorker:
    | {
        // Total WASM linear memory of the font worker (never shrinks)
        heapBytes: number;
        fontCount: number;
        atlasCount: number;
        glyphCount: number;
        // Raw font file bytes held by the cache
        fontBytes: number;
        // Monochrome (SDF/MSDF) atlas pixel bytes
        atlasBytes: number;
        // COLRv1 color atlas pixel bytes
        colorAtlasBytes: number;
        // Configured cache budget; undefined when unlimited
        budgetBytes?: number;
      }
    | undefined;
};
```

**Example:**

```tsx
const stats = await view.workerMemoryStats();
if (stats?.tileWorkers) {
  const MB = 1024 * 1024;
  console.log(`tile workers: ${(stats.tileWorkers.totalBytes / MB).toFixed(1)} MB`);
}
if (stats?.fontWorker) {
  console.log(`font atlas bytes: ${stats.fontWorker.atlasBytes}`);
}
```
