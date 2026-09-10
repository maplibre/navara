import type { LatLngHeight, Window as WindowObject } from "@navaramap/core";
import initApi, {
  Window,
  LLE,
  Vec3,
  Vec2,
  Transform,
  CameraFrustum,
  geodeticToXyz,
  xyzToGeodetic,
  angleToRadian,
  angleToDegree,
  screenToWorld,
  worldToScreen,
  geodeticSurfaceNormal as nvGeodeticSurfaceNormal,
  eastNorthUpToFixedFrame as nvEastNorthUpToFixedFrame,
  northEastDownToFixedFrame as nvNorthEastDownToFixedFrame,
  northUpEastToFixedFrame as nvNorthUpEastToFixedFrame,
  northWestUpToFixedFrame as nvNorthWestUpToFixedFrame,
  getWGS84SemiMajorAxis as nvGetWGS84SemiMajorAxis,
  getWGS84SemiMinorAxis as nvGetWGS84SemiMinorAxis,
  getWGS84EccentricitySquared as nvGetWGS84EccentricitySquared,
  getWGS84Flattening as nvGetWGS84Flattening,
  getWGS84Eccentricity as nvGetWGS84Eccentricity,
} from "@navaramap/engine-api";
import { Vector3, Vector2, Matrix4, PerspectiveCamera } from "three";

import {
  composeHeadingPitchRoll,
  nueToWunBasis,
  type GeodeticPlacement,
} from "./frames";

export type { LatLngHeight, LatLng } from "@navaramap/core";
export type {
  Window,
  Transform,
  CameraFrustum,
  Plane,
  Ray,
  Vec2,
  Vec3,
} from "@navaramap/core";
export type { GeodeticPlacement } from "./frames";

export * from "./intersection";
export * from "./rte";
export * from "./ellipsoidGeodesic";

/**
 * Initializes the Navara API WASM module. Must be called before using other API functions.
 */
export async function initNavaraApi() {
  await initApi();
}

/**
 * Converts geodetic coordinates (longitude, latitude, height) to a Cartesian Vector3 in ECEF coordinates.
 * @param lle - Geodetic coordinates (lng in degrees, lat in degrees, height in meters)
 * @returns Cartesian Vector3 in Earth-Centered Earth-Fixed (ECEF) coordinates
 */
export function geodeticToVector3(lle: LatLngHeight): Vector3 {
  const pos = geodeticToXyz(
    new LLE(angleToRadian(lle.lat), angleToRadian(lle.lng), lle.height),
  );
  const result = new Vector3(pos.x, pos.y, pos.z);
  pos.free();
  return result;
}

/**
 * Converts a Cartesian Vector3 in ECEF coordinates to geodetic coordinates.
 * @param xyz - Cartesian Vector3 in Earth-Centered Earth-Fixed (ECEF) coordinates
 * @returns Geodetic coordinates (lng in degrees, lat in degrees, height in meters)
 */
export function vector3ToGeodetic(xyz: Vector3): LatLngHeight {
  const vec3 = new Vec3(xyz.x, xyz.y, xyz.z);
  const lle = xyzToGeodetic(vec3);
  const result = {
    lat: angleToDegree(lle.lat),
    lng: angleToDegree(lle.lng),
    height: lle.height,
  };
  lle.free();
  return result;
}

/**
 * Converts an angle from degrees to radians.
 * @param degree - Angle in degrees
 * @returns Angle in radians
 */
export function degreeToRadian(degree: number): number {
  return angleToRadian(degree);
}

/**
 * Converts an angle from radians to degrees.
 * @param radian - Angle in radians
 * @returns Angle in degrees
 */
export function radianToDegree(radian: number): number {
  return angleToDegree(radian);
}

/**
 * Converts screen coordinates to world coordinates by raycasting against the WGS84 ellipsoid.
 * @param window - Window configuration with width, height, and pixelRatio
 * @param camera - Three.js PerspectiveCamera
 * @param vec2 - Screen coordinates in CSS pixels (same as MouseEvent clientX/clientY)
 * @returns World position Vector3 in ECEF coordinates, or undefined if no intersection with ellipsoid
 */
