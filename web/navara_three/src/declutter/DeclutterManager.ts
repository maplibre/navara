import { Matrix4, type PerspectiveCamera } from "three";

import {
  CANDIDATE_STRIDE,
  OVERLAP_CODES,
  PAIR_ROLE_CODES,
  type DeclutterKernel,
} from "./kernel";
import type { DeclutterCandidate, DeclutterParticipant } from "./types";

export type DeclutterUpdateResult =
  /** Nothing to do: no participants, or camera and data unchanged. */
  | "idle"
  /** A placement pass ran; results are applied to the participants. */
  | "ran"
  /** Labels are mid-fade — the caller should schedule a prompt follow-up
   *  frame so the animation keeps stepping. */
  | "animating"
  /** A pass is due but the throttle window hasn't elapsed — the caller should
   *  schedule another frame so placement settles after the camera stops. */
  | "throttled";

/**
 * Shared screen-space label decluttering.
 *
 * Text batches and sprite meshes register as participants; each placement
 * pass packs every candidate label into a flat buffer and hands it to the
 * Rust {@link DeclutterKernel}, which projects the anchors, sorts by priority,
 * and greedily claims screen space — losers are hidden through the meshes'
 * declutter channels (`uDeclutterHide` uniform / `instanceDeclutterHide`
 * attribute), which are separate from user-driven `show` state and free to
 * toggle every pass.
 *
 * Placement is hysteretic: currently-shown labels win equal-priority ties
 * and tolerate {@link DeclutterManager.HYSTERESIS_PX} of marginal overlap
 * before eviction, so near-ties don't flicker while the camera drifts.
 *
 * The pass is view-dependent, so it runs from the render loop — but throttled:
 * placement only re-runs when the camera or the label set actually changed,
 * and at most once per {@link DeclutterManager.MIN_INTERVAL_MS}. Callers run
 * it *before* rendering so results land in the same frame.
 */
export class DeclutterManager {
  /** Minimum time between placement passes (ms). */
  static readonly MIN_INTERVAL_MS = 150;
  /** Largest single fade step (ms), so a frame after an idle gap doesn't
   *  swallow most of a fade in one jump. */
  static readonly MAX_FADE_STEP_MS = 50;
  /** Placement hysteresis (px): a currently-shown label's collision test box
   *  shrinks by this per side, so it survives marginal overlaps that camera
   *  drift toggles frame to frame instead of flickering. Its full box is
   *  still claimed against competitors. */
  static readonly HYSTERESIS_PX = 6;
  /** Anchor distance (m) within which two same-content candidates count as
   *  the same label for the tile-swap handoff. Covers the anchor drift a
   *  zoom level's tile-grid quantization (and per-tile terrain heights)
   *  introduces, while staying far below distinct same-name places. */
  static readonly HANDOFF_TOLERANCE_M = 2000;

  private _participants = new Set<DeclutterParticipant>();
  /** Set when the label set changed (register/update/text change) so the next
   *  update re-places even with a static camera. */
  private _dirty = true;

  // Snapshot of the camera/viewport/horizon minimum the last pass ran with.
  private _prevCamera = new Float64Array(35).fill(Number.NaN);
  private _lastRunAt = Number.NEGATIVE_INFINITY;
  private _lastStepAt = Number.NaN;

  /** Shown candidates of the most recent pass, keyed by content, as flat
   *  `[x, y, z, variant]` quads. Read by {@link recentlyShownVariant} when a
   *  tile swap activates a replacement batch. */
  private _shownByContent = new Map<string, number[]>();

  // Reused per-pass scratch to keep steady-state allocations low.
  private _candidates: DeclutterCandidate[] = [];
  /** Packed candidate input for the kernel; grows as the label count does. */
  private _input = new Float64Array(0);
  private _viewMatrix = new Matrix4();
  private _view16 = new Float64Array(16);
  private _proj16 = new Float64Array(16);

  /** True while `update()` runs, which consumes the dirty flag itself. */
  private _updating = false;

  /**
   * @param _kernel the placement kernel — the Rust-backed
   *  `wasmDeclutterKernel` in production, a stub in unit tests.
   * @param _requestFrame asks the view for a frame. Meshes mark the pass dirty
   *  from async work (a material update lands after the frame that delivered
   *  it), and the view renders only on request, so without a frame the pass
   *  would wait for the next camera move.
   */
  constructor(
    private readonly _kernel: DeclutterKernel,
    private readonly _requestFrame: () => void = () => {},
  ) {}

  /** Milliseconds until the throttle window since the last placement pass
   *  elapses, clamped to `[0, MIN_INTERVAL_MS]`. Callers use this to schedule
   *  a follow-up frame after a `"throttled"` result without overshooting the
   *  window by waiting out the full constant from now. */
  remainingThrottleMs(nowMs: number): number {
    return Math.max(
      0,
      DeclutterManager.MIN_INTERVAL_MS - (nowMs - this._lastRunAt),
    );
  }

