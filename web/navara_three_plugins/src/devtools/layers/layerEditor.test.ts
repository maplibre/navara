import { describe, expect, it, vi } from "vitest";

import { MATERIAL_SCHEMA } from "../../MaterialSchemaPlugin/materialSchema";

import { MATERIAL_KEYS } from "./layerEditor";

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
