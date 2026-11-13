# Declarative API — Sources, Layers, Materials

The core design: a **Source** describes _where and how data is fetched_; a **Layer** describes _how it renders_. One source can feed many layers — tile fetches and caches are deduplicated, and you can restyle without refetching.

## Source ↔ Layer ↔ Material compatibility

| Layer type | Accepts sources                | Material blocks                                     |
| ---------- | ------------------------------ | --------------------------------------------------- |
| `vector`   | `geojson`, `vector-tile`       | `point`, `billboard`, `text`, `polyline`, `polygon` |
| `raster`   | `raster-tile`, `raster-dem`    | `raster`, `hillshade`, `elevationHeatmap`           |
| `terrain`  | `raster-dem`, `quantized-mesh` | `terrain`                                           |
| `3d-tiles` | `3d-tiles`                     | `model`                                             |

## Basic pattern

```typescript
import { Color } from "@navaramap/three";

const imagery = view.addSource({
  type: "raster-tile",
  url: "https://example.com/{z}/{x}/{y}.png",
  maxZoom: 19,
});
view.addLayer({ type: "raster", source: imagery });

// Vector layer with multiple materials — each block styles one geometry kind:
view.addLayer({
  type: "vector",
  source: vectorSource,
  point: { color: new Color().setHex(0xff0000), size: 10 },
  polyline: { color: new Color().setHex(0x00ff00), width: 2 },
  polygon: { color: new Color().setHex(0x0000ff), opacity: 0.5 },
});
```

Layer material `color` fields take the `Color` class from `@navaramap/three` (`new Color().setHex(...)` / `.setStyle("#00aaff")`), not raw hex numbers — raw numbers only work in mesh Descriptor configs. For one-off inline data, a `geojson` **source** accepts a `data` field (a GeoJSON object) instead of a URL; layers themselves always reference a source.

Vector material options and gotchas (sizes, `clampToGround`, `geometryTypes`, dashes): [vector-styling.md](vector-styling.md). Labels and icons: [labels-and-sprites.md](labels-and-sprites.md).

## Terrain

```typescript
const dem = view.addSource({
  type: "raster-dem",
  url: DEM_URL,
  maxZoom: 14 /*, elevationDecoder */,
});
view.addLayer({ type: "terrain", source: dem }); // add BEFORE the raster basemap draped over it
view.addLayer({ type: "raster", source: imagery });
```

Quantized-mesh terrain uses `type: "quantized-mesh"` sources (or `CesiumIonPlugin` for Cesium Ion assets). DEM sources can also feed `raster` layers with `hillshade` or `elevationHeatmap` materials.

- **Toggling terrain on/off: delete/re-add the layer.** `terrainLayer.update({ terrain: { show: false } })` has no visible effect (verified 2026-07); `layer.delete()` drops the surface to the flat ellipsoid and draped raster layers re-drape automatically.

## Elevation heatmap

- **`elevationHeatmap`: colors come from a per-layer RGBA `colorMap`.** The material itself is unlit and needs no terrain layer or lights; each layer's `colorMap` property supplies the colors as a flattened RGBA Float32Array (`ColorMap.flatten()` produces it with alpha 1; a length that is not a multiple of 4, e.g. an old flattened RGB array, is rejected with a warning and the layer falls back to grayscale, but an RGB array whose length happens to be a multiple of 4 is silently misread). Entries are evenly spaced over `minHeight`..`maxHeight`; for unevenly spaced stops (e.g. a MapLibre-style color ramp) pass `colorStops` (ascending meters, one per entry), which places each color exactly and makes min/max/logarithmic irrelevant to the colors. `layer.update()` and `view.updateLayerById()` both update a colorMap; an update that omits `colorMap`/`colorStops` keeps the current values, and an explicit `colorMap: undefined` switches back to grayscale.

## Update / delete semantics (easy to get wrong)

- **Updates are partial merges:** `Layer.update()`, `Source.update()` and mesh/effect/light handle `.update()` all merge into the current config — omitted materials and omitted fields within a material are preserved (verified: `layer.update({ point: { color } })` keeps `size`/`clampToGround`). Note: `Layer.update()`'s JSDoc says "the entire configuration is replaced" — that text is outdated; trust the merge behavior shown in its own `@example`.
- `source.update(config)` — **partial merge**: omitted fields are preserved. Updating a source **resets and reloads every layer** referencing it (terrain re-meshes).
- `source.delete()` — reference-counted: returns `false` and removes nothing while any layer references the source. Delete referencing layers first, or `update()` the source to swap data in place.
- Handles expose `id`; `view.deleteLayerById(id)` / `updateLayerById` variants exist for id-based management.
- Render order = the order layers were added.
- **Inline GeoJSON `data` does not reload via `source.update()`** (verified 2026-08: readouts driven from the same code ran, but the rendered features never changed; URL-based sources do reload). Re-pointing the existing layer at a fresh source also failed to render. The working pattern for dynamic inline data is rebuild both: `layer.delete(); source.delete(); source = view.addSource({ type: "geojson", data }); layer = view.addLayer({...})`. For measurement-style dynamic overlays (a handful of markers + a line), mesh descs are the simpler tool: add/delete `SphereMeshDesc` markers and a `TubeMeshDesc` arc via handles — see `example/pages/examples/api/measure-geodesic`.

## Layer data hierarchy & events

Layer → FeatureSet → Feature → Batch (each batch has a 24-bit `batchId`). Feature events fire per FeatureSet:

```typescript
layer.on("featureUpdated", ({ evaluator }) => {
  /* see feature-evaluator.md */
});
```

Layer events: `featureCreated` / `featureUpdated` / `featureVisibilityChanged` / `featureRemoved` / `deleted`. There is no per-layer "loaded" event — to know when everything has finished loading, use the view-level `idle` event (fires after `idleThreshold` ms without tile/data activity).

## Mesh / Effect / Light descriptors (the other half of the declarative API)

Layers need no registration, but mesh/effect/light **Descriptors must be registered before use** — the key of the config object selects the descriptor class:

```typescript
import {
  BoxMeshDesc,
  FXAAEffectDesc,
  SunLightDesc,
} from "@navaramap/three-default-descs";

view.registerMesh("box", BoxMeshDesc); // DefaultPlugin does this for ~40 built-ins
const box = view.addMesh<BoxMeshDesc>({ box: { width: 100, height: 100 } });
const fxaa = view.addEffect<FXAAEffectDesc>({ fxaa: {} });
const sun = view.addLight<SunLightDesc>({
  sun: { intensity: 1.0, castShadow: true },
});

box.update({ box: { width: 200 } }); // partial merge, same as Layer.update()
box.visible = false;
box.delete();
```

With `DefaultPlugin` all built-ins are pre-registered; call `addMesh`/`addEffect`/`addLight` directly.

- **Handle events vs desc events:** mesh/light/effect handles (`BaseHandle`) only emit `deleted` — desc-specific events (`load` / `error` / `animationReady` on GLTF, instanced-GLTF and splat descs) live on the desc, so subscribe via `handle.ref.on("load", ...)`.

Full reference: https://navara.world/docs/three/source/about/ · /three/layer/about/ · /three/material/about/
