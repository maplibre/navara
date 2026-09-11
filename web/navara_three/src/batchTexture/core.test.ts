import { Color } from "three";
import invariant from "tiny-invariant";
import { describe, expect, test } from "vitest";

import {
  flushBatchTextureUpdates,
  getBatchDataTexture,
  packShowOpacity,
  readBatchScalar,
  readBatchShowOpacity,
  unpackShowOpacity,
  updateBatchAttribute,
} from "./core";
import { MAX_BATCH_TEXTURE_WIDTH, batchBaseIndex } from "./layout";
import { getBatchTextureUniform } from "./material";
import { WHITE, mockRenderer, setupBatchMaterial } from "./test-utils";

describe("packShowOpacity / unpackShowOpacity", () => {
  test("round-trip preserves show and opacity at full float precision", () => {
    const testCases = [
      { show: 1, opacity: 0.0 },
      { show: 1, opacity: 0.25 },
      { show: 1, opacity: 0.5 },
      { show: 1, opacity: 1.0 },
      { show: 0, opacity: 0.0 },
      { show: 0, opacity: 0.5 },
      { show: 0, opacity: 1.0 },
    ];

    for (const { show, opacity } of testCases) {
      const packed = packShowOpacity(show, opacity);
      const unpacked = unpackShowOpacity(packed);
      expect(unpacked.show).toBe(show);
      expect(unpacked.opacity).toBeCloseTo(opacity, 6);
    }
  });

  test("sign is never ambiguous: show=0 with opacity=0 still unpacks as hidden", () => {
    // Magnitude stays >= 1, so the sign survives even at opacity 0
    // (a plain `-opacity` encoding would collapse -0 to +0 and lose show).
    const packed = packShowOpacity(0, 0);
    expect(packed).toBeLessThan(0);
    expect(unpackShowOpacity(packed).show).toBe(0);
  });

  test("clamps opacity to 0-1 range", () => {
    expect(unpackShowOpacity(packShowOpacity(1, -0.5)).opacity).toBeCloseTo(
      0.0,
    );
    expect(unpackShowOpacity(packShowOpacity(1, 1.5)).opacity).toBeCloseTo(1.0);
  });

  test("shader decode matches: step(0, a) for show, abs(a)-1 for opacity", () => {
    // Mirrors batch_texture_vertex.glsl — keep in sync.
    for (const { show, opacity } of [
      { show: 1, opacity: 0.3 },
      { show: 0, opacity: 0.7 },
    ]) {
      const a = packShowOpacity(show, opacity);
      const glslShow = a >= 0 ? 1 : 0; // step(0.0, a)
      const glslOpacity = Math.min(Math.max(Math.abs(a) - 1, 0), 1);
      expect(glslShow).toBe(show);
      expect(glslOpacity).toBeCloseTo(opacity, 6);
    }
  });
});

