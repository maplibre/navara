---
title: PointMaterial
description: Point material for navara_three
sidebar:
  order: 530
---

`PointMaterial` represents a material for point geometry rendering.

## Properties

### backfaceCulling

**Type:** `boolean | undefined`

**Description:** Whether the point is hidden when seen from behind. When `false`, both sides of the point are drawn. When `true`, only its front is drawn.

It has no effect on an upright point that follows the camera (the default), which always shows its front. It matters in two cases. With [`rotateWithCamera`](#rotatewithcamera) set to `false`, the point can be seen from behind, where it appears mirrored, and turning this on hides it instead. With [`pointFacing`](#pointfacing) set to `"flat"`, its front faces away from the globe, so turning this on also hides the parts of a large point that wrap over the horizon.

**Default:** `false`

**Example:**

```typescript
{
  point: {
    pointFacing: "flat",
    backfaceCulling: true
  }
}
```

### center

**Type:** `{ x: number, y: number }`

**Description:** Specifies the shift amount from the center. The range is between 0 and 1. The unit is a relative position to the point circle.

**Default:** Required

**Example:**

```typescript
{
  point: {
    center: { x: 0.5, y: 0.5 }
  }
}
```

### clampToGround

**Type:** `boolean`

**Description:** Specifies whether to clamp to the ground.

**Default:** Required

**Example:**

```typescript
{
  point: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the point color as a `Color` instance.

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  point: {
    color: new Color().setHex(0xff0000)
  }
}
```

### declutter

**Type:** `boolean | undefined`

**Description:** Participate in screen-space decluttering: when labels/sprites overlap on screen, lower-priority ones are hidden. Enabled by default. Set to `false` to draw every label unconditionally.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    declutter: false
  }
}
```

### declutterPriority

**Type:** `number | undefined`

**Description:** Placement priority for decluttering. Higher wins. Only meaningful when [`declutter`](#declutter) is enabled. Can be overridden per feature via [`FeatureEvaluator.evaluate()`](../../api/feature-evaluator/#evaluate).

**Default:** `0.0`

**Example:**

```typescript
{
  point: {
    declutter: true,
    declutterPriority: 1
  }
}
```

### depthTest

**Type:** `boolean | undefined`

**Description:** A variable that determines whether front-facing models occlude back-facing models.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    depthTest: true
  }
}
```

### effectIds

**Type:** `string[] | undefined`

**Description:** Specifies the IDs of selective effects to apply (e.g., "bloom", "outline"). Used in conjunction with SelectiveBloomEffectDesc or SelectiveOutlineEffectDesc.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    effectIds: ["bloom", "outline"]
  }
}
```

### emissiveColor

**Type:** `Color | undefined`

**Description:** Specifies the emissive color as a `Color` instance.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  point: {
    emissiveColor: new Color().setHex(0xff0000)
  }
}
```

### emissiveIntensity

**Type:** `number | undefined`

**Description:** Specifies the emissive intensity.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    emissiveIntensity: 0.5
  }
}
```

### geometryTypes

**Type:** `("point" | "line" | "polygon")[] | undefined`

**Description:** Source geometry categories this material consumes. Adding `"line"` emits one point per line-string vertex by default. Set [`placement`](#placement) to repeat points along the line instead. Adding `"polygon"` emits one point per polygon-ring vertex (the closing duplicate vertex is skipped). Setting the array replaces the default, so include `"point"` when point geometry should keep rendering. This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` applies a new value only to tiles loaded afterwards, so already-loaded tiles keep their previous geometry until the layer is re-created.

**Default:** `["point"]`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["point", "polygon"]
  }
}
```

### height

**Type:** `number`

**Description:** Specifies the height. The unit is meters.

**Default:** Required

**Example:**

```typescript
{
  point: {
    height: 100 // 100 meters
  }
}
```

### offsetDepth

**Type:** `boolean | undefined`

**Description:** Avoids overlap with the earth's surface. Use this to prevent the point from clipping into the earth's surface.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    offsetDepth: true
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** Specifies the opacity of the point. Valid range is 0.0 (fully transparent) to 1.0 (fully opaque).

**Default:** `1.0`

**Example:**

```typescript
{
  point: {
    transparent: true,
    opacity: 0.5 // 50% opacity
  }
}
```

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** How points are placed on line geometry. Only takes effect when [`geometryTypes`](#geometrytypes) includes `"line"`. Point geometry is always placed at the point itself, and polygon rings always get one point per vertex.

- `"point"`: one point per line-string vertex.
- `"line"`: points repeat along the line every [`spacing`](#spacing), evenly spaced regardless of where the line's vertices are.
- `"line-center"`: a single point at the halfway point along each line string.

With `"line"` and `"line-center"`, each point is also turned to the direction of the line where it sits (see [`rotateToLine`](#rotatetoline)).

This option applies when the layer's geometry is built: set it at layer creation. `layer.update()` does not rebuild points that are already loaded, so remove the layer and add it again to change it.

**Default:** `"point"`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 50, // Screen pixels
    size: 6,
    sizeInMeters: false,
    clampToGround: true
  }
}
```

