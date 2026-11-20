/** Restores what {@link wrapMethod} replaced. */
export type Restore = () => void;

/**
 * Replaces `obj[key]` with an own property; the returned function restores
 * the previous own property, or removes it when the method came from the
 * prototype.
 */
export function wrapMethod<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  make: (original: T[K]) => T[K],
): Restore {
  const own = Object.getOwnPropertyDescriptor(obj, key);
  const original = obj[key];
  Object.defineProperty(obj, key, {
    value: make(original),
    configurable: true,
    writable: true,
  });
  return () => {
    if (own) Object.defineProperty(obj, key, own);
    else Reflect.deleteProperty(obj, key);
  };
}

/** One face's stencil state. */
export type StencilState = {
  func: number;
  ref: number;
  valueMask: number;
  fail: number;
  zfail: number;
  zpass: number;
  writeMask: number;
};

/**
 * A copy of the GL state the overdraw counter saves and restores around
 * every replayed draw. `gl.getParameter` often waits on the GPU process, so
 * the state is read once at `install` and then followed by wrapping its
 * setters.
 */
export class GlStateShadow {
  program: WebGLProgram | null = null;
  drawFramebuffer: WebGLFramebuffer | null = null;
  readFramebuffer: WebGLFramebuffer | null = null;
  stencilTest = false;
  scissorTest = false;
  front!: StencilState;
  back!: StencilState;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Reads the current state and starts following it. */
  install(restores: Restore[]): void {
    const gl = this.gl;
    const get = <T>(name: number) => gl.getParameter(name) as T;
    this.program = get(gl.CURRENT_PROGRAM);
    this.drawFramebuffer = get(gl.DRAW_FRAMEBUFFER_BINDING);
    this.readFramebuffer = get(gl.READ_FRAMEBUFFER_BINDING);
    this.stencilTest = gl.isEnabled(gl.STENCIL_TEST);
    this.scissorTest = gl.isEnabled(gl.SCISSOR_TEST);
    this.front = {
      func: get(gl.STENCIL_FUNC),
      ref: get(gl.STENCIL_REF),
      valueMask: get(gl.STENCIL_VALUE_MASK),
      fail: get(gl.STENCIL_FAIL),
      zfail: get(gl.STENCIL_PASS_DEPTH_FAIL),
      zpass: get(gl.STENCIL_PASS_DEPTH_PASS),
      writeMask: get(gl.STENCIL_WRITEMASK),
    };
    this.back = {
      func: get(gl.STENCIL_BACK_FUNC),
      ref: get(gl.STENCIL_BACK_REF),
      valueMask: get(gl.STENCIL_BACK_VALUE_MASK),
      fail: get(gl.STENCIL_BACK_FAIL),
      zfail: get(gl.STENCIL_BACK_PASS_DEPTH_FAIL),
      zpass: get(gl.STENCIL_BACK_PASS_DEPTH_PASS),
      writeMask: get(gl.STENCIL_BACK_WRITEMASK),
    };

    const follow = <K extends keyof WebGL2RenderingContext>(
      key: K,
      track: (...args: never[]) => void,
    ) => {
      restores.push(
        wrapMethod(gl, key, (original) => {
          const call = original as (...args: unknown[]) => unknown;
          return ((...args: never[]) => {
            track(...args);
            return call.apply(gl, args);
          }) as WebGL2RenderingContext[K];
        }),
      );
    };

    follow("useProgram", (program: WebGLProgram | null) => {
      this.program = program;
    });
    follow(
      "bindFramebuffer",
      (target: number, framebuffer: WebGLFramebuffer | null) => {
        if (target !== gl.READ_FRAMEBUFFER) this.drawFramebuffer = framebuffer;
        if (target !== gl.DRAW_FRAMEBUFFER) this.readFramebuffer = framebuffer;
      },
    );
    const capability = (enabled: boolean) => (cap: number) => {
      if (cap === gl.STENCIL_TEST) this.stencilTest = enabled;
      else if (cap === gl.SCISSOR_TEST) this.scissorTest = enabled;
    };
    follow("enable", capability(true));
    follow("disable", capability(false));

    const faces = (face: number, set: (s: StencilState) => void) => {
      if (face !== gl.BACK) set(this.front);
      if (face !== gl.FRONT) set(this.back);
    };
    const all = gl.FRONT_AND_BACK;
    const setFunc = (
      s: StencilState,
      func: number,
      ref: number,
      mask: number,
    ) => {
      s.func = func;
      s.ref = ref;
      s.valueMask = mask;
    };
    const setOp = (
      s: StencilState,
      fail: number,
      zfail: number,
      zpass: number,
    ) => {
      s.fail = fail;
      s.zfail = zfail;
      s.zpass = zpass;
    };
    follow("stencilFunc", (func: number, ref: number, mask: number) =>
      faces(all, (s) => setFunc(s, func, ref, mask)),
    );
    follow(
      "stencilFuncSeparate",
      (face: number, func: number, ref: number, mask: number) =>
        faces(face, (s) => setFunc(s, func, ref, mask)),
    );
    follow("stencilOp", (fail: number, zfail: number, zpass: number) =>
      faces(all, (s) => setOp(s, fail, zfail, zpass)),
    );
    follow(
      "stencilOpSeparate",
      (face: number, fail: number, zfail: number, zpass: number) =>
        faces(face, (s) => setOp(s, fail, zfail, zpass)),
    );
    follow("stencilMask", (mask: number) =>
      faces(all, (s) => (s.writeMask = mask)),
    );
    follow("stencilMaskSeparate", (face: number, mask: number) =>
      faces(face, (s) => (s.writeMask = mask)),
    );
  }

  /** Sets one face's stencil state back to `s` (a copy taken earlier). */
  restoreStencil(face: number, s: StencilState): void {
    const gl = this.gl;
    gl.stencilFuncSeparate(face, s.func, s.ref, s.valueMask);
    gl.stencilOpSeparate(face, s.fail, s.zfail, s.zpass);
    gl.stencilMaskSeparate(face, s.writeMask);
  }
}
