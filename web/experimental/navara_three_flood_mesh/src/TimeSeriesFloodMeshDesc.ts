import type ThreeView from "@navaramap/three";
import {
  Color,
  createPolygonMaterialEnhancer,
  createReplacer,
  DepthPrePassMesh,
  encodePositionRTE,
  geodeticSurfaceNormal,
  geodeticToVector3,
  MeshDesc,
  setupRTECallback,
  type MeshConfig,
  type MeshUpdate,
  type PassKey,
  type ViewContext,
} from "@navaramap/three";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color as ThreeColor,
  DataArrayTexture,
  DataTexture,
  DoubleSide,
  FloatType,
  FrontSide,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  RGFormat,
  Sphere,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";

import { layerSize, TEXTURE_WIDTH } from "./layout";
import { loadInWorker } from "./loadInWorker";
import type {
  TimeSeriesFloodField,
  TimeSeriesFloodSeries,
  TimeSeriesFloodVariables,
} from "./series";

const DEFAULT_COLOR = "#5a3f1c";
/** A flood spreads over land, so it has no room for an ocean's swell. */
const DEFAULT_WATER_SCALE = "medium";

/** Property textures kept on the GPU beyond the two being shown. */
const PROPERTY_CACHE = 3;
/** Entries of a linear scale's lookup texture. */
const LUT_SIZE = 256;
/** Breaks or values a scale may have; mirrored in the shader. */
const MAX_EDGES = 32;
const DEFAULT_HEATMAP_OPACITY = 0.85;
const DEFAULT_MISSING_COLOR = "#808080";
const DEFAULT_TRANSITION = 300;
const SHOW_UNDERGROUND_DEFINE = "NVR_WATER_SHOW_UNDERGROUND";

/**
 * What the surface covers:
 *
 * - `frame`: the water of the frame shown;
 * - `max`: every cell the water reaches in any frame, at its highest level,
 *   such as for a map of the arrival time or the maximum depth.
 */
export type TimeSeriesFloodExtent = "frame" | "max";

const EXTENT_INDEX: Record<TimeSeriesFloodExtent, number> = {
  frame: 0,
  max: 1,
};

/**
 * How a property's value picks the color:
 *
 * - `linear`: a gradient through the `stops`, clamped at the ends;
 * - `threshold`: ordered classes, `colors[i]` for values in
 *   `[breaks[i - 1], breaks[i])`, so one more color than breaks;
 * - `category`: one color per listed value, `other` for the rest.
 */
export type TimeSeriesFloodColorScale =
  | { type: "linear"; stops: [value: number, color: Color][] }
  | { type: "threshold"; breaks: number[]; colors: Color[] }
  | { type: "category"; values: number[]; colors: Color[]; other?: Color };

/** Colors the surface by a property of the series instead of as water. */
export type TimeSeriesFloodColorBy = {
  /** A name in `series.properties`. */
  property: string;
  scale: TimeSeriesFloodColorScale;
  /**
   * Whether the value varies smoothly between the cell centers and the
   * frames; off, each cell shows its own value at frame `Math.floor(frame)`,
   * or at the next frame where the cell is still dry then, inside the moving
   * shoreline.
   * On by default except for a `category` scale.
   */
  interpolate?: boolean;
  /** Opacity of the colored surface, the same at every depth. */
  opacity?: number;
  /** Color where the property has no value. */
  missing?: Color;
  /** Milliseconds the colors cross-fade over when `colorBy` changes. */
  transition?: number;
};

/**
 * The series the surface draws, fixed for the mesh's lifetime: create a new
 * mesh for another one.
 */
type TimeSeriesFloodData =
  | {
      /** A loaded series. */
      series: TimeSeriesFloodSeries;
      url?: never;
      variables?: never;
    }
  | {
      /**
       * URL of a Zarr group, which the mesh loads in a worker as
       * `loadTimeSeriesFlood` does; a relative URL resolves against the page.
       * The surface shows once it has loaded (the `load` event).
       */
      url: string | URL;
      /** Names of the arrays to read. */
      variables?: TimeSeriesFloodVariables;
      series?: never;
    };

type TimeSeriesFloodAppearance = {
  /** Fractional frame index; the fraction interpolates to the next frame. */
  frame?: number;
  /**
   * `max` covers every cell ever wet, at its highest level, with a property
   * that changes over time at its maximum; `frame` is ignored then.
   */
  extent?: TimeSeriesFloodExtent;
  /** Meters added to the water-surface heights, to fit another terrain. */
  heightOffset?: number;
  /**
   * Meters the terrain may rise above the water and still show it: such water
   * draws on the terrain's surface, for a terrain that differs from the
   * simulation's ground. Water farther below, such as behind a hill, stays
   * hidden. 0, the default, hides all water below the terrain.
   */
  showUnderground?: number;
  color?: Color;
  /** Opacity where the water is deep. */
  opacity?: number;
  /** Opacity where the water is shallow. */
  shallowOpacity?: number;
  /** Per-meter extinction along the view ray through the water. */
  absorption?: number;
  /** Sets the waves' size, slope and speed: about 1 calm, 5 moderate, 20 a storm. */
  waveStrength?: number;
  /** Where the waves travel, in degrees clockwise from north. */
  waveDirection?: number;
  /**
   * Speed in m/s of the current carrying the waves along `waveDirection`,
   * over the whole surface. A series with a flow follows that instead.
   */
  flowSpeed?: number;
  /** Scales only the waves' slopes; 0 makes a still mirror. */
  waveExaggeration?: number;
  /** Open water the waves grow over, which sets their size. */
  waterScale?: "ocean" | "large" | "medium" | "small";
  /** Also draws the surface from below, for a camera under the water. */
  doubleSide?: boolean;
  /** Colors the surface by a property; `null` draws it as water again. */
  colorBy?: TimeSeriesFloodColorBy | null;
};

type TimeSeriesFloodStyle = TimeSeriesFloodData & TimeSeriesFloodAppearance;

type Description = {
  timeSeriesFlood?: TimeSeriesFloodStyle;
};

