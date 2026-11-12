import { afterEach, describe, expect, it } from "vitest";

import { NetworkMeter, sourceUrlMatcher } from "./networkMeter";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch that answers every request with a 1 KiB body. */
const stubFetch = (() =>
  Promise.resolve(
    new Response("x", { headers: { "content-length": "1024" } }),
  )) as unknown as typeof fetch;

describe("sourceUrlMatcher", () => {
  it("matches a tile template segment by segment", () => {
    const match = sourceUrlMatcher("https://tile.example.org/{z}/{x}/{y}.png");
    expect(match("https://tile.example.org/12/3637/1612.png")).toBeGreaterThan(
      0,
    );
    expect(match("https://tile.example.org/12/3637.png")).toBe(0);
    expect(match("https://other.example.org/12/3637/1612.png")).toBe(0);
  });

  it("matches a plain URL and everything under its directory", () => {
    const match = sourceUrlMatcher(
      "https://cdn.example.org/tiles/tileset.json",
    );
    expect(match("https://cdn.example.org/tiles/tileset.json")).toBeGreaterThan(
      0,
    );
    expect(
      match("https://cdn.example.org/tiles/a/b/content.b3dm"),
    ).toBeGreaterThan(0);
    expect(match("https://cdn.example.org/other/tileset.json")).toBe(0);
  });

  it("scores the URL itself above its directory", () => {
    const match = sourceUrlMatcher("https://cdn.example.org/d/x.pmtiles");
    expect(match("https://cdn.example.org/d/x.pmtiles")).toBeGreaterThan(
      match("https://cdn.example.org/d/y.pmtiles"),
    );
  });

  it("does not claim a host root", () => {
    const match = sourceUrlMatcher("https://cdn.example.org/style.json");
    expect(match("https://cdn.example.org/style.json")).toBeGreaterThan(0);
    expect(match("https://cdn.example.org/fonts/a.pbf")).toBe(0);
  });
});

describe("NetworkMeter", () => {
  it("wraps and restores fetch, counting requests per source", async () => {
    globalThis.fetch = stubFetch;
    const meter = new NetworkMeter();
    meter.setMatchers([
      { id: "tiles", score: sourceUrlMatcher("https://t.example/{z}/{x}/{y}") },
    ]);
    meter.enable();
    expect(globalThis.fetch).not.toBe(stubFetch);
    await fetch("https://t.example/1/2/3");
    await fetch("https://elsewhere.example/file");
    meter.disable();
    expect(globalThis.fetch).toBe(stubFetch);

    const perSource = meter.perSource();
    expect(perSource.map((s) => [s.sourceId, s.requests, s.bytes])).toEqual([
      ["tiles", 1, 1024],
      ["(other)", 1, 1024],
    ]);
    expect(meter.rates().totalRequests).toBe(2);
    expect(meter.rates().inFlight).toBe(0);
  });

  it("gives a request to the closest source, not the first", async () => {
    globalThis.fetch = stubFetch;
    const meter = new NetworkMeter();
    meter.setMatchers([
      { id: "x", score: sourceUrlMatcher("https://cdn.example/d/x.pmtiles") },
      { id: "y", score: sourceUrlMatcher("https://cdn.example/d/y.pmtiles") },
    ]);
    meter.enable();
    await fetch("https://cdn.example/d/y.pmtiles");
    meter.disable();
    expect(meter.entries.map((e) => e.sourceId)).toEqual(["y"]);
  });

  it("leaves a fetch wrapper installed after it in place", async () => {
    globalThis.fetch = stubFetch;
    const meter = new NetworkMeter();
    meter.enable();
    const meterFetch = globalThis.fetch;
    let outerCalls = 0;
    const outer = ((input: RequestInfo | URL, init?: RequestInit) => {
      outerCalls++;
      return meterFetch(input, init);
    }) as typeof fetch;
    globalThis.fetch = outer;

    meter.disable();
    expect(globalThis.fetch).toBe(outer);
    await fetch("https://a.example/1");
    expect(outerCalls).toBe(1);
    expect(meter.entries).toHaveLength(0);

    // Re-enabling reuses the buried wrapper instead of stacking another.
    meter.enable();
    expect(globalThis.fetch).toBe(outer);
    await fetch("https://a.example/2");
    expect(meter.entries).toHaveLength(1);
    meter.disable();
  });
});
