import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from "three";
import { describe, expect, it } from "vitest";

import { vertexGlobalBatchIds } from "./modelBatchIds";

describe("vertexGlobalBatchIds", () => {
  const globalBatchIds = [100, 200, 300];

  it("maps each vertex's feature index to its global batch id", () => {
    const featureIndices = new BufferAttribute(new Uint16Array([2, 0, 1]), 1);

    expect(
      Array.from(vertexGlobalBatchIds(featureIndices, globalBatchIds)),
    ).toEqual([300, 100, 200]);
  });

  it("reads 1-byte indices padded to a 4-byte stride", () => {
    // The padding bytes are not indices.
    const bytes = new Uint8Array([2, 9, 9, 9, 0, 9, 9, 9, 1, 9, 9, 9]);
    const featureIndices = new InterleavedBufferAttribute(
      new InterleavedBuffer(bytes, 4),
      1,
      0,
    );

    expect(
      Array.from(vertexGlobalBatchIds(featureIndices, globalBatchIds)),
    ).toEqual([300, 100, 200]);
  });

  it("gives 0 to an index without a global batch id", () => {
    const featureIndices = new BufferAttribute(new Uint8Array([5]), 1);

    expect(
      Array.from(vertexGlobalBatchIds(featureIndices, globalBatchIds)),
    ).toEqual([0]);
  });
});
