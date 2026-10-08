import type { UniformValue } from "../../../types";
import type { Mutates } from "../../MaterialEnhancer";

/**
 * Props for the PNTS (point cloud) enhancer.
 */
export type PntsProps = {
  color?: number;
  pointSize?: number;
  height?: number;
  srgbVertexColor?: boolean;
  geodeticNormal?: { x: number; y: number; z: number };
};

/**
 * Immutable state for the PNTS enhancer.
 */
export type PntsState = Readonly<{
  height: number;
  geodeticNormal: { x: number; y: number; z: number };
  srgbVertexColor: boolean;
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
