import type ThreeView from "@navaramap/three";
import {
  Plugin,
  type MeshHandle,
  type LightHandle,
  type EffectHandle,
  type ViewContext,
} from "@navaramap/three";
import {
  RainMeshDesc,
  SnowMeshDesc,
  SkyMeshDesc,
  SkyBoxMeshDesc,
  StarsDesc,
  BoxMeshDesc,
  SphereMeshDesc,
  GlowGlobeMeshDesc,
  CylinderMeshDesc,
  TubeMeshDesc,
  PlaneMeshDesc,
  GLTFModelDesc,
  SplatMeshDesc,
  AxesHelperDesc,
  ArrowHelperDesc,
  ArclineMeshDesc,
  SmoothLineMeshDesc,
  type RainMeshConfig,
  type SnowMeshConfig,
  type SkyMeshConfig,
  type SkyBoxMeshConfig,
  type StarsConfig,
  type BoxMeshConfig,
  type SphereMeshConfig,
  type GlowGlobeMeshConfig,
  type CylinderMeshConfig,
  type TubeMeshConfig,
  type PlaneMeshConfig,
  type GLTFModelConfig,
  type SplatMeshConfig,
  type AxesHelperConfig,
  type ArrowHelperConfig,
  type ArclineMeshConfig,
  type SmoothLineMeshConfig,
  InstancedBoxMeshDesc,
  type InstancedBoxMeshConfig,
  InstancedSphereMeshDesc,
  type InstancedSphereMeshConfig,
  InstancedPlaneMeshDesc,
  type InstancedPlaneMeshConfig,
  InstancedCylinderMeshDesc,
  type InstancedCylinderMeshConfig,
  InstancedGltfModelMeshDesc,
  type InstancedGltfModelMeshConfig,
  AerialPerspectiveEffectDesc,
  CloudsEffectDesc,
  ColorGradingLUTEffectDesc,
  DepthOfFieldEffectDesc,
  FogLightEffectDesc,
  FXAAEffectDesc,
  LensFlareEffectDesc,
  RainDropEffectDesc,
  SelectiveBloomEffectDesc,
  SelectiveOutlineEffectDesc,
  SMAAEffectDesc,
  SSAOEffectDesc,
  SSREffectDesc,
  ToneMappingEffectDesc,
  type AerialPerspectiveConfig,
  type CloudsConfig,
  type ColorGradingLUTConfig,
  type DepthOfFieldConfig,
  type FogLightConfig,
  type FXAAConfig,
  type LensFlareConfig,
  type RainDropConfig,
  type SelectiveBloomEffectConfig,
  type SelectiveOutlineEffectConfig,
  type SMAAConfig,
  type SSAOConfig,
  type SSRConfig,
  type ToneMappingConfig,
  SunLightDesc,
  AmbientLightDesc,
  SkyLightProbeDesc,
  LightProbeDesc,
  type SunLightConfig,
  type AmbientLightConfig,
  type SkyLightProbeConfig,
  type LightProbeConfig,
} from "@navaramap/three-default-descs";

export class DefaultPlugin extends Plugin<
  ThreeView<DefaultDescriptions>,
  ViewContext
