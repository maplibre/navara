# Imperative API — Feature evaluation, picking, geodetic math

Use these when declarative layer config isn't enough: data-driven styling per feature, spatial queries, or custom geometry placement.

## FeatureEvaluator — data-driven styling

Obtained from layer `featureCreated`/`featureUpdated` events. `evaluate()` runs per batch and returns only the properties you want to override (all optional: `color`, `show`, `height`, `extrudedHeight`, `text`, `width`, `size`, `opacity`, `declutterPriority`):

```typescript
import { Color } from "@navaramap/three";

const updatedFeatures = new Set<bigint>();
layer.on("featureUpdated", ({ evaluator }) => {
  if (updatedFeatures.has(evaluator.id)) return;   // evaluator.id is a bigint
  updatedFeatures.add(evaluator.id);
  evaluator.evaluate(
    ({ properties }) => ({
      extrudedHeight: (properties?.["height"] as number) ?? 0,
      color: new Color().setStyle((properties?.["color"] as string) ?? "#ffffff"),
      show: ((properties?.["height"] as number) ?? 0) >= 30,
    }),
    { filters: ["height", "color"] },   // read only these attributes — important for perf on large data
  );
});
```

- Prefer `filters` (or `readFilteredFeatureProperties`) over reading all properties on large datasets.
- **Return a consistent shape:** once the callback styles an attribute for any feature, style it for every feature. Features you skip fall back to a fixed default, not the material value: `opacity` 1, `color` white, `emissive` off, `height`/`extrudedHeight` 0 (only `size` and `width` fall back to the material). E.g. styling `opacity` (or `show`) for some features renders the unstyled ones fully opaque regardless of the material's `opacity`.
- `readFeatureProperties(cb)` reads attributes without styling (e.g. build a legend).
- **Label decluttering:** `text`/`point`/`billboard` materials declutter by default (`declutter: true`) — screen-overlapping labels hide the lower-priority one (with a fade). Set `declutter: false` on the material to draw every label unconditionally. Placement priority: layer-level `declutterPriority` on the material, overridable per feature by returning `declutterPriority` from `evaluate()` — higher wins; among equal priorities currently-shown labels are sticky (hysteresis), then ties resolve deterministically by anchor position. The placement math itself is a Rust kernel (`declutterPlace` in `navara_wasm_api`); the TS `DeclutterManager` only orchestrates. Reference: `example/pages/styling/mvt-text`.
- To restyle interactively (click-to-highlight), change your evaluation state and call `layer.forceUpdate()`.
- Full API: https://navara.world/docs/three/api/feature-evaluator/ — runnable references in the Navara repo: `example/pages/styling/*` (one per geometry × source type).

## Picking & spatial queries

```typescript
view.on("featureClick", (info) => info?.properties?.["gml:name"]);   // requires picking: true (default)
view.on("featureHover", (info) => { ... });   // fires when the hovered feature changes; null = nothing hovered
view.on("featureEnter", (info) => { ... });   // enter/leave pair synthesized by diffing hover picks
view.on("featureLeave", (info) => { ... });   // receives the feature that was left
const ecef = view.pickTerrainPosition(x, y);                  // terrain only
const ecef2 = view.pickDepthPosition(x, y);                   // anything in the depth buffer
const h = view.sampleTerrainHeight({ lat, lng });             // degrees in
const unobserve = view.observeTerrainHeightAt({ lat, lng }, (height) => { ... });
const [g] = await view.sampleTerrainMostDetailed(terrainSource, [{ lat, lng }]); // fetches max-LOD tiles; g.height / g.level
```

**Which terrain-height API:** `sampleTerrainHeight` reads only tiles already resident for rendering — from a distant camera it returns a coarse-LOD height (e.g. ~77 m off at z≈6) or `undefined`, and `observeTerrainHeightAt` fires only while tiles are (re)meshing (never on a static camera). For placing objects on the ground, use `await view.sampleTerrainMostDetailed(source, positions)` where `source` is the registered terrain source's handle or id (always explicit — there is no implicit "the view's terrain source"): it fetches the source's most detailed tiles over the network, independent of the camera. `height` is `undefined` on fetch failure; 401/403 rejects (bad token).

