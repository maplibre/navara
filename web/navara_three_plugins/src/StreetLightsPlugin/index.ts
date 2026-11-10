/**
 * StreetLightsPlugin — Navara Plugin for street lamps, roof beacons and
 * traffic at night.
 *
 * {@link StreetLightsPlugin.start} takes the roads and the buildings, each
 * with its tile source, and draws the road surfaces;
 * {@link StreetLightsPlugin.follow} then streams the zoom-14 tiles in around
 * a position to place street lamps along every road, a red beacon on every
 * roof the building reader gives a height, and cars that drive the road
 * segments. The tiles are fetched a second time by this plugin: the engine
 * decodes them for rendering but exposes no feature geometry.
 *
 * The roads and buildings give a {@link RoadReader} and a
 * {@link BuildingReader} for their features' properties.
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
 * const streetLights = new StreetLightsPlugin();
 * view.addPlugin(streetLights);
 * await view.init();
 *
 * const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });
 *
 * // Readers for the OpenMapTiles schema.
 * await streetLights.start({
 *   roads: {
 *     sourceType: "tilejson",
 *     sourceUrl: "https://tiles.openfreemap.org/planet",
 *     sourceLayers: ["transportation"],
 *     polyline: { color: new Color().setStyle("#15171c"), clampToGround: true },
 *     filterFeatureProperties: ["class", "oneway"],
 *     evaluateFeature: ({ class: roadClass, oneway }) =>
 *       isRoadClass(roadClass)
 *         ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
 *         : undefined,
 *   },
 *   buildings: {
 *     sourceType: "tilejson",
 *     sourceUrl: "https://tiles.openfreemap.org/planet",
 *     sourceLayers: ["building"],
 *     // Roofs from 90 m up; an outline drawn in parts leaves the beacon to them.
 *     evaluateFeature: ({ render_height: height, hide_3d }) =>
 *       typeof height === "number" && height >= 90 && hide_3d !== true
 *         ? height
 *         : undefined,
 *   },
 *   effectIds: [bloom.id],
 * });
 * view.on("postUpdate", () => {
 *   const { lng, lat } = view.camera.positionGeographic;
 *   streetLights.follow(lng, lat);
 * });
 *
 * // Later: drop every source, layer and mesh the plugin added.
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

import { TileJsonPlugin, type TileJsonLoadedEvent } from "../TileJsonPlugin";

import { buildTraffic, mulberry32, tileLights, tileSeed } from "./placement";
import {
  readRoadFeature,
  type StreetLightsBuildings,
  type StreetLightsRoads,
  type StreetLightsSource,
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
  type NetworkReading,
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
  type RoadsReading,
  type StreetLightsBuildings,
  type StreetLightsRoads,
  type StreetLightsSource,
} from "./roads";

export type StreetLightsConfig = {
  /**
   * Resolves `tilejson` sources. Created here when omitted, and then disposed
   * with this plugin.
   */
  tileJsonPlugin?: TileJsonPlugin;
};

export type StreetLightsStartOptions = {
  roads: StreetLightsRoads;
  buildings: StreetLightsBuildings;
  /**
   * Tiles of lights kept loaded around the followed position, as a radius in
   * zoom-14 tiles (2 is a 5 × 5 block, about 10 km across at Tokyo's
   * latitude).
   * @defaultValue 2
   */
  radius?: number;
  /** The cars' options; replaces what an earlier `update()` applied. */
  traffic?: StreetTrafficOptions;
  /**
   * Selective effects the lamps and beacons take part in, such as a bloom.
   * @defaultValue []
   */
  effectIds?: string[];
};

/** A part of the street-level detail that `setVisible()` can hide on its own. */
export type StreetLightsPart = "roads" | "lamps" | "beacons" | "traffic";

const PARTS: StreetLightsPart[] = ["roads", "lamps", "beacons", "traffic"];
/** The parts that live on the streamed tiles; the roads are one layer. */
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
      { filters: roads.filterFeatureProperties },
    );
  };

const sourceKey = ({ sourceType, sourceUrl }: StreetLightsSource) =>
  `${sourceType} ${sourceUrl}`;

/** A source the plugin opened, and the tile URL template of its tile set. */
type OpenedSource = { source: Source; template: string };

/** Everything one tile adds to the view. */
type StreetTile = {
  lampSource: Source;
  lamps: Layer;
  beaconSource: Source;
  beacons: Layer;
  traffic: MeshHandle<StreetTrafficMeshDesc>;
};

/** A tile without roads or roofs is loaded but adds nothing. */
const removeTile = (tile: StreetTile | undefined) => {
  if (!tile) return;
  tile.lamps.delete();
  tile.lampSource.delete();
  tile.beacons.delete();
  tile.beaconSource.delete();
  tile.traffic.delete();
};

export class StreetLightsPlugin extends Plugin<View, ViewContext> {
  private view?: View;
  private readonly tileJsonPlugin: TileJsonPlugin;
  /** Whether {@link tileJsonPlugin} was created here, and so is disposed here. */
  private readonly ownsTileJsonPlugin: boolean;
  private streamer?: TileStreamer<StreetTile | undefined>;
  private sources: Source[] = [];
  private surface?: Layer;
  private traffic: StreetTrafficOptions = {};
  private readonly visibility: Visibility = {
    lightsOn: true,
    parts: { roads: true, lamps: true, beacons: true, traffic: true },
  };
  private effectIds: string[] = [];
  /** Counts `start()` and `dispose()` calls, so a `start()` they overtook opens nothing. */
  private run = 0;

