import {
  HalfFloatType,
  NearestFilter,
  UnsignedByteType,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";

import {
  GBUFFER_ATTACHMENT_NAMES,
  GBUFFER_DEFINE_NAMES,
  GBUFFER_NORMAL_LOCATION_DEFINE,
  GBUFFER_NORMAL_WRITE_BASIC,
  GBUFFER_NORMAL_WRITE_PHYSICAL,
  GBUFFER_EMISSIVE_LOCATION_DEFINE,
  GBUFFER_PARS_FRAGMENT,
  USE_GBUFFER_EMISSIVE_DEFINE,
  computeGBufferDefines,
  computeGBufferTextureIndex,
  createGBufferAttachments,
  exceededGBufferCapacity,
  resolveGBufferOptions,
  unionGBufferRequirements,
} from "./gbufferLayout";

describe("gbufferLayout", () => {
  it("keeps the GLSL chunk in sync with the TS define names", () => {
    // Only strings link the two sides: a one-sided rename silently stops the
    // buffer from being written, with no compile error.
    for (const name of GBUFFER_DEFINE_NAMES) {
      expect(GBUFFER_PARS_FRAGMENT).toContain(name);
    }
    // Every normal write goes through the macro, so the output can be
    // compiled out wholesale — a direct assignment would not be.
    expect(GBUFFER_PARS_FRAGMENT).toContain("#define GBUFFER_WRITE_NORMAL(");
    expect(GBUFFER_NORMAL_WRITE_BASIC).toMatch(/^GBUFFER_WRITE_NORMAL\(/);
    expect(GBUFFER_NORMAL_WRITE_PHYSICAL).toMatch(/^GBUFFER_WRITE_NORMAL\(/);
  });

  it("packs optional attachment indices without gaps", () => {
    expect(
      computeGBufferTextureIndex(
        resolveGBufferOptions({
          normal: true,
          selectiveEffect: true,
          emissive: true,
          shadow: true,
        }),
      ),
    ).toEqual({ color: 0, normal: 1, effectIds: 2, emissive: 3, shadow: 4 });
    // A disabled buffer never leaves a hole: later buffers slide down. Normal
    // is optional too, so shadow lands directly after color without it.
    expect(
      computeGBufferTextureIndex(resolveGBufferOptions({ shadow: true })),
    ).toEqual({ color: 0, shadow: 1 });
    // Defaults allocate nothing beyond color.
    expect(computeGBufferTextureIndex(resolveGBufferOptions())).toEqual({
      color: 0,
    });
  });

  it("stamps location defines matching the computed indices", () => {
    expect(
      computeGBufferDefines(
        resolveGBufferOptions({ normal: true, emissive: true }),
      ),
    ).toEqual({
      [GBUFFER_NORMAL_LOCATION_DEFINE]: 1,
      [USE_GBUFFER_EMISSIVE_DEFINE]: 1,
      [GBUFFER_EMISSIVE_LOCATION_DEFINE]: 2,
    });
    expect(computeGBufferDefines(resolveGBufferOptions())).toEqual({});
  });

  it("derives the buffer configuration as the union of effect requirements", () => {
    expect(unionGBufferRequirements([])).toEqual({
      normal: false,
      selectiveEffect: false,
      emissive: false,
      shadow: false,
      globeNormal: false,
    });
    expect(
      unionGBufferRequirements([
        ["selectiveEffect"],
        ["selectiveEffect", "emissive"],
        ["shadow"],
      ]),
    ).toEqual({
      normal: false,
      selectiveEffect: true,
      emissive: true,
      shadow: true,
      globeNormal: false,
    });

    // The globe normal is a copy of the normal attachment, so requesting it
    // pulls the attachment in even when nothing asked for it directly.
    expect(unionGBufferRequirements([["globeNormal"]])).toEqual({
      normal: true,
      selectiveEffect: false,
      emissive: false,
      shadow: false,
      globeNormal: true,
    });
  });

  it("allocates only enabled attachments, with their texture settings", () => {
    const rt = new WebGLRenderTarget(4, 4);
    const buffers = resolveGBufferOptions({
      normal: true,
      selectiveEffect: true,
      emissive: true,
      shadow: true,
    });
    createGBufferAttachments(rt, buffers);

    expect(rt.textures.length).toBe(5);
    const index = computeGBufferTextureIndex(buffers);
    invariantDefined(index.effectIds);
    invariantDefined(index.emissive);
    const effectIds = rt.textures[index.effectIds];
    expect(effectIds.type).toBe(HalfFloatType);
    expect(effectIds.minFilter).toBe(NearestFilter);
    expect(effectIds.magFilter).toBe(NearestFilter);
    expect(rt.textures[index.emissive].type).toBe(HalfFloatType);
    invariantDefined(index.shadow);
    expect(rt.textures[index.shadow].type).toBe(UnsignedByteType);

    // No placeholder textures for disabled buffers – indices would shift.
    const defaultRt = new WebGLRenderTarget(4, 4);
    createGBufferAttachments(defaultRt, resolveGBufferOptions());
    expect(defaultRt.textures.length).toBe(1);
  });
});

function invariantDefined(value: number | undefined): asserts value is number {
  expect(value).toBeDefined();
}

describe("globeNormal", () => {
  // It rides on requiredBuffers but is a separate copy target, not an MRT
  // attachment, so it must not consume a slot, an index, or a location define.
  const buffers = resolveGBufferOptions({ globeNormal: true, shadow: true });

  it("takes no attachment index of its own", () => {
    // normal is present because globeNormal implies it, not because
    // globeNormal took a slot.
    expect(computeGBufferTextureIndex(buffers)).toEqual({
      color: 0,
      normal: 1,
      shadow: 2,
    });
  });

  it("allocates no texture of its own", () => {
    const rt = new WebGLRenderTarget(4, 4);
    createGBufferAttachments(rt, buffers);
    // color + normal (implied) + shadow — globeNormal itself adds nothing.
    expect(rt.textures.length).toBe(3);
  });

  it("stamps no define of its own", () => {
    expect(
      computeGBufferDefines(unionGBufferRequirements([["globeNormal"]])),
    ).toEqual({ [GBUFFER_NORMAL_LOCATION_DEFINE]: 1 });
  });

  it("is excluded from the attachment-backed names", () => {
    expect(GBUFFER_ATTACHMENT_NAMES).not.toContain("globeNormal");
  });
});

describe("exceededGBufferCapacity", () => {
  const allocated = unionGBufferRequirements([["selectiveEffect", "emissive"]]);
  // A growth to normal + shadow was rejected on a 4-draw-buffer device, so
  // the requirements exceed what is allocated.
  const requirements = [
    ["selectiveEffect", "emissive"],
    ["normal", "shadow"],
  ] as const;

  it("counts the requirements a rejected growth left unallocated", () => {
    expect(
      exceededGBufferCapacity(requirements, ["normal"], allocated, 4),
    ).toBe(5);
  });

  it("accepts buffers that are already allocated", () => {
    expect(
      exceededGBufferCapacity(requirements, ["selectiveEffect"], allocated, 4),
    ).toBeUndefined();
  });

  it("accepts what fits", () => {
    expect(
      exceededGBufferCapacity(
        [["selectiveEffect", "emissive"]],
        ["normal"],
        allocated,
        4,
      ),
    ).toBeUndefined();
  });

  it("counts the normal a globe normal implies", () => {
    expect(
      exceededGBufferCapacity(
        [["selectiveEffect", "emissive", "shadow"]],
        ["globeNormal"],
        unionGBufferRequirements([["selectiveEffect", "emissive", "shadow"]]),
        4,
      ),
    ).toBe(5);
  });
});
