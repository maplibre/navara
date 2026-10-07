---
title: PolygonMeshDesc
description: Standalone polygon mesh descriptor for navara_three
sidebar:
  order: 117
---

The `PolygonMeshDesc` class draws a single polygon from a list of positions, without a source or a layer. It uses the same geometry and material as a [`vector`](../../../three/layer/vector-layer/) layer's [`polygon`](../../../three/material/polygon-material/), and `update()` rebuilds it from new positions in place. This makes it suited to shapes that change often, for example a polygon being drawn or edited. Once a shape is final, [`toGeoJSON()`](#togeojson) hands it to a `geojson` source.

By default the polygon is clamped to the ground: it is painted onto the terrain and follows the terrain as tiles load. With `clampToGround: false`, it is drawn at `height` and can be extruded.

The base class transform properties (`geodetic`, `matrix`, `matrixWorld`, `position`, `rotation`, `scale`) work as for any other mesh: they map the positions from the mesh's local space to the world. Geographic positions are converted to ECEF first, so without a transform they are drawn where they are. The transform is applied when the geometry is built, so changing it with `update()` rebuilds the polygon. `visible`, `lit` and `pickable` are available. See [MeshDesc](../mesh-desc-base) for details.

For example, `geodetic` places cartesian `points` in a west-up-north frame at a geographic position:

```typescript
{
  polygon: {
    // A 200 m square around the origin, in west-up-north meters
    points: [
      { x: -100, y: 0, z: -100 },
      { x: 100, y: 0, z: -100 },
      { x: 100, y: 0, z: 100 },
      { x: -100, y: 0, z: 100 },
      { x: -100, y: 0, z: -100 },
    ],
  },
  geodetic: { lng: 139.76, lat: 35.68, height: 0 },
}
```

## Positions

Set exactly one of `positions`, `points` or `geojson`. Setting one in `update()` clears the others. Passing the same array again rebuilds the polygon, so an array mutated in place can be re-submitted as is.

### positions

**Type:** `LatLngHeight[] | LatLngHeight[][]`

**Description:** Geographic positions: `lng` and `lat` in degrees, `height` in meters. A single array is the outer ring. An array of arrays is the outer ring followed by its holes. The heights are read only when `perPositionHeight` is `true`.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    positions: [
      { lng: 139.76, lat: 35.68, height: 0 },
      { lng: 139.77, lat: 35.68, height: 0 },
      { lng: 139.77, lat: 35.69, height: 0 },
      { lng: 139.76, lat: 35.68, height: 0 },
    ],
  }
}
```

### points

**Type:** `XYZ[] | XYZ[][]`

**Description:** Cartesian positions in meters in the mesh's local space, which is ECEF without a transform. A single array is the outer ring. An array of arrays is the outer ring followed by its holes.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    points: [
      { x: -3959000, y: 3352000, z: 3697000 },
      { x: -3959900, y: 3351000, z: 3697000 },
      { x: -3959900, y: 3351000, z: 3698000 },
      { x: -3959000, y: 3352000, z: 3697000 },
    ],
  }
}
```

### geojson

**Type:** `Polygon | LineString` (GeoJSON geometry)

**Description:** A GeoJSON `Polygon`, with coordinates as `[lng, lat, height?]` in degrees and meters. Its first ring is the outer ring and the rest are holes.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    geojson: {
      type: "Polygon",
      coordinates: [
        [
          [139.76, 35.68],
          [139.77, 35.68],
          [139.77, 35.69],
          [139.76, 35.68],
        ],
      ],
    },
  }
}
```

## Properties

### clampToGround

**Type:** `boolean`

**Description:** Paints the polygon onto the terrain and shades it at the ground under each pixel. [`useGroundNormals`](#usegroundnormals) chooses the normal it is shaded with. Can be changed with `update()`.

**Default:** `true`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
  }
}
```

### useGroundNormals

**Type:** `boolean`

**Description:** Shades a clamped polygon with the terrain's normal at each pixel, so it takes the terrain's light and shade. With `false`, it is shaded with the ellipsoid's normal, and the full-screen copy of the terrain normals is not needed. The terrain writes its normal when it has normals of its own (`quantized-mesh` with `requestVertexNormals`, or a `raster-dem` terrain with a `hillshade` layer): elsewhere a polygon with `true` is shaded with an undefined normal. Can be changed with `update()`.

**Default:** `true`

**Example:**

```typescript
{
  polygon: {
    clampToGround: true,
    useGroundNormals: false,
  }
}
```

### height

**Type:** `number`

**Description:** Height of the polygon in meters, relative to the ellipsoid. Applies when `clampToGround` is `false`.