  register(participant: DeclutterParticipant): void {
    this._participants.add(participant);
    this._dirty = true;
  }

  unregister(participant: DeclutterParticipant): void {
    if (this._participants.delete(participant)) {
      this._dirty = true;
    }
  }

  /** Signal that candidates changed (text, positions, visibility, style) so
   *  the next update re-runs placement even if the camera is still.
   *  `immediate` also lifts the throttle, for labels that stay undrawn until a
   *  pass judges them — along-line labels in a batch a tile swap activated. */
  markDirty(immediate = false): void {
    this._dirty = true;
    if (immediate) this._lastRunAt = Number.NEGATIVE_INFINITY;
    if (!this._updating) this._requestFrame();
  }

  /**
   * The variant the most recent pass showed `contentKey` with, anchored
   * within {@link DeclutterManager.HANDOFF_TOLERANCE_M} of (x, y, z), or
   * `undefined` if it showed none — i.e. whether an equivalent label
   * (typically the swapped-out tile's copy) already holds this screen space.
   * A batch activating in a tile swap uses this to seed such labels as
   * granted, at the same variable anchor, instead of fading them in from
   * hidden, which would blink the whole tile's labels out for a
   * pass-plus-fade.
   */
  recentlyShownVariant(
    contentKey: string,
    x: number,
    y: number,
    z: number,
  ): number | undefined {
    const anchors = this._shownByContent.get(contentKey);
    if (!anchors) return undefined;
    const tol = DeclutterManager.HANDOFF_TOLERANCE_M;
    const tolSq = tol * tol;
    for (let i = 0; i < anchors.length; i += 4) {
      const dx = anchors[i] - x;
      const dy = anchors[i + 1] - y;
      const dz = anchors[i + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= tolSq) return anchors[i + 3];
    }
    return undefined;
  }

  /**
   * Run a placement pass if one is due, then advance any active show/hide
   * fades. `widthPx`/`heightPx` are the viewport in CSS pixels (matching the
   * `uScreenHeightPx` uniform); `nowMs` is the frame timestamp used for
   * throttling and fade stepping; `horizonMinHeight` is the
   * `nvrHorizonMinHeight` uniform the label shaders horizon-cull with.
   */
  update(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    nowMs: number,
    horizonMinHeight: number,
  ): DeclutterUpdateResult {
    if (this._participants.size === 0) return "idle";
    this._updating = true;
    try {
      return this._update(camera, widthPx, heightPx, nowMs, horizonMinHeight);
    } finally {
      this._updating = false;
    }
  }

  private _update(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    nowMs: number,
    horizonMinHeight: number,
  ): DeclutterUpdateResult {
    let ran = false;
    let throttled = false;
    if (
      this._dirty ||
      this._snapshotChanged(camera, widthPx, heightPx, horizonMinHeight)
    ) {
      if (nowMs - this._lastRunAt >= DeclutterManager.MIN_INTERVAL_MS) {
        this._run(camera, widthPx, heightPx, horizonMinHeight);
        this._takeSnapshot(camera, widthPx, heightPx, horizonMinHeight);
        this._dirty = false;
        this._lastRunAt = nowMs;
        ran = true;
      } else {
        throttled = true;
      }
    }

    // Step fades even when no pass ran — placement only sets targets; the
    // animation itself advances here, frame by frame. Clamp the step so the
    // first frame after an idle gap doesn't jump most of the fade at once.
    const deltaMs = Number.isFinite(this._lastStepAt)
      ? Math.min(nowMs - this._lastStepAt, DeclutterManager.MAX_FADE_STEP_MS)
      : 0;
    this._lastStepAt = nowMs;
    let animating = false;
    for (const p of this._participants) {
      animating = p.stepDeclutterFade(deltaMs) || animating;
    }

    // "animating" wins over "throttled": its prompt follow-up frames re-enter
    // this method, so a pending throttled pass still runs once the window
    // elapses.
    if (animating) return "animating";
    if (throttled) return "throttled";
    return ran ? "ran" : "idle";
  }

