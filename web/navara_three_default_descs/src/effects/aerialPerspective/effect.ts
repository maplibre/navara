import {
  type Atmosphere,
  Pass,
  CustomEffectPass,
  type EffectOptions,
} from "@navaramap/three";
import {
  type AtmosphereOverlay,
  type AtmosphereShadow,
  type AtmosphereShadowLength,
  type PrecomputedTextures,
} from "@takram/three-atmosphere";
import { type PerspectiveCamera, Texture } from "three";

import {
  AerialPerspectiveLightingEffect,
  DEFAULT_AERIAL_PERSPECTIVE_LIGHTING_OPTIONS,
  type AerialPerspectiveLightingOptions,
} from "./lightingTerms";

export type AerialPerspectiveOptions = {
  inscatter?: boolean;
  transmittance?: boolean;
  // This is used to light a material in the post-processing stage.
  // Note that:
  // - It doesn't support transparency.
  // - Enable this flag when rendering clouds with shadows.
  irradiance?: boolean;
  sky?: boolean;
  sun?: boolean;
  moon?: boolean;
  albedoScale?: number;
  useNormalBuffer?: boolean;
} & AerialPerspectiveLightingOptions &
  EffectOptions;

export const DEFAULT_AERIAL_PERSPECTIVE_OPTIONS: Required<AerialPerspectiveOptions> =
  {
    enabled: true,
    inscatter: true,
    transmittance: true,
    irradiance: false,
    sky: false,
    sun: true,
    moon: true,
    useNormalBuffer: true,
    albedoScale: 2 / Math.PI,
    ...DEFAULT_AERIAL_PERSPECTIVE_LIGHTING_OPTIONS,
  };

export class AerialPerspective extends Pass<
  CustomEffectPass,
  AerialPerspectiveLightingEffect,
  AerialPerspectiveOptions
