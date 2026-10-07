import {
  MeshBasicMaterial,
  MeshLambertMaterial,
  ShaderLib,
  type Material,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import { overrideMaterialsForMRT } from "../material";

import {
  DrapedMesh,
  setDrapeGroundNormals,
  setupMaterialForDrape,
} from "./DrapedMesh";

type ShaderStub = Parameters<Material["onBeforeCompile"]>[0];

const compile = (
  material: Material,
  lib: "lambert" | "basic" = "lambert",
): ShaderStub => {
  const shader = {
    name: "",
    uniforms: {},
    vertexShader: ShaderLib[lib].vertexShader,
    fragmentShader: ShaderLib[lib].fragmentShader,
    defines: {},
  } as unknown as ShaderStub;
  material.onBeforeCompile(shader, null as unknown as WebGLRenderer);
  return shader;
};

describe("setupMaterialForDrape", () => {
  it("substitutes the ground normal and position right after normal_fragment_begin", () => {
    overrideMaterialsForMRT();
    const material = new MeshLambertMaterial();
    const globeNormal = { value: null };
    const globeDepth = { value: null };

    setupMaterialForDrape(material, globeNormal, globeDepth);
    const shader = compile(material);

    expect(shader.uniforms.tGlobeNormal).toBe(globeNormal);
    expect(shader.uniforms.tGlobeDepth).toBe(globeDepth);
    const fragment = shader.fragmentShader;
    const normalBegin = fragment.indexOf("#include <normal_fragment_begin>");
    const normalMaps = fragment.indexOf("#include <normal_fragment_maps>");
    // Between the two, so a snapshot taken before normal_fragment_maps (the
    // polygon enhancer's `origNormal`) already holds the ground normal.
    const injected = [
      "textureSize(tGlobeNormal",
      "#define vViewPosition nvrGroundViewPosition",
      "#define vDirectionalShadowCoord nvrGroundShadowCoord",
    ].map((snippet) => {
      const index = fragment.indexOf(snippet);
      return index > normalBegin && index < normalMaps;
    });
    expect(injected).toEqual([true, true, true]);
    // Shadow coordinates are computed in the fragment shader alone.
    expect(shader.vertexShader).not.toContain("nvrGroundShadowCoord");
  });

  it("clamps the depth to the far plane right after the log depth chunks", () => {
    overrideMaterialsForMRT();
    // Unlit too: every draped volume is counted by the stencil passes.
    const material = new MeshBasicMaterial();

    setupMaterialForDrape(material, { value: null }, { value: null });
    const shader = compile(material, "basic");

    // After the final gl_Position and the log depth's read of its `w`.
    const vertex = shader.vertexShader;
    const clamp = vertex.indexOf(
      "gl_Position.z = min(gl_Position.z, gl_Position.w);",
    );
    expect(clamp).toBeGreaterThan(
      vertex.indexOf("#include <logdepthbuf_vertex>"),
    );
    expect(clamp).toBeLessThan(
      vertex.indexOf("#include <clipping_planes_vertex>"),
    );
    const fragment = shader.fragmentShader;
    const fragmentAnchor = fragment.indexOf("#include <logdepthbuf_fragment>");
    expect(
      fragment.indexOf("gl_FragDepth = min(nvrDrapeWindowZ"),
    ).toBeGreaterThan(fragmentAnchor);
    // No ground shading without lights.
    expect(fragment).not.toContain("tGlobeNormal");
  });

  it("injects even when an earlier handler consumes the anchor", () => {
    // navara_three_csm swaps `#include <lights_fragment_begin>` for its
    // cascaded-lights chunk. Delegating to it first left nothing to anchor to,
    // so the substitution silently never happened.
    overrideMaterialsForMRT();
    const material = new MeshLambertMaterial();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_begin>",
        "// cascaded lights",
      );
    };

    setupMaterialForDrape(material, { value: null }, { value: null });
    const shader = compile(material);

    expect(shader.fragmentShader).toContain("textureSize(tGlobeNormal");
    expect(shader.fragmentShader).toContain("// cascaded lights");
  });
});

describe("setDrapeGroundNormals", () => {
  it("switches to the ellipsoid normal and back, recompiling only on change", () => {
    const material = new MeshLambertMaterial();

    setDrapeGroundNormals(material, true);
    expect(material.version).toBe(0);

    setDrapeGroundNormals(material, false);
    expect(material.defines?.NVR_DRAPE_ELLIPSOID_NORMAL).toBe(1);
    expect(material.version).toBe(1);

    setDrapeGroundNormals(material, true);
    expect(material.defines).not.toHaveProperty("NVR_DRAPE_ELLIPSOID_NORMAL");
    expect(material.version).toBe(2);
  });
});

describe("DrapedMesh", () => {
  it("casts no shadow while draped and keeps the setting for undraped", () => {
    const mesh = new DrapedMesh(undefined, undefined, true);
    mesh.castShadow = true;
    expect(mesh.castShadow).toBe(false);

    mesh.drapedEnable = false;
    expect(mesh.castShadow).toBe(true);
  });
});