**Default:** `0`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    height: 50,
  }
}
```

### extrudedHeight

**Type:** `number`

**Description:** Extrudes the polygon upward by this many meters, so its top sits at `height + extrudedHeight`. Applies when `clampToGround` is `false`.

**Default:** `0`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    height: 0,
    extrudedHeight: 120,
  }
}
```

### perPositionHeight

**Type:** `boolean`

**Description:** Uses the height of each position instead of the constant `height`. Applies when `clampToGround` is `false`.

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    perPositionHeight: true,
  }
}
```

### color

**Type:** `Color`

**Description:** Specifies the polygon color as a `Color` instance.

**Default:** Black (`0x000000`)

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  polygon: {
    color: new Color().setHex(0x0091ff),
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
  polygon: {
    transparent: true,
    opacity: 0.6,
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
  polygon: {
    transparent: true,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** Specifies whether the polygon casts shadows. A clamped polygon casts no shadow.

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    clampToGround: false,
    extrudedHeight: 120,
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** Specifies whether the polygon receives shadows. A clamped polygon receives the directional light's shadows at the ground under each pixel.

**Default:** `false`

**Example:**

```typescript
{
  polygon: {
    receiveShadow: true,
  }
}
```

### effectIds

**Type:** `string[]`

**Description:** Specifies an array of selective effect descriptor IDs to apply to this polygon.

**Default:** `undefined`

**Example:**

```typescript
{
  polygon: {
    effectIds: ["bloom-effect"],
  }
}
```

### Other Material Options

The appearance options of [`PolygonMaterial`](../../../three/material/polygon-material/) apply as documented there: `wireframe`, `emissiveColor`, `emissiveIntensity`, `reflectivity`, `roughness`, `water`, `waterScaleNormal`, `waterSpeed`, `applyWaterNormal`, `specular`, `shininess`, `specularStrength` and `ior`.

The layer-only options `tiled`, `show`, `surfaceShow`, `outline`, `outlineShow`, `outlineColor`, `outlineWidth` and `lit` are not available. Use the mesh config's `visible` and `lit` instead of `show` and `lit`, and draw an outline as a [`PolylineMeshDesc`](../polyline-mesh-desc) over the same ring.

## Methods and Accessors

### toGeoJSON()

Returns the polygon as a GeoJSON `Polygon`, for example to add it to a `geojson` source once editing is done.

**Syntax:**

```typescript
toGeoJSON(): Polygon
```

**Returns:**

A GeoJSON `Polygon` whose coordinates are `[lng, lat, height]`. The coordinates are the positions as drawn, with the transform applied.

**Example:**

```typescript
// Replace the edited mesh with a feature of a vector layer
const source = view.addSource({
  type: "geojson",
  data: polygon.ref.toGeoJSON(),
});
view.addLayer({
  type: "vector",
  source,
  polygon: { color: new Color().setHex(0x0091ff), clampToGround: true },
});
polygon.delete();
```

### batchId

**Type:** `number | undefined`

**Description:** The batch ID assigned when `pickable` is `true`. Compare it with the picked feature to tell which polygon was clicked. See [Picking](../mesh-desc-base#picking).

## Usage Examples

### Clamped Polygon

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { PolygonMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin());
await view.init();

// The draped polygon is shaded, so the scene needs a light
view.addLight({ ambient: { intensity: 1 } });

const polygon = view.addMesh<PolygonMeshDesc>({
  polygon: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.75, lat: 35.36, height: 0 },
      { lng: 138.75, lat: 35.38, height: 0 },
      { lng: 138.72, lat: 35.36, height: 0 },
    ],
    color: new Color().setHex(0x0091ff),
    transparent: true,
    opacity: 0.6,
  },
  pickable: true,
});

// Move a vertex: the polygon is rebuilt from the new positions
polygon.update({
  polygon: {
    positions: [
      { lng: 138.72, lat: 35.36, height: 0 },
      { lng: 138.76, lat: 35.36, height: 0 },
      { lng: 138.75, lat: 35.38, height: 0 },
      { lng: 138.72, lat: 35.36, height: 0 },
    ],
  },
});
```

### Extruded Polygon

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { PolygonMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8, castShadow: true } });

view.addMesh<PolygonMeshDesc>({
  polygon: {
    positions: [
      { lng: 139.765, lat: 35.68, height: 0 },
      { lng: 139.767, lat: 35.68, height: 0 },
      { lng: 139.767, lat: 35.682, height: 0 },
      { lng: 139.765, lat: 35.68, height: 0 },
    ],
    clampToGround: false,
    height: 0,
    extrudedHeight: 150,
    color: new Color().setHex(0xff8844),
    castShadow: true,
    receiveShadow: true,
  },
});
```
