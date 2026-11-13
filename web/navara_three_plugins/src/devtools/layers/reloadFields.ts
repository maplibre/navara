/**
 * Fields the engine reads only when it builds the layer, its tiles or its
 * meshes: an update leaves what is already drawn as it was. Each maps to an
 * optional note for its tooltip.
 */
export const RELOAD_FIELDS: Record<string, Record<string, string>> = {
  point: { placement: "", spacing: "", rotateToLine: "", geometryTypes: "" },
  billboard: {
    placement: "",
    spacing: "",
    rotateToLine: "",
    geometryTypes: "",
  },
  text: { placement: "", spacing: "", geometryTypes: "", highQuality: "" },
  polyline: { clampToGround: "", tiled: "", geodesic: "", geometryTypes: "" },
  polygon: {
    clampToGround: "",
    tiled: "",
    geodesic: "",
    perPositionHeight: "",
    outline: "",
    outlineShow: "Applies at once when the layer was added with an outline.",
  },
  model: {
    size: "",
    height: "Applies at once to point clouds.",
    normals: "",
    creaseNormalAngle: "",
    maxSse: "",
  },
  raster: { showBoundingBox: "" },
  terrain: { skirt: "", skirtExaggeration: "" },
};

/** Fields the engine never reads for the layer types this panel edits. */
export const NO_EFFECT_FIELDS: Record<string, string[]> = {
  text: ["lang"],
  // `model` is edited on 3D Tiles layers only: their content comes from the
  // tileset, which fixes `url` and `shouldRotateInDefault`.
  model: [
    "url",
    "shouldRotateInDefault",
    "reflectivity",
    "animationActiveClip",
    "animationSpeed",
  ],
  terrain: ["show"],
};

export const RELOAD_HINT =
  "↻ Applies to what is already drawn only after Reload layer: the engine reads it when it builds the layer. MVT and tiled layers also use it for tiles loaded later.";
export const NO_EFFECT_HINT =
  "∅ No effect: the engine does not read this field.";

/** True when the engine reads `key.name` only when it builds the layer. */
export function isReloadField(key: string, name: string): boolean {
  return RELOAD_FIELDS[key]?.[name] !== undefined;
}
