import {
  DirectionalLight,
  Euler,
  Matrix4,
  ShaderChunk,
  ShaderLib,
  Vector3,
  Vector4,
} from "three";
import { describe, expect, it } from "vitest";

import {
  applyViewSpaceShadowReceive,
  composeViewSpaceShadowMatrices,
  VIEW_SPACE_SHADOW_DEFINE,
} from "./viewSpaceShadowReceive";

function makeLightWithShadowMatrix(matrix: Matrix4): DirectionalLight {
  const light = new DirectionalLight();
  light.shadow.matrix.copy(matrix);
  return light;
}

// A plausible shadow matrix: bias * ortho projection * light view with a
// large ECEF-scale translation.
function makeEcefScaleShadowMatrix(): Matrix4 {
  return new Matrix4()
    .makeRotationY(0.7)
    .multiply(new Matrix4().makeScale(1 / 250, 1 / 250, 1 / 5000))
    .multiply(new Matrix4().makeTranslation(-6378137.2, -12345.6, 78901.2));
}

describe("composeViewSpaceShadowMatrices", () => {
  it("produces matrices equivalent to sampling with the absolute world position", () => {
    const shadowMatrix = makeEcefScaleShadowMatrix();
    // A camera at ECEF magnitude looking somewhere.
    const cameraMatrixWorld = new Matrix4()
      .makeRotationFromEuler(new Euler(0.3, -1.1, 0.05))
      .setPosition(6378137.125, 12345.75, -78901.0625);

    const matrices: Matrix4[] = [];
    composeViewSpaceShadowMatrices(
      [makeLightWithShadowMatrix(shadowMatrix)],
      cameraMatrixWorld,
      matrices,
    );

    // A world point ~50 m from the camera, expressed both ways.
    const worldPosition = new Vector4(
      6378137.125 + 12.5,
      12345.75 - 37.25,
      -78901.0625 + 21.0,
      1,
    );
    const viewPosition = worldPosition
      .clone()
      .applyMatrix4(cameraMatrixWorld.clone().invert());

    const viaView = viewPosition.clone().applyMatrix4(matrices[0]);
    const viaWorld = worldPosition.clone().applyMatrix4(shadowMatrix);
    expect(viaView.x).toBeCloseTo(viaWorld.x, 6);
    expect(viaView.y).toBeCloseTo(viaWorld.y, 6);
    expect(viaView.z).toBeCloseTo(viaWorld.z, 6);
    expect(viaView.w).toBeCloseTo(viaWorld.w, 6);
  });

  it("reuses existing matrices and trims the array to the light count", () => {
    const matrices: Matrix4[] = [];
    const lights = [
      makeLightWithShadowMatrix(new Matrix4()),
      makeLightWithShadowMatrix(new Matrix4()),
    ];
    const cameraMatrixWorld = new Matrix4().setPosition(new Vector3(1, 2, 3));

    composeViewSpaceShadowMatrices(lights, cameraMatrixWorld, matrices);
    expect(matrices).toHaveLength(2);
    const first = matrices[0];

    composeViewSpaceShadowMatrices(
      lights.slice(0, 1),
      cameraMatrixWorld,
      matrices,
    );
    expect(matrices).toHaveLength(1);
    // Same instance mutated in place, no per-frame allocation.
    expect(matrices[0]).toBe(first);
  });
});

