---
title: navara_three_api
description: navara_three API reference for Three.js integration utilities
sidebar:
  order: 900
---

navara_three_api is an API that provides utility functions for integrating Three.js with the Navara engine. It offers features necessary for 3D geospatial application development, including geospatial calculations, coordinate transformations, intersection tests, and RTE (Relative to Eye) rendering, all integrated with the Three.js type system.

## Initialization

### initNavaraApi()

Initializes the Navara API. You must call this function before using any other API functions.

**Syntax:**

```typescript
async function initNavaraApi(): Promise<void>;
```

:::note
If you are using `navara_three`, you do not need to call this function.
:::

**Returns:**

A Promise that resolves when initialization is complete

**Example:**

```typescript
import { initNavaraApi } from "@navaramap/three-api";

// Initialize at application startup
await initNavaraApi();
```

## Ellipsoid Functions

Functions for retrieving basic parameters of the WGS84 ellipsoid.

### getWGS84SemiMajorAxis()

Gets the semi-major axis of the WGS84 ellipsoid.

**Syntax:**

```typescript
function getWGS84SemiMajorAxis(): number;
```

**Returns:**

The semi-major axis of the WGS84 ellipsoid (meters)

**Example:**

```typescript
const semiMajorAxis = getWGS84SemiMajorAxis();
console.log(`Semi-major axis: ${semiMajorAxis} m`); // Semi-major axis: 6378137 m
```

### getWGS84SemiMinorAxis()

Gets the semi-minor axis of the WGS84 ellipsoid.

**Syntax:**

```typescript
function getWGS84SemiMinorAxis(): number;
```

**Returns:**

The semi-minor axis of the WGS84 ellipsoid (meters)

**Example:**

```typescript
const semiMinorAxis = getWGS84SemiMinorAxis();
console.log(`Semi-minor axis: ${semiMinorAxis} m`); // Semi-minor axis: 6356752.314245 m
```

### getWGS84EccentricitySquared()

Gets the eccentricity squared of the WGS84 ellipsoid.

**Syntax:**

```typescript
function getWGS84EccentricitySquared(): number;
```

**Returns:**

The eccentricity squared of the WGS84 ellipsoid

### getWGS84Flattening()

Gets the flattening of the WGS84 ellipsoid.

**Syntax:**

```typescript
function getWGS84Flattening(): number;
```

**Returns:**

The flattening of the WGS84 ellipsoid

### getWGS84Eccentricity()

Gets the eccentricity of the WGS84 ellipsoid.

**Syntax:**

```typescript
function getWGS84Eccentricity(): number;
```

**Returns:**

The eccentricity of the WGS84 ellipsoid

## Coordinate Transformation

Functions for transforming between coordinate systems. Integrated with the Three.js Vector3 type.

### geodeticToVector3(lle)

Converts geodetic coordinates (latitude, longitude, height) to a Three.js Vector3 (ECEF coordinate system).

**Syntax:**

```typescript
function geodeticToVector3(lle: LatLngHeight): Vector3;
```

**Parameters:**

- `lle`: The geodetic coordinates to convert
  - `lat`: Latitude (degrees)
  - `lng`: Longitude (degrees)
  - `height`: Height (meters)

**Returns:**

Position in the ECEF coordinate system (Three.js Vector3)

**Example:**

```typescript
import { geodeticToVector3 } from "@navaramap/three-api";

const lle = {
  lat: 35.6762, // Latitude of Tokyo
  lng: 139.6503, // Longitude of Tokyo
  height: 100,
};
const position = geodeticToVector3(lle);
console.log(`Position: [${position.x}, ${position.y}, ${position.z}]`);
```

### vector3ToGeodetic(xyz)

Converts a Three.js Vector3 (ECEF coordinate system) to geodetic coordinates (latitude, longitude, height).

**Syntax:**

```typescript
function vector3ToGeodetic(xyz: Vector3): LatLngHeight;
```

**Parameters:**

- `xyz`: The ECEF coordinates to convert (Three.js Vector3)

**Returns:**

Geodetic coordinates:
- `lat`: Latitude (degrees)
- `lng`: Longitude (degrees)
- `height`: Height (meters)

**Example:**

```typescript
import { vector3ToGeodetic } from "@navaramap/three-api";
import { Vector3 } from "three";

const position = new Vector3(-3946416, 3364068, 3702654);
const lle = vector3ToGeodetic(position);
console.log(`Latitude: ${lle.lat}°`);
console.log(`Longitude: ${lle.lng}°`);
console.log(`Height: ${lle.height} m`);
```

