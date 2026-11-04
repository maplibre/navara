/**
 * StreetLightsPlugin — Navara Plugin for street lamps, roof beacons and
 * traffic at night.
 *
 * Hides everything but the roads on a road layer the caller styled
 * ({@link StreetLightsPlugin.addRoads}), then streams the zoom-14 tiles of
 * the same tile set in around a position ({@link StreetLightsPlugin.start}
 * and {@link StreetLightsPlugin.follow}) to place street lamps along every
 * road, a red beacon on every tall roof, and cars that drive the road
 * segments. The tiles are fetched a second time by this plugin: the engine
 * decodes them for rendering but exposes no feature geometry.
 *
 * The tiles are read through {@link StreetLightsConfig.roads} and
 * {@link StreetLightsConfig.buildings}, which default to the OpenMapTiles
 * schema; another schema needs its own {@link RoadReader} and
 * {@link BuildingReader}.
 *
 * The lamps and beacons are `point` layers that take part in the selective
 * effects given to `start()`, such as the built-in `selectiveBloom`. The cars
 * are additive points drawn by {@link StreetTrafficMeshDesc}, which the plugin
 * registers; add {@link StreetTrafficDescriptions} to the view's type
 * parameter for the typed handles.
 *
 * ## Usage
 *
 * ```ts
 * import ThreeView, { Color } from "@navaramap/three";
 * import type { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";
 * import {
 *   DefaultPlugin,
 *   type DefaultDescriptions,
 * } from "@navaramap/three-default-plugin";
 * import {
 *   StreetLightsPlugin,
 *   TileJsonPlugin,
 *   type StreetTrafficDescriptions,
 * } from "@navaramap/three-plugins";
 *
 * // The cars move every frame.
 * const view = new ThreeView<DefaultDescriptions | StreetTrafficDescriptions>({
 *   container,
 *   animation: true,
 * });
 * view.addPlugin(new DefaultPlugin());
 * const tilejson = new TileJsonPlugin();
 * view.addPlugin(tilejson);
 * const streetLights = new StreetLightsPlugin({ radius: 2 });
 * view.addPlugin(streetLights);
 * await view.init();
 *
 * const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });
 *
 * // An OpenMapTiles-schema vector tile set; its TileJSON also names the tile
 * // URL template the plugin streams the roads from.
 * let tileTemplate = "";
 * tilejson.on("loaded", ({ tilejson: document }) => {
 *   tileTemplate = document.tiles[0];
 * });
 * const streets = await tilejson.addSource({
 *   type: "vector-tile",
 *   url: "https://tiles.openfreemap.org/planet",
 * });
 *
 * // Dark road surfaces; the plugin hides every class that carries no lights.
 * const roads = view.addLayer({
 *   type: "vector",
 *   source: streets,
 *   sourceLayers: ["transportation"],
 *   polyline: { color: new Color().setStyle("#15171c"), clampToGround: true },
 * });
 * streetLights.addRoads(roads);
 * streetLights.start({ tileTemplate, effectIds: [bloom.id] });
 * view.on("postUpdate", () => {
 *   const { lng, lat } = view.camera.positionGeographic;
 *   streetLights.follow(lng, lat);
 * });
 *
 * // Later: drop every layer and mesh the plugin added.
 * streetLights.dispose();
 * ```
 */
import type ThreeView from "@navaramap/three";
import {
  Color,
  Plugin,
  geodeticToVector3,
  type FeatureEvaluator,
  type Layer,
  type MeshHandle,
  type Source,
  type ViewContext,
} from "@navaramap/three";

import { buildTraffic, mulberry32, tileLights, tileSeed } from "./placement";
import {
  OPEN_MAP_TILES,
  readRoadFeature,
  type BuildingReader,
  type RoadReader,
  type RoadSchema,
  type TileSchema,
} from "./roads";
import {
  StreetTrafficMeshDesc,
  type StreetTrafficDescriptions,
  type StreetTrafficOptions,
} from "./StreetTrafficMeshDesc";
import {
  createTileStreamer,
  loadRoadNetwork,
  tileCenter,
  type RoadNetwork,
  type TileCoordinate,
  type TileStreamer,
} from "./tiles";

type View = ThreeView<StreetTrafficDescriptions>;

