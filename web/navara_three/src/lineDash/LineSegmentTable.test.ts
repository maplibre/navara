import { describe, expect, test } from "vitest";

import { MAX_BATCH_TEXTURE_WIDTH } from "../batchTexture";

import { createLineSegmentTexture } from "./LineSegmentTable";

describe("createLineSegmentTexture", () => {
  test("wraps the texels into rows of at most the batch texture width", () => {
    const segments = new Float32Array(2000 * 3 * 4);
    segments[segments.length - 1] = 42;
    const texture = createLineSegmentTexture(segments);
    expect(texture.image.width).toBe(MAX_BATCH_TEXTURE_WIDTH);
    expect(texture.image.height).toBe(
      Math.ceil((2000 * 3) / MAX_BATCH_TEXTURE_WIDTH),
    );
    expect((texture.image.data as Float32Array)[segments.length - 1]).toBe(42);
  });
});