export type TimeSeriesFloodMeshConfig = MeshConfig & Description;
export type TimeSeriesFloodMeshUpdate = MeshUpdate & {
  timeSeriesFlood?: Partial<TimeSeriesFloodAppearance> & {
    /** The series the mesh draws, which cannot change. */
    series?: TimeSeriesFloodSeries;
  };
};

export type TimeSeriesFloodMeshEvent = {
  /**
   * Emitted as the series of a `url` loads, with a rough share of the work
   * done, from 0 up to 1.
   */
  progress: (fraction: number) => void;
  /** Emitted once the series of a `url` has loaded and the surface shows. */
  load: (series: TimeSeriesFloodSeries) => void;
  /** Emitted when loading the series of a `url` fails. */
  error: (error: unknown) => void;
  needsUpdate: () => void;
};

const SCALE_TYPE = { water: -1, linear: 0, threshold: 1, category: 2 };

/** Shader code of one property slot; `s` is 0 (shown) or 1 (fading out). */
const slotVertexPars = (s: number) => /* glsl */ `
uniform highp sampler2DArray uProp${s}Map;
uniform float uProp${s}Frames;
uniform int uProp${s}Type;
uniform int uProp${s}Nearest;
uniform int uProp${s}Step;
out float vProp${s};
`;

const slotVertexMain = (s: number) => /* glsl */ `
vProp${s} = 0.0;
if (uProp${s}Type >= 0 && uProp${s}Nearest == 0) {
  vProp${s} = nvr_propAt(
    uProp${s}Map, texel, k0, k1, uProp${s}Frames, uProp${s}Step == 1 ? 0.0 : t
  );
}
`;

const slotFragmentPars = (s: number) => /* glsl */ `
uniform highp sampler2DArray uProp${s}Map;
uniform float uProp${s}Offset;
uniform float uProp${s}Frames;
uniform int uProp${s}Type;
uniform int uProp${s}Nearest;
uniform int uProp${s}Step;
uniform sampler2D uProp${s}Lut;
uniform vec2 uProp${s}Domain;
uniform float uProp${s}Edges[${MAX_EDGES}];
uniform vec3 uProp${s}Colors[${MAX_EDGES + 1}];
uniform int uProp${s}Count;
uniform vec3 uProp${s}Other;
uniform vec3 uProp${s}Missing;
uniform float uProp${s}Opacity;
in float vProp${s};

vec4 nvr_propShade${s}(float shore) {
  float alpha = uProp${s}Opacity * shore;
  float v;
  if (uProp${s}Nearest == 1) {
    // The cell under the fragment, at the frame shown; a cell still dry
    // there, inside the moving shoreline, shows the next frame's value,
    // unless the value holds over the interval and so covers it already.
    ivec2 cell = ivec2(floor(vWaterCell + 0.5));
    int c = cell.y * uWaterGridWidth + cell.x;
    float node = texelFetch(uWaterNodeAt, ivec2(c % ${TEXTURE_WIDTH}, c / ${TEXTURE_WIDTH}), 0).r;
    if (node < 0.0) return vec4(uProp${s}Missing / uWaterExposure, alpha);
    int n = int(node + 0.5);
    ivec2 texel = ivec2(n % ${TEXTURE_WIDTH}, n / ${TEXTURE_WIDTH});
    float k = uWaterFrameCount;
    if (uWaterExtent == 0) {
      float frame = clamp(uWaterFrame, 0.0, uWaterFrameCount - 1.0);
      float k0 = floor(frame);
      float k1 = min(k0 + 1.0, uWaterFrameCount - 1.0);
      float dry = texelFetch(uWaterSeries, ivec3(texel, int(k0)), 0).g;
      k = dry > 0.0 && uProp${s}Step == 0 ? k1 : k0;
    }
    v = texelFetch(uProp${s}Map, ivec3(texel, uProp${s}Frames == 1.0 ? 0 : int(k)), 0).r;
  } else {
    v = vProp${s};
  }
  if (isnan(v)) return vec4(uProp${s}Missing / uWaterExposure, alpha);
  vec3 color = nvr_propColor(
    v + uProp${s}Offset, uProp${s}Type, uProp${s}Lut, uProp${s}Domain,
    uProp${s}Edges, uProp${s}Colors, uProp${s}Count, uProp${s}Other
  );
  return vec4(color / uWaterExposure, alpha);
}
`;

const VERTEX_PARS = /* glsl */ `
uniform highp sampler2DArray uWaterSeries;
uniform float uWaterFrame;
uniform float uWaterFrameCount;
uniform float uWaterHeightOffset;
uniform int uWaterExtent;
in float aWaterNode;
in float aWaterHeightBase;
in vec2 aWaterCell;
out float vWaterPhase;
out vec2 vWaterCell;

// A missing value (NaN) on either side leaves the other.
float nvr_mixMissing(float a, float b, float t) {
  if (isnan(a)) return b;
  if (isnan(b)) return a;
  return mix(a, b, t);
}

// A property that does not change over time has one layer; one that does
// has the series' layers, the maximum last.
float nvr_propAt(highp sampler2DArray map, ivec2 texel, float k0, float k1, float frames, float t) {
  if (frames == 1.0) return texelFetch(map, ivec3(texel, 0), 0).r;
  float a = texelFetch(map, ivec3(texel, int(k0)), 0).r;
  float b = texelFetch(map, ivec3(texel, int(k1)), 0).r;
  return nvr_mixMissing(a, b, t);
}
#ifdef NVR_WATER_FLOW
uniform highp sampler2DArray uWaterFlow;
out vec2 vWaterFlow;
#endif
${slotVertexPars(0)}
${slotVertexPars(1)}
`;

