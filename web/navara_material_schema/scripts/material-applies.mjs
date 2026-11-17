// When a material field takes effect: facts the Rust sources do not mark, so
// generate-material-schema.mjs merges them into materialSchema.json as each
// field's `applies` and `note`. A field listed in neither table applies as
// soon as `layer.update()` sets it ("live"). Each entry maps a field to an
// optional note shown with it; the generator fails on a name the schema does
// not have.

/**
 * "reload": the engine reads the field only when it builds the layer, its
 * tiles or its meshes, so an update leaves what is already drawn as it was.
 */
export const RELOAD = {
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
    extrusionBase: "",
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

/** "never": the engine does not read the field on a layer. */
export const NEVER = {
  text: { lang: "" },
  model: {
    url: "A 3D Tiles layer's content comes from its tileset.",
    shouldRotateInDefault: "A 3D Tiles layer's content comes from its tileset.",
    reflectivity: "",
    animationActiveClip: "",
    animationSpeed: "",
  },
};
