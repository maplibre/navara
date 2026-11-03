import { describe, expect, it } from "vitest";

import { NetworkMeter, sourceUrlMatcher } from "./networkMeter";

describe("sourceUrlMatcher", () => {
  it("matches a tile template segment by segment", () => {
    const match = sourceUrlMatcher("https://tile.example.org/{z}/{x}/{y}.png");
    expect(match("https://tile.example.org/12/3637/1612.png")).toBe(true);
    expect(match("https://tile.example.org/12/3637.png")).toBe(false);
    expect(match("https://other.example.org/12/3637/1612.png")).toBe(false);
  });

  it("matches a plain URL and everything under its directory", () => {
    const match = sourceUrlMatcher(
      "https://cdn.example.org/tiles/tileset.json",
    );
    expect(match("https://cdn.example.org/tiles/tileset.json")).toBe(true);
    expect(match("https://cdn.example.org/tiles/a/b/content.b3dm")).toBe(true);
    expect(match("https://cdn.example.org/other/tileset.json")).toBe(false);
  });
});

describe("NetworkMeter", () => {
  it("wraps and restores fetch, counting requests per source", async () => {
    const original = async () =>
      new Response("x", { headers: { "content-length": "1024" } });
    globalThis.fetch = original as unknown as typeof fetch;
    const meter = new NetworkMeter();
    meter.setMatchers([
      { id: "tiles", test: sourceUrlMatcher("https://t.example/{z}/{x}/{y}") },
    ]);
    meter.enable();
    expect(globalThis.fetch).not.toBe(original);
    await fetch("https://t.example/1/2/3");
    await fetch("https://elsewhere.example/file");
    meter.disable();
    expect(globalThis.fetch).toBe(original);

    const perSource = meter.perSource();
    expect(perSource.map((s) => [s.sourceId, s.requests, s.bytes])).toEqual([
      ["tiles", 1, 1024],
      ["(other)", 1, 1024],
    ]);
    expect(meter.rates().totalRequests).toBe(2);
    expect(meter.rates().inFlight).toBe(0);
  });
});
