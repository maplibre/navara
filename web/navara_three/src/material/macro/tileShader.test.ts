import { describe, expect, it } from "vitest";

import {
  generateTileCommonInjection,
  generateTileMapFragment,
  generateTileNormalBufferReplacement,
  generateTileNormalFragmentMaps,
  generateTileOutgoingLight,
  type TileShaderFeatures,
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
  const src = generateTileMapFragment(16);

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

  it("makes a vector winner water only through its own water flag", () => {
    // attr.r ORs the watermask in, so a non-water vector layer over the sea
    // would otherwise grow waves.
    expect(src).toContain(
      "vec2 tileWaterParams = (hasWinner && isTexturizedLayer) ? uWaterParams[winIdx] : vec2(uWaterMaskExaggeration, 1.0);",
    );
    expect(src).toContain(
      "bool tileWater = useWater && tileWaterParams.y > 0.5;",
    );
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

  it("omits the water surface when neither water nor a watermask is present", () => {
    const src = generateTileNormalFragmentMaps(FEATURES_OFF);
    expect(src).not.toContain("nvrWaterSurface");
    expect(src).toContain("computeSpecular(");
  });

  it.each([
    ["water layer", { hasWater: true }],
    ["watermask", { hasWatermask: true }],
  ])("emits the water surface for a %s", (_, features) => {
    const src = generateTileNormalFragmentMaps({
      ...FEATURES_OFF,
      ...features,
    });
    expect(src).toContain("nvrWaterSurface(");
    // The sea keeps its waves around a river, and each layer keeps its own.
    expect(src.includes("1 + winIdx - TILE_FIRST_VECTOR_SLOT")).toBe(
      "hasWater" in features,
    );
    // The coordinate takes derivatives, so it stays outside the branch.
    expect(src.indexOf("nvrWaterCoord(")).toBeLessThan(
      src.indexOf("if (tileWater)"),
    );
  });
});

describe("water output", () => {
  const WATERMASK = { ...FEATURES_OFF, hasWatermask: true };

  it("shades water pixels with the water surface", () => {
    expect(generateTileOutgoingLight(WATERMASK)).toContain("nvrWaterShade(");
    expect(generateTileOutgoingLight(FEATURES_OFF)).not.toContain(
      "nvrWaterShade(",
    );
  });

  it("writes the water's reflectance and roughness to the G-buffer", () => {
    const src = generateTileNormalBufferReplacement(WATERMASK);
    expect(src).toContain(
      "GBUFFER_WRITE_NORMAL(nvr_waterSurface.gbufferNormal, NVR_WATER_F0, nvr_waterSurface.gbufferRoughness)",
    );
    expect(generateTileNormalBufferReplacement(FEATURES_OFF)).not.toContain(
      "nvr_waterSurface",
    );
  });
});
