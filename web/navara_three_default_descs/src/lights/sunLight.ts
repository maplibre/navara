import { EventHandler } from "@navaramap/core";
import { CascadedShadowMaps, CSMHelper } from "@navaramap/three-csm";
import { SunDirectionalLight } from "@takram/three-atmosphere";
import { Color, Texture, Vector3, Material, PerspectiveCamera } from "three";

export type SunLightEvents = {
  needsUpdate: () => void;
  _csmChanged: () => void;
};

export type ShadowMode = "uniform" | "logarithmic" | "practical";

export type SunLightOptions = {
  /**
   * Distance of the sun light from the target position.
   * @default 300
   */
  distance?: number;
  /**
   * Color of the sun light.
   * @default new Color(0xffffff)
   */
  color?: Color;
  /**
   * Whether to apply the color directly or use atmospheric scattering calculations.
   * @default false
   */
  applyColor?: boolean;
  /**
   * Intensity of the sun light.
   * @default 1
   */
  intensity?: number;
  /**
   * Whether to cast shadows using Cascaded Shadow Maps (CSM).
   * @default true
   */
  castShadow?: boolean;
  /**
   * Number of shadow cascades. More cascades provide better shadow quality
   * distribution but require more GPU resources.
   * @default 4
   */
  shadowCascadeCount?: number;
  /**
   * Resolution of shadow maps (one per cascade). Higher values provide better
   * shadow quality but require more GPU memory.
   * @default 2048
   */
  shadowMapSize?: number;
  /**
   * Maximum distance from the camera where shadows are rendered.
   * Shadows will not be visible farther than this distance.
   * @default 50000
   */
  shadowFar?: number;
  /**
   * Defines the split scheme for the camera frustum:
   * - "uniform": Linear split distribution
   * - "logarithmic": Logarithmic split distribution (better for large scenes)
   * - "practical": Hybrid approach balancing quality and performance (recommended)
   * @default "practical"
   */
  shadowMode?: ShadowMode;
  /**
   * Lambda parameter for "practical" split mode. Controls the blend between
   * uniform (0.0) and logarithmic (1.0) split schemes.
   * @default 0.8
   */
  shadowLambda?: number;
  /**
   * Defines how far the shadow camera is positioned behind the cascade frustum.
   * Larger values help prevent shadow clipping but may reduce precision.
   * @default 5000
   */
  shadowMargin?: number;
  /**
   * Enables smooth transitions between shadow cascades to reduce visible seams.
   * @default true
   */
  shadowFade?: boolean;
  /**
   * Intensity of the shadows (0 = no shadows, 1 = full shadows).
   * @default 1
   */
  shadowIntensity?: number;
  /**
   * Shadow map bias to reduce shadow acne. Similar to THREE.LightShadow.bias.
   * @default 0.0001
   */
  shadowBias?: number;
  /**
   * Normal-based shadow bias to reduce shadow acne on surfaces at glancing angles.
   * @default 0
   */
  shadowNormalBias?: number;
  /**
   * PCF kernel width in shadow-map texels (`LightShadow.radius`). The 3x3
   * kernel shows its taps above about 4.
   * @default 1
   */
  shadowRadius?: number;
  /**
   * Whether to show debug visualization of shadow cascades.
   * @default false
   */
  debugCSMHelper?: boolean;
};

const DEFAULT_SUN_LIGHT_OPTIONS: Required<SunLightOptions> = {
  distance: 300,
  color: new Color(0xffffff),
  applyColor: false,
  intensity: 1,
  castShadow: true,
  shadowMapSize: 2048,
  shadowCascadeCount: 4,
  shadowFar: 5e4,
  shadowMode: "practical",
  shadowLambda: 0.8,
  shadowMargin: 5000,
  shadowFade: true,
  shadowIntensity: 1,
  shadowBias: 0.0001,
  shadowNormalBias: 0,
  shadowRadius: 1,
  debugCSMHelper: false,
};

export class SunLight extends EventHandler<SunLightEvents> {
  raw: SunDirectionalLight;
  private transmittanceTexture: Texture | null = null;
  private options: SunLightOptions;

