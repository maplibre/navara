/**
 * Converts the PLATEAU time-series flood simulation (CZML) used by the
 * `use-cases/photorealistic` example into a PMTiles archive of per-cell
 * features.
 *
 * The CZML holds one dissolved polygon per time step, so the same ground is
 * re-sent at every step. Here it is decomposed back into the simulation's
 * ~25 m grid cells: each cell becomes one MVT feature whose properties carry
 * its water-surface height (ellipsoidal, meters, rounded to 5 cm so values
 * dedupe within a tile) per step as `t0`…`tN` (omitted while the cell is
 * dry). The example then switches steps by evaluating a different property —
 * no data reload. Step start times are printed as JSON so
 * they can be copied into the example.
 *
 * Usage (needs `tippecanoe` on PATH):
 *   pnpm tsx scripts/build-flood-pmtiles.ts <input.czml> <output.pmtiles>
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Simulation grid: 1/3200° (lng) x 1/4800° (lat), ~25 m in Saitama.
const LNG_STEP = 1 / 3200;
const LAT_STEP = 1 / 4800;

type CzmlPacket = {
  availability?: string;
  polygon?: {
    positions: { cartographicDegrees: number[] };
    holes?: { cartographicDegrees: number[][] };
  };
};

type Ring = { x: number; y: number; h: number }[];

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: build-flood-pmtiles.ts <input.czml> <output.pmtiles>");
  process.exit(1);
}

const packets = JSON.parse(readFileSync(input, "utf8")) as CzmlPacket[];

// Ring vertices in grid-node units, so cell corners become integer lookups.
const toRing = (flat: number[]): Ring => {
  const ring: Ring = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    ring.push({
      x: Math.round(flat[i] / LNG_STEP),
      y: Math.round(flat[i + 1] / LAT_STEP),
      h: flat[i + 2],
    });
  }
  return ring;
};

// Cells whose center lies inside the polygon, by even-odd scanline over all
// rings (so holes are excluded naturally). Cells are keyed `x,y`.
const fillCells = (rings: Ring[], minY: number, maxY: number) => {
  const inside: string[] = [];
  for (let y = minY; y < maxY; y++) {
    const cy = y + 0.5;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a.y > cy !== b.y > cy) {
          crossings.push(((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x);
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      for (
        let x = Math.ceil(crossings[k] - 0.5);
        x + 0.5 < crossings[k + 1];
        x++
      ) {
        inside.push(`${x},${y}`);
      }
    }
  }
  return inside;
};

const steps = [
  ...new Set(
    packets.flatMap((p) =>
      p.polygon && p.availability ? [p.availability] : [],
    ),
  ),
].sort();
const stepIndex = new Map(steps.map((s, i) => [s, i]));

// cell key "x,y" -> water-surface height per step
const cells = new Map<string, (number | undefined)[]>();

for (const packet of packets) {
  if (!packet.polygon || !packet.availability) continue;
  const step = stepIndex.get(packet.availability) ?? 0;
  const rings = [
    toRing(packet.polygon.positions.cartographicDegrees),
    ...(packet.polygon.holes?.cartographicDegrees ?? [])
      .filter((r) => r.length >= 9)
      .map(toRing),
  ];

  // Heights are given only at ring vertices (grid nodes on the boundary).
  const nodeHeights = new Map<string, number>();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const { x, y, h } of ring) {
      nodeHeights.set(`${x},${y}`, h);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  // Height = mean of the cell's corners that are known.
  const local = new Map<string, number | undefined>();
  for (const key of fillCells(rings, minY, maxY)) {
    const [x, y] = key.split(",").map(Number);
    const corners = [
      nodeHeights.get(`${x},${y}`),
      nodeHeights.get(`${x + 1},${y}`),
      nodeHeights.get(`${x},${y + 1}`),
      nodeHeights.get(`${x + 1},${y + 1}`),
    ].filter((h) => h !== undefined);
    local.set(
      key,
      corners.length
        ? corners.reduce((a, b) => a + b, 0) / corners.length
        : undefined,
    );
  }

  // Interior cells touch no ring vertex: fill them from known neighbors,
  // breadth-first from the boundary inwards.
  let frontier = [...local].filter(([, h]) => h !== undefined);
  while (frontier.length) {
    const next: [string, number][] = [];
    for (const [key] of frontier) {
      const [x, y] = key.split(",").map(Number);
      for (const n of [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`,
      ]) {
        if (!local.has(n) || local.get(n) !== undefined) continue;
        const [nx, ny] = n.split(",").map(Number);
        const known = [
          local.get(`${nx - 1},${ny}`),
          local.get(`${nx + 1},${ny}`),
          local.get(`${nx},${ny - 1}`),
          local.get(`${nx},${ny + 1}`),
        ].filter((h) => h !== undefined);
        const h = known.reduce((a, b) => a + b, 0) / known.length;
        local.set(n, h);
        next.push([n, h]);
      }
    }
    frontier = next;
  }

  for (const [key, h] of local) {
    if (h === undefined) continue;
    let series = cells.get(key);
    if (!series) {
      series = new Array<number | undefined>(steps.length);
      cells.set(key, series);
    }
    series[step] = h;
  }
}

const features = [...cells].map(([key, series]) => {
  const [x, y] = key.split(",").map(Number);
  const [w, s, e, n] = [
    x * LNG_STEP,
    y * LAT_STEP,
    (x + 1) * LNG_STEP,
    (y + 1) * LAT_STEP,
  ];
  const properties: Record<string, number> = {};
  series.forEach((h, i) => {
    if (h !== undefined) properties[`t${i}`] = Math.round(h * 20) / 20;
  });
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), "flood-"));
const geojson = join(dir, "flood.geojson");
writeFileSync(geojson, JSON.stringify({ type: "FeatureCollection", features }));
execFileSync(
  "tippecanoe",
  [
    "-o",
    output,
    "--force",
    "--layer=flood",
    "--minimum-zoom=11",
    "--maximum-zoom=14",
    // Every cell must survive at every zoom: the time series is per feature.
    "--no-feature-limit",
    "--no-tile-size-limit",
    "--no-tiny-polygon-reduction",
    "--no-simplification-of-shared-nodes",
    "--no-line-simplification",
    geojson,
  ],
  { stdio: "inherit" },
);
rmSync(dir, { recursive: true });

console.error(`${features.length} cells, ${steps.length} steps`);
console.log(
  JSON.stringify(steps.map((s) => s.split("/")[0].replace(".000Z", "Z"))),
);
