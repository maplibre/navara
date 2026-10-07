---
title: Mesh Descriptor
description: Mesh descriptor types for navara_three
sidebar:
  order: 100
---

`MeshDesc` is a descriptor type for adding 3D mesh objects to the scene. It can display various 3D objects.

All mesh descriptors inherit from [`MeshDesc`](../mesh-desc-base), which provides common properties such as `position`, `rotation`, `scale`, `matrix`, `matrixWorld`, `geodetic`, and `pickable`. See the [MeshDesc](../mesh-desc-base) page for details on transform composition, picking, and coordinate transformation.

## Available Mesh Descriptor Types

The following MeshDescriptor types are available in navara_three:

| Descriptor Type | Description |
|------------|------|
| [ArclineMeshDesc](../arcline-mesh-desc) | A Descriptor that draws arc-shaped lines connecting two points |
| [BoxMeshDesc](../box-mesh-desc) | A Descriptor that draws box geometry |
| [InstancedBoxMeshDesc](../instanced-box-mesh-desc) | A GPU-instanced Descriptor that renders multiple boxes in a single draw call |
| [CylinderMeshDesc](../cylinder-mesh-desc) | A Descriptor that draws cylinder geometry |
| [InstancedCylinderMeshDesc](../instanced-cylinder-mesh-desc) | A GPU-instanced Descriptor that renders multiple cylinders in a single draw call |
| [GLTFModelDesc](../gltf-model-desc) | A Descriptor that loads and displays GLTF/GLB format 3D models |
| [InstancedGltfModelMeshDesc](../instanced-gltf-model-mesh-desc) | A GPU-instanced Descriptor that renders multiple copies of a GLTF/GLB model |
| [GlowGlobeMeshDesc](../glow-globe-mesh-desc) | A Descriptor that displays a Fresnel-effect glow around the globe |
| [PlaneMeshDesc](../plane-mesh-desc) | A Descriptor that draws plane geometry |
| [PolygonMeshDesc](../polygon-mesh-desc) | A Descriptor that draws a single polygon from positions, flat or extruded, or clamped to the terrain |
| [PolylineMeshDesc](../polyline-mesh-desc) | A Descriptor that draws a single polyline from positions, at a height or clamped to the terrain |
| [InstancedPlaneMeshDesc](../instanced-plane-mesh-desc) | A GPU-instanced Descriptor that renders multiple planes in a single draw call |
| [RainMeshDesc](../rain-mesh-desc) | A Descriptor that displays rain particle effects |
| [SkyBoxMeshDesc](../sky-box-mesh-desc) | A Descriptor that draws a simple skybox |
| [SkyMeshDesc](../sky-mesh-desc) | A Descriptor that draws the sky, sun, and moon using atmospheric scattering |
| [SmoothLineMeshDesc](../smooth-line-mesh-desc) | A Descriptor that draws smooth lines using Catmull-Rom curves |
| [SnowMeshDesc](../snow-mesh-desc) | A Descriptor that displays snow particle effects |
| [SphereMeshDesc](../sphere-mesh-desc) | A Descriptor that draws sphere geometry |
| [SplatMeshDesc](../splat-mesh-desc) | A Descriptor that renders 3D Gaussian Splat assets via SparkJS |
| [InstancedSphereMeshDesc](../instanced-sphere-mesh-desc) | A GPU-instanced Descriptor that renders multiple spheres in a single draw call |
| [StarsDesc](../stars-desc) | A Descriptor that draws a starry sky |
| [TubeMeshDesc](../tube-mesh-desc) | A Descriptor that draws tube geometry |
| [AxesHelperDesc](../axes-helper-desc) | A debug helper Descriptor that visualizes the 3 axes |
| [ArrowHelperDesc](../arrow-helper-desc) | A debug helper Descriptor that visualizes vector directions |

## Basic Usage

