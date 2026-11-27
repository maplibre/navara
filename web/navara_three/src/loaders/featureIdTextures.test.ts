import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  Texture,
  TextureLoader,
  type Material,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadFeatureIdTextures } from "./featureIdTextures";

const meshWithTexture = (
  index: number,
  {
    material = new MeshStandardMaterial(),
    uv = true,
    propertyTable = 0,
    channels = [0],
  }: {
    material?: Material;
    uv?: boolean;
    propertyTable?: number;
    channels?: number[];
  } = {},
) => {
  const geometry = new BufferGeometry();
  if (uv)
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(2), 2));
  const mesh = new Mesh(geometry, material);
  mesh.userData.gltfExtensions = {
    EXT_mesh_features: {
      featureIds: [
        { featureCount: 1, texture: { index, channels }, propertyTable },
      ],
    },
  };
  return mesh;
};

const gltfOf = (meshes: Mesh[], extensionsUsed = ["EXT_mesh_features"]) => {
  const scene = new Group();
  scene.add(...meshes);
  return {
    scene,
    parser: {
      json: {
        extensionsUsed,
        textures: [{ source: 0 }, { source: 1, sampler: 0 }],
        images: [{ uri: "ids0.png" }, { uri: "ids1.png" }],
        samplers: [{ wrapS: 33071, wrapT: 33648 }],
      },
      options: { path: "https://example.com/tile/", crossOrigin: "anonymous" },
    },
  } as unknown as GLTF;
};

const spyLoad = (load: (url: string) => Promise<Texture>) =>
  vi
    .spyOn(TextureLoader.prototype, "loadAsync")
    .mockImplementation(
      load as (url: string) => Promise<Texture<HTMLImageElement>>,
    );

describe("loadFeatureIdTextures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes through TextureLoader in glTF orientation, skipping failures", async () => {
    const texture = new Texture();
    const ok = meshWithTexture(1);
    const broken = meshWithTexture(0);
    const load = spyLoad((url) =>
      url.endsWith("ids1.png")
        ? Promise.resolve(texture)
        : Promise.reject(new Error("no texture")),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const sources = await loadFeatureIdTextures(
      gltfOf([ok, broken, new Mesh(new BufferGeometry())]),
      { propertyTable: 0 },
    );

    expect([...sources.keys()]).toEqual([ok]);
    expect(sources.get(ok)).toMatchObject({ texture, texCoord: 0 });
    expect(load).toHaveBeenCalledWith("https://example.com/tile/ids1.png");
    expect(texture).toMatchObject({
      flipY: false,
      wrapS: ClampToEdgeWrapping,
      wrapT: MirroredRepeatWrapping,
    });
  });

  it("decodes no texture of a mesh that cannot sample it", async () => {
    const load = spyLoad(() => Promise.resolve(new Texture()));
    const meshes = [
      meshWithTexture(0, { material: new MeshBasicMaterial() }),
      meshWithTexture(0, { uv: false }),
      meshWithTexture(0, { propertyTable: 1 }),
      meshWithTexture(0, { channels: [0, 0] }),
    ];

    const sources = await loadFeatureIdTextures(gltfOf(meshes), {
      propertyTable: 0,
    });

    expect(sources.size).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it("skips content without feature IDs or EXT_mesh_features", async () => {
    const load = spyLoad(() => Promise.resolve(new Texture()));
    const mesh = meshWithTexture(0);

    await loadFeatureIdTextures(gltfOf([mesh]), undefined);
    await loadFeatureIdTextures(gltfOf([mesh], []), { propertyTable: 0 });

    expect(load).not.toHaveBeenCalled();
  });
});