### sizeInMeters

**Type:** `boolean | undefined`

**Description:** Whether the size is specified in meters. If false, the size is in pixels.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    sizeInMeters: true
  }
}
```

### pointFacing

**Type:** `"upright" | "flat" | undefined`

**Description:** Whether the point stands up or lies on the globe surface. `"upright"` keeps it standing. `"flat"` lays it on the globe surface around its anchor, following the globe's curvature, so it reads as painted onto the surface and foreshortens with camera pitch.

Combine with [`rotateWithCamera`](#rotatewithcamera) for four behaviours:

| `pointFacing` | `rotateWithCamera` | Result |
| --- | --- | --- |
| `"upright"` | `true` | Screen-aligned billboard, never foreshortened (the default) |
| `"upright"` | `false` | Standing on the surface at a fixed bearing |
| `"flat"` | `true` | Painted on the surface, turned to keep facing the viewer |
| `"flat"` | `false` | Painted on the surface, north-up, turning with the map |

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/) as `facing`.

**Default:** `"upright"`

**Example:**

```typescript
{
  point: {
    pointFacing: "flat"
  }
}
```

### rotateToLine

**Type:** `boolean | undefined`

**Description:** Whether a point placed along a line turns with the line. When `true`, the direction of the line at the point's anchor, as a compass bearing, is added to [`rotation`](#rotation). Only used when [`placement`](#placement) is `"line"` or `"line-center"`.

The added bearing reads as a direction on the map when the point is fixed to the surface, so combine it with `pointFacing: "flat"` and `rotateWithCamera: false`. On a point that follows the camera, the bearing only spins it on screen.

This option applies when the layer's geometry is built. `layer.update()` does not change it for points that are already loaded, so remove the layer and add it again to change it.

**Default:** `true`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    pointFacing: "flat",
    rotateWithCamera: false,
    rotateToLine: true
  }
}
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** Whether the point turns to follow the camera. When `true`, it always faces the viewer. When `false`, it is fixed in its anchor's local east/north/up frame, and moving the camera never reorients it. With `"upright"`, it stands on the surface facing south, so it is seen edge-on from directly above and mirrored from behind.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/).

**Default:** `true`

**Example:**

```typescript
{
  point: {
    pointFacing: "upright",
    rotateWithCamera: false
  }
}
```

### rotation

**Type:** `number | undefined`

**Description:** Rotates the point within its own plane around its anchor point, in degrees, clockwise as seen from the front. The rotation is applied on top of the orientation that [`pointFacing`](#pointfacing) and [`rotateWithCamera`](#rotatewithcamera) resolve to.

[`center`](#center) decides where inside the point the pivot sits.

Can also be set per feature from a [feature evaluator](../../api/feature-evaluator/), so every point in a layer can point a different way.

**Default:** `0.0`

**Example:**

```typescript
{
  point: {
    rotation: 45
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** Specifies whether to show the point.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    show: true
  }
}
```

### size

**Type:** `number`

**Description:** Specifies the size of the point. The unit is meters.

**Default:** Required

**Example:**

```typescript
{
  point: {
    size: 10 // 10 meters
  }
}
```

### spacing

**Type:** `number | undefined`

**Description:** The distance between repeated points when [`placement`](#placement) is `"line"`, in screen pixels. The unit is the same on `geojson` and `vector-tile` sources.

The points shown on a line are decided again as the camera moves. Pulling the camera back thins them out, and moving closer fills in more points between them. Points never slide along the line: they only appear or disappear. The gap on screen stays between one and two times `spacing`, also in a tilted view, where the near and far parts of the view each get their own density.

A line always keeps the point at its halfway point, and a line shorter than `spacing` on screen gets only that one. Points stop filling in very close to the ground (street level) on a GeoJSON source, and when a vector tile is shown much deeper than its own zoom level (overscaled). There they sit farther apart than `spacing`.

As with MapLibre's `symbol-spacing`, a point longer along the line than three quarters of `spacing` spreads its repeats to that length plus a quarter of `spacing`. The length is measured in the point's own frame: with `rotateToLine` its top points along the line, so its height is what counts, and `rotation` turns it from there. On a vector tile source, each tile places points only inside its own bounds. Each tile spaces its own points, so repeats end up at most about one tile apart (512 to 1024 screen pixels) however large `spacing` is.

This option applies when the layer's geometry is built. `layer.update()` does not rebuild points that are already loaded, so remove the layer and add it again to change it.

**Default:** `250.0`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 100
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** Specifies whether to consider the point's transparency. Note that setting this to true may cause the point to not display correctly when effects are enabled.

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    transparent: false
  }
}
```