> {
  atmosphere: Atmosphere;

  private cloudsShadows = true;
  private normalBuffer: Texture | null;

  constructor(
    atmosphere: Atmosphere,
    camera: PerspectiveCamera,
    normalBuffer: Texture | null,
    _options: AerialPerspectiveOptions = {},
  ) {
    const options = { ...DEFAULT_AERIAL_PERSPECTIVE_OPTIONS, ..._options };
    const effect = new AerialPerspectiveLightingEffect(
      camera,
      { octEncodedNormal: true },
      options,
    );
    const pass = new CustomEffectPass(camera, effect);
    super(pass, effect, options);

    this.atmosphere = atmosphere;
    this.normalBuffer = normalBuffer;
    this.options = options;

    this.init();

    this.onUpdate();
  }

  onUpdate = () => {
    this.emit("needsUpdate");
  };

  init() {
    this.inscatter = !!this.options.inscatter;
    this.transmittance = !!this.options.transmittance;
    this.irradiance = !!this.options.irradiance;
    this.sky = !!this.options.sky;
    this.sun = !!this.options.sun;
    this.moon = !!this.options.moon;
    this.albedoScale =
      this.options.albedoScale ??
      DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.albedoScale;
    this.useNormalBuffer =
      this.options.useNormalBuffer ??
      DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.useNormalBuffer;

    // The effect samples the irradiance texture only when the `irradiance`
    // option lights geometry from the atmosphere; the `irradiance` setter
    // requests it when enabled.
    this.atmosphere.onTexturesReady((t) => this.onTextureLoaded(t), {
      transmittance: true,
      scattering: true,
      higherOrderScattering: true,
    });

    this.atmosphere.overlay.on("changed", this.onOverlayChanged);
    this.atmosphere.shadow.on("changed", this.onShadowChanged);
    this.atmosphere.shadowLength.on("changed", this.onShadowLengthChanged);
    this.atmosphere.enableShadows.on("changed", this.onEnableShadowChanged);
  }

  onTextureLoaded = (textures: Partial<PrecomputedTextures>) => {
    Object.assign(this.rawEffect, textures);
  };

  onOverlayChanged = (v: AtmosphereOverlay | null) => {
    this.rawEffect.overlay = v;
  };
  onShadowChanged = (v: AtmosphereShadow | null) => {
    if (this.cloudsShadows) {
      this.rawEffect.shadow = v;
    } else {
      this.rawEffect.shadow = null;
    }
  };
  onShadowLengthChanged = (v: AtmosphereShadowLength | null) => {
    this.rawEffect.shadowLength = v;
  };
  onEnableShadowChanged = (v: boolean) => {
    this.cloudsShadows = v;
    if (v) {
      this.rawEffect.shadow = this.atmosphere.shadow.value;
    } else {
      this.rawEffect.shadow = null;
    }
  };

  _update() {
    if (!this.enabled) return;

    // Sun
    this.rawEffect?.sunDirection.copy(this.atmosphere.sunDirection);

    // Moon
    this.rawEffect?.moonDirection.copy(this.atmosphere.moonDirection);
  }

  get inscatter() {
    return (
      this.options.inscatter ?? DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.inscatter
    );
  }
  set inscatter(v: boolean) {
    if (!this.rawEffect) return;
    this.options.inscatter = v;
    this.rawEffect.inscatter = v;
    this.onUpdate();
  }

  get transmittance() {
    return (
      this.options.transmittance ??
      DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.transmittance
    );
  }
  set transmittance(v: boolean) {
    if (!this.rawEffect) return;
    this.options.transmittance = v;
    this.rawEffect.transmittance = v;
    this.onUpdate();
  }

  get irradiance() {
    return (
      this.options.irradiance ?? DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.irradiance
    );
  }
  set irradiance(v: boolean) {
    if (!this.rawEffect) return;
    this.options.irradiance = v;
    this.rawEffect.sunLight = v;
    this.rawEffect.skyLight = v;
    if (v) {
      // Lighting from the atmosphere needs the irradiance texture, which is
      // not part of the base set; fetch it on demand (no-op once loaded).
      this.atmosphere.onTexturesReady((t) => this.onTextureLoaded(t), {
        irradiance: true,
      });
    }
    this.onUpdate();
  }

  get sky() {
    return this.options.sky ?? DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.sky;
  }
  set sky(v: boolean) {
    if (!this.rawEffect) return;
    this.options.sky = v;
    this.rawEffect.sky = v;
    this.onUpdate();
  }

  get sun() {
    return this.options.sun ?? DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.sun;
  }
  set sun(v: boolean) {
    if (!this.rawEffect) return;
    this.options.sun = v;
    this.rawEffect.sun = v;
    this.onUpdate();
  }

  get moon() {
    return this.options.moon ?? DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.moon;
  }
  set moon(v: boolean) {
    if (!this.rawEffect) return;
    this.options.moon = v;
    this.rawEffect.moon = v;
    this.onUpdate();
  }

  get albedoScale() {
    return (
      this.options.albedoScale ?? DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.albedoScale
    );
  }
  set albedoScale(v: number) {
    if (!this.rawEffect) return;
    this.options.albedoScale = v;
    this.rawEffect.albedoScale = v;
    this.onUpdate();
  }

  setNormalBuffer(texture: Texture | null): void {
    this.normalBuffer = texture;
    if (!this.rawEffect) return;
    this.rawEffect.normalBuffer = this.useNormalBuffer ? texture : null;
  }

  get useNormalBuffer() {
    return (
      this.options.useNormalBuffer ??
      DEFAULT_AERIAL_PERSPECTIVE_OPTIONS.useNormalBuffer
    );
  }
  set useNormalBuffer(v: boolean) {
    if (!this.rawEffect) return;
    this.options.useNormalBuffer = v;
    this.rawEffect.normalBuffer = v ? this.normalBuffer : null;
    this.onUpdate();
  }
}