describe("lazy allocation", () => {
  test("first write creates the texture with only the rows actually used", () => {
    const { material } = setupBatchMaterial(10);
    updateBatchAttribute(material, 2, "height", 5, WHITE);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    expect(texture.image.width).toBe(10);
    expect(texture.image.height).toBe(1); // scalar row only — no color row
    expect((texture.image.data as Float32Array)[2 * 4]).toBe(5);

    const defines = material.userData.defines;
    expect(defines.BATCHED_TEXTURE_ROW_HEIGHT).toBe("0.0");
    expect(defines.BATCHED_TEXTURE_COMP_HEIGHT).toBe("0");
    expect(defines.BATCHED_TEXTURE_ROW_COUNT).toBe("1.0");
    expect(defines.USE_BATCH_TEXTURE).toBe(true);
    expect(defines.USE_BATCH_HEIGHT).toBe(true);
    expect(defines.BATCHED_TEXTURE_ROW_COLOR).toBeUndefined();
  });

  test("caps texture width at MAX_BATCH_TEXTURE_WIDTH for large batch counts", () => {
    const batchLength = 20000;
    const { material } = setupBatchMaterial(batchLength);
    updateBatchAttribute(material, 0, "color", [1, 0, 0], WHITE);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    expect(texture.image.width).toBe(MAX_BATCH_TEXTURE_WIDTH);
    // ceil(20000/4096)=5 batch-row groups, one attribute row → 5 physical rows
    expect(texture.image.height).toBe(
      Math.ceil(batchLength / MAX_BATCH_TEXTURE_WIDTH),
    );
  });

  test("color allocation fills every batch with the default color", () => {
    const { material } = setupBatchMaterial(4);
    const defaults = { color: new Color(0.2, 0.4, 0.6) };
    updateBatchAttribute(material, 1, "color", [1, 0, 0], defaults);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    const data = texture.image.data as Float32Array;

    // Batch 3 was never written: keeps the mesh's default color.
    const untouched = batchBaseIndex(4, 1, 3, 0);
    expect(data[untouched]).toBeCloseTo(0.2);
    expect(data[untouched + 1]).toBeCloseTo(0.4);
    expect(data[untouched + 2]).toBeCloseTo(0.6);
  });

  test("showOpacity allocation backfills packed(visible, 1) for every batch", () => {
    const { material } = setupBatchMaterial(4);
    updateBatchAttribute(material, 1, "show", false, WHITE);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    expect(texture.image.height).toBe(1); // one scalar slot, no color row
    const data = texture.image.data as Float32Array;

    // Batch 3 was never written: visible and opaque.
    expect(unpackShowOpacity(data[batchBaseIndex(4, 1, 3, 0)])).toEqual({
      show: 1,
      opacity: 1,
    });
    // Batch 1: hidden.
    expect(unpackShowOpacity(data[batchBaseIndex(4, 1, 1, 0)]).show).toBe(0);
  });

  test("show-only styling does not enable vertexColors or a color row", () => {
    const { material } = setupBatchMaterial(4);
    updateBatchAttribute(material, 1, "show", false, WHITE);

    expect(material.vertexColors).toBe(false);
    expect(material.userData.defines.USE_BATCH_COLOR).toBeUndefined();
    expect(material.userData.defines.BATCHED_TEXTURE_ROW_COLOR).toBeUndefined();
    expect(material.userData.defines.USE_BATCH_SHOW_OPACITY).toBe(true);
  });

  test("show shares the color row's leftover component when color comes first", () => {
    const { material } = setupBatchMaterial(4);
    updateBatchAttribute(material, 1, "color", [1, 0, 0], WHITE);
    updateBatchAttribute(material, 1, "show", false, WHITE);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    // color (comps 0-2) and packed show/opacity (comp 3) share one texel.
    expect(texture.image.height).toBe(1);
    const defines = material.userData.defines;
    expect(defines.BATCHED_TEXTURE_ROW_COLOR).toBe("0.0");
    expect(defines.BATCHED_TEXTURE_ROW_SHOW_OPACITY).toBe("0.0");
    expect(defines.BATCHED_TEXTURE_COMP_SHOW_OPACITY).toBe("3");

    const data = texture.image.data as Float32Array;
    const base = batchBaseIndex(4, 1, 1, 0);
    expect(data[base]).toBe(1);
    expect(unpackShowOpacity(data[base + 3]).show).toBe(0);
  });

  test("texture growth preserves data and keeps the shared uniform ref", () => {
    const { material } = setupBatchMaterial(10);
    updateBatchAttribute(material, 3, "height", 42, WHITE);

    const uniform = getBatchTextureUniform(material);
    invariant(uniform);
    const first = uniform.value;
    invariant(first);
    expect(first.image.height).toBe(1);

    // color always needs a fresh row (comps 0-2) → the texture grows.
    updateBatchAttribute(material, 3, "color", [0.1, 0.2, 0.3], WHITE);

    const second = uniform.value;
    invariant(second);
    expect(second).not.toBe(first);
    expect(second.image.height).toBe(2);
    const data = second.image.data as Float32Array;
    // The height row (row 0) survived the copy unchanged.
    expect(data[batchBaseIndex(10, 1, 3, 0)]).toBe(42);
    // The color row was appended as row 1.
    expect(data[batchBaseIndex(10, 1, 3, 1)]).toBeCloseTo(0.1);

    const defines = material.userData.defines;
    expect(defines.BATCHED_TEXTURE_ROW_HEIGHT).toBe("0.0");
    expect(defines.BATCHED_TEXTURE_ROW_COLOR).toBe("1.0");
    expect(defines.BATCHED_TEXTURE_ROW_COUNT).toBe("2.0");
  });

  test("lineWidth allocated into an open scalar row backfills its sentinel for every batch", () => {
    const { material } = setupBatchMaterial(6, ["height", "lineWidth"]);
    updateBatchAttribute(material, 0, "height", 1, WHITE);
    updateBatchAttribute(material, 2, "lineWidth", 4, WHITE);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    // Shares the height row — no extra row allocated.
    expect(texture.image.height).toBe(1);
    const data = texture.image.data as Float32Array;
    expect(data[batchBaseIndex(6, 1, 2, 0) + 1]).toBe(4);
    // Untouched batches read the "use material default" sentinel, not 0.
    expect(data[batchBaseIndex(6, 1, 5, 0) + 1]).toBe(-1);
  });

  test("ignores scalars outside the capability list and leaves the define unset", () => {
    // Polyline-style capabilities: no extrudedHeight. Setting the attribute
    // must be a no-op — enabling USE_BATCH_EXTRUDED_HEIGHT would reference
    // the undeclared `addExtrudedHeight` receiver and fail shader compilation.
    const { material } = setupBatchMaterial(10, ["height", "lineWidth"]);
    updateBatchAttribute(material, 5, "height", 1, WHITE);
    const texture = getBatchDataTexture(material);
    invariant(texture);
    const before = Float32Array.from(texture.image.data as Float32Array);

    updateBatchAttribute(material, 5, "extrudedHeight", 120, WHITE);

    expect(material.userData.defines.USE_BATCH_EXTRUDED_HEIGHT).toBeUndefined();
    expect(
      material.userData.defines.BATCHED_TEXTURE_ROW_EXTRUDED_HEIGHT,
    ).toBeUndefined();
    expect(getBatchDataTexture(material)).toBe(texture);
    expect(texture.image.data as Float32Array).toEqual(before);
  });

  test("writes to correct 2D position when batchId exceeds texWidth", () => {
    const { material } = setupBatchMaterial(10000);

    // batchId=5000 → col=904, batchRow=1, batchRowGroups=ceil(10000/4096)=3
    // color row 0 → physicalRow=0*3+1=1; height reuses the row's comp 3.
    updateBatchAttribute(material, 5000, "color", [0.1, 0.2, 0.3], WHITE);
    updateBatchAttribute(material, 5000, "height", 7, WHITE);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    const data = texture.image.data as Float32Array;
    const colorIndex = (1 * MAX_BATCH_TEXTURE_WIDTH + 904) * 4;
    expect(data[colorIndex]).toBeCloseTo(0.1);
    expect(data[colorIndex + 1]).toBeCloseTo(0.2);
    expect(data[colorIndex + 2]).toBeCloseTo(0.3);
    expect(data[colorIndex + 3]).toBe(7);
    expect(material.userData.defines.BATCHED_TEXTURE_COMP_HEIGHT).toBe("3");
  });
});

