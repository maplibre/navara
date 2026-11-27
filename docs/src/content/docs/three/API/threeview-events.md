---
title: ThreeView Events
description: API Reference for ThreeView Class Events
sidebar:
  order: 920
---

This page describes all events available on a ThreeView instance.

## Methods

### on()

Registers event listeners for various view events.

```tsx
on<K extends keyof ViewEvents>(event: K, handler: ViewEvents[K]): void
```

### off()

Removes an event listener.

```tsx
off<K extends keyof ViewEvents>(event: K, handler: ViewEvents[K]): void
```

**Example:**

```tsx
const resizeHandler = (width, height) => {
  console.log(`Resized to ${width}x${height}`);
};

// Register event listener
view.on("resize", resizeHandler);

// Later, remove the listener
view.off("resize", resizeHandler);
```

### Advanced Example

```tsx
// Create named handlers for easy cleanup
const handlers = {
  handleClick: (event) => {
    console.log("Clicked:", event);
  },
  handleResize: (width, height) => {
    console.log(`Resized: ${width}x${height}`);
  },
  handlePick: (info) => {
    if (info) {
      console.log("Picked:", info.properties);
    }
  },
};

// Register multiple listeners
view.on("click", handlers.handleClick);
view.on("resize", handlers.handleResize);
view.on("featureClick", handlers.handlePick);

// Later, cleanup all listeners
view.off("click", handlers.handleClick);
view.off("resize", handlers.handleResize);
view.off("featureClick", handlers.handlePick);
```

## Event Types

### resize

**Description:**

Fires when the window is resized. Receives width and height in pixels.

**Handler Type:**

```tsx
(width: number, height: number) => void
```

**Parameters:**

- `width`: Width after resize (pixels)
- `height`: Height after resize (pixels)

**Example:**

```tsx
view.on("resize", (width, height) => {
  console.log(`Window resized: ${width}x${height}`);
});
```

### featureClick

**Description:**

Fires when a feature is clicked or tapped. Receives the clicked feature information, or `null` if nothing pickable was clicked, and the click's pointer event. It fires for any mouse button, so check `event.button === 0` to act on the left button only. For a left click it fires before the `click` event, which receives the same event object.

The click pick is lazy: the GPU pick runs only while at least one `featureClick` listener is registered.

:::note
To use this event, you must set `picking: true` in the ThreeView constructor (enabled by default).
:::

**Handler Type:**

```tsx
(info: PickedFeature | null, event: MapPointerEvent | PointerEvent) => void
```

**Parameters:**

- `info`: Clicked feature information, or `null`
- `event`: The click's `pointerup` event, passed also when `info` is `null`. It is a [`MapPointerEvent`](#pointerdown) with the `map` coordinates of the `click` event, or a plain `PointerEvent` without `map` where the pointer is off the globe (the sky) :since[0.3.2]

```tsx
type PickedFeature = {
  batchId: number; // Picking ID of the rendered feature, valid while its feature set exists
  properties: Record<string, unknown> | undefined; // Feature properties
  layerId: string | undefined; // Layer ID
  featureId?: string | number; // Top-level GeoJSON `id` or MVT feature id (undefined when the feature has none)
  featureSetId?: FeatureSetId; // Feature set ID, as in the layer's featureCreated event (undefined outside a feature set)
  content?: FeatureSetContent; // Source content of the feature set (3D Tiles credit and metadata), as in featureCreated
};
```

