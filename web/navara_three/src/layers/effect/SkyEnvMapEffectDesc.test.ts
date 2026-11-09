import { EventHandler } from "@navaramap/core";
import { Mesh, PerspectiveCamera, Scene } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ViewContext } from "../../core/ViewContext";
import type ThreeView from "../../index";
import { initTestEngine } from "../../test-utils/engine";

import { SkyEnvMapEffectDesc } from "./SkyEnvMapEffectDesc";

// `BaseDesc` generates ids through the WASM engine when the config carries
// none, so the module has to be initialized for the constructor to run.
beforeAll(initTestEngine);

function setup() {
  const atmosphere = new EventHandler();
  const skyEnvMap = new Scene();
  skyEnvMap.add(new Mesh());
  const view = {
    atmosphere,
    camera: { raw: new PerspectiveCamera() },
  } as unknown as ThreeView;
  const ctx = {
    scenes: { skyEnvMap },
    getPass: vi.fn(),
    addPass: vi.fn(),
    removePass: vi.fn(),
    insertPassAfter: vi.fn(),
    insertPassBefore: vi.fn(),
  } as unknown as ViewContext;
  const desc = new SkyEnvMapEffectDesc(view, ctx, {});
  desc.onCreate();
  // The pass's own tests cover how a cleared `nextFace` renders the cube.
  const pass = desc.raw as unknown as { nextFace: number | undefined };
  pass.nextFace = 3;
  return { atmosphere, desc, pass };
}

describe("SkyEnvMapEffectDesc", () => {
  it("renders the whole cube once an atmosphere texture arrives", () => {
    const { atmosphere, pass } = setup();

    atmosphere.emit("textureLoaded");

    expect(pass.nextFace).toBeUndefined();
  });

  it("stops listening to the atmosphere once destroyed", () => {
    const { atmosphere, desc, pass } = setup();

    desc.onDestroy();
    atmosphere.emit("textureLoaded");

    expect(pass.nextFace).toBe(3);
    expect(atmosphere.size("textureLoaded")).toBeFalsy();
  });
});
