import {
  ClampToEdgeWrapping,
  LoaderUtils,
  Mesh,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  RepeatWrapping,
  TextureLoader,
  type Texture,
  type Wrapping,
} from "three";
import type { GLTF, GLTFParser } from "three/addons/loaders/GLTFLoader.js";

import {
  featureIdTextureSampling,
  type FeatureIdTextureSampling,
  type FeatureIdTextureSource,
} from "../batchTexture";
import {
  featureIdTextureSet,
  type GltfFeatureIds,
} from "../mesh/modelBatchIds";

/**
 * The feature ID texture source of each mesh in `gltf` whose features
 * resolve per texel. `GLTFLoader` loads only the textures materials use, so
 * these are loaded here; a mesh is checked before its texture is decoded. A
 * texture that fails to load leaves its mesh without features.
 */
export async function loadFeatureIdTextures(
  gltf: GLTF,
  gltfFeatureIds: GltfFeatureIds | undefined,
): Promise<Map<Mesh, FeatureIdTextureSource>> {
  const sources = new Map<Mesh, FeatureIdTextureSource>();
  const extensionsUsed = gltf.parser.json.extensionsUsed as
    string[] | undefined;
  if (!gltfFeatureIds || !extensionsUsed?.includes("EXT_mesh_features")) {
    return sources;
  }
  const pending: Promise<void>[] = [];
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const sampling = featureIdSampling(object, gltfFeatureIds);
    if (!sampling) return;
    const { index, ...rest } = sampling;
    pending.push(
      loadIdTexture(gltf.parser, index)
        .then((texture) => {
          if (texture) sources.set(object, { ...rest, texture });
        })
        .catch((e: unknown) => {
          console.warn(`Failed to load feature ID texture ${index}`, e);
        }),
    );
  });
  await Promise.all(pending);
  return sources;
}

const WRAPPINGS: Record<number, Wrapping> = {
  33071: ClampToEdgeWrapping,
  33648: MirroredRepeatWrapping,
  10497: RepeatWrapping,
};

type ParserJson = {
  textures?: { source?: number; sampler?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  samplers?: { wrapS?: number; wrapT?: number }[];
};

/**
 * Decodes through `<img>`, not the parser's `ImageBitmapLoader`: iOS Safari
 * zeroes the RGB of alpha-0 texels in an `ImageBitmap` even with
 * `premultiplyAlpha: "none"`, and ID texels are often `(id, 0, 0, 0)`.
 * The parser's image cache is keyed by image only, so it is bypassed too.
 */
async function loadIdTexture(
  parser: GLTFParser,
  index: number,
): Promise<Texture | null> {
  const json = parser.json as ParserJson;
  const def = json.textures?.[index];
  const image =
    def?.source === undefined ? undefined : json.images?.[def.source];
  if (!image) return null;
  const { manager, path, crossOrigin } = parser.options;
  let url: string;
  if (image.bufferView !== undefined) {
    const view = (await parser.getDependency(
      "bufferView",
      image.bufferView,
    )) as ArrayBuffer;
    url = URL.createObjectURL(new Blob([view], { type: image.mimeType }));
  } else if (image.uri !== undefined) {
    url = LoaderUtils.resolveURL(image.uri, path);
  } else {
    return null;
  }
  const loader = new TextureLoader(manager).setCrossOrigin(crossOrigin);
  try {
    const texture = await loader.loadAsync(url);
    texture.flipY = false;
    const sampler =
      def?.sampler === undefined ? undefined : json.samplers?.[def.sampler];
    texture.wrapS = WRAPPINGS[sampler?.wrapS ?? 10497] ?? RepeatWrapping;
    texture.wrapT = WRAPPINGS[sampler?.wrapT ?? 10497] ?? RepeatWrapping;
    return texture;
  } finally {
    if (image.bufferView !== undefined) URL.revokeObjectURL(url);
  }
}

function featureIdSampling(
  mesh: Mesh,
  gltfFeatureIds: GltfFeatureIds,
): (FeatureIdTextureSampling & { index: number }) | undefined {
  const set = featureIdTextureSet(mesh);
  // The enhancer supports standard/physical only.
  if (
    !set ||
    !(mesh.material instanceof MeshStandardMaterial) ||
    set.propertyTable !== gltfFeatureIds.propertyTable
  ) {
    return undefined;
  }
  const texCoord = set.texture.texCoord ?? 0;
  // Without it, every fragment would read the texel at (0, 0).
  if (!mesh.geometry.hasAttribute(texCoord === 0 ? "uv" : `uv${texCoord}`)) {
    return undefined;
  }
  const sampling = featureIdTextureSampling({
    texCoord,
    channels: set.texture.channels ?? [0],
    nullFeatureId: set.nullFeatureId,
    featureCount: set.featureCount ?? 0,
  });
  return sampling && { ...sampling, index: set.texture.index };
}
