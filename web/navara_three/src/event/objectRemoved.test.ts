import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from "three";
import { describe, expect, it, vi } from "vitest";

import type { EventContext } from "./context";
import { disposeAllObjects } from "./objectRemoved";

// The mesh barrel initializes a worker pool at module load (os.cpus()), which
// is unavailable in the test environment. Stub it.
vi.mock("@navaramap/worker", () => ({
  initializeWorkerPool: vi.fn(),
  terminateWorkerPool: vi.fn(),
}));

// Stands in for a tile mesh: its removal listener drops it from the tile map,
// as `TileMesh.dispose` does.
const tileLike = (ctx: EventContext, handle: bigint) => {
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const removed = vi.fn(() => ctx.tileMapByHandle.delete(handle));
  mesh.addEventListener("removedFromWorld" as never, removed);
  ctx.tileMapByHandle.set(handle, mesh as never);
  return { mesh, removed };
};

describe("disposeAllObjects", () => {
  it("tears down every indexed object and every tile once", () => {
    const ctx = {
      meshes: new Map(),
      tileMapByHandle: new Map(),
    } as unknown as EventContext;
    const indexedTile = tileLike(ctx, 1n);
    ctx.meshes.set("tile", indexedTile.mesh);
    // A tile whose geometry was never installed is not in the index.
    const unindexedTile = tileLike(ctx, 2n);
    const feature = new Object3D();
    const featureRemoved = vi.fn();
    feature.addEventListener("removedFromWorld" as never, featureRemoved);
    ctx.meshes.set("feature", feature);
    const geometryDispose = vi.spyOn(indexedTile.mesh.geometry, "dispose");
    const materialDispose = vi.spyOn(
      unindexedTile.mesh.material as MeshBasicMaterial,
      "dispose",
    );

    disposeAllObjects(ctx);

    expect(indexedTile.removed).toHaveBeenCalledOnce();
    expect(unindexedTile.removed).toHaveBeenCalledOnce();
    expect(featureRemoved).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(ctx.meshes.size).toBe(0);
    expect(ctx.tileMapByHandle.size).toBe(0);
  });
});
