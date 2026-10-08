import { BufferAttribute, InterleavedBufferAttribute } from "three";
import { describe, expect, it } from "vitest";

import { createDracoGeometry } from "./dracoGeometry";

describe("createDracoGeometry", () => {
  it("builds indexed geometry with plain and padded attributes", () => {
    const geometry = createDracoGeometry({
      index: new Uint32Array([0, 1, 2]),
      attributes: [
        {
          name: "position",
          array: new Float32Array(9),
          itemSize: 3,
          stride: 3,
        },
        {
          name: "color",
          array: new Uint8Array(12),
          itemSize: 3,
          stride: 4,
        },
      ],
    });

    expect(geometry.index?.array).toEqual(new Uint32Array([0, 1, 2]));
    expect(geometry.getAttribute("position")).toBeInstanceOf(BufferAttribute);
    const color = geometry.getAttribute("color");
    expect(color).toBeInstanceOf(InterleavedBufferAttribute);
    expect(color.itemSize).toBe(3);
    expect(color.count).toBe(3);
    expect(color.normalized).toBe(true);
  });

  it("keeps float vertex colors unnormalized", () => {
    const geometry = createDracoGeometry({
      index: null,
      attributes: [
        { name: "color", array: new Float32Array(3), itemSize: 3, stride: 3 },
      ],
    });

    expect(geometry.index).toBeNull();
    expect(geometry.getAttribute("color").normalized).toBe(false);
  });
});