### degreeToRadian(degree)

Converts an angle from degrees to radians. Latitude and longitude in Navara APIs are already in degrees, so this helper is only needed for radian-based math such as Three.js Euler `rotation` fields.

**Syntax:**

```typescript
function degreeToRadian(degree: number): number;
```

**Parameters:**

- `degree`: Angle in degrees

**Returns:**

Angle in radians

**Example:**

```typescript
const radians = degreeToRadian(90);
console.log(`90 degrees = ${radians} radians`); // 90 degrees = 1.5708 radians
```

### radianToDegree(radian)

Converts an angle from radians to degrees.

**Syntax:**

```typescript
function radianToDegree(radian: number): number;
```

**Parameters:**

- `radian`: Angle in radians

**Returns:**

Angle in degrees

**Example:**

```typescript
const degrees = radianToDegree(Math.PI);
console.log(`π radians = ${degrees} degrees`); // π radians = 180 degrees
```

## Screen-World Projection

Functions for transforming between screen coordinates and world coordinates. Integrated with the Three.js PerspectiveCamera.

### convertScreenToWorld(window, camera, vec2)

Converts screen coordinates to world coordinates.

**Syntax:**

```typescript
function convertScreenToWorld(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  vec2: Vector2
): Vector3 | undefined;
```

**Parameters:**

- `windowObject`: Window information
  - `width`: Window width
  - `height`: Window height
  - `pixelRatio`: Device pixel ratio
- `camera`: Three.js PerspectiveCamera
- `vec2`: Screen coordinates (Three.js Vector2)

**Returns:**

Position in world coordinates, or undefined if no intersection

**Example:**

```typescript
import { convertScreenToWorld } from "@navaramap/three-api";
import { Vector2 } from "three";

// Create window information object
const windowObject = {
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  pixelRatio: window.devicePixelRatio
};

const screenPos = new Vector2(event.clientX, event.clientY);

const worldPos = convertScreenToWorld(windowObject, camera, screenPos);
if (worldPos) {
  console.log(`World coordinates: [${worldPos.x}, ${worldPos.y}, ${worldPos.z}]`);
}
```

### convertWorldToScreen(window, camera, worldPos)

Converts world coordinates to screen coordinates.

**Syntax:**

```typescript
function convertWorldToScreen(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  worldPos: Vector3
): Vector2 | undefined;
```

**Parameters:**

- `windowObject`: Window information
- `camera`: Three.js PerspectiveCamera
- `worldPos`: Position in world coordinates (Three.js Vector3)

**Returns:**

Screen coordinates, or undefined if outside the field of view

**Example:**

```typescript
import { convertWorldToScreen, geodeticToVector3 } from "@navaramap/three-api";

const lle = { lat: 35.6812, lng: 139.7671, height: 100 };
const worldPos = geodeticToVector3(lle);

const screenPos = convertWorldToScreen(window, camera, worldPos);
if (screenPos) {
  console.log(`Screen coordinates: [${screenPos.x}, ${screenPos.y}]`);
}
```

## Intersection and Ray Casting

Functions for intersection tests and ray casting.

### getPlaneFromPointNormal(point, normal)

Creates a plane from a point and a normal vector.

**Syntax:**

```typescript
function getPlaneFromPointNormal(point: Vector3, normal: Vector3): Plane;
```

**Parameters:**

- `point`: A point on the plane (Three.js Vector3)
- `normal`: The plane's normal vector (Three.js Vector3)

**Returns:**

The created plane

**Example:**

```typescript
import { getPlaneFromPointNormal } from "@navaramap/three-api";
import { Vector3 } from "three";

const point = new Vector3(0, 0, 0);
const normal = new Vector3(0, 0, 1); // Z-axis direction
const plane = getPlaneFromPointNormal(point, normal);
```

### getPickRay(window, camera, vec2)

Generates a picking ray from screen coordinates.

**Syntax:**

```typescript
function getPickRay(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  vec2: Vector2
): Ray;
```

**Parameters:**

- `windowObject`: Window information
- `camera`: Three.js PerspectiveCamera
- `vec2`: Screen coordinates (Three.js Vector2)

**Returns:**

The generated ray

**Example:**

