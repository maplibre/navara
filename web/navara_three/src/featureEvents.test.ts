import { PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PickHelper } from "./pick/pickHelper";
import type { MeshCache } from "./type";

import type { PickedFeature } from "./index";

// The worker package spins up its pool at module load, which needs Node's
// `os`; these tests never reach it.
vi.mock("@navaramap/worker", () => ({}));

const { convertScreenPos } = vi.hoisted(() => ({
  convertScreenPos:
    vi.fn<
      (
        view: unknown,
        x: number,
        y: number,
      ) => { x: number; y: number; z: number } | undefined
    >(),
}));
vi.mock("./utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils")>()),
  convertScreenPos,
}));

const { default: ThreeView } = await import("./index");

type Emitted = [string, ...unknown[]];

/** The view's feature-event handlers, private in `ThreeView`. */
type FeatureEventHandlers = {
  onPick(pickArr: number[], event: PointerEvent): void;
  onHoverPick(pickArr: number[], event: PointerEvent): void;
  convertToMapEvent(event: PointerEvent): unknown;
  _startMainLoop(): void;
  _listenToPointerEvents(): void;
};

const MAP = { x: 1, y: 2, z: 3 };

const feature = (batchId: number): PickedFeature => ({
  batchId,
  properties: { name: `f${batchId}` },
  layerId: "layer",
});

/**
 * A view with only the state the feature-event handlers read; `emit` is
 * recorded instead of dispatched.
 */
const createView = () => {
  const emitted: Emitted[] = [];
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect;
  const view = Object.assign(Object.create(ThreeView.prototype) as object, {
    _renderFlag: { forceUpdate: false, animation: false },
    _renderer: { domElement: canvas },
    _hoveredFeature: null,
    resolvePickedFeature: feature,
    emit: (...args: Emitted) => {
      emitted.push(args);
      return true;
    },
  }) as unknown as FeatureEventHandlers;
  return { view, emitted };
};

const pointerEvent = (type: string, x = 110, y = 220) =>
  new PointerEvent(type, { clientX: x, clientY: y, isPrimary: true });

beforeEach(() => {
  convertScreenPos.mockReset();
  convertScreenPos.mockReturnValue(MAP);
});

describe("featureClick", () => {
  it("passes the pointerup with its map position as the second argument", () => {
    const { view, emitted } = createView();
    const event = pointerEvent("pointerup");

    view.onPick([7], event);

    expect(emitted).toEqual([["featureClick", feature(7), event]]);
    expect(emitted[0][2]).toBe(event);
    expect(event).toMatchObject({ clientX: 110, clientY: 220, map: MAP });
    // Canvas-relative, as for `click`.
    expect(convertScreenPos).toHaveBeenCalledWith(view, 100, 200);
  });

  it("passes the event when nothing pickable was hit", () => {
    const { view, emitted } = createView();
    const event = pointerEvent("pointerup");

    view.onPick([], event);

    expect(emitted).toEqual([["featureClick", null, event]]);
    expect(event).toMatchObject({ map: MAP });
  });

  it("passes the event without `map` off the globe (the sky)", () => {
    const { view, emitted } = createView();
    convertScreenPos.mockReturnValue(undefined);
    const event = pointerEvent("pointerup");

    view.onPick([7], event);

    expect(emitted).toEqual([["featureClick", feature(7), event]]);
    expect("map" in event).toBe(false);
  });

  it("shares the event and its map with the `click` of the same gesture", () => {
    const { view } = createView();
    const event = pointerEvent("pointerup");

    view.onPick([7], event);
    // The view's own pointerup listener runs after the pick's.
    const clickEvent = view.convertToMapEvent(event);

    expect(clickEvent).toBe(event);
    expect(convertScreenPos).toHaveBeenCalledTimes(1);
  });
});

