---
name: navara-usage
description: >
  Best practices for building 3D map applications with Navara (@navaramap/three).
  Use whenever writing or reviewing code that uses ThreeView, sources/layers/materials,
  plugins, mesh/effect/light descriptors, feature evaluation, picking, or geodetic math —
  in application code, examples, or documentation code snippets.
---

# Using Navara (@navaramap/three)

Navara is a 3D globe map engine: reusable GIS logic lives in a Rust/WASM core, and drawing is delegated to a swappable CG-rendering library. `@navaramap/three` is the Three.js-based binding (currently the only one; more rendering engines are planned — avoid wording that fixes Navara to Three.js in prose). Its public API is `ThreeView` plus a declarative Source/Layer/Descriptor model.

## Packages

| Package                           | What it provides                                                                                                                                                                        | When you need it                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@navaramap/three`                | `ThreeView` (default export), `Color`, geodetic math utils, `MeshDesc`/`EffectDesc`/`LightDesc` base classes, handle types, built-in attribution UI (`view.attribution`, on by default) | Always                                                                                |
| `@navaramap/three-default-plugin` | `DefaultPlugin`, `DefaultDescriptions` (registers ~40 built-in descriptors)                                                                                                             | Almost always                                                                         |
| `@navaramap/three-default-descs`  | Individual descriptor classes/types (`BoxMeshDesc`, `SSREffectDesc`, `SunLightDesc`, …)                                                                                                 | Typed `addMesh<T>`/`addEffect<T>` calls, or manual registration without DefaultPlugin |
| `@navaramap/three-plugins`        | `PersonViewPlugin`, `OverlayPlugin`, `CesiumIonPlugin`, `TileJsonPlugin`, `StreetLightsPlugin`                                                                                          | Per feature                                                                           |
| `@navaramap/three-api`            | Standalone GIS math (no view)                                                                                                                                                           | Pure geometry computation                                                             |

Most apps need only the first two.

Install every package your code imports from, explicitly. `@navaramap/three-default-plugin` depends on `@navaramap/three-default-descs`, but importing descriptor types from the latter with only the plugin installed fails to resolve under pnpm (transitive deps are not importable). Peer deps to install alongside: `three`, `postprocessing`.

## The canonical setup order (invariant)

```typescript
import ThreeView from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({ shadow: true }); // 1. construct
const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin); // 2. add ALL plugins — before init, or it throws
await view.init(); // 3. async init (WASM + workers + pipeline)
defaultPlugin.addDefaultPhotorealScene(); // 4. optional photoreal sky/sun/AA bundle
view.setCamera({
  lng: 139.77,
  lat: 35.68,
  height: 10000,
  heading: 0,
  pitch: -30,
  roll: 0,
});
const src = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 18,
});
view.addLayer({ type: "raster", source: src }); // 5. sources/layers/effects after init
```

When `DefaultPlugin` is used, parameterize the view as `new ThreeView<DefaultDescriptions>` so descriptor keys are typed.

## Invariants (apply everywhere)

- **Init order.** `addPlugin()` after `init()` throws. `registerMesh()` / `registerEffect()` / `registerLight()` and WASM-backed math (`degreeToRadian`, `geodeticToVector3`, `EllipsoidGeodesic`, …) throw before `init()`. Sources, layers, meshes, effects and lights are added after `await view.init()`.
- **Init-only options** cannot change after `init()`: `shadow`, `maxSse`, `segments`, `useNormal`, `workerPoolSize` (page-wide: only the first view's value counts, see [references/view-and-camera.md](references/view-and-camera.md)).
- **Every `update()` is a partial merge.** `Layer.update()`, `Source.update()` and mesh/effect/light handle `.update()` merge into the current config; omitted fields are preserved.
- **Layer render order = add order** (e.g. add terrain before the raster basemap draped on it).
- **Units:** every public lat/lng API takes **degrees** — `setCamera`/`flyTo`, `geodetic`, terrain sampling, `geodeticToVector3`/`vector3ToGeodetic`, `EllipsoidGeodesic` (headings in degrees too). Mesh `position` is ECEF meters. Three.js-level angles stay **radians** (Euler `rotation` fields, `rotateAroundAxis`/`rotateAround` — that's what `degreeToRadian` is still for); batch IDs are 24-bit.
- **Normals need a light.** A surface that carries normals renders black while the scene has no light → [references/lighting.md](references/lighting.md).
- **API stability tiers:** `ThreeView` = Tier 0 (stable). `Plugin` + `ViewContext` = Tier 1 (may break between minor versions). Keep app code on Tier 0 where possible.

## Reference index — read only what the task needs

The gotchas, verified behavior and patterns live in `references/`, one file per topic. Before writing code, read the files that match the task and skip the rest. Topics are grouped into four capability tiers — pick the lowest tier that solves the problem. (These are not the API stability tiers above: `ViewContext`, stability Tier 1, is what capability Tier 4 code uses.)

- [recipes.md](references/recipes.md) — start here for a good-looking scene from scratch: the photoreal base scene (terrain with shadows and a water-mask sea + satellite imagery + sky + attribution).

**Tier 1, Declarative API** — sources, layers and built-in descriptors as plain config objects.

- [view-and-camera.md](references/view-and-camera.md) — embedding the view in a page (`container`, resizing, several views), asset bundling, camera moves and camera events.
- [declarative-api.md](references/declarative-api.md) — sources and layers (basemaps, terrain, 3D Tiles, GeoJSON, vector tiles), update/delete semantics, layer events, built-in mesh/effect/light descriptors.
- [vector-styling.md](references/vector-styling.md) — vector points (pixel vs meter size, `sizeInMeters`), polylines (width, dashes) and polygons; `geometryTypes`; `clampToGround`; several layers over one source.
- [labels-and-sprites.md](references/labels-and-sprites.md) — text labels, icons (`billboard`) and point sprites: fonts, facing/rotation, anchor/offset, outlines, along-line placement, decluttering.
- [lighting.md](references/lighting.md) — lights, sun and shadows, `atmosphere.date`, something renders black, deferred lighting (`view.lit`, `aerialPerspective.irradiance`).
- [water-and-weather.md](references/water-and-weather.md) — water (waves, reflections), snow and rain.

**Tier 2, Imperative API** — per-feature evaluation, spatial queries, math.

- [feature-evaluator.md](references/feature-evaluator.md) — per-feature (data-driven) styling with `FeatureEvaluator`.
- [picking-and-events.md](references/picking-and-events.md) — click/hover picking, pointer events, picking a position on terrain or in the depth buffer.
- [placement-and-math.md](references/placement-and-math.md) — placing meshes/models at a lng/lat or on the ground, terrain height sampling, tangent frames, geodesic/ECEF math.

**Tier 3, Plugins** — reusable purpose-built features.

- [plugins.md](references/plugins.md) — built-in plugins (photoreal scene, attribution, TileJSON, street lights, person view, DOM overlays, Cesium Ion, MapLibre style) and writing your own.

**Tier 4, Custom descriptors** — your own meshes/effects/lights with access to the render pipeline.

- [custom-desc.md](references/custom-desc.md) — descriptor lifecycle, pass ordering, picking for custom meshes.
- [gbuffer.md](references/gbuffer.md) — reading or writing the depth/normal/shadow G-buffers (MRT) from custom shaders and effects.

## Where to verify — never guess API details

**Primary reference: the docs site — https://navara.world/docs/** (Japanese under `/ja/`). Sections: `/three/` (core API: sources, layers, materials, camera, events), `/three_default_descs/` (every built-in mesh/effect/light Descriptor and its options), `/three_default_plugin/`, `/three_plugins/`.

- **Do not guess material or config property names** — this skill shows patterns, not exhaustive option lists. Verify exact fields against the docs site, or the TypeScript definitions in `node_modules/@navaramap/*` (`.d.ts`).
- Working inside the Navara repository? The docs source is `docs/src/content/docs/` and runnable examples are `web/navara_three/example/pages/` — reference paths in this skill starting with `example/pages/` refer to that examples directory.
