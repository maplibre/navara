---
title: PolylineMeshDesc
description: Standalone polyline mesh descriptor for navara_three
sidebar:
  order: 118
---

The `PolylineMeshDesc` class draws a single polyline from a list of positions, without a source or a layer. It uses the same geometry and material as a [`vector`](../../../three/layer/vector-layer/) layer's [`polyline`](../../../three/material/polyline-material/), and `update()` rebuilds it from new positions in place. This makes it suited to lines that change often, for example a route being drawn or edited. Once a line is final, [`toGeoJSON()`](#togeojson) hands it to a `geojson` source.

By default the line is clamped to the ground: it follows the terrain under it and is hidden by geometry in front of the ground. With `clampToGround: false`, it is drawn at `height`.

The line is lit, so it renders black when the scene has no light. Add a light, or set `lit: false` on the mesh config to draw it in its plain color.

The base class transform properties (`geodetic`, `matrix`, `matrixWorld`, `position`, `rotation`, `scale`) work as for any other mesh: they map the positions from the mesh's local space to the world. Geographic positions are converted to ECEF first, so without a transform they are drawn where they are. The transform is applied when the geometry is built, so changing it with `update()` rebuilds the line. `visible`, `lit` and `pickable` are available. See [MeshDesc](../mesh-desc-base) for details.

For example, `geodetic` places cartesian `points` in a west-up-north frame at a geographic position:

```typescript
{
  polyline: {
    // 500 m to the north, in west-up-north meters
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 500 },
    ],
  },
  geodetic: { lng: 139.76, lat: 35.68, height: 0 },
}
```

## Positions

Set exactly one of `positions`, `points` or `geojson`. Setting one in `update()` clears the others. Passing the same array again rebuilds the line, so an array mutated in place can be re-submitted as is.

A mesh draws one line. Add one mesh per part of a multi-line.

### positions

**Type:** `LatLngHeight[]`

**Description:** Geographic positions: `lng` and `lat` in degrees, `height` in meters. At least two distinct positions are required.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    positions: [
      { lng: 139.76, lat: 35.68, height: 0 },
      { lng: 139.77, lat: 35.685, height: 0 },
      { lng: 139.78, lat: 35.68, height: 0 },
    ],
  }
}
```

### points

**Type:** `XYZ[]`

**Description:** Cartesian positions in meters in the mesh's local space, which is ECEF without a transform. At least two distinct positions are required.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    points: [
      { x: -3959000, y: 3352000, z: 3697000 },
      { x: -3960000, y: 3351000, z: 3697000 },
    ],
  }
}
```

### geojson

**Type:** `LineString | Polygon` (GeoJSON geometry)

**Description:** A GeoJSON `LineString`, with coordinates as `[lng, lat, height?]` in degrees and meters.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    geojson: {
      type: "LineString",
      coordinates: [
        [139.76, 35.68],
        [139.78, 35.68],
      ],
    },
  }
}
```

### ring

**Type:** `boolean`

**Description:** Joins a repeated first position as a seam instead of drawing two end caps, so a closed outline has no visible start. Repeat the first position at the end of the positions to close the line.

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    positions: ring, // the first position repeated at the end
    ring: true,
  }
}
```

## Properties

### clampToGround

**Type:** `boolean`

**Description:** Draws the line on the terrain under it, following the terrain as tiles load. A clamped line ignores `height`. Can be changed with `update()`.

**Default:** `true`

**Example:**

```typescript
{
  polyline: {
    clampToGround: false,
  }
}
```

### useGroundNormals

**Type:** `boolean`

