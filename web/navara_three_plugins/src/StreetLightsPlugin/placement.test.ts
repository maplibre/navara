import type { Feature, Point, Position } from "geojson";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  buildTraffic,
  lampsAlongLine,
  mulberry32,
  tileSeed,
  tileLights,
  type LampProperties,
} from "./placement";
import { ROADS, type Oneway } from "./roads";
import type { Road, RoadNetwork } from "./tiles";

const METERS_PER_DEGREE = 111320;

/** An east-west line on the equator, `meters` long. */
const eastLine = (meters: number): Position[] => [
  [0, 0],
  [meters / METERS_PER_DEGREE, 0],
];

describe("random sequences", () => {
  it("repeat per seed and stay inside [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(990);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });

  it("gives every tile and stream its own seed", () => {
    const tile = { x: 14552, y: 6452 };
    expect(tileSeed(7, tile, 0)).toBe(tileSeed(7, tile, 0));
    expect(tileSeed(7, tile, 0)).not.toBe(tileSeed(7, tile, 1));
    expect(tileSeed(7, tile, 0)).not.toBe(
      tileSeed(7, { x: 14553, y: 6452 }, 0),
    );
    expect(tileSeed(7, tile, 0)).not.toBe(tileSeed(8, tile, 0));
  });
});

describe("lampsAlongLine", () => {
  it("spaces lamps along the line, alternating sides", () => {
    const out: Feature<Point, LampProperties>[] = [];
    lampsAlongLine(eastLine(100), 30, 5, () => 0, out);

    const along = out.map((f) => f.geometry.coordinates[0] * METERS_PER_DEGREE);
    expect(along.map((m) => Math.round(m))).toEqual([0, 30, 60, 90]);
    const sides = out.map((f) => Math.sign(f.geometry.coordinates[1]));
    expect(sides).toEqual([-1, 1, -1, 1]);
    expect(out.every((f) => f.properties.kind === "lamp")).toBe(true);
  });

  it("starts at a random carry and draws warm lamps from the same source", () => {
    const out: Feature<Point, LampProperties>[] = [];
    lampsAlongLine(eastLine(100), 30, 5, () => 0.9, out);

    const along = out.map((f) => f.geometry.coordinates[0] * METERS_PER_DEGREE);
    expect(along.map((m) => Math.round(m))).toEqual([27, 57, 87]);
    expect(out.every((f) => f.properties.kind === "warm")).toBe(true);
  });
});

describe("tileLights", () => {
  const network: RoadNetwork = {
    roads: [{ style: ROADS.primary, oneway: 0, line: eastLine(100) }],
    roofs: [{ lng: 1, lat: 2, height: 120 }],
  };

  it("adds a beacon above every roof and the same lamps every time", () => {
    const lights = tileLights(network, mulberry32(7));
    expect(lights.beacons.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [1, 2] },
        properties: { height: 122 },
      },
    ]);
    expect(lights.lamps.features.length).toBeGreaterThan(0);
    expect(tileLights(network, mulberry32(7))).toEqual(lights);
    expect(tileLights(network, mulberry32(8))).not.toEqual(lights);
  });
});

describe("buildTraffic", () => {
  const project = ({
    lng,
    lat,
    height,
  }: {
    lng: number;
    lat: number;
    height: number;
  }) => new Vector3(lng * METERS_PER_DEGREE, lat * METERS_PER_DEGREE, height);
  const ORIGIN = new Vector3();
  const segment = (oneway: Oneway, meters = 350): Road => ({
    style: ROADS.primary,
    oneway,
    line: eastLine(meters),
  });
  /** Sign of each car's travel along the x axis. */
  const headings = (data: ReturnType<typeof buildTraffic>) =>
    Array.from(data.phase, (_, i) =>
      Math.sign(data.end[i * 3] - data.start[i * 3]),
    );

  it("places cars both ways on a two-way road at the class speed", () => {
    const data = buildTraffic([segment(0)], ORIGIN, project, mulberry32(11));
    const cars = data.phase.length;
    expect(cars).toBeGreaterThan(0);
    expect(data.start.length).toBe(cars * 3);
    expect(data.end.length).toBe(cars * 3);
    expect(data.speed.length).toBe(cars);
    expect(headings(data)).toContain(1);
    expect(headings(data)).toContain(-1);
    for (const speed of data.speed) {
      expect(speed).toBeGreaterThanOrEqual(12 * 0.7);
      expect(speed).toBeLessThanOrEqual(12 * 1.3);
    }
  });

  it("keeps a one-way road to its direction", () => {
    expect(
      headings(buildTraffic([segment(1)], ORIGIN, project, mulberry32(11))),
    ).not.toContain(-1);
    expect(
      headings(buildTraffic([segment(-1)], ORIGIN, project, mulberry32(11))),
    ).not.toContain(1);
  });

  it("skips segments under a meter", () => {
    expect(
      buildTraffic([segment(0, 0.5)], ORIGIN, project, mulberry32(11)).phase
        .length,
    ).toBe(0);
  });

  it("stores the positions relative to the origin", () => {
    const origin = new Vector3(5, 7, 0);
    const absolute = buildTraffic(
      [segment(1)],
      ORIGIN,
      project,
      mulberry32(11),
    );
    const relative = buildTraffic(
      [segment(1)],
      origin,
      project,
      mulberry32(11),
    );
    expect(relative.start[0]).toBeCloseTo(absolute.start[0] - 5);
    expect(relative.start[1]).toBeCloseTo(absolute.start[1] - 7);
  });
});