export {
  type BuildingReader,
  type Oneway,
  type RoadClass,
  type RoadReader,
} from "./roads";

export type StreetLightsRoads = {
  /**
   * Tile layer holding the road centerlines.
   * @defaultValue "transportation"
   */
  layer?: string;
} & (
  | {
      /** The OpenMapTiles reader: `class` is the road class, `oneway` the direction. */
      read?: undefined;
      properties?: undefined;
    }
  | {
      /** Reads one road feature's properties. */
      read: RoadReader;
      /**
       * Properties the reader needs. The reader sees only these, both on the
       * road layer and when the lamps and cars are placed. All properties
       * when omitted.
       */
      properties?: string[];
    }
);

export type StreetLightsBuildings = {
  /**
   * Tile layer holding the building footprints.
   * @defaultValue "building"
   */
  layer?: string;
  /**
   * Reads one building feature's properties.
   * @defaultValue the OpenMapTiles reader: `render_height`, with a beacon from 90 m up
   */
  read?: BuildingReader;
};

export type StreetLightsConfig = {
  /**
   * Tiles of lights kept loaded around the followed position, as a radius in
   * zoom-14 tiles (2 is a 5 × 5 block, about 10 km across at Tokyo's
   * latitude).
   * @defaultValue 2
   */
  radius?: number;
  traffic?: StreetTrafficOptions;
  roads?: StreetLightsRoads;
  buildings?: StreetLightsBuildings;
};

export type StreetLightsStartOptions = {
  /** A `{z}/{x}/{y}` tile URL of the tile set the road layer shows. */
  tileTemplate: string;
  /**
   * Selective effects the lamps and beacons take part in, such as a bloom.
   * @defaultValue []
   */
  effectIds?: string[];
};

export type StreetLightsUpdate = {
  traffic?: StreetTrafficOptions;
};

// Mixed with the tile coordinate, so each tile places its lights the same way
// each time it streams in.
const PLACEMENT_SEED = 7;

const LIGHT_COLORS = {
  lamp: new Color().setStyle("#fff6e0"),
  warm: new Color().setStyle("#ffb347"),
  beacon: new Color().setStyle("#ff2a1a"),
};

/**
 * Evaluated values win over the material, so `show` cannot be toggled on a
 * layer: the evaluators read these flags instead, and `forceUpdate()` re-runs
 * them. `visible` is the street-level detail as a whole; `lightsOn` the
 * lamps, beacons and traffic within it.
 */
type Flags = { visible: boolean; lightsOn: boolean };

/** A road layer given to `addRoads()` and the handlers attached to it. */
type Surface = {
  layer: Layer;
  apply: (event: { evaluator: FeatureEvaluator }) => void;
  forget: () => void;
};

const lampEvaluator =
  (flags: Flags) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        if (!flags.visible || !flags.lightsOn) return { show: false };
        switch (properties?.kind) {
          case "lamp":
            // The layer's material gives the plain lamp's look.
            return { show: true };
          case "warm":
            return {
              show: true,
              color: LIGHT_COLORS.warm,
              emissive: LIGHT_COLORS.warm,
              size: 2.5,
            };
        }
        return { show: false };
      },
      { filters: ["kind"] },
    );
  };

const beaconEvaluator =
  (flags: Flags) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        if (!flags.visible || !flags.lightsOn) return { show: false };
        const height = properties?.height;
        return { show: true, height: typeof height === "number" ? height : 0 };
      },
      { filters: ["height"] },
    );
  };

const surfaceEvaluator =
  (flags: Flags, roads: RoadSchema) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const road = flags.visible
          ? readRoadFeature(roads, properties ?? {})
          : undefined;
        if (!road) return { show: false };

        return { show: true, width: road.style.width };
      },
      { filters: roads.properties },
    );
  };

/** Everything one tile adds to the view. */
type StreetTile = {
  lampSource: Source;
  lamps: Layer;
  beaconSource: Source;
  beacons: Layer;
  traffic: MeshHandle<StreetTrafficMeshDesc>;
};

const removeTile = (tile: StreetTile) => {
  tile.lamps.delete();
  tile.lampSource.delete();
  tile.beacons.delete();
  tile.beaconSource.delete();
  tile.traffic.delete();
};

