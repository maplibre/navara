import { describe, expect, it } from "vitest";

import { PropertyCollector, unwrapCzmlProperties } from "./properties";

describe("PropertyCollector", () => {
  it("takes the named properties, parsing strings when asked", () => {
    const collector = new PropertyCollector(["depth", "speed"], true);
    expect(collector.collect({ depth: "1.5", speed: "", other: "x" })).toEqual({
      depth: 1.5,
      speed: NaN,
    });
    expect(collector.names).toEqual(["depth", "speed"]);
    expect(collector.written).toEqual(["depth"]);
  });

  it("derives properties with a callback and drops what is not a number", () => {
    const collector = new PropertyCollector((p) => ({
      rank: p.rank,
      twice: Number(p.depth) * 2,
    }));
    expect(collector.collect({ rank: 2, depth: 1 })).toEqual({
      rank: 2,
      twice: 2,
    });
    expect(collector.collect({ rank: "high", depth: 3 })).toEqual({
      rank: NaN,
      twice: 6,
    });
    const warnings: string[] = [];
    collector.report((m) => warnings.push(m));
    expect(warnings).toEqual([
      'Property "rank": 1 value(s) are not numbers, such as "high"; they are treated as missing.',
    ]);
  });

  it("warns about a property never numeric", () => {
    const collector = new PropertyCollector(["name"]);
    collector.collect({ name: "a" });
    const warnings: string[] = [];
    collector.report((m) => warnings.push(m));
    expect(collector.written).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("is not written");
  });
});

describe("unwrapCzmlProperties", () => {
  it("unwraps constant values and leaves the rest", () => {
    expect(
      unwrapCzmlProperties({
        a: 1,
        b: { number: 2 },
        c: { string: "s" },
        d: { epoch: "2024-01-01T00:00:00Z", number: [0, 1] },
      }),
    ).toEqual({
      a: 1,
      b: 2,
      c: "s",
      d: [0, 1],
    });
    expect(unwrapCzmlProperties(undefined)).toEqual({});
  });
});