describe("featureHover / featureEnter / featureLeave", () => {
  it("pass the picked pointermove to every event of a change", () => {
    const { view, emitted } = createView();
    view.onHoverPick([1], pointerEvent("pointermove"));
    emitted.length = 0;
    const event = pointerEvent("pointermove");

    view.onHoverPick([2], event);

    expect(emitted).toEqual([
      ["featureLeave", feature(1), event],
      ["featureEnter", feature(2), event],
      ["featureHover", feature(2), event],
    ]);
    expect(event).toMatchObject({ map: MAP });
  });

  it("pass the pointerleave when the pointer leaves the canvas", () => {
    const { view, emitted } = createView();
    view.onHoverPick([1], pointerEvent("pointermove"));
    emitted.length = 0;
    const leave = pointerEvent("pointerleave");

    view.onHoverPick([], leave);

    expect(emitted).toEqual([
      ["featureLeave", feature(1), leave],
      ["featureHover", null, leave],
    ]);
  });

  it("compute nothing for a hover pick that changes nothing", () => {
    const { view, emitted } = createView();
    view.onHoverPick([1], pointerEvent("pointermove"));
    emitted.length = 0;
    convertScreenPos.mockClear();

    view.onHoverPick([1], pointerEvent("pointermove"));
    view.onHoverPick([1], pointerEvent("pointermove"));

    expect(emitted).toEqual([]);
    expect(convertScreenPos).not.toHaveBeenCalled();
  });

  it("reuse the map the view's pointermove listener already set", () => {
    const { view, emitted } = createView();
    const event = Object.assign(pointerEvent("pointermove"), {
      map: { x: 4, y: 5, z: 6 },
    });

    view.onHoverPick([1], event);

    expect(convertScreenPos).not.toHaveBeenCalled();
    expect(emitted[emitted.length - 1]).toEqual([
      "featureHover",
      feature(1),
      event,
    ]);
    expect(event.map).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe("the frame loop", () => {
  it("picks the hover before it resizes, updates the camera and renders", () => {
    // user: pick-returns-drawn-surface — `pickDepthPosition` in a hover
    // listener reads the depth and the camera of the frame on screen. A
    // resize replaces the depth copy and the camera's aspect, so it comes
    // after the pick too.
    const order: string[] = [];
    let loop: ((time: number) => void) | undefined;
    const view = Object.assign(Object.create(ThreeView.prototype) as object, {
      _options: {},
      _renderer: {
        info: { reset: () => undefined },
        setAnimationLoop: (cb: (time: number) => void) => {
          loop = cb;
        },
      },
      _renderFlag: { forceUpdate: false, animation: false },
      _pickHelper: { pickHover: () => order.push("pickHover") },
      _forceFeatureUpdates: () => order.push("featureUpdates"),
      _update: () => {
        order.push("update");
        return true;
      },
      _render: () => order.push("render"),
      _dispatcher: { inFlight: () => 0 },
      _frameTick: 0,
      // A resize is pending, as on every frame of a sidebar transition.
      _resizePending: true,
      _handleResize: () => order.push("resize"),
      size: () => 0,
      emit: () => true,
    }) as unknown as FeatureEventHandlers;
    Object.defineProperty(view, "eventContext", {
      value: { updatedAt: 0 },
    });

    view._startMainLoop();
    loop?.(16);

    expect(order).toEqual([
      "pickHover",
      "resize",
      "featureUpdates",
      "update",
      "render",
    ]);
  });
});

describe("the pointer listeners", () => {
  it("added after the PickHelper's, as init does, emit featureClick before click with one event", () => {
    const { view, emitted } = createView();
    const canvas = (
      view as unknown as { _renderer: { domElement: HTMLElement } }
    )._renderer.domElement;
    Object.assign(view, { _canvasListeners: new AbortController() });
    // Just enough of the renderer for a click pick that hits batch id 7.
    const renderer = {
      capabilities: { reversedDepthBuffer: false },
      getContext: () => ({ drawingBufferWidth: 800, drawingBufferHeight: 600 }),
      getPixelRatio: () => 1,
      getClearColor: () => undefined,
      getClearAlpha: () => 1,
      getRenderTarget: () => null,
      setClearColor: () => undefined,
      setRenderTarget: () => undefined,
      clear: () => undefined,
      render: () => undefined,
      setScissor: () => undefined,
      setScissorTest: () => undefined,
      readRenderTargetPixels: (
        _target: unknown,
        _x: number,
        _y: number,
        w: number,
        h: number,
        buffer: Uint8Array,
      ) => {
        for (let i = 0; i < w * h; i++) buffer[i * 4 + 2] = 7;
      },
      autoClear: true,
    } as unknown as WebGLRenderer;
    new PickHelper(
      canvas,
      renderer,
      new PerspectiveCamera(),
      new Map() as MeshCache,
      (arr, event) => view.onPick(arr, event),
      (arr, event) => view.onHoverPick(arr, event),
      () => true,
      () => false,
      { value: null },
      new Scene(),
    ).enablePick(true);
    view._listenToPointerEvents();

    const init = { clientX: 110, clientY: 220, isPrimary: true, button: 0 };
    canvas.dispatchEvent(new PointerEvent("pointerdown", init));
    const up = new PointerEvent("pointerup", init);
    canvas.dispatchEvent(up);

    const names = emitted.map(([name]) => name);
    expect(names).toEqual([
      "pointerdown",
      "featureClick",
      "pointerup",
      "click",
    ]);
    const featureClick = emitted.find(([name]) => name === "featureClick");
    const click = emitted.find(([name]) => name === "click");
    expect(featureClick?.[2]).toBe(up);
    expect(click?.[1]).toBe(up);
    expect(up).toMatchObject({ map: MAP });
  });
});
