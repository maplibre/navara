import type { BatchTextureConfig } from "./types";

/**
 * Batch-texture capability of one mesh type: the attributes its shaders can
 * receive. These are capability lists, not preallocations — slots are still
 * allocated lazily on first write.
 *
 * A list must only contain attributes with declared receiver variables in
 * that mesh type's shaders: `updateBatchAttribute` turns the `USE_BATCH_*`
 * define on whenever the slot exists, and the shared `batch_texture_vertex`
 * chunk then assigns to the receiver — an undeclared one (e.g.
 * `addExtrudedHeight` in the polyline shaders) breaks shader compilation.
 * Writes outside the list are silently ignored.
 */
export type BatchTextureSupport = Pick<BatchTextureConfig, "scalars" | "vec3s">;

export const POLYGON_BATCH_SUPPORT: BatchTextureSupport = {
  // No lineWidth/size: the polygon shaders declare no receivers for them.
  scalars: ["height", "extrudedHeight"],
  vec3s: ["color", "emissive"],
};

export const POLYLINE_BATCH_SUPPORT: BatchTextureSupport = {
  // No extrudedHeight, and no emissive: polyline.frag has no emissive
  // G-buffer output.
  scalars: ["height", "lineWidth"],
  vec3s: ["color"],
};

export const MODEL_BATCH_SUPPORT: BatchTextureSupport = {
  scalars: [],
  vec3s: ["color", "emissive"],
};

export const SPRITE_BATCH_SUPPORT: BatchTextureSupport = {
  scalars: ["height", "size"],
  vec3s: ["color", "emissive"],
};

export const TEXT_BATCH_SUPPORT: BatchTextureSupport = {
  scalars: ["height", "size"],
  vec3s: ["color", "emissive"],
};
