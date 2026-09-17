---
title: ThreeViewCamera Class
description: API Reference for ThreeViewCamera Class - manages camera position, orientation, and control behavior
sidebar:
  order: 1010
---

The `ThreeViewCamera` class manages the camera's position, orientation, projection, and interactive control behavior. It is accessed via the `camera` property of a `ThreeView` instance.

## How to Access

```typescript
import ThreeView from "@navaramap/three";

const view = new ThreeView({ container: element });
await view.init();

const camera = view.camera;
```

## Properties

### raw

**Type:** `PerspectiveCamera`

**Read-only**

The underlying Three.js `PerspectiveCamera`. Use this for **read-only** integration with Three.js APIs, such as reading the camera matrix or world position.

Do not write to `raw.fov` (or other frustum fields) directly: the engine synchronizes `raw.fov` from its internal frustum state, so direct writes will be overwritten and can leave the Rust-side culling state out of sync. Use the `fov` setter instead.

**Example:**

```typescript
// Read the camera's world position
const position = view.camera.raw.position;

// Set FOV through the ThreeViewCamera setter (keeps engine frustum in sync)
view.camera.fov = 60;
```

---

### positionECEF

**Type:** `{ x: number; y: number; z: number }`

**Read-only**

The camera's current position in Earth-Centered, Earth-Fixed (ECEF) coordinates (meters).

**Example:**

```typescript
const pos = view.camera.positionECEF;
console.log(`ECEF: ${pos.x}, ${pos.y}, ${pos.z}`);
```

---

### positionGeographic

**Type:** `{ lng: number; lat: number; height: number }`

**Read-only**

The camera's current position in geographic coordinates.

- `lng`: Longitude (degrees)
- `lat`: Latitude (degrees)
- `height`: Height above the ellipsoid (meters)

**Example:**

```typescript
const pos = view.camera.positionGeographic;
console.log(`Lng: ${pos.lng}, Lat: ${pos.lat}, Height: ${pos.height}m`);
```

---

### orientation

**Type:** `{ heading: number; pitch: number; roll: number }`

**Read-only**

The camera's current orientation.

- `heading`: Azimuth angle (degrees, 0 = North, clockwise)
- `pitch`: Elevation angle (degrees, negative = looking down)
- `roll`: Roll angle (degrees)

**Example:**

```typescript
const { heading, pitch, roll } = view.camera.orientation;
console.log(`Heading: ${heading}°, Pitch: ${pitch}°, Roll: ${roll}°`);
```

---

### fov

**Type:** `number | undefined` (getter) / `number` (setter)

The vertical field of view in degrees. The horizontal extent follows from the viewport aspect ratio.

Setting accepts the range `1`–`180`. Values outside this range are ignored. Reading returns `undefined` if the engine is not yet initialized.

**Example:**

```typescript
// Narrow FOV for a telephoto effect
view.camera.fov = 30;

// Wide FOV for a panoramic effect
view.camera.fov = 90;

console.log(`FOV: ${view.camera.fov}°`);
```

---

### near

**Type:** `number` (getter / setter)

The near clipping plane distance (meters). Must be greater than `0`.

**Example:**

```typescript
// Read the current near plane
console.log(view.camera.near);

// Set the near plane
view.camera.near = 0.5;
```

---

### far

**Type:** `number` (getter / setter)

The far clipping plane distance (meters). Must be greater than `near`.

**Example:**

```typescript
// Read the current far plane
console.log(view.camera.far);

// Set the far plane
view.camera.far = 1e9;
```

---

### options

**Type:** `CameraOptions` (setter)

Configures the camera's interactive control behavior. All fields are optional. Only the specified fields are updated.

```typescript
type CameraOptions = {
  autoAdjustNearFar?: boolean;
  minimumZoomDistance?: number;
  maximumZoomDistance?: number;
  spinSpeed?: number;
  zoomSpeed?: number;
  spinDuration?: number;
  zoomDuration?: number;
  translateDuration?: number;
  enableSpin?: boolean;
  enableZoom?: boolean;
  enableTilt?: boolean;
};
```

