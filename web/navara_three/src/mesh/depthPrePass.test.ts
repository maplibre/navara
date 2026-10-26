import {
  AlwaysStencilFunc,
  BoxGeometry,
  KeepStencilOp,
  Mesh,
  MeshLambertMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  type Camera,
  type Group,
  type Scene,
  type WebGLRenderer,
} from "three";
import { describe, expect, it, vi } from "vitest";

import { NVR_BLENDED_DEFINE } from "../material";
import { DEPTH_PRE_PASS_RENDER_ORDER } from "../renderOrder";

import { DepthPrePassMesh } from "./depthPrePass";

function setup() {
  const material = new MeshLambertMaterial({ transparent: true });
  const owner = new Mesh(new BoxGeometry(1, 1, 1), material);
  owner.onBeforeRender = vi.fn();
  const prePass = new DepthPrePassMesh(owner);
  const render = () =>
    prePass.onBeforeRender(
      {} as WebGLRenderer,
      {} as Scene,
      {} as Camera,
      prePass.geometry,
      prePass.material,
      {} as Group,
    );
  return { owner, material, prePass, render };
}

describe("DepthPrePassMesh", () => {
  it("writes depth only, in the opaque list after the other opaque meshes", () => {
    const { prePass } = setup();

    expect(prePass.material.transparent).toBe(false);
    expect(prePass.material.colorWrite).toBe(false);
    expect(prePass.renderOrder).toBe(DEPTH_PRE_PASS_RENDER_ORDER);
  });

  it("follows the owner's wireframe", () => {
    const { material, prePass, render } = setup();
    material.wireframe = true;

    render();

    expect(prePass.material.wireframe).toBe(true);
  });

  it("copies the owner's defines, unblended, only after the owner recompiles", () => {
    const { owner, material, prePass, render } = setup();
    material.defines = { USE_BATCH_COLOR: true, [NVR_BLENDED_DEFINE]: 1 };

    render();
    expect(prePass.material.defines?.USE_BATCH_COLOR).toBeUndefined();

    material.needsUpdate = true;
    const version = prePass.material.version;
    render();
    expect(prePass.material.defines).toEqual({
      USE_BATCH_COLOR: true,
      [NVR_BLENDED_DEFINE]: false,
    });
    expect(prePass.material.version).toBe(version + 1);
    expect(owner.onBeforeRender).toHaveBeenCalledTimes(2);
  });

  it("lets the owner draw once per pixel through the stencil", () => {
    const { material } = setup();

    expect(material.stencilWrite).toBe(true);
    expect(material.stencilFunc).toBe(NotEqualStencilFunc);
    // The stencil is cleared to 0 before the MRT scene.
    expect(material.stencilRef).not.toBe(0);
    expect(material.stencilZPass).toBe(ReplaceStencilOp);
    expect(material.stencilZFail).toBe(KeepStencilOp);
    expect(material.stencilFail).toBe(KeepStencilOp);
  });

  it("leaves the stencil alone in its own depth pass, even when rebuilt", () => {
    const { owner, prePass } = setup();
    const rebuilt = new DepthPrePassMesh(owner);

    expect(prePass.material.stencilWrite).toBe(false);
    expect(rebuilt.material.stencilWrite).toBe(false);
  });

  it("restores the owner's stencil state on dispose", () => {
    const { material, prePass } = setup();

    prePass.dispose();

    expect(material.stencilWrite).toBe(false);
    expect(material.stencilFunc).toBe(AlwaysStencilFunc);
    expect(material.stencilRef).toBe(0);
    expect(material.stencilZPass).toBe(KeepStencilOp);
  });
});
