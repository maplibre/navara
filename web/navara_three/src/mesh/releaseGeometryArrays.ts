import {
  type BufferAttribute,
  type BufferGeometry,
  InterleavedBufferAttribute,
} from "three";

/**
 * After the first GPU upload, drop the CPU-side typed array of a
 * `BufferAttribute` so it is not kept resident on the JS heap alongside the GPU
 * copy. This is the standard Three.js `onUpload` idiom (`this.array = null`).
 *
 * IMPORTANT: once released, the attribute can no longer be re-uploaded — a
 * WebGL context loss will NOT be able to restore it. Our geometry is
 * WASM-sourced and re-fetched on demand rather than re-uploaded, and the memory
 * ledger (`GPU_GEOMETRY_RESIDENCY_FACTOR`) now assumes exactly one resident
 * (GPU) copy, so this trade-off is intentional. Only apply it to attributes
 * whose `.array` is not re-read on the CPU after upload (bounding volumes must
 * already be computed/assigned; batch/feature-id arrays must be consumed at
 * setup time, not lazily).
 */
function disposeArray(this: BufferAttribute) {
  // Three.js types `array` as a readonly typed array; null is the documented
  // sentinel that frees it after upload.
  (this as unknown as { array: unknown }).array = null;
}

/**
 * Attach {@link disposeArray} to a single attribute (idempotent).
 *
 * Interleaved attributes are skipped: an `InterleavedBufferAttribute` (produced
 * by `GLTFLoader` for interleaved bufferViews) has no `onUpload` method — only
 * its shared underlying `InterleavedBuffer` does — and multiple attributes
 * share one buffer, so releasing through it is unsafe without per-buffer
 * dedupe. Skipping them keeps interleaved glTF/3D Tiles models rendering
 * correctly at the cost of the array-release optimization for those attributes.
 */
export function releaseAttributeAfterUpload(
  attribute: BufferAttribute | InterleavedBufferAttribute | null | undefined,
): void {
  if (!attribute) return;
  if (attribute instanceof InterleavedBufferAttribute) return;
  attribute.onUpload(disposeArray);
}

/**
 * Attach the post-upload CPU-array release to every attribute and the index of
 * a geometry. Safe to call once per geometry after all CPU-side reads
 * (bounding volumes, batch-id extraction) are done and before first render.
 */
export function releaseGeometryArraysAfterUpload(
  geometry: BufferGeometry,
): void {
  for (const attribute of Object.values(geometry.attributes)) {
    releaseAttributeAfterUpload(attribute);
  }
  releaseAttributeAfterUpload(geometry.index);
}

let wireframeWarned = false;

/**
 * Whether `material.wireframe` may be set on a mesh of this geometry. three.js
 * builds the wireframe from the CPU index (or position) array at draw time,
 * and drawing one whose array was released throws inside the render pass. So
 * a wireframe needs the geometry built while
 * `ViewContext.retainGeometryArrays` was on (`retained`) and its array still
 * present. Warns once when a wireframe is refused.
 */
export function canDrawWireframe(
  geometry: BufferGeometry,
  retained: boolean,
): boolean {
  const source = geometry.index ?? geometry.getAttribute("position");
  const array = (source as { array?: unknown } | undefined)?.array;
  if (retained && array) return true;
  if (!wireframeWarned) {
    wireframeWarned = true;
    console.warn(
      "Navara: wireframe needs geometry arrays kept on the CPU; set ViewContext.retainGeometryArrays before layers load (the debug tools do).",
    );
  }
  return false;
}