| Option | Type | Default | Description |
|---|---|---|---|
| `autoAdjustNearFar` | `boolean` | `true` | Automatically adjust near/far clipping planes based on camera altitude |
| `minimumZoomDistance` | `number` | ~6,356,752 | Minimum zoom distance from the Earth's surface (meters) |
| `maximumZoomDistance` | `number` | ~63,567,523 | Maximum zoom distance from the Earth's surface (meters) |
| `spinSpeed` | `number` | `2.0` | Multiplier for mouse drag rotation speed |
| `zoomSpeed` | `number` | `0.6` | Multiplier for scroll wheel zoom speed |
| `spinDuration` | `number` | `500` | Spin inertia duration after releasing mouse drag (ms) |
| `zoomDuration` | `number` | `100` | Zoom inertia duration after scroll wheel input (ms) |
| `translateDuration` | `number` | `500` | Translation inertia duration (ms) |
| `enableSpin` | `boolean` | `true` | Whether drag/swipe rotation is enabled |
| `enableZoom` | `boolean` | `true` | Whether scroll wheel and pinch/spread zoom are enabled |
| `enableTilt` | `boolean` | `true` | Whether tilt interactions (Ctrl+left drag, right-click drag, double-swipe, or rotate gestures) are enabled |

**Example:**

```typescript
// Disable all interactive controls (e.g. for programmatic camera only)
view.camera.options = {
  enableSpin: false,
  enableZoom: false,
  enableTilt: false,
};

// Tune inertia feel
view.camera.options = {
  spinDuration: 1000,
  zoomDuration: 50,
  translateDuration: 800,
};

// Restrict zoom range for a fixed-altitude application
view.camera.options = {
  minimumZoomDistance: 500,
  maximumZoomDistance: 5_000_000,
};
```

## Events

`ThreeViewCamera` inherits from `EventHandler` and emits the following events. Subscribe with `on()` and unsubscribe with `off()`.

Every camera change raises events, whether it comes from user interaction or from an API call. Instantaneous API calls — `setCamera()`, `lookAt()`, `rotateAroundAxis()` and a `flyTo()` with `duration: 0` — complete within a single frame, so they emit `move` and `moveend` together and never emit `movestart`. Each event fires at most once per frame.

### movestart

Fired once when the camera begins a continuous movement: a user gesture, the inertia that follows it, or an animated `flyTo()`. Instantaneous changes do not fire it, because they have no movement to open.

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("movestart", () => {
  console.log("Camera started moving");
});
```

---

### move

Fired every frame while the camera is in motion, and once for each instantaneous change. Listen to this event to keep a read-out of the camera's position in sync with every change.

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("move", () => {
  const pos = view.camera.positionGeographic;
  console.log(`Moving — height: ${pos.height.toFixed(0)}m`);
});
```

---

### moveend

Fired once when the camera stops moving, and once for each instantaneous change.

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("moveend", () => {
  const pos = view.camera.positionGeographic;
  console.log(`Stopped at lng=${pos.lng.toFixed(4)}, lat=${pos.lat.toFixed(4)}`);
});
```

---

### frustumChanged

Fired when the camera's frustum parameters change (FOV, near, or far plane).

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("frustumChanged", () => {
  console.log(`FOV: ${view.camera.fov}°`);
});
```

## Event Methods

### on()

Subscribes to a camera event.

**Syntax:**

```typescript
on(event: CameraEventName, handler: () => void): void
```

**Example:**

```typescript
const handler = () => console.log("Camera moved");
view.camera.on("move", handler);
```

---

### off()

Unsubscribes a previously registered handler.

**Syntax:**

```typescript
off(event: CameraEventName, handler: () => void): void
```

**Example:**

```typescript
view.camera.off("move", handler);
```

---

### once()

Subscribes to a camera event for a single execution, then automatically unsubscribes.

**Syntax:**

```typescript
once(event: CameraEventName, handler: () => void): void
```

**Example:**

```typescript
view.camera.once("moveend", () => {
  console.log("First move complete");
});
```

## See Also

- [ThreeView Properties](../../../three/api/threeview-properties/): `view.camera` and other view properties
- [ThreeView Functions](../../../three/api/threeview-functions/): `setCamera()`, `flyTo()`, `lookAt()`, and other camera movement methods
