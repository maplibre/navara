/** A plain-language name and a one-line explanation for an internal id. */
export type Described = { name: string; hint: string };

/** Render pass names (`ViewContext.getPassNames()`) by effect key. */
const PASSES: Record<string, Described> = {
  skyEnvMap: {
    name: "Sky reflections",
    hint: "Renders the sky into a cube map that shiny surfaces reflect.",
  },
  mrt: {
    name: "Scene",
    hint: "Draws terrain, imagery, layers and meshes into the G-buffer. Usually the most expensive step; its draw calls are the scene's.",
  },
  transparent: {
    name: "Transparent meshes",
    hint: "Draws meshes in the transparent scene, after the screen-space effects.",
  },
  final: {
    name: "Copy to screen",
    hint: "Copies the finished image to the canvas.",
  },
  aerialPerspective: {
    name: "Atmosphere",
    hint: "Sky, haze over distant terrain, and sun / sky lighting.",
  },
  clouds: { name: "Clouds", hint: "Volumetric clouds." },
  lensFlare: { name: "Lens flare", hint: "Sun glare streaks and ghosts." },
  toneMapping: {
    name: "Tone mapping",
    hint: "Maps the HDR image to screen colors (exposure).",
  },
  smaa: { name: "Anti-aliasing (SMAA)", hint: "Smooths jagged edges." },
  fxaa: { name: "Anti-aliasing (FXAA)", hint: "Smooths jagged edges." },
  ssao: {
    name: "Ambient occlusion",
    hint: "Darkens creases and contact areas (SSAO).",
  },
  ssr: {
    name: "Reflections",
    hint: "Screen-space reflections on shiny surfaces.",
  },
  selectiveBloom: { name: "Bloom", hint: "Glow around emissive meshes." },
  selectiveOutline: { name: "Outline", hint: "Outlines around marked meshes." },
  depthOfField: { name: "Depth of field", hint: "Blurs out-of-focus areas." },
  colorGradingLUT: { name: "Color grading", hint: "Applies a color LUT." },
  rainDrop: { name: "Rain drops", hint: "Rain drops on the lens." },
  fogLight: { name: "Fog lights", hint: "Light scattered in fog." },
  debugBlit: {
    name: "Buffer viewer",
    hint: "The devtools' picture-in-picture buffer view.",
  },
};

/** A pass's display name; unknown passes keep their key. */
export function describePass(key: string): Described {
  const base = key.replace(/_[0-9a-f]{4,}$/, "");
  const known = PASSES[base];
  return known
    ? { name: known.name, hint: `${known.hint} (pass "${key}")` }
    : { name: key, hint: `Render pass "${key}".` };
}

/** Frontend job kinds (`ViewContext.getJobStats()`) by handler name. */
const JOBS: Record<string, Described> = {
  "tile mesh": {
    name: "Terrain tiles",
    hint: "Building terrain tile meshes from downloaded elevation data.",
  },
  "worker task": {
    name: "Worker tasks",
    hint: "Parsing tiles and building geometry on worker threads.",
  },
  "renderable feature": {
    name: "Features",
    hint: "Points, lines, polygons, labels and 3D Tiles models being turned into meshes.",
  },
  "texture fragment": {
    name: "Imagery textures",
    hint: "Imagery tiles being downloaded and decoded.",
  },
  "data requester": {
    name: "Downloads",
    hint: "Tile and file downloads the engine asked for.",
  },
};

export function describeJob(name: string): Described {
  return JOBS[name] ?? { name, hint: `Job kind "${name}".` };
}

/** Source types (`SourceDescription.type`). */
const SOURCES: Record<string, string> = {
  "raster-tile": "Imagery",
  "raster-dem": "Elevation",
  "quantized-mesh": "Terrain mesh",
  "vector-tile": "Vector tiles",
  geojson: "GeoJSON",
  "3d-tiles": "3D Tiles",
  b3dm: "3D Tiles (b3dm)",
  pnts: "Point cloud",
};

export function describeSourceType(type: string): string {
  return SOURCES[type] ?? type;
}
