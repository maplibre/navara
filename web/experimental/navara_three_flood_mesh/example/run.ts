import ThreeView, {
  Color,
  geodeticToVector3,
  vector3ToGeodetic,
  type Source,
} from "@navaramap/three";
import type {
  CloudsEffectDesc,
  RainDropEffectDesc,
  RainMeshDesc,
  SkyMeshDesc,
  SphereMeshDesc,
} from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { Vector2, type Vector3 } from "three";

import {
  frameToTime,
  sampleTimeSeriesFlood,
  TimeSeriesFloodMeshDesc,
  timeToFrame,
  type TimeSeriesFloodColorBy,
  type TimeSeriesFloodExtent,
  type TimeSeriesFloodMeshConfig,
  type TimeSeriesFloodProperty,
  type TimeSeriesFloodSeries,
} from "../src";

import { BUILDINGS, IMAGERY, SATELLITE_TILEJSON, TERRAIN } from "./constants";
import { loadFloodDatasets, type FloodDataset } from "./data";
import { addPickPanel, type PickContent } from "./pick";
import {
  addInfo,
  addLegend,
  addSelect,
  addTimeSlider,
  addToggle,
  type Legend,
} from "./slider";

export type CustomDescriptions =
  DefaultDescriptions | { mesh: TimeSeriesFloodMeshConfig };