  // CSM integration properties
  private csm!: CascadedShadowMaps;
  private csmHelper: CSMHelper | null = null;
  private camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, options: SunLightOptions = {}) {
    super();

    this.camera = camera;
    this.options = { ...DEFAULT_SUN_LIGHT_OPTIONS, ...options };

    this.raw = new SunDirectionalLight({
      distance: this.options.distance,
    });

    this.initializeCSM();

    this.raw.intensity = this.intensity;
    this.raw.color.copy(this.color);

    this.castShadow = !!this.options.castShadow;
  }

  updateSunDirection(sunDirection: Vector3) {
    this.raw.sunDirection.copy(sunDirection);
  }

  updateTargetPosition(position: Vector3) {
    if (this.applyColor) {
      return;
    }
    this.raw.target.position.copy(position);
  }

  update() {
    this.raw.update();

    // Sync CSM light direction with sun direction
    if (this.castShadow) {
      this.csm.directionalLights.direction.copy(this.raw.sunDirection.negate());

      if (!this.applyColor) {
        // Sync sun light color calculated dynamically.
        this.csm.color = this.color;
      }
    }

    // Update CSM if enabled
    this.updateCSM();
  }

  setTransmittanceTexture(texture: Texture) {
    this.transmittanceTexture = texture;
    // The texture may arrive after applyColor was toggled on; keep it
    // detached until applyColor is turned off again.
    this.raw.transmittanceTexture = this.applyColor ? null : texture;
  }

  clearTransmittanceTexture() {
    this.raw.transmittanceTexture = null;
  }

  // Private CSM Lifecycle Methods

  /**
   * Initialize CSM with current options
   */
  private initializeCSM(): void {
    if (!this.camera) {
      return;
    }

    this.csm = new CascadedShadowMaps(this.camera, {
      cascadeCount: this.options.shadowCascadeCount,
      mapSize: this.options.shadowMapSize,
      far: this.options.shadowFar,
      mode: this.options.shadowMode,
      lambda: this.options.shadowLambda,
      margin: this.options.shadowMargin,
      fade: this.options.shadowFade,
    });

    // Set light direction to match sun direction
    this.csm.directionalLights.direction.copy(this.raw.sunDirection);

    // Set light properties to match current sun light
    this.csm.intensity =
      this.options.intensity ?? DEFAULT_SUN_LIGHT_OPTIONS.intensity;
    this.csm.shadowIntensity =
      this.options.shadowIntensity ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowIntensity;
    // CascadedShadowMaps takes none of these in its constructor.
    this.csm.bias =
      this.options.shadowBias ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowBias;
    this.csm.normalBias =
      this.options.shadowNormalBias ??
      DEFAULT_SUN_LIGHT_OPTIONS.shadowNormalBias;
    this.csm.radius =
      this.options.shadowRadius ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowRadius;
    this.csm.color.copy(this.options.color ?? DEFAULT_SUN_LIGHT_OPTIONS.color);

    // Setup CSM helper for debug visualization
    if (this.options.debugCSMHelper) {
      this.csmHelper = new CSMHelper(this.csm);
    }
  }

  /**
   * Update CSM (call this in render loop)
   */
  private updateCSM(): void {
    // Update CSM
    this.csm.update();

    // Update helper if visible
    if (this.csmHelper) {
      this.csmHelper.update();
    }
  }

  // CSM Integration Methods

  /**
   * Set the camera for CSM calculations
   */
  setCamera(camera: PerspectiveCamera): void {
    this.camera = camera;
  }

  /**
   * Setup a material for CSM
   */
  setupMaterialForCSM(material: Material): void {
    this.csm.setupMaterial(material);
  }

  /**
   * Remove a material from CSM
   */
  removeMaterialFromCSM(material: Material): void {
    this.csm.rollbackMaterial(material);
  }

  /**
   * Get CSM instance for advanced usage
   */
  getCSM(): CascadedShadowMaps {
    return this.csm;
  }

  /**
   * Get CSM helper for debug visualization
   */
  getCSMHelper(): CSMHelper | null {
    return this.csmHelper;
  }

  /**
   * Get the lights that should be added to the scene
   * Returns CSM lights if enabled, otherwise the standard sun light
   */
  getSceneLights() {
    if (this.castShadow) {
      return this.csm.directionalLights;
    }
    return this.raw;
  }

  /**
   * Get the helper that should be added to the scene for debug visualization
   */
  getSceneHelper() {
    return this.csmHelper;
  }

  get visible() {
    return this.raw.visible;
  }
  set visible(v: boolean) {
    this.raw.visible = v;
    this.csm.directionalLights.visible = v;
    this.emit("needsUpdate");
  }

  get intensity() {
    return this.raw.intensity;
  }
  set intensity(v: number) {
    this.raw.intensity = v;
    this.csm.intensity = this.intensity;
    this.emit("needsUpdate");
  }

  get shadowIntensity() {
    return this.csm.shadowIntensity;
  }
  set shadowIntensity(v: number) {
    this.csm.shadowIntensity = v;
    this.emit("needsUpdate");
  }

  get color() {
    return this.raw.color;
  }
  set color(v: Color) {
    this.options.color = v;
    this.raw.color.copy(v);
    this.csm.color.copy(this.color);
    this.emit("needsUpdate");
  }

  get applyColor() {
    return this.options.applyColor ?? DEFAULT_SUN_LIGHT_OPTIONS.applyColor;
  }
  set applyColor(v: boolean) {
    this.options.applyColor = v;
    this.raw.transmittanceTexture = v ? null : this.transmittanceTexture;
    if (v) {
      this.color = this.options.color ?? DEFAULT_SUN_LIGHT_OPTIONS.color;
    }
    this.emit("needsUpdate");
  }

  get target() {
    return this.raw.target;
  }

  get castShadow() {
    return !!this.options.castShadow;
  }
  set castShadow(v: boolean) {
    this.options.castShadow = v;
    this.emit("_csmChanged");
    this.emit("needsUpdate");
  }

  get shadowMapSize() {
    return (
      this.options.shadowMapSize ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowMapSize
    );
  }
  set shadowMapSize(v: number) {
    this.options.shadowMapSize = v;
    this.csm.mapSize = v;

    this.emit("needsUpdate");
  }

  get shadowFar() {
    return this.options.shadowFar ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowFar;
  }
  set shadowFar(v: number) {
    this.options.shadowFar = v;
    this.csm.far = v;

    this.emit("needsUpdate");
  }

  get shadowCascadeCount() {
    return (
      this.options.shadowCascadeCount ??
      DEFAULT_SUN_LIGHT_OPTIONS.shadowCascadeCount
    );
  }
  set shadowCascadeCount(v: number) {
    this.options.shadowCascadeCount = v;
    this.csm.cascadeCount = v;

    this.emit("needsUpdate");
  }
  get shadowMode() {
    return this.options.shadowMode ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowMode;
  }
  set shadowMode(v: ShadowMode) {
    this.options.shadowMode = v;
    this.csm.mode = v;

    this.emit("needsUpdate");
  }
  get shadowLambda() {
    return this.options.shadowLambda ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowLambda;
  }
  set shadowLambda(v: number) {
    this.options.shadowLambda = v;
    this.csm.lambda = v;

    this.emit("needsUpdate");
  }
  get shadowMargin() {
    return this.options.shadowMargin ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowMargin;
  }
  set shadowMargin(v: number) {
    this.options.shadowMargin = v;
    this.csm.margin = v;

    this.emit("needsUpdate");
  }
  get shadowFade() {
    return this.options.shadowFade ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowFade;
  }
  set shadowFade(v: boolean) {
    this.options.shadowFade = v;
    this.csm.fade = v;

    this.emit("needsUpdate");
  }
  get shadowBias() {
    return this.options.shadowBias ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowBias;
  }
  set shadowBias(v: number) {
    this.options.shadowBias = v;
    this.csm.bias = v;

    this.emit("needsUpdate");
  }
  get shadowNormalBias() {
    return (
      this.options.shadowNormalBias ??
      DEFAULT_SUN_LIGHT_OPTIONS.shadowNormalBias
    );
  }
  set shadowNormalBias(v: number) {
    this.options.shadowNormalBias = v;
    this.csm.normalBias = v;

    this.emit("needsUpdate");
  }
  get shadowRadius() {
    return this.options.shadowRadius ?? DEFAULT_SUN_LIGHT_OPTIONS.shadowRadius;
  }
  set shadowRadius(v: number) {
    this.options.shadowRadius = v;
    this.csm.radius = v;

    this.emit("needsUpdate");
  }
  get debugCSMHelper() {
    return (
      this.options.debugCSMHelper ?? DEFAULT_SUN_LIGHT_OPTIONS.debugCSMHelper
    );
  }
  set debugCSMHelper(v: boolean) {
    this.options.debugCSMHelper = v;

    this.emit("needsUpdate");
  }
}
