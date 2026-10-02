import { SDF_PX_SIZE, atlasRangePx } from "@navaramap/font";
import sdfTextFragmentShader from "@shaders/glsl/sdfText.frag.glsl";
import sdfTextVertexShader from "@shaders/glsl/sdfText.vert.glsl";
import { describe, expect, it } from "vitest";

import {
  MSDF_FULL_DETAIL_PPEM,
  MSDF_TRUE_SDF_END_PPEM,
  SMALL_TEXT_SUPERSAMPLE_END_PPEM,
  SMALL_TEXT_SUPERSAMPLE_FULL_PPEM,
  SMALL_TEXT_STEM_DARKEN_END_PPEM,
  SMALL_TEXT_STEM_DARKEN_FULL_PPEM,
  SMALL_TEXT_STEM_DARKEN_MAX_PX,
} from "./coverage";
import { LABEL_ROWS, LabelRow } from "./types";

import { createSdfTextBaseEnhancer, type SupportedMaterial } from ".";

describe("sdfTextBaseEnhancer shader", () => {
  const createMockMaterial = () =>
    ({
      type: "ShaderMaterial",
      userData: {},
    }) as unknown as SupportedMaterial;

  const createMockShader = () => ({
    vertexShader: "",
    fragmentShader: "",
    uniforms: {} as Record<string, { value: unknown }>,
    defines: {} as Record<string, unknown>,
  });

  const transform = (
    props: Parameters<ReturnType<typeof createSdfTextBaseEnhancer>["mount"]>[0],
  ) => {
    const enhancer = createSdfTextBaseEnhancer(createMockMaterial());
    enhancer.mount(props);
    const shader = createMockShader();
    enhancer.transformShader(shader as never);
    return shader;
  };

  it("should set correct vertex and fragment shaders", () => {
    const shader = transform({});
    expect(shader.vertexShader).toBe(sdfTextVertexShader);
    expect(shader.fragmentShader).toBe(sdfTextFragmentShader);
  });

  it("should set USE_RTE define only when useRTE=true", () => {
    expect(transform({ useRTE: true }).defines.USE_RTE).toBe(1);
    expect(transform({ useRTE: false }).defines.USE_RTE).toBeUndefined();
  });

  it("should set USE_MSDF define only when useMsdf=true", () => {
    expect(transform({ useMsdf: true }).defines.USE_MSDF).toBe(1);
    expect(transform({ useMsdf: false }).defines.USE_MSDF).toBeUndefined();
  });

  describe("small-text coverage contract", () => {
    it("injects the SDF raster size and quality-specific distance range", () => {
      expect(transform({ useMsdf: false }).defines).toMatchObject({
        NVR_SDF_PX_SIZE: SDF_PX_SIZE,
        NVR_SDF_PX_RANGE: atlasRangePx(false),
      });
      expect(transform({ useMsdf: true }).defines).toMatchObject({
        NVR_SDF_PX_SIZE: SDF_PX_SIZE,
        NVR_SDF_PX_RANGE: atlasRangePx(true),
      });
    });

    it("injects ordered supersampling and MTSDF transition thresholds", () => {
      expect(SMALL_TEXT_SUPERSAMPLE_FULL_PPEM).toBeLessThan(
        SMALL_TEXT_SUPERSAMPLE_END_PPEM,
      );
      expect(MSDF_TRUE_SDF_END_PPEM).toBeLessThan(MSDF_FULL_DETAIL_PPEM);
      expect(SMALL_TEXT_STEM_DARKEN_FULL_PPEM).toBeLessThan(
        SMALL_TEXT_STEM_DARKEN_END_PPEM,
      );
      expect(SMALL_TEXT_STEM_DARKEN_MAX_PX).toBeGreaterThan(0);
      expect(transform({}).defines).toMatchObject({
        NVR_SMALL_TEXT_SS_FULL_PPEM: SMALL_TEXT_SUPERSAMPLE_FULL_PPEM,
        NVR_SMALL_TEXT_SS_END_PPEM: SMALL_TEXT_SUPERSAMPLE_END_PPEM,
        NVR_SMALL_TEXT_DARKEN_MAX_PX: SMALL_TEXT_STEM_DARKEN_MAX_PX,
        NVR_SMALL_TEXT_DARKEN_FULL_PPEM: SMALL_TEXT_STEM_DARKEN_FULL_PPEM,
        NVR_SMALL_TEXT_DARKEN_END_PPEM: SMALL_TEXT_STEM_DARKEN_END_PPEM,
        NVR_MSDF_TRUE_SDF_END_PPEM: MSDF_TRUE_SDF_END_PPEM,
        NVR_MSDF_FULL_DETAIL_PPEM: MSDF_FULL_DETAIL_PPEM,
      });
    });

    it("uses UV-derived coverage and clamps supersamples to the padded glyph boundary", () => {
      expect(sdfTextFragmentShader).toContain("nvr_screenPxRange()");
      expect(sdfTextFragmentShader).toContain("nvr_edgeCoverage(");
      expect(sdfTextFragmentShader).toContain(
        "clamp(atlasUv, vAtlasUvMin, vAtlasUvMax)",
      );
      expect(sdfTextFragmentShader).not.toContain("vAtlasUvMin + halfTexel");
      expect(sdfTextFragmentShader).not.toContain("vAtlasUvMax - halfTexel");
      expect(sdfTextVertexShader).toContain(
        "vAtlasUvMin = glyphUvRect.xy / atlasSize",
      );
      expect(sdfTextVertexShader).toContain(
        "vAtlasUvMax = glyphUvRect.zw / atlasSize",
      );
      expect(sdfTextFragmentShader).not.toContain("fwidth(dist)");
    });

    it("composites translucent outlines behind partially covered fills", () => {
      expect(sdfTextFragmentShader).toContain(
        "float behindFill = outlineLayer * (1.0 - fillAlpha)",
      );
      expect(sdfTextFragmentShader).toContain(
        "float alpha = fillAlpha + behindFill",
      );
      expect(sdfTextFragmentShader).not.toContain(
        "mix(uOutlineColor, vColor, fillAlpha)",
      );
      expect(sdfTextFragmentShader).toMatch(
        /alpha \*= opacity;\s*if \(alpha <= 0\.0\) discard;/,
      );
    });
  });

  // The shader indexes the label data texture as `slot * LABEL_ROWS + row`.
  // If the define and the CPU-side row table disagree, every label reads
  // another label's state — hence injecting it rather than hard-coding it.
  describe("label data texture contract", () => {
    it("injects LABEL_ROWS as a define", () => {
      expect(transform({}).defines.LABEL_ROWS).toBe(LABEL_ROWS);
    });

    it("keeps LABEL_ROWS in step with the row table", () => {
      const rows = Object.values(LabelRow);
      expect(LABEL_ROWS).toBe(rows.length);
      // Rows must be a dense 0..n-1 range for the stride math to hold.
      expect([...rows].sort((a, b) => a - b)).toEqual(rows.map((_, i) => i));
    });

    it("binds the label texture uniforms", () => {
      const shader = transform({});
      expect(shader.uniforms.uLabelData).toBeDefined();
      expect(shader.uniforms.uLabelTexSize).toBeDefined();
    });

    it("keeps the shader's row indices in step with the row table", () => {
      // The GLSL side restates the row numbers as its own defines, so a row
      // inserted on the CPU without updating the shader would silently read
      // the wrong texel rather than fail to compile.
      for (const [name, index] of Object.entries(LabelRow)) {
        const define = `LABEL_ROW_${name}`;
        expect(sdfTextVertexShader).toMatch(
          new RegExp(`#define\\s+${define}\\s+${index}\\b`),
        );
      }
    });
  });

  // Line placement compiles a different placement branch and reads a second
  // texture, so the define, the sample count and the uniforms must arrive
  // together or the branch reads garbage.
  describe("line placement contract", () => {
    it("compiles the straight-label branch by default", () => {
      const shader = transform({});
      expect(shader.defines.NVR_LINE_PLACEMENT).toBeUndefined();
      expect(shader.defines.PATH_SAMPLES).toBeUndefined();
    });

    it("injects the define and the sample count together", () => {
      const shader = transform({ linePlacement: true, pathSamples: 32 });
      expect(shader.defines.NVR_LINE_PLACEMENT).toBe(1);
      expect(shader.defines.PATH_SAMPLES).toBe(32);
    });

    it("binds the path texture uniforms", () => {
      const shader = transform({ linePlacement: true, pathSamples: 32 });
      expect(shader.uniforms.uPathData).toBeDefined();
      expect(shader.uniforms.uPathTexSize).toBeDefined();
      expect(shader.uniforms.uLineOffset).toBeDefined();
    });

    it("gives line-placed batches their own program cache key", () => {
      // The two branches declare different uniforms, so sharing a compiled
      // program would leave one of them reading an unbound sampler.
      const straight = createSdfTextBaseEnhancer(createMockMaterial());
      straight.mount({});
      const curved = createSdfTextBaseEnhancer(createMockMaterial());
      curved.mount({ linePlacement: true, pathSamples: 32 });

      expect(curved.programCacheKey()).not.toBe(straight.programCacheKey());
    });
  });

  it("should assign batch-wide uniforms to shader.uniforms", () => {
    const shader = transform({ outlineOpacity: 0.25 });
    expect(shader.uniforms.uCenter).toBeDefined();
    expect(shader.uniforms.uOutlineOpacity?.value).toBe(0.25);
    expect(shader.uniforms.nvr_uPickable).toBeDefined();
  });
});
