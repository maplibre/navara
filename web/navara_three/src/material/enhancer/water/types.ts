import type {
  WaterScale,
  WaterState,
  WaterUniforms,
  WaterWaves,
} from "../../../water/waterState";
import type { UniformValue } from "../../types";
import type { Mutates } from "../MaterialEnhancer";

/** Water props shared by the polygon and model water enhancers. */
export type WaterOnlyProps = {
  water?: boolean;
  waveExaggeration?: number;
  /** Extent of the water body (`WATER_SCALES`), which sets its wave size. */
  waterScale?: string;
  /** Sets the waves' size, slope and speed. */
  waveStrength?: number;
  /** Where the waves travel, in degrees clockwise from north. */
  waveDirection?: number;
  /** Speed in m/s of the current carrying the waves along `waveDirection`. */
  flowSpeed?: number;
  // The non-water `specular` highlight.
  shininess?: number;
  specularStrength?: number;
  specular?: boolean;
  ior?: number;

  /** The view's water state, which holds the waves. */
  getWaterState?: () => WaterState;
};

/**
 * Immutable state of a water enhancer.
 * This state is always replaced as a whole (never mutated).
 */
export type WaterSurfaceState = Readonly<{
  useWater: boolean;
  waveExaggeration: number;
  waterScale: WaterScale;
  waveStrength: number;
  waveDirection: number;
  flowSpeed: number;
  shininess: number;
  specularStrength: number;
  specular: boolean;
  ior: number;
}>;

/**
 * Mutable uniform refs of a water enhancer, shared with `shader.uniforms`.
 */
export type WaterRefs = {
  uWaveExaggeration: UniformValue<number>;
  uShininess: UniformValue<number>;
  uSpecularStrength: UniformValue<number>;
  uSpecular: UniformValue<boolean>;
  uIor: UniformValue<number>;
};

export type WaterSurfaceUniforms = Partial<WaterRefs> &
  Partial<WaterUniforms> & {
    nvrWaterWaves?: UniformValue<WaterWaves[]>;
  };

export type WaterMutates = Mutates<
  WaterSurfaceState,
  WaterSurfaceUniforms,
  {
    /** Sets the getter of the view's water state. */
    setWaterState: (getWaterState: () => WaterState) => void;
    /** The surface's waves; undefined unless it is water. */
    waves: () => WaterWaves | undefined;
    /** Lets go of the surface's waves. */
    dispose: () => void;
  }
>;
