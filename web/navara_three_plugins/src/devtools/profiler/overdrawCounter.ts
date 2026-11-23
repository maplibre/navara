import {
  Color,
  CustomBlending,
  DepthStencilFormat,
  DepthTexture,
  EqualStencilFunc,
  FloatType,
  KeepStencilOp,
  Mesh,
  NearestFilter,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  UnsignedInt248Type,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from "three";

import { writesFragDepth } from "./fragDepthWrite";
import {
  GlStateShadow,
  wrapMethod as wrap,
  type Restore,
} from "./glStateShadow";

/**
 * Which fragments of a scene draw are counted.
 * - `shaded`: the fragments the GPU runs the fragment shader for. A program
 *   that writes `gl_FragDepth` (the logarithmic depth buffer) turns off the
 *   early depth test, so all of its fragments; otherwise only those that pass
 *   the depth test when drawn.
 * - `all`: every rasterized fragment, hidden or not.
 * - `depthTest`: only fragments that pass the depth test when drawn.
 */
export type OverdrawMode = "shaded" | "all" | "depthTest";

/** Depth-stencil formats the replay buffer can mirror. */
type DepthFormat = "d24s8" | "d32fs8";

/** Counts of the last resolved frame. */
export type OverdrawFrameStats = {
  /** Draw calls replayed into the counter. */
  counted: number;
  /** Scene draws not counted: their target's depth format has no stencil. */
  skipped: number;
  /** Programs whose source could not be read; `shaded` assumed they write depth. */
  unknownPrograms: number;
};

const DRAW_CALLS = [
  "drawArrays",
  "drawElements",
  "drawArraysInstanced",
  "drawElementsInstanced",
  "drawRangeElements",
] as const;

const MULTI_DRAW_CALLS = [
  "multiDrawArraysWEBGL",
  "multiDrawElementsWEBGL",
  "multiDrawArraysInstancedWEBGL",
  "multiDrawElementsInstancedWEBGL",
] as const;

/** Calls that may change the depth of the bound framebuffer outside a draw. */
const DEPTH_WRITES = [
  "clear",
  "clearBufferfv",
  "clearBufferfi",
  "blitFramebuffer",
  "invalidateFramebuffer",
] as const;

const BITS = 8;

const bitVertex = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const bitFragment = /* glsl */ `
uniform float uValue;
void main() {
  gl_FragColor = vec4(uValue, 0.0, 0.0, 0.0);
}
`;

/**
 * Counts, per pixel, the fragments the scene draws of a frame produce.
 *
 * WebGL cannot count fragments in a shader without changing every shader, so
 * each counted draw call is issued a second time, right after the real one,
 * into a replay framebuffer that holds only a depth-stencil texture. The
 * replay runs the real program with the real state, so geometry, culling and
 * depth match, and increments the stencil per fragment. The replay depth
 * mirrors the real target: it is copied over (`blitFramebuffer`) before the
 * first counted draw after anything else touched the target's depth, and
 * then follows it because the replay writes depth like the real draw.
 *
 * Counted are draws through `renderBufferDirect` with the view's camera into
 * one of `targets()` (the G-buffer and the composer's two buffers): shadow
 * maps, the sky cube map, picking and full-screen passes are not.
 *
 * `resolve()` turns the stencil counts into the red channel of
 * {@link texture} (count / 255, saturating at 255) and resets them.
 */
export class OverdrawCounter {
  mode: OverdrawMode = "shaded";

  private readonly gl: WebGL2RenderingContext;
  private target: WebGLRenderTarget | undefined;
  private format: DepthFormat = "d24s8";
  /** A target with another format was met; the next resolve switches. */
  private wantedFormat: DepthFormat | undefined;
  private replayFbo: WebGLFramebuffer | null = null;
  /** The real framebuffer whose depth the replay buffer currently mirrors. */
  private mirrored: WebGLFramebuffer | null = null;
  private counting = false;
  private readonly restores: Restore[] = [];
  private readonly formats = new WeakMap<
    WebGLFramebuffer,
    DepthFormat | null
  >();
  private readonly programs = new WeakMap<WebGLProgram, boolean | undefined>();
  private frame: OverdrawFrameStats = {
    counted: 0,
    skipped: 0,
    unknownPrograms: 0,
  };
  private last: OverdrawFrameStats = { ...this.frame };
  private blit!: WebGL2RenderingContext["blitFramebuffer"];
  private readonly state: GlStateShadow;

  private readonly bitScene = new Scene();
  private readonly bitCamera = new OrthographicCamera();
  private readonly bitMaterial = new ShaderMaterial({
    uniforms: { uValue: { value: 0 } },
    vertexShader: bitVertex,
    fragmentShader: bitFragment,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    depthTest: false,
    depthWrite: false,
    stencilWrite: true,
    stencilFunc: EqualStencilFunc,
    stencilWriteMask: 0,
    stencilFail: KeepStencilOp,
    stencilZFail: KeepStencilOp,
    stencilZPass: KeepStencilOp,
    toneMapped: false,
  });

  constructor(
    private readonly renderer: WebGLRenderer,
    /** The camera whose draws are counted. */
    private readonly camera: () => Camera,
    /** The render targets whose draws are counted. */
    private readonly targets: () => Iterable<WebGLRenderTarget>,
  ) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.state = new GlStateShadow(this.gl);
    const quad = new Mesh(new PlaneGeometry(2, 2), this.bitMaterial);
    quad.frustumCulled = false;
    this.bitScene.add(quad);
  }

  /** Counts as red = count / 255; valid after the first `resolve()`. */
  get texture() {
    return this.target?.texture;
  }

  /** The counter's render target, for reading the counts back. */
  get renderTarget(): WebGLRenderTarget | undefined {
    return this.target;
  }

  /** Draw totals of the last resolved frame. */
  get stats(): Readonly<OverdrawFrameStats> {
    return this.last;
  }

  get installed(): boolean {
    return this.restores.length > 0;
  }

  /**
   * Starts counting. Allocates the counter at `width` × `height` (the
   * composer buffers' size) and wraps the renderer and the GL draw calls.
   * Call between frames.
   */
  install(width: number, height: number): void {
    if (this.installed) return;
    this.allocate(width, height);

    const gl = this.gl;
    const renderer = this.renderer;
    this.blit = gl.blitFramebuffer.bind(gl);
    this.state.install(this.restores);

    this.restores.push(
      wrap(
        renderer,
        "renderBufferDirect",
        (original) => (camera, scene, geometry, material, object, group) => {
          this.counting =
            camera === this.camera() &&
            this.isCountedTarget(renderer.getRenderTarget());
          try {
            original.call(
              renderer,
              camera,
              scene,
              geometry,
              material,
              object,
              group,
            );
          } finally {
            this.counting = false;
          }
        },
      ),
    );

    const wrapDraw = <T extends object>(obj: T, key: keyof T & string) => {
      if (typeof obj[key] !== "function") return;
      this.restores.push(
        wrap(obj, key, (original) => {
          const draw = original as (...args: unknown[]) => void;
          return ((...args: unknown[]) => {
            if (!this.counting) {
              this.mirrored = null;
              draw.apply(obj, args);
              return;
            }
            const replay = this.prepare();
            draw.apply(obj, args);
            if (replay) this.replay(() => draw.apply(obj, args), replay);
          }) as T[keyof T & string];
        }),
      );
    };
    for (const key of DRAW_CALLS) wrapDraw(gl, key);
    const multiDraw = gl.getExtension("WEBGL_multi_draw");
    if (multiDraw) {
      for (const key of MULTI_DRAW_CALLS) wrapDraw(multiDraw, key);
    }
    for (const key of DEPTH_WRITES) {
      this.restores.push(
        wrap(gl, key, (original) => {
          const call = original as (...args: unknown[]) => void;
          return ((...args: unknown[]) => {
            this.mirrored = null;
            call.apply(gl, args);
          }) as (typeof gl)[typeof key];
        }),
      );
    }
  }

  /** Stops counting and restores every wrapped call. */
  uninstall(): void {
    while (this.restores.length > 0) this.restores.pop()?.();
    this.counting = false;
    this.mirrored = null;
  }

  dispose(): void {
    this.uninstall();
    this.release();
    this.bitMaterial.dispose();
    (this.bitScene.children[0] as Mesh).geometry.dispose();
  }

  /**
   * Turns this frame's stencil counts into {@link texture} and resets them.
   * Call once per frame after the last counted draw, from a pass (it changes
   * the render target and leaves restoring it to the caller).
   */
  resolve(width: number, height: number): void {
    if (
      this.wantedFormat !== undefined ||
      this.target?.width !== width ||
      this.target.height !== height
    ) {
      this.format = this.wantedFormat ?? this.format;
      this.wantedFormat = undefined;
      this.allocate(width, height);
    }
    const target = this.target;
    if (!target) return;
    const renderer = this.renderer;
    renderer.setRenderTarget(target);
    this.clear(true, false);

    const material = this.bitMaterial;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    for (let bit = 0; bit < BITS; bit++) {
      material.stencilRef = 1 << bit;
      material.stencilFuncMask = 1 << bit;
      material.uniforms.uValue.value = (1 << bit) / 255;
      material.uniformsNeedUpdate = true;
      renderer.render(this.bitScene, this.bitCamera);
    }
    renderer.autoClear = autoClear;
    this.clear(false, true);
    this.last = this.frame;
    this.frame = { counted: 0, skipped: 0, unknownPrograms: 0 };
  }

  private clear(color: boolean, stencil: boolean): void {
    const renderer = this.renderer;
    const clearColor = renderer.getClearColor(scratchColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.state.buffers.color.setMask(true);
    renderer.clear(color, false, stencil);
    renderer.setClearColor(clearColor, clearAlpha);
  }

  private isCountedTarget(target: WebGLRenderTarget | null): boolean {
    if (!target) return false;
    for (const t of this.targets()) if (t === target) return true;
    return false;
  }

  /**
   * Readies the replay buffer for a counted draw, before the real draw
   * changes the depth: copies the real depth over when it no longer mirrors
   * it. Returns the real framebuffer, or `null` to skip the replay.
   */
  private prepare(): WebGLFramebuffer | null {
    const gl = this.gl;
    const state = this.state;
    const fbo = state.drawFramebuffer;
    if (!fbo || !this.replayFbo || !this.target) return null;
    const format = this.depthFormat(fbo);
    if (format !== this.format) {
      this.frame.skipped++;
      if (format) this.wantedFormat = format;
      return null;
    }
    if (this.mirrored !== fbo) {
      const { width, height } = this.target;
      const read = state.readFramebuffer;
      const scissor = state.scissorTest;
      if (scissor) gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.replayFbo);
      this.blit(
        0,
        0,
        width,
        height,
        0,
        0,
        width,
        height,
        gl.DEPTH_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      this.mirrored = fbo;
    }
    return fbo;
  }

  /** Issues `draw` into the replay buffer with stencil counting. */
  private replay(draw: () => void, fbo: WebGLFramebuffer): void {
    const gl = this.gl;
    const everyFragment =
      this.mode === "all" ||
      (this.mode === "shaded" && this.programWritesDepth());

    const state = this.state;
    const test = state.stencilTest;
    const front = { ...state.front };
    const back = { ...state.back };

    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.replayFbo);
    if (!test) gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilMask(0xff);
    gl.stencilOp(gl.KEEP, everyFragment ? gl.INCR : gl.KEEP, gl.INCR);
    draw();

    state.restoreStencil(gl.FRONT, front);
    state.restoreStencil(gl.BACK, back);
    if (!test) gl.disable(gl.STENCIL_TEST);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    this.frame.counted++;
  }

  /**
   * Whether the bound program writes `gl_FragDepth`. Read from its fragment
   * source once per program; when the source is unavailable, assumed to
   * write it under a logarithmic depth buffer.
   */
  private programWritesDepth(): boolean {
    const gl = this.gl;
    const program = this.state.program;
    if (!program) return false;
    if (!this.programs.has(program)) {
      this.programs.set(program, readWritesDepth(gl, program));
    }
    const writes = this.programs.get(program);
    if (writes !== undefined) return writes;
    this.frame.unknownPrograms++;
    return this.renderer.capabilities.logarithmicDepthBuffer;
  }

  /** The depth-stencil format of a framebuffer, `null` without stencil. */
  private depthFormat(fbo: WebGLFramebuffer): DepthFormat | null {
    let format = this.formats.get(fbo);
    if (format !== undefined) return format;
    const gl = this.gl;
    const target = gl.DRAW_FRAMEBUFFER;
    const attached = (attachment: number) =>
      gl.getFramebufferAttachmentParameter(
        target,
        attachment,
        gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE,
      ) !== gl.NONE;
    format = null;
    if (attached(gl.DEPTH_ATTACHMENT) && attached(gl.STENCIL_ATTACHMENT)) {
      const component = gl.getFramebufferAttachmentParameter(
        target,
        gl.DEPTH_ATTACHMENT,
        gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE,
      ) as number;
      format = component === gl.FLOAT ? "d32fs8" : "d24s8";
    }
    this.formats.set(fbo, format);
    return format;
  }

  private allocate(width: number, height: number): void {
    this.release();
    const target = new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: true,
    });
    const depth = new DepthTexture(
      width,
      height,
      this.format === "d32fs8" ? FloatType : UnsignedInt248Type,
    );
    depth.format = DepthStencilFormat;
    target.depthTexture = depth;
    this.target = target;

    // Lets three allocate the target, then shares its depth-stencil texture
    // with a framebuffer that has no color attachment, so the replayed
    // programs' color outputs go nowhere.
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    this.clear(true, true);
    const gl = this.gl;
    const texture = (
      renderer.properties.get(depth) as { __webglTexture?: WebGLTexture }
    ).__webglTexture;
    if (!texture) throw new Error("Overdraw counter: depth texture missing");
    const bound = gl.getParameter(
      gl.DRAW_FRAMEBUFFER_BINDING,
    ) as WebGLFramebuffer | null;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.DRAW_FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.drawBuffers([gl.NONE]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, bound);
    this.replayFbo = fbo;
    this.mirrored = null;
    renderer.setRenderTarget(previous);
  }

  private release(): void {
    if (this.replayFbo) this.gl.deleteFramebuffer(this.replayFbo);
    this.replayFbo = null;
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.target = undefined;
  }
}

const scratchColor = new Color();

/**
 * `undefined` when the fragment source cannot be read back or parsed (the
 * `#if` evaluator throws on tokens it does not know); the error must not
 * escape into the wrapped draw call.
 */
function readWritesDepth(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): boolean | undefined {
  for (const shader of gl.getAttachedShaders(program) ?? []) {
    if (gl.getShaderParameter(shader, gl.SHADER_TYPE) !== gl.FRAGMENT_SHADER) {
      continue;
    }
    const source = gl.getShaderSource(shader);
    if (!source) return undefined;
    try {
      return writesFragDepth(source);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
