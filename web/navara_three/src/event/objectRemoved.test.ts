import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from "three";
import { describe, expect, it, vi } from "vitest";

import { ViewContext } from "../core/ViewContext";
import type { MeshCache } from "../type";

import type { EventContext } from "./context";
import { disposeAllObjects, processObjectRemoved } from "./objectRemoved";

// The mesh barrel initializes a worker pool at module load (os.cpus()), which
// is unavailable in the test environment. Stub it.
vi.mock("@navaramap/worker", () => ({
  initializeWorkerPool: vi.fn(),
  terminateWorkerPool: vi.fn(),
}));

// A real ViewContext over the view's mesh cache, without the WASM line dash
// atlas.
vi.mock("../lineDash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lineDash")>()),
  LineDashAtlas: vi.fn(),
}));

const contextWith = (): EventContext => {
  const meshes: MeshCache = new Map();
  const stub = {} as never;
  const viewContext = new ViewContext(
    stub,
    stub,
    stub,
    stub,
    stub,
    meshes,
    stub,
    stub,
  );
  return {
    meshes,
    tileMapByHandle: new Map(),
    viewContext,
  } as unknown as EventContext;
};

const box = () => new Mesh(new BoxGeometry(), new MeshBasicMaterial());

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
    const ctx = contextWith();
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
    expect(ctx.tileMapByHandle.size).toBe(0);
  });

  // A product indexed before its job settled is torn down again by the
  // dispatcher once the job settles after its dispose.
  it("leaves a product it tore down to a later teardown untouched", () => {
    const ctx = contextWith();
    const feature = box();
    const removed = vi.fn();
    feature.addEventListener("removedFromWorld" as never, removed);
    ctx.meshes.set("feature", feature);
    const geometryDispose = vi.spyOn(feature.geometry, "dispose");

    disposeAllObjects(ctx);
    processObjectRemoved(ctx, feature);

    expect(removed).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
  });

  it("leaves a descriptor's pickable to its descriptor", () => {
    const ctx = contextWith();
    // Polygon and polyline descriptors register the rendered mesh itself; a
    // custom one may share its geometry with another view.
    const pickable = box();
    const { geometry } = pickable;
    const scene = new Object3D().add(pickable);
    ctx.viewContext.registerPickableMesh("desc", pickable as never);
    const feature = box();
    ctx.meshes.set("feature", feature);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(pickable.material, "dispose");

    disposeAllObjects(ctx);

    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(geometry.getAttribute("position")).toBeDefined();
    expect(geometry.index).not.toBeNull();
    expect(pickable.parent).toBe(scene);
    expect(feature.geometry.getAttribute("position")).toBeUndefined();
  });

  // A descriptor's `id` is free-form, so it can equal the id of an engine
  // entity ("42_1"), whose product then takes over the key.
  it("tears down an engine product that took over a descriptor's key", () => {
    const ctx = contextWith();
    const pickable = box();
    ctx.viewContext.registerPickableMesh("42_1", pickable as never);
    const feature = box();
    new Object3D().add(feature);
    ctx.meshes.set("42_1", feature);
    const featureDispose = vi.spyOn(feature.geometry, "dispose");
    const pickableDispose = vi.spyOn(pickable.geometry, "dispose");

    disposeAllObjects(ctx);

    expect(featureDispose).toHaveBeenCalledOnce();
    expect(feature.parent).toBeNull();
    expect(pickableDispose).not.toHaveBeenCalled();
  });

  it("keeps that product indexed when the descriptor unregisters", () => {
    const ctx = contextWith();
    ctx.viewContext.registerPickableMesh("42_1", box() as never);
    const feature = box();
    ctx.meshes.set("42_1", feature);

    ctx.viewContext.unregisterPickableMesh("42_1");

    expect(ctx.meshes.get("42_1")).toBe(feature);
    ctx.viewContext.registerPickableMesh("desc", box() as never);
    ctx.viewContext.unregisterPickableMesh("desc");
    expect(ctx.meshes.has("desc")).toBe(false);
  });
});