**Picking is lazy and throttled:** the GPU pick runs only while someone listens for the result — the click/tap pick needs a `featureClick` listener, the hover pick at least one of `featureHover`/`featureEnter`/`featureLeave` (at most one hover pick per frame, suppressed while a button or finger is down — so touch never hover-picks). The pick searches a window around the pointer and takes the nearest non-zero hit (exported `PICK_RADIUS` = 3 CSS px, `TOUCH_PICK_RADIUS` = 10), so small points and thin lines don't need pixel-perfect aim. Each hover pick forces a main re-render to restore draped vector atlases, so it costs more on scenes heavy with clamped-to-ground vectors. `featureHover` fires only on change (feature-level, unlike MapLibre's layer-level enter/leave). For cursor styling use `view.canvas.style.cursor`. Runnable reference: `example/pages/debug/picking-layers`.

Raw view input is a single `pointer*` family — `pointerdown`/`pointerenter`/`pointerleave`/`pointermove`/`pointerup` deliver `MapPointerEvent` for **every input type** (`event.pointerType` tells mouse/touch/pen apart; `pointercancel` delivers a plain `PointerEvent`). There are **no `mouse*` view events** — `view.on("mousemove")` silently never fires. `click` is a gesture: a primary-pointer press and release within the exported `CLICK_PIXEL_TOLERANCE`/`TAP_PIXEL_TOLERANCE`, so camera drags never fire it and no drag guard is needed. Map events deliver `.clientX/Y` and `.map` (ECEF coords). The `idle` event fires after `idleThreshold` ms without tile/data activity. `.map` does not follow the rendered terrain surface — from a tilted camera, clicks on ridgelines/slopes land wrong or not at all; for click-to-place on terrain use `view.pickTerrainPosition(event.clientX, event.clientY)` (returns `null` past the globe) and `vector3ToGeodetic` the result.

## Geodetic / ECEF math (exported from `@navaramap/three`; standalone in `@navaramap/three-api`)

Positions in the scene are **ECEF meters**. Geodetic helpers take lat/lng in **degrees** (like every public lat/lng API).

```typescript
import {
  geodeticToVector3, vector3ToGeodetic,
  eastNorthUpToFixedFrame, geodeticSurfaceNormal,
  getPickRay, getPlaneFromPointNormal, getRayPlaneIntersection,
  convertWorldToScreen, EllipsoidGeodesic,
} from "@navaramap/three";

// position is Cartesian ECEF by default — a bare position won't stand upright at a
// lng/lat. Build a tangent frame at the origin and pass it as matrixWorld; then
// position/rotation/scale are offsets WITHIN that frame, in meters:
const origin = geodeticToVector3({
  lat: 35.681236,
  lng: 139.767125,
  height: 0,
});
const enuFrame = eastNorthUpToFixedFrame(origin);
view.addMesh<BoxMeshDesc>({
  box: { width: 50, height: 100, depth: 50 },
  matrixWorld: enuFrame,
  position: { x: 200, y: 50, z: 0 },   // offsets WITHIN the ENU frame, in meters
});

// Geodesic distance / interpolation on the ellipsoid:
const geodesic = new EllipsoidGeodesic(startLLE, endLLE);
geodesic.distance; geodesic.interpolatePoints(64);
```

Type note: `getPickRay` returns and `getRayPlaneIntersection` accepts the **Three.js** `Ray` (`import { type Ray } from "three"`), not the `Ray` type re-exported from `@navaramap/three` (a WASM-shaped type with `getPoint`) — annotating with the wrong one type-checks the other way around and fails.

Pick the tangent-frame function by the axis orientation your mesh expects — all take an ECEF origin `Vector3` and return a `Matrix4`, all exported from `@navaramap/three`:

| Function | Local axes (x, y, z) |
|---|---|
| `eastNorthUpToFixedFrame` | East, North, Up |
| `northEastDownToFixedFrame` | North, East, Down |
| `northUpEastToFixedFrame` | North, Up, East |
| `northWestUpToFixedFrame` | North, West, Up |

Mesh transform modes: standard `position`/`rotation`/`scale` (Cartesian ECEF — the default), `matrix` (local frame), `matrixWorld` (world frame — the usual choice for geographic placement, as above). `matrix`, `matrixWorld` and `geodetic` are mutually exclusive (`ConflictingTransformError`); `position`/`rotation`/`scale` become offsets inside whichever frame is set.

Full math API reference: https://navara.world/docs/three/api/navara_three_api — the most complete runnable reference for picking + geometry math is `example/pages/debug/mesh-picking/main.ts` in the Navara repo.