```typescript
import { getPickRay } from "@navaramap/three-api";
import { Vector2 } from "three";

const screenPos = new Vector2(event.clientX, event.clientY);
const ray = getPickRay(window, camera, screenPos);
```

### getRayPlaneIntersection(ray, plane)

Calculates the intersection point of a ray and a plane.

**Syntax:**

```typescript
function getRayPlaneIntersection(ray: Ray, plane: Plane): Vector3 | undefined;
```

**Parameters:**

- `ray`: The ray for intersection testing
- `plane`: The plane for intersection testing

**Returns:**

The intersection point coordinates (Three.js Vector3), or undefined if no intersection

**Example:**

```typescript
import {
  getPickRay,
  getPlaneFromPointNormal,
  getRayPlaneIntersection,
} from "@navaramap/three-api";
import { Vector2, Vector3 } from "three";

// Generate a ray from the mouse position
const screenPos = new Vector2(event.clientX, event.clientY);
const ray = getPickRay(window, camera, screenPos);

// Define the ground plane
const groundPlane = getPlaneFromPointNormal(
  new Vector3(0, 0, 0),
  new Vector3(0, 0, 1)
);

// Calculate the intersection
const intersection = getRayPlaneIntersection(ray, groundPlane);
if (intersection) {
  console.log(
    `Click position: [${intersection.x}, ${intersection.y}, ${intersection.z}]`
  );
}
```

### getHeightFromEllipsoid(point)

Gets the height above the ellipsoid for a given point.

**Syntax:**

```typescript
function getHeightFromEllipsoid(point: Vector3): number;
```

**Parameters:**

- `point`: ECEF coordinates of the point to calculate height for (Three.js Vector3)

**Returns:**

Height above the ellipsoid (meters)

**Example:**

```typescript
import { getHeightFromEllipsoid } from "@navaramap/three-api";
import { Vector3 } from "three";

const position = new Vector3(-3946416, 3364068, 3702654);
const height = getHeightFromEllipsoid(position);
console.log(`Height: ${height} m`);
```

## Surface Normal and Reference Frames

Functions for calculating surface normal vectors and reference frames.

### geodeticSurfaceNormal(lle)

Calculates the geodetic surface normal vector.

**Syntax:**

```typescript
function geodeticSurfaceNormal(lle: LatLngHeight): Vector3;
```

**Parameters:**

- `lle`: Geodetic coordinates

**Returns:**

Normalized surface normal vector (Three.js Vector3)

**Example:**

```typescript
import { geodeticSurfaceNormal } from "@navaramap/three-api";

const lle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};
const normal = geodeticSurfaceNormal(lle);
console.log(`Normal vector: [${normal.x}, ${normal.y}, ${normal.z}]`);
```

### scaleToGeodeticSurface(xyz)

Projects a Cartesian position onto the WGS84 ellipsoid surface along the geodetic normal.

**Syntax:**

```typescript
function scaleToGeodeticSurface(xyz: Vector3): Vector3 | undefined;
```

**Parameters:**

- `xyz`: ECEF coordinates (Three.js Vector3)

**Returns:**

The surface position in ECEF coordinates (Three.js Vector3), or `undefined` when the position is too close to the ellipsoid's center to project

**Example:**

```typescript
import { scaleToGeodeticSurface } from "@navaramap/three-api";

const surface = scaleToGeodeticSurface(camera.position);
if (surface) {
  console.log(`Surface point: [${surface.x}, ${surface.y}, ${surface.z}]`);
}
```

### eastNorthUpToFixedFrame(origin)

Gets the transformation matrix from the East-North-Up coordinate system to the fixed frame.

**Syntax:**

```typescript
function eastNorthUpToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: Origin ECEF coordinates (Three.js Vector3)

**Returns:**

4x4 transformation matrix (Three.js Matrix4)

**Example:**

```typescript
import {
  eastNorthUpToFixedFrame,
  geodeticToVector3,
} from "@navaramap/three-api";

const tokyoLle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};
const origin = geodeticToVector3(tokyoLle);
const matrix = eastNorthUpToFixedFrame(origin);

// Apply to an object
mesh.matrix.copy(matrix);
mesh.matrixAutoUpdate = false;
```

### northEastDownToFixedFrame(origin)

Gets the transformation matrix from the North-East-Down coordinate system to the fixed frame.

**Syntax:**

```typescript
function northEastDownToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: Origin ECEF coordinates (Three.js Vector3)

