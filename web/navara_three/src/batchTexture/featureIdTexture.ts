import {
  NearestFilter,
  NoColorSpace,
  Vector4,
  type IUniform,
  type Material,
  type Texture,
} from "three";
import invariant from "tiny-invariant";

import { writeBatchPickIds } from "./core";
import {
  enableDefine,
  getBatchTextureState,
  type BatchTextureState,
} from "./material";
import type { BatchVec3Key } from "./types";

/**
 * How a feature ID texture holds one feature index per texel.
 * ref: https://github.com/CesiumGS/glTF/tree/proposal-EXT_mesh_features/extensions/2.0/Vendor/EXT_mesh_features#feature-id-by-texture-coordinates
 */
export type FeatureIdTextureInput = {
  /** `n` of the `TEXCOORD_n` set the texture is sampled with. */
  texCoord: number;
  /** Channels holding the ID's bytes, least significant first. */
  channels: readonly number[];
  nullFeatureId?: number;
  featureCount: number;
};

/** A {@link FeatureIdTextureInput} the shader can sample. */
export type FeatureIdTextureSampling = Omit<
  FeatureIdTextureInput,
  "channels"
> & {
  channelWeights: Vector4;
};

export type FeatureIdTextureSource = FeatureIdTextureSampling & {
  texture: Texture;
};

/** Uniforms of `feature_id_texture_pars_fragment.glsl`. */
export type FeatureIdTextureUniforms = {
  nvr_featureIdTexture: IUniform<Texture>;
  nvr_featureIdChannelWeights: IUniform<Vector4>;
  nvr_featureIdNull: IUniform<number>;
  nvr_featureIdCount: IUniform<number>;
};

/**
 * vec3 attributes applied per fragment. The scalar ones act in the vertex
 * stage, before a texel is known; show/opacity is always available.
 */
const FRAGMENT_STAGE_VEC3S: ReadonlySet<BatchVec3Key> = new Set([
  "color",
  "emissive",
]);

/** three.js reads `uv` to `uv3`. */
const MAX_TEX_COORD = 3;

const uniformsByMaterial = new WeakMap<Material, FeatureIdTextureUniforms>();

/** Batch textures holding pick IDs for feature ID textures. */
const featureIdStates = new WeakSet<BatchTextureState>();

/**
 * Weight of each RGBA byte in the ID, or undefined for channels a texel
 * cannot hold.
 */
export function featureIdChannelWeights(
  channels: readonly number[],
): Vector4 | undefined {
  if (channels.length === 0 || channels.length > 4) return undefined;
  const weights = [0, 0, 0, 0];
  for (const [i, channel] of channels.entries()) {
    if (
      !Number.isInteger(channel) ||
      channel < 0 ||
      channel > 3 ||
      weights[channel] !== 0
    ) {
      return undefined;
    }
    weights[channel] = 256 ** i;
  }
  return new Vector4(...weights);
}

/** How the shader samples the input, or undefined when it cannot. */
export function featureIdTextureSampling(
  input: FeatureIdTextureInput,
): FeatureIdTextureSampling | undefined {
  const { channels, ...rest } = input;
  const channelWeights = featureIdChannelWeights(channels);
  if (
    !channelWeights ||
    !Number.isInteger(input.texCoord) ||
    input.texCoord < 0 ||
    input.texCoord > MAX_TEX_COORD
  ) {
    return undefined;
  }
  return { ...rest, channelWeights };
}

/**
 * Resolve the material's features per fragment from a feature ID texture
 * instead of the `_batchid` attribute. Only color, show/opacity and emissive
 * can then be styled per feature. The enhancer includes the
 * `feature_id_texture_*` chunks, merges {@link getFeatureIdTextureUniforms}
 * and writes `NVR_PICK_ID_OR(...)` as the pick ID.
 *
 * Call after `registerBatchedMaterial`, before any attribute write.
 * `pickIds[i]` is feature `i`'s pick ID. The material owns a clone of the
 * texture and disposes it with itself. A material attached
 * (`attachBatchedMaterial`) to one already set up shares its batch texture
 * and pick IDs, with its own feature ID texture.
 */
export function setFeatureIdTexture(
  material: Material,
  source: FeatureIdTextureSource,
  pickIds: ArrayLike<number>,
): void {
  const state = getBatchTextureState(material);
  invariant(state && state.batchLength > 0);
  invariant(!uniformsByMaterial.has(material));

  if (featureIdStates.has(state)) {
    enableDefine(material, "USE_BATCH_PICK_ID");
  } else {
    invariant(state.layout.rows === 0);
    state.supported.clear();
    for (const key of state.supportedVec3s) {
      if (!FRAGMENT_STAGE_VEC3S.has(key)) state.supportedVec3s.delete(key);
    }
    writeBatchPickIds(material, pickIds);
    featureIdStates.add(state);
  }

  // A clone, so sampling settings never leak into the material maps sharing
  // the image.
  const texture = source.texture.clone();
  texture.colorSpace = NoColorSpace;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  uniformsByMaterial.set(material, {
    nvr_featureIdTexture: { value: texture },
    nvr_featureIdChannelWeights: { value: source.channelWeights },
    nvr_featureIdNull: { value: source.nullFeatureId ?? -1 },
    nvr_featureIdCount: {
      value: Math.min(source.featureCount, state.batchLength),
    },
  });
  material.addEventListener("dispose", () => {
    texture.dispose();
    uniformsByMaterial.delete(material);
  });

  const defines = (material.userData.defines ??= {});
  defines.USE_FEATURE_ID_TEXTURE = true;
  defines.FEATURE_ID_TEXCOORD = `${source.texCoord}`;
  material.needsUpdate = true;
}

/** Uniforms to merge into the material's shader, if it has a feature ID texture. */
export function getFeatureIdTextureUniforms(
  material: Material,
): FeatureIdTextureUniforms | undefined {
  return uniformsByMaterial.get(material);
}

/** Whether the material resolves its features from a feature ID texture. */
export function hasFeatureIdTexture(material: Material): boolean {
  return uniformsByMaterial.has(material);
}