const VERTEX_MAIN = /* glsl */ `
{
  int node = int(aWaterNode + 0.5);
  ivec2 texel = ivec2(node % ${TEXTURE_WIDTH}, node / ${TEXTURE_WIDTH});
  // The layer after the frames holds the maximum over them.
  float k0 = uWaterFrameCount;
  float k1 = k0;
  float t = 0.0;
  if (uWaterExtent == 0) {
    float frame = clamp(uWaterFrame, 0.0, uWaterFrameCount - 1.0);
    k0 = floor(frame);
    k1 = min(k0 + 1.0, uWaterFrameCount - 1.0);
    t = frame - k0;
  }
  vec2 w0 = texelFetch(uWaterSeries, ivec3(texel, int(k0)), 0).rg;
  vec2 w1 = texelFetch(uWaterSeries, ivec3(texel, int(k1)), 0).rg;
  float waterHeight = aWaterHeightBase + uWaterHeightOffset + mix(w0.r, w1.r, t);
  transformed += normal * waterHeight;
  absTransformed += normal * waterHeight;
  vWaterPhase = -mix(w0.g, w1.g, t);
  vWaterCell = aWaterCell;
#ifdef NVR_WATER_FLOW
  vWaterFlow = mix(
    texelFetch(uWaterFlow, ivec3(texel, int(k0)), 0).rg,
    texelFetch(uWaterFlow, ivec3(texel, int(k1)), 0).rg,
    t
  );
#endif
  ${slotVertexMain(0)}
  ${slotVertexMain(1)}
}
`;

const FRAGMENT_PARS = /* glsl */ `
in float vWaterPhase;
in vec2 vWaterCell;
#ifdef NVR_WATER_FLOW
in vec2 vWaterFlow;
#endif
uniform highp sampler2DArray uWaterSeries;
uniform float uWaterFrame;
uniform float uWaterFrameCount;
uniform int uWaterExtent;
uniform sampler2D uWaterGroundDepth;
uniform sampler2D uWaterNodeAt;
uniform int uWaterGridWidth;
uniform vec3 uWaterDeepColor;
uniform float uWaterShallowOpacity;
uniform float uWaterAbsorption;
uniform float uWaterShowUnderground;
uniform float uWaterExposure;
uniform float uPropMix;
#ifndef USE_LOGARITHMIC_DEPTH_BUFFER
  uniform mat4 projectionMatrix;
#endif
float nvrWaterShore;

float nvr_waterGroundEyeDistance(float depth) {
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  return exp2(2.0 * depth / logDepthBufFC) - 1.0;
#else
  return projectionMatrix[3][2] / (depth * 2.0 - 1.0 + projectionMatrix[2][2]);
#endif
}

vec3 nvr_propColor(
  float v, int type, sampler2D lut, vec2 domain,
  float edges[${MAX_EDGES}], vec3 colors[${MAX_EDGES + 1}], int count, vec3 other
) {
  if (type == ${SCALE_TYPE.linear}) {
    float u = clamp((v - domain.x) / (domain.y - domain.x), 0.0, 1.0);
    return texture(lut, vec2(u, 0.5)).rgb;
  }
  if (type == ${SCALE_TYPE.threshold}) {
    int i = 0;
    for (int j = 0; j < ${MAX_EDGES}; j++) {
      if (j < count && v >= edges[j]) i = j + 1;
    }
    return colors[i];
  }
  for (int j = 0; j < ${MAX_EDGES}; j++) {
    if (j < count && abs(v - edges[j]) <= 1e-3 * max(1.0, abs(edges[j]))) {
      return colors[j];
    }
  }
  return other;
}
${slotFragmentPars(0)}
${slotFragmentPars(1)}
`;

// Water thickness along the view ray: from above, down to the terrain; from
// below, back to the eye. Shallow water shows what lies beyond, deep water
// takes the deep color and opacity.
const FRAGMENT_COLOR = /* glsl */ `
{
  float groundW = nvr_waterGroundEyeDistance(unpackRGBAToDepth(
    texture2D(uWaterGroundDepth, gl_FragCoord.xy / vec2(textureSize(uWaterGroundDepth, 0)))
  ));
  float thickness = gl_FrontFacing
    ? max(groundW - vViewPosition.z, 0.0) * length(vViewPosition) / vViewPosition.z
    : length(vViewPosition);
  float absorbed = 1.0 - exp(-thickness * uWaterAbsorption);
  diffuseColor.rgb = mix(diffuseColor.rgb, uWaterDeepColor, absorbed);
  diffuseColor.a = mix(uWaterShallowOpacity, diffuseColor.a, absorbed);
  nvrWaterShore = clamp(vWaterPhase / max(fwidth(vWaterPhase), 1e-4), 0.0, 1.0);
  diffuseColor.a *= nvrWaterShore;
}
`;

// Water the terrain in front of it rises above by less than `showUnderground`
// (measured along the up `normal`, before the waves) takes the terrain's
// depth, a little nearer, so it passes the depth test there.
const FRAGMENT_SHOW_UNDERGROUND = /* glsl */ `
#ifdef ${SHOW_UNDERGROUND_DEFINE}
{
#ifndef USE_LOGARITHMIC_DEPTH_BUFFER
  gl_FragDepth = gl_FragCoord.z;
#endif
  float groundDepth = unpackRGBAToDepth(
    texture2D(uWaterGroundDepth, gl_FragCoord.xy / vec2(textureSize(uWaterGroundDepth, 0)))
  );
  float behind = vViewPosition.z - nvr_waterGroundEyeDistance(groundDepth);
  float below = behind * length(vViewPosition) / vViewPosition.z
    * abs(dot(normalize(vViewPosition), normal));
  if (behind > 0.0 && below < uWaterShowUnderground) {
    gl_FragDepth = groundDepth * (1.0 - 1e-6);
  }
}
#endif
`;

// The property colors replace the lit water, cross-fading from the slot
// fading out (1) to the one shown (0); a slot without a property is the water.
const FRAGMENT_OUTPUT = /* glsl */ `
{
  vec4 water = vec4(outgoingLight, diffuseColor.a);
  vec4 s0 = uProp0Type < 0 ? water : nvr_propShade0(nvrWaterShore);
  vec4 s1 = uProp1Type < 0 ? water : nvr_propShade1(nvrWaterShore);
  vec4 shown = mix(s1, s0, uPropMix);
  outgoingLight = shown.rgb;
  diffuseColor.a = shown.a;
}
`;

