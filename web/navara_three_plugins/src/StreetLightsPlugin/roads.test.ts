import { describe, expect, it } from "vitest";

import { openMapTilesBuilding, openMapTilesRoad } from "./roads";

describe("OpenMapTiles readers", () => {
  it("map class and oneway to a road class, and render_height to a beacon", () => {
    expect(openMapTilesRoad({ class: "primary", oneway: -1 })).toEqual({
      roadClass: "primary",
      oneway: -1,
    });
    expect(openMapTilesRoad({ class: "primary" })).toEqual({
      roadClass: "primary",
      oneway: 0,
    });
    expect(openMapTilesRoad({ class: "rail" })).toBeUndefined();
    expect(openMapTilesRoad({ class: "constructor" })).toBeUndefined();
    expect(openMapTilesRoad({})).toBeUndefined();
    expect(openMapTilesBuilding({ render_height: 120 })).toBe(120);
    expect(openMapTilesBuilding({ render_height: 50 })).toBeUndefined();
    expect(openMapTilesBuilding({})).toBeUndefined();
  });
});
