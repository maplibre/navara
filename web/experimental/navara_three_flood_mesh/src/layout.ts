/**
 * Width in nodes of the textures a series is uploaded as; rows follow. The
 * least `MAX_TEXTURE_SIZE` WebGL 2 allows, so that the rows stay few.
 */
export const TEXTURE_WIDTH = 2048;

/** Texels of one texture layer holding `count` nodes: the rows filled up. */
export const layerSize = (count: number) =>
  TEXTURE_WIDTH * Math.ceil(count / TEXTURE_WIDTH);

/** The half-float NaN the textures mark a missing value with. */
export const HALF_NAN = 0x7e00;
