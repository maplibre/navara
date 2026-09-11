import type { Color, DataTexture } from "three";

/** Attributes writable through `updateBatchAttribute`. */
export const BATCHED_ATTRIBUTE_NAMES = [
  "color",
  "show",
  "opacity",
  "height",
  "extrudedHeight",
  "lineWidth",
  "size",
  "emissive",
  "emissiveIntensity",
] as const;

export type BatchedAttributeName = (typeof BATCHED_ATTRIBUTE_NAMES)[number];

/** vec3 attributes: three components of a row (component 3 stays scalar-poolable). */
export const BATCH_VEC3_KEYS = ["color", "emissive"] as const;

export type BatchVec3Key = (typeof BATCH_VEC3_KEYS)[number];

/** Scalar attributes, one texel component each. */
export const BATCH_SCALAR_KEYS = [
  "height",
  "extrudedHeight",
  "lineWidth",
  "size",
] as const;

export type BatchScalarKey = (typeof BATCH_SCALAR_KEYS)[number];

/**
 * Scalar slot keys: the public scalar attributes plus internal components —
 * packed show/opacity (written through `show`/`opacity`) and the emissive
 * intensity paired with the emissive vec3 row.
 */
export type BatchScalarSlotKey =
  BatchScalarKey | "showOpacity" | "emissiveIntensity";

export type BatchTextureConfig = {
  /**
   * Scalar properties this mesh type supports, in allocation order.
   * Must only contain attributes the mesh's shaders declare receiver variables
   * for: `updateBatchAttribute` turns the `USE_BATCH_*` define on whenever the
   * slot exists, and the shared `batch_texture_vertex` chunk then assigns to
   * the receiver — an undeclared one breaks shader compilation.
   */
  scalars: BatchScalarKey[];
  /**
   * vec3 attributes this mesh type supports, defaulting to `["color"]`.
   * Same receiver rule as `scalars`.
   */
  vec3s?: BatchVec3Key[];
  batchLength: number;
};

/** Position of an attribute in the batch data texture: attribute row + texel component. */
export type BatchSlot = { row: number; comp: number };

/** Shared sampler ref: texture growth swaps `.value`, every holder sees the new texture. */
export type BatchTextureUniform = { value: DataTexture | null };

export type DefaultBatchAttributeValues = {
  color: Color;
  /** Mesh default emissive; only needed by mesh types supporting `emissive`. */
  emissive?: Color;
  emissiveIntensity?: number;
  /** Mesh default height offset (uAddHeight); backfilled on slot allocation
   *  so unstyled features keep the material height. Defaults to 0. */
  height?: number;
  extrudedHeight?: number;
};
