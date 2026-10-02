# Declarative API — Sources, Layers, Materials

The core design: a **Source** describes *where and how data is fetched*; a **Layer** describes *how it renders*. One source can feed many layers — tile fetches and caches are deduplicated, and you can restyle without refetching.

## Source ↔ Layer ↔ Material compatibility

| Layer type | Accepts sources | Material blocks |
|---|---|---|
| `vector` | `geojson`, `vector-tile` | `point`, `billboard`, `text`, `polyline`, `polygon` |
| `raster` | `raster-tile`, `raster-dem` | `raster`, `hillshade`, `elevationHeatmap` |
| `terrain` | `raster-dem`, `quantized-mesh` | `terrain` |
| `3d-tiles` | `3d-tiles` | `model` |

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

Vector material gotchas (verified):

- `point` / `billboard` `size` is in **meters** by default (`sizeInMeters ?? true`) — a 24 m dot is invisible from a high camera. For constant on-screen size markers set `sizeInMeters: false` (size becomes pixels).
- `clampToGround` vectors are **baked into globe surface tiles**, so they only render where some tile-producing layer exists (raster or terrain). With no basemap at all, add a plain ellipsoid surface to drape onto: `view.addLayer({ type: "terrain", ellipsoid: {} })`, and color the bare globe via `view.globe.color = new Color().setStyle(...)`.
- `polygon.outline` is not rendered when `clampToGround: true` (outlines only exist on the non-draped 3D path).
- `text` labels sourced from feature properties are set via the evaluator, and the evaluate callback must return **both** `text` and `show: true` — returning only `text` leaves every label hidden. Register a Google Font first: `view.addFontFamily(await fetchFontFamilyFromCss("Arsenal", "https://fonts.googleapis.com/css2?family=Arsenal:wght@700"))`, then reference it as `text: { font: "Arsenal", ... }`.
- **Along-line placement** (`text` / `billboard` / `point` with `geometryTypes: ["line"]` + `placement: "line" | "line-center"`): `spacing` is **screen pixels** for `vector-tile` and `geojson` alike, resolved per anchor as the camera moves (anchors thin out / fill in without moving; the on-screen gap stays within 1–2× `spacing`, even across a pitched view). MapLibre's `symbol-spacing` rules apply on top: a symbol longer than ¾ `spacing` spreads repeats to its length + ¼ `spacing` (not dropped), a same-text label within `spacing / 2` of an earlier one in the tile is dropped, and vector tiles place anchors only inside their own bounds — so on vector tiles repeats are at most ~one tile (512–1024 px) apart however large `spacing` is. Very close in (GeoJSON street level, or vector tiles overscaled far past their zoom) anchors stop filling in and sit further apart than asked. `placement`, `spacing` and `rotateToLine` are baked when features are built: `layer.update()` cannot change them, delete and re-add the layer. Sprites follow the line with `billboardFacing: "flat"` + `rotateWithCamera: false` (the tangent bearing is added to `rotation`). References: `example/pages/styling/line-placement` (GeoJSON), `styling/mvt-line-labels` (MVT).

## Terrain

```typescript
const dem = view.addSource({ type: "raster-dem", url: DEM_URL, maxZoom: 14 /*, elevationDecoder */ });
view.addLayer({ type: "terrain", source: dem });   // add BEFORE the raster basemap draped over it
view.addLayer({ type: "raster", source: imagery });
```

Quantized-mesh terrain uses `type: "quantized-mesh"` sources (or `CesiumIonPlugin` for Cesium Ion assets). DEM sources can also feed `raster` layers with `hillshade` or `elevationHeatmap` materials.

## Update / delete semantics (easy to get wrong)

- `layer.update(config)` — **partial merge**: pass only what changes (e.g. `layer.update({ point: { color } })`); omitted materials and omitted fields within a material are preserved.
- `source.update(config)` — **partial merge**: omitted fields are preserved. Updating a source **resets and reloads every layer** referencing it (terrain re-meshes).
- `source.delete()` — reference-counted: returns `false` and removes nothing while any layer references the source. Delete referencing layers first, or `update()` the source to swap data in place.
- Handles expose `id`; `view.deleteLayerById(id)` / `updateLayerById` variants exist for id-based management.
- Render order = the order layers were added.

## Layer data hierarchy & events

Layer → FeatureSet → Feature → Batch (each batch has a 24-bit `batchId`). Feature events fire per FeatureSet:

```typescript
layer.on("featureUpdated", ({ evaluator }) => { /* see imperative-api.md */ });
```

Layer events: `featureCreated` / `featureUpdated` / `featureVisibilityChanged` / `featureRemoved` / `deleted`. There is no per-layer "loaded" event — to know when everything has finished loading, use the view-level `idle` event (fires after `idleThreshold` ms without tile/data activity).

## Mesh / Effect / Light descriptors (the other half of the declarative API)

Layers need no registration, but mesh/effect/light **Descriptors must be registered before use** — the key of the config object selects the descriptor class:

```typescript
import { BoxMeshDesc, FXAAEffectDesc, SunLightDesc } from "@navaramap/three-default-descs";

view.registerMesh("box", BoxMeshDesc);          // DefaultPlugin does this for ~40 built-ins
const box = view.addMesh<BoxMeshDesc>({ box: { width: 100, height: 100 } });
const fxaa = view.addEffect<FXAAEffectDesc>({ fxaa: {} });
const sun = view.addLight<SunLightDesc>({ sun: { intensity: 1.0, castShadow: true } });

box.update({ box: { width: 200 } });            // partial merge, same as Layer.update()
box.visible = false;
box.delete();
```

With `DefaultPlugin` all built-ins are pre-registered; call `addMesh`/`addEffect`/`addLight` directly.

## Camera

```typescript
view.setCamera({ lng, lat, height, heading, pitch, roll });    // instant; `distance` option = frame a target; cancels a flight
const ok = await view.flyTo({ lng, lat, height }, { duration, maxHeight, easing: "quinticInOut" });
// animated arc; resolves true on completion, false when interrupted by
// another camera operation (a newer flyTo, setCamera, etc.). duration
// defaults to 2–3 s derived from flight distance; easing defaults to
// quinticInOut (cubicOut when descending from high altitude).
view.lookAt(target, offsetENU);
view.camera.on("moveend", () => console.log(view.camera.positionGeographic));
view.camera.fov = 50;                                           // use setters, never camera.raw.fov
view.camera.fov;                                                // degrees; vertical fov
```

Full reference: https://navara.world/docs/three/source/about/ · /three/layer/about/ · /three/material/about/