describe("applyViewSpaceShadowReceive", () => {
  const uniform = { value: [] as Matrix4[] };

  const litVertexShader = [
    "#include <common>",
    "#include <shadowmap_pars_vertex>",
    "void main() {",
    "#include <shadowmap_vertex>",
    "}",
  ].join("\n");

  it("rewrites the directional shadow loop against the view-space matrices", () => {
    const shader = {
      vertexShader: litVertexShader,
      fragmentShader: "",
      uniforms: {} as Record<string, { value: unknown }>,
    };

    applyViewSpaceShadowReceive(shader, uniform);

    expect(shader.uniforms.nvrCsmShadowMatrixView).toBe(uniform);
    expect(shader.fragmentShader).toContain(
      `#define ${VIEW_SPACE_SHADOW_DEFINE}`,
    );
    // Sized to the cascade count: additional shadow-casting directional
    // lights beyond the cascades are not part of the composed array.
    expect(shader.vertexShader).toContain(
      "uniform mat4 nvrCsmShadowMatrixView[ CSM_CASCADE_COUNT ];",
    );
    expect(shader.vertexShader).toContain(
      "vDirectionalShadowCoord[ i ] = nvrCsmShadowMatrixView[ i ] * shadowWorldPosition;",
    );
    expect(shader.vertexShader).toContain(
      "shadowWorldPosition = vec4( mvPosition.xyz + ( viewMatrix * vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0.0 ) ).xyz, 1.0 );",
    );
    // Guards against upstream chunk drift: the patched chunk must still be
    // derived from the current three.js source.
    expect(ShaderChunk.shadowmap_vertex).toContain(
      "vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;",
    );
  });

  it("keeps the stock path for extra directional lights and point shadows", () => {
    const shader = {
      vertexShader: litVertexShader,
      fragmentShader: "",
      uniforms: {} as Record<string, { value: unknown }>,
    };

    applyViewSpaceShadowReceive(shader, uniform);

    // Cascade indices branch on the view-space path; any shadow-casting
    // directional light beyond CSM_CASCADE_COUNT falls back to the stock
    // matrices managed by three.js (the composed array doesn't cover them).
    expect(shader.vertexShader).toContain(
      "#if UNROLLED_LOOP_INDEX < CSM_CASCADE_COUNT",
    );
    expect(shader.vertexShader).toContain(
      "vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;",
    );
    expect(shader.vertexShader).toContain(
      "shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );",
    );
    // Point shadows keep the stock loop untouched.
    expect(shader.vertexShader).toContain(
      "vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;",
    );
    // Standalone use (no CSM defines) treats every directional shadow as
    // camera-composed via the fallback define.
    expect(shader.vertexShader).toContain(
      "#define CSM_CASCADE_COUNT NUM_DIR_LIGHT_SHADOWS",
    );
  });

  it("skips shadow-map depth pass variants", () => {
    const shader = {
      vertexShader: litVertexShader,
      fragmentShader: "",
      defines: { USE_SHADOWMAP_DEPTH: 1 } as Record<string, unknown>,
      uniforms: {} as Record<string, { value: unknown }>,
    };

    applyViewSpaceShadowReceive(shader, uniform);

    expect(shader.vertexShader).toBe(litVertexShader);
    expect(shader.uniforms.nvrCsmShadowMatrixView).toBeUndefined();
  });

  it("leaves shaders without shadowmap_vertex untouched", () => {
    const source = "#include <common>\nvoid main() {}";
    const shader = {
      vertexShader: source,
      fragmentShader: "",
      uniforms: {} as Record<string, { value: unknown }>,
    };

    applyViewSpaceShadowReceive(shader, uniform);

    expect(shader.vertexShader).toBe(source);
    expect(shader.fragmentShader).toBe("");
    expect(shader.uniforms.nvrCsmShadowMatrixView).toBeUndefined();
  });

  // The patch is applied centrally to every material registered for CSM
  // (MaterialStates.setup), so it must hold for the real vertex shader of
  // every three.js built-in material — the same source onBeforeCompile
  // receives. These fixtures pin that compatibility so a three.js upgrade
  // that changes the ShaderLib surfaces here instead of at runtime.

  // Materials that receive shadows (their shader has the shadowmap chunks).
  const SHADOW_RECEIVING_SHADERS = [
    "lambert", // MeshLambertMaterial
    "phong", // MeshPhongMaterial
    "standard", // MeshStandardMaterial
    "physical", // MeshPhysicalMaterial
    "toon", // MeshToonMaterial
    "shadow", // ShadowMaterial
  ] as const;

  // Everything else must pass through untouched (unlit, depth/distance,
  // points/lines/sprites, background/env shaders).
  const NON_RECEIVING_SHADERS = Object.keys(ShaderLib).filter(
    (name) => !(SHADOW_RECEIVING_SHADERS as readonly string[]).includes(name),
  );

  it.each(SHADOW_RECEIVING_SHADERS)(
    "patches the built-in '%s' material shader with mvPosition in scope",
    (name) => {
      const shader = {
        vertexShader: ShaderLib[name].vertexShader,
        fragmentShader: ShaderLib[name].fragmentShader,
        uniforms: {} as Record<string, { value: unknown }>,
      };

      applyViewSpaceShadowReceive(shader, uniform);

      expect(shader.uniforms.nvrCsmShadowMatrixView).toBe(uniform);
      const samplingIndex = shader.vertexShader.indexOf(
        "vDirectionalShadowCoord[ i ] = nvrCsmShadowMatrixView[ i ]",
      );
      expect(samplingIndex).toBeGreaterThan(-1);
      // mvPosition must already be declared where the patched code reads it.
      const projectIndex = shader.vertexShader.indexOf(
        "#include <project_vertex>",
      );
      expect(projectIndex).toBeGreaterThan(-1);
      expect(projectIndex).toBeLessThan(samplingIndex);
    },
  );

  it.each(NON_RECEIVING_SHADERS)(
    "leaves the built-in '%s' material shader untouched",
    (name) => {
      const source = ShaderLib[name as keyof typeof ShaderLib].vertexShader;
      const shader = {
        vertexShader: source,
        fragmentShader: "",
        uniforms: {} as Record<string, { value: unknown }>,
      };

      applyViewSpaceShadowReceive(shader, uniform);

      expect(shader.vertexShader).toBe(source);
      expect(shader.uniforms.nvrCsmShadowMatrixView).toBeUndefined();
    },
  );
});
