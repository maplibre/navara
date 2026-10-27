import { Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { describe, it, expect, vi } from "vitest";

import { TexturizedSceneByTileCoordinates, TileScene } from "./scene";

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

function createMesh(): Mesh<BoxGeometry, MeshBasicMaterial> {
  return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
}

function getGroup(ts: TexturizedSceneByTileCoordinates, handle: bigint) {
  const group = ts.map.get(handle);
  if (!group) throw new Error("group not found");
  return group;
}

describe("add", () => {
  it("add creates a new TileScene with layerId inside SceneGroup", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;
    const mesh = createMesh();

    ts.add(handle, "layer-a", mesh, 0);

    const group = getGroup(ts, handle);
    expect(group.tileScenes).toHaveLength(1);
    expect(group.tileScenes[0].layerId).toBe("layer-a");
    expect(group.tileScenes[0]).toBeInstanceOf(TileScene);
  });

  it("add with same layerId reuses existing Scene", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;

    ts.add(handle, "layer-a", createMesh(), 0);
    ts.add(handle, "layer-a", createMesh(), 0);

    const group = getGroup(ts, handle);
    expect(group.tileScenes).toHaveLength(1);
    expect(group.tileScenes[0].children).toHaveLength(2);
  });

  it("scenes are sorted by layerIndex", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;

    ts.add(handle, "c", createMesh(), 2);
    ts.add(handle, "b", createMesh(), 1);
    ts.add(handle, "a", createMesh(), 0);

    const group = getGroup(ts, handle);
    expect(group.tileScenes.map((c) => c.layerIndex)).toEqual([0, 1, 2]);
    expect(group.tileScenes.map((c) => c.layerId)).toEqual(["a", "b", "c"]);
  });

  it("revision increments on add", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;

    ts.add(handle, "layer-a", createMesh(), 0);
    const scene = ts.findSceneByLayerId(handle, "layer-a");
    expect(scene?.revision).toBe(1);

    ts.add(handle, "layer-a", createMesh(), 0);
    expect(scene?.revision).toBe(2);
  });

  it("removeMesh removes only that mesh, keeping siblings, and bumps revision", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;
    const a = createMesh();
    const b = createMesh();

    ts.add(handle, "layer-a", a, 0);
    ts.add(handle, "layer-a", b, 0);
    const scene = ts.findSceneByLayerId(handle, "layer-a");
    const revBefore = scene?.revision ?? 0;

    ts.removeMesh(handle, "layer-a", a);

    expect(scene?.children).toHaveLength(1);
    expect(scene?.children[0]).toBe(b);
    expect(scene?.removed).toBe(false);
    expect(scene?.revision).toBe(revBefore + 1);
  });

  it("removeMesh prunes the empty TileScene and SceneGroup once the last mesh leaves", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;
    const a = createMesh();

    ts.add(handle, "layer-a", a, 0);
    const scene = ts.findSceneByLayerId(handle, "layer-a");

    ts.removeMesh(handle, "layer-a", a);

    expect(scene?.removed).toBe(true);
    // The empty scene group is pruned from the map (no leak).
    expect(ts.map.has(handle)).toBe(false);
  });

  it("delete removes the entire SceneGroup for a tile handle", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;

    ts.add(handle, "layer-a", createMesh(), 0);
    ts.delete(handle);

    expect(ts.map.has(handle)).toBe(false);
  });
});

describe("findSceneByLayerId", () => {
  it("returns the TileScene for a known layerId", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;

    ts.add(handle, "layer-a", createMesh(), 0);

    const scene = ts.findSceneByLayerId(handle, "layer-a");
    expect(scene).toBeInstanceOf(TileScene);
    expect(scene?.layerId).toBe("layer-a");
  });

  it("returns undefined for unknown layerId", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());

    expect(ts.findSceneByLayerId(1n, "nonexistent")).toBeUndefined();
  });
});

describe("markDirty", () => {
  it("bumps the layer scene's revision without changing children", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;

    ts.add(handle, "layer-a", createMesh(), 0);
    const scene = ts.findSceneByLayerId(handle, "layer-a");
    const revBefore = scene?.revision ?? 0;
    const childrenBefore = scene?.children.length ?? 0;

    ts.markDirty(handle, "layer-a");

    expect(scene?.revision).toBe(revBefore + 1);
    expect(scene?.children.length).toBe(childrenBefore);
  });

  it("is a no-op for an unknown handle/layerId", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());

    expect(() => ts.markDirty(999n, "nonexistent")).not.toThrow();
  });
});

describe("hasTransparentMesh", () => {
  it("follows the visible meshes' `drapeTransparent`, rescanned on a revision bump", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;
    const opaque = createMesh();
    const transparent = Object.assign(createMesh(), {
      drapeTransparent: false,
    });

    ts.add(handle, "layer-a", opaque, 0);
    ts.add(handle, "layer-a", transparent, 0);
    const scene = ts.findSceneByLayerId(handle, "layer-a");
    expect(scene?.hasTransparentMesh).toBe(false);

    // A material change reaches the scene through `markDirty`; until then
    // the cached answer stands.
    transparent.drapeTransparent = true;
    expect(scene?.hasTransparentMesh).toBe(false);
    ts.markDirty(handle, "layer-a");
    expect(scene?.hasTransparentMesh).toBe(true);

    // The bake skips an invisible mesh, so it doesn't count.
    transparent.visible = false;
    ts.markDirty(handle, "layer-a");
    expect(scene?.hasTransparentMesh).toBe(false);
  });

  it("counts a sub-1 opacity or per-feature opacity without `drapeTransparent`", () => {
    const ts = new TexturizedSceneByTileCoordinates(createMockRenderer());
    const handle = 1n;
    const mesh = createMesh();
    ts.add(handle, "layer-a", mesh, 0);
    const scene = ts.findSceneByLayerId(handle, "layer-a");
    expect(scene?.hasTransparentMesh).toBe(false);

    mesh.material.opacity = 0.5;
    ts.markDirty(handle, "layer-a");
    expect(scene?.hasTransparentMesh).toBe(true);

    mesh.material.opacity = 1;
    mesh.material.userData.defines = { USE_BATCH_SHOW_OPACITY: true };
    ts.markDirty(handle, "layer-a");
    expect(scene?.hasTransparentMesh).toBe(true);
  });
});
