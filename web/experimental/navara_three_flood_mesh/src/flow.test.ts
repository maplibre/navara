import { DataUtils } from "three";
import { describe, expect, it } from "vitest";
import * as zarr from "zarrita";

import { writeFloodZarr, type FloodFrame } from "./convert/zarr";
import { layerSize } from "./layout";
import { loadTimeSeriesFlood, type TimeSeriesFloodSeries } from "./series";

const cell0 = { lng: 0.0005, lat: 0.0005 };
const cell1 = { lng: 0.0015, lat: 0.0005 };

/** Two frames over two cells of a row: cell 0 is wet in both, cell 1 in the last. */
const writeSeries = async (
  [first, second]: Record<string, number[]>[],
  { precision = {} as Record<string, number> } = {},
) => {
  const properties = (values: Record<string, number[]>) =>
    Object.fromEntries(
      Object.entries(values).map(([name, list]) => [
        name,
        Float32Array.from(list),
      ]),
    );
  const frames: FloodFrame[] = [
    {
      x: Int32Array.from([0]),
      y: Int32Array.from([0]),
      level: Float32Array.from([10]),
      properties: properties(first),
    },
    {
      x: Int32Array.from([0, 1]),
      y: Int32Array.from([0, 0]),
      level: Float32Array.from([11, 10.5]),
      properties: properties(second),
    },
  ];
  const store = new Map<string, Uint8Array>();
  const info = await writeFloodZarr(store, {
    grid: { lngStep: 0.001, latStep: 0.001, lngOffset: 0, latOffset: 0 },
    times: Float64Array.from([0, 3600]),
    frames,
    attributes: {},
    precision,
  });
  return { store, info };
};

/** The flow at a cell in layer `k`, the layer after the frames the fastest. */
const flowAt = (
  { grid, nodes, flow }: TimeSeriesFloodSeries,
  { lng, lat }: { lng: number; lat: number },
  k: number,
) => {
  const x = Math.round((lng - grid.lng0) / grid.lngStep);
  const y = Math.round((lat - grid.lat0) / grid.latStep);
  const n = nodes.indexOf(y * grid.width + x);
  const texel = (k * layerSize(nodes.length) + n) * 2;
  return [
    DataUtils.fromHalfFloat(flow?.[texel] ?? NaN),
    DataUtils.fromHalfFloat(flow?.[texel + 1] ?? NaN),
  ];
};

const FLOW = [
  { flow_east: [3], flow_north: [4] },
  { flow_east: [0, -6], flow_north: [1, -8] },
];

describe("the flow of a series", () => {
  it("is named by the group and not offered as a property", async () => {
    const { store, info } = await writeSeries(FLOW, {
      precision: { flow_east: 0.01, flow_north: 0.01 },
    });
    const group = await zarr.open.v3(zarr.root(store), { kind: "group" });
    expect(group.attrs.flow).toEqual(["flow_east", "flow_north"]);

    const series = await loadTimeSeriesFlood({ store });
    expect(series.properties.flow_east).toBeUndefined();
    expect(series.properties.flow_north).toBeUndefined();
    expect(info.textureBytes.flow).toBe(series.flow?.byteLength);
    expect(Object.keys(info.textureBytes.properties)).toEqual([]);
  });

  it("holds each frame, continued past the shoreline, then the fastest", async () => {
    const { store } = await writeSeries(FLOW);
    const series = await loadTimeSeriesFlood({ store });
    expect(flowAt(series, cell0, 0)).toEqual([3, 4]);
    expect(flowAt(series, cell0, 1)).toEqual([0, 1]);
    expect(flowAt(series, cell1, 1)).toEqual([-6, -8]);
    // Cell 1 is dry in the first frame.
    expect(flowAt(series, cell1, 0)).toEqual([3, 4]);
    expect(flowAt(series, cell0, 2)).toEqual([3, 4]);
    expect(flowAt(series, cell1, 2)).toEqual([-6, -8]);
  });

  it("takes a cell's flow only with both components", async () => {
    const { store } = await writeSeries([
      { flow_east: [3], flow_north: [4] },
      { flow_east: [0, -6], flow_north: [1, NaN] },
    ]);
    const series = await loadTimeSeriesFlood({ store });
    // Cell 1 takes its neighbor's flow, not its own east with another's north.
    expect(flowAt(series, cell1, 1)).toEqual([0, 1]);
    expect(series.properties.speed.max).toBe(5);
  });

  it("is absent when no cell has both components", async () => {
    const { store } = await writeSeries([
      { flow_east: [3], flow_north: [NaN] },
      { flow_east: [0, -6], flow_north: [NaN, NaN] },
    ]);
    const series = await loadTimeSeriesFlood({ store });
    expect(series.flow).toBeUndefined();
    expect(series.properties.speed).toBeUndefined();
  });

  it("derives the speed, unless the store has one", async () => {
    const { store } = await writeSeries(FLOW);
    const { properties } = await loadTimeSeriesFlood({ store });
    expect(properties.speed).toMatchObject({
      min: 1,
      max: 10,
      units: "m/s",
      label: "Flow speed",
    });

    const stored = await writeSeries([
      { ...FLOW[0], speed: [0.5] },
      { ...FLOW[1], speed: [0.5, 0.75] },
    ]);
    const series = await loadTimeSeriesFlood({ store: stored.store });
    expect(series.properties.speed.max).toBe(0.75);
  });

  it("reads a component that never changes, stored without time", async () => {
    const { store } = await writeSeries([
      { flow_east: [3], flow_north: [2] },
      { flow_east: [1, 5], flow_north: [2, 2] },
    ]);
    const array = await zarr.open.v3(zarr.root(store).resolve("flow_north"), {
      kind: "array",
    });
    expect(array.shape.length).toBe(2);
    const series = await loadTimeSeriesFlood({ store });
    expect(flowAt(series, cell0, 0)).toEqual([3, 2]);
    expect(flowAt(series, cell0, 1)).toEqual([1, 2]);
  });

  it("takes other arrays by name, and is absent without any", async () => {
    const { store, info } = await writeSeries([
      { u: [3], v: [4] },
      { u: [0, -6], v: [1, -8] },
    ]);
    expect(info.textureBytes.flow).toBeUndefined();
    const plain = await loadTimeSeriesFlood({ store });
    expect(plain.flow).toBeUndefined();
    expect(plain.properties.u).toBeDefined();

    const series = await loadTimeSeriesFlood({
      store,
      variables: { flow: ["u", "v"], properties: [] },
    });
    expect(flowAt(series, cell0, 0)).toEqual([3, 4]);
    expect(series.properties.u).toBeUndefined();
  });

  it("rejects an array not shaped like the water level", async () => {
    const { store } = await writeSeries(FLOW);
    await expect(
      loadTimeSeriesFlood({
        store,
        variables: { flow: ["lat", "lon"] },
      }),
    ).rejects.toThrow("lat must be shaped");
  });
});
