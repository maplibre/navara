/**
 * MapLibreStylePlugin - Bridge between MapLibre Style JSON and Navara's imperative API.
 *
 * This plugin translates declarative MapLibre Style specifications into Navara layer
 * operations and feature evaluators.
 */
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { Plugin } from "@navaramap/core";
import ThreeView, {
  Color,
  type ViewContext,
  type Layer,
  type LayerDescription,
  type Source,
  type FeatureEvaluator,
  type FeatureInfo,
  TERRARIUM_ELEVATION_DECODER,
  MAPBOX_ELEVATION_DECODER,
  radianToDegree,
} from "@navaramap/three";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import {
  createLayoutEvaluators,
  createPaintEvaluators,
  toEvaluatedValue,
} from "./adapters/toEvaluatedValue";
import {
  colorReliefLayerFollowsZoom,
  getSymbolPlacement,
  symbolLayerFollowsZoom,
  toLayerDescription,
} from "./adapters/toLayerDescription";
import { BackgroundHandler } from "./BackgroundHandler";
import { RustStyleEngine } from "./engine/RustStyleEngine";
import type { ParsedStyle, StyleLayer } from "./engine/types";
import { convertFontFacesToFontFamilies } from "./fontHelper";
import {
  zoomToCameraDistance,
  maplibrePitchToNavaraPitch,
  MAPLIBRE_TILE_SIZE,
} from "./utils/cameraHelpers";
import { expressionUsesZoom } from "./utils/expressionHelpers";

/**
 * Options for MapLibreStylePlugin constructor.
 */
type MapLibreStylePluginOptions = {
  overrides?: Partial<StyleSpecification>;
  tileJsonPlugin?: TileJsonPlugin;
  forceMapLibreFov?: boolean;
};

/**
 * The zoom-following part of a layer's materials, comparable across zooms
 * (the source is not): a symbol layer's text/billboard, or a color-relief
 * layer's opacity and resampling. `Color` keeps its value in a private field,
 * which JSON cannot see.
 */
function serializeMaterials(layerDesc: LayerDescription): string {
  if ("text" in layerDesc || "billboard" in layerDesc) {
    return JSON.stringify(
      [layerDesc.text, layerDesc.billboard],
      (_key, value) => (value instanceof Color ? value.toHex() : value),
    );
  }
  if (layerDesc.type === "raster" && layerDesc.elevationHeatmap) {
    // Only opacity and resampling can follow zoom: the style spec allows only
    // ["elevation"] in color-relief-color, so colorMap/colorStops never change
    // with zoom (and are large arrays not worth serializing).
    return JSON.stringify([
      layerDesc.raster?.opacity,
      layerDesc.elevationHeatmap.filter,
    ]);
  }
  return "";
}

/** A layer's `minzoom` is inclusive and its `maxzoom` exclusive. */
function inZoomRange(styleLayer: StyleLayer, zoom: number): boolean {
  if ("minzoom" in styleLayer && styleLayer.minzoom !== undefined) {
    if (zoom < styleLayer.minzoom) return false;
  }
  if ("maxzoom" in styleLayer && styleLayer.maxzoom !== undefined) {
    if (zoom >= styleLayer.maxzoom) return false;
  }
  return true;
}

export class MapLibreStylePlugin extends Plugin<ThreeView, ViewContext> {
  private sources: Map<string, Source> = new Map<string, Source>();
  private layers: Layer[] = [];
  private parsedStyle: ParsedStyle | null = null;
  /**
   * Track layers that have already warned about invalid geometry types to avoid spamming the console.
   */
  private warnedLayers: Set<string> = new Set<string>();
  /**
   * Track sources that have already warned about issues (e.g., multiple tile URLs) to avoid spamming the console.
   */
  private warnedSources: Set<string> = new Set<string>();
  /**
   * TileJSON plugin instance for fetching and parsing TileJSON sources.
   * Initialized in constructor.
   */
  private tileJsonPlugin: TileJsonPlugin;
  /**
   * Whether the TileJsonPlugin was created internally (should be disposed).
   */
  private ownsTileJsonPlugin: boolean;
  private view?: ThreeView;
  /**
   * Style overrides to merge with the base style.
   * Can be used to inject font configuration via font-faces.
   */
  private readonly overrides?: Partial<StyleSpecification>;
  /**
   * Whether to force MapLibre's FOV (field of view) when applying camera.
   * When true, uses MapLibre's fixed FOV of ~36.87° for camera calculations.
   * When false or undefined, uses Navara's default FOV.
   */
  private readonly forceMapLibreFov?: boolean;
  /**
   * Style engine for evaluating MapLibre expressions.
   */
  private readonly engine = new RustStyleEngine();
  /**
   * Last camera zoom level. Used to detect zoom changes that require feature re-evaluation.
   * undefined when not yet initialized.
   */
  private lastZoom: number | undefined = undefined;
  /**
   * Minimum zoom change to trigger feature re-evaluation.
   * Features are re-evaluated when zoom changes by more than this threshold.
   */
  private static readonly ZOOM_CHANGE_THRESHOLD = 0.1;
  /**
   * Zoom change listener function reference for cleanup in destroy.
   */
  private zoomChangeListener?: () => void;
  /**
   * Camera ready listener function reference for cleanup in destroy.
   * Listens for frustumChanged event to apply camera position when ready.
   */
  private cameraReadyListener?: () => void;
  /**
   * Layers that have zoom-dependent expressions (filter, paint, or layout).
   * Only these layers need to be updated when zoom changes.
   */
  private zoomDependentLayers = new Set<Layer>();
  /**
   * Layers whose only zoom dependency is `minzoom`/`maxzoom`. They are
   * re-evaluated only when the zoom crosses into or out of their range.
   */
  private zoomRangeLayers = new Map<Layer, StyleLayer>();
  /**
   * Layers with a layer-level property that follows zoom (a symbol layer's
   * alignment, halo, ...; a color-relief layer's opacity or resampling), with
   * what is needed to rebuild their description and the last one applied,
   * serialized without its source.
   */
  private zoomFollowingLayers = new Map<
    Layer,
    {
      styleLayer: StyleLayer;
      source: Source;
      fontFamily: string | undefined;
      rank: number;
      appliedMaterials: string;
    }
  >();
  /**
   * Background layer handler for evaluating and applying background colors.
   */
  private backgroundHandler?: BackgroundHandler;

