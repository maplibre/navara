import ThreeView, {
  Color,
  JAPAN_GSI_ELEVATION_DECODER,
  vector3ToGeodetic,
  type MapPointerEvent,
  type MeshHandle,
  type PickedFeature,
} from "@navaramap/three";
import type { SphereMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { Vector3 } from "three";
import { Pane } from "tweakpane";

import {
  TERRAIN_DATASETS,
  TILE_DATASETS,
  TILES_3D_DATASETS,
} from "../../../helpers/constants";

/**
 * The pointer event the feature events pass as their second argument, on
 * PLATEAU buildings. A click drops a sphere at
 * `view.pickDepthPosition(event.clientX, event.clientY)`, called in the
 * listener, and a red ring at `clientX/clientY`; the pane shows the clicked
 * and the hovered feature with `event.map`, and the drawn point of the click.
 *
 * What to look for: the sphere sits on the clicked roof, inside the ring;
 * `map` is on the ellipsoid (height about 0) under it. Over the sky the event
 * has no `map` and nothing is drawn, so no sphere.
 */

const view = new ThreeView<DefaultDescriptions>({ debug: true });
view.addPlugin(new DefaultPlugin());
await view.init();

view.addLight({ ambient: { intensity: 1 } });
view.addLight({ sun: { intensity: 3 } });

view.setCamera({
  lng: 139.7575,
  lat: 35.6715,
  height: 550,
  heading: 30,
  pitch: -20,
  roll: 0,
});

const dem = view.addSource({
  type: "raster-dem",
  url: TERRAIN_DATASETS.gsi.url,
  elevationDecoder: JAPAN_GSI_ELEVATION_DECODER(),
  maxZoom: 15,
  minZoom: 5,
});
view.addLayer({ type: "terrain", source: dem });
view.addLayer({
  type: "raster",
  source: view.addSource({
    type: "raster-tile",
    url: TILE_DATASETS.openstreetmap.url,
    maxZoom: 19,
  }),
});
view.addLayer({
  type: "3d-tiles",
  source: view.addSource({
    type: "3d-tiles",
    url: TILES_3D_DATASETS.plateauChiyoda.url,
  }),
  model: { color: new Color().setHex(0xffffff) },
});

const ring = document.createElement("div");
ring.style.cssText =
  "position: fixed; width: 24px; height: 24px; margin: -14px 0 0 -14px;" +
  "border: 2px solid #ff3b30; border-radius: 50%; pointer-events: none;" +
  "display: none; z-index: 10;";
document.body.appendChild(ring);

/** `lng, lat, height` of an ECEF position, or "undefined". */
const formatPosition = (p: { x: number; y: number; z: number } | undefined) => {
  if (!p) return "undefined";
  const { lng, lat, height } = vector3ToGeodetic(new Vector3(p.x, p.y, p.z));
  return `${lng.toFixed(6)}, ${lat.toFixed(6)}, ${height.toFixed(2)}`;
};

const featureName = (info: PickedFeature | null | undefined) =>
  info
    ? String(info.properties?.gml_id ?? info.featureId ?? info.batchId)
    : "null";

/** `event.map`, or undefined off the globe (the sky). */
const mapOf = (event: MapPointerEvent | PointerEvent) =>
  "map" in event ? event.map : undefined;

const readout = {
  feature: "",
  event: "",
  map: "",
  drawn: "",
  bldgZ: "",
  hoverFeature: "",
  hoverEvent: "",
  hoverMap: "",
};
const pane = new Pane({ title: "feature events" });
// Wide enough for a full `lng, lat, height`.
(pane.element.parentElement ?? pane.element).style.width = "440px";
pane.element.style.setProperty("--tp-blade-value-width", "300px");
const click = pane.addFolder({ title: "featureClick" });
click.addBinding(readout, "feature", { readonly: true });
click.addBinding(readout, "event", { readonly: true });
click.addBinding(readout, "map", { readonly: true });
click.addBinding(readout, "drawn", { readonly: true });
// The building's height range (PLATEAU `_zmin`/`_zmax`). They are above sea
// level, `drawn` above the ellipsoid: add the geoid, about 36.7 m here.
click.addBinding(readout, "bldgZ", { readonly: true, label: "bldg z" });
const hover = pane.addFolder({ title: "featureHover" });
hover.addBinding(readout, "hoverFeature", { readonly: true, label: "feature" });
hover.addBinding(readout, "hoverEvent", { readonly: true, label: "event" });
hover.addBinding(readout, "hoverMap", { readonly: true, label: "map" });

const describeEvent = (event: PointerEvent) =>
  `${event.type} (${event.clientX}, ${event.clientY})`;

let marker: MeshHandle<SphereMeshDesc> | undefined;

view.on("featureClick", (info, event) => {
  // Synchronously in the listener: the depth is still the frame on screen.
  const drawn =
    view.pickDepthPosition(event.clientX, event.clientY) ?? undefined;
  const map = mapOf(event);

  readout.feature = featureName(info);
  readout.event = describeEvent(event);
  readout.map = formatPosition(map);
  readout.drawn = formatPosition(drawn);
  const z = [info?.properties?._zmin, info?.properties?._zmax];
  readout.bldgZ = z.every((v) => typeof v === "number") ? z.join(" – ") : "";
  pane.refresh();

  ring.style.left = `${event.clientX}px`;
  ring.style.top = `${event.clientY}px`;
  ring.style.display = "block";

  marker?.delete();
  marker = drawn
    ? view.addMesh<SphereMeshDesc>({
        sphere: { radius: 6, color: new Color().setStyle("#0091ff") },
        geodetic: vector3ToGeodetic(drawn),
      })
    : undefined;

  // Read by the screenshot script.
  (window as { lastFeatureClick?: unknown }).lastFeatureClick = {
    feature: readout.feature,
    event: readout.event,
    map: readout.map,
    drawn: readout.drawn,
    bldgZ: readout.bldgZ,
  };
});

view.on("featureHover", (info, event) => {
  readout.hoverFeature = featureName(info);
  readout.hoverEvent = describeEvent(event);
  readout.hoverMap = formatPosition(mapOf(event));
  pane.refresh();
  (window as { lastFeatureHover?: unknown }).lastFeatureHover = {
    feature: readout.hoverFeature,
    event: readout.hoverEvent,
    map: readout.hoverMap,
  };
});

// For the measurement script.
(window as { view?: unknown }).view = view;

view.attribution?.add([
  TERRAIN_DATASETS.gsi,
  TILE_DATASETS.openstreetmap,
  TILES_3D_DATASETS.plateauChiyoda,
]);
