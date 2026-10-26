import type { PerspectiveCamera } from "three";

import type { Overlap } from "../type";

/**
 * One label/sprite competing for screen space in a declutter pass.
 *
 * The local box is expressed around the projected anchor in the shader's
 * billboard-local units — CSS pixels when `sizeInMeters` is false, meters
 * otherwise — with +X right and +Y up (view-space convention). The manager
 * converts it to a screen-pixel AABB using the same `nvr_pxToWorld` math the
 * vertex shaders use, so the collision box matches what is actually drawn.
 */
export type DeclutterCandidate = {
  /** World-space anchor in ECEF meters (f64), before the height offset. */
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  /** Extra offset in meters along the spherical surface normal — CPU mirror
   *  of `mvr_getMvHeightOffset` (sprite_height_pars_vertex.glsl). */
  addHeight: number;
  /** Local box around the anchor (px or meters, see `sizeInMeters`). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Unit of the local box, mirroring the material's `sizeInMeters`. */
  sizeInMeters: boolean;
  /** Compared before `priority`: a higher rank places first. */
  rank: number;
  /** Placement priority: higher wins an overlap. */
  priority: number;
  /** Which earlier candidates this one may overlap (MapLibre's `*-overlap`). */
  overlap: Overlap;
  /** Leave the box out of the collision grid, so later candidates may overlap
   *  it (MapLibre's `*-ignore-placement`). */
  ignorePlacement: boolean;
  /** Screen pixels added around the box once projected, as
   *  `[top, right, bottom, left]` (MapLibre's `*-padding`). */
  padding: readonly number[];
  /**
   * Pairs a label with the billboard of the same feature at the same anchor,
   * as MapLibre places a symbol's text and icon together: the layer and tile
   * both belong to ({@link declutterPairGroup}), the feature's index there, and
   * which of the two this is. Omitted, the candidate is never paired.
   */
  pair?: { group: number; featureIndex: number; role: "label" | "billboard" };
  /** Whether it may show while its paired partner is hidden. */
  standalone: boolean;
  /** Whether the label is currently shown (its fade target is "visible").
   *  Feeds placement hysteresis: shown labels win equal-priority ties and
   *  tolerate marginal overlaps, so slow camera drift doesn't make near-tied
   *  labels flicker in and out. */
  isShown: boolean;
  /** Participant that owns this candidate; receives the placement result. */
  owner: DeclutterParticipant;
  /** Participant-defined id (label slot for text batches, instance index for
   *  sprites) passed back to `applyDeclutter`. */
  handle: number;
  /**
   * Stable identity of what the candidate displays (label text for text
   * batches). Feeds the manager's shown-content registry so a tile swap can
   * hand placement over to the replacing batch's identical label without a
   * hide/fade-in blink. Omit for candidates that don't participate.
   */
  contentKey?: string;
};

/** Duration of the show/hide fade applied to placement results (ms). */
export const DECLUTTER_FADE_MS = 300;

/** The declutter fields a participant mirrors from its material. */
export type DeclutterSettings = {
  /** Whether the material's labels take part in the pass at all. A
   *  standalone `always` label that ignores placement can neither lose nor
   *  block, so it stays out like a `declutter: false` one. */
  participates: boolean;
  rank: number;
  priority: number;
  overlap: Overlap;
  ignorePlacement: boolean;
  padding: readonly number[];
  standalone: boolean;
};

const DEFAULT_PADDING = [2, 2, 2, 2];

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
      ? Array.from(material.declutterPadding)
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

/** A mesh that contributes label candidates to the shared declutter pass. */
export type DeclutterParticipant = {
  /**
   * Append the currently-visible, declutter-enabled candidates to `out`.
   * Called once per placement pass; must not retain `out`.
   */
  collectDeclutterCandidates: (out: DeclutterCandidate[]) => void;
  /**
   * Apply a placement result as the label's fade *target*. Must be cheap and
   * idempotent — the pass calls it for every candidate on every run, most
   * often with an unchanged value.
   */
  applyDeclutter: (handle: number, hidden: boolean) => void;
  /**
   * Advance this participant's hide factors toward their targets by
   * `deltaMs / DECLUTTER_FADE_MS`. Called by the manager every update while
   * anything is fading; returns true while any label is still mid-fade.
   */
  stepDeclutterFade: (deltaMs: number) => boolean;
  /**
   * Optional: start preparation (font loading, shaping) for labels that
   * parked it while their anchor was out of view. Called at the start of
   * every placement pass with the camera the pass will use — the cadence at
   * which visibility can actually change. Preparation is asynchronous, so
   * promoted labels join a *later* pass once their text is applied.
   */
  prepareDeferredLabels?: (camera: PerspectiveCamera) => void;
  /**
   * Optional: re-decide along-line placement for this participant's anchors.
   * Called at the start of every placement pass, before candidates are
   * collected.
   *
   * Which level of anchors is on screen, the box each one covers, and for text
   * which way it reads and whether it still fits its line all depend on the
   * camera, so none can be baked when the tile is parsed. Running before
   * `collectDeclutterCandidates` means an anchor rejected here never competes
   * for screen space.
   */
  placeLineLabels?: (camera: PerspectiveCamera, heightPx: number) => void;
};
