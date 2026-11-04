/**
 * Road classes and their styles, and the readers that turn tile feature
 * properties into a road class and a roof height. The road layer and the
 * lamp and car placement both read roads through here.
 */

// --- Road styles -----------------------------------------------------------

export type RoadStyle = {
  /** Width of the road surface in pixels. */
  readonly width: number;
  /**
   * Street lamp spacing along the road and distance from the centerline, in
   * meters.
   */
  readonly lamp: { readonly spacing: number; readonly offset: number };
  /**
   * Cars per direction: one every `spacing` meters, driving `lane` meters
   * left of the centerline (left-hand traffic) at about `speed` m/s.
   */
  readonly traffic: {
    readonly spacing: number;
    readonly lane: number;
    readonly speed: number;
  };
};

/** The OpenMapTiles `transportation` classes with a style in {@link ROADS}. */
export type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "minor"
  | "service";

/**
 * Road styles by OpenMapTiles `transportation` class, from motorways down to
 * service roads.
 */
export const ROADS: Readonly<Record<RoadClass, RoadStyle>> = {
  motorway: {
    width: 6,
    lamp: { spacing: 30, offset: 9 },
    traffic: { spacing: 25, lane: 6, speed: 22 },
  },
  trunk: {
    width: 5,
    lamp: { spacing: 30, offset: 7 },
    traffic: { spacing: 30, lane: 4.5, speed: 14 },
  },
  primary: {
    width: 4.5,
    lamp: { spacing: 35, offset: 7 },
    traffic: { spacing: 35, lane: 4.5, speed: 12 },
  },
  secondary: {
    width: 4,
    lamp: { spacing: 40, offset: 6 },
    traffic: { spacing: 50, lane: 3.5, speed: 11 },
  },
  tertiary: {
    width: 3.5,
    lamp: { spacing: 45, offset: 5 },
    traffic: { spacing: 70, lane: 3, speed: 9 },
  },
  minor: {
    width: 2.5,
    lamp: { spacing: 60, offset: 4 },
    traffic: { spacing: 120, lane: 2.5, speed: 7 },
  },
  service: {
    width: 1.5,
    lamp: { spacing: 90, offset: 3 },
    traffic: { spacing: 250, lane: 1.5, speed: 5 },
  },
};

// --- Reading road and building features ------------------------------------

/** `1` forward only, `-1` backward only, `0` both ways. */
export type Oneway = 1 | -1 | 0;

/**
 * Reads one road feature's properties: which {@link RoadClass} it is drawn
 * and lit as, and its direction (`1` forward only, `-1` backward only, `0`
 * both ways, the default), or `undefined` for a feature that carries no
 * lights. A tile set with its own road kinds maps them onto these classes.
 */
export type RoadReader = (
  properties: Record<string, unknown>,
) => { roadClass: RoadClass; oneway?: Oneway } | undefined;

/**
 * Reads one building feature's properties: the height of its roof in meters
 * above the ellipsoid, or `undefined` for a building without a beacon. The
 * beacon sits 2 m above it and is not clamped to the ground, so buildings
 * standing on terrain need the ground height added.
 */
export type BuildingReader = (
  properties: Record<string, unknown>,
) => number | undefined;

/** Where the roads are and how to read them: the one place both the road layer and the placement read from. */
export type RoadSchema = {
  /** Tile layer holding the road centerlines. */
  layer: string;
  read: RoadReader;
  /** The only properties the reader sees, or all of them when absent. */
  properties: string[] | undefined;
};

type BuildingSchema = {
  /** Tile layer holding the building footprints. */
  layer: string;
  read: BuildingReader;
};

export type TileSchema = { roads: RoadSchema; buildings: BuildingSchema };

// Buildings at least this tall get a beacon. High enough that skyscraper
// districts do not turn into a red mass.
const TALL_BUILDING_HEIGHT = 90;

// Own keys only: a class named like an Object.prototype member is not a road.
const isRoadClass = (value: unknown): value is RoadClass =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(ROADS, value);

/** OpenMapTiles `transportation`: `class` is the road class, `oneway` the direction. */
export const openMapTilesRoad: RoadReader = (properties) => {
  const roadClass = properties.class;
  if (!isRoadClass(roadClass)) return undefined;
  const oneway = properties.oneway;
  return { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 };
};

/** OpenMapTiles `building`: `render_height`, with a beacon from 90 m up. */
export const openMapTilesBuilding: BuildingReader = (properties) => {
  const height = properties.render_height;
  return typeof height === "number" && height >= TALL_BUILDING_HEIGHT
    ? height
    : undefined;
};

export const OPEN_MAP_TILES: TileSchema = {
  roads: {
    layer: "transportation",
    read: openMapTilesRoad,
    // What openMapTilesRoad reads, kept next to it.
    properties: ["class", "oneway"],
  },
  buildings: { layer: "building", read: openMapTilesBuilding },
};

// --- Reading one road ------------------------------------------------------

/**
 * The named properties only, shaped as the road layer's evaluator gets them:
 * every name present, `undefined` when the feature lacks it, own keys only.
 */
export const pickProperties = (
  properties: Record<string, unknown>,
  names: string[],
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {};
  for (const name of names) {
    picked[name] = Object.prototype.hasOwnProperty.call(properties, name)
      ? properties[name]
      : undefined;
  }
  return picked;
};

/**
 * Reads one road feature through the schema. The road layer and the lamp and
 * car placement both go through here, so they agree on which features are
 * roads. `properties` must already be limited to `schema.properties`, as the
 * road layer's evaluator gets them.
 */
export const readRoadFeature = (
  schema: RoadSchema,
  properties: Record<string, unknown>,
): { style: RoadStyle; oneway: Oneway } | undefined => {
  const road = schema.read(properties);
  if (!road) return undefined;
  return { style: ROADS[road.roadClass], oneway: road.oneway ?? 0 };
};
