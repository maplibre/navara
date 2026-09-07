declare module "n8ao" {
  import { type Pass } from "postprocessing";
  import { type Camera, type Scene, type ShaderMaterial } from "three";

  export type QualityMode = "Performance" | "Low" | "Medium" | "High" | "Ultra";

  export class N8AOPostPass extends Pass {
    // Ref: https://github.com/N8python/n8ao/blob/9d6c776cf670e8f78bd91249c77775a2cd7ac984/src/N8AOPostPass.js#L53-L70
    readonly configuration: Partial<{
      aoSamples: number;
      aoRadius: number;
      denoiseSamples: number;
      denoiseRadius: number;
      distanceFalloff: number;
      intensity: number;
      denoiseIterations: number;
      renderMode: 0 | 1 | 2 | 3 | 4;
      color: THREE.Color;
      gammaCorrection: boolean;
      depthBufferType: 1 | 2 | 3;
      screenSpaceRadius: boolean;
      halfRes: boolean;
      depthAwareUpsampling: boolean;
      colorMultiply: boolean;
    }>;
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    // Ref: https://github.com/N8python/n8ao/blob/9d6c776cf670e8f78bd91249c77775a2cd7ac984/src/N8AOPostPass.js#L172
    readonly copyQuad: { material: ShaderMaterial };
    autoDetectTransparency: boolean;
    setSize(width: number, height: number): void;
    setQualityMode(mode: QualityMode): void;
  }
}