/** The uniforms of one property slot. */
type SlotUniforms = {
  Map: { value: DataArrayTexture | null };
  Offset: { value: number };
  Frames: { value: number };
  Type: { value: number };
  Nearest: { value: number };
  Step: { value: number };
  Lut: { value: DataTexture | null };
  Domain: { value: Vector2 };
  Edges: { value: Float32Array };
  Colors: { value: Float32Array };
  Count: { value: number };
  Other: { value: ThreeColor };
  Missing: { value: ThreeColor };
  Opacity: { value: number };
};

const createSlotUniforms = (): SlotUniforms => ({
  Map: { value: null },
  Offset: { value: 0 },
  Frames: { value: 1 },
  Type: { value: SCALE_TYPE.water },
  Nearest: { value: 0 },
  Step: { value: 0 },
  Lut: { value: null },
  Domain: { value: new Vector2(0, 1) },
  Edges: { value: new Float32Array(MAX_EDGES) },
  Colors: { value: new Float32Array((MAX_EDGES + 1) * 3) },
  Count: { value: 0 },
  Other: { value: new ThreeColor() },
  Missing: { value: new ThreeColor() },
  Opacity: { value: DEFAULT_HEATMAP_OPACITY },
});

/** What a slot shows, so it can be moved to the fading slot as is. */
type SlotContent = {
  property: string;
  texture: DataArrayTexture;
  lut: DataTexture | null;
};

/**
 * A water surface that changes over time, such as a flood simulation, drawn
 * from a {@link TimeSeriesFloodSeries}, given or loaded from a `url`. Every
 * frame lives on the GPU, so moving `frame` only updates a uniform.
 */
export class TimeSeriesFloodMeshDesc extends MeshDesc<
  TimeSeriesFloodMeshConfig,
  TimeSeriesFloodMeshUpdate,
  Mesh<BufferGeometry, MeshLambertMaterial>,
  TimeSeriesFloodMeshEvent