> {
  private view?: ThreeView<DefaultDescriptions>;

  async init(view: ThreeView<DefaultDescriptions>, _ctx: ViewContext) {
    this.view = view;

    // Register meshes
    view.registerMesh("rain", RainMeshDesc);
    view.registerMesh("snow", SnowMeshDesc);
    view.registerMesh("sky", SkyMeshDesc);
    view.registerMesh("skyBox", SkyBoxMeshDesc);
    view.registerMesh("stars", StarsDesc);
    view.registerMesh("box", BoxMeshDesc);
    view.registerMesh("sphere", SphereMeshDesc);
    view.registerMesh("glowGlobe", GlowGlobeMeshDesc);
    view.registerMesh("cylinder", CylinderMeshDesc);
    view.registerMesh("tube", TubeMeshDesc);
    view.registerMesh("plane", PlaneMeshDesc);
    view.registerMesh("gltfModel", GLTFModelDesc);
    view.registerMesh("splat", SplatMeshDesc);
    view.registerMesh("axesHelper", AxesHelperDesc);
    view.registerMesh("arrowHelper", ArrowHelperDesc);
    view.registerMesh("arcLines", ArclineMeshDesc);
    view.registerMesh("smoothLines", SmoothLineMeshDesc);
    view.registerMesh("boxes", InstancedBoxMeshDesc);
    view.registerMesh("spheres", InstancedSphereMeshDesc);
    view.registerMesh("planes", InstancedPlaneMeshDesc);
    view.registerMesh("cylinders", InstancedCylinderMeshDesc);
    view.registerMesh("gltfModels", InstancedGltfModelMeshDesc);

    // Register lights
    view.registerLight("sun", SunLightDesc);
    view.registerLight("ambient", AmbientLightDesc);
    view.registerLight("skyLightProbe", SkyLightProbeDesc);
    view.registerLight("lightProbe", LightProbeDesc);

    // Register effects
    view.registerEffect("aerialPerspective", AerialPerspectiveEffectDesc);
    view.registerEffect("rainDrop", RainDropEffectDesc);
    view.registerEffect("selectiveBloom", SelectiveBloomEffectDesc);
    view.registerEffect("selectiveOutline", SelectiveOutlineEffectDesc);
    view.registerEffect("clouds", CloudsEffectDesc);
    view.registerEffect("fogLight", FogLightEffectDesc);
    view.registerEffect("lensFlare", LensFlareEffectDesc);
    view.registerEffect("ssao", SSAOEffectDesc);
    view.registerEffect("ssr", SSREffectDesc);
    view.registerEffect("depthOfField", DepthOfFieldEffectDesc);
    view.registerEffect("colorGradingLUT", ColorGradingLUTEffectDesc);
    view.registerEffect("toneMapping", ToneMappingEffectDesc);
    view.registerEffect("smaa", SMAAEffectDesc);
    view.registerEffect("fxaa", FXAAEffectDesc);
  }

  /**
   * Add default descriptors automatically to make the photorealistic scene.
   * This method must be invoked after `view.init()`.
   *
   * `deferredLighting` lights the scene from the atmosphere in post: it sets
   * `aerialPerspective.irradiance` and `view.lit = false` together, since the
   * forward pass would otherwise apply lighting as well. `shadow` and
   * `specular` enable the sun's shadows and its specular highlight in that
   * lighting through the aerial perspective's options of the same name. Both
   * are off by default because either allocates the shadow G-buffer, and
   * both are inert without `deferredLighting`. Toggle any of them later via
   * the returned handle and `view.lit`.
   */
  addDefaultPhotorealScene(options?: {
    deferredLighting?: boolean;
    shadow?: boolean;
    specular?: boolean;
  }): {
    sky: MeshHandle<SkyMeshDesc>;
    stars: MeshHandle<StarsDesc>;
    skyLightProbe: LightHandle<SkyLightProbeDesc>;
    sun: LightHandle<SunLightDesc>;
    aerialPerspective: EffectHandle<AerialPerspectiveEffectDesc>;
    lensFlare: EffectHandle<LensFlareEffectDesc> | undefined;
    toneMapping: EffectHandle<ToneMappingEffectDesc>;
    antialiasing: EffectHandle<SMAAEffectDesc> | EffectHandle<FXAAEffectDesc>;
  } {
    if (!this.view) {
      throw new Error(
        "DefaultPlugin is not initialized. Call view.addPlugin() and view.init() first.",
      );
    }

    const view = this.view;
    const mobile = view.isMobileOptimized();

    // Meshes
    const sky = view.addMesh<SkyMeshDesc>({
      sky: {},
    });
    const stars = view.addMesh<StarsDesc>({
      stars: {},
    });

    // Lights
    const skyLightProbe = view.addLight<SkyLightProbeDesc>({
      skyLightProbe: {},
    });
    const sun = view.addLight<SunLightDesc>({
      sun: {},
    });

    // Effects
    const aerialPerspective = view.addEffect<AerialPerspectiveEffectDesc>({
      aerialPerspective: {
        ...(options?.deferredLighting ? { irradiance: true } : {}),
        ...(options?.shadow ? { shadow: true } : {}),
        ...(options?.specular ? { specular: true } : {}),
      },
    });
    if (options?.deferredLighting) {
      view.lit = false;
    }

    // Skip lens flare on mobile - expensive effect with limited benefit
    const lensFlare = mobile
      ? undefined
      : view.addEffect<LensFlareEffectDesc>({
          lensFlare: {},
        });

    const toneMapping = view.addEffect<ToneMappingEffectDesc>({
      toneMapping: {},
    });

    // Use FXAA on mobile (faster), SMAA on desktop (higher quality)
    const antialiasing = mobile
      ? view.addEffect<FXAAEffectDesc>({
          fxaa: {},
        })
      : view.addEffect<SMAAEffectDesc>({
          smaa: {},
        });

    return {
      sky,
      stars,
      skyLightProbe,
      sun,
      aerialPerspective,
      lensFlare,
      toneMapping,
      antialiasing,
    };
  }
}

export type DefaultDescriptions = {
  mesh: DefaultMeshDescription;
  light: DefaultLightDescription;
  effect: DefaultEffectDescription;
};

export type DefaultLightDescription =
  SunLightConfig | SkyLightProbeConfig | AmbientLightConfig | LightProbeConfig;

export type DefaultEffectDescription =
  | AerialPerspectiveConfig
  | CloudsConfig
  | ColorGradingLUTConfig
  | DepthOfFieldConfig
  | FogLightConfig
  | FXAAConfig
  | LensFlareConfig
  | RainDropConfig
  | SelectiveBloomEffectConfig
  | SelectiveOutlineEffectConfig
  | SMAAConfig
  | SSAOConfig
  | SSRConfig
  | ToneMappingConfig;

export type DefaultMeshDescription =
  | RainMeshConfig
  | SnowMeshConfig
  | SkyMeshConfig
  | SkyBoxMeshConfig
  | StarsConfig
  | BoxMeshConfig
  | SphereMeshConfig
  | GlowGlobeMeshConfig
  | CylinderMeshConfig
  | TubeMeshConfig
  | PlaneMeshConfig
  | GLTFModelConfig
  | SplatMeshConfig
  | AxesHelperConfig
  | ArrowHelperConfig
  | ArclineMeshConfig
  | SmoothLineMeshConfig
  | InstancedBoxMeshConfig
  | InstancedSphereMeshConfig
  | InstancedPlaneMeshConfig
  | InstancedCylinderMeshConfig
  | InstancedGltfModelMeshConfig;
