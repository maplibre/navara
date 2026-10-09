import { Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { describe, expect, it, vi } from "vitest";

import { TexturizedSceneByTileCoordinates } from "../../scene";

import { TileMesh } from ".";

// The package barrel pulled in by tile.ts initializes a worker pool at module
// load (os.cpus()), which is unavailable in the test environment. Stub it.
vi.mock("@navaramap/worker", () => ({
  initializeWorkerPool: vi.fn(),
  terminateWorkerPool: vi.fn(),
}));

function createMockRenderer() {
  return {
    getContext: vi.fn(),
    getPixelRatio: vi.fn().mockReturnValue(1),
    getSize: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
  } as unknown as ConstructorParameters<
    typeof TexturizedSceneByTileCoordinates
  >[0];
}

function drapedMesh(): Mesh {
  return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
}

/** One Rust-resolved vector-tile state (identity WebMercator drape). */
function state(layerId: string, tileHandle: bigint) {
  return {
    layer_id: layerId,
    tile_handle: tileHandle,
    uv_offset: new Float32Array([0, 0]),
    uv_scale: new Float32Array([1, 1]),
    reproject_terrain_lat: new Float32Array([]),
    free: vi.fn(),
  };
}

function makeTile(atlasSize = 512) {
  const texturizedScenes = new TexturizedSceneByTileCoordinates(
    createMockRenderer(),
  );
  const renderVectorScenes = vi.fn();
  const markDirty = vi.fn();
  const compositor = {
    acquire: vi.fn(),
    release: vi.fn(),
    renderVectorScenes,
    markDirty,
    // Atlas / drape RT side length the TileMesh reads to size its render
    // targets and per-tile GPU byte cost. The composite atlas is 512² on both
    // desktop and mobile; this mock is parameterized so the sizing math can be
    // exercised at other side lengths too.
    size: atlasSize,
    // Keep the MRT composite pass out of this test: it runs only when dirty,
    // and _onBeforeRender returns right after the vector bake when it isn't.
    cache: { isDirty: vi.fn().mockReturnValue(false) },
  };
  const getVectorTileStates = vi.fn().mockReturnValue([]);
  const reportDrapeGpuBytes = vi.fn();

  // The vector resolve revision the WASM side exposes: it changes only when the
  // resolved slot set could have changed (a traverse ran / a scene became ready). The
  // tile re-fetches its slots only when this differs from the last frame, so tests that
  // change `getVectorTileStates` must bump it too (as a real traverse would).
  let vectorRevision = 0;
  const bumpRevision = () => {
    vectorRevision += 1;
  };

  const ctx = {
    texturizedSceneByTileCoordinates: texturizedScenes,
    tileTextureCompositor: compositor,
    textureOptions: { maxTextures: 4, additionalTexturesInUse: {} },
    tileMapByHandle: new Map(),
    tileHandler: {
      getVectorTileStates,
      vectorRevision: () => vectorRevision,
      getTile: vi.fn().mockReturnValue({ coords: { x: 0, y: 0, z: 0 } }),
      reportDrapeGpuBytes,
    },
  } as unknown as ConstructorParameters<typeof TileMesh>[0];

  const meshAdded = {
    tile_handle: 1n,
    // WebMercator tiling → the direct (no-op) raster drape resolver, keeping
    // the baked-raster machinery out of these vector-drape tests.
    globe: { isGeographicTiling: false, free: vi.fn() },
  } as unknown as ConstructorParameters<typeof TileMesh>[1];

  const tile = new TileMesh(ctx, meshAdded);

  return {
    tile,
    ctx,
    meshAdded,
    texturizedScenes,
    renderVectorScenes,
    getVectorTileStates,
    reportDrapeGpuBytes,
    bumpRevision,
  };
}

const RT_BYTES = 512 * 512 * 4;
const ATLAS_BYTES = 512 * 512 * 4 * 3;
// A smaller 256² atlas / drape RT (a quarter of the 512² GPU cost), used to
// exercise the sizing math at a non-default side length. NOTE: the real mobile
// atlas is 512², same as desktop — 256² here is just a smaller parametric size.
const RT_BYTES_SMALL = 256 * 256 * 4;
const ATLAS_BYTES_SMALL = 256 * 256 * 4 * 3;

function renderTargetCount(tile: TileMesh): number {
  return (
    tile as unknown as {
      vectorDrape: { liveRenderTargetCount(): number };
    }
  ).vectorDrape.liveRenderTargetCount();
}

/** Invoke the private onBeforeRender hook (args are ignored by the impl). */
function frame(tile: TileMesh) {
  (tile as unknown as { _onBeforeRender: () => void })._onBeforeRender();
}

describe("TileMesh vector bake dirty-gating", () => {
  it("bakes on the first frame, then skips frames with no change", () => {
    const { tile, texturizedScenes, renderVectorScenes, getVectorTileStates } =
      makeTile();

    // One clamp-to-ground layer resolved onto this terrain tile, backed by a
    // populated WM vector scene (handle 1n).
    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    texturizedScenes.add(1n, "a", drapedMesh(), 0);

    frame(tile);
    expect(renderVectorScenes).toHaveBeenCalledTimes(1);

    // Nothing changed → signature stable → no re-bake.
    frame(tile);
    frame(tile);
    expect(renderVectorScenes).toHaveBeenCalledTimes(1);
  });

  it("re-bakes when the backing scene's revision changes", () => {
    const { tile, texturizedScenes, renderVectorScenes, getVectorTileStates } =
      makeTile();

    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    texturizedScenes.add(1n, "a", drapedMesh(), 0);

    frame(tile);
    expect(renderVectorScenes).toHaveBeenCalledTimes(1);

    // The backing scene's content changed (e.g. material/visibility) bumps the scene's
    // revision. This is caught by the bake signature independently of the Rust resolve
    // revision (which is unchanged here, so the slots are not re-fetched).
    texturizedScenes.markDirty(1n, "a");
    frame(tile);
    expect(renderVectorScenes).toHaveBeenCalledTimes(2);

    // Stable again.
    frame(tile);
    expect(renderVectorScenes).toHaveBeenCalledTimes(2);
  });

  it("re-bakes when the resolved slot set changes", () => {
    const {
      tile,
      texturizedScenes,
      renderVectorScenes,
      getVectorTileStates,
      bumpRevision,
    } = makeTile();

    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    texturizedScenes.add(1n, "a", drapedMesh(), 0);

    frame(tile);
    expect(renderVectorScenes).toHaveBeenCalledTimes(1);

    // A second layer becomes resolved → slot set grows. The new resolution comes from a
    // traverse, which bumps the revision; that's what makes the tile re-fetch its slots.
    texturizedScenes.add(2n, "b", drapedMesh(), 1);
    getVectorTileStates.mockReturnValue([state("a", 1n), state("b", 2n)]);
    bumpRevision();
    frame(tile);
    expect(renderVectorScenes).toHaveBeenCalledTimes(2);
  });

  it("does not let a non-draped layer steal a slot from a draped one", () => {
    const {
      tile,
      texturizedScenes,
      renderVectorScenes,
      getVectorTileStates,
      bumpRevision,
    } = makeTile();

    // maxTextures 4 → numTexturizedVector 2. Rust returns THREE layers with a rendered
    // tile, but only "a" and "c" are actually draped (have a texturized scene). "b" is a
    // non-draped MVT layer rendered in the MRT scene; it must not occupy a bake slot and
    // push "c" past the cap.
    texturizedScenes.add(1n, "a", drapedMesh(), 0);
    texturizedScenes.add(3n, "c", drapedMesh(), 2);
    getVectorTileStates.mockReturnValue([
      state("a", 1n),
      state("b", 2n),
      state("c", 3n),
    ]);
    bumpRevision();

    frame(tile);

    const slots = (
      tile as unknown as {
        vectorDrape: { vectorSlots: { layerId: string }[] };
      }
    ).vectorDrape.vectorSlots;
    expect(slots.map((s) => s.layerId).sort()).toEqual(["a", "c"]);
    expect(renderVectorScenes).toHaveBeenCalledTimes(1);
  });

  it("skips the per-tile resolve fetch while the revision is unchanged", () => {
    const { tile, texturizedScenes, getVectorTileStates } = makeTile();

    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    texturizedScenes.add(1n, "a", drapedMesh(), 0);

    frame(tile);
    expect(getVectorTileStates).toHaveBeenCalledTimes(1);

    // No revision change → the WASM-boundary resolve is not called again, even though
    // its mock would now return a different set. This is the per-frame cost we removed.
    getVectorTileStates.mockReturnValue([state("a", 1n), state("b", 2n)]);
    frame(tile);
    frame(tile);
    expect(getVectorTileStates).toHaveBeenCalledTimes(1);
  });
});

describe("TileMesh drape render-target lazy allocation + accounting", () => {
  it("allocates no render targets and reports nothing while nothing drapes", () => {
    const { tile, reportDrapeGpuBytes } = makeTile();

    frame(tile);

    expect(renderTargetCount(tile)).toBe(0);
    // A tile that never draped reports nothing (its footprint never left 0).
    expect(reportDrapeGpuBytes).not.toHaveBeenCalled();
  });

  it("allocates one render target per draped layer and reports the footprint", () => {
    const {
      tile,
      texturizedScenes,
      getVectorTileStates,
      reportDrapeGpuBytes,
      bumpRevision,
    } = makeTile();

    texturizedScenes.add(1n, "a", drapedMesh(), 0);
    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    bumpRevision();
    frame(tile);

    expect(renderTargetCount(tile)).toBe(1);
    // Footprint = composite atlas + one render target per draped layer.
    expect(reportDrapeGpuBytes).toHaveBeenLastCalledWith(
      1n,
      ATLAS_BYTES + RT_BYTES,
    );

    // A second draped layer resolves → pool grows to 2, RT footprint doubles.
    texturizedScenes.add(2n, "b", drapedMesh(), 1);
    getVectorTileStates.mockReturnValue([state("a", 1n), state("b", 2n)]);
    bumpRevision();
    frame(tile);

    expect(renderTargetCount(tile)).toBe(2);
    expect(reportDrapeGpuBytes).toHaveBeenLastCalledWith(
      1n,
      ATLAS_BYTES + 2 * RT_BYTES,
    );
  });

  it("disposes render targets and re-reports when a draped layer vanishes", () => {
    const {
      tile,
      texturizedScenes,
      getVectorTileStates,
      reportDrapeGpuBytes,
      bumpRevision,
    } = makeTile();

    texturizedScenes.add(1n, "a", drapedMesh(), 0);
    texturizedScenes.add(2n, "b", drapedMesh(), 1);
    getVectorTileStates.mockReturnValue([state("a", 1n), state("b", 2n)]);
    bumpRevision();
    frame(tile);
    expect(renderTargetCount(tile)).toBe(2);

    // "b" is no longer draped here → pool shrinks to 1, RT footprint halves.
    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    bumpRevision();
    frame(tile);

    expect(renderTargetCount(tile)).toBe(1);
    expect(reportDrapeGpuBytes).toHaveBeenLastCalledWith(
      1n,
      ATLAS_BYTES + RT_BYTES,
    );
  });

  it("keeps charging the atlas when the last draped layer vanishes", () => {
    const {
      tile,
      texturizedScenes,
      getVectorTileStates,
      reportDrapeGpuBytes,
      bumpRevision,
    } = makeTile();

    texturizedScenes.add(1n, "a", drapedMesh(), 0);
    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    bumpRevision();
    frame(tile);
    expect(renderTargetCount(tile)).toBe(1);

    // All draped layers vanish → the render targets go, but the composite
    // atlas is held for the tile's lifetime (acquired in the constructor), so
    // the report must fall back to the atlas cost — not 0, which would wipe
    // the baseline Rust seeds at mesh-attach time.
    getVectorTileStates.mockReturnValue([]);
    bumpRevision();
    frame(tile);

    expect(renderTargetCount(tile)).toBe(0);
    expect(reportDrapeGpuBytes).toHaveBeenLastCalledWith(1n, ATLAS_BYTES);
  });

  it("tracks the compositor's atlas size for the atlas + drape footprint", () => {
    // Drives the compositor size to 256² to confirm the per-tile cost tracks
    // `compositor.size` (not a hardcoded 512²). This is a parametric size, not
    // the mobile default — mobile also uses a 512² atlas.
    const {
      tile,
      texturizedScenes,
      getVectorTileStates,
      reportDrapeGpuBytes,
      bumpRevision,
    } = makeTile(256);

    texturizedScenes.add(1n, "a", drapedMesh(), 0);
    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    bumpRevision();
    frame(tile);

    // One draped layer → atlas + one 256² render target, a quarter of 512².
    expect(reportDrapeGpuBytes).toHaveBeenLastCalledWith(
      1n,
      ATLAS_BYTES_SMALL + RT_BYTES_SMALL,
    );

    // Last draped layer vanishes → falls back to the atlas seed, not 0.
    getVectorTileStates.mockReturnValue([]);
    bumpRevision();
    frame(tile);
    expect(reportDrapeGpuBytes).toHaveBeenLastCalledWith(1n, ATLAS_BYTES_SMALL);
  });

  it("frees render targets on dispose without a zero drape report", () => {
    const {
      tile,
      texturizedScenes,
      getVectorTileStates,
      reportDrapeGpuBytes,
      bumpRevision,
    } = makeTile();

    texturizedScenes.add(1n, "a", drapedMesh(), 0);
    getVectorTileStates.mockReturnValue([state("a", 1n)]);
    bumpRevision();
    frame(tile);
    expect(reportDrapeGpuBytes).toHaveBeenLastCalledWith(
      1n,
      ATLAS_BYTES + RT_BYTES,
    );
    const callsBeforeDispose = reportDrapeGpuBytes.mock.calls.length;

    tile.dispose();

    // Render targets are freed, but dispose must NOT report a zero cost: the
    // handle is position-stable and reused by the replacement mesh entity, so a
    // zero report would resolve (Without<Deleted>) to the NEW live entity and
    // wipe the atlas cost the Rust side just seeded. The despawn of the old
    // entity subtracts the cost from the ledger instead.
    expect(renderTargetCount(tile)).toBe(0);
    expect(reportDrapeGpuBytes.mock.calls.length).toBe(callsBeforeDispose);
  });
});

describe("TileMesh handle registration", () => {
  it("keeps the replacing mesh registered when the outgoing one is disposed", () => {
    const { tile, ctx, meshAdded } = makeTile();
    // A replacement mesh for the same position-stable handle is constructed
    // before the outgoing one is disposed.
    const incoming = new TileMesh(ctx, meshAdded);

    tile.dispose(ctx.tileMapByHandle);
    expect(ctx.tileMapByHandle.get(1n)).toBe(incoming);

    incoming.dispose(ctx.tileMapByHandle);
    expect(ctx.tileMapByHandle.has(1n)).toBe(false);
  });
});