  private _run(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    horizonMinHeight: number,
  ): void {
    // Let participants start font/shape preparation for labels whose anchors
    // became potentially visible (text batches park preparation while an
    // anchor is out of view, so world-spanning low-zoom tiles don't fetch
    // fonts for labels the camera can't see). Results land asynchronously and
    // mark the pass dirty again, so this pass places only already-shaped
    // labels.
    for (const p of this._participants) {
      p.prepareDeferredLabels?.(camera);
      p.placeLineLabels?.(camera, heightPx);
    }

    const candidates = this._candidates;
    candidates.length = 0;
    for (const p of this._participants) {
      p.collectDeclutterCandidates(candidates);
    }
    const n = candidates.length;
    if (n === 0) return;

    // Pack candidates into the flat kernel input. The layout must match
    // CANDIDATE_STRIDE / the field order the Rust kernel reads.
    const stride = CANDIDATE_STRIDE;
    if (this._input.length < n * stride) {
      this._input = new Float64Array(n * stride);
    }
    const input = this._input;
    for (let i = 0; i < n; i++) {
      const c = candidates[i];
      const o = i * stride;
      input[o] = c.anchorX;
      input[o + 1] = c.anchorY;
      input[o + 2] = c.anchorZ;
      input[o + 3] = c.addHeight;
      input[o + 4] = c.minX;
      input[o + 5] = c.maxX;
      input[o + 6] = c.minY;
      input[o + 7] = c.maxY;
      input[o + 8] = c.sizeInMeters ? 1 : 0;
      input[o + 9] = c.priority;
      input[o + 10] = c.isShown ? 1 : 0;
      input[o + 11] = OVERLAP_CODES[c.overlap];
      input[o + 12] = c.ignorePlacement ? 1 : 0;
      input[o + 13] = c.rank;
      input[o + 14] = c.padding[0];
      input[o + 15] = c.padding[1];
      input[o + 16] = c.padding[2];
      input[o + 17] = c.padding[3];
      input[o + 18] = c.pairGroup;
      input[o + 19] = c.featureIndex;
      input[o + 20] = c.pairGroup === 0 ? 0 : PAIR_ROLE_CODES[c.pairRole];
      input[o + 21] = c.standalone ? 1 : 0;
      input[o + 22] = c.flatFacing ? 1 : 0;
      input[o + 23] = c.rotateWithCamera ? 1 : 0;
      input[o + 24] = c.rotation;
      input[o + 25] = c.translate[0];
      input[o + 26] = c.translate[1];
      input[o + 27] = c.translateViewport ? 0 : 1;
      input[o + 28] = c.variants ?? 1;
    }

    // The pass may run before the renderer refreshed matrixWorldInverse, so
    // derive the view matrix from matrixWorld instead of trusting it.
    const view = this._viewMatrix.copy(camera.matrixWorld).invert();
    const cam = camera.matrixWorld.elements;
    // Three.js Matrix4.elements is a plain number[]; copy into f64 scratch so
    // the typed-array boundary to WASM stays a single cheap copy per matrix.
    this._view16.set(view.elements);
    this._proj16.set(camera.projectionMatrix.elements);

    const hidden = this._kernel.place(
      input.subarray(0, n * stride),
      this._view16,
      this._proj16,
      cam[12],
      cam[13],
      cam[14],
      camera.near,
      widthPx,
      heightPx,
      // Plain math instead of @navaramap/three-api's degreeToRadian — that one
      // is a WASM call whose result we'd only marshal straight back in.
      (camera.fov * Math.PI) / 180.0,
      horizonMinHeight,
      DeclutterManager.HYSTERESIS_PX,
    );

    // Apply results as fade targets, one per label: the row of its group the
    // pass showed, or the one in use if none. Order is irrelevant —
    // applyDeclutter is idempotent per handle — so iterate in candidate
    // order, not sorted order. Rebuild the shown-content registry from the
    // same results.
    this._shownByContent.clear();
    for (let i = 0; i < n;) {
      const rows = Math.max(1, candidates[i].variants ?? 1);
      let shown = i;
      while (shown < i + rows && hidden[shown] !== 0) shown++;
      const isHidden = shown === i + rows;
      const c = candidates[isHidden ? i : shown];
      const variant = c.variant ?? 0;
      c.owner.applyDeclutter(c.handle, isHidden, variant);
      if (!isHidden && c.contentKey) {
        let anchors = this._shownByContent.get(c.contentKey);
        if (!anchors) {
          anchors = [];
          this._shownByContent.set(c.contentKey, anchors);
        }
        anchors.push(c.anchorX, c.anchorY, c.anchorZ, variant);
      }
      i += rows;
    }

    candidates.length = 0;
  }

  /** Drop all registered participants. Call when the owning view is disposed
   *  so this manager doesn't keep strong references to removed meshes (and
   *  their GPU/font resources) past the view's lifetime. */
  dispose(): void {
    this._participants.clear();
    this._candidates.length = 0;
    this._shownByContent.clear();
  }

  private _snapshotChanged(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    horizonMinHeight: number,
  ): boolean {
    const s = this._prevCamera;
    const world = camera.matrixWorld.elements;
    const proj = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) {
      if (s[i] !== world[i] || s[16 + i] !== proj[i]) return true;
    }
    return (
      s[32] !== widthPx || s[33] !== heightPx || s[34] !== horizonMinHeight
    );
  }

  private _takeSnapshot(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    horizonMinHeight: number,
  ): void {
    const s = this._prevCamera;
    s.set(camera.matrixWorld.elements, 0);
    s.set(camera.projectionMatrix.elements, 16);
    s[32] = widthPx;
    s[33] = heightPx;
    s[34] = horizonMinHeight;
  }
}