To keep a selection, match it by `featureId` or a stable property, not by `batchId`: see [Identifiers](../../introduction/about-layer/#identifiers).

**Example:**

```tsx
view.on("featureClick", (info) => {
  if (info) {
    console.log("Selected feature:", info.properties);
    console.log("Layer ID:", info.layerId);
    console.log("Batch ID:", info.batchId);
  } else {
    console.log("No feature selected");
  }
});
```

#### The point drawn under the pointer :since[0.3.2]

`event.map` is where the camera ray meets the ellipsoid, which ignores buildings and terrain. For the point drawn at the clicked pixel, such as a roof, a model or the terrain, call `view.pickDepthPosition(event.clientX, event.clientY)` in the listener itself. Until the next frame is rendered, the depth buffer still holds the frame on screen, so it returns the point under the pointer, or `null` where nothing is drawn (the sky). Called later, after an `await` or in a timeout, it may read a newer frame.

```tsx
import { vector3ToGeodetic } from "@navaramap/three";

view.on("featureClick", (info, event) => {
  console.log(`Screen position: ${event.clientX}, ${event.clientY}`);
  if ("map" in event) {
    console.log(`On the ellipsoid (ECEF): ${event.map.x}, ${event.map.y}, ${event.map.z}`);
  }
  const drawn = view.pickDepthPosition(event.clientX, event.clientY);
  if (info && drawn) {
    const { lng, lat, height } = vector3ToGeodetic(drawn);
    console.log(`Clicked ${info.featureId} at ${lng}, ${lat}, ${height} m`);
  }
});
```

The same holds in `featureHover`, `featureEnter` and `featureLeave` listeners. In two cases the drawn point is not on the feature:

- The feature is searched within a few pixels around the pointer (`PICK_RADIUS`, or `TOUCH_PICK_RADIUS` for touch), while the depth is read at the pixel itself. A click just beside a thin line returns the line and the ground behind it, and a click a few pixels outside a feature's silhouette against the sky returns the feature and `null`.
- When the underground is shown (`globe.hideUnderground = false`), the depth keeps whichever of the terrain and the other objects is nearer to the camera, so for an object drawn below the terrain, such as an underground pipe, `info` is that object while the drawn point is the terrain surface above it.

### featureHover

**Description:**

Fires when the hovered feature changes as the pointer moves. Receives the newly hovered feature, or `null` when the pointer leaves all pickable features, and the pointer event the feature was picked for. The event fires only on change, not on every pointer move.

Hover picking runs a GPU pick per frame while the pointer moves, so it is activated lazily: picks run only while at least one `featureHover`, `featureEnter`, or `featureLeave` listener is registered, and are suppressed while a button or finger is pressed (for example, during a camera drag). Because touch contact always counts as pressed, hover events never fire for touch.

:::note
To use this event, you must set `picking: true` in the ThreeView constructor (enabled by default).
:::

**Handler Type:**

```tsx
(info: PickedFeature | null, event: MapPointerEvent | PointerEvent) => void
```

**Parameters:**

- `info`: Hovered feature information, or `null`
- `event`: The latest `pointermove` before the pick, or the `pointerleave` when the pointer leaves the canvas. It is a [`MapPointerEvent`](#pointerdown), or a plain `PointerEvent` without `map` off the globe, as in `featureClick`; see [The point drawn under the pointer](#the-point-drawn-under-the-pointer). A `pointermove` is delivered with the pick about one frame later, after its dispatch has ended, so `preventDefault()` and `stopPropagation()` have no effect on it and its `currentTarget` is `null` :since[0.3.2]

**Example:**

```tsx
view.on("featureHover", (info) => {
  view.canvas.style.cursor = info ? "pointer" : "";
});
```

### featureEnter

**Description:**

Fires when the pointer starts hovering a pickable feature. Together with `featureLeave`, this is synthesized from the same hover picking as `featureHover`, so the same activation rules apply.

**Handler Type:**

```tsx
(info: PickedFeature, event: MapPointerEvent | PointerEvent) => void
```

**Parameters:**

- `info`: The feature the pointer started hovering
- `event`: The pointer event, as in `featureHover` :since[0.3.2]

**Example:**

```tsx
view.on("featureEnter", (info) => {
  console.log("Entered feature:", info.properties);
});
```

### featureLeave

**Description:**

Fires when the pointer stops hovering the previously hovered feature. Receives the feature that was left. When the pointer moves directly from one feature to another, `featureLeave` fires for the previous feature before `featureEnter` fires for the new one.

**Handler Type:**

```tsx
(info: PickedFeature, event: MapPointerEvent | PointerEvent) => void
```

**Parameters:**

- `info`: The feature the pointer stopped hovering
- `event`: The pointer event, as in `featureHover`: the `pointerleave` when the pointer left the canvas :since[0.3.2]

**Example:**

```tsx
view.on("featureLeave", (info) => {
  console.log("Left feature:", info.properties);
});
```

### layer

**Description:**

Fires when a layer-related event occurs.

**Handler Type:**

```tsx
<K extends keyof LayerEvent>(
  k: K,
  layerId: string,
  ...args: Parameters<LayerEvent[K]>
) => void
```

**Example:**

```tsx
view.on("layer", (eventType, layerId, ...args) => {
  console.log(`Layer ${layerId} event: ${eventType}`, args);
});
```

### preUpdate

**Description:**

Fires before the update process. Receives a `DOMHighResTimeStamp` as a timestamp.

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp` (high-precision timestamp in milliseconds)

**Example:**

```tsx
view.on("preUpdate", (time) => {
  // Custom logic before update
  console.log(`Before update: ${time}ms`);
});
```

### postUpdate

**Description:**

Fires after the update process when state changes have occurred. Receives a `DOMHighResTimeStamp` as a timestamp.

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp` (high-precision timestamp in milliseconds)

**Example:**

```tsx
view.on("postUpdate", (time) => {
  // Custom logic after update
  console.log(`After update: ${time}ms`);
});
```

### preRender

**Description:**

Fires before rendering. When `animation: true`, fires every frame. Receives a `DOMHighResTimeStamp` as a timestamp.

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp` (high-precision timestamp in milliseconds)

**Example:**

```tsx
view.on("preRender", (time) => {
  // Custom logic before rendering
  console.log(`Before render: ${time}ms`);
});
```

### postRender

**Description:**

Fires after rendering. When `animation: true`, fires every frame. Receives a `DOMHighResTimeStamp` as a timestamp.

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp` (high-precision timestamp in milliseconds)

**Example:**

```tsx
view.on("postRender", (time) => {
  // Custom logic after rendering
  console.log(`After render: ${time}ms`);
});
```

### pointerdown

**Description:**

Fires when a pointer (mouse button, touch, or pen) is pressed on the map. Receives a `MapPointerEvent` containing map coordinates. Use `event.pointerType` (`"mouse"`, `"touch"`, or `"pen"`) to tell the input kinds apart.

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: Pointer event (containing map coordinates)

```tsx
type MapPointerEvent = {
  map: { x: number; y: number; z: number }; // ECEF coordinates on the globe surface
} & PointerEvent;
```

**Example:**

```tsx
view.on("pointerdown", (event) => {
  console.log(`Pointer down position: ${event.clientX}, ${event.clientY}`);
  console.log(
    `Map coordinates (ECEF): ${event.map.x}, ${event.map.y}, ${event.map.z}`
  );
});
```

### pointerenter

**Description:**

Fires when a pointer enters the canvas area. Receives a `MapPointerEvent` containing map coordinates.

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: Pointer event (containing map coordinates)

**Example:**

```tsx
view.on("pointerenter", (event) => {
  console.log("Pointer entered the map");
  console.log(`Map coordinates: ${event.map.x}, ${event.map.y}, ${event.map.z}`);
});
```

### pointerleave

**Description:**

Fires when a pointer leaves the canvas area. Receives a `MapPointerEvent` containing map coordinates. For touch, this fires after the finger is lifted.

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: Pointer event (containing map coordinates)

**Example:**

```tsx
view.on("pointerleave", (event) => {
  console.log("Pointer left the map");
});
```

### pointermove

**Description:**

Fires when a pointer moves on the map. Receives a `MapPointerEvent` containing map coordinates. For touch, this fires while a finger drags across the map.

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: Pointer event (containing map coordinates)

**Example:**

```tsx
view.on("pointermove", (event) => {
  console.log(`Pointer position: ${event.clientX}, ${event.clientY}`);
  console.log(
    `Map coordinates (ECEF): ${event.map.x}, ${event.map.y}, ${event.map.z}`
  );
});
```

### pointerup

**Description:**

Fires when a pointer (mouse button, touch, or pen) is released on the map. Receives a `MapPointerEvent` containing map coordinates.

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: Pointer event (containing map coordinates)

**Example:**

```tsx
view.on("pointerup", (event) => {
  console.log(`Pointer up position: ${event.clientX}, ${event.clientY}`);
  console.log(`Map coordinates: ${event.map.x}, ${event.map.y}, ${event.map.z}`);
});
```

### pointercancel

**Description:**

Fires when the browser cancels an active pointer, for example when a system gesture takes over a touch. Receives the raw `PointerEvent` without map coordinates.

**Handler Type:**

```tsx
(event: PointerEvent) => void
```

**Example:**

```tsx
view.on("pointercancel", () => {
  console.log("Pointer interaction cancelled");
});
```

### idle

**Description:**

Fires when data and tile processing becomes idle, that is, when no updates such as tile loading or data processing have occurred for at least `idleThreshold` milliseconds. Continuous animations and effects do not count as activity, so this event fires even while they are running. It fires at most once per idle period and resets when processing activity resumes.

**Handler Type:**

```tsx
() => void
```

**Example:**

```tsx
view.on("idle", () => {
  console.log("Data and tile processing is idle");
});
```

:::tip
Use the `idleThreshold` constructor option to control how long the engine must be inactive before the event fires. The default is 100 ms.
:::

### click

**Description:**

Fires when the map is clicked or tapped. Receives a `MapPointerEvent` containing map coordinates; `event.pointerType` tells the input kinds apart.

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: Pointer event (containing map coordinates)

**Example:**

```tsx
view.on("click", (event) => {
  console.log(`Click position: ${event.clientX}, ${event.clientY}`);
  console.log(`Input type: ${event.pointerType}`);
  console.log(
    `Map coordinates (ECEF): ${event.map.x}, ${event.map.y}, ${event.map.z}`
  );
});
```
