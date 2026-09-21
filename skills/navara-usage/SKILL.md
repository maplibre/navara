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
| `@navaramap/three-plugins`        | `PersonViewPlugin`, `OverlayPlugin`, `CesiumIonPlugin`, `TileJsonPlugin`                                                                                                                | Per feature                                                                           |
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

## Start from a recipe when building a scene

For "make it look good" goals, use the proven compositions in [references/recipes.md](references/recipes.md) (e.g. the photoreal base scene: DefaultPlugin + photoreal scene + Re:Earth quantized-mesh terrain + EOX satellite imagery + attribution) instead of assembling pieces from scratch.

## Four capability tiers — pick the lowest that solves the problem

1. **Declarative API** — add sources and layers with plain config objects. Covers basemaps, terrain, vector data, 3D Tiles. → [references/declarative-api.md](references/declarative-api.md)
2. **Imperative API** — per-feature evaluation (`FeatureEvaluator`), picking, terrain sampling, geodetic/ECEF math. → [references/imperative-api.md](references/imperative-api.md)
3. **Plugins** — reusable purpose-built features (photoreal scene, first-person walk, DOM overlays, attribution), and how to write your own. → [references/plugins.md](references/plugins.md)
4. **Custom descriptors** — your own meshes/effects/lights, with access to the render pipeline, depth buffer, and normal/G-buffer (MRT). → [references/custom-desc.md](references/custom-desc.md)

## Critical gotchas (apply everywhere)

