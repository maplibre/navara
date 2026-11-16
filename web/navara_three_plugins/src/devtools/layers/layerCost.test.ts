import type { ViewContext } from "@navaramap/three";
import {
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
  type Texture,
  WebGLRenderTarget,
} from "three";
import { describe, expect, it } from "vitest";

import { collectLayerCosts } from "./layerCost";

/** A terrain tile mesh whose material carries the tile uniforms. */
function tile(atlas: { color: Texture | null }, drapes: (Texture | null)[]) {
  const material = new MeshBasicMaterial();
  material.userData.uColorAtlas = {
    get value() {
      return atlas.color;
    },
  };
  material.userData.textures = { value: drapes };
  return new Mesh(new BufferGeometry(), material);
}

function contextWithGlobe(...meshes: Mesh[]): ViewContext {
  const globe = new Scene();
  for (const mesh of meshes) globe.add(mesh);
  return {
    scenes: {
      mrt: new Scene(),
      opaque: new Scene(),
      transparent: new Scene(),
      globe,
    },
  } as unknown as ViewContext;
}

const rgba = (size: number) => size * size * 4;

describe("collectLayerCosts", () => {
  it("counts a tile's atlas and each drape target in its texture array", () => {
    const atlas = new WebGLRenderTarget(16, 16).texture;
    const drape = new WebGLRenderTarget(8, 8).texture;
    const ctx = contextWithGlobe(tile({ color: atlas }, [drape, null]));

    const globe = collectLayerCosts(ctx).get("(terrain tiles)");

    expect(globe?.textureBytes).toBe(rgba(16) + rgba(8));
  });

  it("counts nothing for a tile that released its drape memory", () => {
    const outputs = { color: new WebGLRenderTarget(16, 16).texture } as {
      color: Texture | null;
    };
    const drapes: (Texture | null)[] = [new WebGLRenderTarget(8, 8).texture];
    const ctx = contextWithGlobe(tile(outputs, drapes));

    // What `releaseDrapeGpuMemoryUnlessDrawn` leaves behind.
    outputs.color = null;
    drapes[0] = null;

    expect(collectLayerCosts(ctx).get("(terrain tiles)")?.textureBytes).toBe(0);
  });

  it("counts a drape target shared by two tiles once", () => {
    const drape = new WebGLRenderTarget(8, 8).texture;
    const ctx = contextWithGlobe(
      tile({ color: null }, [drape]),
      tile({ color: null }, [drape]),
    );

    expect(collectLayerCosts(ctx).get("(terrain tiles)")?.textureBytes).toBe(
      rgba(8),
    );
  });
});
