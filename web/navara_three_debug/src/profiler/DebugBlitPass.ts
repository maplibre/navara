import { NORMAL_PACKING_SHADER } from "@navaramap/three";
import { Pass } from "postprocessing";
import {
  NoBlending,
  ShaderMaterial,
  Vector2,
  Vector4,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

/** How a sampled texel is turned into a display color. */
export type BlitMode =
  /** RGB as stored, times `brightness`. */
  | "color"
  /** One channel (`channel`) as gray, times `brightness`. */
  | "channel"
  /** RG as an octahedral-encoded normal (the G-buffer normal buffer). */
  | "normal"
  /**
   * R as depth, shown as distance on a log scale (see `setDepthScale`):
   * black at the reference distance or nearer, white 50× farther or more.
   */
  | "depth"
  /** RGBA-packed depth (three's `RGBADepthPacking`), shown like `depth`. */
  | "packedDepth"
  /** R as an integer bitmask (the selective-effect id buffer), one color per bit. */
  | "bitmask";

export type BlitCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

const MODE_INDEX: Record<BlitMode, number> = {
  color: 0,
  channel: 1,
  normal: 2,
  depth: 3,
  packedDepth: 4,
  bitmask: 5,
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
#include <packing>
${NORMAL_PACKING_SHADER}

uniform sampler2D tSource;
uniform int uMode;
uniform int uChannel;
uniform float uBrightness;
uniform bool uLogDepth;
uniform float uLogFar;
uniform float uRefDistance;
varying vec2 vUv;

// three's logarithmic depth stores log2(1 + w) / log2(far + 1).
float depthShade(float d) {
  if (!uLogDepth) return d;
  float distance = exp2(d * uLogFar) - 1.0;
  return clamp(log(max(distance, 1e-3) / uRefDistance) / log(50.0), 0.0, 1.0);
}

void main() {
  vec4 c = texture2D(tSource, vUv);
  vec3 rgb = c.rgb * uBrightness;
  if (uMode == 1) {
    float v = uChannel == 0 ? c.r : uChannel == 1 ? c.g : uChannel == 2 ? c.b : c.a;
    rgb = vec3(v * uBrightness);
  } else if (uMode == 2) {
    rgb = unpackVec2ToNormal(c.xy) * 0.5 + 0.5;
  } else if (uMode == 3) {
    rgb = vec3(depthShade(c.r) * uBrightness);
  } else if (uMode == 4) {
    rgb = vec3(depthShade(unpackRGBAToDepth(c)) * uBrightness);
  } else if (uMode == 5) {
    int m = int(c.r + 0.5);
    rgb = vec3(0.0);
    if ((m & 1) != 0) rgb += vec3(1.0, 0.0, 0.0);
    if ((m & 2) != 0) rgb += vec3(0.0, 1.0, 0.0);
    if ((m & 4) != 0) rgb += vec3(0.0, 0.0, 1.0);
    if ((m & 8) != 0) rgb += vec3(1.0, 1.0, 0.0);
    if ((m & 16) != 0) rgb += vec3(1.0, 0.0, 1.0);
    if ((m & 32) != 0) rgb += vec3(0.0, 1.0, 1.0);
    rgb = min(rgb, vec3(1.0));
  }
  gl_FragColor = vec4(rgb, 1.0);
}
`;

/**
 * Draws a texture into a corner of the frame. Inserted before the `final`
 * copy pass, it paints into the composer's input buffer with a scissored
 * viewport, so the copy carries the inset to the screen. The source is
 * resolved per render: G-buffer attachments are replaced when the
 * configuration changes.
 */
export class DebugBlitPass extends Pass {
  /** Resolves the texture to show; `undefined` draws nothing. */
  source: (() => Texture | undefined) | undefined;
  corner: BlitCorner = "bottom-left";

  /** Inset width as a fraction of the frame width. */
  scale = 0.3;

  private readonly material: ShaderMaterial;
  private readonly size = new Vector2();
  private readonly viewport = new Vector4();
  private readonly scissor = new Vector4();

  constructor() {
    super("DebugBlitPass");
    this.needsSwap = false;
    this.material = new ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uMode: { value: 0 },
        uChannel: { value: 0 },
        uBrightness: { value: 1 },
        uLogDepth: { value: true },
        uLogFar: { value: 20 },
        uRefDistance: { value: 100 },
      },
      vertexShader,
      fragmentShader,
      blending: NoBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.fullscreenMaterial = this.material;
  }

  set mode(mode: BlitMode) {
    this.material.uniforms.uMode.value = MODE_INDEX[mode];
  }

  /** Channel index (0 = R .. 3 = A) for the `channel` mode. */
  set channel(index: number) {
    this.material.uniforms.uChannel.value = index;
  }

  /**
   * How the depth modes read depth. With a logarithmic depth buffer (the
   * view's default) depth is turned back into distance and shaded from
   * `refDistance` (black) to 50× it (white); otherwise it is shown raw.
   */
  setDepthScale(logDepth: boolean, far: number, refDistance: number): void {
    const u = this.material.uniforms;
    u.uLogDepth.value = logDepth;
    u.uLogFar.value = Math.log2(far + 1);
    u.uRefDistance.value = Math.max(refDistance, 1);
  }

  /** Multiplier for every mode but `normal` and `bitmask`. */
  set brightness(value: number) {
    this.material.uniforms.uBrightness.value = value;
  }

  render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget | null): void {
    const texture = this.source?.();
    if (!texture) return;
    this.material.uniforms.tSource.value = texture;

    const target = inputBuffer;
    const size =
      target === null
        ? renderer.getDrawingBufferSize(this.size)
        : this.size.set(target.width, target.height);
    const image = texture.image as
      { width?: number; height?: number } | undefined;
    const aspect =
      image?.width && image.height
        ? image.height / image.width
        : size.y / size.x;
    const width = Math.round(size.x * this.scale);
    const height = Math.round(width * aspect);
    const margin = 8;
    const x = this.corner.endsWith("left") ? margin : size.x - width - margin;
    const y = this.corner.startsWith("bottom")
      ? margin
      : size.y - height - margin;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousScissorTest = renderer.getScissorTest();
    renderer.getViewport(this.viewport);
    renderer.getScissor(this.scissor);

    // The rectangle is in the target's pixels, but `setViewport` and
    // `setScissor` take CSS pixels and multiply by the pixel ratio for any
    // bound target, so divide it back out.
    const ratio = renderer.getPixelRatio();
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.setViewport(x / ratio, y / ratio, width / ratio, height / ratio);
    renderer.setScissor(x / ratio, y / ratio, width / ratio, height / ratio);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);

    renderer.setViewport(this.viewport);
    renderer.setScissor(this.scissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
