import type { DataTexture } from "three";

/** Attributes writable through `updateBatchAttribute`. */
export const BATCHED_ATTRIBUTE_NAMES = [
  "color",
  "show",
  "opacity",
  "height",
  "extrudedHeight",
  "lineWidth",
  "lineDash",
  "size",
  "rotation",
  "flatFacing",
  "rotateWithCamera",
  "spreadGlyphs",
  "emissive",
  "emissiveIntensity",
  /** `anchorCode` of the sprite's anchor (see `material/anchor.ts`). */
  "anchor",
  /** `[x, y]`, x right and y down, in the unit of the sprite's size. */
  "offset",
] as const;

export type BatchedAttributeName = (typeof BATCHED_ATTRIBUTE_NAMES)[number];

/**
 * Material-level values the mesh passes to `updateBatchAttribute`, used to
 * backfill a slot for every feature when that slot is first allocated.
 *
 * Only attributes whose material value lives in a shader uniform need one:
 * `USE_BATCH_*` is a material-wide define, so the moment one feature gets its
 * own value every feature starts reading the slot, and features nobody styled
 * must already hold what the uniform was giving them. Attributes left out fall
 * back to the fixed defaults in `core.ts`.
 */
export type BatchAttributeDefaults = {
  /** Radians, clockwise seen from the front. */
  rotation: number;
  flatFacing: boolean;
  rotateWithCamera: boolean;
  /** Text only. */
  spreadGlyphs?: boolean;
  /** Sprites only: `anchorCode` of the material's anchor. */
  anchor?: number;
  /** Sprites only: the material's offset. */
  offset?: readonly [number, number];
};

/** vec3 attributes: three components of a row (component 3 stays scalar-poolable). */
export const BATCH_VEC3_KEYS = ["color", "emissive"] as const;

export type BatchVec3Key = (typeof BATCH_VEC3_KEYS)[number];

/** Scalar attributes, one texel component each. */
export const BATCH_SCALAR_KEYS = [
  "height",
  "extrudedHeight",
  "lineWidth",
  /** Row of the feature's dash pattern in the view's `LineDashAtlas`. */
  "lineDash",
  "size",
  "rotation",
  /**
   * Packed orientation: `facing`, `rotateWithCamera` and (text only)
   * `spreadGlyphs` share one component (see `packOrientation`). It is a slot key rather than a public attribute
   * — callers write the two booleans by name — but it lives here so a mesh
   * type can declare support for it, which gates allocation to the shaders
   * that actually declare receivers.
   */
  "orientation",
  /** Packed anchor, `anchorCode` in `material/anchor.ts`. */
  "anchor",
  /**
   * The two halves of the public `offset` attribute, always allocated
   * together (see `ensureOffsetSlots`).
   */
  "offsetX",
  "offsetY",
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