  /**
   * Create a new MapLibre Style plugin.
   *
   * @param style - MapLibre Style JSON specification or URL
   * @param options - Plugin options
   * @param options.overrides - Optional partial style overrides to merge with the base style.
   *                            Use fontFamilyToStyleOverrides([...fonts]) or fetchFontStyleOverrides() to inject font configuration.
   * @param options.tileJsonPlugin - Optional TileJsonPlugin instance. If not provided, a new one will be created internally and disposed when this plugin is disposed.
   * @param options.forceMapLibreFov - When true, forces MapLibre's FOV (~36.87°) for camera calculations. When false or undefined, uses Navara's default FOV.
   *
   * @example
   * ```ts
   * // With font configuration
   * const plugin = new MapLibreStylePlugin(style, {
   *   overrides: await fetchFontStyleOverrides("Open Sans", "https://fonts.googleapis.com/..."),
   * });
   * ```
   *
   * @example
   * ```ts
   * // With custom TileJsonPlugin
   * const plugin = new MapLibreStylePlugin(style, {
   *   overrides: fontOverrides,
   *   tileJsonPlugin: new TileJsonPlugin(),
   * });
   * ```
   */
  constructor(
    private readonly style: string | StyleSpecification,
    options?: MapLibreStylePluginOptions,
  ) {
    super();
    this.overrides = options?.overrides;
    this.tileJsonPlugin = options?.tileJsonPlugin ?? new TileJsonPlugin();
    this.ownsTileJsonPlugin = !options?.tileJsonPlugin;
    this.forceMapLibreFov = options?.forceMapLibreFov;
  }

  /**
   * Merge style overrides into base style.
   * Returns a new merged style object without mutating the input.
   * Currently supports font-faces; can be extended for other properties in the future.
   *
   * @param baseStyle - A validated style object (not a string or primitive)
   * @param overrides - Partial style specification to merge in
   */
  private mergeStyleOverrides(
    baseStyle: StyleSpecification,
    overrides: Partial<StyleSpecification>,
  ): StyleSpecification {
    // Create a shallow copy of the base style
    const mergedStyle = { ...baseStyle };

    // Merge font-faces into a new object
    if (overrides["font-faces"]) {
      mergedStyle["font-faces"] = {
        ...baseStyle["font-faces"],
        ...overrides["font-faces"],
      };
    }

    // TODO: Add support for other override properties here
    // if (overrides.sources) { mergedStyle.sources = { ...baseStyle.sources, ...overrides.sources }; }
    // if (overrides.layers) { mergedStyle.layers = [...baseStyle.layers, ...overrides.layers]; }

    return mergedStyle;
  }

  /**
   * Get font family name for a layer.
   * Reads from layer's text-font property if it's a symbol layer, otherwise returns first available font.
   */
  private getFontFamilyForLayer(styleLayer: StyleLayer): string | undefined {
    const fontFaces = this.parsedStyle?.["font-faces"];
    if (!fontFaces) {
      return undefined;
    }

    // For symbol layers, try to use text-font property
    if (styleLayer.type === "symbol" && styleLayer.layout?.["text-font"]) {
      const textFont = styleLayer.layout["text-font"];

      // text-font can be a string (constant), array (for fallback), or expression
      if (typeof textFont === "string") {
        // Single font name - use it if available
        if (fontFaces[textFont]) {
          return textFont;
        }
      } else if (
        Array.isArray(textFont) &&
        textFont.every((v) => typeof v === "string") &&
        textFont.some((v) => fontFaces[v])
      ) {
        // Array of font names with at least one matching an available font.
        // This distinguishes fallback lists from expression arrays (e.g., ["case", ...])
        // where operator names could coincide with font keys.
        for (const fontName of textFont) {
          if (fontFaces[fontName]) {
            return fontName;
          }
        }
      }
      // Note: text-font can also be an expression (e.g., ["case", ...]),
      // but we don't evaluate it here since font selection is done at layer
      // construction time, not per-feature. Fall back to first configured font.
    }

    // Fall back to first available font
    return Object.keys(fontFaces)[0];
  }

