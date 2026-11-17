import type { CameraPosition, CameraState } from "@navaramap/core";
import type { Core } from "@navaramap/engine";

/** The largest vertical field of view, in degrees; 180 is not a perspective. */
export const MAX_FOV = 179;
/** The smallest vertical field of view, in degrees. */
export const MIN_FOV = 1;

/** Whether `fov` (degrees) is a field of view the camera takes; false for NaN. */
export function isValidFov(fov: number): boolean {
  return fov >= MIN_FOV && fov <= MAX_FOV;
}

/** `ThreeView.getCamera()`: one engine call for the whole camera. */
export function readCameraState(
  core: Core | undefined,
): CameraState | undefined {
  const state = core?.getCameraState();
  if (!state) return undefined;
  const [lng, lat, height, heading, pitch, roll, fov] = state;
  return { lng, lat, height, heading, pitch, roll, fov };
}

const isFiniteNumber = (value: number | undefined): value is number =>
  Number.isFinite(value);

/**
 * `ThreeView.setCamera()`. Sends a camera change only when it has a position,
 * an orientation angle or a distance: a change also stops a flight and
 * inertia, which a `fov`-only call must not do. An invalid `fov` is ignored.
 */
export function applyCameraState(
  core: Core | undefined,
  camera: CameraPosition & { fov?: number },
): void {
  if (!core) return;
  const { lng, lat, height, heading, pitch, roll, distance, fov } = camera;
  const position =
    isFiniteNumber(lng) && isFiniteNumber(lat)
      ? new Float64Array([lng, lat, height ?? 0])
      : null;
  if (
    position ||
    heading !== undefined ||
    pitch !== undefined ||
    roll !== undefined ||
    distance !== undefined
  ) {
    core.changeCamera(position, pitch, heading, roll, distance);
  }
  if (fov !== undefined && isValidFov(fov)) {
    core.setFrustum(fov, undefined, undefined);
  }
}
