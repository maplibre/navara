import type { Globe } from "@navaramap/core";
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";

import { NVR_UNLIT_SCENE_DEFINE } from "../material";
import {
  USE_GBUFFER_SHADOW_DEFINE,
  resolveGBufferOptions,
} from "../material/gbufferLayout";
import type { Scenes } from "../scene";

import { CustomRenderPass } from "./CustomRenderPass";

const createScenes = (): Scenes => ({
  light: new Group(),
  mrt: new Scene(),
  globe: new Scene(),
  draped: new Scene(),
  opaque: new Scene(),
  transparent: new Scene(),
  skyEnvMap: new Scene(),
});

const addMesh = (scene: Scene): MeshStandardMaterial => {
  const material = new MeshStandardMaterial();
  scene.add(new Mesh(undefined, material));
  return material;
};

const createPass = (scenes: Scenes, lit: boolean) =>
  new CustomRenderPass(
    scenes,
    new PerspectiveCamera(),
    new WebGLRenderTarget(1, 1),
    {} as Globe,
    { buffers: resolveGBufferOptions({ shadow: true }), lit },
  );

// Regression: `view.lit` was stamped on the G-buffer scenes only, so meshes
// in the forward-only scenes – the default routing - stayed lit.
describe("stampGBufferDefines", () => {
  it("stamps the scene lit default on both G-buffer and forward-only scenes", () => {
    const scenes = createScenes();
    const mrtMaterial = addMesh(scenes.mrt);
    const opaqueMaterial = addMesh(scenes.opaque);
    const transparentMaterial = addMesh(scenes.transparent);

    const pass = createPass(scenes, false);
    pass["stampGBufferDefines"]();

    for (const material of [mrtMaterial, opaqueMaterial, transparentMaterial]) {
      expect(material.defines?.[NVR_UNLIT_SCENE_DEFINE]).toBe(1);
    }
  });

  it("keeps the G-buffer defines out of the forward-only scenes", () => {
    const scenes = createScenes();
    const mrtMaterial = addMesh(scenes.mrt);
    const opaqueMaterial = addMesh(scenes.opaque);

    const pass = createPass(scenes, true);
    pass["stampGBufferDefines"]();

    expect(mrtMaterial.defines?.[USE_GBUFFER_SHADOW_DEFINE]).toBe(1);
    // Single-attachment target – the extra outputs would be undeclared.
    expect(opaqueMaterial.defines?.[USE_GBUFFER_SHADOW_DEFINE] ?? false).toBe(
      false,
    );
  });

  it("stamps the G-buffer defines when a material moves from opaque to mrt", () => {
    const scenes = createScenes();
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(undefined, material);
    scenes.opaque.add(mesh);

    const pass = createPass(scenes, true);
    pass["stampGBufferDefines"]();

    // A shared "already stamped" set would leave it without the outputs.
    scenes.opaque.remove(mesh);
    scenes.mrt.add(mesh);
    pass["stampGBufferDefines"]();

    expect(material.defines?.[USE_GBUFFER_SHADOW_DEFINE]).toBe(1);
  });

  it("clears the G-buffer defines when a material moves from mrt to opaque", () => {
    const scenes = createScenes();
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(undefined, material);
    scenes.mrt.add(mesh);

    const pass = createPass(scenes, true);
    pass["stampGBufferDefines"]();
    expect(material.defines?.[USE_GBUFFER_SHADOW_DEFINE]).toBe(1);

    scenes.mrt.remove(mesh);
    scenes.opaque.add(mesh);
    pass["stampGBufferDefines"]();

    expect(material.defines).not.toHaveProperty(USE_GBUFFER_SHADOW_DEFINE);

    // And back again: the cleared material is stamped afresh.
    scenes.opaque.remove(mesh);
    scenes.mrt.add(mesh);
    pass["stampGBufferDefines"]();

    expect(material.defines?.[USE_GBUFFER_SHADOW_DEFINE]).toBe(1);
  });

  it("keeps the G-buffer defines on a material shared by both scene sets", () => {
    const scenes = createScenes();
    const material = new MeshStandardMaterial();
    scenes.mrt.add(new Mesh(undefined, material));
    scenes.opaque.add(new Mesh(undefined, material));

    const pass = createPass(scenes, true);
    pass["stampGBufferDefines"]();

    expect(material.defines?.[USE_GBUFFER_SHADOW_DEFINE]).toBe(1);
  });

  it("stamps a material added inside a scene-resident group", () => {
    const scenes = createScenes();
    const group = new Group();
    scenes.mrt.add(group);
    const pass = createPass(scenes, true);
    pass["stampGBufferDefines"]();

    const added = new MeshStandardMaterial();
    group.add(new Mesh(undefined, added));
    pass["stampGBufferDefines"]();

    expect(added.defines?.[USE_GBUFFER_SHADOW_DEFINE]).toBe(1);
  });

  it("stamps a material swapped in place on a mesh already in the scene", () => {
    const scenes = createScenes();
    const mesh = new Mesh(undefined, new MeshStandardMaterial());
    scenes.mrt.add(mesh);
    const pass = createPass(scenes, true);
    pass["stampGBufferDefines"]();

    const replaced = new MeshStandardMaterial();
    mesh.material = replaced;
    pass["stampGBufferDefines"]();

    expect(replaced.defines?.[USE_GBUFFER_SHADOW_DEFINE]).toBe(1);
  });

  it("restamps every material after setLit", () => {
    const scenes = createScenes();
    const opaqueMaterial = addMesh(scenes.opaque);

    const pass = createPass(scenes, true);
    pass["stampGBufferDefines"]();
    expect(opaqueMaterial.defines?.[NVR_UNLIT_SCENE_DEFINE] ?? false).toBe(
      false,
    );

    pass.setLit(false);
    pass["stampGBufferDefines"]();
    expect(opaqueMaterial.defines?.[NVR_UNLIT_SCENE_DEFINE]).toBe(1);
  });
});

describe("globe-normal copy target", () => {
  const size = (pass: CustomRenderPass) =>
    pass.globeNormalCopyPass.texture.image as { width: number; height: number };

  it("stays 1x1 while no draped mesh exists, even across a resize", () => {
    const pass = createPass(createScenes(), true);
    pass.setSize(800, 600);

    expect(size(pass).width).toBe(1);
    expect(size(pass).height).toBe(1);
  });

  it("applies the size stored while inactive once a draped mesh appears", () => {
    const pass = createPass(createScenes(), true);
    pass.setSize(800, 600);

    pass["setGlobeNormalActive"](true);

    expect(size(pass).width).toBe(800);
    expect(size(pass).height).toBe(600);
  });

  it("shrinks back when the last draped mesh goes away", () => {
    const pass = createPass(createScenes(), true);
    pass.setSize(800, 600);
    pass["setGlobeNormalActive"](true);

    pass["setGlobeNormalActive"](false);

    expect(size(pass).width).toBe(1);
    expect(size(pass).height).toBe(1);
  });
});
