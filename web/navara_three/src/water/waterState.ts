import { eastNorthUpToFixedFrame } from "@navaramap/three-api";
import { Matrix4, Texture, Vector3, Vector4 } from "three";

import {
  createFlatWaveTexture,
  createWaveTexture,
  WAVE_DOMINANT_CYCLES,
  WAVE_SLOPE_CENTER_CYCLES,
} from "./waveTexture";

/**
 * Extents of water bodies. Each bounds how far the wind blows over the water
 * (the fetch), which caps how large its waves grow.
 */
export const WATER_SCALES = ["ocean", "large", "medium", "small"] as const;
export type WaterScale = (typeof WATER_SCALES)[number];
/** Fetch of each scale, in meters. */
export const WATER_SCALE_FETCHES: Readonly<Record<WaterScale, number>> = {
  ocean: Infinity,
  large: 20000,
  medium: 2000,
  small: 200,
};

/** The waves a water surface asks for. */
export type WaveConditions = {
  /**
   * The wind speed behind the waves in m/s, which sets their size, slope and
   * speed.
   */
  strength: number;
  /** Where the waves travel, in degrees clockwise from north. */
  direction: number;
  scale: WaterScale;
  /** Speed in m/s of the current carrying the waves along `direction`. */
  flowSpeed: number;
};

export const DEFAULT_WAVE_CONDITIONS: Readonly<WaveConditions> = {
  strength: 5,
  direction: 0,
  scale: "ocean",
  flowSpeed: 0,
};

export const WATER_CASCADE_COUNT = 3;
/** Two taps per cascade, one per texture realization. */
export const WATER_TAP_COUNT = WATER_CASCADE_COUNT * 2;

const GRAVITY = 9.81;
/** Tile length ratios between consecutive cascades; never a power of two. */
const CASCADE_RATIOS = [1, 1 / 6.3, 1 / (6.3 * 6.1)];
/**
 * Longest tile of the finest cascade, in meters. Short ripples ride on the sea
 * at any wind, so a stronger wind spreads the cascades apart instead of
 * enlarging the finest one, whose texels would show up close.
 */
const MAX_FINEST_TILE_LENGTH = 3;
/**
 * Shortest tile of the finest cascade, in meters, for small water whose waves
 * stay short: its finest band then stays near the capillary limit (~1.7 cm)
 * instead of shrinking far below it.
 */
const MIN_FINEST_TILE_LENGTH = 0.5;
/**
 * Rotation of each tap's wave direction from downwind, in radians. The two
 * taps of a cascade drift apart, so the pattern keeps changing instead of
 * sliding as one sheet.
 */
const TAP_ANGLES = [
  [0.35, -0.3],
  [0.6, -0.45],
  [0.85, -0.7],
];
/**
 * Share of the wind's mean square slope the cascades resolve; the rest comes
 * from ripples finer than the last cascade and is always roughness.
 */
const RESOLVED_SLOPE_SHARE = 0.6;
/** Calm-water mean square slope (Cox–Munk intercept). */
const CALM_MEAN_SQUARE_SLOPE = 0.003;
/** Wind slow enough to keep the cascade lengths finite. */
const MIN_GEOMETRY_WIND_SPEED = 1;
/**
 * Length of one cycle of `nvrWaterFlowSurface`, in seconds. Must match
 * NVR_WATER_FLOW_PERIOD in water_pars_fragment.glsl.
 */
export const WATER_FLOW_PERIOD = 8;
/**
 * Scales the pattern speed below the group speed. Real crests change shape as
 * they travel; a rigid texture keeps its shape, so the eye tracks it and it
 * reads as faster than waves moving at the same speed.
 */
const PATTERN_SPEED_SCALE = 0.5;
/** Gust patches: their tile length in cascade-0 lengths and drift per wind. */
const PATCH_TILE_LENGTHS = 40;
const PATCH_SPEED_PER_WIND = 0.5;

export type WaterCascade = {
  /** World length of one texture repeat, in meters. */
  tileLength: number;
  /** Wavelength of the swell that dominates the cascade, in meters. */
  dominantWavelength: number;
  /** Root mean square slope of the cascade's waves. */
  rmsSlope: number;
  /**
   * Speed of the texture pattern, in m/s: the deep-water group speed (half the
   * phase speed) at the slope spectrum's center wavelength, scaled by
   * PATTERN_SPEED_SCALE. A rigid pattern stands for a sum of waves, and sums
   * travel at the group speed.
   */
  patternSpeed: number;
};

/**
 * Peak wavelength of a wind sea, in meters: fetch limited (JONSWAP,
 * fp·U/g = 3.5·(g·X/U²)^-0.33) up to the fully developed Pierson–Moskowitz
 * sea.
 * ref: Hasselmann et al., "Measurements of wind-wave growth and swell decay during the JONSWAP", 1973
 */
