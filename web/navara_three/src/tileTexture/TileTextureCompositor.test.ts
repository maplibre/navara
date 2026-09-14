import { Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { describe, expect, it, vi } from "vitest";

import { TexturizedSceneByTileCoordinates } from "../scene";
import { createTestTileHandler } from "../test-utils/engine";

import {
  DRAPE_BAKE_SAMPLES,
  TileTextureCompositor,
} from "./TileTextureCompositor";
import type { AtlasFactory, CompositeAtlas } from "./types";

// Minimal renderer mock — only the methods the compositor touches need to
// exist. We track `render` so tests can assert which scenes were drawn, and
// the current render target so they can assert where each draw landed.
function makeRenderer() {
  const renderer = {
    autoClear: true,
    currentTarget: null as unknown,
    getRenderTarget: vi.fn(() => renderer.currentTarget),
    setRenderTarget: vi.fn((t: unknown) => {
      renderer.currentTarget = t;
    }),
    getClearColor: vi.fn().mockImplementation((c) => c),
    getClearAlpha: vi.fn().mockReturnValue(1),
    setClearColor: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
  };
  return renderer;
}

function makeFakeAtlas(): CompositeAtlas {
  const tex = (n: string) =>
    ({ name: n, needsUpdate: false }) as unknown as CompositeAtlas["color"];
  return {
    target: { dispose: vi.fn() } as unknown as CompositeAtlas["target"],
    color: tex("color"),
    attr: tex("attr"),
    normal: tex("normal"),
    dispose: vi.fn(),
  };
}

const fakeFactory: AtlasFactory = () => makeFakeAtlas();

function setup() {
  const renderer = makeRenderer();
  const texturizedScenes = new TexturizedSceneByTileCoordinates(
    renderer as unknown as ConstructorParameters<
      typeof TexturizedSceneByTileCoordinates
    >[0],
  );
  const compositor = new TileTextureCompositor({
    renderer: renderer as unknown as ConstructorParameters<
      typeof TileTextureCompositor
    >[0]["renderer"],
    texturizedSceneByTileCoordinates: texturizedScenes,
    mercatorY: createTestTileHandler().mercatorY,
    atlasFactory: fakeFactory,
  });
  return { compositor, renderer, texturizedScenes };
}

function mesh() {
  return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
}

describe("TileTextureCompositor.acquire/release", () => {
  it("acquire returns CompositeOutputs and dedupes by handle", () => {
    const { compositor } = setup();
    const out = compositor.acquire(1n);
    expect(out.color).toBeDefined();
    expect(out.attr).toBeDefined();
    expect(out.normal).toBeDefined();
    // Re-acquire returns same outputs (cache dedupes).
    const again = compositor.acquire(1n);
    expect(again.color).toBe(out.color);
  });

  it("release pools the atlas once refCount drops to zero", () => {
    const { compositor } = setup();
    compositor.acquire(1n);
    compositor.acquire(1n);
    const entry = compositor.cache.getEntry(1n);
    if (!entry) throw new Error("expected entry");
    const atlas = entry.atlas;

    compositor.release(1n);
    expect(atlas.dispose).not.toHaveBeenCalled();
    expect(compositor.cache.pooledCount).toBe(0);
    compositor.release(1n);
    // The entry is gone but its atlas goes to the reuse pool, not dispose.
    expect(compositor.cache.getEntry(1n)).toBeUndefined();
    expect(atlas.dispose).not.toHaveBeenCalled();
    expect(compositor.cache.pooledCount).toBe(1);
  });
});

describe("TileTextureCompositor.renderVectorScenes", () => {
  const fakeRT = (): unknown => ({ texture: { needsUpdate: false } });

  /** Snapshot (target, camera window) at render time — the shared bake camera
   * is reframed per render, so mock.calls references alone are stale. */
  function recordRenders(renderer: ReturnType<typeof makeRenderer>) {
    const calls: {
      target: unknown;
      camera: { left: number; right: number; bottom: number; top: number };
    }[] = [];
    renderer.render.mockImplementation((_scene, camera) => {
      const { left, right, bottom, top } = camera as {
        left: number;
        right: number;
        bottom: number;
        top: number;
      };
      calls.push({
        target: renderer.currentTarget,
        camera: { left, right, bottom, top },
      });
    });
    return calls;
  }

  it("bakes each layer through the shared MSAA target and resolves into its render target", () => {
    const { compositor, renderer, texturizedScenes } = setup();
    texturizedScenes.add(1n, "layer-a", mesh(), 0);
    texturizedScenes.add(2n, "layer-b", mesh(), 1);
    const calls = recordRenders(renderer);

    const rt0 = fakeRT();
    const rt1 = fakeRT();
    compositor.renderVectorScenes(
      [
        {
          layerId: "layer-a",
          sources: [{ tileHandle: 1n, uvOffset: [0, 0], uvScale: [1, 1] }],
        },
        {
          layerId: "layer-b",
          sources: [{ tileHandle: 2n, uvOffset: [0, 0], uvScale: [1, 1] }],
        },
      ],
      [rt0 as never, rt1 as never],
    );

    // Per populated slot: one scene render into the shared MSAA target plus
    // one resolve copy into the slot target; only the MSAA target is cleared
    // (the full-frame resolve overwrites the slot target).
    expect(calls.length).toBe(4);
    expect(renderer.clear).toHaveBeenCalledTimes(2);
    const msaa = calls[0].target as { samples?: number };
    expect(msaa.samples).toBe(DRAPE_BAKE_SAMPLES);
    expect(calls.map((c) => c.target)).toEqual([msaa, rt0, msaa, rt1]);
    expect(
      (rt0 as { texture: { needsUpdate: boolean } }).texture.needsUpdate,
    ).toBe(true);
    expect(
      (rt1 as { texture: { needsUpdate: boolean } }).texture.needsUpdate,
    ).toBe(true);
  });

  it("accumulates a layer's N:M sources into the MSAA target, clearing it once", () => {
    const { compositor, renderer, texturizedScenes } = setup();
    // Two WM source tiles overlapping one Geographic terrain tile, both backing
    // the same layer (west half and east half).
    texturizedScenes.add(1n, "layer-a", mesh(), 0);
    texturizedScenes.add(2n, "layer-a", mesh(), 0);
    const calls = recordRenders(renderer);

    compositor.renderVectorScenes(
      [
        {
          layerId: "layer-a",
          sources: [
            { tileHandle: 1n, uvOffset: [0, 0], uvScale: [0.5, 1] },
            { tileHandle: 2n, uvOffset: [0.5, 0], uvScale: [0.5, 1] },
          ],
        },
      ],
      [fakeRT() as never],
    );

    // Both sources framed into their halves of the MSAA target, which was
    // cleared exactly once so the second source mosaics with the first
    // instead of wiping it, then one resolve copy. autoClear restored.
    expect(calls.length).toBe(3);
    expect(renderer.clear).toHaveBeenCalledTimes(1);
    expect(calls[0].camera).toEqual({ left: -1, right: 0, bottom: -1, top: 1 });
    expect(calls[1].camera).toEqual({ left: 0, right: 1, bottom: -1, top: 1 });
    expect(calls[0].target).toBe(calls[1].target);
    expect(renderer.autoClear).toBe(true);
  });

  it("frames the terrain sub-rect when the source resolves to a coarser ancestor", () => {
    const { compositor, renderer, texturizedScenes } = setup();
    texturizedScenes.add(1n, "layer-a", mesh(), 0);
    const calls = recordRenders(renderer);

    // NW quadrant of the ancestor: uvOffset=(0,0.5), uvScale=(0.5,0.5).
    compositor.renderVectorScenes(
      [
        {
          layerId: "layer-a",
          sources: [
            { tileHandle: 1n, uvOffset: [0, 0.5], uvScale: [0.5, 0.5] },
          ],
        },
      ],
      [fakeRT() as never],
    );

    // Scene render through the camera window [-1,0]×[0,1] (matches
    // ortho_camera_transform for the NW sub-tile), then the full-frame
    // resolve copy.
    expect(calls.length).toBe(2);
    expect(calls[0].camera).toEqual({ left: -1, right: 0, bottom: 0, top: 1 });
    expect(calls[1].camera).toEqual({ left: -1, right: 1, bottom: -1, top: 1 });
  });

  it("renders pick bakes (antialias: false) straight into the slot target with the framed camera", () => {
    const { compositor, renderer, texturizedScenes } = setup();
    texturizedScenes.add(1n, "layer-a", mesh(), 0);
    const calls = recordRenders(renderer);

    const rt = fakeRT();
    compositor.renderVectorScenes(
      [
        {
          layerId: "layer-a",
          sources: [
            { tileHandle: 1n, uvOffset: [0, 0.5], uvScale: [0.5, 0.5] },
          ],
        },
      ],
      [rt as never],
      { antialias: false },
    );

    // No MSAA intermediate and no resolve copy: the MSAA resolve would
    // average id-encoded colors along feature edges into ids that don't
    // exist. One direct render, camera-windowed like the pre-MSAA path.
    expect(calls.length).toBe(1);
    expect(calls[0].target).toBe(rt);
    expect(calls[0].camera).toEqual({ left: -1, right: 0, bottom: 0, top: 1 });
    expect(renderer.clear).toHaveBeenCalledTimes(1);
  });

  it("clears a baked target but does not render once its source scene was removed", () => {
    const { compositor, renderer, texturizedScenes } = setup();
    const m = mesh();
    texturizedScenes.add(1n, "layer-a", m, 0);

    const slots = [
      {
        layerId: "layer-a",
        sources: [
          {
            tileHandle: 1n,
            uvOffset: [0, 0] as [number, number],
            uvScale: [1, 1] as [number, number],
          },
        ],
      },
    ];
    const rt = fakeRT();
    compositor.renderVectorScenes(slots, [rt as never]);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.clear).toHaveBeenCalledTimes(1);

    // The scene went away: the stale bake is wiped (one more clear, straight
    // on the slot target — the MSAA intermediate is not touched) and nothing
    // renders.
    texturizedScenes.removeMesh(1n, "layer-a", m);
    compositor.renderVectorScenes(slots, [rt as never]);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.clear).toHaveBeenCalledTimes(2);
  });

  it("skips a never-touched render target that has no slot (no GPU allocation)", () => {
    const { compositor, renderer } = setup();

    const rt = fakeRT();
    compositor.renderVectorScenes([], [rt as never]);

    // Render-targeting the RT would create its GL framebuffer; an empty slot
    // whose target was never baked must not pay that cost.
    expect(renderer.setRenderTarget).not.toHaveBeenCalledWith(rt);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.clear).not.toHaveBeenCalled();
  });

  it("clears a previously-baked render target whose slot went away", () => {
    const { compositor, renderer, texturizedScenes } = setup();
    texturizedScenes.add(1n, "layer-a", mesh(), 0);

    const rt = fakeRT();
    compositor.renderVectorScenes(
      [
        {
          layerId: "layer-a",
          sources: [{ tileHandle: 1n, uvOffset: [0, 0], uvScale: [1, 1] }],
        },
      ],
      [rt as never],
    );
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.clear).toHaveBeenCalledTimes(1);

    // The slot disappeared: the stale bake must be wiped so the atlas doesn't
    // composite outdated content (one more clear; no MSAA involvement).
    compositor.renderVectorScenes([], [rt as never]);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.clear).toHaveBeenCalledTimes(2);
  });

  it("leaves a never-touched target alone while its source scene hasn't reached the cache", () => {
    const { compositor, renderer } = setup();

    // The layer stays transparent during the transition window (a coarser
    // ancestor backs the gap via the Rust scene-ready walk-up). A target that
    // was never baked holds nothing stale, so it isn't even render-targeted —
    // that would allocate its GL storage.
    const rt = fakeRT();
    compositor.renderVectorScenes(
      [
        {
          layerId: "pending",
          sources: [{ tileHandle: 99n, uvOffset: [0, 0], uvScale: [1, 1] }],
        },
      ],
      [rt as never],
    );

    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.clear).not.toHaveBeenCalled();
    expect(renderer.setRenderTarget).not.toHaveBeenCalledWith(rt);
  });
});