describe("emissive", () => {
  const EMISSIVE_DEFAULTS = {
    color: new Color(1, 1, 1),
    emissive: new Color(0.1, 0.2, 0.3),
    emissiveIntensity: 0.5,
  };

  test("emissive write allocates the vec3 row and intensity slot together, sharing one texel", () => {
    const { material } = setupBatchMaterial(4, [], ["color", "emissive"]);
    updateBatchAttribute(material, 1, "emissive", [1, 0, 0], EMISSIVE_DEFAULTS);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    // emissive rgb (comps 0-2) + intensity (comp 3) → exactly one row.
    expect(texture.image.height).toBe(1);

    const defines = material.userData.defines;
    expect(defines.BATCHED_TEXTURE_ROW_EMISSIVE).toBe("0.0");
    expect(defines.BATCHED_TEXTURE_ROW_EMISSIVE_INTENSITY).toBe("0.0");
    expect(defines.BATCHED_TEXTURE_COMP_EMISSIVE_INTENSITY).toBe("3");
    expect(defines.USE_BATCH_EMISSIVE).toBe(true);

    const data = texture.image.data as Float32Array;
    // Untouched batch 3 keeps the mesh's emissive defaults (color and intensity).
    const untouched = batchBaseIndex(4, 1, 3, 0);
    expect(data[untouched]).toBeCloseTo(0.1);
    expect(data[untouched + 1]).toBeCloseTo(0.2);
    expect(data[untouched + 2]).toBeCloseTo(0.3);
    expect(data[untouched + 3]).toBeCloseTo(0.5);
    // Written batch 1: new rgb, default intensity preserved.
    const written = batchBaseIndex(4, 1, 1, 0);
    expect(data[written]).toBe(1);
    expect(data[written + 3]).toBeCloseTo(0.5);
  });

  test("emissiveIntensity-only write also allocates the pair with the default emissive color", () => {
    const { material } = setupBatchMaterial(4, [], ["color", "emissive"]);
    updateBatchAttribute(
      material,
      2,
      "emissiveIntensity",
      4,
      EMISSIVE_DEFAULTS,
    );

    const texture = getBatchDataTexture(material);
    invariant(texture);
    expect(texture.image.height).toBe(1);

    const data = texture.image.data as Float32Array;
    const written = batchBaseIndex(4, 1, 2, 0);
    expect(data[written]).toBeCloseTo(0.1); // default emissive color backfilled
    expect(data[written + 3]).toBe(4);
  });

  test("emissive is ignored for mesh types without the capability", () => {
    // Default vec3 capability list is ["color"] — no emissive receiver.
    const { material } = setupBatchMaterial(4);
    updateBatchAttribute(material, 1, "emissive", [1, 0, 0], EMISSIVE_DEFAULTS);

    expect(getBatchDataTexture(material)).toBeUndefined();
    expect(material.userData.defines?.USE_BATCH_EMISSIVE).toBeUndefined();
  });
});

