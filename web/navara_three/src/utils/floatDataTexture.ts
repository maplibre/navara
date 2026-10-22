import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from "three";

/**
 * An RGBA float texture of `data`, `width` × `height` texels, for shaders that
 * read it with `texelFetch`.
 */
export function createFloatDataTexture(
  data: Float32Array,
  width: number,
  height: number,
): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  // texelFetch is unfiltered by definition, but the sampler state still has
  // to be complete for the texture to be bindable.
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