  /**
   * Register fonts from style font-faces with the view.
   * Converts MapLibre font-face format to Navara FontFamily format.
   */
  private registerFontsFromStyle(view: ThreeView): void {
    const fontFaces = this.parsedStyle?.["font-faces"];
    if (!fontFaces) {
      return;
    }

    const fontFamilies = convertFontFacesToFontFamilies(fontFaces);
    for (const fontFamily of fontFamilies) {
      view.addFontFamily(fontFamily);
    }
  }

  /**
   * Check if a layer has any zoom-dependent expressions in filter, paint, or layout.
   */
  private static layerUsesZoom(layer: StyleLayer): boolean {
    // Check filter
    if ("filter" in layer && layer.filter && expressionUsesZoom(layer.filter)) {
      return true;
    }

    // Check paint properties
    if ("paint" in layer && layer.paint) {
      for (const value of Object.values(layer.paint)) {
        if (expressionUsesZoom(value)) {
          return true;
        }
      }
    }

    // Check layout properties
    if ("layout" in layer && layer.layout) {
      for (const value of Object.values(layer.layout)) {
        if (expressionUsesZoom(value)) {
          return true;
        }
      }
    }

    return false;
  }

  async init(view: ThreeView, ctx: ViewContext): Promise<void> {
    // Save view reference for camera zoom access
    this.view = view;

    // Step 0: Fetch and parse style FIRST, before initializing any resources
    // This way, if style parsing fails, we don't leak listeners or child plugin state
    let styleData: unknown;
    if (typeof this.style === "string") {
      // Fetch style from URL
      try {
        const response = await fetch(this.style);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch style from ${this.style}: ${response.status} ${response.statusText}`,
          );
        }
        styleData = await response.json();
      } catch (err) {
        console.error("Failed to load MapLibre Style from URL:", err);
        throw err;
      }
    } else {
      styleData = this.style;
    }

    // Validate that styleData is a plain object before merging
    if (
      typeof styleData !== "object" ||
      styleData === null ||
      Array.isArray(styleData)
    ) {
      throw new Error(`Invalid style data: expected a style object`);
    }

    // Merge overrides into style before parsing
    if (this.overrides) {
      styleData = this.mergeStyleOverrides(
        styleData as StyleSpecification,
        this.overrides,
      );
    }

    try {
      // Parse and validate the merged style
      this.parsedStyle = await this.engine.parseStyle(styleData);

      // Check if style uses glyphs (not supported)
      const hasFontFaces = this.parsedStyle["font-faces"];
      if (this.parsedStyle.glyphs) {
        console.warn(
          "MapLibre Style uses 'glyphs' for font rendering, which is not supported by Navara. " +
            (hasFontFaces
              ? `Text will use fonts from font-faces instead.`
              : "Please provide font configuration via style overrides to enable text rendering. " +
                "Example: new MapLibreStylePlugin(style, { overrides: await fetchFontStyleOverrides('Open Sans', 'https://fonts.googleapis.com/...') })"),
        );
      }
    } catch (err) {
      console.error("Failed to parse MapLibre style:", err);
      throw err;
    }

    // Now that style parsing succeeded, initialize resources that need cleanup
    // Initialize TileJsonPlugin for TileJSON source support
    await this.tileJsonPlugin.init(view, ctx);

    // Register fonts from style font-faces
    this.registerFontsFromStyle(view);

    // Step 1: Initialize background handler
    this.backgroundHandler = new BackgroundHandler(
      this.engine,
      this.parsedStyle,
    );

    // Step 2: Apply initial background (set globe color)
    // Use current camera zoom, or default to 0 if not yet available
    const initialZoom = view.getZoomLevel(MAPLIBRE_TILE_SIZE) ?? 0;
    this.backgroundHandler.apply(view, initialZoom);

    // Step 3: Set up zoom change detection for re-evaluating features
    // IMPORTANT: Must be called AFTER backgroundHandler is initialized to avoid race conditions
    this.setupZoomChangeDetection(view);

    // Step 4: Add all sources first
    for (const [sourceId, sourceSpec] of Object.entries(
      this.parsedStyle.sources,
    )) {
      try {
        await this.addStyleSource(view, sourceId, sourceSpec);
      } catch (err) {
        console.error(`Failed to add source "${sourceId}":`, err);
        // Continue loading other sources
      }
    }

    // Step 5: Add layers that reference the sources
    for (const [rank, styleLayer] of this.parsedStyle.layers.entries()) {
      try {
        this.addStyleLayer(view, styleLayer, rank);
      } catch (err) {
        console.error(`Failed to add layer "${styleLayer.id}":`, err);
        // Continue loading other layers
      }
    }

    // Step 6: Add terrain if specified
    if (this.parsedStyle.terrain) {
      try {
        this.addStyleTerrain(view, this.parsedStyle.terrain);
      } catch (err) {
        console.error("Failed to add terrain:", err);
        // Continue without terrain
      }
    }

    // Step 7: Set FOV and apply camera position from style
    this.setupCameraFromStyle(view);
  }

  /**
   * Initialize camera FOV and position from style root properties.
   * Sets MapLibre-compatible FOV and applies camera position if style defines it.
   *
   * Camera readiness detection:
   * - Uses getZoomLevel() !== undefined as a proxy for "camera ready"
   * - getZoomLevel() requires: FOV, viewport height, camera position, and WASM initialized
   * - Returns undefined when any of these resources are unavailable
   * - When ready, frustumChanged event indicates FOV/viewport are initialized
   * - Listener is invoked immediately after registration to catch already-ready state
   */
  private setupCameraFromStyle(view: ThreeView): void {
    if (!this.parsedStyle?.center || this.parsedStyle?.zoom === undefined) {
      return;
    }

    // MapLibre uses a fixed FOV of 0.6435011087932844 radians (≈36.87°)
    const MAPLIBRE_FOV_RAD = 0.6435011087932844;

    // Define listener function for checking camera readiness
    const listener = () => {
      // getZoomLevel requires FOV, viewport, camera position, and WASM to be initialized
      // Returns undefined if any resource is unavailable
      if (view.getZoomLevel(MAPLIBRE_TILE_SIZE) !== undefined) {
        view.camera.off("frustumChanged", listener);
        this.cameraReadyListener = undefined;

        // Conditionally apply MapLibre's FOV based on forceMapLibreFov option
        if (this.forceMapLibreFov) {
          view.camera.fov = radianToDegree(MAPLIBRE_FOV_RAD);
          this.applyCamera(view, MAPLIBRE_FOV_RAD);
        } else {
          // Use Navara's default FOV
          this.applyCamera(view);
        }
      }
    };

    this.cameraReadyListener = listener;
    view.camera.on("frustumChanged", listener);

    // Invoke immediately to catch already-ready state (avoid missing fired events)
    listener();
  }

  /**
   * Helper to add a tile source with TileJSON or direct tiles URL support.
   * Handles both `url` (TileJSON) and `tiles` (direct URL array) fields.
   */
  private async addTileSource(
    view: ThreeView,
    sourceId: string,
    sourceSpec: {
      url?: unknown;
      tiles?: unknown;
      minzoom?: number;
      maxzoom?: number;
    },
    tileJsonDesc: Partial<Parameters<TileJsonPlugin["addSource"]>[0]> & {
      type: "raster-tile" | "vector-tile" | "raster-dem";
    },
    directTilesDesc: Partial<Parameters<typeof view.addSource>[0]> & {
      type: "raster-tile" | "vector-tile" | "raster-dem";
    },
    sourceTypeName: string,
  ): Promise<Source | null> {
    if (typeof sourceSpec.url === "string") {
      return await this.tileJsonPlugin.addSource({
        ...tileJsonDesc,
        url: sourceSpec.url,
        id: sourceId,
        minzoom: sourceSpec.minzoom,
        maxzoom: sourceSpec.maxzoom,
      });
    } else if (
      Array.isArray(sourceSpec.tiles) &&
      sourceSpec.tiles.length > 0 &&
      typeof sourceSpec.tiles[0] === "string"
    ) {
      // Warn if multiple tile URLs are provided (Navara only supports one)
      // Use warnedSources to deduplicate warnings on re-init or reload
      if (sourceSpec.tiles.length > 1 && !this.warnedSources.has(sourceId)) {
        console.warn(
          `${sourceTypeName} source "${sourceId}" has ${sourceSpec.tiles.length} tile URLs. ` +
            `Only the first URL will be used. Navara currently supports single tile URL per source. ` +
            `Multiple URLs are typically used for load spreading, which is not yet supported.`,
        );
        this.warnedSources.add(sourceId);
      }
      // Direct tiles array - use first URL
      return view.addSource({
        ...directTilesDesc,
        id: sourceId,
        url: sourceSpec.tiles[0],
        minZoom: sourceSpec.minzoom,
        maxZoom: sourceSpec.maxzoom,
      });
    } else {
      console.warn(
        `${sourceTypeName} source "${sourceId}" missing both "tiles" array and "url" field. ` +
          `Add "tiles": ["https://.../{z}/{x}/{y}..."] or "url": "https://.../tiles.json".`,
      );
      return null;
    }
  }

  /**
   * Add terrain from MapLibre Style specification.
   * Note: Elevation decoder must be configured on the source in advance,
   * as MapLibre Style Spec doesn't include decoder configuration.
   */
  private addStyleTerrain(
    view: ThreeView,
    terrain: ParsedStyle["terrain"],
  ): void {
    if (!terrain) return;

    // Get the terrain source
    const source = this.sources.get(terrain.source);
    if (!source) {
      throw new Error(`Terrain source "${terrain.source}" not found`);
    }

    // Add terrain layer with source reference
    const layer = view.addLayer({
      type: "terrain",
      source,
      terrain: {},
    });
    this.layers.push(layer);
  }

  /**
   * Set up zoom change detection to trigger feature re-evaluation.
   * When zoom changes significantly (> ZOOM_CHANGE_THRESHOLD), all layers are updated
   * to re-evaluate zoom-dependent expressions with the new zoom value.
   */
  private setupZoomChangeDetection(view: ThreeView): void {
    // Create and store listener function for later removal in destroy()
    this.zoomChangeListener = () => {
      const currentZoom = view.getZoomLevel(MAPLIBRE_TILE_SIZE);

      // Skip if zoom is not available yet (camera not fully initialized)
      if (currentZoom === undefined) return;

      // Initialize lastZoom on first valid zoom value
      if (this.lastZoom === undefined) {
        this.lastZoom = currentZoom;
        if (this.backgroundHandler?.needsZoomUpdate()) {
          this.backgroundHandler.apply(view, currentZoom);
        }
        this.refreshZoomFollowingLayers(currentZoom);
        // On initial zoom, also update zoom-dependent features. Range-only
        // layers too: features evaluated before the camera was ready used
        // zoom 0.
        for (const layer of this.zoomDependentLayers) {
          layer.forceUpdate();
        }
        for (const layer of this.zoomRangeLayers.keys()) {
          layer.forceUpdate();
        }
        return;
      }

      const zoomDelta = Math.abs(currentZoom - this.lastZoom);

      // If zoom changed significantly, trigger feature re-evaluation
      if (zoomDelta > MapLibreStylePlugin.ZOOM_CHANGE_THRESHOLD) {
        const previousZoom = this.lastZoom;
        this.lastZoom = currentZoom;

        for (const [layer, styleLayer] of this.zoomRangeLayers) {
          if (
            inZoomRange(styleLayer, previousZoom) !==
            inZoomRange(styleLayer, currentZoom)
          ) {
            layer.forceUpdate();
          }
        }

        if (this.backgroundHandler?.needsZoomUpdate()) {
          this.backgroundHandler.apply(view, currentZoom);
        }
        this.refreshZoomFollowingLayers(currentZoom);

        // Trigger re-evaluation only on layers with zoom-dependent expressions
        for (const layer of this.zoomDependentLayers) {
          layer.forceUpdate();
        }
      }
    };

    // Register the listener on multiple camera events to catch all zoom changes:
    // - move: camera position changes during drag/pan
    // - moveend: camera stops moving (catches idle startup and instantaneous setCamera)
    // - frustumChanged: FOV or viewport size changes
    view.camera.on("move", this.zoomChangeListener);
    view.camera.on("moveend", this.zoomChangeListener);
    view.camera.on("frustumChanged", this.zoomChangeListener);
  }

  /**
   * Re-evaluate the layer-level properties that follow zoom and apply them
   * with `layer.update()`, only for layers whose materials changed (e.g. a
   * `step` crossing), since each symbol update re-lays out the layer's labels
   * and each color-relief update re-composites its tiles.
   */
  private refreshZoomFollowingLayers(zoom: number): void {
    for (const [layer, entry] of this.zoomFollowingLayers) {
      const layerDesc = toLayerDescription(
        entry.source,
        entry.styleLayer,
        entry.fontFamily,
        this.engine,
        zoom,
        entry.rank,
      );
      if (!layerDesc) continue;
      const materials = serializeMaterials(layerDesc);
      if (materials === entry.appliedMaterials) continue;
      entry.appliedMaterials = materials;
      layer.update(layerDesc);
    }
  }

  /**
   * Add a MapLibre Style source to the Navara view.
   */
  private async addStyleSource(
    view: ThreeView,
    sourceId: string,
    sourceSpec: ParsedStyle["sources"][string],
  ): Promise<void> {
    if (sourceSpec.type === "geojson") {
      // Handle both inline GeoJSON data and URL-based sources
      const source =
        typeof sourceSpec.data === "string"
          ? view.addSource({ type: "geojson", url: sourceSpec.data })
          : view.addSource({ type: "geojson", data: sourceSpec.data });
      this.sources.set(sourceId, source);
    } else if (sourceSpec.type === "raster") {
      // Raster tile source (e.g., satellite imagery, basemaps)
      const source = await this.addTileSource(
        view,
        sourceId,
        sourceSpec,
        { type: "raster-tile" },
        { type: "raster-tile" },
        "Raster",
      );
      if (!source) return;
      this.sources.set(sourceId, source);
    } else if (sourceSpec.type === "raster-dem") {
      // Raster DEM source (for terrain/hillshade)
      const encodingRaw = sourceSpec.encoding || "mapbox";

      // Validate encoding and narrow type
      if (encodingRaw !== "terrarium" && encodingRaw !== "mapbox") {
        console.warn(
          `Raster-DEM source ${sourceId} has encoding="${encodingRaw}" which is not supported. ` +
            `Supported values: "terrarium", "mapbox". Skipping source.`,
        );
        return;
      }

      // Type is now narrowed to "terrarium" | "mapbox" by the validation above
      const encoding: "terrarium" | "mapbox" = encodingRaw;

      const elevationDecoder =
        encoding === "terrarium"
          ? TERRARIUM_ELEVATION_DECODER()
          : MAPBOX_ELEVATION_DECODER();

      const source = await this.addTileSource(
        view,
        sourceId,
        sourceSpec,
        { type: "raster-dem", tileSize: sourceSpec.tileSize, encoding },
        { type: "raster-dem", elevationDecoder, tileSize: sourceSpec.tileSize },
        "Raster-DEM",
      );
      if (!source) return;
      this.sources.set(sourceId, source);
    } else if (sourceSpec.type === "vector") {
      // Vector tile source (MVT)
      const source = await this.addTileSource(
        view,
        sourceId,
        sourceSpec,
        { type: "vector-tile" },
        { type: "vector-tile" },
        "Vector",
      );
      if (!source) return;
      this.sources.set(sourceId, source);
    } else {
      console.warn(
        `Unsupported source type: ${(sourceSpec as { type: string }).type}`,
      );
    }
  }

  /**
   * Supported layer types that require a source.
   */
  private static readonly SUPPORTED_LAYER_TYPES = new Set([
    "fill",
    "fill-extrusion",
    "line",
    "circle",
    "symbol",
    "raster",
    "hillshade",
    "color-relief",
    "background",
  ]);

  /**
   * Add a MapLibre Style layer to the Navara view. `rank` is its index in the
   * style: MapLibre places symbols from the top-most layer down.
   */
  private addStyleLayer(
    view: ThreeView,
    styleLayer: StyleLayer,
    rank: number,
  ): void {
    if (!this.parsedStyle) {
      throw new Error("Style not parsed yet");
    }

    // Check visibility (layout property supported by all layer types)
    // Skip layers with visibility: "none"
    if (styleLayer.layout?.visibility === "none") {
      return;
    }

    // Check if layer has a source
    if (!("source" in styleLayer) || !styleLayer.source) {
      // Background layers don't have sources - they're handled via applyBackgroundColor
      if (styleLayer.type === "background") {
        // Background is already applied in init() (via applyBackgroundColor), skip layer processing
        return;
      }
      // Other supported layer types require a source - this is a configuration error
      if (MapLibreStylePlugin.SUPPORTED_LAYER_TYPES.has(styleLayer.type)) {
        throw new Error(
          `Layer "${styleLayer.id}": Layer type "${styleLayer.type}" requires a source`,
        );
      }
      // Unsupported layer types without source (sky, fog, etc.) - warn and skip
      console.warn(
        `Layer "${styleLayer.id}": Unsupported layer type "${styleLayer.type}" (no source). Skipping layer.`,
      );
      return;
    }

    // Get the source for this layer
    const source = this.sources.get(styleLayer.source);
    if (!source) {
      // Supported layer types with missing source reference - this is a configuration error
      if (MapLibreStylePlugin.SUPPORTED_LAYER_TYPES.has(styleLayer.type)) {
        throw new Error(
          `Layer "${styleLayer.id}": Source "${styleLayer.source}" not found`,
        );
      }
      // Unsupported layer types - warn and skip
      console.warn(
        `Layer "${styleLayer.id}": Unsupported layer type "${styleLayer.type}". Skipping layer.`,
      );
      return;
    }

    // Create layer description
    // Get font family name from layer's text-font or fall back to first available font
    const fontFamily = this.getFontFamilyForLayer(styleLayer);
    const layerDesc = toLayerDescription(
      source,
      styleLayer,
      fontFamily,
      this.engine,
      view.getZoomLevel(MAPLIBRE_TILE_SIZE),
      rank,
    );

    // Skip unsupported layers (toLayerDescription returns null for unsupported types)
    if (!layerDesc) {
      return;
    }

    // Add layer
    const layer = view.addLayer(layerDesc);
    this.layers.push(layer);

    if (
      symbolLayerFollowsZoom(styleLayer) ||
      colorReliefLayerFollowsZoom(styleLayer)
    ) {
      this.zoomFollowingLayers.set(layer, {
        styleLayer,
        source,
        fontFamily,
        rank,
        appliedMaterials: serializeMaterials(layerDesc),
      });
    }

    // Set up feature evaluation for vector layers
    if (
      styleLayer.type === "fill" ||
      styleLayer.type === "fill-extrusion" ||
      styleLayer.type === "line" ||
      styleLayer.type === "circle" ||
      styleLayer.type === "symbol"
    ) {
      this.setupFeatureEvaluation(layer, styleLayer);
    }
  }

  /**
   * Set up feature evaluation callbacks for a layer.
   * This is where we bridge MapLibre expressions to Navara's evaluator API.
   */
  private setupFeatureEvaluation(layer: Layer, styleLayer: StyleLayer): void {
    // Zoom expressions need re-evaluation at every zoom step; minzoom/maxzoom
    // alone only when the zoom crosses the range
    const hasMinMaxZoom =
      ("minzoom" in styleLayer && styleLayer.minzoom !== undefined) ||
      ("maxzoom" in styleLayer && styleLayer.maxzoom !== undefined);

    if (MapLibreStylePlugin.layerUsesZoom(styleLayer)) {
      this.zoomDependentLayers.add(layer);
    } else if (hasMinMaxZoom) {
      this.zoomRangeLayers.set(layer, styleLayer);
    }

    // Determine MapLibre feature geometry type for expression evaluation
    // This is the GeoJSON geometry type used in MapLibre expressions (e.g., ["geometry-type"])
    // Symbol layers placed along lines only consume line geometry (see toLayerDescription).
    const featureGeometryType =
      styleLayer.type === "fill" || styleLayer.type === "fill-extrusion"
        ? "Polygon"
        : styleLayer.type === "line" ||
            getSymbolPlacement(styleLayer, this.engine) !== "point"
          ? "LineString"
          : "Point";

    // Create base filter function from styleLayer.filter expression
    let baseFilterFn: (ctx: {
      properties: Record<string, unknown> | undefined;
      zoom?: number;
    }) => boolean;

    try {
      baseFilterFn =
        "filter" in styleLayer && styleLayer.filter
          ? this.engine.createFilter(
              styleLayer.filter,
              styleLayer.type,
              featureGeometryType,
            )
          : () => true;
    } catch (err) {
      console.error(
        `Layer "${styleLayer.id}": Invalid filter expression. Skipping layer.`,
        err,
      );
      baseFilterFn = () => false;
    }

    // Wrap filter with zoom range check if minzoom/maxzoom are specified
    // This controls layer visibility based on zoom level
    const filterFn = (ctx: {
      properties: Record<string, unknown> | undefined;
      zoom?: number;
    }) => {
      // Check layer minzoom/maxzoom (controls entire layer visibility)
      if (!inZoomRange(styleLayer, ctx.zoom ?? 0)) return false;

      // Then apply the style filter expression
      return baseFilterFn(ctx);
    };

    // Create paint property evaluators
    const paintEvaluators = createPaintEvaluators(
      styleLayer,
      this.engine,
      featureGeometryType,
    );

    // Create layout property evaluators (for symbol layers)
    const layoutEvaluators =
      styleLayer.type === "symbol"
        ? createLayoutEvaluators(styleLayer, this.engine, featureGeometryType)
        : {};

    /**
     * Evaluate layout properties for symbol layers based on meshGeometryType.
     * Performance: Only evaluates properties needed for the current rendering mode.
     */
    const evaluateLayoutProperties = (
      ctx: { properties: Record<string, unknown> | undefined },
      meshGeometryType: string | undefined,
    ): Record<string, unknown> | undefined => {
      if (styleLayer.type !== "symbol") {
        return undefined;
      }

      const layoutValues: Record<string, unknown> = {};

      // Icon properties (needed for billboard rendering)
      if (meshGeometryType === "billboard") {
        const iconProps = [
          "icon-image",
          "icon-size",
          "icon-rotate",
          "symbol-sort-key",
        ];
        for (const key of iconProps) {
          const evalFn = layoutEvaluators[key];
          if (evalFn) {
            layoutValues[key] = evalFn(ctx);
          }
        }
      }

      // Text properties (needed for text rendering)
      if (meshGeometryType === "text") {
        const textProps = [
          "text-field",
          "text-size",
          "text-letter-spacing",
          "text-rotate",
          "text-transform",
          "symbol-sort-key",
        ];
        for (const key of textProps) {
          const evalFn = layoutEvaluators[key];
          if (evalFn) {
            layoutValues[key] = evalFn(ctx);
          }
        }
      }

      // If meshGeometryType is undefined or other value, evaluate all (fallback for safety)
      if (meshGeometryType !== "billboard" && meshGeometryType !== "text") {
        for (const [key, evalFn] of Object.entries(layoutEvaluators)) {
          layoutValues[key] = evalFn(ctx);
        }
      }

      return layoutValues;
    };

    // Shared evaluation function for both featureCreated and featureUpdated
    const evaluateFeature = ({
      evaluator,
    }: {
      evaluator: FeatureEvaluator;
    }) => {
      // Get camera zoom once before evaluate to avoid recursive WASM borrowing
      // Use MapLibre tile size (512px) to match background layer zoom calculations
      const cameraZoom = this.view?.getZoomLevel(MAPLIBRE_TILE_SIZE) ?? 0;

      evaluator.evaluate(
        ({ properties, meshGeomType: meshGeometryType }: FeatureInfo) => {
          // Use camera zoom for all features (simpler than per-tile zoom)
          const ctx = { properties, zoom: cameraZoom };

          // Check filter first
          if (!filterFn(ctx)) {
            return { show: false };
          }

          // Evaluate all paint properties
          const paintValues: Record<string, unknown> = {};
          for (const [key, evalFn] of Object.entries(paintEvaluators)) {
            try {
              paintValues[key] = evalFn(ctx);
            } catch (_err) {
              // Ignore evaluation errors for individual paint properties
            }
          }

          // Evaluate layout properties (only for symbol layers)
          const layoutValues = evaluateLayoutProperties(ctx, meshGeometryType);

          // Convert to Navara's EvaluatedValue format
          // meshGeometryType is the Navara mesh type ("billboard" | "text" | "polygon" | ...)
          // used to determine which properties to apply when both icon and text are present
          return toEvaluatedValue(
            styleLayer,
            paintValues,
            layoutValues,
            meshGeometryType,
            this.warnedLayers,
          );
        },
      );
    };

    // Register for both featureCreated and featureUpdated events
    layer.on("featureCreated", evaluateFeature);
    layer.on("featureUpdated", evaluateFeature);
  }

  /**
   * Apply camera position from MapLibre Style specification.
   * Reads center, zoom, centerAltitude, bearing, pitch, roll from the parsed style
   * and sets the initial camera position.
   *
   * MapLibre Style Spec defines these optional root properties:
   * - center: [lng, lat] - the map center point (target point) in degrees
   * - zoom: Web Mercator zoom level - controls camera distance from target
   * - centerAltitude: altitude of the target point in meters (defaults to 0)
   * - bearing: compass bearing in degrees (0 = north)
   * - pitch: tilt angle in degrees (0 = straight down, 60 = towards horizon)
   * - roll: camera roll in degrees
   *
   * Note: MapLibre pitch convention differs from Navara:
   * - MapLibre: pitch 0 = straight down, pitch 60 = towards horizon
   * - Navara: pitch -90 = straight down, pitch 0 = towards horizon
   *
   * @param view - ThreeView instance
   * @param fovRad - Optional FOV override in radians for zoom calculation
   */
  private applyCamera(view: ThreeView, fovRad?: number): void {
    if (!this.parsedStyle) return;

    const { center, zoom, centerAltitude, bearing, pitch, roll } =
      this.parsedStyle;

    // Only apply if center and zoom are specified
    if (!center || zoom === undefined) {
      return;
    }

    const [lng, lat] = center;

    // Convert zoom to camera viewing distance (camera-to-target distance)
    const cameraDistance = zoomToCameraDistance(
      zoom,
      view,
      lat,
      MAPLIBRE_TILE_SIZE,
      fovRad,
    );

    // Convert MapLibre pitch to Navara pitch
    const navaraPitch =
      pitch !== undefined ? maplibrePitchToNavaraPitch(pitch) : -90;

    // Build camera position using target + distance mode
    // This matches MapLibre's semantics where center is the target point
    const cameraPos = {
      lng, // Target point longitude
      lat, // Target point latitude
      height: centerAltitude ?? 0, // Target point altitude (ground elevation)
      distance: cameraDistance, // Camera-to-target viewing distance
      // MapLibre uses 'bearing' which maps to Navara's 'heading'
      heading: bearing ?? 0,
      pitch: navaraPitch,
      roll: roll ?? 0,
    };

    // Set camera instantly (no animation)
    view.setCamera(cameraPos);
  }

  /**
   * Clean up all resources when the plugin is disposed.
   * Removes event listeners, deletes layers/sources, and disposes child plugins.
   * Call this method when removing the plugin to prevent memory leaks.
   */
  dispose(): void {
    // Clean up zoom change listener (registered on three events)
    if (this.view && this.zoomChangeListener) {
      this.view.camera.off("move", this.zoomChangeListener);
      this.view.camera.off("moveend", this.zoomChangeListener);
      this.view.camera.off("frustumChanged", this.zoomChangeListener);
      this.zoomChangeListener = undefined;
    }

    // Clean up camera ready listener
    if (this.view && this.cameraReadyListener) {
      this.view.camera.off("frustumChanged", this.cameraReadyListener);
      this.cameraReadyListener = undefined;
    }

    // Delete all layers (layers reference sources)
    for (const layer of this.layers) {
      layer.delete();
    }
    this.layers = [];

    // Delete all sources
    for (const source of this.sources.values()) {
      source.delete();
    }
    this.sources.clear();

    // Dispose TileJsonPlugin only if it was created internally
    if (this.ownsTileJsonPlugin) {
      this.tileJsonPlugin.dispose();
    }

    // Clear other state
    this.warnedLayers.clear();
    this.warnedSources.clear();
    this.zoomDependentLayers.clear();
    this.zoomRangeLayers.clear();
    this.zoomFollowingLayers.clear();
    this.backgroundHandler?.clearCache();
    this.backgroundHandler = undefined;
    this.parsedStyle = null;
    this.view = undefined;
    this.lastZoom = undefined;
  }
}
