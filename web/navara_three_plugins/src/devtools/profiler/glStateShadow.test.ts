import { describe, expect, it } from "vitest";

import { GlStateShadow, type Restore } from "./glStateShadow";

const GL = {
  FRONT: 0x0404,
  BACK: 0x0405,
  FRONT_AND_BACK: 0x0408,
  FRAMEBUFFER: 0x8d40,
  READ_FRAMEBUFFER: 0x8ca8,
  DRAW_FRAMEBUFFER: 0x8ca9,
  STENCIL_TEST: 0x0b90,
  SCISSOR_TEST: 0x0c11,
  DEPTH_TEST: 0x0b71,
};

/** A GL stub whose queries all return 0 and whose setters record calls. */
function fakeGl() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(`${name}(${args.join(",")})`);
  const gl = {
    ...GL,
    calls,
    getParameter: () => 0,
    isEnabled: () => false,
    useProgram: record("useProgram"),
    bindFramebuffer: record("bindFramebuffer"),
    enable: record("enable"),
    disable: record("disable"),
    stencilFunc: record("stencilFunc"),
    stencilFuncSeparate: record("stencilFuncSeparate"),
    stencilOp: record("stencilOp"),
    stencilOpSeparate: record("stencilOpSeparate"),
    stencilMask: record("stencilMask"),
    stencilMaskSeparate: record("stencilMaskSeparate"),
  };
  return gl as typeof gl & WebGL2RenderingContext;
}

describe("GlStateShadow", () => {
  it("follows the setters and still calls them", () => {
    const gl = fakeGl();
    const shadow = new GlStateShadow(gl);
    shadow.install([]);
    const program = {} as WebGLProgram;
    const draw = {} as WebGLFramebuffer;
    const read = {} as WebGLFramebuffer;

    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, draw);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.enable(gl.STENCIL_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.stencilFunc(1, 2, 3);
    gl.stencilOpSeparate(gl.BACK, 4, 5, 6);
    gl.stencilMaskSeparate(gl.FRONT, 7);

    expect(shadow.program).toBe(program);
    expect(shadow.drawFramebuffer).toBe(draw);
    expect(shadow.readFramebuffer).toBe(read);
    expect(shadow.stencilTest).toBe(true);
    expect(shadow.scissorTest).toBe(false);
    expect(shadow.front).toMatchObject({ func: 1, ref: 2, valueMask: 3 });
    expect(shadow.back).toMatchObject({ func: 1, fail: 4, zfail: 5, zpass: 6 });
    expect(shadow.front.writeMask).toBe(7);
    expect(shadow.back.writeMask).toBe(0);
    expect(gl.calls).toHaveLength(8);
  });

  it("restores the original setters", () => {
    const gl = fakeGl();
    const original = gl.useProgram;
    const restores: Restore[] = [];
    new GlStateShadow(gl).install(restores);
    expect(gl.useProgram).not.toBe(original);
    for (const restore of restores.reverse()) restore();
    expect(gl.useProgram).toBe(original);
  });
});
