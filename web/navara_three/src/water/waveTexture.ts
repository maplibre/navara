import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from "three";

/** Texels per side; a power of two for the radix-2 FFT. */
export const WAVE_TEXTURE_SIZE = 512;
/** Normalized slope that maps to either end of the 8-bit range. */
export const WAVE_SLOPE_RANGE = 4;
/**
 * Wavelength (in texture repeats) of the swell that dominates the texture's
 * look: the center of its lowest band.
 */
export const WAVE_DOMINANT_CYCLES = 5;

/**
 * Wave-number bands (cycles per texture repeat) summed into the texture, with
 * their share of the rms slope. The swell band stays rounded; the finer bands
 * fold into sharp crests, the wrinkled look of a wind-roughened surface.
 */
const WAVE_BANDS = [
  { min: 3, max: 8, slope: 1, crested: false },
  { min: 8, max: 20, slope: 0.8, crested: true },
  { min: 20, max: 50, slope: 0.6, crested: true },
  { min: 50, max: 128, slope: 0.45, crested: true },
];
/**
 * Wavelength (in texture repeats) at the center of the slope spectrum: the
 * bands' geometric centers averaged in log space, weighted by slope variance.
 * The crests a viewer follows are this fine, not the swell.
 */
export const WAVE_SLOPE_CENTER_CYCLES = Math.exp(
  WAVE_BANDS.reduce(
    (sum, band) =>
      sum + band.slope ** 2 * Math.log(Math.sqrt(band.min * band.max)),
    0,
  ) / WAVE_BANDS.reduce((sum, band) => sum + band.slope ** 2, 0),
);
/** Height spectrum exponent: amplitude ∝ k^-HEIGHT_EXPONENT. */
const HEIGHT_EXPONENT = 1.7;
/** Samples per shortest wavelength when a band is computed on a coarser grid. */
const BAND_SAMPLES_PER_WAVE = 4;

/**
 * Two independent slope fields `(sx, sy)` interleaved as `[sxA, syA, sxB, syB]`
 * per texel, each with a mean square slope of 1. Wave vectors gather around
 * +x, so crests run along y.
 */
export function generateWaveSlopes(seed = 0x5eed): Float32Array {
  const size = WAVE_TEXTURE_SIZE;
  const random = mulberry32(seed);
  const out = new Float32Array(size * size * 4);
  for (const band of WAVE_BANDS) {
    const grid = Math.min(
      size,
      nextPowerOfTwo(band.max * BAND_SAMPLES_PER_WAVE),
    );
    const field = bandField(grid, band.min, band.max, random);
    // `field` holds [h, sx, sy] for realizations A (real) and B (imaginary).
    for (let realization = 0; realization < 2; realization++) {
      const parts = field[realization];
      const [h, sx, sy] = parts;
      let sum = 0;
      for (let i = 0; i < grid * grid; i++) {
        sum += sx[i] * sx[i] + sy[i] * sy[i];
      }
      const scale = band.slope / Math.sqrt(sum / (grid * grid));
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const gx = (x * grid) / size;
          const gy = (y * grid) / size;
          // -|h| folds the zero crossings into crests: its slope is
          // -sign(h)·∇h.
          const fold = band.crested ? -Math.sign(sample(h, grid, gx, gy)) : 1;
          const o = (y * size + x) * 4 + realization * 2;
          out[o] += fold * scale * sample(sx, grid, gx, gy);
          out[o + 1] += fold * scale * sample(sy, grid, gx, gy);
        }
      }
    }
  }
  for (let realization = 0; realization < 2; realization++) {
    let sum = 0;
    for (let i = 0; i < size * size; i++) {
      const o = i * 4 + realization * 2;
      sum += out[o] * out[o] + out[o + 1] * out[o + 1];
    }
    const scale = 1 / Math.sqrt(sum / (size * size));
    for (let i = 0; i < size * size; i++) {
      const o = i * 4 + realization * 2;
      out[o] *= scale;
      out[o + 1] *= scale;
    }
  }
  return out;
}

/**
 * The slopes of `generateWaveSlopes` as RGBA8 texels: RG holds realization A
 * and BA realization B, each mapped from `[-WAVE_SLOPE_RANGE,
 * WAVE_SLOPE_RANGE]` to `[0, 1]`. About 100 ms of CPU, so the view runs it in
 * a worker.
 */
export function encodeWaveTexture(): Uint8Array {
  const slopes = generateWaveSlopes();
  const data = new Uint8Array(slopes.length);
  for (let i = 0; i < slopes.length; i++) {
    const unit = 0.5 + (0.5 * slopes[i]) / WAVE_SLOPE_RANGE;
    data[i] = Math.round(Math.min(Math.max(unit, 0), 1) * 255);
  }
  return data;
}