**Returns:**

4x4 transformation matrix (Three.js Matrix4)

### northUpEastToFixedFrame(origin)

Gets the transformation matrix from the North-Up-East coordinate system to the fixed frame.

**Syntax:**

```typescript
function northUpEastToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: Origin ECEF coordinates (Three.js Vector3)

**Returns:**

4x4 transformation matrix (Three.js Matrix4)

### northWestUpToFixedFrame(origin)

Gets the transformation matrix from the North-West-Up coordinate system to the fixed frame.

**Syntax:**

```typescript
function northWestUpToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: Origin ECEF coordinates (Three.js Vector3)

**Returns:**

4x4 transformation matrix (Three.js Matrix4)

### westUpNorthToFixedFrame(origin)

Gets the transformation matrix from the West-Up-North coordinate system to the fixed frame.

WUN is the only right-handed, Y-up tangent frame whose `+Z` axis is north, so it agrees with glTF's own convention (front `+Z`, up `+Y`, right `-X`) on all three axes. An unmodified glTF asset placed in this frame needs **no** `Rx(+90°)` up-axis correction, because the correction is absorbed here, once, rather than applied per object. See [Up-Axis Conventions](../../../three_default_descs/mesh-desc/mesh-desc-base/#up-axis-conventions-gltf-y-up-and-tile-z-up).

**Syntax:**

```typescript
function westUpNorthToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: Origin ECEF coordinates (Three.js Vector3)

**Returns:**

4x4 transformation matrix from WUN to ECEF (Three.js Matrix4)

**Example:**

```typescript
import {
  westUpNorthToFixedFrame,
  geodeticToVector3,
} from "@navaramap/three-api";

const origin = geodeticToVector3({
  lat: 35.681236,
  lng: 139.767125,
  height: 0,
});
const matrix = westUpNorthToFixedFrame(origin);
```

### headingPitchRollToFixedFrame(placement)

Builds a WUN tangent frame at a geodetic position and composes heading, pitch, roll, and scale onto it. It is the single call that turns a geographic placement into a world matrix.

`lng`/`lat` and all angles here are in degrees, the same convention as [geodeticToVector3(lle)](#geodetictovector3lle), `setCamera`, and the `geodetic` mesh Descriptor field.

**Syntax:**

```typescript
function headingPitchRollToFixedFrame(
  placement: Omit<GeodeticPlacement, "heightReference">
): Matrix4;
```

**Parameters:**

- `placement`: Geographic placement in degrees and metres
  - `lng`: Longitude in degrees (required)
  - `lat`: Latitude in degrees (required)
  - `height`: Metres above the ellipsoid (default `0`)
  - `heading`: Degrees clockwise from north that the asset's front (glTF `+Z`) faces (default `0`)
  - `pitch`: Degrees, nose up positive (default `0`)
  - `roll`: Degrees, right wing down positive (default `0`)
  - `scale`: Uniform or per-axis scale of the frame (default `1`)

`heightReference` is intentionally rejected by the type: resolving a terrain-relative height needs a view to sample from, so it is handled by the `geodetic` field on a mesh Descriptor instead.

**Returns:**

4x4 transformation matrix from the placed local frame to ECEF (Three.js Matrix4)

**Example:**

```typescript
import { headingPitchRollToFixedFrame } from "@navaramap/three-api";

const matrix = headingPitchRollToFixedFrame({
  lng: 138.036142,
  lat: 36.085621,
  height: 1,
  heading: 321,
});
```

`heading` is the compass bearing the asset's front faces, where the front is glTF's own `+Z` (the same convention as `setCamera`). Other globe engines differ in which axis they treat as an asset's front, so a model ported from one may need a multiple of 90° added to its heading.

## RTE (Relative to Eye) Rendering

RTE rendering functionality for achieving high-precision rendering in large-scale coordinate systems.

### encodePositionRTE(original, resultHigh?, resultLow?)

Encodes a position into high and low precision Vector3 components for RTE rendering. This enables GPU double precision emulation by splitting a position into two float components.

**Syntax:**

```typescript
function encodePositionRTE(
  original: Vector3,
  resultHigh?: Vector3,
  resultLow?: Vector3,
): { high: Vector3; low: Vector3 }
```

**Parameters:**

- `original`: Position to encode
- `resultHigh`: Optional Vector3 to store the high precision component (reused to avoid GC)
- `resultLow`: Optional Vector3 to store the low precision component (reused to avoid GC)

**Returns:**

Object with `high` and `low` Vector3 components

**Example:**

```typescript
import { encodePositionRTE } from "@navaramap/three-api";
import { Vector3 } from "three";

