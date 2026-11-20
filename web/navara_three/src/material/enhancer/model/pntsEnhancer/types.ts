import type { Color } from "three";

import type { UniformValue } from "../../../types";
import type { Mutates } from "../../MaterialEnhancer";

/**
 * Props for the PNTS (point cloud) enhancer.
 */
export type PntsProps = {
  color?: number;
  pointSize?: number;
  height?: number;
  opacity?: number;
  transparent?: boolean;
  depthWrite?: boolean;
  srgbVertexColor?: boolean;
  geodeticNormal?: { x: number; y: number; z: number };
  /**
   * Base color and opacity that `color` and `opacity` tint: `CONSTANT_RGBA`
   * for PNTS, the material's own for glTF points. Read on mount.
   */
  baseColor?: Color;
  baseOpacity?: number;
};

/**
 * Immutable state for the PNTS enhancer.
 */
export type PntsState = Readonly<{
  height: number;
  geodeticNormal: { x: number; y: number; z: number };
  srgbVertexColor: boolean;
  baseColor: Color;
  baseOpacity: number;
}>;

/**
 * Mutable references (uniforms) for the PNTS enhancer.
 * Internal type - not exposed externally.
 */
export type PntsRefs = {
  uAddHeight: UniformValue<number>;
  uGeodeticNormal: UniformValue<number[]>;
};

export type PntsUniforms = Partial<PntsRefs>;

/**
 * Mutation functions for the PNTS enhancer.
 */
export type PntsMutates = Mutates<PntsState, PntsUniforms>;