export function peakWavelength(windSpeed: number, fetch = Infinity): number {
  const developed =
    (2 * Math.PI * windSpeed * windSpeed) / (0.877 * 0.877 * GRAVITY);
  const peakFrequency =
    (3.5 * GRAVITY * ((GRAVITY * fetch) / (windSpeed * windSpeed)) ** -0.33) /
    windSpeed;
  return Math.min(
    GRAVITY / (2 * Math.PI * peakFrequency * peakFrequency),
    developed,
  );
}

/**
 * Cox–Munk mean square slope of a clean sea surface for a wind speed.
 * ref: https://oceanopticsbook.info/view/surfaces/cox-munk-sea-surface-slope-statistics
 */
export function meanSquareSlope(windSpeed: number): number {
  return CALM_MEAN_SQUARE_SLOPE + 0.00512 * windSpeed;
}

export function windToCascades(
  windSpeed: number,
  fetch = Infinity,
): {
  cascades: WaterCascade[];
  /** Mean square slope no cascade resolves. */
  fineMeanSquareSlope: number;
} {
  const speed = Math.max(windSpeed, 0);
  const windSlope = meanSquareSlope(speed) - CALM_MEAN_SQUARE_SLOPE;
  const rmsSlope = Math.sqrt(
    (windSlope * RESOLVED_SLOPE_SHARE) / WATER_CASCADE_COUNT,
  );
  // Cascade 0's swell is the peak wavelength.
  const baseLength =
    WAVE_DOMINANT_CYCLES *
    peakWavelength(Math.max(speed, MIN_GEOMETRY_WIND_SPEED), fetch);
  const finestLength = Math.min(
    Math.max(
      baseLength * CASCADE_RATIOS[2],
      Math.min(MIN_FINEST_TILE_LENGTH, baseLength),
    ),
    MAX_FINEST_TILE_LENGTH,
  );
  // The middle cascade keeps its log-scale place between the outer two.
  const middleShare = Math.log(CASCADE_RATIOS[1]) / Math.log(CASCADE_RATIOS[2]);
  const tileLengths = [
    baseLength,
    baseLength * (finestLength / baseLength) ** middleShare,
    finestLength,
  ];
  const cascades = tileLengths.map((tileLength) => {
    const dominantWavelength = tileLength / WAVE_DOMINANT_CYCLES;
    const centerWavelength = tileLength / WAVE_SLOPE_CENTER_CYCLES;
    return {
      tileLength,
      dominantWavelength,
      rmsSlope,
      patternSpeed:
        PATTERN_SPEED_SCALE *
        0.5 *
        Math.sqrt((GRAVITY * centerWavelength) / (2 * Math.PI)),
    };
  });
  return {
    cascades,
    fineMeanSquareSlope:
      CALM_MEAN_SQUARE_SLOPE + windSlope * (1 - RESOLVED_SLOPE_SHARE),
  };
}

/** A unit vector in east/north components for an azimuth from north. */
function azimuthToEastNorth(azimuth: number): [number, number] {
  return [Math.sin(azimuth), Math.cos(azimuth)];
}

/**
 * Wraps a phase to [0, 1). Kept in f64 on the CPU, so the GPU's f32 only ever
 * sees small numbers.
 */
function wrap(value: number): number {
  return value - Math.floor(value);
}

/** View-space east, north and up at the camera (`NvrWaterFrame`). */
export type WaterFrame = { east: Vector3; north: Vector3; up: Vector3 };

/** The waves of one water surface (`NvrWaterWaves`). */
export type WaterWaves = {
  /**
   * `WATER_TAP_COUNT` taps: xy = east/north wave direction ÷ tile length
   * (1/m), zw = phase.
   */
  taps: Vector4[];
  /**
   * `WATER_CASCADE_COUNT` cascades: x = rms slope, y = 1 / tile length (1/m),
   * z = 1 / dominant wavelength (1/m). The first cascade's w is the mean
   * square slope no cascade resolves.
   */
  cascades: Vector4[];
  /** The gust patch, laid out like a tap. */
  gust: Vector4;
};

export type WaterUniforms = {
  nvrWaveTexture: { value: Texture | null };
  nvrWaterFrame: { value: WaterFrame };
  /** Position in the flow cycle, in [0, 1). */
  nvrWaterFlowPhase: { value: number };
  /** The sky reflected where nothing else is; set by the view every frame. */
  nvrWaterSkyEnvMap: { value: Texture | null };
  nvrWaterUseSkyEnvMap: { value: boolean };
};

