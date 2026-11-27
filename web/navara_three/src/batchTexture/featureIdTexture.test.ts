import {
  LinearFilter,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  Vector4,
} from "three";
import { describe, expect, test } from "vitest";

import {
  getBatchDataTexture,
  readBatchScalar,
  updateBatchAttribute,
} from "./core";
import {
  featureIdChannelWeights,
  featureIdTextureSampling,
  getFeatureIdTextureUniforms,
  setFeatureIdTexture,
  type FeatureIdTextureInput,
  type FeatureIdTextureSource,
} from "./featureIdTexture";
import { attachBatchedMaterial } from "./material";
import { setupBatchMaterial } from "./test-utils";

const input = (
  overrides: Partial<FeatureIdTextureInput> = {},
): FeatureIdTextureInput => ({
  texCoord: 0,
  channels: [0],
  featureCount: 3,
  ...overrides,
});

const source = (
  overrides: Partial<FeatureIdTextureInput> = {},
  texture = new Texture(),
): FeatureIdTextureSource => {
  const sampling = featureIdTextureSampling(input(overrides));
  if (!sampling) throw new Error("invalid feature ID texture input");
  return { ...sampling, texture };
};

// standard: EXT_mesh_features "Feature ID by Texture Coordinates" (channels
// are the ID's bytes, little-endian)
// ref: https://github.com/CesiumGS/glTF/tree/proposal-EXT_mesh_features/extensions/2.0/Vendor/EXT_mesh_features#feature-id-by-texture-coordinates
describe("featureIdChannelWeights", () => {
  test("weights each listed channel by its byte position", () => {
    expect(featureIdChannelWeights([0])).toEqual(new Vector4(1, 0, 0, 0));
    expect(featureIdChannelWeights([2, 0])).toEqual(new Vector4(256, 0, 1, 0));
    expect(featureIdChannelWeights([3, 2, 1, 0])).toEqual(
      new Vector4(16777216, 65536, 256, 1),
    );
  });

  // user: bad-data-never-crashes
  test.each([[[]], [[0, 0]], [[4]], [[-1]], [[0.5]], [[0, 1, 2, 3, 0]]])(
    "rejects channels %j",
    (channels) => {
      expect(featureIdChannelWeights(channels)).toBeUndefined();
    },
  );
});

describe("setFeatureIdTexture", () => {
  test("writes the pick IDs and switches the shader to the texture source", () => {
    const { material } = setupBatchMaterial(3, [], ["color"]);
    const keyBefore = material.customProgramCacheKey();

    setFeatureIdTexture(material, source({ texCoord: 1 }), [7, 8, 9]);

    expect(
      [0, 1, 2].map((i) => readBatchScalar(material, i, "pickId")),
    ).toEqual([7, 8, 9]);
    expect(material.userData.defines).toMatchObject({
      USE_FEATURE_ID_TEXTURE: true,
      FEATURE_ID_TEXCOORD: "1",
      USE_BATCH_PICK_ID: true,
      USE_BATCH_TEXTURE: true,
    });
    expect(material.customProgramCacheKey()).not.toBe(keyBefore);
    expect(material.customProgramCacheKey()).toContain("FEATURE_ID_TEXCOORD=1");
  });

  test("allows only attributes applied per fragment", () => {
    const { material } = setupBatchMaterial(
      3,
      ["height", "size"],
      ["color", "emissive", "outlineColor"],
    );
    setFeatureIdTexture(material, source(), [1, 2, 3]);

    expect(updateBatchAttribute(material, 0, "height", 5)).toBe(false);
    expect(updateBatchAttribute(material, 0, "size", 5)).toBe(false);
    expect(
      updateBatchAttribute(material, 0, "outline", [1, 1, 1, 1, 1, 1]),
    ).toBe(false);
    expect(updateBatchAttribute(material, 0, "color", [1, 0, 0])).toBe(true);
    expect(updateBatchAttribute(material, 0, "emissive", [1, 0, 0])).toBe(true);
    expect(updateBatchAttribute(material, 0, "show", false)).toBe(true);
  });

  test("samples a nearest-filtered, non-color-managed clone it disposes with the material", () => {
    const { material } = setupBatchMaterial(3, []);
    const original = new Texture();
    original.colorSpace = SRGBColorSpace;
    setFeatureIdTexture(material, source({}, original), [1, 2, 3]);

    const uniforms = getFeatureIdTextureUniforms(material);
    const texture = uniforms?.nvr_featureIdTexture.value;
    expect(texture).not.toBe(original);
    expect(texture).toMatchObject({
      colorSpace: NoColorSpace,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    expect(original.colorSpace).toBe(SRGBColorSpace);
    expect(original.minFilter).not.toBe(NearestFilter);
    expect(original.magFilter).toBe(LinearFilter);

    let disposed = false;
    texture?.addEventListener("dispose", () => (disposed = true));
    material.dispose();
    expect(disposed).toBe(true);
    expect(getFeatureIdTextureUniforms(material)).toBeUndefined();
  });

  test("an attached material shares the batch texture, not the feature ID texture", () => {
    const { material } = setupBatchMaterial(3, [], ["color", "outlineColor"]);
    const attached = new MeshBasicMaterial();
    attachBatchedMaterial(material, attached);
    setFeatureIdTexture(material, source(), [7, 8, 9]);
    setFeatureIdTexture(attached, source({ texCoord: 1 }), [7, 8, 9]);

    expect(getBatchDataTexture(attached)).toBe(getBatchDataTexture(material));
    expect(readBatchScalar(attached, 2, "pickId")).toBe(9);
    expect(attached.userData.defines).toMatchObject({
      USE_FEATURE_ID_TEXTURE: true,
      FEATURE_ID_TEXCOORD: "1",
      USE_BATCH_PICK_ID: true,
    });
    expect(material.userData.defines.FEATURE_ID_TEXCOORD).toBe("0");
    expect(
      getFeatureIdTextureUniforms(attached)?.nvr_featureIdTexture,
    ).not.toBe(getFeatureIdTextureUniforms(material)?.nvr_featureIdTexture);
    expect(
      updateBatchAttribute(attached, 0, "outline", [1, 1, 1, 1, 1, 1]),
    ).toBe(false);
  });

  test("IDs at or above the batch length are no feature", () => {
    const { material } = setupBatchMaterial(3, []);
    setFeatureIdTexture(
      material,
      source({ featureCount: 10, nullFeatureId: 0 }),
      [1, 2, 3],
    );
    const uniforms = getFeatureIdTextureUniforms(material);
    expect(uniforms?.nvr_featureIdCount.value).toBe(3);
    expect(uniforms?.nvr_featureIdNull.value).toBe(0);
  });
});

describe("featureIdTextureSampling", () => {
  // user: bad-data-never-crashes
  test.each([
    { texCoord: 4 },
    { texCoord: -1 },
    { texCoord: 0.5 },
    { channels: [0, 0] },
  ])("rejects %j", (overrides) => {
    expect(featureIdTextureSampling(input(overrides))).toBeUndefined();
  });
});
