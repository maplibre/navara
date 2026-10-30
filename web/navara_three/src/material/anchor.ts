import type { Anchor } from "../type";

/** A material's `translate` with its defaults resolved: screen pixels, x right
 *  and y down, and whether it stays on the screen axes. */
export type ResolvedTranslate = {
  translate: [number, number];
  translateViewport: boolean;
};

export function resolveTranslate(material: {
  translate?: { x: number; y: number };
  translateAnchor?: string;
}): ResolvedTranslate {
  const t = material.translate;
  return {
    translate: [t?.x ?? 0, t?.y ?? 0],
    translateViewport: material.translateAnchor === "viewport",
  };
}

/**
 * Where each anchor sits on the box it names: horizontally 0 left, 0.5
 * center, 1 right; vertically 0 top, 0.5 center, 1 bottom — MapLibre's
 * `getAnchorAlignment`.
 */
export const ANCHOR_ALIGN: Readonly<Record<Anchor, readonly [number, number]>> =
  {
    center: [0.5, 0.5],
    left: [0, 0.5],
    right: [1, 0.5],
    top: [0.5, 0],
    bottom: [0.5, 1],
    "top-left": [0, 0],
    "top-right": [1, 0],
    "bottom-left": [0, 1],
    "bottom-right": [1, 1],
  };

/** Whether `value` names an anchor. Material anchors arrive parsed by the
 *  engine; a per-feature one from an evaluator needs this check. */
export function isAnchor(value: unknown): value is Anchor {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ANCHOR_ALIGN, value)
  );
}

/**
 * The anchor's position on a sprite quad whose corners are at ±0.5, x right
 * and y up — the `uAnchor` the sprite shader subtracts from each corner.
 */
export function spriteCenter(anchor: Anchor): [number, number] {
  const [h, v] = ANCHOR_ALIGN[anchor];
  return [h - 0.5, 0.5 - v];
}

/**
 * The anchor as one batch-texture scalar, `2h + 6v` (0..8). The shader
 * decodes it with `mod(code, 3)` and `floor(code / 3)`.
 */
export function anchorCode(anchor: Anchor): number {
  const [h, v] = ANCHOR_ALIGN[anchor];
  return 2 * h + 6 * v;
}

/** {@link spriteCenter} of the anchor an {@link anchorCode} packs, decoded as
 *  `batch_texture_vertex.glsl` does. */
export function spriteCenterFromCode(code: number): [number, number] {
  return [(code % 3) * 0.5 - 0.5, 0.5 - Math.floor((code + 0.5) / 3) * 0.5];
}