const position = new Vector3(6378137, 0, 0);
const { high, low } = encodePositionRTE(position);
// high + low ≈ original position with improved GPU precision
```

### calcModelMatrixRTE(objectMatrixWorld, matrixWorldInverse, result?)

Calculates the model matrix for RTE rendering. Returns a matrix with the translation component zeroed out.

**Syntax:**

```typescript
function calcModelMatrixRTE(
  objectMatrixWorld: Matrix4,
  matrixWorldInverse: Matrix4,
  result?: Matrix4
): Matrix4;
```

**Parameters:**

- `objectMatrixWorld`: Object's world matrix (Three.js Matrix4)
- `matrixWorldInverse`: Camera's world inverse matrix (Three.js Matrix4)
- `result`: Matrix to store the result (creates a new one if omitted)

**Returns:**

Model matrix for RTE (Three.js Matrix4)

**Example:**

```typescript
import { calcModelMatrixRTE } from "@navaramap/three-api";
import { Matrix4 } from "three";

const rteMatrix = calcModelMatrixRTE(
  mesh.matrixWorld,
  camera.matrixWorldInverse
);

// Use in shader
material.uniforms.modelMatrix.value = rteMatrix;
```

### calcCameraPosition(cameraPosition, modelMatrixWorld)

Encodes the camera position for RTE rendering. Splits high-precision position information into two Vector3 values: high and low.

**Syntax:**

```typescript
function calcCameraPosition(
  cameraPosition: Vector3,
  modelMatrixWorld: Matrix4
): {
  high: Vector3;
  low: Vector3;
};
```

**Parameters:**

- `cameraPosition`: Camera position (Three.js Vector3)
- `modelMatrixWorld`: Model's world matrix (Three.js Matrix4)

**Returns:**

Encoded camera position:
- `high`: High bits (high-precision component)
- `low`: Low bits (low-precision component)

```typescript
type EncodedPosition = {
  high: Vector3;
  low: Vector3;
};
```

**Example:**

```typescript
import { calcCameraPosition } from "@navaramap/three-api";

const encodedCameraPos = calcCameraPosition(camera.position, mesh.matrixWorld);

// Use in shader
material.uniforms.cameraPositionHigh.value = encodedCameraPos.high;
material.uniforms.cameraPositionLow.value = encodedCameraPos.low;
```

### composeWorldMatrixForRTE(frameMatrix, localMatrix)

Composes a frame matrix with a local transform, then splits the result into a translation Vector3 and a rotation/scale-only Matrix4 for RTE rendering. The translation is intended to be encoded as high/low RTE uniforms for GPU precision, while the rotation/scale matrix is assigned to the mesh's matrixWorld so it becomes the shader's modelMatrix uniform.

**Syntax:**

```typescript
function composeWorldMatrixForRTE(
  frameMatrix: Matrix4,
  localMatrix: Matrix4,
  resultPosition?: Vector3,
  resultRotationScale?: Matrix4
): {
  position: Vector3;
  rotationScale: Matrix4;
};
```

**Parameters:**

- `frameMatrix`: The frame transformation matrix (e.g. NUE-to-ECEF) (Three.js Matrix4)
- `localMatrix`: The local T\*R\*S transform to compose within the frame (Three.js Matrix4)
- `resultPosition` (optional): Vector3 to store the extracted translation (reused to avoid GC)
- `resultRotationScale` (optional): Matrix4 to store the translation-zeroed matrix (reused to avoid GC)

**Returns:**

The decomposed result for RTE rendering:
- `position`: World position extracted from the composed matrix
- `rotationScale`: The composed matrix with translation zeroed out

```typescript
type ComposeWorldMatrixForRTEResult = {
  position: Vector3;
  rotationScale: Matrix4;
};
```

**Example:**

```typescript
import { composeWorldMatrixForRTE, encodePositionRTE } from "@navaramap/three-api";

// Compose an NUE-to-ECEF frame with a local offset, then split for RTE
const { position, rotationScale } = composeWorldMatrixForRTE(
  nueToEcefMatrix,
  localTransformMatrix,
);