const formatElapsed = (minutes: number) => {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total - hours * 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

export const run = async (view: ThreeView<CustomDescriptions>) => {
  const params = new URLSearchParams(location.search);
  const datasets = await loadFloodDatasets();
  const requested = params.get("dataset");
  const datasetKey =
    requested && requested in datasets ? requested : Object.keys(datasets)[0];
  const dataset = datasets[datasetKey];
  const startStep = dataset.startStep ?? 0;

  const defaultPlugin = new DefaultPlugin();
  view.addPlugin(defaultPlugin);
  const tilejson = new TileJsonPlugin();
  view.addPlugin(tilejson);
  await view.init();
  view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc);

  const { sun } = defaultPlugin.addDefaultPhotorealScene();
  // Shadows only up close, where they read: each cascade redraws every
  // building, and shadows farther than this fade into the haze anyway.
  sun.update({ sun: { shadowCascadeCount: 2, shadowFar: 1e4 } });
  // The water reflects this sky; without it, it falls back to the light probe.
  view.addMesh<SkyMeshDesc>({ sky: { envMap: true } });
  view.toneMappingExposure = EXPOSURE;

  const showUnderground = Number(
    params.get("showUnderground") ?? dataset.showUnderground ?? 2,
  );
  // Loads in a worker while the map streams in.
  const water = addTimeSeriesFlood(view, dataset, showUnderground);
  const showInfo = addInfo();
  water.handle.ref.on("progress", (fraction) =>
    showInfo([`Loading the flood… ${Math.round(fraction * 100)}%`]),
  );

  addSelect({
    options: Object.entries(datasets).map(([key, d]) => ({
      value: key,
      label: d.label,
    })),
    value: datasetKey,
    onChange: (key) => {
      params.set("dataset", key);
      location.search = params.toString();
    },
  });

  view.setCamera({ ...dataset.camera, roll: 0 });
  // About 10 am local solar time where the camera is.
  view.atmosphere.date = new Date(
    Date.UTC(2024, 9, 21, 10) - (dataset.camera.lng / 15) * 3_600_000,
  );

  const terrain = view.addSource({
    type: "quantized-mesh",
    url: TERRAIN.url,
    maxZoom: 18,
    requestVertexNormals: true,
    requestWaterMask: true,
  });
  view.addLayer({
    type: "terrain",
    source: terrain,
    terrain: { castShadow: true, receiveShadow: true },
  });

  // Layers draw in the order added: the GSI photo over the global imagery.
  const satellite = await tilejson.addSource({
    type: "raster-tile",
    url: SATELLITE_TILEJSON,
  });
  view.addLayer({ type: "raster", source: satellite });
  const imagery = view.addSource({
    type: "raster-tile",
    url: IMAGERY.url,
    minZoom: IMAGERY.minZoom,
    maxZoom: 18,
  });
  view.addLayer({ type: "raster", source: imagery });

  const buildings = view.addSource({
    type: "3d-tiles",
    url: BUILDINGS.url,
  });
  view.addLayer({
    type: "3d-tiles",
    source: buildings,
    model: {
      color: new Color().setStyle("#ffffff"),
      metalness: 0,
      roughness: 1,
      castShadow: true,
      receiveShadow: true,
      height: -0.1,
    },
  });

  let series: TimeSeriesFloodSeries;
  try {
    series = await water.loaded;
  } catch (error) {
    showInfo([`Failed to load the flood: ${String(error)}`]);
    throw error;
  }
  showInfo(null);
  if (dataset.breach) void addBreach(view, terrain, series, dataset.breach);
  const colorings = colorByOptions(series.properties);
  const initialColoring =
    colorings.find((c) => c.value === params.get("colorBy")) ?? colorings[0];
  water.setColoring(initialColoring);
  let coloring = initialColoring;
  addSelect({
    options: colorings,
    value: initialColoring.value,
    onChange: (value) => {
      coloring = colorings.find((c) => c.value === value) ?? colorings[0];
      water.setColoring(coloring);
      showLegend(coloring.legend);
      timeline.setEnabled(coloring.extent === "frame");
      refreshPick();
      params.set("colorBy", value);
      history.replaceState(null, "", `?${params}`);
    },
  });
  const weather = addWeather(view, dataset);
  const cloudsShown = params.get("clouds") !== "off";
  weather.setClouds(cloudsShown);
  addToggle({
    label: "Clouds",
    checked: cloudsShown,
    onChange: (checked) => {
      weather.setClouds(checked);
      if (checked) params.delete("clouds");
      else params.set("clouds", "off");
      history.replaceState(null, "", `?${params}`);
    },
  });
  addToggle({
    label: "Water below the terrain",
    checked: showUnderground > 0,
    onChange: (checked) => {
      const meters = checked ? (dataset.showUnderground ?? 2) : 0;
      water.setShowUnderground(meters);
      if (meters === (dataset.showUnderground ?? 0)) {
        params.delete("showUnderground");
      } else params.set("showUnderground", String(meters));
      history.replaceState(null, "", `?${params}`);
    },
  });
  // Below the controls, as it comes and goes with the coloring.
  const showLegend = addLegend();
  showLegend(initialColoring.legend);

  // Minutes since the first step; the frame is fractional between steps,
  // which need not be evenly spaced.
  const stepTimes = series.times.map((t) => t.getTime());
  const minutesOf = (frame: number) =>
    (frameToTime(series, frame).getTime() - stepTimes[0]) / 60_000;
  const frameOf = (minutes: number) =>
    timeToFrame(series, stepTimes[0] + minutes * 60_000);
  const originOffset = dataset.origin
    ? (stepTimes[0] - Date.parse(dataset.origin)) / 60_000
    : 0;
  const formatSinceOrigin = (minutes: number) =>
    formatElapsed(minutes + originOffset);
  // Playback lingers on the intervals where the extent changes most (the
  // breach and the drain) and skims the quiet ones; the busiest interval
  // takes about 8 s.
  const flips = series.changes;
  // At least 1, so a series whose extent never changes still plays.
  const maxFlips = Math.max(1, ...flips);
  const playSpeed = (minutes: number) => {
    const k = Math.min(Math.floor(frameOf(minutes)), flips.length - 1);
    const seconds = 0.25 + (8 * flips[k]) / maxFlips;
    return (stepTimes[k + 1] - stepTimes[k]) / 60_000 / seconds;
  };
  let frame = startStep;

  // The clicked point: a marker on the map, and the water there in a panel
  // that follows the time and the coloring.
  const setMarker = addPickMarker(view);
  let picked: PickedPoint | undefined;
  const clearPick = () => {
    picked = undefined;
    setMarker(null);
    showPick(null);
  };
  const showPick = addPickPanel(clearPick);
  const refreshPick = () => {
    if (!picked) return;
    showPick(
      describePick(
        series,
        picked,
        coloring.extent === "max" ? "max" : frame,
        formatSinceOrigin,
      ),
    );
  };
  view.on("click", (event) => {
    const position = view.pickDepthPosition(event.clientX, event.clientY);
    if (!position) return clearPick();
    const { lng, lat, height } = vector3ToGeodetic(position);
    const point = { lng, lat, timeline: timelineAt(series, { lng, lat }) };
    picked = point;
    setMarker({ lng, lat, height });
    refreshPick();
    // A series without a depth has one over the terrain once it is sampled.
    if (point.timeline.depth) return;
    void view
      .sampleTerrainMostDetailed(terrain, [{ lng, lat }])
      .then(([{ height: ground }]) => {
        if (picked !== point || ground === undefined) return;
        picked = {
          ...point,
          ground,
          timeline: timelineAt(series, { lng, lat }, ground),
        };
        refreshPick();
      });
  });

  const onChange = (minutes: number) => {
    frame = frameOf(minutes);
    water.setFrame(frame);
    weather.setHours(minutes / 60);
    refreshPick();
  };
  const startMinutes = minutesOf(startStep);
  onChange(startMinutes);
  const timeline = addTimeSlider({
    max: minutesOf(stepTimes.length - 1),
    value: startMinutes,
    step: 10,
    playSpeed,
    format: formatSinceOrigin,
    title: dataset.since ?? "since the first step",
    disabledLabel: "Whole flood",
    onChange,
  });
  timeline.setEnabled(initialColoring.extent === "frame");

  view.attribution?.add([
    TERRAIN,
    IMAGERY,
    BUILDINGS,
    {
      attribution: dataset.attribution,
      attributionUrl: dataset.attributionUrl,
    },
  ]);
};

