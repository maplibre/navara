import { MeshBasicMaterial } from "three";
import invariant from "tiny-invariant";
import { describe, expect, test } from "vitest";

import {
  flushBatchTextureUpdates,
  getBatchDataTexture,
  updateBatchAttribute,
} from "./core";
import { attachBatchedMaterial, getBatchTextureUniform } from "./material";
import { WHITE, mockRenderer, setupBatchMaterial } from "./test-utils";

describe("initBatchedMaterial", () => {
  test("init stamps no layout defines and creates no texture", () => {
    const { material } = setupBatchMaterial(10);
    expect(getBatchDataTexture(material)).toBeUndefined();
    expect(
      material.userData.defines?.BATCHED_TEXTURE_ROW_COUNT,
    ).toBeUndefined();
    expect(material.userData.defines?.USE_BATCH_TEXTURE).toBeUndefined();
  });
});

describe("attachBatchedMaterial", () => {
  test("attached material shares the uniform and receives layout defines on allocation", () => {
    const { material } = setupBatchMaterial(10);
    const outline = new MeshBasicMaterial();
    attachBatchedMaterial(material, outline);

    expect(getBatchTextureUniform(outline)).toBe(
      getBatchTextureUniform(material),
    );

    updateBatchAttribute(material, 0, "height", 1, WHITE);

    const defines = outline.userData.defines;
    expect(defines.BATCHED_TEXTURE_ROW_HEIGHT).toBe("0.0");
    expect(defines.BATCHED_TEXTURE_ROW_COUNT).toBe("1.0");
    expect(defines.USE_BATCH_TEXTURE).toBe(true);
    // USE_BATCH_* feature toggles stay per material — the attached material's
    // shaders opt in through their own paths.
    expect(defines.USE_BATCH_HEIGHT).toBeUndefined();
  });

  test("attaching after allocations catches up on already-stamped defines", () => {
    const { material } = setupBatchMaterial(10);
    updateBatchAttribute(material, 0, "height", 1, WHITE);

    const outline = new MeshBasicMaterial();
    attachBatchedMaterial(material, outline);

    expect(outline.userData.defines.BATCHED_TEXTURE_ROW_HEIGHT).toBe("0.0");
    expect(outline.userData.defines.USE_BATCH_TEXTURE).toBe(true);
  });
});

describe("material dispose", () => {
  test("detaches the state and disposes the texture when it is the last holder", () => {
    const { material } = setupBatchMaterial(10);
    updateBatchAttribute(material, 0, "height", 1, WHITE);
    const uniform = getBatchTextureUniform(material);
    invariant(uniform?.value);

    material.dispose();

    // The per-material state entry is released (getBatchTextureUniform reads
    // the module's WeakMap) and the texture is disposed through the shared
    // uniform, so nothing pins it for the process lifetime.
    expect(getBatchTextureUniform(material)).toBeUndefined();
    expect(uniform.value).toBeNull();
  });

  test("drains the flush queues, so a dead texture is never uploaded", () => {
    const { material } = setupBatchMaterial(10);
    const renderer = mockRenderer();
    updateBatchAttribute(material, 0, "height", 1, WHITE);
    const texture = getBatchDataTexture(material);
    invariant(texture);

    material.dispose();
    // The flush queues are module-global, so other textures may still drain
    // here — only the disposed one must not be uploaded.
    flushBatchTextureUpdates(renderer);

    expect(renderer.initTexture).not.toHaveBeenCalledWith(texture);
  });

  test("the shared texture survives until the last attached material disposes", () => {
    const { material } = setupBatchMaterial(10);
    const outline = new MeshBasicMaterial();
    attachBatchedMaterial(material, outline);
    updateBatchAttribute(material, 0, "height", 1, WHITE);
    const uniform = getBatchTextureUniform(material);
    invariant(uniform?.value);

    material.dispose();
    // The outline still samples the texture.
    expect(uniform.value).not.toBeNull();
    expect(getBatchTextureUniform(outline)).toBe(uniform);

    outline.dispose();
    expect(uniform.value).toBeNull();
    expect(getBatchTextureUniform(outline)).toBeUndefined();
  });
});

describe("program cache key", () => {
  test("reflects the allocated layout", () => {
    // Two materials of the same type whose layouts differ by allocation order
    // must not share a compiled program: three.js does not include
    // onBeforeCompile-injected defines in its cache key.
    const a = setupBatchMaterial(10).material;
    const b = setupBatchMaterial(10).material;
    updateBatchAttribute(a, 0, "color", [1, 0, 0], WHITE);
    updateBatchAttribute(a, 0, "height", 1, WHITE);
    updateBatchAttribute(b, 0, "height", 1, WHITE);
    updateBatchAttribute(b, 0, "color", [1, 0, 0], WHITE);

    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });
});
