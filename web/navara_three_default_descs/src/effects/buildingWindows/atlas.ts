import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from "three";

// Window atlas: a CELLS × CELLS grid of window cells, each CELL texels square,
// repeated over the wall. Each cell holds one tall window; the RGBA channels
// are the lit pattern at cumulative LIT_LEVELS (a window lit at level k is lit
// at every higher level), with per-window brightness baked in. The fragment
// shader reads the same numbers through its NVR_* defines.
export const TEXTURE_SIZE = 1024;
export const CELL = 16;
export const CELLS = TEXTURE_SIZE / CELL;
export const WINDOW_X: readonly [number, number] = [5, 10];
export const WINDOW_Y: readonly [number, number] = [2, 14];
export const LIT_LEVELS: readonly [number, number, number, number] = [
  0.1, 0.3, 0.55, 0.85,
];
export const MAX_BRIGHTNESS = 1.2;

/**
 * The atlas texels. Lit decisions cluster: part per window, part per run of
 * windows along the floor, part per whole floor, so lit windows come in rows
 * and streaks. Seeded, so the atlas is the same on every run.
 */
export const createWindowAtlasData = (): Uint8Array => {
  // The generator is shared, but these draws run to completion before
  // anything else touches it.
  MathUtils.seededRandom(1);
  const rand = () => MathUtils.seededRandom();
  const floorRand = Array.from({ length: CELLS }, rand);
  const runLength = Array.from(
    { length: CELLS },
    () => 3 + Math.floor(rand() * 6),
  );
  const runRand = runLength.map((length) =>
    Array.from({ length: Math.ceil(CELLS / length) }, rand),
  );

  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let floor = 0; floor < CELLS; floor++) {
    for (let column = 0; column < CELLS; column++) {
      const run = runRand[floor][Math.floor(column / runLength[floor])];
      const r = 0.45 * rand() + 0.3 * run + 0.25 * floorRand[floor];
      const brightness = 0.5 + 0.7 * rand();
      const value = Math.round((brightness / MAX_BRIGHTNESS) * 255);
      const channels = LIT_LEVELS.map((level) => (r < level ? value : 0));

      for (
        let y = floor * CELL + WINDOW_Y[0];
        y < floor * CELL + WINDOW_Y[1];
        y++
      ) {
        for (
          let x = column * CELL + WINDOW_X[0];
          x < column * CELL + WINDOW_X[1];
          x++
        ) {
          data.set(channels, (y * TEXTURE_SIZE + x) * 4);
        }
      }
    }
  }
  return data;
};

/** The atlas as a repeating, mipmapped texture for the wall lookup. */
export const createWindowTexture = (): DataTexture => {
  const texture = new DataTexture(
    createWindowAtlasData(),
    TEXTURE_SIZE,
    TEXTURE_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  // Walls are seen at grazing angles; without anisotropy distant windows smear.
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
};