/**
 * Flood as one water-surface mesh: every step is on the GPU and a fractional
 * frame interpolates the height and extent to the next step. The mesh loads
 * the dataset's series, which `loaded` resolves to.
 */
const addTimeSeriesFlood = (
  view: ThreeView<CustomDescriptions>,
  { url, startStep = 0, waterColor = "#5a3f1c" }: FloodDataset,
  showUnderground: number,
) => {
  const water = view.addMesh<TimeSeriesFloodMeshDesc>({
    timeSeriesFlood: {
      url,
      frame: startStep,
      color: new Color().setStyle(waterColor),
      opacity: 0.98,
      shallowOpacity: 0.5,
      absorption: 0.6,
      // Keeps the surface visible from a street-level camera under water.
      doubleSide: true,
      showUnderground,
    },
  });
  return {
    handle: water,
    loaded: new Promise<TimeSeriesFloodSeries>((resolve, reject) => {
      water.ref.on("load", resolve);
      water.ref.on("error", reject);
    }),
    setFrame: (frame: number) => water.update({ timeSeriesFlood: { frame } }),
    setShowUnderground: (showUnderground: number) =>
      water.update({ timeSeriesFlood: { showUnderground } }),
    setColoring: ({ colorBy, extent }: Coloring) =>
      water.update({ timeSeriesFlood: { colorBy, extent } }),
  };
};

// The scene's exposure. Markers pass through it like everything drawn, so
// their colors are divided by it to show as given.
const EXPOSURE = 10;
const markerColor = (style: string) => {
  const [r, g, b] = colorOf(style).toArray();
  return new Color().setRGBLinear(r / EXPOSURE, g / EXPOSURE, b / EXPOSURE);
};

/**
 * The camera's distance in meters to `point` (ECEF). The engine's camera
 * position is not available on the first frames; the rendering camera's is.
 */
const distanceTo = (view: ThreeView<CustomDescriptions>, point: Vector3) =>
  view.camera.raw.position.distanceTo(point);

// The markers' radii per meter of camera distance, so they keep their size
// on screen, and the breach marker's pulse.
const BREACH_SIZE = 0.008;
const PICK_SIZE = 0.007;
const PULSE_MS = 1600;
const PULSE_GROWTH = 3;

/**
 * The levee breach: an unlit red sphere with a shell of it pulsing outward,
 * on the ground or on the water at its highest, which would hide it
 * otherwise.
 */
