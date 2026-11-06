/**
 * StreetLightsPlugin — Navara Plugin for street lamps, roof beacons and
 * traffic at night.
 *
 * Hides everything but the roads on a road layer the caller styled
 * ({@link StreetLightsPlugin.addRoads}), then streams the zoom-14 tiles of
 * the same tile set in around a position ({@link StreetLightsPlugin.start}
 * and {@link StreetLightsPlugin.follow}) to place street lamps along every
 * road, a red beacon on every roof the building reader gives a height, and
 * cars that drive the road segments. The tiles are fetched a second time by
 * this plugin: the engine decodes them for rendering but exposes no feature
 * geometry.
 *
 * The plugin knows no tile schema: {@link StreetLightsConfig.roads} and
 * {@link StreetLightsConfig.buildings} name the tile layers and give a
 * {@link RoadReader} and a {@link BuildingReader} for the tile set's
 * properties.
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
 *   isRoadClass,
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
 * // How this tile set (OpenMapTiles schema) names its roads and buildings.
 * const streetLights = new StreetLightsPlugin({
 *   radius: 2,
 *   roads: {
 *     layer: "transportation",
 *     properties: ["class", "oneway"],
 *     read: ({ class: roadClass, oneway }) =>
 *       isRoadClass(roadClass)
 *         ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
 *         : undefined,
 *   },
 *   buildings: {
 *     layer: "building",
 *     // Roofs from 90 m up; an outline drawn in parts leaves the beacon to them.
 *     read: ({ render_height: height, hide_3d }) =>
 *       typeof height === "number" && height >= 90 && hide_3d !== true
 *         ? height
 *         : undefined,
 *   },
 * });
 * view.addPlugin(streetLights);
 * await view.init();
 *
 * const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });
 *
 * // The tile set; its TileJSON also names the tile URL template the plugin
 * // streams the roads from.
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
  readRoadFeature,
  type StreetLightsRoads,
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
  isRoadClass,
  type BuildingReader,
  type Oneway,
  type RoadClass,
  type RoadReader,
  type StreetLightsBuildings,
  type StreetLightsRoads,
} from "./roads";

export type StreetLightsConfig = TileSchema & {
  /**
   * Tiles of lights kept loaded around the followed position, as a radius in
   * zoom-14 tiles (2 is a 5 × 5 block, about 10 km across at Tokyo's
   * latitude).
   * @defaultValue 2
   */
  radius?: number;
  traffic?: StreetTrafficOptions;
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

/** A part of the street-level detail that `setVisible()` can hide on its own. */
export type StreetLightsPart = "roads" | "lamps" | "beacons" | "traffic";

const PARTS: StreetLightsPart[] = ["roads", "lamps", "beacons", "traffic"];
/** The parts that live on the streamed tiles; the roads are the caller's layers. */
const TILE_PARTS: StreetLightsPart[] = PARTS.filter((p) => p !== "roads");

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
 * layer: the evaluators read this record instead, and `forceUpdate()` re-runs
 * them. A part shows while it is visible and, for the lights and traffic,
 * while `lightsOn`.
 */
type Visibility = {
  lightsOn: boolean;
  parts: Record<StreetLightsPart, boolean>;
};

const shown = (visibility: Visibility, part: StreetLightsPart) =>
  visibility.parts[part] && (part === "roads" || visibility.lightsOn);

/** A road layer given to `addRoads()` and the handlers attached to it. */
type Surface = {
  layer: Layer;
  apply: (event: { evaluator: FeatureEvaluator }) => void;
  forget: () => void;
};

const lampEvaluator =
  (visibility: Visibility) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        if (!shown(visibility, "lamps")) return { show: false };
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
  (visibility: Visibility) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        if (!shown(visibility, "beacons")) return { show: false };
        const height = properties?.height;
        return { show: true, height: typeof height === "number" ? height : 0 };
      },
      { filters: ["height"] },
    );
  };

const surfaceEvaluator =
  (visibility: Visibility, roads: StreetLightsRoads) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        const road = shown(visibility, "roads")
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
  private readonly visibility: Visibility = {
    lightsOn: true,
    parts: { roads: true, lamps: true, beacons: true, traffic: true },
  };
  private effectIds: string[] = [];

  constructor({
    radius = 2,
    traffic = {},
    roads,
    buildings,
  }: StreetLightsConfig) {
    super();
    this.radius = radius;
    this.schema = { roads: { ...roads }, buildings: { ...buildings } };
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
    const apply = surfaceEvaluator(this.visibility, this.schema.roads);
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

  /**
   * Street-level detail on or off: one `part`, or all of them (road
   * surfaces, lamps, beacons and traffic) when omitted.
   */
  setVisible(visible: boolean, part?: StreetLightsPart): void {
    const changed = (part ? [part] : PARTS).filter(
      (p) => this.visibility.parts[p] !== visible,
    );
    if (changed.length === 0) return;
    for (const p of changed) this.visibility.parts[p] = visible;
    if (changed.includes("roads")) {
      for (const { layer } of this.surfaces) layer.forceUpdate();
    }
    const tileParts = changed.filter((p) => p !== "roads");
    if (tileParts.length > 0) this.refreshTiles(tileParts);
  }

  /** Lamps, beacons and traffic on or off; the road surfaces stay. */
  setLightsOn(on: boolean): void {
    if (this.visibility.lightsOn === on) return;
    this.visibility.lightsOn = on;
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

  /** Re-applies the visibility of `parts` on the loaded tiles. */
  private refreshTiles(parts: StreetLightsPart[] = TILE_PARTS): void {
    const trafficVisible = shown(this.visibility, "traffic");
    for (const { loaded } of this.loadedTiles()) {
      if (parts.includes("lamps")) loaded.lamps.forceUpdate();
      if (parts.includes("beacons")) loaded.beacons.forceUpdate();
      if (parts.includes("traffic")) {
        loaded.traffic.update({ visible: trafficVisible });
      }
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
    const applyLamp = lampEvaluator(this.visibility);
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
    const applyBeacon = beaconEvaluator(this.visibility);
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
      visible: shown(this.visibility, "traffic"),
    });

    return { lampSource, lamps, beaconSource, beacons, traffic };
  }
}
