import { createReplacer } from "@navaramap/three";
import LightingTermsFragment from "@shaders/glsl/aerialPerspectiveLightingTerms.glsl";
import {
  AerialPerspectiveEffect,
  type AerialPerspectiveEffectOptions,
} from "@takram/three-atmosphere";
import { vogelDisk } from "@takram/three-geospatial/shaders";
import { Uniform, type Camera, type Texture } from "three";

export type AerialPerspectiveLightingOptions = {
  /** Re-applies the sun's cascaded shadows from the shadow G-buffer. */
  shadow?: boolean;
  /** Scales the shadow amount read from the G-buffer (0 = off, 1 = as cast). */
  shadowIntensity?: number;
  /** Screen-space filter radius in pixels. 0 uses the buffer as-is. */
  shadowSoftness?: number;
  /** Taps of the softening filter. Ignored while `shadowSoftness` is 0. */
  shadowSamples?: number;
  /** Adds the sun's GGX specular reflection. */
  specular?: boolean;
  /** Scales the specular reflection. */
  specularIntensity?: number;
};

export const DEFAULT_AERIAL_PERSPECTIVE_LIGHTING_OPTIONS: Required<AerialPerspectiveLightingOptions> =
  {
    shadow: false,
    shadowIntensity: 1,
    shadowSoftness: 1.5,
    shadowSamples: 12,
    specular: false,
    specularIntensity: 1,
  };

const MAIN_IMAGE_SIGNATURE =
  "void mainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {";
const SUN_SKY_IRRADIANCE_CALL =
  "radiance = getSunSkyIrradiance(positionECEF, normalECEF, inputColor.rgb, sunTransmittance);";

/**
 * Injects the shadow and specular terms into the aerial perspective's
 * fragment shader. Throws when an upstream change moves an anchor.
 */
export function patchLightingTermsShader(source: string): string {
  return createReplacer(source)
    .replace(
      MAIN_IMAGE_SIGNATURE,
      `
// The host declares this one under HAS_SHADOW.
#ifndef HAS_SHADOW
${vogelDisk}
#endif // HAS_SHADOW

${LightingTermsFragment}

${MAIN_IMAGE_SIGNATURE}
`,
    )
    .replace(
      SUN_SKY_IRRADIANCE_CALL,
      `
    #if (defined(NVR_SHADOW) || defined(NVR_SPECULAR)) && defined(SUN_LIGHT) && defined(SKY_LIGHT) && defined(HAS_NORMALS)
    radiance = nvrGetSunSkyIrradiance(uv, positionECEF, normalECEF, inputColor.rgb, sunTransmittance);
    #else
    ${SUN_SKY_IRRADIANCE_CALL}
    #endif
`,
    ).source;
}

/**
 * The aerial perspective effect with the lighting terms its Lambertian
 * `irradiance` model drops: cascaded shadows and the sun's specular, applied
 * to its own sun and sky irradiance. Both terms need `sunLight`, `skyLight`
 * and a `normalBuffer`; the shader compiles them out otherwise.
 */
export class AerialPerspectiveLightingEffect extends AerialPerspectiveEffect {
  private _shadow: boolean;
  private _shadowSoftness: number;
  private _shadowSamples: number;
  private _specular: boolean;

  constructor(
    camera: Camera,
    options?: AerialPerspectiveEffectOptions,
    lighting?: AerialPerspectiveLightingOptions,
  ) {
    super(camera, options);

    const {
      shadow,
      shadowIntensity,
      shadowSoftness,
      shadowSamples,
      specular,
      specularIntensity,
    } = { ...DEFAULT_AERIAL_PERSPECTIVE_LIGHTING_OPTIONS, ...lighting };

    // Before the pass compiles: uniforms are collected at compile time.
    this.setFragmentShader(patchLightingTermsShader(this.getFragmentShader()));
    const uniforms = this.lightingUniforms;
    uniforms.set("nvrShadowBuffer", new Uniform(null));
    uniforms.set("nvrShadowIntensity", new Uniform(shadowIntensity));
    uniforms.set("nvrShadowSoftness", new Uniform(shadowSoftness));
    uniforms.set("nvrSpecularIntensity", new Uniform(specularIntensity));

    this._shadow = shadow;
    this._shadowSoftness = shadowSoftness;
    this._shadowSamples = shadowSamples;
    this._specular = specular;
    this.applyLightingDefines();
  }

  // The base class types `uniforms` by its own keys.
  private get lightingUniforms(): Map<string, Uniform> {
    return this.uniforms as unknown as Map<string, Uniform>;
  }

  private applyLightingDefines(): void {
    const { defines } = this;
    // 0 taps compiles the filter away.
    defines.set(
      "NVR_SHADOW_TAP_COUNT",
      `${this._shadowSoftness > 0 ? Math.max(0, Math.round(this._shadowSamples)) : 0}`,
    );
    setDefine(defines, "NVR_SHADOW", this._shadow);
    setDefine(defines, "NVR_SPECULAR", this._specular);
    this.setChanged();
  }

  /** The shadow G-buffer attachment (R = shadow amount, G = deferred-lit flag). */
  setShadowBuffer(texture: Texture | null): void {
    const uniform = this.lightingUniforms.get("nvrShadowBuffer");
    if (uniform) uniform.value = texture;
  }

  /** `shadow` is the base class's cloud shadow input. */
  get shadowTerm(): boolean {
    return this._shadow;
  }
  set shadowTerm(value: boolean) {
    if (this._shadow === value) return;
    this._shadow = value;
    this.applyLightingDefines();
  }

  get shadowIntensity(): number {
    return this.lightingUniforms.get("nvrShadowIntensity")?.value as number;
  }
  set shadowIntensity(value: number) {
    const uniform = this.lightingUniforms.get("nvrShadowIntensity");
    if (uniform) uniform.value = value;
  }

  get shadowSoftness(): number {
    return this._shadowSoftness;
  }
  set shadowSoftness(value: number) {
    const uniform = this.lightingUniforms.get("nvrShadowSoftness");
    if (uniform) uniform.value = value;
    // Crossing zero adds or removes the filter, which is a recompile.
    const wasFiltering = this._shadowSoftness > 0;
    this._shadowSoftness = value;
    if (wasFiltering !== value > 0) {
      this.applyLightingDefines();
    }
  }

  get shadowSamples(): number {
    return this._shadowSamples;
  }
  set shadowSamples(value: number) {
    if (this._shadowSamples === value) return;
    this._shadowSamples = value;
    this.applyLightingDefines();
  }

  get specularTerm(): boolean {
    return this._specular;
  }
  set specularTerm(value: boolean) {
    if (this._specular === value) return;
    this._specular = value;
    this.applyLightingDefines();
  }

  get specularIntensity(): number {
    return this.lightingUniforms.get("nvrSpecularIntensity")?.value as number;
  }
  set specularIntensity(value: number) {
    const uniform = this.lightingUniforms.get("nvrSpecularIntensity");
    if (uniform) uniform.value = value;
  }
}

function setDefine(
  defines: Map<string, string>,
  name: string,
  enabled: boolean,
): void {
  if (enabled) {
    defines.set(name, "1");
  } else {
    defines.delete(name);
  }
}