describe("read-back", () => {
  test("readBatchScalar returns undefined before allocation, then written values and the backfilled sentinel", () => {
    const { material } = setupBatchMaterial(4, ["height", "size"]);
    expect(readBatchScalar(material, 0, "size")).toBeUndefined();

    updateBatchAttribute(material, 1, "size", 24, WHITE);

    expect(material.userData.defines.USE_BATCH_SIZE).toBe(true);
    expect(readBatchScalar(material, 1, "size")).toBe(24);
    // Untouched batch reads the "use material default" sentinel the
    // allocation backfilled — the CPU sees what the shader sees.
    expect(readBatchScalar(material, 3, "size")).toBe(-1);
  });

  test("readBatchShowOpacity unpacks independent show and opacity writes", () => {
    const { material } = setupBatchMaterial(4);
    expect(readBatchShowOpacity(material, 0)).toBeUndefined();

    updateBatchAttribute(material, 2, "show", false, WHITE);
    updateBatchAttribute(material, 2, "opacity", 0.25, WHITE);

    expect(readBatchShowOpacity(material, 2)).toEqual({
      show: 0,
      opacity: 0.25,
    });
    // Untouched batch reads the backfilled default (visible, opacity 1).
    expect(readBatchShowOpacity(material, 0)).toEqual({ show: 1, opacity: 1 });
  });

  test("height allocation backfills the material default so unstyled batches keep the mesh height", () => {
    const { material } = setupBatchMaterial(4);
    updateBatchAttribute(material, 1, "height", 40, {
      ...WHITE,
      height: 250,
    });

    expect(readBatchScalar(material, 1, "height")).toBe(40);
    expect(readBatchScalar(material, 3, "height")).toBe(250);
  });
});

describe("updateBatchAttribute", () => {
  test("out-of-range batch ids are rejected without stamping defines", () => {
    const { material } = setupBatchMaterial(4);
    expect(updateBatchAttribute(material, 4, "height", 1, WHITE)).toBe(false);
    expect(updateBatchAttribute(material, -1, "height", 1, WHITE)).toBe(false);
    expect(material.userData.defines?.USE_BATCH_HEIGHT).toBeUndefined();
  });

  test("show and opacity share one channel and preserve each other", () => {
    const { material } = setupBatchMaterial(10);
    const texture = () => {
      const t = getBatchDataTexture(material);
      invariant(t);
      return t.image.data as Float32Array;
    };
    // First write is opacity → the showOpacity slot is row 0, comp 0.
    const alphaIndex = batchBaseIndex(10, 1, 5, 0);

    updateBatchAttribute(material, 5, "opacity", 0.5, WHITE);
    expect(unpackShowOpacity(texture()[alphaIndex])).toEqual({
      show: 1,
      opacity: 0.5,
    });

    updateBatchAttribute(material, 5, "show", false, WHITE);
    expect(unpackShowOpacity(texture()[alphaIndex])).toEqual({
      show: 0,
      opacity: 0.5,
    });

    updateBatchAttribute(material, 5, "show", true, WHITE);
    expect(unpackShowOpacity(texture()[alphaIndex])).toEqual({
      show: 1,
      opacity: 0.5,
    });
  });

  test("color write preserves a previously written show bit", () => {
    const { material } = setupBatchMaterial(10);
    const defaults = { color: new Color(0.8, 0.9, 1.0) };

    // show first → showOpacity at row 0 comp 0; color lands in row 1.
    updateBatchAttribute(material, 3, "show", false, defaults);
    updateBatchAttribute(material, 3, "color", [0.1, 0.2, 0.3], defaults);

    const texture = getBatchDataTexture(material);
    invariant(texture);
    const data = texture.image.data as Float32Array;
    expect(data[batchBaseIndex(10, 1, 3, 1)]).toBeCloseTo(0.1);
    // show=false must survive the color write
    expect(unpackShowOpacity(data[batchBaseIndex(10, 1, 3, 0)]).show).toBe(0);
  });

  test("bumps material.version only when a define actually changes", () => {
    const { material } = setupBatchMaterial(10);

    updateBatchAttribute(material, 0, "height", 1, WHITE);
    const versionAfterFirst = material.version;

    // Repeated writes must not trigger further program rebuilds
    updateBatchAttribute(material, 1, "height", 2, WHITE);
    updateBatchAttribute(material, 2, "height", 3, WHITE);
    expect(material.version).toBe(versionAfterFirst);
  });
});

