import type ThreeView from "@navaramap/three";
import type { ViewContext } from "@navaramap/three";
import { AdditiveBlending, BufferGeometry, ShaderMaterial } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StreetTrafficMeshDesc,
  type StreetTrafficData,
} from "./StreetTrafficMeshDesc";

// Importing the real @navaramap/three touches WASM/os at module load, which
// fails in the test environment. The base class is stubbed down to the hooks
// the desc overrides: `onCreate` builds the instance, `onDestroy` drops it.
vi.mock("@navaramap/three", () => ({
  MeshDesc: class MeshDesc {
    protected _instance?: unknown;
    protected view: unknown;
    protected ctx: unknown;
    constructor(view: unknown, ctx: unknown) {
      this.view = view;
      this.ctx = ctx;
    }
    get raw() {
      return this._instance;
    }
    createMesh(): unknown {
      return undefined;
    }
    onCreate() {
      this._instance = this.createMesh();
    }
    onUpdateConfig() {}
    onDestroy() {
      this._instance = undefined;
    }
  },
}));

const data = (): StreetTrafficData => ({
  start: new Float32Array([0, 0, 0, 1, 1, 1]),
  end: new Float32Array([10, 0, 0, 11, 1, 1]),
  phase: new Float32Array([0, 0.5]),
  speed: new Float32Array([10, 12]),
});

// The desc reads the camera's field of view and the viewport uniform only.
const view = { camera: { raw: { fov: 60 } } } as ThreeView;
const viewport: { value: [number, number, number] | null | undefined } = {
  value: [1200, 750, 2],
};
const ctx = { getViewportAndPixelRatioUniform: () => viewport } as ViewContext;

const create = (options: { speed?: number; size?: number } = {}) => {
  const desc = new StreetTrafficMeshDesc(view, ctx, {
    streetTraffic: { data: data(), ...options },
  });
  desc.onCreate();
  const points = desc.raw;
  if (!points) throw new Error("no instance");
  return { desc, points };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StreetTrafficMeshDesc", () => {
  it("requires the streetTraffic configuration", () => {
    expect(() => new StreetTrafficMeshDesc(view, ctx, {})).toThrow(
      /configuration is required/,
    );
  });

  it("builds additive points with one segment per car", () => {
    const { points } = create();

    expect(points.geometry.getAttribute("position").itemSize).toBe(3);
    expect(points.geometry.getAttribute("nvrEnd").itemSize).toBe(3);
    expect(points.geometry.getAttribute("nvrPhase").itemSize).toBe(1);
    expect(points.geometry.getAttribute("nvrSpeed").itemSize).toBe(1);
    expect(points.geometry.getAttribute("position").count).toBe(2);
    expect(points.material.blending).toBe(AdditiveBlending);
    expect(points.material.depthWrite).toBe(false);
    expect(points.frustumCulled).toBe(false);
    expect(points.material.uniforms.nvrSpeedScale.value).toBe(1);
    expect(points.material.uniforms.nvrSize.value).toBe(2.5);
    expect(points.material.uniforms.nvrViewport).toBe(viewport);
  });

  it("drives the clock and the field of view every frame", () => {
    const { desc, points } = create();
    desc.update(2000);
    expect(points.material.uniforms.nvrTime.value).toBe(2);
    expect(points.material.uniforms.nvrTanHalfFov.value).toBeCloseTo(
      Math.tan(Math.PI / 6),
    );
  });

  it("applies option updates to the uniforms", () => {
    const { desc, points } = create({ size: 4 });
    desc.onUpdateConfig({ streetTraffic: { speed: 3 } });
    expect(points.material.uniforms.nvrSpeedScale.value).toBe(3);
    expect(points.material.uniforms.nvrSize.value).toBe(4);
  });

  it("disposes the geometry and material with the mesh", () => {
    const geometry = vi.spyOn(BufferGeometry.prototype, "dispose");
    const material = vi.spyOn(ShaderMaterial.prototype, "dispose");
    const { desc } = create();
    desc.onDestroy();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(desc.raw).toBeUndefined();
  });
});
