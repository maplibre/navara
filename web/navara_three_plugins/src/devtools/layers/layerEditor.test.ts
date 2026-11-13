import { describe, expect, it, vi } from "vitest";

import { MATERIAL_SCHEMA } from "../../MaterialSchemaPlugin/materialSchema";

import { COMMON, MATERIAL_KEYS, RANGES } from "./layerEditor";

// Importing `@navaramap/three` at runtime loads the worker pool.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
vi.mock("@navaramap/three", () => ({ Color: class Color {} }));

describe("MATERIAL_KEYS", () => {
  it("orders exactly the materials of each layer type", () => {
    const sorted = (record: Record<string, string[]>) =>
      Object.fromEntries(
        Object.entries(record).map(([type, keys]) => [type, [...keys].sort()]),
      );
    expect(sorted(MATERIAL_KEYS)).toEqual(sorted(MATERIAL_SCHEMA.layers));
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
