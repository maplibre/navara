import { Vector3 } from "three";
import { describe, it, expect, vi } from "vitest";

import { OverlayPlugin, type OverlayState } from "./OverlayPlugin";

// Importing the real @navaramap/three touches WASM at module load, which fails
// in the test environment. A flat projection (degrees and meters straight to
// x/y/z, screen = 10 px per degree) is enough: these tests check when the
// plugin projects, not the projection math.
/* eslint-disable @typescript-eslint/no-extraneous-class */
vi.mock("@navaramap/three", () => ({
  default: class ThreeView {},
  Plugin: class Plugin {},
  geodeticToVector3: ({
    lng,
    lat,
    height,
  }: {
    lng: number;
    lat: number;
    height: number;
  }) => new Vector3(lng, lat, height),
  convertWorldToScreen: (_win: unknown, _camera: unknown, v: Vector3) => ({
    x: v.x * 10,
    y: v.y * 10,
  }),
}));
/* eslint-enable @typescript-eslint/no-extraneous-class */

/**
 * A view that renders on demand like `ThreeView` with `animation: false`.
 * `tick()` follows the order of the real main loop: `preUpdate` on every
 * tick, then a render (`preRender`, `postRender`) only when something called
 * `forceUpdate()`, then the request is cleared — so a request made during the
 * render is dropped, as in the real view.
 */
const makeIdleView = () => {
  const handlers = new Map<string, Set<() => void>>();
  const emit = (event: string) => {
    for (const fn of handlers.get(event) ?? []) fn();
  };
  let requested = false;
  return {
    camera: { positionGeographic: { lng: 0, lat: 0, height: 0 }, raw: {} },
    screenSize: { x: 800, y: 600 },
    pixelRatio: 1,
    on: (event: string, fn: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(fn);
    },
    off: (event: string, fn: () => void) => {
      handlers.get(event)?.delete(fn);
    },
    forceUpdate: vi.fn(() => {
      requested = true;
    }),
    /** Runs one main-loop tick and returns whether it rendered. */
    tick: () => {
      emit("preUpdate");
      const rendered = requested;
      if (rendered) {
        emit("preRender");
        emit("postRender");
      }
      requested = false;
      return rendered;
    },
  };
};

const initPlugin = async (plugin: OverlayPlugin) => {
  const view = makeIdleView();
  // The fake view only implements the members the plugin touches.
  await plugin.init(view as never, {} as never);
  return view;
};

const A = { id: "a", lng: 1, lat: 2, alt: 0 };
const B = { id: "b", lng: 3, lat: 4, alt: 0 };

describe("OverlayPlugin on an idle view", () => {
  it("projects new positions on the next frame after setPositions", async () => {
    const plugin = new OverlayPlugin();
    const view = await initPlugin(plugin);
    const states: OverlayState[] = [];
    plugin.onUpdate((state) => states.push(state));
    view.tick();
    states.length = 0;

    plugin.setPositions([A]);
    expect(view.tick()).toBe(true);

    expect(states).toHaveLength(1);
    expect(states[0].projected.get("a")).toEqual({
      x: 10,
      y: 20,
      distance: Math.hypot(1, 2),
    });
    plugin.dispose();
  });

  it("does not render when nothing changed", async () => {
    const plugin = new OverlayPlugin();
    const view = await initPlugin(plugin);
    plugin.setPositions([A]);
    view.tick();

    expect(view.tick()).toBe(false);
    expect(view.tick()).toBe(false);
    plugin.dispose();
  });

  it("renders once for several setPositions calls before a frame", async () => {
    const plugin = new OverlayPlugin();
    const view = await initPlugin(plugin);
    const listener = vi.fn();
    plugin.onUpdate(listener);
    plugin.setPositions([A]);
    plugin.setPositions([B]);

    expect(view.tick()).toBe(true);
    expect(view.tick()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect([...(listener.mock.lastCall?.[0].projected.keys() ?? [])]).toEqual([
      "b",
    ]);
    plugin.dispose();
  });

  it("gives a new onUpdate listener the current projection", async () => {
    const plugin = new OverlayPlugin();
    const view = await initPlugin(plugin);
    plugin.setPositions([A]);
    view.tick();

    const listener = vi.fn();
    plugin.onUpdate(listener);
    expect(view.tick()).toBe(true);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.lastCall?.[0].projected.get("a")).toMatchObject({
      x: 10,
      y: 20,
    });
    plugin.dispose();
  });

  it("projects positions set before init on the first frame", async () => {
    const plugin = new OverlayPlugin();
    plugin.setPositions([A]);
    const listener = vi.fn();
    plugin.onUpdate(listener);

    const view = await initPlugin(plugin);
    expect(view.tick()).toBe(true);

    expect(listener.mock.lastCall?.[0].projected.get("a")).toMatchObject({
      x: 10,
      y: 20,
    });
    plugin.dispose();
  });

  it("projects positions set from an onUpdate listener on the next frame", async () => {
    const plugin = new OverlayPlugin();
    const view = await initPlugin(plugin);
    plugin.setPositions([A]);
    const seen: string[][] = [];
    plugin.onUpdate(({ projected }) => {
      seen.push([...projected.keys()]);
      if (projected.has("a")) plugin.setPositions([B]);
    });

    view.tick();
    expect(view.tick()).toBe(true);
    expect(seen).toEqual([["a"], ["b"]]);
    expect(view.tick()).toBe(false);
    plugin.dispose();
  });

  it("projects positions set from a postRender handler on the next frame", async () => {
    const plugin = new OverlayPlugin();
    const view = await initPlugin(plugin);
    const listener = vi.fn();
    plugin.onUpdate(listener);
    view.tick();
    listener.mockClear();

    const setLater = () => {
      view.off("postRender", setLater);
      plugin.setPositions([B]);
    };
    view.on("postRender", setLater);
    view.forceUpdate();
    view.tick();

    expect(view.tick()).toBe(true);
    expect(listener.mock.lastCall?.[0].projected.get("b")).toMatchObject({
      x: 30,
      y: 40,
    });
    plugin.dispose();
  });

  it("requests no frame after dispose", async () => {
    const plugin = new OverlayPlugin();
    const view = await initPlugin(plugin);
    plugin.dispose();
    view.forceUpdate.mockClear();

    plugin.setPositions([A]);
    plugin.onUpdate(() => {});
    expect(view.tick()).toBe(false);
    expect(view.forceUpdate).not.toHaveBeenCalled();
  });
});