const addBreach = async (
  view: ThreeView<CustomDescriptions>,
  terrain: Source,
  series: TimeSeriesFloodSeries,
  { lng, lat }: NonNullable<FloodDataset["breach"]>,
) => {
  const [ground] = await view.sampleTerrainMostDetailed(terrain, [
    { lng, lat },
  ]);
  const water = sampleTimeSeriesFlood(series, { lng, lat }, "max")?.level;
  const place = {
    lng,
    lat,
    height: Math.max(ground.height ?? 0, water ?? -Infinity),
  };
  const red = markerColor("#e53935");
  const core = view.addMesh<SphereMeshDesc>({
    lit: false,
    sphere: { color: red },
    geodetic: place,
  });
  const pulse = view.addMesh<SphereMeshDesc>({
    lit: false,
    // Blended, the shell takes the color as given; divided by the exposure,
    // it barely shows.
    sphere: { color: colorOf("#e53935"), transparent: true, opacity: 0 },
    geodetic: place,
  });

  const center = geodeticToVector3(place);
  let sorted = false;
  view.on("preUpdate", () => {
    const shell = pulse.ref.raw;
    if (!sorted && shell) {
      // Blended meshes sort by distance, so the water, whose center is far
      // off, would draw over the shell at some angles; the shell draws last
      // and, writing no depth, hides nothing behind it.
      shell.renderOrder = 1;
      shell.material.depthWrite = false;
      sorted = true;
    }
    const size = distanceTo(view, center) * BREACH_SIZE;
    const t = (performance.now() % PULSE_MS) / PULSE_MS;
    // Resting on the surface; the pulse spreads from the sphere's center.
    const lifted = { ...place, height: place.height + size };
    core.update({ geodetic: { ...lifted, scale: size } });
    pulse.update({
      geodetic: { ...lifted, scale: size * (1 + PULSE_GROWTH * t) },
      sphere: { opacity: 0.6 * (1 - t) ** 2 },
    });
  });
};

/** A marker at the picked point; `null` hides it. */
const addPickMarker = (view: ThreeView<CustomDescriptions>) => {
  let place: { lng: number; lat: number; height: number } | undefined;
  let center = geodeticToVector3({ lng: 0, lat: 0, height: 0 });
  const marker = view.addMesh<SphereMeshDesc>({
    lit: false,
    visible: false,
    sphere: { color: markerColor("#00b0ff") },
    geodetic: { lng: 0, lat: 0 },
  });
  view.on("preUpdate", () => {
    if (!place) return;
    // Resting on the picked surface.
    const size = distanceTo(view, center) * PICK_SIZE;
    marker.update({
      geodetic: { ...place, height: place.height + size, scale: size },
    });
  });
  return (position: { lng: number; lat: number; height: number } | null) => {
    place = position ?? undefined;
    if (position) center = geodeticToVector3(position);
    marker.update({ visible: !!position });
  };
};

type PickedPoint = {
  lng: number;
  lat: number;
  /** The terrain height there, for a series without a depth. */
  ground?: number;
  timeline: ReturnType<typeof timelineAt>;
};

/**
 * The water level over `ground`, as deep as the series' own depth would
 * be: the model's ground and the terrain differ, so it is never below 0.
 */
const depthOver = (level: number | undefined, ground: number | undefined) =>
  level !== undefined && ground !== undefined
    ? Math.max(level - ground, 0)
    : undefined;

/**
 * The depth at a point in every frame, or the water level where the series
 * has no depth and the terrain height is not known, for the chart.
 */
const timelineAt = (
  series: TimeSeriesFloodSeries,
  position: { lng: number; lat: number },
  ground?: number,
) => {
  const own = "depth" in series.properties;
  const values = series.times.map((_, k) => {
    const sample = sampleTimeSeriesFlood(series, position, k);
    if (own) return sample?.properties.depth;
    return ground === undefined
      ? sample?.level
      : depthOver(sample?.level, ground);
  });
  return { depth: own || ground !== undefined, values };
};

/** The pick panel's content for a point at `frame`. */
const describePick = (
  series: TimeSeriesFloodSeries,
  { lng, lat, ground, timeline }: PickedPoint,
  frame: number | "max",
  formatTime: (minutes: number) => string,
): PickContent => {
  const sample = sampleTimeSeriesFlood(series, { lng, lat }, frame);
  if (!sample) return { lng, lat, tone: "never", rows: [] };
  const max = frame === "max";
  const { depth: own, ...others } = sample.properties;
  const depth = own ?? depthOver(sample.level, ground);
  const headline =
    depth !== undefined
      ? {
          label: max ? "maximum depth" : "deep",
          value: `${depth.toFixed(2)} m`,
        }
      : sample.level !== undefined
        ? {
            label: max ? "highest water level" : "water level",
            value: `${sample.level.toFixed(2)} m`,
          }
        : undefined;
  const rows = Object.entries(others).map(([name, value]) => {
    const { label = name, units } = series.properties[name];
    const digits = Math.abs(value) >= 10 ? 0 : 2;
    return {
      label: label[0].toUpperCase() + label.slice(1),
      value: units
        ? `${value.toFixed(digits)} ${units}`
        : value.toFixed(digits),
    };
  });
  const times = series.times.map((t) => t.getTime());
  const span = times[times.length - 1] - times[0];
  const place = (t: number) => (t - times[0]) / span;
  return {
    lng,
    lat,
    tone: max ? "max" : sample.wet ? "wet" : "dry",
    headline,
    rows,
    chart: {
      title: timeline.depth ? "Depth (m)" : "Water level (m)",
      xs: times.map(place),
      values: timeline.values,
      fromLowest: !timeline.depth,
      cursor: max ? undefined : place(frameToTime(series, frame).getTime()),
      from: formatTime(0),
      to: formatTime(span / 60_000),
    },
  };
};

