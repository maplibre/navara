import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  canDrawWireframe,
  releaseGeometryArraysAfterUpload,
} from "./releaseGeometryArrays";

function indexedGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(9), 3),
  );
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
  return geometry;
}

/** What three.js does on upload: call each attribute's `onUpload` callback. */
function upload(geometry: BufferGeometry): void {
  for (const attribute of [
    ...Object.values(geometry.attributes),
    geometry.index,
  ]) {
    (attribute as BufferAttribute).onUploadCallback.call(attribute);
  }
}

describe("canDrawWireframe", () => {
  it("allows a retained geometry with its arrays", () => {
    expect(canDrawWireframe(indexedGeometry(), true)).toBe(true);
  });

  it("refuses when arrays are released, so the render never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const released = indexedGeometry();
    releaseGeometryArraysAfterUpload(released);
    upload(released);
    expect(released.index?.array).toBeNull();
    expect(canDrawWireframe(released, true)).toBe(false);
    // Not retained: the arrays will be released at upload.
    expect(canDrawWireframe(indexedGeometry(), false)).toBe(false);
    warn.mockRestore();
  });
});