- **`addPlugin()` after `init()` throws.** All plugin `init()`s run in parallel during `view.init()`.
- **Updates are partial merges:** `Layer.update()`, `Source.update()` and mesh/effect/light handle `.update()` all merge into the current config — omitted materials and omitted fields within a material are preserved (verified: `layer.update({ point: { color } })` keeps `size`/`clampToGround`). Note: `Layer.update()`'s JSDoc says "the entire configuration is replaced" — that text is outdated; trust the merge behavior shown in its own `@example`.
- **Vector materials consume only their native geometry unless `geometryTypes` opts in more.** `point`/`billboard`/`text` default to `["point"]`, `polyline` to `["line"]` — polygon data with only a `polyline` material renders nothing. Opt in with e.g. `polyline: { geometryTypes: ["line", "polygon"] }` (polygon boundary rings incl. holes render as closed polylines) or `point: { geometryTypes: ["point", "line", "polygon"] }` (one point per vertex, ring-closing duplicate skipped). The array **replaces** the default, so include the native category to keep it. Boundary polylines are at ring base height only — extruded-polygon edges remain `polygon.outline`'s job. Two caveats: (1) `geometryTypes` is construction-time config — `layer.update()` applies a new value only to tiles loaded afterwards (resident tiles keep their old geometry, and toggling back never removes already-built derivations); set it at layer creation or delete/re-add the layer. (2) On tiled paths derivation walks tile-clipped rings; boundary polylines drop clip-introduced edges automatically (draped and non-draped are both clean), but vector-tile-derived points can still appear at clip-introduced vertices near tile edges.
- **One source can back several layers.** Point many `addLayer({ type: "vector", source })` calls at the same vector-tile source to style sublayers separately (`sourceLayers: ["water"]`, `["roads"]`, …) or to stack materials on the same sublayer (a `polygon` fill layer plus a `polyline` outline layer over `sourceLayers: ["buildings"]`). Each tile is fetched and decoded once no matter how many layers match; every matching layer gets its own features, batch-id space and `layer.update()`/`delete()` handle. Layers with no `sourceLayers` match every MVT sublayer. Stacking a wider symbol under a narrower one (an outline) is the common use: add the wider layer first, since render order is add order. Two stacked **point** layers need `declutter: false` on both — screen-space decluttering is on by default, so the sprites at identical positions suppress each other and the underlay silently vanishes. Non-clamped stacked polylines also need a small `height` difference or they z-fight.
- **Sources are reference-counted:** `source.delete()` returns `false` while any layer still references it. Updating a source resets and reloads every referencing layer.
- **Inline GeoJSON `data` does not reload via `source.update()`** (verified 2026-08: readouts driven from the same code ran, but the rendered features never changed; URL-based sources do reload). Re-pointing the existing layer at a fresh source also failed to render. The working pattern for dynamic inline data is rebuild both: `layer.delete(); source.delete(); source = view.addSource({ type: "geojson", data }); layer = view.addLayer({...})`. For measurement-style dynamic overlays (a handful of markers + a line), mesh descs are the simpler tool: add/delete `SphereMeshDesc` markers and a `TubeMeshDesc` arc via handles — see `example/pages/examples/api/measure-geodesic`.
- **Labels and sprites face the camera unless you opt out, and each feature can differ.** Three options on `text` / `billboard` / `point`. The facing option (`textFacing` / `billboardFacing` / `pointFacing`) picks the plane: `"upright"` (default) stands the quad up, `"flat"` lays it in the globe's tangent plane at the anchor so it reads as painted on the surface. `rotateWithCamera` (default `true`) picks whether it follows the camera: `true` keeps it facing the viewer (a screen-aligned billboard, or for `"flat"` a yaw that keeps text reading left-to-right), `false` freezes it in the anchor's east-north-up frame. `rotation` (degrees, clockwise from the front, default `0`) then spins it inside that plane about its **anchor** — `center` picks where inside the quad the pivot sits. **All three are also per-feature** from a feature evaluator, returned as `facing` / `rotateWithCamera` / `rotation`, so one batch can hold labels at eight different bearings in a single draw call. **A per-feature value persists until overwritten** — an evaluator that stops returning one leaves the last value in place, so return the material value explicitly to hand the feature back (changing the material reclaims them too, but only when its value actually changes). Gotchas: `upright` + `rotateWithCamera: false` is a real signboard — invisible edge-on from directly above and mirrored from behind (its face points south, so a north-looking camera reads it); for `"flat"` keep `offsetDepth: true` (the default) or the label z-fights the surface it lies on; and declutter always measures a screen-aligned box, so it over-estimates a flat or edge-on quad's footprint (hides slightly more than needed, never less).
- **Non-draped vector polylines are lit; draped ones are unlit.** `clampToGround: false` polylines render through a lit shader (`material.lights = !isTexturized`), so with zero lights they draw **black** — invisible on a dark basemap and a classic "the line is missing" trap. Draped (`clampToGround: true`) lines bake into tile textures and ignore lights. Fix: add `view.addLight({ ambient: { intensity: 1 } })` (needs DefaultPlugin) to show the line at its plain color.
- **Polyline `width` is screen px, but clamped by `maxWidth` in world meters (default 1000).** From a whole-globe camera 1 px ≈ 11 km, so the default clamp makes any line sub-pixel — pass `maxWidth` (e.g. `100_000`) for high-altitude views. Draped polylines additionally vanish entirely at globe-scale zoom (bake resolution) regardless of `maxWidth` (verified at camera height ≈ 9,000 km; they render fine at ≈ 2,000 km) — use non-draped lines for global arcs.
- **WASM-backed math throws before `view.init()`.** `degreeToRadian`, `EllipsoidGeodesic`, `geodeticToVector3`, … call into `navara_wasm_api`, which `view.init()` initializes — a module-top-level call fails with e.g. "Cannot read properties of undefined (reading 'angleToRadian')". Plain lat/lng/height constants are fine at module top level (they're just degree numbers); call the WASM-backed functions on them only after init.
- **Layer render order = add order** (e.g. add terrain before the raster basemap draped on it).
- **`elevationHeatmap`: omitting `logBoundary` breaks software-GL backends.** `Math.log(mat.logBoundary)` (navara_three `mesh/tile/index.ts`) turns the missing value into a NaN uniform, and the branch-free ternary in `elevation_pars_fragment.glsl` evaluates the log path even with `logarithmic` false. ANGLE Metal flushes the NaN (renders fine); SwiftShader — i.e. headless Playwright, the screenshot pipeline, CI — propagates it and every pixel renders one constant color (verified 2026-07 on both backends with identical code). Until the engine guards that computation, pass `logBoundary` explicitly when headless captures matter. The material itself is unlit and needs no terrain layer or lights; `globe.elevationColormap` supplies the colors.
- **Deferred lighting recipe:** set `view.lit = false` so materials output albedo while the lit pipeline keeps writing normals and the shadow buffer, then re-light in a late post pass from `getNormalTexture()` + `getShadowTexture()`. A per-mesh/material `lit: true` opts something out, and the shadow buffer's G channel is the per-pixel mask for it — transparent unlit materials cannot be masked this way (they are already blended into the albedo). Toggling `lit` recompiles, so it is a config switch, not a per-frame control. Worked effect: `example/pages/debug/buffers/run.ts`; option semantics: docs `three/api/threeview-properties#lit`.
- **`aerialPerspective.irradiance: true` IS a deferred lighting pass — always pair it with `view.lit = false`.** It sets `sunLight`/`skyLight` on the `AerialPerspectiveEffect`, which re-lights the G-buffer from the precomputed atmosphere using the normal buffer. With `view.lit` left at its default `true` the scene is lit twice (forward + atmosphere) and washes out, which is what forces the unnaturally high exposures (10+) seen in older snippets; unlit + irradiance sits around 3. Verified 2026-08: the deferred pass does **not** consume the shadow G-buffer, so `sun.castShadow` cascaded shadows vanish under `lit = false` (cloud shadows survive — the effect samples those from `atmosphere.shadow`). Close-up scenes that need cast shadows or transparency keep `irradiance: false` and the default `lit`.
- **`SnowMeshDesc` / `RainMeshDesc` `maxHeight` is an opacity fade, not a spawn ceiling.** Every frame the material opacity is multiplied by `max(1 - cameraHeight / maxHeight, 0)`, so with the default `maxHeight: 3000` a camera at or above 3 km renders *zero* visible snow while everything still runs — a silent empty screenshot. Particles also spawn in an `areaWidth` x `areaHeight` box around the camera and `size` is world-space (`sizeAttenuation`), so flakes only read at their nominal size when the camera is inside the weather, not looking at it from above.
- **`sun.shadowFar` defaults to 50 km**, spreading the 4 cascades so wide that person- or car-scale shadows never resolve. For character/street-level scenes use `shadowFar: ~1000` with `shadowLambda: 1` (fully logarithmic split) — that is what makes a walking character cast a visible shadow (`example/pages/examples/plugin/person-view`).
- **Never reconstruct a G-buffer normal with `xy * 2 - 1`** — it is octahedral; decode with `unpackVec2ToNormal` from `NORMAL_PACKING_SHADER`. The wrong reconstruction looks plausible and costs a long debugging session. Known inconsistency to watch for: `instancedSprite.frag.glsl` / `sdfText.frag.glsl` define a LOCAL `xy*0.5+0.5` packer that does not match.
- **Allocating any optional G-buffer silently re-routes meshes into the MRT pass** (so their own normal/shadow/mask is written instead of the terrain's showing through). Expect the first `addEffect` that needs a buffer to recompile and to shift where meshes render. Self-shadow acne (striping) on large mesh faces in the shadow buffer is tamed with `sun: { shadowNormalBias: ~3 }`.
- **A custom effect should inherit scene config, not re-declare it** — `ctx.findLight("sun")` / `findEffect` / `findMesh` resolve active descs by registered key, so a lighting effect reads the sun's real intensity and `view.atmosphere.sunDirection` instead of growing its own options.
- **Toggling terrain on/off: delete/re-add the layer.** `terrainLayer.update({ terrain: { show: false } })` has no visible effect (verified 2026-07); `layer.delete()` drops the surface to the flat ellipsoid and draped raster layers re-drape automatically.
- **Handle events vs desc events:** mesh/light/effect handles (`BaseHandle`) only emit `deleted` — desc-specific events (`load` / `error` / `animationReady` on GLTF, instanced-GLTF and splat descs) live on the desc, so subscribe via `handle.ref.on("load", ...)`.
- **Camera events: listen to `move`, not `movestart`.** User interaction and the camera movement methods emit events, but instantaneous ones (`setCamera`, `lookAt`, `rotateAroundAxis`, `flyTo` with `duration: 0`) finish inside one frame and emit only `move` + `moveend` — no `movestart`, since there is no movement to open. Continuous movement (gestures, their inertia, an animated `flyTo`) emits the full `movestart` -> `move`... -> `moveend`. Each event fires at most once per frame, but an instantaneous change emits `move` and `moveend` in the *same* frame, so a handler bound to both runs twice for one `setCamera` — keep it idempotent. **Follow mode emits nothing:** while `cameraFollow`/`cameraFreeLook` is active the camera is repositioned every frame with no status pushed, so poll `positionGeographic` on `preRender` instead of listening for `move`.
- **Never write to `view.camera.raw` frustum fields** (`fov` etc.) — the engine overwrites them and Rust-side culling desyncs. Use the `view.camera.fov/near/far` setters.
- **Units:** every public lat/lng API takes **degrees** — `setCamera`/`flyTo`, `geodetic`, terrain sampling, `geodeticToVector3`/`vector3ToGeodetic`, `EllipsoidGeodesic` (headings in degrees too). Mesh `position` is ECEF meters. Three.js-level angles stay **radians** (Euler `rotation` fields, `rotateAroundAxis`/`rotateAround` — that's what `degreeToRadian` is still for); batch IDs are 24-bit.
- **Ground placement needs `sampleTerrainMostDetailed`:** the synchronous `sampleTerrainHeight` reads only render-resident tiles, so from a distant camera it returns a coarse-LOD height (tens of meters off) — `await view.sampleTerrainMostDetailed(source, positions)` (source = the registered terrain source's handle or id, always explicit) fetches the source's max-LOD tiles regardless of the camera.  See [references/imperative-api.md](references/imperative-api.md).
- **Placing a mesh geographically:** use `geodetic` — `{ lng, lat, height, heading, pitch, roll, scale }` in **degrees** and metres, the same convention as `setCamera`. It builds a West-Up-North (Y-up, +Z north) frame, which matches glTF's front=+Z / up=+Y convention, so an unmodified glTF asset needs **no** `Rx(+90°)` up-axis correction. `heading` is the compass bearing the asset's front faces, and `pitch`/`roll` also cover in-frame flips — a Y-down splat capture is upright with `pitch: 180` instead of a separate `rotation` offset. Add `heightReference: "terrain"` to make `height` relative to terrain (a live subscription that re-clamps as tiles stream — for a one-shot placement, `sampleTerrainMostDetailed` is cheaper). `position`/`rotation`/`scale` stay available as offsets *inside* the frame, and `geodetic`, `matrix` and `matrixWorld` share one placement slot — setting any two of them throws `ConflictingTransformError`.
- **Low-level placement:** raw `position`/`rotation`/`scale` are earth-centered ECEF metres, so a bare `position` won't sit upright at a lng/lat. Set `matrixWorld` to a tangent-frame matrix when you need a frame `geodetic` doesn't build — `eastNorthUpToFixedFrame` (ENU, Z-up), `northEastDownToFixedFrame` (NED), `northUpEastToFixedFrame` (NUE, Y-up but +X north), `northWestUpToFixedFrame` (NWU), `westUpNorthToFixedFrame` (WUN, what `geodetic` uses). All are exported from `@navaramap/three`. Note the Z-up frames need an `Rx(+90°)` correction for glTF assets; WUN does not. See [references/imperative-api.md](references/imperative-api.md).
- **Init-only options** cannot change after `init()`: `shadow`, `maxSse`, `segments`, `useNormal`.
- **Optional G-buffers: declare, never assume.** They exist only while an active effect lists them in `static requiredBuffers`, so read them through the `ViewContext`/`MRTPassEffectDesc` getters (`undefined` when disabled) and **re-fetch every frame** — a config change rebuilds the attachments. Never hardcode an attachment index; they are packed and shift. Switching the set reallocates attachments and recompiles shaders, so add an effect once and tune via `handle.update()` rather than add/remove per frame. Only MRT-pass fragments write the G-buffer at all — a mesh sitting in the opaque/transparent scene contributes nothing to it.
- **Effect compatibility:** `hideUnderground: false` and `logarithmicDepthBuffer` break some effect descriptors — test, and prefer defaults.
- `picking: true` (constructor, default on) is required for the `featureClick` (click or touch tap) and `featureHover`/`featureEnter`/`featureLeave` (pointermove) events and pickable meshes. Hover picking activates only while a hover-family listener is registered.
- **API stability tiers:** `ThreeView` = Tier 0 (stable). `Plugin` + `ViewContext` = Tier 1 (may break between minor versions). Keep app code on Tier 0 where possible.
- **Runtime assets (atmosphere/cloud/noise/water) bundle automatically** — each file is referenced via a static `new URL(..., import.meta.url)`, so Vite/webpack emit them into the app build; no copying or config needed. To self-host instead, pass `atmosphereAssetsUrl` (Atmosphere) / `assetsUrl` (Clouds) pointing at a directory that keeps the **original filenames** (`transmittance.exr`, `local_weather.png`, …); both default to `undefined` = bundled assets. There are no directory URL constants (appending filenames to a directory can't survive bundler hashing) — only per-file constants exist (`ATMOSPHERE_TRANSMITTANCE_URL`, `CLOUD_LOCAL_WEATHER_URL`, `STBN_URL`, `WATER_NORMAL_URL`, `STARS_ASSETS_URL`, …).

## Lighting — when it's needed and which light to add

Lighting only affects surfaces that carry **normals**. Anything without normals is shaded uniformly (fullbright) and needs no light. But once normals are present, **no light means the surface renders black**. Add at least one light when you have:

- meshes / GLTF models that ship vertex normals
- `quantized-mesh` terrain loaded with `requestVertexNormals: true`
- `raster-dem` terrain rendered with a `hillshade` material
- the bare globe when the view was constructed with `useNormal: true` (init-only) — needed for the sun to shade the globe when no terrain or hillshade layer supplies normals

Built-in lights — register via `DefaultPlugin`, then `view.addLight<T>({ ... })`:

| Descriptor          | Key             | Use                                                                                          |
| ------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `AmbientLightDesc`  | `ambient`       | flat fill — raise overall brightness or light everything uniformly; no direction, no shadows |
| `LightProbeDesc`    | `lightProbe`    | pseudo-IBL from spherical-harmonics coefficients (e.g. a baked night ambient)                |
| `SkyLightProbeDesc` | `skyLightProbe` | dynamic sky ambient that follows the sun through the atmosphere system                       |
| `SunLightDesc`      | `sun`           | directional sun; its direction is derived from `atmosphere.date`, and it casts CSM shadows   |

`addDefaultPhotorealScene()` already adds a `sun` + `skyLightProbe` — start there for realistic scenes and add `ambient`/`lightProbe` to taste.

A `sun` light also works standalone, without `addDefaultPhotorealScene()`: its direction still follows `atmosphere.date`, and its color is computed from the atmosphere transmittance texture, which loads on demand (verified 2026-08 shading quantized-mesh terrain with only `view.addLight({ sun: {} })`). Note `view.toneMappingExposure` has no visible effect in such a scene — tone mapping is inactive without the photoreal effect stack, so don't reach for exposure to fix brightness there; use the light's `intensity`.

**`atmosphere.date` is local-time-sensitive.** It's a plain JS `Date`, so `new Date("2024-06-21T12:00:00")` is read in the _device's_ timezone — the sun lands in a different place per machine. Pin a global instant with an explicit UTC string (`new Date("2024-06-21T12:00:00Z")`). To hold the same time-of-day or sun elevation while flying the camera to another country, don't recompute by hand — use `view.atmosphere.setDateFromCameraAt({ lng })` (keeps local solar time) or `setElevationFromCameraAt({ lat, lng })` (keeps sun elevation).

## Where to verify — never guess API details

**Primary reference: the docs site — https://navara.world/docs/** (Japanese under `/ja/`). Sections: `/three/` (core API: sources, layers, materials, camera, events), `/three_default_descs/` (every built-in mesh/effect/light Descriptor and its options), `/three_default_plugin/`, `/three_plugins/`.

- **Do not guess material or config property names** — this skill shows patterns, not exhaustive option lists. Verify exact fields against the docs site, or the TypeScript definitions in `node_modules/@navaramap/*` (`.d.ts`).
- Working inside the Navara repository? The docs source is `docs/src/content/docs/` and runnable examples are `web/navara_three/example/pages/` — reference paths in this skill starting with `example/pages/` refer to that examples directory.
