---
title: SelectiveBloomEffectDesc
description: Selective bloom effect descriptor for navara_three_default_descs
sidebar:
  order: 61
---

The `SelectiveBloomEffectDesc` class is a Descriptor that applies a selective bloom effect. It uses mask-based filtering to apply the bloom effect only to specific objects.

## Properties

### visible

**Type:** `boolean | undefined`

**Description:** Controls the visibility of the effect descriptor.

**Default:** `true`

### strength

**Type:** `number | undefined`

**Description:** Specifies the strength of the bloom effect.

**Default:** `0.8`

**Example:**

```typescript
{
  selectiveBloom: {
    strength: 1.2,
  }
}
```

### radius

**Type:** `number | undefined`

**Description:** Specifies how much of the lower-resolution mip level is blended in when the bloom blur upsamples, from `0` (sharpest) to `1` (widest). Higher values spread the bloom wider and softer.

**Default:** `0.85`

**Example:**

```typescript
{
  selectiveBloom: {
    radius: 0.4,
  }
}
```

### threshold

**Type:** `number | undefined`

**Description:** Specifies the threshold for the bloom effect. Only pixels brighter than this value will have bloom applied.

**Default:** `0.0`

**Example:**

```typescript
{
  selectiveBloom: {
    threshold: 0.5,
  }
}
```

### smoothing

**Type:** `number | undefined`

**Description:** Specifies the rise width of the threshold cutoff. A value near `0` makes the cutoff pixel-hard, which can flicker for elements sitting right at the threshold; a wider value fades bloom in smoothly as brightness crosses the threshold.

**Default:** `0.1`

**Example:**

```typescript
{
  selectiveBloom: {
    threshold: 0.2,
    smoothing: 0.2,
  }
}
```

### levels

**Type:** `number | undefined`

**Description:** Specifies the number of mip levels used by the bloom blur. Each additional level roughly doubles how far the bloom spreads. The value is rounded to an integer and clamped to at least `1`.

**Default:** `8`

**Example:**

```typescript
{
  selectiveBloom: {
    levels: 6,
  }
}
```

### resolutionScale

**Type:** `number | undefined`

**Description:** Specifies the rendering resolution scale factor. Lower values improve performance.

**Default:** `0.5`

**Example:**

```typescript
{
  selectiveBloom: {
    resolutionScale: 0.5,
  }
}
```

## Applying the Effect to Objects

To apply the selective bloom effect to specific objects, specify the bloom effect descriptor's ID in the target object's `effectIds` property.

### effectIds

An array of selective effect descriptor IDs to apply to the target object. When a bloom effect descriptor is added, a unique ID is assigned, and the effect is applied by specifying this ID in the target object's `effectIds`.

### emissiveColor (optional)

A color added to the glow. When unset, the object's surface color glows as is. When set, this color is added to the surface color (it does not replace it), so you can tint the glow or make it brighter.

### emissiveIntensity

How strongly the object glows. Higher values glow brighter. `0` turns the glow off even when `effectIds` is set.

### Per-feature emissive

When [FeatureEvaluator](../../../three/api/feature-evaluator/) returns `emissive` and `emissiveIntensity` for a feature, that feature glows with those values instead of the material settings. Returning `emissiveIntensity: 0` for a feature turns off its glow alone.

## Usage Examples

### Adding a basic selective bloom

```typescript
import ThreeView, { Color } from "@navaramap/three";
import {
  BoxMeshDesc,
  SelectiveBloomEffectDesc,
} from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// Add selective bloom effect descriptor
const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 0.8,
    radius: 0.85,
    threshold: 0.0,
  },
});

// Apply bloom effect to an object
// When emissiveColor is not set, the material's color is used as the bloom source
const cubeDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0xff0000),
    emissiveIntensity: 1.0, // Controls bloom brightness
    effectIds: [bloomDesc.id],
  },
  position: { x: 0, y: 0, z: 1000 },
});
```

### Strong bloom effect

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView();
const plugin = new DefaultPlugin();
view.addPlugin(plugin);
await view.init();

plugin.addDefaultPhotorealScene();

