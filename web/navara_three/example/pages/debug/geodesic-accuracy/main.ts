// Shows, from a few meters above, where `EllipsoidGeodesic.interpolateDistance`
// lands (blue) next to GeographicLib's point at the same distance (orange).
// ref: https://geographiclib.sourceforge.io/Python/
import ThreeView, {
  Color,
  EllipsoidGeodesic,
  geodeticToVector3,
  type MeshHandle,
} from "@navaramap/three";
import type { SphereMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Pane } from "tweakpane";

import { TILE_DATASETS } from "../../../helpers/constants";

type LatLng = [lat: number, lng: number];
type Case = { start: LatLng; distance: number; mid: LatLng; end: LatLng };

// GeographicLib 2.1 `Geodesic.WGS84.Direct` at 1/2 and 1 of the distance.
const CASES: Record<string, Case> = {
  meridian: {
    start: [0, 0],
    distance: 9_500_000,
    mid: [-42.88550095915056, 0],
    end: [-85.50579068305177, 0],
  },
  equator: {
    start: [0, 0],
    distance: 5_000_000,
    mid: [0, 22.457882102988037],
    end: [0, 44.915764205976075],
  },
  "tokyo-sf": {
    start: [35.681, 139.767],
    distance: 8_284_545.286908689,
    mid: [48.66622042752116, -172.21872161140269],
    end: [37.77490000000001, -122.4194],
  },
  "paris-1km": {
    start: [48.8566, 2.3522],
    distance: 1000,
    mid: [48.860190688252764, 2.3563008772363],
    end: [48.86378122838547, 2.360402341172884],
  },
  "near-pole": {
    start: [80, -30],
    distance: 3_000_000,
    mid: [86.02577321360971, 114.41553757131211],
    end: [72.90098296867136, 134.51988073246181],
  },
  southern: {
    start: [-33.86, 151.21],
    distance: 12_000_000,
    mid: [-33.915262637825556, 85.10324721584904],
    end: [-5.6360432623899985, 35.34557606796527],
  },
};

type Point = "mid" | "end";

const query = new URLSearchParams(location.search);
const params = {
  case: query.get("case") ?? "meridian",
  point: (query.get("point") ?? "end") as Point,
  gap: 0,
};

const view = new ThreeView<DefaultDescriptions>({});
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLight({ ambient: { intensity: 1 } });
const basemap = view.addSource({
  type: "raster-tile",
  url: TILE_DATASETS.openstreetmap.url,
  maxZoom: 19,
});
view.addLayer({ type: "raster", source: basemap });

const geodetic = ([lat, lng]: LatLng) => ({ lat, lng, height: 0 });

/** Where `interpolateDistance` lands for the case's point. */
const interpolate = (c: Case, point: Point) => {
  const geodesic = new EllipsoidGeodesic(geodetic(c.start), geodetic(c.end));
  const p = geodesic.interpolateDistance(
    point === "mid" ? c.distance / 2 : c.distance,
  );
  geodesic.dispose();
  return [p.lat, p.lng] as LatLng;
};

const gap = (a: LatLng, b: LatLng) => {
  const p = geodeticToVector3(geodetic(a));
  const q = geodeticToVector3(geodetic(b));
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
};

const MARKER_RADIUS = 0.15;
const marker = ([lat, lng]: LatLng, color: string) =>
  view.addMesh<SphereMeshDesc>({
    sphere: {
      radius: MARKER_RADIUS,
      color: new Color().setStyle(color),
      emissiveColor: new Color().setStyle(color),
      emissiveIntensity: 0.5,
    },
    geodetic: { lat, lng, height: MARKER_RADIUS },
  });

let markers: MeshHandle<SphereMeshDesc>[] = [];

const show = () => {
  for (const m of markers) m.delete();
  const c = CASES[params.case];
  const reference = c[params.point];
  const actual = interpolate(c, params.point);
  markers = [marker(reference, "#ff6b2c"), marker(actual, "#0091ff")];
  params.gap = gap(reference, actual);
  view.setCamera({
    lat: reference[0],
    lng: reference[1],
    height: 6,
    heading: 0,
    pitch: -90,
    roll: 0,
  });
};

show();

const pane = new Pane({ title: "Geodesic accuracy vs GeographicLib" });
pane
  .addBinding(params, "case", {
    options: Object.fromEntries(Object.keys(CASES).map((k) => [k, k])),
  })
  .on("change", show);
pane
  .addBinding(params, "point", { options: { mid: "mid", end: "end" } })
  .on("change", show);
pane.addBinding(params, "gap", {
  readonly: true,
  label: "gap (m)",
  format: (v) => v.toFixed(4),
});
const gaps = pane.addFolder({ title: "Gap at mid / end (m)" });
for (const [name, c] of Object.entries(CASES)) {
  const [mid, end] = (["mid", "end"] as const).map((point) =>
    gap(c[point], interpolate(c, point)).toFixed(4),
  );
  gaps.addBinding({ [name]: `${mid} / ${end}` }, name, { readonly: true });
}
pane.addBinding({ marker: `${MARKER_RADIUS * 2} m wide` }, "marker", {
  readonly: true,
});

view.attribution?.add([TILE_DATASETS.openstreetmap]);
