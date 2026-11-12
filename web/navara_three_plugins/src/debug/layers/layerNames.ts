import type ThreeView from "@navaramap/three";
import type { Layer, SourceDescription } from "@navaramap/three";

import { hostOf } from "../util/format";
import { describeSourceType } from "../util/names";

import { descriptionOf } from "./layerDescriptions";

export type LayerLabel = {
  /** Short name for lists: what the layer draws. */
  name: string;
  /** Where its data comes from. */
  origin: string;
  /** The layer's source id, when it has one. */
  sourceId: string | undefined;
  source: SourceDescription | undefined;
};

const VECTOR_STYLES = ["polygon", "polyline", "point", "billboard", "text"];

/** The last meaningful path segment of a URL (a tileset's folder name). */
function pathName(url: string | undefined): string {
  if (!url) return "";
  try {
    const segments = new URL(url, window.location.href).pathname
      .split("/")
      .filter((s) => s && !/^(tileset|layer)\.json$/i.test(s));
    return decodeURIComponent(segments[segments.length - 1] ?? "");
  } catch {
    return "";
  }
}

/** A human name for a layer from its description and source. */
export function labelLayer(view: ThreeView, layer: Layer): LayerLabel {
  const desc = descriptionOf(layer) as unknown as Record<string, unknown> & {
    type: string;
    source?: string;
    sourceLayers?: string[];
  };
  const sourceId = typeof desc.source === "string" ? desc.source : undefined;
  const source = sourceId ? view.getSourceDescription(sourceId) : undefined;
  const url = (source as { url?: string } | undefined)?.url;
  const origin = source
    ? `${describeSourceType(source.type ?? "")} · ${hostOf(url) || "inline data"}`
    : "no source";

  let name: string;
  switch (desc.type) {
    case "vector": {
      const styles = VECTOR_STYLES.filter((k) => desc[k]).join(", ");
      const what = desc.sourceLayers?.length
        ? desc.sourceLayers.join(", ")
        : source?.type === "geojson"
          ? pathName(url) || "GeoJSON"
          : "all source layers";
      name = `${what}${styles ? ` (${styles})` : ""}`;
      break;
    }
    case "raster":
      name = desc.hillshade
        ? "Hillshade"
        : desc.elevationHeatmap
          ? "Elevation heatmap"
          : "Imagery";
      break;
    case "terrain":
      name = source ? "Terrain" : "Ellipsoid";
      break;
    case "3d-tiles":
      name = `3D Tiles${pathName(url) ? ` · ${pathName(url)}` : ""}`;
      break;
    default:
      name = desc.type;
  }
  return { name, origin, sourceId, source };
}