type Coloring = {
  value: string;
  label: string;
  colorBy: TimeSeriesFloodColorBy | null;
  /** `max` for a map over the flood as a whole, such as the arrival time. */
  extent: TimeSeriesFloodExtent;
  legend: Legend | null;
};

const colorOf = (style: string) => new Color().setStyle(style);

// The hazard-map depth classes and their colors, as published by MLIT.
const HAZARD_BREAKS = [0.5, 3, 5, 10, 20];
const HAZARD_COLORS = [
  "#f7f5a9",
  "#ffd8c0",
  "#ffb7b7",
  "#ff9191",
  "#f285c9",
  "#dc7adc",
];

// Google's Turbo colormap, sampled every eighth.
const TURBO = [
  "#30123b",
  "#4662d7",
  "#36aaf9",
  "#1ae4b6",
  "#72fe5e",
  "#c7ef34",
  "#faba39",
  "#f66b19",
  "#7a0403",
];

const threshold = (
  property: string,
  title: string,
  breaks: number[],
  styles: string[],
  unit: string,
  interpolate?: boolean,
): Omit<Coloring, "value" | "label" | "extent"> => ({
  colorBy: {
    property,
    scale: { type: "threshold", breaks, colors: styles.map(colorOf) },
    interpolate,
  },
  legend: {
    title,
    rows: styles.map((color, i) => ({
      color,
      label:
        i === 0
          ? `< ${breaks[0]} ${unit}`
          : i === breaks.length
            ? `≥ ${breaks[i - 1]} ${unit}`
            : `${breaks[i - 1]} – ${breaks[i]} ${unit}`,
    })),
  },
});

/**
 * A gradient through `styles` over `[min, max]`, which the legend marks as
 * open-ended where it cuts the property's `range` off.
 */
const linear = (
  property: string,
  title: string,
  range: TimeSeriesFloodProperty,
  [min, max]: [number, number],
  styles: string[],
  format: (v: number) => string,
): Omit<Coloring, "value" | "label" | "extent"> => ({
  colorBy: {
    property,
    scale: {
      type: "linear",
      stops: styles.map((style, i) => [
        min + ((max - min) * i) / (styles.length - 1),
        colorOf(style),
      ]),
    },
  },
  legend: {
    title,
    gradient: {
      colors: styles,
      from: min > range.min ? `≤ ${format(min)}` : format(min),
      to: max < range.max ? `≥ ${format(max)}` : format(max),
    },
  },
});

