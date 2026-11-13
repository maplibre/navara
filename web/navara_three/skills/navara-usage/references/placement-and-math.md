# Placement and geodetic math

Putting meshes and models at a geographic position, sampling terrain height, and the geodetic/ECEF helpers. Units (degrees vs radians, ECEF meters): [SKILL.md](../SKILL.md).

- **WASM-backed math throws before `view.init()`.** `degreeToRadian`, `EllipsoidGeodesic`, `geodeticToVector3`, … call into `navara_wasm_api`, which `view.init()` initializes — a module-top-level call fails with e.g. "Cannot read properties of undefined (reading 'angleToRadian')". Plain lat/lng/height constants are fine at module top level (they're just degree numbers); call the WASM-backed functions on them only after init.

## Placing a mesh at a lng/lat

- **Placing a mesh geographically:** use `geodetic` — `{ lng, lat, height, heading, pitch, roll, scale }` in **degrees** and metres, the same convention as `setCamera`:

  ```typescript
  import type { GLTFModelDesc } from "@navaramap/three-default-descs";

  view.addMesh<GLTFModelDesc>({
    gltfModel: { url: "/models/car/scene.gltf" }, // key registered by DefaultPlugin
    geodetic: {
      lng: 139.767,
      lat: 35.681,
      height: 0, // metres above the ellipsoid, or above terrain with heightReference
      heading: 90, // degrees clockwise from north that the model's front (+Z) faces
      heightReference: "terrain", // default "ellipsoid"
    },
  });
  ```

  It builds a West-Up-North (Y-up, +Z north) frame, which matches glTF's front=+Z / up=+Y convention, so an unmodified glTF asset needs **no** `Rx(+90°)` up-axis correction. `heading` is the compass bearing the asset's front faces, and `pitch`/`roll` also cover in-frame flips — a Y-down splat capture is upright with `pitch: 180` instead of a separate `rotation` offset. `heading` is degrees clockwise from north; `pitch` is nose-up positive, `roll` right-side-down positive. Add `heightReference: "terrain"` to make `height` relative to terrain: a live subscription to the tiles resident for rendering (`sampleTerrainHeight` + `observeTerrainHeightAt`), so the object follows the drawn ground — a coarse-LOD height from a distant camera, re-clamped as tiles stream in, and ellipsoid-relative while no terrain layer exists. For a one-shot placement at full detail, `sampleTerrainMostDetailed` is cheaper. `position`/`rotation`/`scale` stay available as offsets _inside_ the frame, and `geodetic`, `matrix` and `matrixWorld` share one placement slot — setting any two of them throws `ConflictingTransformError`.

- **Low-level placement:** raw `position`/`rotation`/`scale` are earth-centered ECEF metres, so a bare `position` won't sit upright at a lng/lat. Set `matrixWorld` to a tangent-frame matrix when you need a frame `geodetic` doesn't build — `eastNorthUpToFixedFrame` (ENU, Z-up), `northEastDownToFixedFrame` (NED), `northUpEastToFixedFrame` (NUE, Y-up but +X north), `northWestUpToFixedFrame` (NWU), `westUpNorthToFixedFrame` (WUN, what `geodetic` uses). All are exported from `@navaramap/three`. Note the Z-up frames need an `Rx(+90°)` correction for glTF assets; WUN does not.

## Terrain height (ground placement)

```typescript
const h = view.sampleTerrainHeight({ lat, lng });             // degrees in
const unobserve = view.observeTerrainHeightAt({ lat, lng }, (height) => { ... });
const stop = view.observeTerrainHeightRange(extent, ({ min, max }) => { ... }); // min/max ground height over an extent (degrees); fires as overlapping tiles load
const [g] = await view.sampleTerrainMostDetailed(terrainSource, [{ lat, lng }]); // fetches max-LOD tiles; g.height / g.level
```

**Which terrain-height API:** `sampleTerrainHeight` reads only tiles already resident for rendering — from a distant camera it returns a coarse-LOD height (e.g. ~77 m off at z≈6) or `undefined`, and `observeTerrainHeightAt` fires only while tiles are (re)meshing (never on a static camera). For placing objects on the ground, use `await view.sampleTerrainMostDetailed(source, positions)` where `source` is the registered terrain source's handle or id (always explicit — there is no implicit "the view's terrain source"): it fetches the source's most detailed tiles over the network, independent of the camera. `height` is `undefined` on fetch failure; 401/403 rejects (bad token).

- **Terrain sampling returns the exaggerated surface.** With the terrain layer's `terrain: { exaggeration, exaggerationRelativeHeight }` (runtime-changeable via `layer.update()`, reset when the terrain layer is deleted), `sampleTerrainHeight`, `observeTerrainHeightAt` and `sampleTerrainMostDetailed` all return `(h - r) * e + r`, so placements on those heights land on the drawn ground. Do not multiply them again. For the source elevation invert it (`(h' - r) / e + r`, `e > 0`). 3D Tiles and glTF models are not stretched.

## Geodetic / ECEF math (exported from `@navaramap/three`; standalone in `@navaramap/three-api`)

Positions in the scene are **ECEF meters**. Geodetic helpers take lat/lng in **degrees** (like every public lat/lng API).

```typescript
import {
  geodeticToVector3,
  vector3ToGeodetic,
  eastNorthUpToFixedFrame,
  geodeticSurfaceNormal,
  getPickRay,
  getPlaneFromPointNormal,
  getRayPlaneIntersection,
  convertWorldToScreen,
  EllipsoidGeodesic,
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
  position: { x: 200, y: 50, z: 0 }, // offsets WITHIN the ENU frame, in meters
});

// Geodesic distance / interpolation on the ellipsoid:
const geodesic = new EllipsoidGeodesic(startLLE, endLLE);
geodesic.distance;
geodesic.interpolatePoints(64);
```

Type note: `getPickRay` returns and `getRayPlaneIntersection` accepts the **Three.js** `Ray` (`import { type Ray } from "three"`), not the `Ray` type re-exported from `@navaramap/three` (a WASM-shaped type with `getPoint`) — annotating with the wrong one type-checks the other way around and fails.

Pick the tangent-frame function by the axis orientation your mesh expects — all take an ECEF origin `Vector3` and return a `Matrix4`, all exported from `@navaramap/three`:

| Function                    | Local axes (x, y, z) |
| --------------------------- | -------------------- |
| `eastNorthUpToFixedFrame`   | East, North, Up      |
| `northEastDownToFixedFrame` | North, East, Down    |
| `northUpEastToFixedFrame`   | North, Up, East      |
| `northWestUpToFixedFrame`   | North, West, Up      |
| `westUpNorthToFixedFrame`   | West, Up, North      |

`headingPitchRollToFixedFrame({ lng, lat, height, heading, pitch, roll, scale })` (degrees) returns the same matrix `geodetic` builds (WUN + heading/pitch/roll/scale), for code that needs the matrix itself.

Mesh transform modes: standard `position`/`rotation`/`scale` (Cartesian ECEF — the default), `geodetic` (lng/lat frame — the usual choice for geographic placement), `matrix` (local frame), `matrixWorld` (world frame — a tangent-frame matrix built by hand, as in the sample above). `matrix`, `matrixWorld` and `geodetic` are mutually exclusive (`ConflictingTransformError`); `position`/`rotation`/`scale` become offsets inside whichever frame is set.

Full math API reference: https://navara.world/docs/three/api/navara_three_api — the most complete runnable reference for picking + geometry math is `example/pages/debug/mesh-picking/main.ts` in the Navara repo.
