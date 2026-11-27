---
title: What is navara_three?
description: Overview and features of navara_three.
sidebar:
  order: 100
---

## What is navara_three?

`navara_three` is a JavaScript library that connects Three.js with Navara's headless map engine. It enables you to build high-quality 3D map applications on the web.

## Features of navara_three

### Declarative API

In navara_three, all elements displayed on the map can be added declaratively. Data is registered as a **Source**, and a **Layer** renders it.

```typescript
// Register the data as a source, then render it with a layer
const source = view.addSource({
  type: "geojson",
  url: "https://example.com/data.geojson",
});
const layer = view.addLayer({
  type: "vector",
  source,
  polygon: { color: 0x3388ff, opacity: 0.6 },
});
```

Many data formats that were complex in traditional GIS development (GeoJSON, MVT, 3D Tiles, terrain data, raster tiles, etc.) are all handled through a unified Source + Layer API.

### Styling with Materials

Each layer is styled by specifying Materials. You can flexibly specify color, size, opacity, and more for each feature type such as points, lines, and polygons.

```typescript
const source = view.addSource({
  type: "geojson",
  url: "https://example.com/data.geojson",
});
view.addLayer({
  type: "vector",
  source,
  point: { color: 0xff0000, size: 10 },
  polyline: { color: 0x00ff00, width: 2 },
  polygon: { color: 0x0000ff, opacity: 0.5 },
});
```

### 3D Objects, Effects, and Lights Managed as Descriptors

Not only GIS data, but also 3D meshes, post-processing effects, and lighting can be added as Descriptors. This allows you to manage maps and visual effects through a unified API.

Mesh, effect, and light descriptors require descriptor class registration before use.

```typescript
import { BoxMeshDesc, FXAAEffectDesc, SunLightDesc } from "@navaramap/three-default-descs";

// Register descriptor classes
view.registerMesh("box", BoxMeshDesc);
view.registerEffect("fxaa", FXAAEffectDesc);
view.registerLight("sun", SunLightDesc);

// Add a 3D box
view.addMesh({ box: { width: 100, height: 100, depth: 100 } });

// Apply anti-aliasing
view.addEffect({ fxaa: {} });

// Add sunlight
view.addLight({ sun: { intensity: 1.0 } });
```

### Dynamic Access to Features

Layers support not only declarative addition but also dynamic access to features. You can access individual features through events to implement data-driven styling and interaction.

```typescript
import { Color } from "@navaramap/three";

layer.on("featureUpdated", ({ evaluator }) => {
  // Dynamically change styles based on feature properties
  evaluator.evaluate(({ properties }) => {
    const population = properties?.["population"] as number;
    return {
      color: new Color().setHex(population > 1000000 ? 0xff0000 : 0x00ff00),
    };
  });
});
```