/** One way to color the surface per property the series has, and as water. */
const colorByOptions = (
  properties: Record<string, TimeSeriesFloodProperty>,
): Coloring[] => {
  const options: Coloring[] = [
    {
      value: "water",
      label: "Water",
      colorBy: null,
      extent: "frame",
      legend: null,
    },
  ];
  const add = (
    value: string,
    label: string,
    c: Omit<Coloring, "value" | "label" | "extent">,
    extent: TimeSeriesFloodExtent = "frame",
  ) => options.push({ value, label, extent, ...c });
  const titleOf = (
    name: string,
    { label = name, units }: TimeSeriesFloodProperty,
  ) => (units ? `${label} (${units})` : label);
  const fixed = (digits: number) => (v: number) => v.toFixed(digits);
  // Red is the dangerous end: deep, fast, soon, long, low-lying. The
  // domains leave the outliers out, so a few extreme cells do not flatten
  // the rest to one color.
  const hot = TURBO;
  const cold = [...TURBO].reverse();
  for (const [name, range] of Object.entries(properties)) {
    switch (name) {
      case "depth":
        add(
          "depth",
          "Depth (hazard-map classes)",
          threshold("depth", "Depth", HAZARD_BREAKS, HAZARD_COLORS, "m"),
        );
        add(
          "depth-max",
          "Maximum depth (hazard-map classes)",
          threshold(
            "depth",
            "Maximum depth",
            HAZARD_BREAKS,
            HAZARD_COLORS,
            "m",
          ),
          "max",
        );
        add(
          "depth-cells",
          "Depth (classes per cell)",
          threshold(
            "depth",
            "Depth, per cell",
            HAZARD_BREAKS,
            HAZARD_COLORS,
            "m",
            false,
          ),
        );
        add(
          "depth-heatmap",
          "Depth (heatmap)",
          linear("depth", "Depth (m)", range, [0, range.high], hot, fixed(1)),
        );
        break;
      case "speed":
        add(
          "speed",
          "Flow speed",
          linear(
            "speed",
            "Flow speed (m/s)",
            range,
            [0, range.high],
            hot,
            fixed(1),
          ),
        );
        break;
      case "arrival":
        add(
          "arrival",
          "Arrival time",
          linear(
            "arrival",
            titleOf(name, range),
            range,
            [0, range.high],
            cold,
            fixed(0),
          ),
          "max",
        );
        break;
      case "duration":
        add(
          "duration",
          "Hours wet",
          linear(
            "duration",
            titleOf(name, range),
            range,
            [0, range.high],
            hot,
            fixed(0),
          ),
          "max",
        );
        break;
      case "ground":
        // Terrain, kept for deriving the depth; the terrain layer shows it.
        break;
      case "rate":
        add(
          "rate",
          "Level change",
          threshold(
            "rate",
            "Level change (m/h)",
            [-0.5, -0.1, 0.1, 0.5],
            ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
            "m/h",
          ),
        );
        break;
      default:
        add(
          name,
          name,
          linear(
            name,
            titleOf(name, range),
            range,
            [range.low, range.high],
            hot,
            fixed(2),
          ),
        );
    }
  }
  return options;
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The dataset's weather (see {@link FloodDataset.weather}), or a clear sky
 * without one.
 */
const addWeather = (
  view: ThreeView<CustomDescriptions>,
  { weather }: FloodDataset,
) => {
  const clouds = view.addEffect<CloudsEffectDesc>({
    clouds: {
      coverage: 0.6,
      localWeatherVelocity: new Vector2(0.005, 0.001),
      absorptionCoefficient: 5,
      haze: true,
      hazeDensityScale: 0.001,
      hazeExponent: 0.002,
      hazeAbsorptionCoefficient: 1.5,
    },
  });
  const rain = view.addMesh<RainMeshDesc>({
    rain: { particleCount: 5000, followCamera: true },
  });
  const rainDrop = view.addEffect<RainDropEffectDesc>({
    rainDrop: {
      opacity: 0.5,
      dropDensity: 0.2,
      refractionStrength: 0.2,
      dropSizeFactor: 0.03,
      dropGridSize: 25,
    },
  });

  let last = { rain: NaN, clear: NaN };
  // Turned off, the sky keeps no cloud whatever the hour.
  let cloudy = true;
  const setCoverage = () =>
    clouds.update({
      clouds: { coverage: cloudy ? lerp(0.6, 0.15, last.clear) : 0 },
    });
  const setHours = (hours: number) => {
    // Quantized, so scrubbing within a still phase updates nothing.
    const next = weather
      ? {
          rain:
            Math.round((1 - smoothstep(...weather.rainStops, hours)) * 50) / 50,
          clear: Math.round(smoothstep(...weather.clears, hours) * 50) / 50,
        }
      : { rain: 0, clear: 1 };
    if (next.rain !== last.rain) {
      rain.update({
        visible: next.rain > 0,
        rain: { opacity: 0.5 * next.rain },
      });
      // Hidden, not just transparent: at opacity 0 the full-screen pass
      // still runs every frame.
      rainDrop.update({
        visible: next.rain > 0,
        rainDrop: { opacity: 0.5 * next.rain },
      });
      // Dark storm clouds turn white once the rain stops.
      clouds.update({
        clouds: {
          absorptionCoefficient: lerp(0, 5, next.rain),
          hazeAbsorptionCoefficient: lerp(0.3, 1.5, next.rain),
        },
      });
    }
    const cleared = next.clear !== last.clear;
    last = next;
    if (cleared) {
      clouds.update({
        clouds: { hazeDensityScale: lerp(0.001, 0.0002, next.clear) },
      });
      setCoverage();
    }
  };
  return {
    setHours,
    setClouds: (shown: boolean) => {
      cloudy = shown;
      // Before the first hour, `setHours` sets the coverage.
      if (!Number.isNaN(last.clear)) setCoverage();
    },
  };
};
