import type { DataTexture } from "three";

import { MAX_BATCH_TEXTURE_WIDTH } from "../batchTexture";
import { createFloatDataTexture } from "../utils/floatDataTexture";

/**
 * A volume polyline's segment table (the geometry's `line_segments`, laid out
 * by `append_line_segment` in `navara_geometry`) as a texture, row-major in
 * texel order.
 */
export function createLineSegmentTexture(segments: Float32Array): DataTexture {
  const texelCount = Math.max(segments.length / 4, 1);
  const width = Math.min(texelCount, MAX_BATCH_TEXTURE_WIDTH);
  const height = Math.ceil(texelCount / width);
  const data = new Float32Array(width * height * 4);
  data.set(segments);
  return createFloatDataTexture(data, width, height);
}

/**
 * {@link createLineSegmentTexture} that drops its CPU copy once uploaded.
 * Three.js uploads a texture on the first draw that samples it, which only a
 * dashed line's program does, so a line that is never dashed never uploads
 * its table. Like `releaseGeometryArraysAfterUpload`, the texture cannot be
 * restored after a WebGL context loss.
 */
export function createLineSegmentTextureReleasedOnUpload(
  segments: Float32Array,
): DataTexture {
  const texture = createLineSegmentTexture(segments);
  texture.onUpdate = () => {
    (texture.image as { data: Float32Array | null }).data = null;
  };
  return texture;
}
