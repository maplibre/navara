// @vitest-environment node
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MATERIAL_SCHEMA } from "./materialSchema.generated";

const field = (key: string, name: string) =>
  MATERIAL_SCHEMA[key]?.find((f) => f.name === name);

describe("MATERIAL_SCHEMA", () => {
  it("is up to date with the Rust materials", () => {
    const script = fileURLToPath(
      new URL("../../scripts/generate-material-schema.mjs", import.meta.url),
    );
    expect(() =>
      execFileSync("node", [script, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("reads kinds, defaults and enum options from the engine", () => {
    expect(field("polygon", "wireframe")).toMatchObject({
      kind: "boolean",
      default: false,
    });
    expect(field("polygon", "color")).toMatchObject({
      kind: "color",
      default: 0xffffff,
    });
    expect(field("text", "anchor")?.options).toContain("bottom-left");
    expect(field("point", "geometryTypes")).toMatchObject({
      kind: "enumList",
      default: ["point"],
    });
    expect(field("terrain", "waterMaskColor")?.kind).toBe("color");
  });
});
