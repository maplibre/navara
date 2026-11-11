import { Matrix4, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import { REANCHOR_DISTANCE, WorldAnchor } from "./worldAnchor";

// The package index boots the worker pool, which needs a browser, and the
// real frame function needs the WASM module; the anchor takes its own.
vi.mock("@navaramap/three", () => ({
  eastNorthUpToFixedFrame: () => new Matrix4(),
}));

// East/north/up frame on a sphere: up is the radial direction.
const sphereFrame = (origin: Vector3): Matrix4 => {
  const up = origin.clone().normalize();
  const east = new Vector3(0, 0, 1).cross(up).normalize();
  const north = up.clone().cross(east);
  return new Matrix4().makeBasis(east, north, up);
};

const RADIUS = 6_371_000;

describe("WorldAnchor", () => {
  it("puts the origin on the ellipsoid under the camera", () => {
    const anchor = new WorldAnchor(sphereFrame);
    const camera = new Vector3(RADIUS + 350, 0, 0);

    expect(anchor.update(camera, () => 350)).toBe(true);
    expect(anchor.up.x).toBeCloseTo(1);
    expect(anchor.cameraFromOrigin.x).toBeCloseTo(350);
    expect(anchor.cameraFromOrigin.length()).toBeCloseTo(350);
  });

  it("holds the origin until the camera moves far enough", () => {
    const anchor = new WorldAnchor(sphereFrame);
    const height = vi.fn(() => 350);
    anchor.update(new Vector3(RADIUS + 350, 0, 0), height);

    const nearby = new Vector3(RADIUS + 350, REANCHOR_DISTANCE / 2, 0);
    expect(anchor.update(nearby, height)).toBe(false);
    expect(anchor.cameraFromOrigin.y).toBeCloseTo(REANCHOR_DISTANCE / 2);
    expect(height).toHaveBeenCalledTimes(1);

    const far = new Vector3(RADIUS + 350, REANCHOR_DISTANCE * 2, 0);
    expect(anchor.update(far, height)).toBe(true);
    expect(anchor.cameraFromOrigin.length()).toBeLessThan(REANCHOR_DISTANCE);
    expect(height).toHaveBeenCalledTimes(2);
  });
});