// Encode the world position as high/low uniforms
const posHigh = new Vector3();
const posLow = new Vector3();
encodePositionRTE(position, posHigh, posLow);

// Apply rotation/scale to the mesh (translation is handled by RTE uniforms)
mesh.matrixAutoUpdate = false;
mesh.matrixWorldAutoUpdate = false;
mesh.matrixWorld.copy(rotationScale);
```

## EllipsoidGeodesic

A class for geodesic calculations on the ellipsoid surface. Provides geodesic distance, azimuth, and interpolation point calculations between two points. Achieves optimized performance by pre-computing common variables when the instance is created.

### constructor(start, end)

Creates a geodesic between two points on the ellipsoid.

**Syntax:**

```typescript
constructor(start: LatLngHeight, end: LatLngHeight)
```

**Parameters:**

- `start`: Geodetic coordinates of the start point (latitude and longitude in degrees)
- `end`: Geodetic coordinates of the end point (latitude and longitude in degrees)

**Example:**

```typescript
import { EllipsoidGeodesic } from "@navaramap/three-api";

const start = {
  lat: 35.6762, // Tokyo
  lng: 139.6503,
  height: 0,
};
const end = {
  lat: 34.6937, // Osaka
  lng: 135.5023,
  height: 0,
};

const geodesic = new EllipsoidGeodesic(start, end);
```

### distance

Gets the geodesic distance between the start and end points (meters).

**Syntax:**

```typescript
get distance(): number
```

**Returns:**

Geodesic distance (meters)

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);
console.log(`Distance: ${geodesic.distance} m`); // Distance: 401747.8... m
```

### converged

Gets whether the geodesic computation converged. Returns `false` when the start and end points are nearly antipodal (on opposite sides of the earth), where no shortest path can be determined reliably. In that case `distance` is only a rough estimate, and the interpolation methods snap to the endpoints instead of following the unreliable solution.

**Syntax:**

```typescript
get converged(): boolean
```

**Returns:**

`true` when the computation converged, `false` for nearly antipodal endpoints

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

if (!geodesic.converged) {
  console.warn("Nearly antipodal endpoints: the distance is approximate");
}
```

### startHeading

Gets the azimuth at the start point (degrees).

**Syntax:**

```typescript
get startHeading(): number
```

**Returns:**

Azimuth at the start point (degrees)

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);
console.log(`Start heading: ${geodesic.startHeading}°`);
```

### endHeading

Gets the azimuth at the end point (degrees).

**Syntax:**

```typescript
get endHeading(): number
```

**Returns:**

Azimuth at the end point (degrees)

### start

Gets the geodetic coordinates of the start point.

**Syntax:**

```typescript
get start(): LatLngHeight
```

**Returns:**

Geodetic coordinates of the start point

### end

Gets the geodetic coordinates of the end point.

**Syntax:**

```typescript
get end(): LatLngHeight
```

**Returns:**

Geodetic coordinates of the end point

### interpolatePoints(granularity?)

Generates interpolation points along the geodesic path.

**Syntax:**

```typescript
interpolatePoints(granularity?: number): LatLngHeight[]
```

**Parameters:**

- `granularity`: Distance between interpolation points (meters). When omitted, the WASM-side default value is used (a granularity that adequately represents the geodesic)

**Returns:**

An array of interpolated geodetic coordinates. When `converged` is `false`, only the start and end points are returned

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

// Generate interpolation points at 1000m intervals
const points = geodesic.interpolatePoints(1000);
console.log(`Number of interpolation points: ${points.length}`);

points.forEach((point, index) => {
  console.log(`Point ${index}: lat=${point.lat}°, lng=${point.lng}°`);
});
```

### interpolateDistance(distance)

Gets the point at a specified distance along the geodesic path.

**Syntax:**

```typescript
interpolateDistance(distance: number): LatLngHeight
```

**Parameters:**

- `distance`: Distance from the start point (meters)

**Returns:**

Geodetic coordinates at the specified distance. When `converged` is `false`, the nearest endpoint is returned instead

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

// Get the midpoint
const midpoint = geodesic.interpolateDistance(geodesic.distance / 2);
console.log(`Midpoint: lat=${midpoint.lat}°, lng=${midpoint.lng}°`);
```

### dispose()

Releases WASM memory. Call this when the geodesic object is no longer needed.

**Syntax:**

```typescript
dispose(): void
```

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