export function convertScreenToWorld(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  vec2: Vector2,
): Vector3 | undefined {
  const window = new Window(
    windowObject.width,
    windowObject.height,
    windowObject.pixelRatio,
  );
  window.width = window.width * window.pixelRatio;
  window.height = window.height * window.pixelRatio;

  const transform = new Transform(
    camera.position.x,
    camera.position.y,
    camera.position.z,
    camera.quaternion.x,
    camera.quaternion.y,
    camera.quaternion.z,
    camera.quaternion.w,
    camera.scale.x,
    camera.scale.y,
    camera.scale.z,
  );

  const frustum = new CameraFrustum(
    camera.near,
    camera.far,
    angleToRadian(camera.fov),
    camera.aspect,
  );

  const pos = screenToWorld(
    window,
    transform,
    frustum,
    new Vec2(vec2.x, vec2.y),
  );

  if (!pos) {
    return undefined;
  }
  const result = new Vector3(pos.x, pos.y, pos.z);
  pos.free();

  return result;
}

/**
 * Computes the surface normal vector at a geodetic position on the WGS84 ellipsoid.
 * @param lle - Geodetic coordinates (lng in degrees, lat in degrees, height in meters)
 * @returns Unit normal vector pointing outward from the ellipsoid surface
 */
export function geodeticSurfaceNormal(lle: LatLngHeight): Vector3 {
  const pos = nvGeodeticSurfaceNormal(
    new LLE(angleToRadian(lle.lat), angleToRadian(lle.lng), lle.height),
  );
  const result = new Vector3(pos.x, pos.y, pos.z);
  pos.free();
  return result;
}

/**
 * Creates a local East-North-Up (ENU) reference frame transformation matrix at a position.
 * @param origin - Origin position in ECEF coordinates
 * @returns 4x4 transformation matrix from ENU to ECEF
 */
export function eastNorthUpToFixedFrame(origin: Vector3): Matrix4 {
  const vec3 = new Vec3(origin.x, origin.y, origin.z);
  const arr = nvEastNorthUpToFixedFrame(vec3);
  const matrix = new Matrix4().fromArray(arr);
  return matrix;
}

/**
 * Creates a local North-East-Down (NED) reference frame transformation matrix at a position.
 * @param origin - Origin position in ECEF coordinates
 * @returns 4x4 transformation matrix from NED to ECEF
 */
export function northEastDownToFixedFrame(origin: Vector3): Matrix4 {
  const vec3 = new Vec3(origin.x, origin.y, origin.z);
  const arr = nvNorthEastDownToFixedFrame(vec3);
  const matrix = new Matrix4().fromArray(arr);
  return matrix;
}

/**
 * Creates a local North-Up-East (NUE) reference frame transformation matrix at a position.
 * @param origin - Origin position in ECEF coordinates
 * @returns 4x4 transformation matrix from NUE to ECEF
 */
export function northUpEastToFixedFrame(origin: Vector3): Matrix4 {
  const vec3 = new Vec3(origin.x, origin.y, origin.z);
  const arr = nvNorthUpEastToFixedFrame(vec3);
  const matrix = new Matrix4().fromArray(arr);
  return matrix;
}

/**
 * Creates a local North-West-Up (NWU) reference frame transformation matrix at a position.
 * @param origin - Origin position in ECEF coordinates
 * @returns 4x4 transformation matrix from NWU to ECEF
 */
export function northWestUpToFixedFrame(origin: Vector3): Matrix4 {
  const vec3 = new Vec3(origin.x, origin.y, origin.z);
  const arr = nvNorthWestUpToFixedFrame(vec3);
  const matrix = new Matrix4().fromArray(arr);
  return matrix;
}

/**
 * Creates a local West-Up-North (WUN) reference frame transformation matrix at
 * a position.
 *
 * WUN is the only right-handed, Y-up tangent frame whose `+Z` axis is north, so
 * it agrees with glTF's own convention (front `+Z`, up `+Y`, right `-X`) on all
 * three axes. An unmodified glTF asset placed in this frame needs **no**
 * `Rx(+90°)` up-axis correction — the correction is absorbed here, once, as the
 * `Ry(+90°)` basis change from NUE.
 *
 * @param origin - Origin position in ECEF coordinates
 * @returns 4x4 transformation matrix from WUN to ECEF
 */