export class StreetLightsPlugin extends Plugin<View, ViewContext> {
  private view?: View;
  private streamer?: TileStreamer<StreetTile>;
  private surfaces: Surface[] = [];
  private readonly radius: number;
  private readonly schema: TileSchema;
  private readonly traffic: StreetTrafficOptions;
  private readonly flags: Flags = { visible: true, lightsOn: true };
  private effectIds: string[] = [];

  constructor({
    radius = 2,
    traffic = {},
    roads = {},
    buildings = {},
  }: StreetLightsConfig = {}) {
    super();
    this.radius = radius;
    this.schema = {
      // A reader and the properties it reads come together: the defaults
      // as a pair, or the caller's as a pair.
      roads: {
        layer: roads.layer ?? OPEN_MAP_TILES.roads.layer,
        ...(roads.read
          ? { read: roads.read, properties: roads.properties }
          : {
              read: OPEN_MAP_TILES.roads.read,
              properties: OPEN_MAP_TILES.roads.properties,
            }),
      },
      buildings: {
        layer: buildings.layer ?? OPEN_MAP_TILES.buildings.layer,
        read: buildings.read ?? OPEN_MAP_TILES.buildings.read,
      },
    };
    this.traffic = { ...traffic };
  }

  async init(view: View, _ctx: ViewContext): Promise<void> {
    this.view = view;
    view.registerMesh(StreetTrafficMeshDesc.key, StreetTrafficMeshDesc);
  }

  private requireView(): View {
    if (!this.view) {
      throw new Error(
        "StreetLightsPlugin: call view.addPlugin() and view.init() first.",
      );
    }
    return this.view;
  }

  /**
   * Takes a polyline layer over the road centerlines as the road surfaces:
   * every feature the road reader skips is hidden, the rest get the width of
   * their style, and `setVisible()` covers the layer. The layer's own
   * material gives the color and the clamping; it must show the tile layer
   * `roads.layer` names, so give it `sourceLayers: [roads.layer]`: other
   * line layers can carry the same properties (OpenMapTiles
   * `transportation_name` does) and would be drawn as roads too. The layer
   * stays the caller's to delete. While the
   * plugin holds it, its `show` and `width` are the plugin's; `dispose()`
   * detaches the plugin, but the values it already set stay on the features
   * (Navara cannot clear evaluated values), so delete the layer or evaluate
   * it again yourself afterwards. Giving the same layer again does nothing.
   */
  addRoads(layer: Layer): void {
    this.requireView();
    if (this.surfaces.some((surface) => surface.layer === layer)) return;
    const apply = surfaceEvaluator(this.flags, this.schema.roads);
    // Deleted by the caller: let go of it.
    const forget = () => {
      this.surfaces = this.surfaces.filter(
        (surface) => surface.layer !== layer,
      );
    };
    layer.on("featureCreated", apply);
    layer.on("featureUpdated", apply);
    layer.once("deleted", forget);
    this.surfaces.push({ layer, apply, forget });
    // Features the layer already holds get the evaluator too.
    layer.forceUpdate();
  }

  /**
   * Starts streaming lamps, beacons and traffic from the tiles of
   * `tileTemplate`; `follow()` then decides which tiles are loaded. Calling
   * it again drops the tiles of the previous start.
   */
  start({ tileTemplate, effectIds = [] }: StreetLightsStartOptions): void {
    this.requireView();
    this.stopStreaming();
    this.effectIds = effectIds;
    this.streamer = createTileStreamer<StreetTile>(
      this.radius,
      async (tile, signal) => {
        const network = await loadRoadNetwork(
          tileTemplate,
          tile,
          this.schema,
          signal,
        );
        // Aborted after the tile arrived: build nothing for it.
        if (signal.aborted) throw signal.reason;
        return this.addTile(tile, network);
      },
      removeTile,
    );
  }

  /** Keeps the tiles around a position loaded; call as the camera moves. */
  follow(lng: number, lat: number): void {
    if (!this.streamer) {
      throw new Error("StreetLightsPlugin: call start() first.");
    }
    this.streamer.update(lng, lat);
  }

  /** Street-level detail on or off: road surfaces, lamps, beacons, traffic. */
  setVisible(visible: boolean): void {
    if (this.flags.visible === visible) return;
    this.flags.visible = visible;
    for (const { layer } of this.surfaces) layer.forceUpdate();
    this.refreshTiles();
  }

