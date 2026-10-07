import {
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector2,
  type WebGLRenderer,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrapedMesh } from "../mesh/DrapedMesh";
import type { MeshCache } from "../type";

import { isClickGesture, PickHelper } from "./pickHelper";

describe("isClickGesture", () => {
  it("accepts a pointerup at the exact pointerdown position", () => {
    expect(isClickGesture(new Vector2(100, 100), new Vector2(100, 100))).toBe(
      true,
    );
  });

  it("accepts small jitter during a click (a few pixels)", () => {
    expect(isClickGesture(new Vector2(100, 100), new Vector2(102, 101))).toBe(
      true,
    );
    expect(isClickGesture(new Vector2(100, 100), new Vector2(97, 103))).toBe(
      true,
    );
  });

  it("accepts travel just under the 5px tolerance", () => {
    // 3-4-5 triangle scaled slightly down: distance ~4.99
    expect(isClickGesture(new Vector2(0, 0), new Vector2(2.99, 3.99))).toBe(
      true,
    );
  });

  it("rejects travel at or beyond the 5px tolerance", () => {
    expect(isClickGesture(new Vector2(0, 0), new Vector2(3, 4))).toBe(false);
    expect(isClickGesture(new Vector2(0, 0), new Vector2(5, 0))).toBe(false);
  });

  it("rejects a clear drag", () => {
    expect(isClickGesture(new Vector2(100, 100), new Vector2(180, 40))).toBe(
      false,
    );
  });

  it("uses euclidean distance, not per-axis deltas", () => {
    // Each axis moved less than 5px but the combined travel exceeds it.
    expect(isClickGesture(new Vector2(0, 0), new Vector2(4, 4))).toBe(false);
  });

  it("accepts a wider travel when given an explicit tolerance (touch taps)", () => {
    expect(isClickGesture(new Vector2(0, 0), new Vector2(20, 0), 30)).toBe(
      true,
    );
    expect(isClickGesture(new Vector2(0, 0), new Vector2(30, 0), 30)).toBe(
      false,
    );
  });
});

/**
 * Renderer stub: just enough of the WebGLRenderer surface for PickHelper.
 * `pixel` is what the next readback returns; `scissors`/`renderCount`
 * record the GPU work a pick performed.
 */
const createRendererStub = () => {
  const state = {
    pixel: [0, 0, 0] as [number, number, number],
    /** Per-pixel override for the readback, keyed by device coords. */
    pixelAt: undefined as
      ((x: number, y: number) => [number, number, number]) | undefined,
    renderCount: 0,
    scissors: [] as { x: number; y: number; w: number; h: number }[],
    /** Clears and renders in call order, with each scene's children then. */
    calls: [] as (
      { clear: [boolean, boolean, boolean] } | { render: Object3D[] }
    )[],
  };
  const renderer = {
    getContext: () => ({ drawingBufferWidth: 800, drawingBufferHeight: 600 }),
    getPixelRatio: () => 1,
    getClearColor: () => undefined,
    getClearAlpha: () => 1,
    getRenderTarget: () => null,
    setClearColor: () => undefined,
    setRenderTarget: () => undefined,
    clear: (color: boolean, depth: boolean, stencil: boolean) => {
      state.calls.push({ clear: [color, depth, stencil] });
    },
    autoClear: true,
    render: (scene: Scene) => {
      state.renderCount++;
      state.calls.push({ render: [...scene.children] });
    },
    setScissor: (x: number, y: number, w: number, h: number) => {
      state.scissors.push({ x, y, w, h });
    },
    setScissorTest: () => undefined,
    readRenderTargetPixels: (
      _target: unknown,
      x: number,
      y: number,
      w: number,
      h: number,
      buffer: Uint8Array,
    ) => {
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const i = (row * w + col) * 4;
          const [r, g, b] = state.pixelAt?.(x + col, y + row) ?? state.pixel;
          buffer[i] = r;
          buffer[i + 1] = g;
          buffer[i + 2] = b;
          buffer[i + 3] = 255;
        }
      }
    },
  } as unknown as WebGLRenderer;
  return { renderer, state };
};

