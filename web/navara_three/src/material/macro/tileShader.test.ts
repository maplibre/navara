import { describe, expect, it } from "vitest";

import {
  generateTileCommonInjection,
  generateTileMapFragment,
  generateTileNormalFragmentMaps,
  type TileShaderFeatures,
  WATERMASK_OCEAN_REFLECTIVITY,
} from "./tileShader";

const FEATURES_OFF: TileShaderFeatures = {
  hasHillshade: false,
  hasWater: false,
  hasWatermask: false,
};

describe("generateTileCommonInjection", () => {
  it("declares the three atlas samplers", () => {
    const src = generateTileCommonInjection(8);
    expect(src).toContain("uniform sampler2D uColorAtlas;");
    expect(src).toContain("uniform sampler2D uAttrAtlas;");
    expect(src).toContain("uniform sampler2D uNormalAtlas;");
  });

  it("sizes per-slot uniform arrays to the requested slot count", () => {
    const src = generateTileCommonInjection(16);
    expect(src).toContain("uniform float uShininesses[16];");
    expect(src).toContain("uniform vec3 uEmissiveColors[16];");
    expect(src).toContain("uniform float uEffectIdsMasks[16];");
  });
});

describe("generateTileMapFragment", () => {
  const src = generateTileMapFragment(16, FEATURES_OFF);

  it("discards fragments outside the fill quadrants", () => {
    expect(src).toContain("if (uFillQuadrants != 0) {");
    expect(src).toContain("discard;");
  });

  it("samples each atlas exactly once", () => {
    const colorMatches = src.match(/texture2D\(uColorAtlas/g) ?? [];
    const attrMatches = src.match(/texture2D\(uAttrAtlas/g) ?? [];
    expect(colorMatches.length).toBe(1);
    expect(attrMatches.length).toBe(1);
  });

  it("decodes winning slot from attr.a as (n*255) - 1", () => {
    expect(src).toContain("int winIdx = int(round(atlasAttr.a * 255.0)) - 1;");
  });

  it("masks colour by attr.g and snapshots into nvr_pickColor on picking pass", () => {
    // Raster pixels contribute 0 (no entity); vector pixels keep the pick
    // ID written into atlasColor by the per-layer RT pass. We snapshot the
    // masked value BEFORE the diffuse merge so the dithering-stage override
    // writes it straight to gl_FragColor without lighting/tonemapping/fog
    // corruption.
    expect(src).toContain("if (uPickable > 0.)");
    expect(src).toContain("atlasColor.rgb *= atlasAttr.g;");
    expect(src).toContain("vec3 nvr_pickColor = atlasColor.rgb;");
  });

  it("indexes per-slot uniforms with winIdx (no loop)", () => {
    expect(src).toContain("uShininesses[winIdx]");
    expect(src).toContain("uReflectivities[winIdx]");
    // Should not loop over slots — the dynamic index is the whole point.
    expect(src).not.toMatch(/for\s*\(/);
  });

  it("uses premultiplied 'over' blend so transparent atlas keeps base color", () => {
    // src.rgb + dst * (1 - src.a) — NOT mix(dst, src.rgb, src.a). Mixing
    // would double-apply alpha because the composite already premultiplies.
    expect(src).toContain(
      "diffuseColor.rgb = atlasColor.rgb + diffuseColor.rgb * (1.0 - atlasColor.a);",
    );
    expect(src).not.toMatch(/mix\(diffuseColor\.rgb,\s*atlasColor\.rgb/);
  });

  it("omits the ocean reflectivity fallback when no watermask is present", () => {
    expect(src).not.toContain("useWater && !hasSlotWaterParams");
  });

  it("overrides reflectivity/roughness on watermask water pixels", () => {
    // Watermask water under a raster winner (or no winner – open ocean) must
    // clear the SSR mask threshold; a texturized (vector) winner keeps its own
    // per-slot params.
    const masked = generateTileMapFragment(16, {
      ...FEATURES_OFF,
      hasWatermask: true,
    });
    expect(masked).toContain("if (useWater && !hasSlotWaterParams)");
    expect(masked).toContain(
      `tileReflectivity = ${WATERMASK_OCEAN_REFLECTIVITY.toFixed(4)};`,
    );
    // The override must land AFTER the per-slot reads so it wins.
    expect(
      masked.indexOf("if (useWater && !hasSlotWaterParams)"),
    ).toBeGreaterThan(masked.indexOf("uReflectivities[winIdx]"));
  });
});

describe("generateTileNormalFragmentMaps", () => {
  it("omits the hillshade lookup entirely when hasHillshade is off", () => {
    const src = generateTileNormalFragmentMaps({
      ...FEATURES_OFF,
      hasHillshade: false,
      hasWater: false,
    });
    expect(src).not.toContain("uNormalAtlas");
    expect(src).not.toContain("TBN");
  });

  it("samples uNormalAtlas exactly once when hasHillshade is on", () => {
    const src = generateTileNormalFragmentMaps({
      ...FEATURES_OFF,
      hasHillshade: true,
      hasWater: false,
    });
    const matches = src.match(/texture2D\(uNormalAtlas/g) ?? [];
    expect(matches.length).toBe(1);
    expect(src).toContain("atlasNormalSample.a > 0.5");
    expect(src).toContain("uHillshadeExaggeration");
  });

  it("omits water specular call when hasWater is off", () => {
    const src = generateTileNormalFragmentMaps({
      ...FEATURES_OFF,
      hasHillshade: false,
      hasWater: false,
    });
    expect(src).not.toContain("computeWaterSpecular");
    expect(src).toContain("computeSpecular(");
  });

  it("emits computeWaterSpecular when hasWater is on", () => {
    const src = generateTileNormalFragmentMaps({
      ...FEATURES_OFF,
      hasHillshade: false,
      hasWater: true,
    });
    expect(src).toContain("computeWaterSpecular(");
  });
});