/**
 * One set of waves and its f64 phases, shared by the surfaces that ask for the
 * same conditions. The lanes are the taps and then the gust patch.
 */
class WaveSet {
  readonly waves: WaterWaves = {
    taps: Array.from({ length: WATER_TAP_COUNT }, () => new Vector4()),
    cascades: Array.from({ length: WATER_CASCADE_COUNT }, () => new Vector4()),
    gust: new Vector4(),
  };
  readonly cascades: readonly WaterCascade[];
  refCount = 0;

  private readonly _directions: [number, number][] = [];
  private readonly _tileLengths: number[] = [];
  private readonly _speeds: number[] = [];
  /** The current in east/north m/s. */
  private readonly _flow: [number, number];
  /** `[u, v]` pairs per lane. */
  private readonly _phases = new Float64Array((WATER_TAP_COUNT + 1) * 2);

  constructor(conditions: WaveConditions) {
    const direction = (conditions.direction * Math.PI) / 180;
    const [flowEast, flowNorth] = azimuthToEastNorth(direction);
    this._flow = [
      flowEast * conditions.flowSpeed,
      flowNorth * conditions.flowSpeed,
    ];
    const { cascades, fineMeanSquareSlope } = windToCascades(
      conditions.strength,
      WATER_SCALE_FETCHES[conditions.scale],
    );
    this.cascades = cascades;
    cascades.forEach((cascade, i) => {
      this.waves.cascades[i].set(
        cascade.rmsSlope,
        1 / cascade.tileLength,
        1 / cascade.dominantWavelength,
        i === 0 ? fineMeanSquareSlope : 0,
      );
      for (const angle of TAP_ANGLES[i]) {
        this._directions.push(azimuthToEastNorth(direction + angle));
        this._tileLengths.push(cascade.tileLength);
        this._speeds.push(cascade.patternSpeed);
      }
    });
    this._directions.push(azimuthToEastNorth(direction));
    this._tileLengths.push(cascades[0].tileLength * PATCH_TILE_LENGTHS);
    this._speeds.push(conditions.strength * PATCH_SPEED_PER_WIND);
    this._writeUniforms();
  }

  advance(east: number, north: number, seconds: number) {
    // The current moves the whole pattern, as the camera's opposite does.
    const carriedEast = east - this._flow[0] * seconds;
    const carriedNorth = north - this._flow[1] * seconds;
    for (let i = 0; i < this._directions.length; i++) {
      const [dx, dy] = this._directions[i];
      const length = this._tileLengths[i];
      const along =
        carriedEast * dx + carriedNorth * dy - this._speeds[i] * seconds;
      const across = -carriedEast * dy + carriedNorth * dx;
      this._phases[i * 2] = wrap(this._phases[i * 2] + along / length);
      this._phases[i * 2 + 1] = wrap(this._phases[i * 2 + 1] + across / length);
    }
    this._writeUniforms();
  }

  tapUv(tap: number, east: number, north: number): [number, number] {
    const [dx, dy] = this._directions[tap];
    const length = this._tileLengths[tap];
    return [
      (east * dx + north * dy) / length + this._phases[tap * 2],
      (-east * dy + north * dx) / length + this._phases[tap * 2 + 1],
    ];
  }

  private _writeUniforms() {
    for (let i = 0; i < this._directions.length; i++) {
      const [dx, dy] = this._directions[i];
      const length = this._tileLengths[i];
      const target = i < WATER_TAP_COUNT ? this.waves.taps[i] : this.waves.gust;
      target.set(
        dx / length,
        dy / length,
        this._phases[i * 2],
        this._phases[i * 2 + 1],
      );
    }
  }
}

/** A surface's hold on one set of waves. */
export class WaterWavesRef {
  private _key: string;
  private _set: WaveSet;
  private _disposed = false;

  constructor(
    private readonly _sets: Map<string, WaveSet>,
    conditions: WaveConditions,
  ) {
    this._key = conditionsKey(conditions);
    this._set = this._acquire(this._key, conditions);
  }

  /** The waves of the current conditions; changing those replaces them. */
  get waves(): WaterWaves {
    return this._set.waves;
  }

  get cascades(): readonly WaterCascade[] {
    return this._set.cascades;
  }

  /** Texture coordinate of a tap at a camera-relative east/north offset. */
  tapUv(tap: number, east: number, north: number): [number, number] {
    return this._set.tapUv(tap, east, north);
  }

  set(conditions: WaveConditions) {
    const key = conditionsKey(conditions);
    if (key === this._key) return;
    const next = this._acquire(key, conditions);
    this._release();
    this._key = key;
    this._set = next;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._release();
  }