// Perform geodesic calculations
const distance = geodesic.distance;
const points = geodesic.interpolatePoints(1000);

// Release memory after use
geodesic.dispose();
```

### Complete Usage Example

```typescript
import {
  initNavaraApi,
  EllipsoidGeodesic,
  geodeticToVector3,
} from "@navaramap/three-api";

await initNavaraApi();

// Create a geodesic from Tokyo to Osaka
const tokyo = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};
const osaka = {
  lat: 34.6937,
  lng: 135.5023,
  height: 0,
};

const geodesic = new EllipsoidGeodesic(tokyo, osaka);

// Display distance and azimuth
console.log(`Distance: ${(geodesic.distance / 1000).toFixed(2)} km`);
console.log(`Start heading: ${geodesic.startHeading.toFixed(2)}°`);
console.log(`End heading: ${geodesic.endHeading.toFixed(2)}°`);

// Generate interpolation points at 10km intervals and convert to 3D coordinates
const points = geodesic.interpolatePoints(10000);
const positions = points.map((point) => geodeticToVector3(point));

// Draw a line in Three.js
const lineGeometry = new BufferGeometry().setFromPoints(positions);
const lineMaterial = new LineBasicMaterial({ color: "#ff0000" });
const line = new Line(lineGeometry, lineMaterial);
scene.add(line);

// Release memory
geodesic.dispose();
```

## Types

### LatLngHeight

An interface representing geodetic coordinates.

```typescript
interface LatLngHeight {
  lat: number; // Latitude (degrees)
  lng: number; // Longitude (degrees)
  height: number; // Height (meters)
}
```

### LatLng

An interface representing latitude and longitude.

```typescript
interface LatLng {
  lat: number;  // Latitude (degrees)
  lng: number;  // Longitude (degrees)
}
```

### WindowObject

An interface representing window information. Passed to screen coordinate transformation functions.

```typescript
interface WindowObject {
  width: number; // Window width (pixels)
  height: number; // Window height (pixels)
  pixelRatio: number; // Device pixel ratio
}
```

## Usage Examples

### Using the API from @navaramap/three

When using `@navaramap/three`, the `@navaramap/three-api` APIs are re-exported from `@navaramap/three`, so you can import them directly from there.

:::tip[Recommendation]
When using `@navaramap/three`, it is recommended to import APIs from `@navaramap/three`. In this case, calling `initNavaraApi()` is not required (`ThreeView.init()` handles initialization internally).
:::

An example of using the API from `@navaramap/three` to dynamically move a model around the globe:

```typescript
import ThreeView, {
  geodeticToVector3,
  geodeticSurfaceNormal,
} from "@navaramap/three";
import { GLTFModelDesc } from "@navaramap/three-default-descs";
import { Vector3, Quaternion, Euler, Matrix4 } from "three";

const view = new ThreeView({ container });

view.registerMesh("gltfModel", GLTFModelDesc);
await view.init();

view.setCamera({
  lng: 139.6503,
  lat: 35.6762,
  height: 1000,
});

// Initial position in Osaka
let longitude = 135.5023;
const latitude = 34.6937;
const altitude = 0;

// Add a GLTF model
const modelDesc = view.addMesh<GLTFModelDesc>({
  gltfModel: { url: "/path/to/model.glb" },
  position: geodeticToVector3({
    lat: latitude,
    lng: longitude,
    height: altitude,
  }),
});

// Animation loop - move the model around the globe
const animate = () => {
  // Update longitude (move around the globe)
  longitude += 0.01;

  // Calculate new position
  const pos = geodeticToVector3({
    lat: latitude,
    lng: longitude,
    height: altitude,
  });

  // Calculate surface normal
  const normal = geodeticSurfaceNormal({
    lat: latitude,
    lng: longitude,
    height: altitude,
  });

  // Calculate movement direction
  const nextLongitude = longitude + 0.01;
  const nextPos = geodeticToVector3({
    lat: latitude,
    lng: nextLongitude,
    height: altitude,
  });
  const direction = new Vector3().subVectors(nextPos, pos).normalize();

  // Calculate rotation (orient towards movement direction with normal as up)
  const right = new Vector3().crossVectors(direction, normal).normalize();
  const up = new Vector3().crossVectors(right, direction).normalize();

  const rotationMatrix = new Matrix4();
  rotationMatrix.makeBasis(right, up, direction.clone().negate());

  const quaternion = new Quaternion();
  quaternion.setFromRotationMatrix(rotationMatrix);
  const euler = new Euler().setFromQuaternion(quaternion);

  // Update model position and rotation
  modelDesc.update({
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
  });

  requestAnimationFrame(animate);
};