/** `encodeWaveTexture` texels as a repeating, mipmapped texture. */
export function createWaveTexture(
  data: Uint8Array,
  maxAnisotropy: number,
): DataTexture {
  const texture = new DataTexture(
    data,
    WAVE_TEXTURE_SIZE,
    WAVE_TEXTURE_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** A single mid-gray texel: slopes of about 0, so the water stays flat. */
export function createFlatWaveTexture(): DataTexture {
  const texture = new DataTexture(
    new Uint8Array([128, 128, 128, 128]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.needsUpdate = true;
  return texture;
}

/**
 * Height and slope of one band on a `grid`² lattice, for two realizations.
 * One complex transform yields both: the real and imaginary parts of a
 * non-Hermitian spectrum's transform are independent fields with the same
 * spectrum.
 */
function bandField(
  grid: number,
  minK: number,
  maxK: number,
  random: () => number,
): [Float64Array[], Float64Array[]] {
  const n = grid * grid;
  const hRe = new Float64Array(n);
  const hIm = new Float64Array(n);
  const xRe = new Float64Array(n);
  const xIm = new Float64Array(n);
  const yRe = new Float64Array(n);
  const yIm = new Float64Array(n);
  for (let iy = 0; iy < grid; iy++) {
    const ky = iy < grid / 2 ? iy : iy - grid;
    for (let ix = 0; ix < grid; ix++) {
      const kx = ix < grid / 2 ? ix : ix - grid;
      const k = Math.hypot(kx, ky);
      if (k < minK || k > maxK) continue;
      const cos = kx / k;
      // A cos² spread around +x; the floor keeps some cross waves.
      const amplitude = Math.sqrt(0.3 + cos * cos) / k ** HEIGHT_EXPONENT;
      const [g1, g2] = gaussianPair(random);
      const re = g1 * amplitude;
      const im = g2 * amplitude;
      const i = iy * grid + ix;
      hRe[i] = re;
      hIm[i] = im;
      // Slope = i·k·h.
      xRe[i] = -kx * im;
      xIm[i] = kx * re;
      yRe[i] = -ky * im;
      yIm[i] = ky * re;
    }
  }
  fft2d(hRe, hIm, grid);
  fft2d(xRe, xIm, grid);
  fft2d(yRe, yIm, grid);
  return [
    [hRe, xRe, yRe],
    [hIm, xIm, yIm],
  ];
}

/** Bilinear sample of a repeating `grid`² field at lattice coordinates. */
function sample(field: Float64Array, grid: number, x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = x0 % grid;
  const xb = (x0 + 1) % grid;
  const ya = (y0 % grid) * grid;
  const yb = ((y0 + 1) % grid) * grid;
  const top = field[ya + xa] * (1 - fx) + field[ya + xb] * fx;
  const bottom = field[yb + xa] * (1 - fx) + field[yb + xb] * fx;
  return top * (1 - fy) + bottom * fy;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

/** In-place 2D FFT (rows, then columns). Sign and scale are irrelevant here. */
function fft2d(re: Float64Array, im: Float64Array, size: number) {
  const rowRe = new Float64Array(size);
  const rowIm = new Float64Array(size);
  const twiddles = twiddleTable(size);
  for (let pass = 0; pass < 2; pass++) {
    for (let line = 0; line < size; line++) {
      for (let j = 0; j < size; j++) {
        const i = pass === 0 ? line * size + j : j * size + line;
        rowRe[j] = re[i];
        rowIm[j] = im[i];
      }
      fft1d(rowRe, rowIm, twiddles);
      for (let j = 0; j < size; j++) {
        const i = pass === 0 ? line * size + j : j * size + line;
        re[i] = rowRe[j];
        im[i] = rowIm[j];
      }
    }
  }
}

function twiddleTable(size: number): Float64Array {
  const table = new Float64Array(size);
  for (let k = 0; k < size / 2; k++) {
    table[k * 2] = Math.cos((2 * Math.PI * k) / size);
    table[k * 2 + 1] = Math.sin((2 * Math.PI * k) / size);
  }
  return table;
}

/** Iterative radix-2 Cooley–Tukey; `re.length` must be a power of two. */
function fft1d(re: Float64Array, im: Float64Array, twiddles: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const stride = n / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const wRe = twiddles[k * stride * 2];
        const wIm = twiddles[k * stride * 2 + 1];
        const a = start + k;
        const b = a + half;
        const tRe = re[b] * wRe - im[b] * wIm;
        const tIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
      }
    }
  }
}

function gaussianPair(random: () => number): [number, number] {
  const u = Math.max(random(), Number.EPSILON);
  const r = Math.sqrt(-2 * Math.log(u));
  const theta = 2 * Math.PI * random();
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

// ref: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