  private _acquire(key: string, conditions: WaveConditions): WaveSet {
    let set = this._sets.get(key);
    if (!set) {
      set = new WaveSet(conditions);
      this._sets.set(key, set);
    }
    set.refCount++;
    return set;
  }

  private _release() {
    if (--this._set.refCount === 0) this._sets.delete(this._key);
  }
}

function conditionsKey({
  strength,
  direction,
  scale,
  flowSpeed,
}: WaveConditions): string {
  return `${strength}|${direction}|${scale}|${flowSpeed}`;
}

/**
 * Wave uniforms of every water material. Pattern coordinates are camera
 * relative: a fragment's offset from the camera in local east/north meters
 * plus a per-tap phase that integrates the camera's motion and the wave
 * travel, which pins the pattern to the ground.
 */
export class WaterState {
  private readonly _uniforms: WaterUniforms = {
    nvrWaveTexture: { value: null },
    nvrWaterFrame: {
      value: { east: new Vector3(), north: new Vector3(), up: new Vector3() },
    },
    nvrWaterFlowPhase: { value: 0 },
    nvrWaterSkyEnvMap: { value: null },
    nvrWaterUseSkyEnvMap: { value: false },
  };

  /** The sets some surface holds, by conditions. */
  private readonly _sets = new Map<string, WaveSet>();

  private readonly _basis = {
    east: new Vector3(),
    north: new Vector3(),
    up: new Vector3(),
  };
  private _hasPrevious = false;
  private readonly _previousPosition = new Vector3();
  private _previousTime = 0;
  private readonly _delta = new Vector3();

  private _disposed = false;

  /**
   * @param _loadWaveTexture Produces the wave texture's texels
   * (`encodeWaveTexture`), off the main thread in the view.
   */
  constructor(
    private readonly _maxAnisotropy: number,
    private readonly _loadWaveTexture: () => Promise<Uint8Array>,
  ) {}

  /** Holds the waves of `conditions` until the returned ref is disposed. */
  createWaves(conditions: WaveConditions): WaterWavesRef {
    return new WaterWavesRef(this._sets, conditions);
  }

  /**
   * Uniform refs every water material shares. The first read requests the wave
   * texture and holds flat water until it arrives.
   */
  get uniforms(): WaterUniforms {
    if (this._uniforms.nvrWaveTexture.value === null) {
      this._uniforms.nvrWaveTexture.value = createFlatWaveTexture();
      void this._loadWaveTexture().then((data) => {
        if (this._disposed) return;
        this._uniforms.nvrWaveTexture.value?.dispose();
        this._uniforms.nvrWaveTexture.value = createWaveTexture(
          data,
          this._maxAnisotropy,
        );
      });
    }
    return this._uniforms;
  }

  /** Sets the sky the water reflects; `null` falls back to the light probe. */
  setSkyEnvMap(texture: Texture | null) {
    this._uniforms.nvrWaterSkyEnvMap.value = texture;
    this._uniforms.nvrWaterUseSkyEnvMap.value = texture !== null;
  }

  /**
   * Advances the phases to this frame.
   * @param cameraPosition Camera position in ECEF meters.
   * @param viewMatrix The camera's world-to-view matrix.
   * @param timeMs Frame time in milliseconds.
   */
  update(cameraPosition: Vector3, viewMatrix: Matrix4, timeMs: number) {
    const basis = this._basis;
    eastNorthUpToFixedFrame(cameraPosition).extractBasis(
      basis.east,
      basis.north,
      basis.up,
    );

    if (this._hasPrevious) {
      this._delta.subVectors(cameraPosition, this._previousPosition);
      this.advance(
        this._delta.dot(basis.east),
        this._delta.dot(basis.north),
        (timeMs - this._previousTime) / 1000,
      );
    }
    this._hasPrevious = true;
    this._previousPosition.copy(cameraPosition);
    this._previousTime = timeMs;

    const frame = this._uniforms.nvrWaterFrame.value;
    frame.east.copy(basis.east).transformDirection(viewMatrix);
    frame.north.copy(basis.north).transformDirection(viewMatrix);
    frame.up.copy(basis.up).transformDirection(viewMatrix);
  }

  /**
   * Moves every tap of the held sets by the camera's displacement (east/north
   * meters) and by its wave travel over `seconds`, and advances the flow cycle.
   */
  advance(east: number, north: number, seconds: number) {
    for (const set of this._sets.values()) set.advance(east, north, seconds);
    this._uniforms.nvrWaterFlowPhase.value = wrap(
      this._uniforms.nvrWaterFlowPhase.value + seconds / WATER_FLOW_PERIOD,
    );
  }

  dispose() {
    this._disposed = true;
    this._uniforms.nvrWaveTexture.value?.dispose();
    this._uniforms.nvrWaveTexture.value = null;
  }
}