describe("flushBatchTextureUpdates", () => {
  test("first flush uploads a new texture in full and drops its spans", () => {
    // The WebGL2 texStorage2D allocation is zero-filled and the allocation
    // defaults are not zero, so a partial first upload would corrupt
    // untouched texels.
    const { material } = setupBatchMaterial(10);
    const renderer = mockRenderer();

    updateBatchAttribute(material, 5, "height", 42, WHITE);
    const texture = getBatchDataTexture(material);
    invariant(texture);
    flushBatchTextureUpdates(renderer);

    // Full synchronous upload; the write is part of the image data, so no
    // partial range must be emitted for it.
    expect(renderer.initTexture).toHaveBeenCalledWith(texture);
    expect(texture.updateRanges).toEqual([]);
  });

  test("growth within one frame uploads only the final texture", () => {
    const { material } = setupBatchMaterial(10);
    const renderer = mockRenderer();

    updateBatchAttribute(material, 0, "height", 1, WHITE);
    updateBatchAttribute(material, 0, "color", [1, 0, 0], WHITE); // grows → new texture
    const texture = getBatchDataTexture(material);
    invariant(texture);
    flushBatchTextureUpdates(renderer);

    // The pre-growth texture was disposed before ever uploading.
    expect(renderer.initTexture).toHaveBeenCalledTimes(1);
    expect(renderer.initTexture).toHaveBeenCalledWith(texture);
  });

  test("after the first upload, flush merges writes into per-row update ranges", () => {
    const { material } = setupBatchMaterial(10);
    const renderer = mockRenderer();
    // height opens row 0; color opens row 1; then drain the full upload.
    updateBatchAttribute(material, 0, "height", 0, WHITE);
    updateBatchAttribute(material, 0, "color", [1, 1, 1], WHITE);
    flushBatchTextureUpdates(renderer);
    const texture = getBatchDataTexture(material);
    invariant(texture);

    updateBatchAttribute(material, 3, "color", [1, 0, 0], WHITE);
    updateBatchAttribute(material, 7, "color", [0, 1, 0], WHITE);
    updateBatchAttribute(material, 5, "height", 42, WHITE);
    expect(texture.updateRanges).toEqual([]); // nothing until flush
    const versionBefore = texture.version;
    flushBatchTextureUpdates(renderer);

    // color row (physical row 1): cols 3..7 merged into one span.
    // scalar row (physical row 0): col 5 only.
    expect(texture.updateRanges).toEqual([
      { start: (1 * 10 + 3) * 4, count: 5 * 4 },
      { start: 5 * 4, count: 4 },
    ]);
    expect(texture.version).toBe(versionBefore + 1);

    // Flush drains the spans: a second flush adds nothing
    texture.updateRanges.length = 0;
    flushBatchTextureUpdates(renderer);
    expect(texture.updateRanges).toEqual([]);
    expect(texture.version).toBe(versionBefore + 1);
  });

  test("writes alone do not bump texture.version", () => {
    const { material } = setupBatchMaterial(10);
    updateBatchAttribute(material, 0, "height", 1, WHITE);
    flushBatchTextureUpdates(mockRenderer());
    const texture = getBatchDataTexture(material);
    invariant(texture);
    const versionBefore = texture.version;

    updateBatchAttribute(material, 1, "height", 2, WHITE);
    updateBatchAttribute(material, 2, "height", 3, WHITE);
    expect(texture.version).toBe(versionBefore);
  });
});