export function westUpNorthToFixedFrame(origin: Vector3): Matrix4 {
  return northUpEastToFixedFrame(origin).multiply(nueToWunBasis());
}

/**
 * Builds a WUN tangent frame at a geodetic position and composes heading,
 * pitch, roll and scale onto it — the single call that turns a geographic
 * placement into a world matrix.
 *
 * `heading` is the compass bearing the asset's front faces, where the front is
 * glTF's own `+Z` — the same convention as `ThreeView.setCamera`. Other globe
 * engines differ in which axis they treat as an asset's front, so a model
 * ported from one may need a multiple of 90° added to its heading.
 *
 * `lng`/`lat` and all angles here are in **degrees**, matching
 * `setCamera` and the `geodetic` mesh Descriptor field.
 *
 * `heightReference` is intentionally not accepted: resolving terrain-relative
 * height needs a view to sample from, so it is the Descriptor's job.
 *
 * @param placement - Geographic placement in degrees and metres
 * @returns 4x4 transformation matrix from the placed local frame to ECEF
 */
export function headingPitchRollToFixedFrame(
  placement: Omit<GeodeticPlacement, "heightReference">,
): Matrix4 {
  const origin = geodeticToVector3({
    lng: placement.lng,
    lat: placement.lat,
    height: placement.height ?? 0,
  });
  return composeHeadingPitchRoll(westUpNorthToFixedFrame(origin), placement);
}

/**
 * Converts world coordinates to screen coordinates.
 * @param window - Window configuration with width, height, and pixelRatio
 * @param camera - Three.js PerspectiveCamera
 * @param worldPos - World position Vector3 in ECEF coordinates
 * @returns Screen coordinates in CSS pixels, or undefined if behind camera
 */
export function convertWorldToScreen(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  worldPos: Vector3,
): Vector2 | undefined {
  const window = new Window(
    windowObject.width,
    windowObject.height,
    windowObject.pixelRatio,
  );
  window.width = window.width * window.pixelRatio;
  window.height = window.height * window.pixelRatio;

  const transform = new Transform(
    camera.position.x,
    camera.position.y,
    camera.position.z,
    camera.quaternion.x,
    camera.quaternion.y,
    camera.quaternion.z,
    camera.quaternion.w,
    camera.scale.x,
    camera.scale.y,
    camera.scale.z,
  );

  const frustum = new CameraFrustum(
    camera.near,
    camera.far,
    angleToRadian(camera.fov),
    camera.aspect,
  );

  const screenPos = worldToScreen(
    window,
    transform,
    frustum,
    new Vec3(worldPos.x, worldPos.y, worldPos.z),
  );

  if (!screenPos) {
    return undefined;
  }
  const result = new Vector2(screenPos.x, screenPos.y);
  screenPos.free();

  return result;
}

/**
 * Returns the WGS84 ellipsoid semi-major axis (equatorial radius) in meters.
 * @returns Semi-major axis (approximately 6,378,137 meters)
 */
export function getWGS84SemiMajorAxis(): number {
  return nvGetWGS84SemiMajorAxis();
}

/**
 * Returns the WGS84 ellipsoid semi-minor axis (polar radius) in meters.
 * @returns Semi-minor axis (approximately 6,356,752 meters)
 */
export function getWGS84SemiMinorAxis(): number {
  return nvGetWGS84SemiMinorAxis();
}

/**
 * Returns the WGS84 ellipsoid first eccentricity squared.
 * @returns Eccentricity squared value
 */
export function getWGS84EccentricitySquared(): number {
  return nvGetWGS84EccentricitySquared();
}

/**
 * Returns the WGS84 ellipsoid flattening ratio.
 * @returns Flattening value (approximately 1/298.257)
 */
export function getWGS84Flattening(): number {
  return nvGetWGS84Flattening();
}

/**
 * Returns the WGS84 ellipsoid first eccentricity.
 * @returns Eccentricity value
 */
export function getWGS84Eccentricity(): number {
  return nvGetWGS84Eccentricity();
}
