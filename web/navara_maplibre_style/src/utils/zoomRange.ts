import type { StyleLayer } from "../engine/types";

/** Whether a style layer sets a `minzoom` or `maxzoom`. */
export function hasZoomRange(styleLayer: StyleLayer): boolean {
  return (
    ("minzoom" in styleLayer && styleLayer.minzoom !== undefined) ||
    ("maxzoom" in styleLayer && styleLayer.maxzoom !== undefined)
  );
}

/** A layer's `minzoom` is inclusive and its `maxzoom` exclusive. */
export function inZoomRange(styleLayer: StyleLayer, zoom: number): boolean {
  if ("minzoom" in styleLayer && styleLayer.minzoom !== undefined) {
    if (zoom < styleLayer.minzoom) return false;
  }
  if ("maxzoom" in styleLayer && styleLayer.maxzoom !== undefined) {
    if (zoom >= styleLayer.maxzoom) return false;
  }
  return true;
}
