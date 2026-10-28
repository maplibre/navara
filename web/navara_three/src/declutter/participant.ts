import type { Overlap } from "../type";

import type { DeclutterSettings } from "./types";

/** Duration of the show/hide fade applied to placement results (ms). */
export const DECLUTTER_FADE_MS = 300;

const DEFAULT_PADDING = [2, 2, 2, 2];

/** Expand one to four padding values the CSS way into
 *  `[top, right, bottom, left]`, as `parse_padding` does on the Rust side. */
function expandPadding(values: ArrayLike<number>): readonly number[] {
  switch (values.length) {
    case 1:
      return [values[0], values[0], values[0], values[0]];
    case 2:
      return [values[0], values[1], values[0], values[1]];
    case 3:
      return [values[0], values[1], values[2], values[1]];
    case 4:
      return Array.from(values);
    default:
      throw new Error(
        `declutterPadding: expected 1 to 4 values, got ${values.length}`,
      );
  }
}

export function resolveDeclutterSettings(material: {
  declutter?: boolean;
  declutterRank?: number;
  declutterPriority?: number;
  overlap?: string;
  ignorePlacement?: boolean;
  declutterPadding?: ArrayLike<number>;
  standalone?: boolean;
}): DeclutterSettings {
  const overlap = (material.overlap ?? "never") as Overlap;
  const ignorePlacement = material.ignorePlacement ?? false;
  const standalone = material.standalone ?? true;
  return {
    participates:
      (material.declutter ?? true) &&
      !(overlap === "always" && ignorePlacement && standalone),
    rank: material.declutterRank ?? 0,
    priority: material.declutterPriority ?? 0,
    overlap,
    ignorePlacement,
    padding: material.declutterPadding
      ? expandPadding(material.declutterPadding)
      : DEFAULT_PADDING,
    standalone,
  };
}

/**
 * The pair group of a layer's meshes in one tile: a label only pairs with a
 * billboard of the same group. A hash, so two groups may rarely collide; a
 * collision only matters for a label and billboard that also share a feature
 * index and an anchor.
 */
export function declutterPairGroup(
  layerId: string,
  tileHandle: bigint | undefined,
): number {
  // 32-bit FNV-1a, exact in an f64, with 0 kept for "unpaired".
  let hash = 0x811c9dc5;
  for (const ch of `${layerId}:${tileHandle ?? ""}`) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193);
  }
  return hash >>> 0 || 1;
}
