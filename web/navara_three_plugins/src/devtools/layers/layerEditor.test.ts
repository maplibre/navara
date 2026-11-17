import { MATERIAL_SCHEMA } from "@navaramap/material-schema";
import { describe, expect, it, vi } from "vitest";

import { COMMON, MATERIAL_KEYS, RANGES } from "./layerEditor";

// Importing `@navaramap/three` at runtime loads the worker pool.
/* eslint-disable @typescript-eslint/no-extraneous-class */
vi.mock("@navaramap/three", () => ({
  Color: class Color {},
  Plugin: class Plugin {},
}));
/* eslint-enable @typescript-eslint/no-extraneous-class */

describe("MATERIAL_KEYS", () => {
  it("shows polygon and polyline first, the rest in schema order", () => {
    expect(MATERIAL_KEYS.vector).toEqual([
      "polygon",
      "polyline",
      "point",
      "billboard",
      "text",
    ]);
    expect(MATERIAL_KEYS.raster).toEqual(MATERIAL_SCHEMA.layers.raster);
  });
});

describe("field lists", () => {
  const all = Object.values(MATERIAL_SCHEMA.materials).flat();

  it("name only fields of their material in COMMON", () => {
    const missing = Object.entries(COMMON).flatMap(([key, names]) =>
      names
        .filter(
          (name) =>
            !MATERIAL_SCHEMA.materials[key]?.some((f) => f.name === name),
        )
        .map((name) => `${key}.${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("give slider ranges to number fields only", () => {
    const wrong = Object.keys(RANGES).filter(
      (name) => !all.some((f) => f.name === name && f.kind === "number"),
    );
    expect(wrong).toEqual([]);
  });
});
