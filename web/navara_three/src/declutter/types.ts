import type { PerspectiveCamera } from "three";

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
  /** Placement priority: higher wins an overlap. */
  priority: number;
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
   * Optional: re-decide along-line placement for this participant's labels.
   * Called at the start of every placement pass, before candidates are
   * collected.
   *
   * Which way a line label reads, and whether it still fits the road it sits
   * on, both depend on the camera — a pixel-sized label grows in world metres
   * as the camera pulls back — so neither can be baked when the tile is
   * parsed. This shares the placement pass's cadence because it changes at
   * exactly the same rate, and runs before `collectDeclutterCandidates` so a
   * label rejected here never competes for screen space.
   */
  placeLineLabels?: (
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
  ) => void;
};
