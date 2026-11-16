// @vitest-environment node
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MATERIAL_SCHEMA, materialField } from "./index";

describe("MATERIAL_SCHEMA", () => {
  it("is up to date with the engine sources", () => {
    const script = fileURLToPath(
      new URL("../scripts/generate-material-schema.mjs", import.meta.url),
    );
    expect(() =>
      execFileSync("node", [script, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("reads each layer type's materials from the layer descriptions", () => {
    expect(MATERIAL_SCHEMA.layers.vector).toEqual([
      "point",
      "billboard",
      "text",
      "polyline",
      "polygon",
    ]);
    expect(MATERIAL_SCHEMA.layers["3d-tiles"]).toEqual(["model"]);
  });

  it("reads kinds, defaults and enum options from the engine", () => {
    expect(materialField("polygon", "wireframe")).toMatchObject({
      kind: "boolean",
      default: false,
    });
    expect(materialField("polygon", "color")).toMatchObject({
      kind: "color",
      default: 0xffffff,
    });
    expect(materialField("text", "anchor")?.options).toContain("bottom-left");
    expect(materialField("point", "geometryTypes")).toMatchObject({
      kind: "enumList",
      default: ["point"],
    });
    expect(materialField("terrain", "waterMaskColor")?.kind).toBe("color");
  });

  it("marks when each field applies", () => {
    expect(materialField("polygon", "color")?.applies).toBe("live");
    expect(materialField("polygon", "outlineShow")).toMatchObject({
      applies: "reload",
      note: "Applies at once when the layer was added with an outline.",
    });
    expect(materialField("text", "lang")?.applies).toBe("never");
  });

  it("names the package version it was built with", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(MATERIAL_SCHEMA.version).toBe(pkg.version);
  });

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(MATERIAL_SCHEMA))).toEqual(
      MATERIAL_SCHEMA,
    );
  });
});
