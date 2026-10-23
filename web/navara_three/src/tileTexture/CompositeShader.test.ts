import { describe, expect, it } from "vitest";

import {
  compositeSlotMarker,
  generateCompositeFragmentShader,
} from "./CompositeShader";

const ALL_OFF = {
  hasHillshade: false,
  hasWater: false,
  hasElevationHeatmap: false,
  hasWatermask: false,
};

describe("generateCompositeFragmentShader", () => {
  it("emits MRT layout declarations for all three attachments", () => {
    const src = generateCompositeFragmentShader(2, 2, 2, ALL_OFF);
    expect(src).toContain("layout(location = 0) out vec4 colorBuffer;");
    expect(src).toContain("layout(location = 1) out vec4 attrBuffer;");
    expect(src).toContain("layout(location = 2) out vec4 normalBuffer;");
  });

  it("emits rasterCount + vectorCount compact slot blocks", () => {
    const src = generateCompositeFragmentShader(2, 1, 24, ALL_OFF);
    // Compact slot 0,1 are raster (absSlot 0,1); slot 2 is vector (absSlot 24).
    expect(src).toContain(compositeSlotMarker(0, 0, false));
    expect(src).toContain(compositeSlotMarker(1, 1, false));
    expect(src).toContain(compositeSlotMarker(2, 24, true));
    expect(src).not.toContain("compact slot 3");
  });

  it("bakes the absolute slot index into winningSlot so winIdx stays correct in the main shader", () => {
    // raster=1, vector=2, boundary=24 → compact 0=abs0, compact 1=abs24, compact 2=abs25.
    const src = generateCompositeFragmentShader(1, 2, 24, ALL_OFF);
    expect(src).toContain(compositeSlotMarker(0, 0, false));
    expect(src).toContain(compositeSlotMarker(1, 24, true));
    expect(src).toContain(compositeSlotMarker(2, 25, true));
    expect(src).toMatch(/winningSlot = 0;[\s\S]*isTexturized = 0\.0;/);
    expect(src).toMatch(/winningSlot = 24;[\s\S]*isTexturized = 1\.0;/);
    expect(src).toMatch(/winningSlot = 25;[\s\S]*isTexturized = 1\.0;/);
  });

  it("sizes uniform arrays to (rasterCount + vectorCount)", () => {
    const src = generateCompositeFragmentShader(2, 3, 24, ALL_OFF);
    expect(src).toContain("uniform int uShows[5];");
    expect(src).toContain("uniform sampler2D uTextures[5];");
  });

  it("elides hillshade uniforms and code when feature is off", () => {
    const src = generateCompositeFragmentShader(2, 2, 2, ALL_OFF);
    expect(src).not.toContain("uIsHillshades");
    expect(src).not.toContain("uHillshadeExaggeration");
    expect(src).not.toContain("hillshadeNormal = n0");
  });

  it("includes hillshade normal sampling per compact slot when feature is on", () => {
    const src = generateCompositeFragmentShader(2, 0, 24, {
      ...ALL_OFF,
      hasHillshade: true,
    });
    expect(src).toContain("uniform bool uIsHillshades[2];");
    expect(src).toContain("uniform float uHillshadeExaggeration;");
    expect(src).toContain("hillshadeNormal = n0 * 0.5 + 0.5;");
    expect(src).toContain("hillshadeNormal = n1 * 0.5 + 0.5;");
    // Hillshade slots must contribute no color to the composite.
    expect(src).toContain(
      "if (uIsHillshades[0]) {\n      texColor0 = vec4(0.0)",
    );
  });

  it("elides water uniforms and writes constant isWater when off", () => {
    const src = generateCompositeFragmentShader(2, 0, 24, ALL_OFF);
    expect(src).not.toContain("uWaters");
    expect(src).toContain("float isWater = 0.0;");
    expect(src).not.toContain("isWater = uWaters[0]");
  });

  it("writes per-slot water flag when water is on", () => {
    const src = generateCompositeFragmentShader(2, 0, 24, {
      ...ALL_OFF,
      hasWater: true,
    });
    expect(src).toContain("uniform bool uWaters[2];");
    expect(src).toContain("isWater = uWaters[0] ? 1.0 : 0.0;");
    expect(src).toContain("isWater = uWaters[1] ? 1.0 : 0.0;");
    // Precision-sensitive water params live in TileMesh's uniform arrays.
    expect(src).not.toContain("uWaterScaleNormals");
    expect(src).not.toContain("uWaterSpeeds");
  });

  it("elides elevation heatmap uniforms/sampling when off", () => {
    const src = generateCompositeFragmentShader(2, 0, 24, ALL_OFF);
    expect(src).not.toContain("uIsElevationHeatmaps");
    expect(src).not.toContain("uColorMapTexture");
    expect(src).not.toContain("sampleElevationBilinear");
  });

  it("emits elevation heatmap branch + colormap sample when on", () => {
    const src = generateCompositeFragmentShader(2, 0, 24, {
      ...ALL_OFF,
      hasElevationHeatmap: true,
    });
    expect(src).toContain("uniform vec4 uElevationHeatmapParams[2];");
    expect(src).toContain("uniform sampler2D uColorMapTexture;");
    expect(src).toContain("bool isHeatmap0 = params0.x > 0.5;");
    expect(src).toContain("sampleElevationBilinear(uTextures[0]");
  });

  it("encodes (winningSlot + 1) / 255 in attr.a", () => {
    const src = generateCompositeFragmentShader(1, 0, 24, ALL_OFF);
    expect(src).toContain("float(winningSlot + 1) / 255.0");
  });

  it("elides watermask uniform and sampling when feature is off", () => {
    const src = generateCompositeFragmentShader(2, 0, 24, ALL_OFF);
    expect(src).not.toContain("uWatermask");
    expect(src).not.toContain("step(0.5, texture");
  });

  it("samples watermask after slot loop and OR's into isWater when on", () => {
    const src = generateCompositeFragmentShader(2, 0, 24, {
      ...ALL_OFF,
      hasWater: true,
      hasWatermask: true,
    });
    expect(src).toContain("uniform sampler2D uWatermask;");
    // Watermask priority: max() with step() over the slot-loop result so the
    // watermask flips isWater on even when no slot's uWaters[k] was true.
    expect(src).toMatch(
      /isWater = max\(isWater, step\(0\.5, texture\(uWatermask, vUv\)\.r\)\);/,
    );
  });

  it("emits watermask path even without hasWater (independent feature)", () => {
    // hasWater off → per-slot water flag path is elided; watermask still works
    // because it operates on the always-declared `isWater` variable.
    const src = generateCompositeFragmentShader(1, 0, 24, {
      ...ALL_OFF,
      hasWatermask: true,
    });
    expect(src).not.toContain("uWaters[");
    expect(src).toContain("uniform sampler2D uWatermask;");
    expect(src).toContain("isWater = max(isWater, step(0.5,");
  });

  it("handles vector-only (rasterCount=0) without emitting raster blocks", () => {
    const src = generateCompositeFragmentShader(0, 2, 24, ALL_OFF);
    expect(src).toContain(compositeSlotMarker(0, 24, true));
    expect(src).toContain(compositeSlotMarker(1, 25, true));
    expect(src).not.toContain("raster");
  });

  it("emits watermask-only shader (no slot uniforms) when both counts are 0", () => {
    // Open-ocean tile: no raster + no vector layers, but a quantized-mesh
    // watermask is present. GLSL forbids zero-length arrays so the per-slot
    // declarations must be elided, but uWatermask and the post-loop sample
    // must still be emitted so attr.r ends up flagged as water.
    const src = generateCompositeFragmentShader(0, 0, 24, {
      ...ALL_OFF,
      hasWatermask: true,
    });
    expect(src).not.toContain("uShows[");
    expect(src).not.toContain("uTextures[");
    expect(src).not.toContain("uColors[");
    expect(src).toContain("uniform sampler2D uWatermask;");
    expect(src).toContain("isWater = max(isWater, step(0.5,");
  });
});
