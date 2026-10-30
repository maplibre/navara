---
title: BuildingWindowsEffectDesc
description: Building windows effect descriptor for navara_three_default_descs
sidebar:
  order: 63
---

The `BuildingWindowsEffectDesc` class is a Descriptor that draws lit windows on building walls. It paints a grid of windows anchored to the world, one column every `columnWidth` meters along the wall and one row every `floorHeight` meters, on the walls of the objects whose `effectIds` list the effect. Roofs and floors get no windows, and the share of lit windows rises with height above the ground. It works on any geometry in the scene, such as extruded polygons and 3D Tiles.

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** Controls the visibility of the effect descriptor.

**Default:** `true`

### litRatio

**Type:** `number | undefined`

**Description:** Share of windows that are lit on the tallest buildings, from `0` to `1`. Walls near the ground light fewer windows: the share starts at 70% of this value at ground level and reaches the full value 35 m above the ground.

**Default:** `0.55`

**Example:**

```typescript
{
  buildingWindows: {
    litRatio: 0.7,
  }
}
```

### floorHeight

**Type:** `number | undefined`

**Description:** Vertical pitch of the window rows in meters. Floors count up from `groundHeight`.

**Default:** `3.5`

**Example:**

```typescript
{
  buildingWindows: {
    floorHeight: 4,
  }
}
```

### columnWidth

**Type:** `number | undefined`

**Description:** Pitch of the windows along the wall in meters.

**Default:** `3`

**Example:**

```typescript
{
  buildingWindows: {
    columnWidth: 2.5,
  }
}
```

### intensity

**Type:** `number | undefined`

**Description:** Brightness multiplier of the lit windows. Scale it over time to fade the windows in at dusk.

**Default:** `1`

**Example:**

```typescript
{
  buildingWindows: {
    intensity: 1.5,
  }
}
```

### groundHeight

**Type:** `number | undefined`

**Description:** Ellipsoid height of the ground in meters. Floors count up from here, and walls below it get no windows. Buildings standing on terrain need the terrain height under the view.

**Default:** `0`

**Example:**

```typescript
{
  buildingWindows: {
    groundHeight: 40,
  }
}
```

## Applying the Effect to Objects

To draw windows on specific objects, specify the effect descriptor's ID in the target object's `effectIds` property.

### effectIds

An array of selective effect descriptor IDs to apply to the target object. When a building windows effect descriptor is added, a unique ID is assigned, and the effect is applied by specifying this ID in the target object's `effectIds`. Windows appear on the walls only: roofs and floors get none.

## Usage Examples

### Adding windows to extruded buildings

```typescript
import ThreeView, { Color } from "@navaramap/three";
import {
  BuildingWindowsEffectDesc,
  SelectiveBloomEffectDesc,
} from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
view.addPlugin(new DefaultPlugin());
await view.init();

// Add selectiveBloom before buildingWindows (see Notes)
view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {},
});

// Add building windows effect descriptor
const windowsDesc = view.addEffect<BuildingWindowsEffectDesc>({
  buildingWindows: {
    litRatio: 0.55,
    floorHeight: 3.5,
    columnWidth: 3,
  },
});

// Extruded building footprints with windows on their walls
const tiles = view.addSource({
  type: "vector-tile",
  url: "https://example.com/tiles/{z}/{x}/{y}.mvt",
  maxZoom: 16,
});

view.addLayer({
  type: "vector",
  source: tiles,
  sourceLayers: ["building"],
  polygon: {
    color: new Color().setStyle("#d9d0c9"),
    clampToGround: false,
    extrudedHeight: 30,
    effectIds: [windowsDesc.id],
  },
});

// Update parameters later
windowsDesc.update({
  buildingWindows: {
    litRatio: 0.7,
  },
});
```

### Applying windows to 3D Tiles

```typescript
import ThreeView from "@navaramap/three";
import { BuildingWindowsEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
view.addPlugin(new DefaultPlugin());
await view.init();

const windowsDesc = view.addEffect<BuildingWindowsEffectDesc>({
  buildingWindows: {},
});

// Apply windows to 3D Tiles buildings
const buildingsSource = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});

view.addLayer({
  type: "3d-tiles",
  source: buildingsSource,
  model: {
    show: true,
    effectIds: [windowsDesc.id],
  },
});
```

## Notes

- Add `selectiveBloom` first and `buildingWindows` second, so that the windows are drawn before the bloom is composited.
- `selectiveBloom` does not spread the light of the windows: it blooms the emissive color of the objects, and the windows add light on top of the surface color only.
- `useNormal` on the view is not required. The effect declares the data it needs itself.
- Windows fade with distance from the camera, to about a third of their brightness at 6 km.