  /** Lamps, beacons and traffic on or off; the road surfaces stay. */
  setLightsOn(on: boolean): void {
    if (this.flags.lightsOn === on) return;
    this.flags.lightsOn = on;
    this.refreshTiles();
  }

  /** Applies new traffic options to the loaded tiles and the ones to come. */
  update({ traffic }: StreetLightsUpdate): void {
    Object.assign(this.traffic, traffic);
    for (const { loaded } of this.loadedTiles()) {
      loaded.traffic.update({ streetTraffic: { ...this.traffic } });
    }
  }

  /**
   * Drops every layer and mesh the plugin added, and detaches from the road
   * layers given to `addRoads()`, which stay the caller's.
   */
  dispose(): void {
    this.stopStreaming();
    for (const { layer, apply, forget } of this.surfaces) {
      layer.off("featureCreated", apply);
      layer.off("featureUpdated", apply);
      layer.off("deleted", forget);
    }
    this.surfaces = [];
    this.view = undefined;
  }

  private stopStreaming(): void {
    this.streamer?.dispose();
    this.streamer = undefined;
  }

  private loadedTiles() {
    return this.streamer?.tiles.values() ?? [];
  }

  private refreshTiles(): void {
    const lightsVisible = this.flags.visible && this.flags.lightsOn;
    for (const { loaded } of this.loadedTiles()) {
      loaded.lamps.forceUpdate();
      loaded.beacons.forceUpdate();
      loaded.traffic.update({ visible: lightsVisible });
    }
  }

  /**
   * A layer of glowing points, the lamps or the beacons, that takes part in
   * the selective effects given to `start()`. Sized in meters so the far
   * field thins out with distance instead of piling fixed-size sprites into
   * a sheet.
   */
  private addLightLayer(
    source: Source,
    light: { color: Color; size: number; clampToGround: boolean },
  ): Layer {
    return this.requireView().addLayer({
      type: "vector",
      source,
      point: {
        size: light.size,
        sizeInMeters: true,
        pointFacing: "upright",
        clampToGround: light.clampToGround,
        height: 0,
        declutter: false,
        color: light.color,
        emissiveColor: light.color,
        emissiveIntensity: 1,
        effectIds: this.effectIds,
      },
    });
  }

  /** Street lamps, roof beacons and traffic for one tile's road network. */
  private addTile(tile: TileCoordinate, network: RoadNetwork): StreetTile {
    const view = this.requireView();
    const lights = tileLights(
      network,
      mulberry32(tileSeed(PLACEMENT_SEED, tile, 0)),
    );

    const lampSource = view.addSource({ type: "geojson", data: lights.lamps });
    const lamps = this.addLightLayer(lampSource, {
      color: LIGHT_COLORS.lamp,
      size: 3,
      clampToGround: true,
    });
    const applyLamp = lampEvaluator(this.flags);
    lamps.on("featureCreated", applyLamp);
    lamps.on("featureUpdated", applyLamp);

    const beaconSource = view.addSource({
      type: "geojson",
      data: lights.beacons,
    });
    const beacons = this.addLightLayer(beaconSource, {
      color: LIGHT_COLORS.beacon,
      size: 2,
      clampToGround: false,
    });
    const applyBeacon = beaconEvaluator(this.flags);
    beacons.on("featureCreated", applyBeacon);
    beacons.on("featureUpdated", applyBeacon);

    // Car positions are stored relative to the tile center to keep float32
    // precise.
    const center = tileCenter(tile);
    const origin = geodeticToVector3({
      lat: center.lat,
      lng: center.lng,
      height: 0,
    });
    const traffic = view.addMesh<StreetTrafficMeshDesc>({
      streetTraffic: {
        data: buildTraffic(
          network.roads,
          origin,
          geodeticToVector3,
          mulberry32(tileSeed(PLACEMENT_SEED, tile, 1)),
        ),
        ...this.traffic,
      },
      position: { x: origin.x, y: origin.y, z: origin.z },
      visible: this.flags.visible && this.flags.lightsOn,
    });

    return { lampSource, lamps, beaconSource, beacons, traffic };
  }
}