A mesh descriptor is added by registering the descriptor class and then calling the `view.addMesh()` method:

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { BoxMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();

// Register the descriptor class
view.registerMesh("box", BoxMeshDesc);

await view.init();

// Add a BoxMeshDesc at a longitude / latitude (degrees) and height (meters)
const boxDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0xff0000),
  },
  geodetic: { lng: 139.767125, lat: 35.681236, height: 1000 },
});
```

## Common Properties

All Mesh Descriptors have the following basic settings:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `id` | `string` | Auto-generated | Unique identifier for the object |
| `visible` | `boolean` | `true` | Toggle visibility of the object |
| `geodetic` | `GeodeticPlacement` | - | Geographic placement: `lng` / `lat` in degrees, `height` in meters, plus `heading` / `pitch` / `roll` / `scale` / `heightReference`. See [Geographic Placement](../mesh-desc-base#geographic-placement-geodetic) |
| `position` | `{ x: number, y: number, z: number }` | - | Position of the mesh (ECEF coordinate system) |
| `rotation` | `{ x: number, y: number, z: number }` | - | Rotation of the mesh (Euler angles, radians) |
| `scale` | `{ x: number, y: number, z: number }` | - | Scale of the mesh |

## Coordinate Transformation

To place a mesh at a longitude / latitude you normally do not need any conversion: set the `geodetic` property instead, as in the example above (see [Geographic Placement](../mesh-desc-base#geographic-placement-geodetic)). The functions below are the low-level layer for working with ECEF coordinates directly.

The `position` property of MeshDesc uses the ECEF (Earth-Centered, Earth-Fixed) coordinate system. To convert from latitude/longitude/altitude (geodetic coordinates) to the ECEF coordinate system, use the `geodeticToVector3()` function.

:::note
Latitude and longitude are specified in **degrees**.
:::

### Basic Coordinate Transformation

```typescript
import ThreeView, {
  Color,
  geodeticToVector3,
} from "@navaramap/three";
import { SphereMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();
view.registerMesh("sphere", SphereMeshDesc);
await view.init();

// Convert from latitude/longitude/altitude to ECEF coordinates
const position = geodeticToVector3({
  lat: 35.681236,  // Latitude (degrees)
  lng: 139.767125, // Longitude (degrees)
  height: 200,                      // Altitude (meters)
});

// Add a mesh descriptor with the converted coordinates
const sphereDesc = view.addMesh<SphereMeshDesc>({
  sphere: {
    radius: 100,
    color: new Color().setHex(0x00aaff),
  },
  position: {
    x: position.x,
    y: position.y,
    z: position.z,
  },
});
```

### Standing a Model Upright on the Surface

`geodetic` builds the surface-aligned frame for you: the mesh stands upright at the given longitude / latitude, and `heading` turns the asset's front (glTF `+Z`) clockwise from north. An unmodified glTF asset needs no up-axis correction.

```typescript
import { GLTFModelDesc } from "@navaramap/three-default-descs";

// GLTFModelDesc must be registered

// Place the model upright on the Earth's surface, facing north-east
const modelDesc = view.addMesh<GLTFModelDesc>({
  gltfModel: {
    url: "/models/building.gltf",
  },
  geodetic: { lng: 139.767125, lat: 35.681236, heading: 45 },
});
```

For frames `geodetic` does not build (ENU, NED and others), compose a `matrixWorld` with the [tangent-frame helpers](../mesh-desc-base#using-a-local-tangent-frame-enu-and-others).

### Using ENU (East-North-Up) Coordinate System

To place meshes using a local coordinate system (ENU: East-North-Up), use `eastNorthUpToFixedFrame()`.

```typescript
import {
  geodeticToVector3,
  eastNorthUpToFixedFrame,
} from "@navaramap/three";
import { Vector3 } from "three";

const position = geodeticToVector3({
  lat: 35.681236,
  lng: 139.767125,
  height: 0,
});

// Get the ENU transformation matrix
const enuMatrix = eastNorthUpToFixedFrame(position);

// Extract east and north direction vectors from the ENU matrix
const east = new Vector3().setFromMatrixColumn(enuMatrix, 0).normalize();
const north = new Vector3().setFromMatrixColumn(enuMatrix, 1).normalize();

// Compute a position 100m to the east
const offsetPosition = position.clone().add(east.multiplyScalar(100));
```

### Reverse Conversion from ECEF to Geodetic Coordinates

To convert back from ECEF coordinates to latitude/longitude/altitude, use `vector3ToGeodetic()`.

```typescript
import { vector3ToGeodetic } from "@navaramap/three";

// Get the current position of the mesh
const worldPosition = meshDesc.ref.getWorldPosition();

// Convert from ECEF to geodetic coordinates (degrees)
const geodetic = vector3ToGeodetic(worldPosition);

const latitude = geodetic.lat;
const longitude = geodetic.lng;
const height = geodetic.height;

console.log(`Latitude: ${latitude}°, Longitude: ${longitude}°, Altitude: ${height}m`);
```

### Coordinate Transformation Functions

| Function | Description |
|------|------|
| `geodeticToVector3()` | Converts geodetic coordinates (latitude/longitude/altitude) to ECEF coordinates (Vector3) |
| `vector3ToGeodetic()` | Converts ECEF coordinates (Vector3) to geodetic coordinates |
| `degreeToRadian()` | Converts degrees to radians |
| `radianToDegree()` | Converts radians to degrees |
| `geodeticSurfaceNormal()` | Gets the Earth's surface normal vector at the specified position |
| `eastNorthUpToFixedFrame()` | Gets the transformation matrix to the ENU coordinate system |

For details, see [navara_three_api](../../../three/api/navara_three_api).

For detailed usage, refer to the documentation for each descriptor type.