  constructor({ tileJsonPlugin }: StreetLightsConfig = {}) {
    super();
    this.tileJsonPlugin = tileJsonPlugin ?? new TileJsonPlugin();
    this.ownsTileJsonPlugin = !tileJsonPlugin;
  }

  async init(view: View, ctx: ViewContext): Promise<void> {
    this.view = view;
    view.registerMesh(StreetTrafficMeshDesc.key, StreetTrafficMeshDesc);
    await this.tileJsonPlugin.init(view, ctx);
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
   * Opens the sources of the roads and buildings, draws the road surfaces,
   * and starts streaming lamps, beacons and traffic; `follow()` then decides
   * which tiles are loaded. On the road surface every feature the road
   * reader skips is hidden and the rest get the width of their class. Roads
   * and buildings with the same source share it. Calling `start()` again
   * drops everything the previous start added once the new sources are open.
   */
  async start({
    roads,
    buildings,
    radius = 2,
    traffic = {},
    effectIds = [],
  }: StreetLightsStartOptions): Promise<void> {
    const view = this.requireView();
    const run = ++this.run;

    // The previous start keeps serving until the new sources are open.
    const opened: Source[] = [];
    let roadSource: OpenedSource;
    let buildingSource: OpenedSource | undefined;
    try {
      roadSource = await this.openSource(roads);
      opened.push(roadSource.source);
      // A vector tile URL of its own needs no engine source: the plugin
      // draws no building layer, and the URL is the template.
      if (sourceKey(buildings) === sourceKey(roads)) {
        buildingSource = roadSource;
      } else if (buildings.sourceType === "tilejson") {
        buildingSource = await this.openSource(buildings);
        opened.push(buildingSource.source);
      }
    } catch (error) {
      for (const source of opened) source.delete();
      // Overtaken by another start() or by dispose(): nothing to report.
      if (run !== this.run) return;
      throw error;
    }
    // Overtaken while the sources opened: this start opens nothing.
    if (run !== this.run) {
      for (const source of opened) source.delete();
      return;
    }

    this.stop();
    this.traffic = { ...traffic };
    this.effectIds = effectIds;
    this.sources = opened;

    const surface = view.addLayer({
      type: "vector",
      source: roadSource.source,
      sourceLayers: roads.sourceLayers,
      polyline: { ...roads.polyline },
    });
    const apply = surfaceEvaluator(this.visibility, roads);
    surface.on("featureCreated", apply);
    surface.on("featureUpdated", apply);
    this.surface = surface;

    const reading: NetworkReading = {
      roads: { ...roads, template: roadSource.template },
      buildings: {
        ...buildings,
        template: buildingSource?.template ?? buildings.sourceUrl,
      },
    };
    this.streamer = createTileStreamer<StreetTile | undefined>(
      radius,
      async (tile, signal) => {
        const network = await loadRoadNetwork(reading, tile, signal);
        // Aborted after the tile arrived: build nothing for it.
        if (signal.aborted) throw signal.reason;
        if (network.roads.length === 0 && network.roofs.length === 0) {
          return undefined;
        }
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
    if (changed.includes("roads")) this.surface?.forceUpdate();
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
    for (const loaded of this.loadedTiles()) {
      loaded.traffic.update({ streetTraffic: { ...this.traffic } });
    }
  }

  /** Drops every source, layer and mesh the plugin added. */
  dispose(): void {
    this.run++;
    this.stop();
    if (this.ownsTileJsonPlugin) this.tileJsonPlugin.dispose();
    this.view = undefined;
  }

  /** Drops what the last `start()` added. */
  private stop(): void {
    this.streamer?.dispose();
    this.streamer = undefined;
    this.surface?.delete();
    this.surface = undefined;
    for (const source of this.sources) source.delete();
    this.sources = [];
  }

  private async openSource(desc: StreetLightsSource): Promise<OpenedSource> {
    const view = this.requireView();
    const url = desc.sourceUrl;
    if (desc.sourceType === "vector-tile") {
      return {
        source: view.addSource({ type: "vector-tile", url }),
        template: url,
      };
    }
    // The TileJSON document names the tile URL template; the `loaded` event
    // carries it with the source it was registered for.
    const templates = new Map<Source, string>();
    const onLoaded = ({ source, tilejson }: TileJsonLoadedEvent) => {
      templates.set(source, tilejson.tiles[0]);
    };
    this.tileJsonPlugin.on("loaded", onLoaded);
    try {
      const source = await this.tileJsonPlugin.addSource({
        type: "vector-tile",
        url,
      });
      const template = templates.get(source);
      if (template === undefined) {
        // The resolver was disposed while the document loaded.
        source.delete();
        throw new Error(`StreetLightsPlugin: no tile URL for ${url}.`);
      }
      return { source, template };
    } finally {
      this.tileJsonPlugin.off("loaded", onLoaded);
    }
  }

  /** The loaded tiles that hold lights. */
  private loadedTiles(): StreetTile[] {
    const tiles: StreetTile[] = [];
    for (const { loaded } of this.streamer?.tiles.values() ?? []) {
      if (loaded) tiles.push(loaded);
    }
    return tiles;
  }

  /** Re-applies the visibility of `parts` on the loaded tiles. */
  private refreshTiles(parts: StreetLightsPart[] = TILE_PARTS): void {
    const trafficVisible = shown(this.visibility, "traffic");
    for (const loaded of this.loadedTiles()) {
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