describe("PickHelper", () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.set(++nextRafId, cb);
      return nextRafId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Runs every rAF callback queued so far (one simulated frame). */
  const runFrame = () => {
    const callbacks = [...rafCallbacks.values()];
    rafCallbacks.clear();
    for (const cb of callbacks) cb(0);
  };

  const setup = (opts?: {
    clickable?: boolean;
    hoverable?: boolean;
    meshes?: MeshCache;
  }) => {
    const element = document.createElement("div");
    const { renderer, state } = createRendererStub();
    const picks: number[][] = [];
    const hovers: number[][] = [];
    // Mutable so tests can flip a gate mid-flight (listener removal).
    const gates = {
      clickable: opts?.clickable ?? true,
      hoverable: opts?.hoverable ?? true,
    };
    const helper = new PickHelper(
      element,
      renderer,
      new PerspectiveCamera(),
      opts?.meshes ?? (new Map() as MeshCache),
      (arr) => picks.push(arr),
      (arr) => hovers.push(arr),
      () => gates.clickable,
      () => gates.hoverable,
      { value: null },
      new Scene(),
    );
    helper.enablePick(true);

    const pointer = (
      type: string,
      x: number,
      y: number,
      init?: PointerEventInit,
    ) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerType: "mouse",
          ...init,
        }),
      );
    return { helper, element, state, picks, hovers, gates, pointer };
  };

  describe("click picking", () => {
    it("decodes the batch id from the pick render", () => {
      const { state, picks, pointer } = setup();
      state.pixel = [0, 1, 2]; // (0 << 16) + (1 << 8) + 2

      pointer("pointerdown", 100, 100);
      pointer("pointerup", 100, 100);

      expect(picks).toEqual([[258]]);
      expect(state.renderCount).toBe(1);
    });

    it("reports an empty pick for a miss (batch id 0)", () => {
      const { picks, pointer } = setup();

      pointer("pointerdown", 100, 100);
      pointer("pointerup", 100, 100);

      expect(picks).toEqual([[]]);
    });

    it("limits GPU work to the search window via scissor", () => {
      const { state, pointer } = setup();

      pointer("pointerdown", 30, 40);
      pointer("pointerup", 30, 40);

      // A (2 * PICK_RADIUS + 1)² window centered on the click; y is flipped
      // into WebGL space: 600 - 1 - 40.
      expect(state.scissors).toEqual([{ x: 27, y: 556, w: 7, h: 7 }]);
    });

    it("picks the non-zero id closest to the pointer within the window", () => {
      const { state, picks, pointer } = setup();
      // Two hits inside the window around (100, 100) (device y = 499):
      // id 5 at 3px away, id 9 at 1px away. The closer one wins.
      state.pixelAt = (x, y) => {
        if (x === 103 && y === 499) return [0, 0, 5];
        if (x === 101 && y === 499) return [0, 0, 9];
        return [0, 0, 0];
      };

      pointer("pointerdown", 100, 100);
      pointer("pointerup", 100, 100);

      expect(picks).toEqual([[9]]);
    });

    it("does not pick when the gesture is a drag", () => {
      const { state, picks, pointer } = setup();

      pointer("pointerdown", 100, 100);
      pointer("pointerup", 150, 150);

      expect(picks).toEqual([]);
      expect(state.renderCount).toBe(0);
    });

    it("skips the pick render entirely when nobody listens", () => {
      const { state, picks, pointer } = setup({ clickable: false });

      pointer("pointerdown", 100, 100);
      pointer("pointerup", 100, 100);

      expect(picks).toEqual([]);
      expect(state.renderCount).toBe(0);
    });
  });

  describe("draped pickables", () => {
    const pickable = (raw: Object3D) => ({
      batchId: 1,
      onBeforePicking: () => undefined,
      onAfterPicking: () => undefined,
      getRenderable: () => raw,
    });

    it("are drawn before the other pickables, so those in front cover them", () => {
      const material = new MeshBasicMaterial();
      const draped = new DrapedMesh(undefined, material, true);
      const standing = new Mesh();
      new Scene().add(draped, standing);
      const meshes = new Map([
        ["draped", pickable(draped)],
        ["standing", pickable(standing)],
      ]) as unknown as MeshCache;
      const { state, pointer } = setup({ meshes });

      pointer("pointerdown", 100, 100);
      pointer("pointerup", 100, 100);

      const drapedRenders = state.calls.flatMap((call, i) =>
        "render" in call && call.render.includes(draped) ? [i] : [],
      );
      const lastDraped = drapedRenders[drapedRenders.length - 1];
      const standingRender = state.calls.findIndex(
        (call) => "render" in call && call.render.includes(standing),
      );
      expect(drapedRenders.length).toBeGreaterThan(0);
      expect(standingRender).toBeGreaterThan(lastDraped);
      expect(draped.parent).toBe(standing.parent);
    });
  });

  describe("touch tap picking", () => {
    const touch = { pointerType: "touch" } as const;

    it("picks on a single-finger tap", () => {
      const { state, picks, pointer } = setup();
      state.pixel = [0, 0, 9];

      pointer("pointerdown", 100, 100, touch);
      pointer("pointerup", 100, 100, touch);

      expect(picks).toEqual([[9]]);
      expect(state.renderCount).toBe(1);
    });

    it("tolerates finger jitter beyond the mouse click tolerance", () => {
      const { picks, pointer } = setup();

      // 20px of travel: a drag for a mouse, still a tap for a finger.
      pointer("pointerdown", 100, 100, touch);
      pointer("pointerup", 120, 100, touch);

      expect(picks).toEqual([[]]);
    });

    it("rejects travel beyond the tap tolerance", () => {
      const { state, picks, pointer } = setup();

      pointer("pointerdown", 100, 100, touch);
      pointer("pointerup", 140, 100, touch);

      expect(picks).toEqual([]);
      expect(state.renderCount).toBe(0);
    });

    it("keeps the stricter tolerance for the mouse", () => {
      const { state, picks, pointer } = setup();

      pointer("pointerdown", 100, 100);
      pointer("pointerup", 120, 100);

      expect(picks).toEqual([]);
      expect(state.renderCount).toBe(0);
    });

    it("does not pick when a second finger joins (pinch)", () => {
      const { state, picks, pointer } = setup();

      pointer("pointerdown", 100, 100, touch);
      pointer("pointerdown", 120, 100, { ...touch, isPrimary: false });
      pointer("pointerup", 120, 100, { ...touch, isPrimary: false });
      pointer("pointerup", 100, 100, touch);

      expect(picks).toEqual([]);
      expect(state.renderCount).toBe(0);
    });

    it("searches a wider window than the mouse (fingers are less precise)", () => {
      const { state, pointer } = setup();

      pointer("pointerdown", 100, 100, touch);
      pointer("pointerup", 100, 100, touch);

      // (2 * TOUCH_PICK_RADIUS + 1)² centered on the tap (device y = 499).
      expect(state.scissors).toEqual([{ x: 90, y: 489, w: 21, h: 21 }]);
    });

    it("does not pick when the browser cancels the gesture", () => {
      const { state, picks, pointer } = setup();

      pointer("pointerdown", 100, 100, touch);
      pointer("pointercancel", 100, 100, touch);
      pointer("pointerup", 100, 100, touch);

      expect(picks).toEqual([]);
      expect(state.renderCount).toBe(0);
    });
  });

  describe("hover picking", () => {
    it("picks at most once per animation frame, at the latest position", () => {
      const { state, hovers, pointer } = setup();
      state.pixel = [0, 0, 7];

      pointer("pointermove", 10, 10);
      pointer("pointermove", 20, 20);
      pointer("pointermove", 30, 30);
      expect(hovers).toEqual([]); // nothing until the frame fires

      runFrame();

      expect(hovers).toEqual([[7]]);
      expect(state.renderCount).toBe(1);
      expect(state.scissors).toEqual([{ x: 27, y: 566, w: 7, h: 7 }]);
    });

    it("reports an empty hover for a miss", () => {
      const { hovers, pointer } = setup();

      pointer("pointermove", 10, 10);
      runFrame();

      expect(hovers).toEqual([[]]);
    });

    it("is suppressed while a button is pressed (including touch contact)", () => {
      const { state, hovers, pointer } = setup();

      pointer("pointermove", 10, 10, { buttons: 1 });
      pointer("pointermove", 10, 10, { buttons: 1, pointerType: "touch" });
      runFrame();

      expect(hovers).toEqual([]);
      expect(state.renderCount).toBe(0);
    });

    it("re-checks the listener gate when the frame fires", () => {
      const { state, hovers, gates, pointer } = setup();
      state.pixel = [0, 0, 7];

      pointer("pointermove", 10, 10);
      // Listeners are removed between the pointermove and the frame.
      gates.hoverable = false;
      runFrame();

      expect(hovers).toEqual([]);
      expect(state.renderCount).toBe(0);
    });

    it("schedules nothing when no hover listener is registered", () => {
      const { state, hovers, pointer } = setup({ hoverable: false });

      pointer("pointermove", 10, 10);

      expect(rafCallbacks.size).toBe(0);
      runFrame();
      expect(hovers).toEqual([]);
      expect(state.renderCount).toBe(0);
    });

    it("pointerleave reports nothing hovered and cancels the pending pick", () => {
      const { state, hovers, pointer } = setup();
      state.pixel = [0, 0, 7];

      pointer("pointermove", 10, 10);
      pointer("pointerleave", 10, 10);

      expect(hovers).toEqual([[]]);

      runFrame();
      // The queued pick was cancelled: no render, no second callback.
      expect(hovers).toEqual([[]]);
      expect(state.renderCount).toBe(0);
    });

    it("pointerleave stays silent without hover listeners", () => {
      const { hovers, pointer } = setup({ hoverable: false });

      pointer("pointerleave", 10, 10);

      expect(hovers).toEqual([]);
    });
  });

  describe("enablePick(false)", () => {
    it("detaches every handler and cancels pending hover picks", () => {
      const { helper, state, picks, hovers, pointer } = setup();
      state.pixel = [0, 0, 7];
      pointer("pointermove", 10, 10);

      helper.enablePick(false);

      expect(rafCallbacks.size).toBe(0);
      pointer("pointerdown", 100, 100);
      pointer("pointerup", 100, 100);
      pointer("pointermove", 20, 20);
      runFrame();

      expect(picks).toEqual([]);
      expect(hovers).toEqual([]);
      expect(state.renderCount).toBe(0);
    });
  });
});
