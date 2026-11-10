import { describe, expect, it } from "vitest";

import {
  ROADS,
  isRoadClass,
  pickProperties,
  readRoadFeature,
  type StreetLightsRoads,
} from "./roads";

const schema: StreetLightsRoads = {
  sourceLayers: ["roads"],
  filterFeatureProperties: ["kind"],
  evaluateFeature: ({ kind }) =>
    kind === "main" ? { roadClass: "primary", oneway: 1 } : undefined,
};

describe("readRoadFeature", () => {
  it("maps the reader's class to its style and defaults the direction", () => {
    expect(readRoadFeature(schema, { kind: "main" })).toEqual({
      style: ROADS.primary,
      oneway: 1,
    });
    expect(
      readRoadFeature(
        { ...schema, evaluateFeature: () => ({ roadClass: "minor" }) },
        { kind: "main" },
      ),
    ).toEqual({ style: ROADS.minor, oneway: 0 });
    expect(readRoadFeature(schema, { kind: "path" })).toBeUndefined();
  });
});

describe("isRoadClass", () => {
  it("accepts the classes with a style and nothing else", () => {
    expect(isRoadClass("primary")).toBe(true);
    expect(isRoadClass("rail")).toBe(false);
    expect(isRoadClass("constructor")).toBe(false);
    expect(isRoadClass(1)).toBe(false);
  });
});

describe("pickProperties", () => {
  it("keeps the named properties only, as undefined when missing, own keys only", () => {
    expect(
      pickProperties({ kind: "main", name: "x" }, ["kind", "oneway"]),
    ).toStrictEqual({ kind: "main", oneway: undefined });
    expect(pickProperties({}, ["constructor"])).toStrictEqual({
      constructor: undefined,
    });
  });
});