// Add a strong bloom effect
const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 1.5,
    radius: 0.5,
    threshold: 0.2,
  },
});
```

### Performance-oriented settings

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

// Performance-oriented settings
const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 0.6,
    radius: 0.2,
    threshold: 0.0,
    resolutionScale: 0.5, // Lower resolution for improved performance
  },
});
```

### Dynamic bloom effect updates

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 0.8,
  },
});

// Update parameters later
bloomDesc.update({
  selectiveBloom: {
    strength: 1.2,
    radius: 0.3,
  },
});
```

### Applying bloom to 3D Tiles

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 1.0,
    radius: 0.5,
  },
});

// Apply bloom to 3D Tiles buildings
// emissiveColor is optional — the model's own color is used when omitted
const buildingsSource = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});

const buildingsLayer = view.addLayer({
  type: "3d-tiles",
  source: buildingsSource,
  model: {
    show: true,
    color: new Color().setHex(0xffffff),
    effectIds: [bloomDesc.id],
    emissiveIntensity: 0.3,
  },
});
```

### Applying bloom to GeoJSON models

```typescript
import ThreeView from "@navaramap/three";
import { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
await view.init();

const bloomDesc = view.addEffect<SelectiveBloomEffectDesc>({
  selectiveBloom: {
    strength: 1.2,
  },
});

// Apply bloom to GeoJSON layer models
// emissiveColor is optional — the model's own color is used when omitted
const modelSource = view.addSource({
  type: "geojson",
  data: featureCollection,
});

const modelLayer = view.addLayer({
  type: "vector",
  source: modelSource,
  model: {
    show: true,
    size: 100,
    url: "model.glb",
    effectIds: [bloomDesc.id],
    emissiveIntensity: 0.5,
  },
});
```

### Dynamically toggling the effect

```typescript
// Initially no effects applied
const cubeDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0xff0000),
    effectIds: [],
  },
  position: { x: 0, y: 0, z: 1000 },
});

// Add bloom effect later
cubeDesc.update({
  box: {
    effectIds: [bloomDesc.id],
    emissiveIntensity: 1.0,
  },
});

// Disable the effect
cubeDesc.update({
  box: {
    effectIds: [],
  },
});
```

## Tuning guide

The effect runs in three steps. Extraction keeps only the pixels whose `effectIds` match and whose brightness passes `threshold` (softened by `smoothing`). The blur then spreads that light through a mip chain (`radius`, `levels`, `resolutionScale`). Finally the composite adds `strength × (source + blur)` to the frame: the unblurred source term makes the object itself read as self-lit, and the blurred term draws the halo around it.

The blur conserves energy. The halo carries exactly as much light as the source emits (area × emissive × `strength`), so spreading it wider makes each pixel dimmer. This is why a large emissive surface glows at `strength: 1` while a small point or a thin line needs a `strength` of 2 to 4 (or a higher `emissiveIntensity` on that layer) before its halo becomes visible.

| Goal | Adjust |
|---|---|
| Brighter glow overall | `strength`: scales both the self-lit object and the halo |
| Wider, softer halo | `radius` toward `1` (the default `0.85` is already wide, `0.3` to `0.5` is tight). Raise `levels` only when the halo needs to reach farther |
| Small points or thin lines barely glow | `strength` 2 to 4, or raise `emissiveIntensity` on that layer (per layer, unlike `strength`, which affects every layer using the effect) |
| Thousands of small sources wash the whole map | `threshold` (with `smoothing`) so only the brightest sources bloom, and fewer `levels` to shorten the tails |
| A thin line turns into a fat band | `resolutionScale: 1.0` with `radius` left at its default. Lowering `radius` concentrates the light in the finest level, which is itself blurred, so the line only gets wider. Full resolution costs about four times the bloom pixels and memory |
| The map itself looks lit | Not bloom. Set `strength: 0` to confirm, then check the tone mapping exposure and the tile lighting |

## Notes

- The selective bloom effect uses mask-based filtering to apply bloom only to specific objects.
- The glow color is `(surface color + emissiveColor) × emissiveIntensity`. The surface color includes per-instance colors for InstancedMesh and texture colors for textured materials. A feature that receives `emissive` from `FeatureEvaluator` glows with that value instead.
- To use the bloom effect effectively, it is important to set the object's `emissiveIntensity` appropriately.
