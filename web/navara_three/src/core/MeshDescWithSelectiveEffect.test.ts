import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type ThreeView from "../index";
import { resolveGBufferOptions, type GBufferName } from "../material";
import { initTestEngine } from "../test-utils/engine";

import type { MeshConfig, MeshUpdate } from "./MeshDesc";
import { MeshDescWithSelectiveEffect } from "./MeshDescWithSelectiveEffect";
import type { ViewContext } from "./ViewContext";

// `BaseDesc` generates its id in the engine WASM.
beforeAll(initTestEngine);

class TestMeshDesc extends MeshDescWithSelectiveEffect<
  MeshConfig,
  MeshUpdate,
  Mesh
> {
  createMesh() {
    return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  }
}

/** One active effect per entry: its `static requiresMrtPass`. */
const create = (effects: boolean[], buffers: GBufferName[] = []) => {
  const scenes = {
    opaque: new Scene(),
    transparent: new Scene(),
    mrt: new Scene(),
    skyEnvMap: new Scene(),
    draped: new Scene(),
  };
  const ctx = {
    scenes,
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    applyShadowMaterial: vi.fn(),
    registerPickableMesh: vi.fn(),
    selectiveEffectRegistry: { slotCount: 0, computeMask: () => 0 },
    *_getEffects() {
      for (const requiresMrtPass of effects) {
        yield { ref: { getConstructor: () => ({ requiresMrtPass }) } };
      }
    },
  } as unknown as ViewContext;
  const view = {
    buffers: resolveGBufferOptions(
      Object.fromEntries(buffers.map((name) => [name, true])),
    ),
    sampleTerrainHeight: vi.fn(() => undefined),
    observeTerrainHeightAt: vi.fn(() => () => {}),
  } as unknown as ThreeView;
  const desc = new TestMeshDesc(view, ctx, {});
  desc.onCreate();
  return { desc, scenes };
};

describe("MeshDescWithSelectiveEffect pass", () => {
  it("renders outside the MRT pass when nothing needs it", () => {
    const { desc, scenes } = create([false]);
    expect(desc.raw?.parent).toBe(scenes.opaque);
  });

  it("renders in the MRT pass while an optional buffer is allocated", () => {
    const { desc, scenes } = create([], ["normal"]);
    expect(desc.raw?.parent).toBe(scenes.mrt);
  });

  it("renders in the MRT pass while an effect requires it", () => {
    const { desc, scenes } = create([false, true]);
    expect(desc.raw?.parent).toBe(scenes.mrt);
  });
});
