import { Matrix4, type PerspectiveCamera } from "three";

import { CANDIDATE_STRIDE, type DeclutterKernel } from "./kernel";
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
  /** Padding added around every collision box (px); two labels never sit
   *  closer than twice this. */
  static readonly PADDING_PX = 2;
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

  // Snapshot of the camera/viewport the last pass ran with.
  private _prevCamera = new Float64Array(34).fill(Number.NaN);
  private _lastRunAt = Number.NEGATIVE_INFINITY;
  private _lastStepAt = Number.NaN;

  /** Shown candidates of the most recent pass, keyed by content, as flat xyz
   *  anchor triplets. Read by {@link wasRecentlyShown} when a tile swap
   *  activates a replacement batch. */
  private _shownByContent = new Map<string, number[]>();

  // Reused per-pass scratch to keep steady-state allocations low.
  private _candidates: DeclutterCandidate[] = [];
  /** Packed candidate input for the kernel; grows as the label count does. */
  private _input = new Float64Array(0);
  private _viewMatrix = new Matrix4();
  private _view16 = new Float64Array(16);
  private _proj16 = new Float64Array(16);

  /** @param _kernel the placement kernel — the Rust-backed
   *  `wasmDeclutterKernel` in production, a stub in unit tests. */
  constructor(private readonly _kernel: DeclutterKernel) {}

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
   *  the next update re-runs placement even if the camera is still. */
  markDirty(): void {
    this._dirty = true;
  }

  /**
   * Whether the most recent pass showed `contentKey` anchored within
   * {@link DeclutterManager.HANDOFF_TOLERANCE_M} of (x, y, z) — i.e. an
   * equivalent label (typically the swapped-out tile's copy) already holds
   * this screen space. A batch activating in a tile swap uses this to seed
   * such labels as granted instead of fading them in from hidden, which
   * would blink the whole tile's labels out for a pass-plus-fade.
   */
  wasRecentlyShown(
    contentKey: string,
    x: number,
    y: number,
    z: number,
  ): boolean {
    const anchors = this._shownByContent.get(contentKey);
    if (!anchors) return false;
    const tol = DeclutterManager.HANDOFF_TOLERANCE_M;
    const tolSq = tol * tol;
    for (let i = 0; i < anchors.length; i += 3) {
      const dx = anchors[i] - x;
      const dy = anchors[i + 1] - y;
      const dz = anchors[i + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= tolSq) return true;
    }
    return false;
  }

  /**
   * Run a placement pass if one is due, then advance any active show/hide
   * fades. `widthPx`/`heightPx` are the viewport in CSS pixels (matching the
   * `uScreenHeightPx` uniform); `nowMs` is the frame timestamp used for
   * throttling and fade stepping.
   */
  update(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
    nowMs: number,
  ): DeclutterUpdateResult {
    if (this._participants.size === 0) return "idle";

    let ran = false;
    let throttled = false;
    if (this._dirty || this._snapshotChanged(camera, widthPx, heightPx)) {
      if (nowMs - this._lastRunAt >= DeclutterManager.MIN_INTERVAL_MS) {
        this._run(camera, widthPx, heightPx);
        this._takeSnapshot(camera, widthPx, heightPx);
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
  ): void {
    // Let participants start font/shape preparation for labels whose anchors
    // became potentially visible (text batches park preparation while an
    // anchor is out of view, so world-spanning low-zoom tiles don't fetch
    // fonts for labels the camera can't see). Results land asynchronously and
    // mark the pass dirty again, so this pass places only already-shaped
    // labels.
    for (const p of this._participants) {
      p.prepareDeferredLabels?.(camera);
      p.placeLineLabels?.(camera, widthPx, heightPx);
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
      DeclutterManager.PADDING_PX,
      DeclutterManager.HYSTERESIS_PX,
    );

    // Apply results as fade targets. Order is irrelevant — applyDeclutter is
    // idempotent per handle — so iterate in candidate order, not sorted order.
    // Rebuild the shown-content registry from the same results.
    this._shownByContent.clear();
    for (let i = 0; i < n; i++) {
      const c = candidates[i];
      const isHidden = hidden[i] !== 0;
      c.owner.applyDeclutter(c.handle, isHidden);
      if (!isHidden && c.contentKey) {
        let anchors = this._shownByContent.get(c.contentKey);
        if (!anchors) {
          anchors = [];
          this._shownByContent.set(c.contentKey, anchors);
        }
        anchors.push(c.anchorX, c.anchorY, c.anchorZ);
      }
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
  ): boolean {
    const s = this._prevCamera;
    const world = camera.matrixWorld.elements;
    const proj = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) {
      if (s[i] !== world[i] || s[16 + i] !== proj[i]) return true;
    }
    return s[32] !== widthPx || s[33] !== heightPx;
  }

  private _takeSnapshot(
    camera: PerspectiveCamera,
    widthPx: number,
    heightPx: number,
  ): void {
    const s = this._prevCamera;
    s.set(camera.matrixWorld.elements, 0);
    s.set(camera.projectionMatrix.elements, 16);
    s[32] = widthPx;
    s[33] = heightPx;
  }
}
