import { describe, expect, it } from "vitest";

import { writesFragDepth } from "./fragDepthWrite";

describe("writesFragDepth", () => {
  it("finds an unconditional write", () => {
    expect(writesFragDepth("void main() { gl_FragDepth = 0.5; }")).toBe(true);
    expect(writesFragDepth("void main() { gl_FragColor = vec4(1); }")).toBe(
      false,
    );
  });

  it("ignores comments", () => {
    expect(writesFragDepth("// gl_FragDepth = 1.0;\n/* gl_FragDepth */")).toBe(
      false,
    );
  });

  it("follows three's log depth guard", () => {
    const chunk = [
      "#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )",
      "  gl_FragDepth = log2( vFragDepth ) * logDepthBufFC * 0.5;",
      "#endif",
    ].join("\n");
    expect(writesFragDepth(chunk)).toBe(false);
    expect(
      writesFragDepth(`#define USE_LOGARITHMIC_DEPTH_BUFFER\n${chunk}`),
    ).toBe(true);
  });

  it("takes one branch of #if / #elif / #else", () => {
    const shader = (defines: string) =>
      `${defines}
#ifdef A
  float a = 1.0;
#elif B > 1
  gl_FragDepth = 0.0;
#else
  float c = 1.0;
#endif`;
    expect(writesFragDepth(shader("#define A"))).toBe(false);
    expect(writesFragDepth(shader("#define B 2"))).toBe(true);
    expect(writesFragDepth(shader("#define B 1"))).toBe(false);
    expect(writesFragDepth(shader("#define A\n#define B 2"))).toBe(false);
  });

  it("skips every branch under a dead parent", () => {
    const shader = `#ifdef OUTER
#ifndef INNER
  gl_FragDepth = 0.0;
#else
  gl_FragDepth = 1.0;
#endif
#endif`;
    expect(writesFragDepth(shader)).toBe(false);
    expect(writesFragDepth(`#define OUTER\n${shader}`)).toBe(true);
  });

  it("evaluates defined(), ! and && / ||", () => {
    const shader = (defines: string) =>
      `${defines}
#if !defined(X) && (defined Y || Z == 3)
  gl_FragDepth = 0.0;
#endif`;
    expect(writesFragDepth(shader(""))).toBe(false);
    expect(writesFragDepth(shader("#define Y"))).toBe(true);
    expect(writesFragDepth(shader("#define Z 3"))).toBe(true);
    expect(writesFragDepth(shader("#define X\n#define Y"))).toBe(false);
  });

  it("honors #define and #undef in a dead branch only when live", () => {
    const shader = `#ifdef NEVER
#define WRITE
#endif
#define GONE
#undef GONE
#if defined(WRITE) || defined(GONE)
  gl_FragDepth = 0.0;
#endif`;
    expect(writesFragDepth(shader)).toBe(false);
  });

  it("expands object-like macros inside #if", () => {
    const shader = `#define COUNT LIMIT
#define LIMIT 4
#if COUNT > 3
  gl_FragDepth = 0.0;
#endif`;
    expect(writesFragDepth(shader)).toBe(true);
  });
});