> {
  private config: TimeSeriesFloodMeshConfig;
  private _series?: TimeSeriesFloodSeries;
  /** Stops the loading of a `url` when the mesh is deleted meanwhile. */
  private loading?: AbortController;
  private readonly uniforms = {
    uWaterSeries: { value: null as DataArrayTexture | null },
    uWaterFlow: { value: null as DataArrayTexture | null },
    uWaterFrame: { value: 0 },
    uWaterExtent: { value: EXTENT_INDEX.frame },
    uWaterFrameCount: { value: 1 },
    uWaterHeightOffset: { value: 0 },
    uWaterShowUnderground: { value: 0 },
    uWaterDeepColor: { value: new ThreeColor() },
    uWaterShallowOpacity: { value: 0.2 },
    uWaterAbsorption: { value: 0.5 },
    uWaterExposure: { value: 1 },
    uWaterNodeAt: { value: null as DataTexture | null },
    uWaterGridWidth: { value: 0 },
    uPropMix: { value: 1 },
    // Replaces the enhancer's own uniform: its texturized branch skips the
    // water shading and writes the plain normal to the G-buffer, which is what
    // a colored surface needs, without the depth state of a texturized material.
    uIsTexturized: { value: false },
  };
  private readonly slots = [createSlotUniforms(), createSlotUniforms()];
  private readonly contents: [SlotContent | null, SlotContent | null] = [
    null,
    null,
  ];
  /** Property textures by name, most recently used last. */
  private readonly textures = new Map<string, DataArrayTexture>();
  private transition?: { start: number; duration: number };
  private enhancer?: ReturnType<typeof createPolygonMaterialEnhancer>;
  private depthPrePass?: DepthPrePassMesh;

  constructor(
    view: ThreeView,
    ctx: ViewContext,
    config: TimeSeriesFloodMeshConfig,
  ) {
    super(view, ctx, config);
    this.config = config;
  }

  // The thickness reads the terrain depth, which only the MRT pass has
  // before blended meshes draw.
  protected override getPassKey(): PassKey {
    return "mrt";
  }

  private get style() {
    const style = this.config.timeSeriesFlood;
    if (!style) {
      throw new Error("TimeSeriesFloodMesh configuration is required");
    }
    return style;
  }

  /** The series drawn; `undefined` while that of a `url` loads. */
  get series(): TimeSeriesFloodSeries | undefined {
    return this._series;
  }

  /** The series, which the surface exists only with. */
  private get loaded(): TimeSeriesFloodSeries {
    if (!this._series) {
      throw new Error("TimeSeriesFloodMesh: the series has not loaded");
    }
    return this._series;
  }

  override onCreate(): void | Promise<void> {
    const { series, url, variables } = this.style;
    if (series) {
      this._series = series;
      super.onCreate();
      return;
    }
    if (url === undefined) {
      throw new Error("TimeSeriesFloodMesh: give a series or a url");
    }
    return this.load(url, variables);
  }

  /**
   * Loads the series of `url`, then creates the surface; the view reports a
   * failure as the `error` event.
   */
  private async load(url: string | URL, variables?: TimeSeriesFloodVariables) {
    // The worker decodes on a core the engine's pool then leaves to it.
    const releaseCore = this.ctx.reserveWorkerCore();
    const loading = new AbortController();
    this.loading = loading;
    let series: TimeSeriesFloodSeries;
    try {
      series = await loadInWorker(url, {
        variables,
        signal: loading.signal,
        onProgress: (fraction) => this.emit("progress", fraction),
      });
    } catch (error) {
      // Deleted meanwhile: nothing to report.
      if (this.destroyed) return;
      throw error;
    } finally {
      releaseCore();
      this.loading = undefined;
    }
    if (this.destroyed) return;
    this._series = series;
    super.onCreate();
    this.requestUpdate();
    this.emit("load", series);
  }

  createMesh() {
    const style = this.style;
    const series = this.loaded;
    const { maxTextureSize, maxLayers } = this.textureLimits();
    const rows = layerSize(series.nodes.length) / TEXTURE_WIDTH;
    if (rows > maxTextureSize || series.times.length + 1 > maxLayers) {
      throw new Error(
        `TimeSeriesFloodMesh: ${series.nodes.length} nodes over ` +
          `${series.times.length} frames need ${rows} rows and ` +
          `${series.times.length + 1} layers; this GPU allows ` +
          `${maxTextureSize} and ${maxLayers}`,
      );
    }
    if (style.colorBy) this.checkColorBy(style.colorBy);
    this.uniforms.uWaterSeries.value = createSeriesTexture(series);
    if (series.flow) {
      this.uniforms.uWaterFlow.value = arrayTexture(
        series.flow,
        series.times.length + 1,
        RGFormat,
      );
    }
    this.uniforms.uWaterFrameCount.value = series.times.length;
    const color = style.color ?? new Color().setStyle(DEFAULT_COLOR);
    this.applyStyle({ ...style, color });

    const material = new MeshLambertMaterial();
    const enhancer = createPolygonMaterialEnhancer(material);
    this.enhancer = enhancer;
    enhancer.mount({
      base: {
        color: color.toHex(),
        opacity: style.opacity ?? 0.9,
        transparent: true,
        minMaxHeight: [0, 0],
        useRTE: true,
        isTexturized: false,
        pickable: false,
        clampToGround: false,
      },
      water: {
        water: true,
        ...this.waveProps(style),
        waterScale: style.waterScale ?? DEFAULT_WATER_SCALE,
        getWaterState: () => this.ctx.getWaterState(),
      },
    });
    material.customProgramCacheKey = () =>
      `${enhancer.programCacheKey()}nvr-water-surface${series.flow ? "-flow" : ""}`;
    material.onBeforeCompile = (shader) => {
      enhancer.transformShader(shader);
      this.transformShader(shader);
    };
    material.side = style.doubleSide ? DoubleSide : FrontSide;
    // The depth pre-pass already keeps one surface per pixel. Three's separate
    // back and front passes would only recompile each frame and flip the winding
    // so that `gl_FrontFacing` holds from below as well.
    material.forceSinglePass = true;
    this.ctx.applyShadowMaterial(material);

    const mesh = new Mesh(createGeometry(series), material);
    mesh.receiveShadow = true;
    // RTE positions make the CPU bounding volume meaningless.
    mesh.frustumCulled = false;

    const { base } = enhancer.states();
    const { base: baseMutates } = enhancer.mutates();
    const onBeforeRender = setupRTECallback(mesh, (mv, high, low) =>
      baseMutates.updateRteUniforms(mv, high, low, base),
    );
    mesh.onBeforeRender = onBeforeRender;
    mesh.onBeforeShadow = onBeforeRender;

    // Clones the material, side included.
    this.depthPrePass = new DepthPrePassMesh(mesh);
    mesh.add(this.depthPrePass);
    // After the pre-pass exists: it copies the defines once the material changes.
    setShowUnderground(material, (style.showUnderground ?? 0) > 0);

    if (style.colorBy) this.showProperty(style.colorBy, false);
    return mesh;
  }

  private transformShader(shader: WebGLProgramParametersWithUniforms) {
    const flow = !!this.loaded.flow;
    if (flow) shader.defines = { ...shader.defines, NVR_WATER_FLOW: 1 };
    Object.assign(shader.uniforms, this.uniforms, {
      uWaterGroundDepth: this.ctx.getGlobeDepthTextureUniform(),
    });
    this.slots.forEach((slot, s) => {
      for (const [key, uniform] of Object.entries(slot)) {
        shader.uniforms[`uProp${s}${key}`] = uniform;
      }
    });
    shader.vertexShader = createReplacer(shader.vertexShader)
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace(
        "nvr_vBatchId = attrBatchId;",
        `nvr_vBatchId = attrBatchId;\n${VERTEX_MAIN}`,
      ).source;
    shader.fragmentShader = createReplacer(shader.fragmentShader)
      .replace(
        "void main() {",
        `${FRAGMENT_PARS}\nvoid main() {\n  if (vWaterPhase < 0.0) discard;`,
      )
      .replaceWithCondition(
        "nvrWaterSurface(nvrWaterCoord(vViewPosition), origNormal, uWaveExaggeration, 0)",
        "nvrWaterFlowSurface(nvrWaterCoord(vViewPosition), origNormal, uWaveExaggeration, vWaterFlow, 0)",
        flow,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${FRAGMENT_COLOR}`,
      )
      // From below, keep the surface lit like from above: the sky lights it
      // through the water rather than from the eye side.
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
#ifdef DOUBLE_SIDED
  normal *= faceDirection;
#endif
${FRAGMENT_SHOW_UNDERGROUND}`,
      )
      // Nor does it reflect anything from below: the water's body shows.
      .replace(
        "outgoingLight = nvrWaterShade(",
        "if (gl_FrontFacing) outgoingLight = nvrWaterShade(",
      )
      .replace(
        "#include <opaque_fragment>",
        `${FRAGMENT_OUTPUT}\n#include <opaque_fragment>`,
      ).source;
  }

  /** The style's wave settings, undefined where it leaves them out. */
  private waveProps({
    waveStrength,
    waveDirection,
    waveExaggeration,
    waterScale,
    flowSpeed,
  }: Partial<TimeSeriesFloodStyle>) {
    return {
      waveStrength,
      waveDirection,
      waveExaggeration,
      waterScale,
      flowSpeed: this.loaded.flow ? undefined : flowSpeed,
    };
  }

  /** Applies the given properties only, so an update keeps the others. */
  private applyStyle(style: Partial<TimeSeriesFloodStyle>) {
    if (style.frame !== undefined) {
      this.uniforms.uWaterFrame.value = style.frame;
    }
    if (style.extent !== undefined) {
      this.uniforms.uWaterExtent.value = EXTENT_INDEX[style.extent];
    }
    if (style.heightOffset !== undefined) {
      this.uniforms.uWaterHeightOffset.value = style.heightOffset;
    }
    if (style.showUnderground !== undefined) {
      this.uniforms.uWaterShowUnderground.value = style.showUnderground;
    }
    if (style.shallowOpacity !== undefined) {
      this.uniforms.uWaterShallowOpacity.value = style.shallowOpacity;
    }
    if (style.absorption !== undefined) {
      this.uniforms.uWaterAbsorption.value = style.absorption;
    }
    if (style.color !== undefined) {
      this.uniforms.uWaterDeepColor.value
        .set(style.color.toHex())
        .multiplyScalar(0.5);
    }
  }

  /**
   * Shows `colorBy` in slot 0, moving what was shown to slot 1 to fade out,
   * or the water again when it is `null`.
   */
  private showProperty(colorBy: TimeSeriesFloodColorBy | null, fade: boolean) {
    const [shown, fading] = this.slots;
    const [content, previous] = this.contents;
    // Whatever fades out next replaces what was still fading.
    if (previous) this.release(previous, content);
    copySlot(shown, fading);
    this.contents[1] = content;
    this.contents[0] = colorBy ? this.fillSlot(shown, colorBy) : null;
    if (!colorBy) {
      shown.Type.value = SCALE_TYPE.water;
      // The fading slot holds them now; it releases them when done.
      shown.Map.value = null;
      shown.Lut.value = null;
    }

    const duration = fade ? (colorBy?.transition ?? DEFAULT_TRANSITION) : 0;
    if (duration > 0) {
      this.transition = { start: performance.now(), duration };
      this.uniforms.uPropMix.value = 0;
    } else {
      this.transition = undefined;
      this.uniforms.uPropMix.value = 1;
      this.endTransition();
    }
    this.syncWaterShading();
  }

  /** Water is shaded while either slot still shows it, as it fades in or out. */
  private syncWaterShading() {
    const [shown, fading] = this.slots;
    this.uniforms.uIsTexturized.value =
      shown.Type.value !== SCALE_TYPE.water &&
      (!this.transition || fading.Type.value !== SCALE_TYPE.water);
  }

  /** The texture sizes the GPU allows. */
  private textureLimits() {
    const renderer = this.ctx.getRenderer();
    // Array textures need WebGL 2.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    return {
      maxTextureSize: renderer.capabilities.maxTextureSize,
      maxLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number,
    };
  }

  /**
   * Throws for a `colorBy` the series cannot show, and uploads the node
   * lookup a nearest-cell one reads.
   */
  private checkColorBy(colorBy: TimeSeriesFloodColorBy) {
    const series = this.loaded;
    if (!series.fields.has(colorBy.property)) {
      throw new Error(
        `TimeSeriesFloodMesh: the series has no property ${JSON.stringify(colorBy.property)}; ` +
          `it has ${Object.keys(series.properties).join(", ")}`,
      );
    }
    checkScale(colorBy.scale);
    if (!isNearest(colorBy) || this.uniforms.uWaterNodeAt.value) return;
    const { width, height } = series.grid;
    const rows = layerSize(width * height) / TEXTURE_WIDTH;
    const { maxTextureSize } = this.textureLimits();
    if (rows > maxTextureSize) {
      throw new Error(
        `TimeSeriesFloodMesh: the nearest-cell lookup over ${width} × ${height} ` +
          `cells needs ${rows} rows; this GPU allows ${maxTextureSize}. ` +
          `Interpolate the property instead.`,
      );
    }
    this.uniforms.uWaterNodeAt.value = createNodeAtTexture(series);
    this.uniforms.uWaterGridWidth.value = width;
  }

  /** Fills `slot` with a `colorBy` that `checkColorBy` accepted. */
  private fillSlot(
    slot: SlotUniforms,
    colorBy: TimeSeriesFloodColorBy,
  ): SlotContent {
    const series = this.loaded;
    const field = series.fields.get(colorBy.property);
    if (!field) throw new Error("TimeSeriesFloodMesh: colorBy is unchecked");
    const { scale } = colorBy;
    const texture = this.textureOf(colorBy.property, field);
    slot.Map.value = texture;
    slot.Offset.value = field.min;
    slot.Frames.value = field.frames;
    slot.Step.value = field.stepwise ? 1 : 0;
    slot.Type.value = SCALE_TYPE[scale.type];
    slot.Nearest.value = isNearest(colorBy) ? 1 : 0;
    slot.Opacity.value = colorBy.opacity ?? DEFAULT_HEATMAP_OPACITY;
    slot.Missing.value.set(
      (colorBy.missing ?? new Color().setStyle(DEFAULT_MISSING_COLOR)).toHex(),
    );

    let lut: DataTexture | null = null;
    slot.Edges.value.fill(0);
    slot.Colors.value.fill(0);
    if (scale.type === "linear") {
      const stops = [...scale.stops].sort((a, b) => a[0] - b[0]);
      lut = createLut(stops);
      slot.Lut.value = lut;
      const low = stops[0][0];
      const high = stops[stops.length - 1][0];
      // Stops all at one value make a LUT of one color; any domain width
      // shows it, and a zero one divides by zero in the shader.
      slot.Domain.value.set(low, high > low ? high : low + 1);
      slot.Count.value = 0;
    } else {
      const edges = scale.type === "threshold" ? scale.breaks : scale.values;
      slot.Lut.value = null;
      slot.Count.value = edges.length;
      slot.Edges.value.set(edges);
      scale.colors.forEach((color, i) =>
        slot.Colors.value.set(color.toArray(), i * 3),
      );
      slot.Other.value.set(
        (scale.type === "category" && scale.other
          ? scale.other
          : new Color().setStyle(DEFAULT_MISSING_COLOR)
        ).toHex(),
      );
    }
    return { property: colorBy.property, texture, lut };
  }

  /** The texture of a property, uploaded on first use and kept for a while. */
  private textureOf(name: string, field: TimeSeriesFloodField) {
    let texture = this.textures.get(name);
    if (texture) {
      // Most recently used last.
      this.textures.delete(name);
    } else {
      texture = createFieldTexture(field);
    }
    this.textures.set(name, texture);
    this.evictTextures();
    return texture;
  }

  /** Drops the least recently used textures beyond the cache, unless shown. */
  private evictTextures() {
    const shown = new Set(this.contents.map((c) => c?.property));
    for (const [name, texture] of this.textures) {
      if (this.textures.size <= PROPERTY_CACHE) break;
      if (shown.has(name)) continue;
      this.textures.delete(name);
      texture.dispose();
    }
  }

  /** Disposes what a slot no longer shows, keeping a cached texture. */
  private release(content: SlotContent, stillShown: SlotContent | null) {
    if (content.lut && content.lut !== stillShown?.lut) content.lut.dispose();
    this.evictTextures();
  }

  private endTransition() {
    this.transition = undefined;
    this.uniforms.uPropMix.value = 1;
    const previous = this.contents[1];
    if (previous) {
      this.release(previous, this.contents[0]);
      this.contents[1] = null;
    }
    this.slots[1].Type.value = SCALE_TYPE.water;
    this.slots[1].Map.value = null;
    this.slots[1].Lut.value = null;
    this.syncWaterShading();
  }

  /** Advances the cross-fade; the view calls it before each render. */
  update(): void {
    this.uniforms.uWaterExposure.value = this.view.toneMappingExposure || 1;
    if (!this.transition) return;
    const t =
      (performance.now() - this.transition.start) / this.transition.duration;
    if (t >= 1) {
      this.endTransition();
    } else {
      this.uniforms.uPropMix.value = t;
      this.emit("needsUpdate");
    }
  }

  /** The depth pre-pass holds a clone of the material, so both take it. */
  private applySide(doubleSide: boolean) {
    if (!this._instance) return;
    const side = doubleSide ? DoubleSide : FrontSide;
    for (const material of [
      this._instance.material,
      this.depthPrePass?.material,
    ]) {
      if (material && material.side !== side) {
        material.side = side;
        material.needsUpdate = true;
      }
    }
  }

  onUpdateConfig(updates: TimeSeriesFloodMeshUpdate): void {
    const patch = updates.timeSeriesFlood;
    if (patch && !this._instance) {
      // Applied as the surface is created, once the series has loaded.
      // The property is checked once the series has loaded.
      if (patch.colorBy) checkScale(patch.colorBy.scale);
      const { series: _, ...appearance } = patch;
      Object.assign(this.style, appearance);
    } else if (patch && this._instance) {
      if (patch.series !== undefined && patch.series !== this._series) {
        throw new Error(
          "TimeSeriesFloodMesh: series cannot change; create a new mesh instead",
        );
      }
      if (patch.colorBy) this.checkColorBy(patch.colorBy);
      // `series` may be passed (it must be the same one) but never replaced.
      const { series: _, ...appearance } = patch;
      Object.assign(this.style, appearance);
      this.applyStyle(patch);
      if (patch.color !== undefined) {
        this._instance.material.color.set(patch.color.toHex());
      }
      if (patch.opacity !== undefined) {
        this._instance.material.opacity = patch.opacity;
      }
      if (patch.doubleSide !== undefined) this.applySide(patch.doubleSide);
      if (patch.showUnderground !== undefined) {
        setShowUnderground(this._instance.material, patch.showUnderground > 0);
      }
      const waves = this.waveProps(patch);
      // `frame` changes every tick of a playback; leave the waves alone then.
      if (Object.values(waves).some((value) => value !== undefined)) {
        this.enhancer?.update({ water: waves });
      }
      if (patch.colorBy !== undefined) this.showProperty(patch.colorBy, true);
      this.emit("needsUpdate");
    }
    super.onUpdateConfig(updates);
  }

  protected disposeMesh(): void {
    if (!this._instance) return;
    this.depthPrePass?.dispose();
    this.enhancer?.mutates().water.dispose();
    this._instance.geometry.dispose();
    this.ctx.removeShadowMaterial(this._instance.material);
    this._instance.material.dispose();
    this.uniforms.uWaterSeries.value?.dispose();
    this.uniforms.uWaterFlow.value?.dispose();
    this.uniforms.uWaterNodeAt.value?.dispose();
    for (const content of this.contents) content?.lut?.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }

  override onDestroy(): void {
    this.loading?.abort();
    this.disposeMesh();
    super.onDestroy();
  }
}

