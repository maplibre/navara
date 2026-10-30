/**
 * StreetLightsPlugin — Navara Plugin for street lamps, roof beacons and
 * traffic at night.
 *
 * Draws dark road surfaces over an OpenMapTiles-schema vector source
 * ({@link StreetLightsPlugin.addRoads}), then streams the zoom-14 tiles of the
 * same tile set in around a position ({@link StreetLightsPlugin.start} and
 * {@link StreetLightsPlugin.follow}) to place street lamps along every road,
 * a red beacon on every roof 90 m or higher, and cars that drive the road
 * segments. The tiles are fetched a second time by this plugin: the engine
 * decodes them for rendering but exposes no feature geometry.
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
 * import ThreeView from "@navaramap/three";
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
 * streetLights.addRoads(streets);
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

import {
  buildTraffic,
  createTileStreamer,
  loadRoadNetwork,
  roadStyle,
  tileCenter,
  tileLights,
  type RoadNetwork,
  type TileCoordinate,
  type TileStreamer,
} from "./streetTiles";
import {
  StreetTrafficMeshDesc,
  type StreetTrafficDescriptions,
  type StreetTrafficOptions,
} from "./StreetTrafficMeshDesc";

type View = ThreeView<StreetTrafficDescriptions>;

export type StreetLightsConfig = {
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
  /** A `{z}/{x}/{y}` tile URL of an OpenMapTiles-schema tile set. */
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

const lampEvaluator =
  (flags: Flags) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        if (!flags.visible || !flags.lightsOn) return { show: false };
        switch (properties?.kind) {
          case "lamp":
            return {
              show: true,
              color: LIGHT_COLORS.lamp,
              emissive: LIGHT_COLORS.lamp,
              size: 3,
            };
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
  (flags: Flags) =>
  ({ evaluator }: { evaluator: FeatureEvaluator }) => {
    evaluator.evaluate(
      ({ properties }) => {
        if (!flags.visible) return { show: false };
        const style = roadStyle(properties?.class);
        if (!style) return { show: false };

        return { show: true, width: style.width };
      },
      { filters: ["class"] },
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
  private surfaces: Layer[] = [];
  private readonly radius: number;
  private readonly traffic: StreetTrafficOptions;
  private readonly flags: Flags = { visible: true, lightsOn: true };
  private effectIds: string[] = [];

  constructor({ radius = 2, traffic = {} }: StreetLightsConfig = {}) {
    super();
    this.radius = radius;
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

  /** Dark road surfaces over the OpenMapTiles `transportation` layer of `source`. */
  addRoads(source: Source): Layer {
    const surface = this.requireView().addLayer({
      type: "vector",
      source,
      sourceLayers: ["transportation"],
      polyline: {
        color: new Color().setStyle("#15171c"),
        width: 1,
        clampToGround: true,
      },
    });
    const apply = surfaceEvaluator(this.flags);
    surface.on("featureCreated", apply);
    surface.on("featureUpdated", apply);
    this.surfaces.push(surface);
    return surface;
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
      async (tile, signal) =>
        this.addTile(tile, await loadRoadNetwork(tileTemplate, tile, signal)),
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
    for (const surface of this.surfaces) surface.forceUpdate();
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

  /** Drops every layer and mesh the plugin added. */
  dispose(): void {
    this.stopStreaming();
    for (const surface of this.surfaces) surface.delete();
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

  /** Street lamps, roof beacons and traffic for one tile's road network. */
  private addTile(tile: TileCoordinate, network: RoadNetwork): StreetTile {
    const view = this.requireView();
    const lights = tileLights(network);

    // Sized in meters so the far field thins out with distance instead of
    // piling fixed-size sprites into a sheet.
    const lampSource = view.addSource({ type: "geojson", data: lights.lamps });
    const lamps = view.addLayer({
      type: "vector",
      source: lampSource,
      point: {
        size: 3,
        sizeInMeters: true,
        pointFacing: "upright",
        clampToGround: true,
        height: 0,
        declutter: false,
        color: LIGHT_COLORS.lamp,
        emissiveColor: LIGHT_COLORS.lamp,
        emissiveIntensity: 1,
        effectIds: this.effectIds,
      },
    });
    const applyLamp = lampEvaluator(this.flags);
    lamps.on("featureCreated", applyLamp);
    lamps.on("featureUpdated", applyLamp);

    const beaconSource = view.addSource({
      type: "geojson",
      data: lights.beacons,
    });
    const beacons = view.addLayer({
      type: "vector",
      source: beaconSource,
      point: {
        size: 2,
        sizeInMeters: true,
        pointFacing: "upright",
        clampToGround: false,
        height: 0,
        declutter: false,
        color: LIGHT_COLORS.beacon,
        emissiveColor: LIGHT_COLORS.beacon,
        emissiveIntensity: 1,
        effectIds: this.effectIds,
      },
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
        data: buildTraffic(network.roads, origin, geodeticToVector3),
        ...this.traffic,
      },
      position: { x: origin.x, y: origin.y, z: origin.z },
      visible: this.flags.visible && this.flags.lightsOn,
    });

    return { lampSource, lamps, beaconSource, beacons, traffic };
  }
}