describe("TileTextureCompositor.renderRasterTiles", () => {
  const fakeRT = (): unknown => ({ texture: { needsUpdate: false } });
  // A bake source texture: `configureRasterBakeSource` mutates these sampler
  // fields in place, so a plain object stands in for a three.js Texture.
  const fakeTex = (name: string): unknown => ({
    name,
    colorSpace: "",
    minFilter: 0,
    magFilter: 0,
    generateMipmaps: false,
    needsUpdate: false,
  });
  /** The texture bound to the bake quad at each render call, in draw order. */
  const trackDrawnMaps = (renderer: ReturnType<typeof makeRenderer>) => {
    const maps: unknown[] = [];
    renderer.render.mockImplementation((scene) => {
      const quad = (scene as { children: { material: { map: unknown } }[] })
        .children[0];
      maps.push(quad.material.map);
    });
    return maps;
  };

  it("paints the no-data underlay across a heatmap target before its sources", () => {
    const { compositor, renderer } = setup();
    const maps = trackDrawnMaps(renderer);
    const src = fakeTex("dem");

    compositor.renderRasterTiles(
      [
        {
          isElevationHeatmap: true,
          noDataColor: [1, 2, 3],
          sources: [
            { texture: src as never, uvOffset: [0, 0], uvScale: [1, 1] },
          ],
        },
      ],
      [fakeRT() as never],
    );

    // First draw: the 1×1 no-data texture (decoder boundary color, opaque
    // alpha) spanning the whole target; the DEM source then overwrites the
    // covered region, leaving uncovered regions decoding as no-data.
    expect(maps).toHaveLength(2);
    const underlay = maps[0] as { image: { data: Uint8Array } };
    expect(Array.from(underlay.image.data)).toEqual([1, 2, 3, 255]);
    expect(maps[1]).toBe(src);
    // The underlay is framed over the full target (identity camera window).
    const cam = renderer.render.mock.calls[0][1] as {
      left: number;
      right: number;
      bottom: number;
      top: number;
    };
    expect([cam.left, cam.right, cam.bottom, cam.top]).toEqual([-1, 1, -1, 1]);
    // Cleared once: underlay and source accumulate into the same target.
    expect(renderer.clear).toHaveBeenCalledTimes(1);
  });

  it("draws sources coarse-first so finer tiles overwrite the ancestor", () => {
    const { compositor, renderer } = setup();
    const maps = trackDrawnMaps(renderer);
    // A finer-than-terrain tile (uvScale > 1) and a coarse ancestor fallback
    // (uvScale < 1) covering the whole rect, listed fine-first: the bake must
    // reorder by ascending uvScale or the ancestor buries the finer tile.
    const fine = fakeTex("fine");
    const coarse = fakeTex("coarse");

    compositor.renderRasterTiles(
      [
        {
          isElevationHeatmap: false,
          sources: [
            { texture: fine as never, uvOffset: [0, 0], uvScale: [2, 2] },
            {
              texture: coarse as never,
              uvOffset: [0, 0],
              uvScale: [0.5, 0.5],
            },
          ],
        },
      ],
      [fakeRT() as never],
    );

    expect(maps).toEqual([coarse, fine]);
    expect(renderer.clear).toHaveBeenCalledTimes(1);
  });

  it("skips a never-touched render target that has no slot (no GPU allocation)", () => {
    const { compositor, renderer } = setup();

    const rt = fakeRT();
    compositor.renderRasterTiles([], [rt as never]);

    // Render-targeting the RT would create its GL framebuffer; an empty slot
    // whose target was never baked must not pay that cost (same invariant as
    // the vector bake — both run through the shared bake loop).
    expect(renderer.setRenderTarget).not.toHaveBeenCalledWith(rt);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.clear).not.toHaveBeenCalled();
  });
});
