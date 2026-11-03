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
  /** RGB as stored. */
  | "rgb"
  /** One channel, stretched over `range`. */
  | "channel"
  /** RG as an octahedral-encoded normal (the G-buffer normal buffer). */
  | "normal"
  /** RGBA-packed depth (three's `RGBADepthPacking`), stretched over `range`. */
  | "packedDepth"
  /** R as an integer bitmask (the selective-effect id buffer), one color per bit. */
  | "bitmask";

export type BlitCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

const MODE_INDEX: Record<BlitMode, number> = {
  rgb: 0,
  channel: 1,
  normal: 2,
  packedDepth: 3,
  bitmask: 4,
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
uniform vec2 uRange;
varying vec2 vUv;

float stretch(float v) {
  return (v - uRange.x) / max(uRange.y - uRange.x, 1e-6);
}

void main() {
  vec4 c = texture2D(tSource, vUv);
  vec3 rgb = c.rgb;
  if (uMode == 1) {
    float v = uChannel == 0 ? c.r : uChannel == 1 ? c.g : uChannel == 2 ? c.b : c.a;
    rgb = vec3(stretch(v));
  } else if (uMode == 2) {
    rgb = unpackVec2ToNormal(c.xy) * 0.5 + 0.5;
  } else if (uMode == 3) {
    rgb = vec3(stretch(unpackRGBAToDepth(c)));
  } else if (uMode == 4) {
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
        uRange: { value: new Vector2(0, 1) },
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

  /** Value range mapped to black..white in the scalar modes. */
  setRange(min: number, max: number): void {
    (this.material.uniforms.uRange.value as Vector2).set(min, max);
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

    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.setViewport(x, y, width, height);
    renderer.setScissor(x, y, width, height);
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
