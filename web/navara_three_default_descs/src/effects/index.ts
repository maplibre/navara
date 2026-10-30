// Effect implementations (moved from @navaramap/three)
export * from "./aa";
export * from "./aerialPerspective";
export * from "./clouds/index";
export * from "./colorGradingLUT";
export * from "./depthOfField";
export * from "./fogLight";
export * from "./lensFlare";
export * from "./rainDropEffect";
export * from "./ssao";
export * from "./ssr";
export * from "./toneMapping";

// Effect descriptor declarations
export {
  AerialPerspectiveEffectDesc,
  type AerialPerspectiveConfig,
  type AerialPerspectiveUpdate,
} from "./AerialPerspectiveEffectDesc";
export {
  BuildingWindowsEffectDesc,
  type BuildingWindowsOptions,
  type BuildingWindowsConfig,
  type BuildingWindowsUpdate,
} from "./BuildingWindowsEffectDesc";
export {
  CloudsEffectDesc,
  type CloudsConfig,
  type CloudsUpdate,
} from "./CloudsEffectDesc";
export {
  ColorGradingLUTEffectDesc,
  DEFAULT_COLOR_GRADING_LUT_OPTIONS,
  type ColorGradingLUTConfig,
  type ColorGradingLUTUpdate,
} from "./ColorGradingLUTEffectDesc";
export {
  DepthOfFieldEffectDesc,
  type DepthOfFieldConfig,
  type DepthOfFieldUpdate,
} from "./DepthOfFieldEffectDesc";
export {
  FogLightEffectDesc,
  type FogLightConfig,
  type FogLightUpdate,
} from "./FogLightEffectDesc";
export {
  FXAAEffectDesc,
  type FXAAConfig,
  type FXAAUpdate,
} from "./FXAAEffectDesc";
export {
  LensFlareEffectDesc,
  type LensFlareConfig,
  type LensFlareUpdate,
} from "./LensFlareEffectDesc";
export {
  RainDropEffectDesc,
  type RainDropConfig,
  type RainDropUpdate,
} from "./RainDropEffectDesc";
export {
  SMAAEffectDesc,
  type SMAAConfig,
  type SMAAUpdate,
} from "./SMAAEffectDesc";
export {
  SSAOEffectDesc,
  type SSAOConfig,
  type SSAOUpdate,
} from "./SSAOEffectDesc";
export {
  SelectiveBloomEffectDesc,
  type SelectiveBloomConfig,
  type SelectiveBloomEffectConfig,
  type SelectiveBloomEffectUpdate,
} from "./SelectiveBloomEffectDesc";
export {
  SelectiveOutlineEffectDesc,
  type SelectiveOutlineConfig,
  type SelectiveOutlineEffectConfig,
  type SelectiveOutlineEffectUpdate,
} from "./SelectiveOutlineEffectDesc";
export { SSREffectDesc, type SSRConfig, type SSRUpdate } from "./SSREffectDesc";
export {
  ToneMappingEffectDesc,
  type ToneMappingConfig,
  type ToneMappingUpdate,
} from "./ToneMappingEffectDesc";

export { ToneMappingMode } from "postprocessing";