animate();
```

### Basic Coordinate Transformation

:::note
When using `@navaramap/three-api` directly, you must call `initNavaraApi()` before use.
When using `@navaramap/three`, refer to the "Using the API from @navaramap/three" section above.
:::

```typescript
import {
  initNavaraApi,
  geodeticToVector3,
  vector3ToGeodetic,
} from "@navaramap/three-api";

// Initialize
await initNavaraApi();

const tokyoLle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 100,
};

// Convert geodetic coordinates to ECEF coordinates
const ecefPos = geodeticToVector3(tokyoLle);
console.log(`ECEF coordinates: [${ecefPos.x}, ${ecefPos.y}, ${ecefPos.z}]`);

// Convert ECEF coordinates back to geodetic coordinates
const convertedLle = vector3ToGeodetic(ecefPos);
console.log(`Latitude: ${convertedLle.lat}°`);
console.log(`Longitude: ${convertedLle.lng}°`);
console.log(`Height: ${convertedLle.height} m`);
```

### Screen Picking

```typescript
import {
  getPickRay,
  getPlaneFromPointNormal,
  getRayPlaneIntersection,
  getHeightFromEllipsoid,
} from "@navaramap/three-api";
import { Vector2, Vector3 } from "three";

// Mouse click event handler
canvas.addEventListener("click", (event) => {
  const windowObject = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    pixelRatio: window.devicePixelRatio
  };

  // Mouse position
  const screenPos = new Vector2(event.clientX, event.clientY);

  // Generate picking ray
  const ray = getPickRay(windowObject, camera, screenPos);

  // Define ground plane (Z=0)
  const groundPlane = getPlaneFromPointNormal(
    new Vector3(0, 0, 0),
    new Vector3(0, 0, 1)
  );

  // Calculate intersection
  const intersection = getRayPlaneIntersection(ray, groundPlane);

  if (intersection) {
    console.log("Clicked ground position:", intersection);

    // Check the height at the intersection
    const height = getHeightFromEllipsoid(intersection);
    console.log("Height from ellipsoid:", height);
  }
});
```

### Setting Up Local Coordinate Systems

```typescript
import {
  geodeticToVector3,
  eastNorthUpToFixedFrame,
} from "@navaramap/three-api";
import { Mesh, BoxGeometry, MeshBasicMaterial } from "three";

// Tokyo location
const tokyoLle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};

// Get ECEF coordinates
const origin = geodeticToVector3(tokyoLle);

// Get East-North-Up coordinate system transformation matrix
const enuMatrix = eastNorthUpToFixedFrame(origin);

// Create and place a mesh
const geometry = new BoxGeometry(100, 100, 100);
const material = new MeshBasicMaterial({ color: "#ff0000" });
const mesh = new Mesh(geometry, material);

// Apply ENU coordinate system transformation matrix
mesh.matrix.copy(enuMatrix);
mesh.matrixAutoUpdate = false;

scene.add(mesh);
```

### Converting Between Screen and World Coordinates

```typescript
import {
  convertScreenToWorld,
  convertWorldToScreen,
  geodeticToVector3,
} from "@navaramap/three-api";
import { Vector2 } from "three";

const windowObject = {
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  pixelRatio: window.devicePixelRatio
};

// Convert world coordinates to screen coordinates
const worldPos = geodeticToVector3({
  lat: 35.6762,
  lng: 139.6503,
  height: 100,
});

const screenPos = convertWorldToScreen(windowObject, camera, worldPos);
if (screenPos) {
  console.log(`Screen coordinates: [${screenPos.x}, ${screenPos.y}]`);

  // Position an HTML element
  const label = document.getElementById("label");
  label.style.left = `${screenPos.x}px`;
  label.style.top = `${screenPos.y}px`;
}

// Convert screen coordinates to world coordinates
const mousePos = new Vector2(event.clientX, event.clientY);
const pickedWorldPos = convertScreenToWorld(windowObject, camera, mousePos);
if (pickedWorldPos) {
  console.log(
    `World coordinates: [${pickedWorldPos.x}, ${pickedWorldPos.y}, ${pickedWorldPos.z}]`
  );
}
```
