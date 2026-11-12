import { describe, expect, it } from "vitest";

import { sampleTimeSeriesFlood } from "../sample";
import { loadTimeSeriesFlood } from "../series";

import { Ellipsoid, VerticalDatum } from "./datum";
import { splitCsvLine } from "./input";
import { convertPolygons } from "./polygons";
import { PlaneRectangular } from "./projection";
import { convertRasters } from "./rasters";
import type { TerrainPosition } from "./terrain";

class Geoid40 extends VerticalDatum {
  readonly name = "geoid at 40 m";
  offsets(positions: TerrainPosition[]) {
    return positions.map(() => 40);
  }
}

const csv = (name: string, lines: string[]) => ({
  name,
  read: () => lines.join("\n"),
});

describe("splitCsvLine", () => {
  it("unquotes fields and keeps commas inside quotes", () => {
    expect(splitCsvLine('1,"a, b","say ""hi""",')).toEqual([
      "1",
      "a, b",
      'say "hi"',
      "",
    ]);
  });
});

describe("convertRasters from CSV", () => {
  it("reads quoted columns", async () => {
    const store = new Map<string, Uint8Array>();
    await convertRasters({
      inputs: [
        csv("flood.csv", [
          '"lng","lat","level","time"',
          '"139.0005","35.0005","10","2024-01-01T00:00:00Z"',
          '"139.0015","35.0005","11","2024-01-01T00:00:00Z"',
          '"139.0005","35.0015","12","2024-01-01T00:00:00Z"',
          '"139.0015","35.0015","13","2024-01-01T00:00:00Z"',
        ]),
      ],
      output: store,
      center: ["lng", "lat"],
      level: "level",
      time: "time",
      datum: new Ellipsoid(),
    });
    const series = await loadTimeSeriesFlood({ store });
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.0015, lat: 35.0005 }, 0)?.level,
    ).toBeCloseTo(11);
  });

  it("asks for the format an extension does not tell", async () => {
    await expect(
      convertRasters({
        inputs: [csv("flood.dat", ["lng,lat,level"])],
        output: new Map(),
        center: ["lng", "lat"],
        level: "level",
        timePattern: /(\d+)/,
      }),
    ).rejects.toThrow(/format of flood.dat: csv or netcdf/);
  });

  it("reads a blank level as a dry cell", async () => {
    const store = new Map<string, Uint8Array>();
    await convertRasters({
      inputs: [
        csv("flood.csv", [
          "lng,lat,level,time",
          "139.0005,35.0005,10,2024-01-01T00:00:00Z",
          "139.0015,35.0005,,2024-01-01T00:00:00Z",
          "139.0005,35.0015,12,2024-01-01T00:00:00Z",
          "139.0015,35.0015,13,2024-01-01T00:00:00Z",
        ]),
      ],
      output: store,
      center: ["lng", "lat"],
      level: "level",
      time: "time",
      datum: new Ellipsoid(),
    });
    const series = await loadTimeSeriesFlood({ store });
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.0015, lat: 35.0005 }, 0),
    ).toBeUndefined();
  });

  it("takes the cell size from the corners", async () => {
    // Two 0.001° cells far apart, whose centers alone suggest larger cells.
    const store = new Map<string, Uint8Array>();
    const info = await convertRasters({
      inputs: [
        csv("flood_0.csv", [
          "west,south,east,north,level",
          "139.000,35.000,139.001,35.001,10",
          "139.003,35.002,139.004,35.003,11",
        ]),
      ],
      output: store,
      corners: [
        ["west", "south"],
        ["east", "north"],
      ],
      level: "level",
      timePattern: /_(\d+)\.csv$/,
      epoch: new Date(0),
      datum: new Ellipsoid(),
    });
    expect(info.grid.lngStep).toBeCloseTo(0.001, 9);
    expect(info.grid.latStep).toBeCloseTo(0.001, 9);
    const series = await loadTimeSeriesFlood({ store });
    const at = (lng: number, lat: number) =>
      sampleTimeSeriesFlood(series, { lng, lat }, 0)?.level;
    expect(at(139.0035, 35.0025)).toBeCloseTo(11);
    // Next to a wet cell, which a grid of the centers' spacing would cover.
    expect(at(139.0015, 35.0005)).toBeUndefined();
  });

  // A 6 × 6 block of 25 m cells of plane rectangular zone 9, northing X and
  // easting Y, wet with a level rising eastward.
  const projected = () => {
    const lines = ["X,Y,level"];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        lines.push(`${12.5 + 25 * i},${12.5 + 25 * j},${10 + j}`);
      }
    }
    return csv("projected_0.csv", lines);
  };
  const options = {
    center: ["Y", "X"] as [string, string],
    level: "level",
    timePattern: /_(\d+)\.csv$/,
    epoch: new Date(0),
    datum: new Ellipsoid(),
    projection: new PlaneRectangular(9),
  };

  it("asks for a resolution for cells off a latitude/longitude grid", async () => {
    await expect(
      convertRasters({ ...options, inputs: [projected()], output: new Map() }),
    ).rejects.toThrow(/resolution/);
  });

  it("samples a projected grid at a resolution", async () => {
    const store = new Map<string, Uint8Array>();
    const info = await convertRasters({
      ...options,
      inputs: [projected()],
      output: store,
      resolution: 25,
    });
    // The block covers 150 × 150 m, about 36 cells of 25 m.
    expect(info.wetCells).toBeGreaterThan(30);
    expect(info.wetCells).toBeLessThan(50);
    const series = await loadTimeSeriesFlood({ store });
    const [lng, lat] = new PlaneRectangular(9).toGeographic(62.5, 62.5);
    expect(sampleTimeSeriesFlood(series, { lng, lat }, 0)?.level).toBeCloseTo(
      12,
    );
  });
});

describe("convertPolygons", () => {
  it("converts the heights from the datum given", async () => {
    // One 0.001° cell, wet at 10 m over the geoid for an hour.
    const ring = [
      [139, 35],
      [139.001, 35],
      [139.001, 35.001],
      [139, 35.001],
      [139, 35],
    ].flatMap(([lng, lat]) => [lng, lat, 10]);
    const czml = [
      { id: "document", version: "1.0" },
      {
        availability: "2024-01-01T00:00:00Z/2024-01-01T01:00:00Z",
        polygon: { positions: { cartographicDegrees: ring } },
      },
    ];
    const store = new Map<string, Uint8Array>();
    await convertPolygons({
      input: { name: "flood.czml", read: () => JSON.stringify(czml) },
      output: store,
      datum: new Geoid40(),
    });
    const series = await loadTimeSeriesFlood({ store });
    expect(
      sampleTimeSeriesFlood(series, { lng: 139.0005, lat: 35.0005 }, 0)?.level,
    ).toBeCloseTo(50);
  });
});
