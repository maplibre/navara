import type { Matrix4, Texture } from "three";

import type { TerrainExaggeration } from "./terrain/exaggeration";

type Ref<K extends string, T> = Record<K, T | undefined | null>;
export type RefThree<T> = Ref<"value", T>;

// TODO: Separate as individual library
export type CommonUniforms = {
  viewportAndPixelRatio: RefThree<[x: number, y: number, z: number]>;
  frustumRatio: RefThree<[x: number, y: number, z: number, w: number]>;
  frustumNearFar: RefThree<[x: number, y: number]>;
  tGlobeDepth: RefThree<Texture>;
  tGlobeNormal: RefThree<Texture>;
  tSkyEnvMap: RefThree<Texture>;
  inverseProjectionMatrix: RefThree<Matrix4>;
  fov: RefThree<number>;
  screenHeightPx: RefThree<number>;
  time: RefThree<number>;
  colorMapTexture: RefThree<Texture>;
  waterTexture: RefThree<Texture>;
  /** Shared by every terrain tile material (`uTerrainExaggeration`). */
  terrainExaggeration: { value: TerrainExaggeration };
  /**
   * Height (never positive) the ellipsoid is shrunk by for horizon culling
   * (`nvrHorizonMinHeight`), shared by every material that horizon-culls.
   */
  horizonMinHeight: { value: number };
};