/** Throws unless `fillSlot` can show `colorBy` of `series`. */
/** Whether `colorBy` shows each cell's own value, not one interpolated. */
const isNearest = ({ interpolate, scale }: TimeSeriesFloodColorBy) =>
  !(interpolate ?? scale.type !== "category");

const checkScale = (scale: TimeSeriesFloodColorBy["scale"]) => {
  if (scale.type === "linear") {
    if (scale.stops.length < 2) {
      throw new Error("TimeSeriesFloodMesh: a linear scale needs 2 stops");
    }
    return;
  }
  const edges = scale.type === "threshold" ? scale.breaks : scale.values;
  const expected = scale.type === "threshold" ? edges.length + 1 : edges.length;
  if (scale.colors.length !== expected) {
    throw new Error(
      `TimeSeriesFloodMesh: a ${scale.type} scale with ${edges.length} ` +
        `${scale.type === "threshold" ? "breaks" : "values"} needs ${expected} colors`,
    );
  }
  if (edges.length > MAX_EDGES) {
    throw new Error(
      `TimeSeriesFloodMesh: a scale has at most ${MAX_EDGES} breaks or values`,
    );
  }
  if (
    scale.type === "threshold" &&
    edges.some((edge, i) => i > 0 && edge <= edges[i - 1])
  ) {
    throw new Error("TimeSeriesFloodMesh: breaks must increase");
  }
};