**Description:** Shades a clamped line with the terrain's normal instead of its own, so the line takes the terrain's light and shade. It costs a full-screen copy of the terrain normals each frame. Enable it only where the terrain writes normals (`quantized-mesh` with `requestVertexNormals`, or a `raster-dem` terrain with a `hillshade` layer): elsewhere the line is shaded with an undefined normal.

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    clampToGround: true,
    useGroundNormals: true,
  }
}
```

### height

**Type:** `number`

**Description:** Height of the line in meters, relative to the ellipsoid. Applies when `clampToGround` is `false`.

**Default:** `0`

**Example:**

```typescript
{
  polyline: {
    clampToGround: false,
    height: 100,
  }
}
```

### width

**Type:** `number`

**Description:** Width of the line in pixels.

**Default:** `1`

**Example:**

```typescript
{
  polyline: {
    width: 4,
  }
}
```

### maxWidth

**Type:** `number`

**Description:** Upper limit of the rendered width in meters. From far away a pixel covers many meters, so the default limit makes the line thinner than `width` at high altitude. Raise it to keep the line at `width` pixels from far away.

**Default:** `1000`

**Example:**

```typescript
{
  polyline: {
    width: 3,
    maxWidth: 100000,
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the line color as a `Color` instance.

**Default:** White (`0xffffff`)

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    color: new Color().setHex(0xff6b2c),
  }
}
```

### opacity

**Type:** `number`

**Description:** Opacity from 0.0 (fully transparent) to 1.0 (fully opaque). Requires `transparent` to be `true`.

**Default:** `1`

**Example:**

```typescript
{
  polyline: {
    transparent: true,
    opacity: 0.5,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** Enables alpha blending, which `opacity` needs.

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    transparent: true,
  }
}
```

### depthWrite

**Type:** `boolean`

**Description:** Enables writing to the depth buffer. Set it to `false` for a transparent line to avoid depth sorting artifacts.

**Default:** `true`

**Example:**

```typescript
{
  polyline: {
    depthWrite: false,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** Specifies whether the line casts shadows. A clamped line casts no shadow.

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    clampToGround: false,
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** Specifies whether the line receives shadows. A clamped line receives the directional light's shadows at the ground under each pixel.

**Default:** `false`

**Example:**

```typescript
{
  polyline: {
    receiveShadow: true,
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** Specifies the emissive color as a `Color` instance, used with `emissiveIntensity`.

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polyline: {
    emissiveColor: new Color().setHex(0xffaa00),
    emissiveIntensity: 1,
  }
}
```

### emissiveIntensity

**Type:** `number`

**Description:** Specifies the emissive intensity.

**Default:** `0`

**Example:**

```typescript
{
  polyline: {
    emissiveIntensity: 1,
  }
}
```

### effectIds

**Type:** `string[]`

**Description:** Specifies an array of selective effect descriptor IDs to apply to this line.

**Default:** `undefined`

**Example:**

```typescript
{
  polyline: {
    effectIds: ["bloom-effect"],
  }
}
```

The layer-only options `tiled`, `geometryTypes`, `show` and `lit` of [`PolylineMaterial`](../../../three/material/polyline-material/) are not available. Use the mesh config's `visible` and `lit` instead of `show` and `lit`.

## Methods and Accessors

### toGeoJSON()

Returns the line as a GeoJSON `LineString`, for example to add it to a `geojson` source once editing is done.

**Syntax:**

```typescript
toGeoJSON(): LineString
```

**Returns:**

A GeoJSON `LineString` whose coordinates are `[lng, lat, height]`. The coordinates are the positions as drawn, with the transform applied.

**Example:**

```typescript
// Replace the edited mesh with a feature of a vector layer
const source = view.addSource({
  type: "geojson",
  data: line.ref.toGeoJSON(),
});
view.addLayer({
  type: "vector",
  source,
  polyline: { color: new Color().setHex(0xff6b2c), width: 4, clampToGround: true },
});
line.delete();
```

### batchId

**Type:** `number | undefined`

**Description:** The batch ID assigned when `pickable` is `true`. Compare it with the picked feature to tell which line was clicked. See [Picking](../mesh-desc-base#picking).

## Usage Examples

### Clamped Line

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { PolylineMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
await view.init();

const line = view.addMesh<PolylineMeshDesc>({
  polyline: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.74, lat: 35.37, height: 0 },
      { lng: 138.76, lat: 35.36, height: 0 },
    ],
    color: new Color().setHex(0xff6b2c),
    width: 4,
  },
  // Plain color without lights in the scene
  lit: false,
  pickable: true,
});

// Append a point: the line is rebuilt from the new positions
line.update({
  polyline: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.74, lat: 35.37, height: 0 },
      { lng: 138.76, lat: 35.36, height: 0 },
      { lng: 138.78, lat: 35.37, height: 0 },
    ],
  },
});
```

### Closed Outline of a Polygon

```typescript
import ThreeView, { Color, type LatLngHeight } from "@navaramap/three";
import type {
  PolygonMeshDesc,
  PolylineMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLight({ ambient: { intensity: 1 } });

const ring: LatLngHeight[] = [
  { lng: 138.72, lat: 35.36, height: 0 },
  { lng: 138.75, lat: 35.36, height: 0 },
  { lng: 138.75, lat: 35.38, height: 0 },
  { lng: 138.72, lat: 35.36, height: 0 },
];

view.addMesh<PolygonMeshDesc>({
  polygon: {
    positions: ring,
    color: new Color().setHex(0x0091ff),
    transparent: true,
    opacity: 0.5,
  },
});
view.addMesh<PolylineMeshDesc>({
  polyline: {
    positions: ring,
    ring: true,
    color: new Color().setHex(0xffffff),
    width: 3,
  },
});
```
