import { describe, expect, it } from "vitest";

import { sampleTimeSeriesFlood } from "../sample";
import { loadTimeSeriesFlood } from "../series";

import { Ellipsoid } from "./datum";
import { convertMesh } from "./mesh";

const csv = (name: string, lines: string[]) => ({
  name,
  read: () => lines.join("\n"),
});

// A 0.002° square, about 180 × 220 m, as four nodes and two triangles.
const nodes = csv("nodes.csv", [
  "id,lng,lat,ground",
  "a,139.000,35.000,0",
  "b,139.002,35.000,0",
  "c,139.002,35.002,0",
  "d,139.000,35.002,0",
]);
const faces = csv("faces.csv", ["id,n1,n2,n3", "t1,a,b,c", "t2,a,c,d"]);
const options = {
  output: new Map<string, Uint8Array>(),
  position: ["lng", "lat"] as [string, string],
  resolution: 10,
  timePattern: /_(\d+)\.csv$/,
  epoch: new Date(0),
  datum: new Ellipsoid(),
};

const levelAt = async (
  store: Map<string, Uint8Array>,
  lng: number,
  lat: number,
) =>
  sampleTimeSeriesFlood(await loadTimeSeriesFlood({ store }), { lng, lat }, 0)
    ?.level;

describe("convertMesh", () => {
  it("interpolates the node levels over the faces", async () => {
    const store = new Map<string, Uint8Array>();
    const info = await convertMesh({
      ...options,
      output: store,
      nodes,
      faces,
      inputs: [
        csv("level_0.csv", ["id,level", "a,10", "b,12", "c,13", "d,11"]),
      ],
      level: "level",
    });
    expect(info.nodeCount).toBe(4);
    expect(info.triangleCount).toBe(2);
    // The level is a plane over the square.
    expect(await levelAt(store, 139.001, 35.001)).toBeCloseTo(11.5, 1);
    expect(await levelAt(store, 139.0015, 35.0005)).toBeCloseTo(11.75, 1);
  });

  it("thins the water out towards dry nodes", async () => {
    const store = new Map<string, Uint8Array>();
    await convertMesh({
      ...options,
      output: store,
      nodes,
      faces,
      // The ground comes from the nodes; the east nodes are dry.
      inputs: [csv("depth_0.csv", ["id,depth", "a,1", "d,1"])],
      ground: "ground",
      depth: "depth",
      minDepth: 0.1,
    });
    expect(await levelAt(store, 139.0005, 35.001)).toBeCloseTo(0.75, 1);
    expect(await levelAt(store, 139.0015, 35.001)).toBeCloseTo(0.25, 1);
    // Shallower than 0.1 m within about 18 m of the dry nodes.
    expect(await levelAt(store, 139.00199, 35.001)).toBeUndefined();
  });

  it("takes values on the faces over each face", async () => {
    const store = new Map<string, Uint8Array>();
    await convertMesh({
      ...options,
      output: store,
      nodes,
      faces,
      valuesOn: "faces",
      inputs: [csv("level_0.csv", ["id,level", "t1,10", "t2,20"])],
      level: "level",
    });
    // t1 is south-east of the diagonal, t2 north-west.
    expect(await levelAt(store, 139.0015, 35.0005)).toBeCloseTo(10, 1);
    expect(await levelAt(store, 139.0005, 35.0015)).toBeCloseTo(20, 1);
  });

  it("triangulates bare points, dropping the long edges", async () => {
    // Two clusters of points 0.01° (about 900 m) apart, each its own
    // positions in the value rows.
    const lines = ["lng,lat,level"];
    for (const lng0 of [139, 139.01]) {
      for (let i = 0; i <= 2; i++) {
        for (let j = 0; j <= 2; j++) {
          lines.push(`${lng0 + i * 0.001},${35 + j * 0.001},5`);
        }
      }
    }
    const store = new Map<string, Uint8Array>();
    const info = await convertMesh({
      ...options,
      output: store,
      inputs: [csv("points_0.csv", lines)],
      level: "level",
      maxEdge: 200,
    });
    expect(info.nodeCount).toBe(18);
    expect(info.droppedTriangles).toBeGreaterThan(0);
    expect(await levelAt(store, 139.001, 35.001)).toBeCloseTo(5, 1);
    expect(await levelAt(store, 139.011, 35.001)).toBeCloseTo(5, 1);
    // Between the clusters, no triangle is kept.
    expect(await levelAt(store, 139.006, 35.001)).toBeUndefined();
  });

  it("refuses a resolution that is not a positive length", async () => {
    for (const resolution of [0, undefined]) {
      await expect(
        convertMesh({
          ...options,
          resolution: resolution as number,
          nodes,
          faces,
          inputs: [
            csv("level_0.csv", ["id,level", "a,10", "b,12", "c,13", "d,11"]),
          ],
          level: "level",
        }),
      ).rejects.toThrow(/resolution must be a positive number/);
    }
  });

  it("asks for the projection of positions not in degrees", async () => {
    await expect(
      convertMesh({
        ...options,
        nodes: csv("nodes.csv", [
          "id,lng,lat",
          "a,94245,79845",
          "b,94255,79845",
          "c,94255,79855",
        ]),
        faces: csv("faces.csv", ["id,n1,n2,n3", "t1,a,b,c"]),
        inputs: [csv("level_0.csv", ["id,level", "a,1", "b,1", "c,1"])],
        level: "level",
      }),
    ).rejects.toThrow(/not in degrees; give the projection/);
  });

  it("asks for the maxEdge without faces", async () => {
    await expect(
      convertMesh({
        ...options,
        inputs: [csv("points_0.csv", ["lng,lat,level", "139,35,1"])],
        level: "level",
      }),
    ).rejects.toThrow(/maxEdge/);
  });
});
