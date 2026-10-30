import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";

import { DeclutterManager } from "./DeclutterManager";
import { CANDIDATE_STRIDE, type DeclutterKernel } from "./kernel";
import type { DeclutterCandidate, DeclutterParticipant } from "./types";

const R = 6378137.0;

/** Camera one earth-radius above (R, 0, 0), looking at the surface. */
function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 800 / 600, 1, 1e9);
  camera.position.set(2 * R, 0, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(R, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * Placement kernel stub. The real projection/grid/placement is Rust and is
 * covered by the crate's tests; here we only need to drive the manager's
 * orchestration, so the stub records what it was handed and returns a
 * caller-controlled hidden pattern.
 */
class StubKernel implements DeclutterKernel {
  calls: { candidates: Float64Array; n: number; horizonMinHeight: number }[] =
    [];
  /** Override to control which candidates come back hidden. Default: all shown. */
  hiddenFor: (n: number) => Uint8Array = (n) => new Uint8Array(n);

  place(
    candidates: Float64Array,
    _view: Float64Array,
    _proj: Float64Array,
    _cameraX: number,
    _cameraY: number,
    _cameraZ: number,
    _near: number,
    _widthPx: number,
    _heightPx: number,
    _fovRad: number,
    horizonMinHeight: number,
  ): Uint8Array {
    const n = candidates.length / CANDIDATE_STRIDE;
    this.calls.push({ candidates: candidates.slice(), n, horizonMinHeight });
    return this.hiddenFor(n);
  }
}

class FakeParticipant implements DeclutterParticipant {
  hidden = new Map<number, boolean>();
  variants = new Map<number, number>();
  /** How many more stepDeclutterFade calls report an active fade. */
  fadeStepsLeft = 0;
  fadeDeltas: number[] = [];

  constructor(readonly candidates: Omit<DeclutterCandidate, "owner">[]) {}

  collectDeclutterCandidates(out: DeclutterCandidate[]): void {
    for (const c of this.candidates) out.push({ ...c, owner: this });
  }

  applyDeclutter(handle: number, hidden: boolean, variant: number): void {
    this.hidden.set(handle, hidden);
    this.variants.set(handle, variant);
  }

  stepDeclutterFade(deltaMs: number): boolean {
    this.fadeDeltas.push(deltaMs);
    if (this.fadeStepsLeft <= 0) return false;
    this.fadeStepsLeft--;
    return true;
  }
}

function label(
  partial: Partial<Omit<DeclutterCandidate, "owner">>,
): Omit<DeclutterCandidate, "owner"> {
  return {
    anchorX: R,
    anchorY: 0,
    anchorZ: 0,
    addHeight: 0,
    minX: -10,
    maxX: 10,
    minY: -10,
    maxY: 10,
    sizeInMeters: false,
    rank: 0,
    priority: 0,
    isShown: false,
    overlap: "never",
    ignorePlacement: false,
    padding: [2, 2, 2, 2],
    pairGroup: 0,
    featureIndex: 0,
    pairRole: "label",
    standalone: true,
    flatFacing: false,
    rotateWithCamera: true,
    rotation: 0,
    translate: [0, 0],
    translateViewport: false,
    handle: 0,
    ...partial,
  };
}

describe("DeclutterManager", () => {
  it("requests a frame when marked dirty outside a pass", () => {
    let frames = 0;
    const manager = new DeclutterManager(new StubKernel(), () => frames++);
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    manager.markDirty();
    expect(frames).toBe(1);

    // A participant marking the pass dirty while it runs needs no frame.
    p.collectDeclutterCandidates = (out) => {
      manager.markDirty();
      FakeParticipant.prototype.collectDeclutterCandidates.call(p, out);
    };
    expect(manager.update(makeCamera(), 800, 600, 0, 0)).toBe("ran");
    expect(frames).toBe(1);
  });

  it("packs candidates for the kernel and applies the returned hidden flags", () => {
    const kernel = new StubKernel();
    // Return the second candidate hidden.
    kernel.hiddenFor = (n) => {
      const flags = new Uint8Array(n);
      flags[1] = 1;
      return flags;
    };
    const manager = new DeclutterManager(kernel);
    const p = new FakeParticipant([
      label({
        handle: 0,
        priority: 3,
        isShown: true,
        minX: -4,
        sizeInMeters: true,
        overlap: "cooperative",
        ignorePlacement: true,
        rank: 4,
        padding: [1, 2, 3, 4],
        pairGroup: 9,
        featureIndex: 5,
        pairRole: "billboard",
        standalone: false,
        flatFacing: true,
        rotateWithCamera: false,
        rotation: 0.5,
        translate: [6, -7],
        translateViewport: true,
      }),
      label({ handle: 1, priority: 1, pairRole: "billboard" }),
    ]);
    manager.register(p);

    expect(manager.update(makeCamera(), 800, 600, 0, 0)).toBe("ran");

    // Results applied by handle, in candidate order.
    expect(p.hidden.get(0)).toBe(false);
    expect(p.hidden.get(1)).toBe(true);

    // Candidate 0 was packed into the stride layout the Rust kernel expects.
    const { candidates } = kernel.calls[0];
    expect(candidates.length).toBe(2 * CANDIDATE_STRIDE);
    expect(candidates[0]).toBe(R); // anchorX
    expect(candidates[4]).toBe(-4); // minX
    expect(candidates[8]).toBe(1); // sizeInMeters -> 1
    expect(candidates[9]).toBe(3); // priority
    expect(candidates[10]).toBe(1); // isShown -> 1
    expect(candidates[11]).toBe(2); // overlap: cooperative -> 2
    expect(candidates[12]).toBe(1); // ignorePlacement -> 1
    expect(candidates[13]).toBe(4); // rank
    expect(Array.from(candidates.subarray(14, 18))).toEqual([1, 2, 3, 4]); // padding
    // pairGroup, featureIndex, pairRole (billboard), standalone
    expect(Array.from(candidates.subarray(18, 22))).toEqual([9, 5, 2, 0]);
    // flatFacing, rotateWithCamera, rotation
    expect(Array.from(candidates.subarray(22, 25))).toEqual([1, 0, 0.5]);
    // translateX, translateY, translateMap (viewport -> 0)
    expect(Array.from(candidates.subarray(25, 28))).toEqual([6, -7, 0]);
    // An unpaired candidate packs role 0 whatever its pairRole.
    expect(candidates[CANDIDATE_STRIDE + 20]).toBe(0);
    expect(
      Array.from(
        candidates.subarray(CANDIDATE_STRIDE + 22, CANDIDATE_STRIDE + 25),
      ),
    ).toEqual([0, 1, 0]);
    // A map-anchored translate packs 1.
    expect(candidates[CANDIDATE_STRIDE + 27]).toBe(1);
    expect(candidates[CANDIDATE_STRIDE + 11]).toBe(0); // overlap: never -> 0
  });

  it("throttles re-runs and reports them so the caller can schedule a frame", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();

    expect(manager.update(camera, 800, 600, 0, 0)).toBe("ran");
    expect(manager.update(camera, 800, 600, 50, 0)).toBe("idle");

    manager.markDirty();
    expect(manager.update(camera, 800, 600, 50, 0)).toBe("throttled");
    expect(
      manager.update(camera, 800, 600, DeclutterManager.MIN_INTERVAL_MS, 0),
    ).toBe("ran");
  });

  it("re-places with the new horizon minimum when it changes", () => {
    const kernel = new StubKernel();
    const manager = new DeclutterManager(kernel);
    manager.register(new FakeParticipant([label({ handle: 0 })]));
    const camera = makeCamera();
    const later = DeclutterManager.MIN_INTERVAL_MS;

    expect(manager.update(camera, 800, 600, 0, -500)).toBe("ran");
    expect(manager.update(camera, 800, 600, later, -500)).toBe("idle");
    expect(manager.update(camera, 800, 600, later, -10500)).toBe("ran");
    expect(kernel.calls.map((c) => c.horizonMinHeight)).toEqual([-500, -10500]);
  });

  it("runs an immediate request inside the throttle window", () => {
    const manager = new DeclutterManager(new StubKernel());
    manager.register(new FakeParticipant([label({ handle: 0 })]));
    const camera = makeCamera();

    expect(manager.update(camera, 800, 600, 0, 0)).toBe("ran");
    manager.markDirty(true);
    expect(manager.update(camera, 800, 600, 50, 0)).toBe("ran");
  });

  it("re-runs when the camera moves and stays idle when nothing changed", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();

    expect(manager.update(camera, 800, 600, 0, 0)).toBe("ran");
    expect(manager.update(camera, 800, 600, 1000, 0)).toBe("idle");

    camera.position.z += 1000;
    camera.updateMatrixWorld(true);
    expect(manager.update(camera, 800, 600, 2000, 0)).toBe("ran");

    // A viewport resize also invalidates placement.
    expect(manager.update(camera, 1024, 768, 3000, 0)).toBe("ran");
  });

  it("reports 'animating' while fades are active, then settles", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();

    // The pass that (re)targets labels also starts their fade.
    p.fadeStepsLeft = 2;
    expect(manager.update(camera, 800, 600, 0, 0)).toBe("animating");
    expect(manager.update(camera, 800, 600, 16, 0)).toBe("animating");
    expect(manager.update(camera, 800, 600, 32, 0)).toBe("idle");
  });

  it("clamps fade steps after an idle gap", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();

    manager.update(camera, 800, 600, 0, 0);
    // 10s of engine idle must not advance a new fade by 10s worth.
    manager.update(camera, 800, 600, 10_000, 0);
    for (const delta of p.fadeDeltas) {
      expect(delta).toBeLessThanOrEqual(DeclutterManager.MAX_FADE_STEP_MS);
    }
  });

  it("prefers 'animating' over 'throttled' so pending passes still settle", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();

    expect(manager.update(camera, 800, 600, 0, 0)).toBe("ran");
    manager.markDirty();
    p.fadeStepsLeft = 1;
    // Dirty + inside the throttle window + fading: animating wins because its
    // prompt follow-ups re-enter update, which runs the pass once due.
    expect(manager.update(camera, 800, 600, 50, 0)).toBe("animating");
    expect(
      manager.update(camera, 800, 600, DeclutterManager.MIN_INTERVAL_MS, 0),
    ).toBe("ran");
  });

  it("goes idle when the last participant unregisters", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();
    expect(manager.update(camera, 800, 600, 0, 0)).toBe("ran");

    manager.unregister(p);
    expect(manager.update(camera, 800, 600, 1000, 0)).toBe("idle");
  });

  it("reports the remaining throttle window since the last pass, not the full constant", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();

    expect(manager.update(camera, 800, 600, 0, 0)).toBe("ran");
    manager.markDirty();
    expect(manager.update(camera, 800, 600, 100, 0)).toBe("throttled");
    // 50ms of the 150ms window has already elapsed since the last pass.
    expect(manager.remainingThrottleMs(100)).toBe(
      DeclutterManager.MIN_INTERVAL_MS - 100,
    );
    // Never negative once the window has fully elapsed.
    expect(manager.remainingThrottleMs(10_000)).toBe(0);
  });

  it("dispose() drops participants so a later update() is idle", () => {
    const manager = new DeclutterManager(new StubKernel());
    const p = new FakeParticipant([label({ handle: 0 })]);
    manager.register(p);
    const camera = makeCamera();
    expect(manager.update(camera, 800, 600, 0, 0)).toBe("ran");

    manager.dispose();
    expect(manager.update(camera, 800, 600, 1000, 0)).toBe("idle");
  });

  describe("variable anchors", () => {
    /** A label tagged 5 in use, with alternatives tagged 1 and 7. */
    const group = () => [
      label({ handle: 0, variants: 3, variant: 5 }),
      label({ handle: 0, variants: 0, variant: 1 }),
      label({ handle: 0, variants: 0, variant: 7 }),
    ];

    it("packs the group size on the first row and 0 on the rest", () => {
      const kernel = new StubKernel();
      const manager = new DeclutterManager(kernel);
      manager.register(new FakeParticipant([...group(), label({ handle: 1 })]));
      manager.update(makeCamera(), 800, 600, 0, 0);

      const packed = kernel.calls[0].candidates;
      const variants = [0, 1, 2, 3].map(
        (i) => packed[i * CANDIDATE_STRIDE + 28],
      );
      expect(variants).toEqual([3, 0, 0, 1]);
    });

    it("applies one result per label, with the variant the pass showed", () => {
      const kernel = new StubKernel();
      kernel.hiddenFor = () => Uint8Array.from([1, 1, 0, 1]);
      const manager = new DeclutterManager(kernel);
      const p = new FakeParticipant([...group(), label({ handle: 1 })]);
      manager.register(p);
      manager.update(makeCamera(), 800, 600, 0, 0);

      expect(p.hidden).toEqual(
        new Map([
          [0, false],
          [1, true],
        ]),
      );
      expect(p.variants.get(0)).toBe(7);
      expect(p.variants.get(1)).toBe(0);
    });

    it("keeps the variant in use for a label hidden at every anchor", () => {
      const kernel = new StubKernel();
      kernel.hiddenFor = (n) => new Uint8Array(n).fill(1);
      const manager = new DeclutterManager(kernel);
      const p = new FakeParticipant(group());
      manager.register(p);
      manager.update(makeCamera(), 800, 600, 0, 0);

      expect(p.hidden.get(0)).toBe(true);
      expect(p.variants.get(0)).toBe(5);
    });
  });

  // Tile swaps replace a batch wholesale; the new batch's labels start hidden
  // and would re-earn placement from scratch (throttled pass + fade-in) while
  // the old batch vanished instantly — a tile-shaped blink. The registry lets
  // the new batch seed a label as already-granted when the previous pass
  // showed the same content at (nearly) the same anchor.
  describe("shown-content registry (tile-swap handoff)", () => {
    it("answers lookups for content shown by the last pass, within tolerance", () => {
      const manager = new DeclutterManager(new StubKernel());
      const p = new FakeParticipant([label({ handle: 0, contentKey: "東京" })]);
      manager.register(p);

      // Nothing recorded before any pass ran.
      expect(manager.recentlyShownVariant("東京", R, 0, 0)).toBeUndefined();

      manager.update(makeCamera(), 800, 600, 0, 0);

      expect(manager.recentlyShownVariant("東京", R, 0, 0)).toBe(0);
      // Same content, slightly offset anchor (a coarser tile's quantization).
      expect(manager.recentlyShownVariant("東京", R + 500, 200, -300)).toBe(0);
      // Same content but far away (an unrelated same-name label).
      expect(
        manager.recentlyShownVariant("東京", R + 50_000, 0, 0),
      ).toBeUndefined();
      // Different content at the same anchor.
      expect(manager.recentlyShownVariant("大阪", R, 0, 0)).toBeUndefined();
    });

    it("does not record candidates the pass hid", () => {
      const kernel = new StubKernel();
      kernel.hiddenFor = (n) => new Uint8Array(n).fill(1);
      const manager = new DeclutterManager(kernel);
      const p = new FakeParticipant([label({ handle: 0, contentKey: "東京" })]);
      manager.register(p);

      manager.update(makeCamera(), 800, 600, 0, 0);

      expect(manager.recentlyShownVariant("東京", R, 0, 0)).toBeUndefined();
    });

    it("reflects the latest pass only", () => {
      const kernel = new StubKernel();
      const manager = new DeclutterManager(kernel);
      const p = new FakeParticipant([label({ handle: 0, contentKey: "東京" })]);
      manager.register(p);
      const camera = makeCamera();

      manager.update(camera, 800, 600, 0, 0);
      expect(manager.recentlyShownVariant("東京", R, 0, 0)).toBe(0);

      // The next pass hides it; the registry must forget it.
      kernel.hiddenFor = (n) => new Uint8Array(n).fill(1);
      manager.markDirty();
      manager.update(camera, 800, 600, DeclutterManager.MIN_INTERVAL_MS, 0);
      expect(manager.recentlyShownVariant("東京", R, 0, 0)).toBeUndefined();
    });

    it("records the variable anchor a label was shown with", () => {
      const kernel = new StubKernel();
      kernel.hiddenFor = () => Uint8Array.from([1, 0]);
      const manager = new DeclutterManager(kernel);
      manager.register(
        new FakeParticipant([
          label({ variants: 2, variant: 0, contentKey: "東京" }),
          label({ variants: 0, variant: 3, contentKey: "東京" }),
        ]),
      );

      manager.update(makeCamera(), 800, 600, 0, 0);

      expect(manager.recentlyShownVariant("東京", R, 0, 0)).toBe(3);
    });

    it("ignores candidates without a contentKey", () => {
      const manager = new DeclutterManager(new StubKernel());
      const p = new FakeParticipant([label({ handle: 0 })]);
      manager.register(p);

      manager.update(makeCamera(), 800, 600, 0, 0);

      expect(manager.recentlyShownVariant("", R, 0, 0)).toBeUndefined();
    });
  });
});