const setShowUnderground = (material: MeshLambertMaterial, on: boolean) => {
  const { [SHOW_UNDERGROUND_DEFINE]: shown, ...others } =
    material.defines ?? {};
  if ((shown !== undefined) === on) return;
  material.defines = on ? { ...others, [SHOW_UNDERGROUND_DEFINE]: "" } : others;
  material.needsUpdate = true;
};

/** Copies what `from` shows into `to`, sharing the textures. */
const copySlot = (from: SlotUniforms, to: SlotUniforms) => {
  to.Map.value = from.Map.value;
  to.Offset.value = from.Offset.value;
  to.Frames.value = from.Frames.value;
  to.Type.value = from.Type.value;
  to.Nearest.value = from.Nearest.value;
  to.Step.value = from.Step.value;
  to.Lut.value = from.Lut.value;
  to.Domain.value.copy(from.Domain.value);
  to.Edges.value.set(from.Edges.value);
  to.Colors.value.set(from.Colors.value);
  to.Count.value = from.Count.value;
  to.Other.value.copy(from.Other.value);
  to.Missing.value.copy(from.Missing.value);
  to.Opacity.value = from.Opacity.value;
};

const arrayTexture = (
  data: Uint16Array,
  layers: number,
  format: typeof RGFormat | typeof RedFormat,
) => {
  const rows =
    data.length / layers / TEXTURE_WIDTH / (format === RGFormat ? 2 : 1);
  const texture = new DataArrayTexture(data, TEXTURE_WIDTH, rows, layers);
  texture.format = format;
  texture.type = HalfFloatType;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

// The series' texels and fields are laid out as the textures are, so they
// upload as they are, without a copy. A layer after the frames holds the
// maximum over them.
const createSeriesTexture = ({ times, texels }: TimeSeriesFloodSeries) =>
  arrayTexture(texels, times.length + 1, RGFormat);

/** A property as half floats above its minimum; a missing value is NaN. */
const createFieldTexture = (field: TimeSeriesFloodField) =>
  arrayTexture(field.data, field.frames > 1 ? field.frames + 1 : 1, RedFormat);

/** The node at each cell, -1 where none, laid out like the series' nodes. */
const createNodeAtTexture = ({ grid, nodes }: TimeSeriesFloodSeries) => {
  const data = new Float32Array(layerSize(grid.width * grid.height)).fill(-1);
  nodes.forEach((cell, i) => (data[cell] = i));
  const texture = new DataTexture(
    data,
    TEXTURE_WIDTH,
    data.length / TEXTURE_WIDTH,
    RedFormat,
    FloatType,
  );
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/** A linear scale's colors over its domain, interpolated in linear RGB. */
const createLut = (stops: [number, Color][]) => {
  const data = new Float32Array(LUT_SIZE * 4);
  const first = stops[0][0];
  const last = stops[stops.length - 1][0];
  for (let i = 0; i < LUT_SIZE; i++) {
    const v = first + ((last - first) * i) / (LUT_SIZE - 1);
    let j = 0;
    while (j + 2 < stops.length && v >= stops[j + 1][0]) j++;
    const [v0, c0] = stops[j];
    const [v1, c1] = stops[j + 1];
    const t = v1 > v0 ? Math.min(Math.max((v - v0) / (v1 - v0), 0), 1) : 1;
    const a = c0.toArray();
    const b = c1.toArray();
    for (let c = 0; c < 3; c++) data[i * 4 + c] = a[c] + (b[c] - a[c]) * t;
    data[i * 4 + 3] = 1;
  }
  const texture = new DataTexture(data, LUT_SIZE, 1, RGBAFormat, FloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/** One vertex per node at its cell center; two triangles per 2×2 nodes. */
const createGeometry = ({
  grid,
  nodes,
  heightBases,
}: TimeSeriesFloodSeries) => {
  const n = nodes.length;
  const high = new Float32Array(n * 3);
  const low = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const node = new Float32Array(n);
  const cell = new Float32Array(n * 2);
  const nodeAt = new Int32Array(grid.width * grid.height).fill(-1);
  const box = new Box3();
  const h = new Vector3();
  const l = new Vector3();
  nodes.forEach((c, i) => {
    nodeAt[c] = i;
    const x = c % grid.width;
    const y = (c - x) / grid.width;
    const position = {
      lng: grid.lng0 + x * grid.lngStep,
      lat: grid.lat0 + y * grid.latStep,
      height: 0,
    };
    const ecef = geodeticToVector3(position);
    box.expandByPoint(ecef);
    encodePositionRTE(ecef, h, l);
    h.toArray(high, i * 3);
    l.toArray(low, i * 3);
    geodeticSurfaceNormal(position).toArray(normal, i * 3);
    node[i] = i;
    cell[i * 2] = x;
    cell[i * 2 + 1] = y;
  });

  // Counter-clockwise seen from above, whichever way the axes run.
  const flip = grid.lngStep > 0 !== grid.latStep > 0;
  const indices: number[] = [];
  for (let y = 0; y + 1 < grid.height; y++) {
    for (let x = 0; x + 1 < grid.width; x++) {
      const a = nodeAt[y * grid.width + x];
      const b = nodeAt[y * grid.width + x + 1];
      const c = nodeAt[(y + 1) * grid.width + x + 1];
      const d = nodeAt[(y + 1) * grid.width + x];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      if (flip) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position_3d_high", new BufferAttribute(high, 3));
  geometry.setAttribute("position_3d_low", new BufferAttribute(low, 3));
  geometry.setAttribute("normal", new BufferAttribute(normal, 3));
  const scaleNormalAndCap = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    scaleNormalAndCap.set(normal.subarray(i * 3, i * 3 + 3), i * 4);
  }
  geometry.setAttribute(
    "scaleNormalAndCap",
    new BufferAttribute(scaleNormalAndCap, 4),
  );
  geometry.setAttribute(
    "attrBatchId",
    new BufferAttribute(new Float32Array(n), 1),
  );
  geometry.setAttribute("aWaterNode", new BufferAttribute(node, 1));
  geometry.setAttribute(
    "aWaterHeightBase",
    new BufferAttribute(heightBases, 1),
  );
  geometry.setAttribute("aWaterCell", new BufferAttribute(cell, 2));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  // Used for transparent sorting only.
  geometry.boundingSphere = box.getBoundingSphere(new Sphere());
  return geometry;
};
