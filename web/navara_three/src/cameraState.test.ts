import type { Core } from "@navaramap/engine";
import { describe, expect, it, vi } from "vitest";

import { applyCameraState, isValidFov, readCameraState } from "./cameraState";

function mockCore(state?: number[]) {
  return {
    getCameraState: vi.fn(() => (state ? new Float64Array(state) : undefined)),
    changeCamera: vi.fn(),
    setFrustum: vi.fn(),
  };
}

const asCore = (core: ReturnType<typeof mockCore>) => core as unknown as Core;

describe("readCameraState", () => {
  it("is undefined until the engine camera exists", () => {
    expect(readCameraState(undefined)).toBeUndefined();
    expect(readCameraState(asCore(mockCore()))).toBeUndefined();
  });

  it("names the engine values in order", () => {
    const core = mockCore([139.7, 35.6, 1000, 90, -45, 1, 60]);
    expect(readCameraState(asCore(core))).toEqual({
      lng: 139.7,
      lat: 35.6,
      height: 1000,
      heading: 90,
      pitch: -45,
      roll: 1,
      fov: 60,
    });
    expect(core.getCameraState).toHaveBeenCalledTimes(1);
  });

  it("round-trips through JSON into applyCameraState", () => {
    const core = mockCore([139.7, 35.6, 1000, 90, -45, 1, 60]);
    const saved = JSON.parse(JSON.stringify(readCameraState(asCore(core))));
    applyCameraState(asCore(core), saved);
    expect(core.changeCamera).toHaveBeenCalledWith(
      new Float64Array([139.7, 35.6, 1000]),
      -45,
      90,
      1,
      undefined,
    );
    expect(core.setFrustum).toHaveBeenCalledWith(60, undefined, undefined);
  });
});

describe("applyCameraState", () => {
  it("changes only the fov for a fov-only call", () => {
    // A camera change would stop a flight and inertia.
    const core = mockCore();
    applyCameraState(asCore(core), { fov: 30 });
    expect(core.changeCamera).not.toHaveBeenCalled();
    expect(core.setFrustum).toHaveBeenCalledWith(30, undefined, undefined);
  });

  it("leaves the fov alone when not given", () => {
    const core = mockCore();
    applyCameraState(asCore(core), { heading: 90 });
    expect(core.changeCamera).toHaveBeenCalledWith(
      null,
      undefined,
      90,
      undefined,
      undefined,
    );
    expect(core.setFrustum).not.toHaveBeenCalled();
  });

  it("ignores an invalid fov", () => {
    const core = mockCore();
    for (const fov of [Number.NaN, 0, 180, Infinity]) {
      applyCameraState(asCore(core), { fov });
    }
    expect(core.setFrustum).not.toHaveBeenCalled();
    expect(core.changeCamera).not.toHaveBeenCalled();
  });

  it("sends no position unless lng and lat are finite", () => {
    const core = mockCore();
    applyCameraState(asCore(core), { lng: 139.7, lat: Number.NaN });
    expect(core.changeCamera).not.toHaveBeenCalled();
    applyCameraState(asCore(core), { lng: 139.7, lat: 35.6 });
    expect(core.changeCamera).toHaveBeenCalledWith(
      new Float64Array([139.7, 35.6, 0]),
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it("does nothing without a core", () => {
    expect(() => applyCameraState(undefined, { fov: 30 })).not.toThrow();
  });
});

describe("isValidFov", () => {
  it("takes 1 to 179 degrees", () => {
    expect(isValidFov(1)).toBe(true);
    expect(isValidFov(179)).toBe(true);
    expect(isValidFov(0.5)).toBe(false);
    expect(isValidFov(180)).toBe(false);
    expect(isValidFov(Number.NaN)).toBe(false);
  });
});
