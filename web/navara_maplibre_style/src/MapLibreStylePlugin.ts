/**
 * MapLibreStylePlugin - Bridge between MapLibre Style JSON and Navara's imperative API.
 *
 * This plugin translates declarative MapLibre Style specifications into Navara layer
 * operations and feature evaluators.
 */
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { Plugin } from "@navaramap/core";
import ThreeView, {
  type ViewContext,
  type Layer,
  type Source,
  type FeatureEvaluator,
  type FeatureInfo,
  type FontFamily,
  TERRARIUM_ELEVATION_DECODER,
  MAPBOX_ELEVATION_DECODER,
} from "@navaramap/three";
import { TileJsonPlugin } from "@navaramap/three-plugins";

import {
  createLayoutEvaluators,
  createPaintEvaluators,
  toEvaluatedValue,
  toNavaraColor,
} from "./adapters/toEvaluatedValue";
import { toLayerDescription } from "./adapters/toLayerDescription";
import { JsStyleEngine } from "./engine/JsStyleEngine";
import type { ParsedStyle, StyleLayer } from "./engine/types";

export class MapLibreStylePlugin extends Plugin<ThreeView, ViewContext> {
  private sources: Map<string, Source> = new Map<string, Source>();
  private layers: Layer[] = [];
  private parsedStyle: ParsedStyle | null = null;
  /**
   * Track layers that have already warned about invalid geometry types to avoid spamming the console.
   */
  private warnedLayers: Set<string> = new Set<string>();
  /**
   * TileJSON plugin instance for fetching and parsing TileJSON sources.
   */
  private tileJsonPlugin: TileJsonPlugin = new TileJsonPlugin();
  /**
   * Font faces to register for text rendering.
   * Created via fetchFontFamilyFromCssForMapLibreStyle.
   */
  private readonly fontFamily?: FontFamily;
  private view?: ThreeView;
  /**
   * Style engine for evaluating MapLibre expressions.
   * Uses JsStyleEngine internally.
   */
  private readonly engine = new JsStyleEngine();
  /**
   * Last camera zoom level. Used to detect zoom changes that require feature re-evaluation.
   * undefined when not yet initialized.
   */
  private lastZoom: number | undefined = undefined;
  /**
   * Minimum zoom change to trigger feature re-evaluation.
   * Features are re-evaluated when zoom changes by more than this threshold.
   */
  private static readonly ZOOM_CHANGE_THRESHOLD = 0.5;
  /**
   * Zoom change listener function reference for cleanup in destroy.
   */
  private zoomChangeListener?: () => void;
  /**
   * Layers that have zoom-dependent expressions (filter, paint, or layout).
   * Only these layers need to be updated when zoom changes.
   */
  private zoomDependentLayers = new Set<Layer>();
  /**
   * Whether any background layer has zoom-dependent expressions.
   * If false, we can skip re-evaluating background color on zoom changes.
   */
  private hasZoomDependentBackground = false;

  /**
   * Create a new MapLibre Style plugin.
   *
   * @param style - MapLibre Style JSON specification or URL
   * @param options - Optional configuration
   * @param options.fontFamily - Font faces for text rendering (created via fetchFontFamilyFromCssForMapLibreStyle)
   *                            When provided, text-font and glyphs settings from the style are ignored.
   */
  constructor(
    private readonly style: string | StyleSpecification,
    options?: {
      fontFamily?: FontFamily;
    },
  ) {
    super();
    this.fontFamily = options?.fontFamily;
  }

  /**
   * Check if an expression uses the zoom operator.
   * Recursively searches for ["zoom"] in the expression tree.
   * Also detects legacy function objects with stops (zoom-dependent).
   */
  private static expressionUsesZoom(expr: unknown): boolean {
    // Check for legacy function objects with stops: { stops: [[zoom, value], ...] }
    // These are zoom-dependent and will be converted to zoom expressions by the engine
    if (expr && typeof expr === "object" && !Array.isArray(expr)) {
      // Use safe property access with type guard
      const obj = expr as Record<string, unknown>;
      if ("stops" in obj && Array.isArray(obj.stops)) {
        return true;
      }
      // Check nested objects recursively
      for (const value of Object.values(obj)) {
        if (this.expressionUsesZoom(value)) {
          return true;
        }
      }
      return false;
    }

    if (!Array.isArray(expr)) {
      return false;
    }

    // Check if this is a zoom expression
    if (expr[0] === "zoom") {
      return true;
    }

    // Recursively check nested expressions
    for (const item of expr) {
      if (this.expressionUsesZoom(item)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a layer has any zoom-dependent expressions in filter, paint, or layout.
   */
  private static layerUsesZoom(layer: StyleLayer): boolean {
    // Check filter
    if (
      "filter" in layer &&
      layer.filter &&
      this.expressionUsesZoom(layer.filter)
    ) {
      return true;
    }

    // Check paint properties
    if ("paint" in layer && layer.paint) {
      for (const value of Object.values(layer.paint)) {
        if (this.expressionUsesZoom(value)) {
          return true;
        }
      }
    }

    // Check layout properties
    if ("layout" in layer && layer.layout) {
      for (const value of Object.values(layer.layout)) {
        if (this.expressionUsesZoom(value)) {
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

    try {
      // Parse and validate the style
      this.parsedStyle = await this.engine.parseStyle(styleData);

      // Check if style uses glyphs (not supported)
      if (this.parsedStyle.glyphs) {
        console.warn(
          "MapLibre Style uses 'glyphs' for font rendering, which is not supported by Navara. " +
            (this.fontFamily
              ? `Text will use the provided font family instead.`
              : "Please provide fontFamily option to enable text rendering. " +
                "Example: new MapLibreStylePlugin(style, { fontFamily: await fetchFontFamilyFromCssForMapLibreStyle('Open Sans', 'https://fonts.googleapis.com/...') })"),
        );
      }
    } catch (err) {
      console.error("Failed to parse MapLibre style:", err);
      throw err;
    }

    // Now that style parsing succeeded, initialize resources that need cleanup
    // Initialize TileJsonPlugin for TileJSON source support
    await this.tileJsonPlugin.init(view, ctx);

    // Register font faces if provided
    if (this.fontFamily) {
      view.addFontFamily(this.fontFamily);
    }

    // Set up zoom change detection for re-evaluating features
    this.setupZoomChangeDetection(view);

    // Step 1: Check for zoom-dependent background layers
    // Background is zoom-dependent if:
    // - Any background layer uses zoom expressions, OR
    // - Any background layer has minzoom/maxzoom (changes which layer applies at different zooms), OR
    // - Multiple background layers exist (last applicable layer may change with zoom)
    const backgroundLayers = this.parsedStyle.layers.filter(
      (layer) => layer.type === "background",
    );
    this.hasZoomDependentBackground =
      backgroundLayers.length > 1 ||
      backgroundLayers.some(
        (layer) =>
          MapLibreStylePlugin.layerUsesZoom(layer) ||
          "minzoom" in layer ||
          "maxzoom" in layer,
      );

    // Step 2: Handle background layer (set globe color)
    // Use current camera zoom, or default to 0 if not yet available
    const initialZoom = view.camera.zoom ?? 0;
    this.applyBackgroundColor(view, initialZoom);

    // Step 3: Add all sources first
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

    // Step 4: Add layers that reference the sources
    for (const styleLayer of this.parsedStyle.layers) {
      try {
        this.addStyleLayer(view, styleLayer);
      } catch (err) {
        console.error(`Failed to add layer "${styleLayer.id}":`, err);
        // Continue loading other layers
      }
    }

    // Step 5: Add terrain if specified
    if (this.parsedStyle.terrain) {
      try {
        this.addStyleTerrain(view, this.parsedStyle.terrain);
      } catch (err) {
        console.error("Failed to add terrain:", err);
        // Continue without terrain
      }
    }
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
      // Direct tiles array
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
   * Apply background layer color/opacity to the globe.
   * Finds the last applicable background layer (respecting minzoom/maxzoom)
   * and evaluates its properties at the given zoom level.
   * Supports background-color, background-opacity, and visibility properties.
   *
   * @param view - ThreeView to apply background to
   * @param zoom - Current camera zoom level for evaluating zoom-dependent expressions
   */
  private applyBackgroundColor(view: ThreeView, zoom: number): void {
    if (!this.parsedStyle) return;

    // Find the LAST applicable background layer (later layers override earlier ones)
    // Scan from end to beginning and find the first one that matches zoom constraints
    let backgroundLayer: StyleLayer | undefined;
    for (let i = this.parsedStyle.layers.length - 1; i >= 0; i--) {
      const layer = this.parsedStyle.layers[i];
      if (layer.type !== "background") continue;

      // Check visibility (from layout property)
      const visibility = layer.layout?.visibility;
      if (visibility === "none") continue;

      // Check zoom constraints (minzoom/maxzoom)
      if (layer.minzoom !== undefined && zoom < layer.minzoom) continue;
      if (layer.maxzoom !== undefined && zoom >= layer.maxzoom) continue;

      // Found the last applicable background layer
      backgroundLayer = layer;
      break;
    }

    if (!backgroundLayer) return;

    // Type guard: ensure this is actually a background layer with background paint
    if (backgroundLayer.type !== "background") return;

    // Evaluate background-color (always apply spec default if property is missing)
    // This ensures predictable behavior when background-opacity is set without background-color
    let colorAlpha = 1.0;
    try {
      // Get the official spec for background-color to access its default value
      const bgColorSpec = this.engine.getPaintSpec(
        "background",
        "background-color",
      );
      // Cast to string since background-color default is always a color string in the spec
      const specDefault =
        (bgColorSpec?.default as string | undefined) ?? "#000000";

      const bgColor = this.engine.createValueFn(
        backgroundLayer.paint?.["background-color"] ?? specDefault,
        bgColorSpec ?? { type: "color", default: specDefault },
      );
      // Evaluate with current zoom level for zoom-dependent expressions
      const colorValue = bgColor({ properties: undefined, zoom });

      // Convert to Navara Color and extract alpha using helper
      const colorResult = toNavaraColor(colorValue);
      if (colorResult) {
        view.globe.color = colorResult.color;
        colorAlpha = colorResult.alpha;
      }
    } catch (err) {
      console.warn("Failed to apply background-color:", err);
    }

    // Evaluate background-opacity and combine with color alpha
    let explicitOpacity: number | undefined;
    if (backgroundLayer.paint?.["background-opacity"] !== undefined) {
      try {
        const bgOpacity = this.engine.createValueFn(
          backgroundLayer.paint["background-opacity"],
          { type: "number", default: 1 },
        );
        const opacityValue = bgOpacity({ properties: undefined, zoom });
        if (typeof opacityValue === "number" && Number.isFinite(opacityValue)) {
          explicitOpacity = opacityValue;
        }
      } catch (err) {
        console.warn("Failed to apply background-opacity:", err);
      }
    }

    // Combine color alpha with explicit opacity and clamp to [0, 1]
    const finalOpacity =
      explicitOpacity !== undefined ? colorAlpha * explicitOpacity : colorAlpha;
    view.globe.opacity = Math.max(0, Math.min(1, finalOpacity));
  }

  /**
   * Set up zoom change detection to trigger feature re-evaluation.
   * When zoom changes significantly (> ZOOM_CHANGE_THRESHOLD), all layers are updated
   * to re-evaluate zoom-dependent expressions with the new zoom value.
   */
  private setupZoomChangeDetection(view: ThreeView): void {
    // Create and store listener function for later removal in destroy()
    this.zoomChangeListener = () => {
      const currentZoom = view.camera.zoom;

      // Skip if zoom is not available yet (camera not fully initialized)
      if (currentZoom === undefined) return;

      // Initialize lastZoom on first valid zoom value
      if (this.lastZoom === undefined) {
        this.lastZoom = currentZoom;
        return;
      }

      const zoomDelta = Math.abs(currentZoom - this.lastZoom);

      // If zoom changed significantly, trigger feature re-evaluation
      if (zoomDelta > MapLibreStylePlugin.ZOOM_CHANGE_THRESHOLD) {
        this.lastZoom = currentZoom;

        // Re-evaluate background color if it has zoom-dependent expressions
        if (this.hasZoomDependentBackground) {
          this.applyBackgroundColor(view, currentZoom);
        }

        // Trigger re-evaluation only on layers with zoom-dependent expressions
        for (const layer of this.zoomDependentLayers) {
          layer.forceUpdate();
        }
      }
    };

    // Register the listener
    view.on("preRender", this.zoomChangeListener);
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
    "background",
  ]);

  /**
   * Add a MapLibre Style layer to the Navara view.
   */
  private addStyleLayer(view: ThreeView, styleLayer: StyleLayer): void {
    if (!this.parsedStyle) {
      throw new Error("Style not parsed yet");
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
    // Use fixed font family name if fontFamily was provided
    const fontFamily = this.fontFamily ? this.fontFamily.family : undefined;
    const layerDesc = toLayerDescription(
      source,
      styleLayer,
      fontFamily,
      this.engine,
    );

    // Skip unsupported layers (toLayerDescription returns null for unsupported types)
    if (!layerDesc) {
      return;
    }

    // Add layer
    const layer = view.addLayer(layerDesc);
    this.layers.push(layer);

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
    // Track if this layer has zoom-dependent expressions OR minzoom/maxzoom
    const hasMinMaxZoom =
      ("minzoom" in styleLayer && styleLayer.minzoom !== undefined) ||
      ("maxzoom" in styleLayer && styleLayer.maxzoom !== undefined);

    if (MapLibreStylePlugin.layerUsesZoom(styleLayer) || hasMinMaxZoom) {
      this.zoomDependentLayers.add(layer);
    }

    // Determine MapLibre feature geometry type for expression evaluation
    // This is the GeoJSON geometry type used in MapLibre expressions (e.g., ["geometry-type"])
    const featureGeometryType =
      styleLayer.type === "fill" || styleLayer.type === "fill-extrusion"
        ? "Polygon"
        : styleLayer.type === "line"
          ? "LineString"
          : "Point";

    // Create base filter function from styleLayer.filter expression
    const baseFilterFn =
      "filter" in styleLayer && styleLayer.filter
        ? this.engine.createFilter(
            styleLayer.filter,
            styleLayer.type,
            featureGeometryType,
          )
        : () => true;

    // Wrap filter with zoom range check if minzoom/maxzoom are specified
    // This controls layer visibility based on zoom level
    const filterFn = (ctx: {
      properties: Record<string, unknown> | undefined;
      zoom?: number;
    }) => {
      const zoom = ctx.zoom ?? 0;

      // Check layer minzoom/maxzoom (controls entire layer visibility)
      if ("minzoom" in styleLayer && styleLayer.minzoom !== undefined) {
        if (zoom < styleLayer.minzoom) return false;
      }
      if ("maxzoom" in styleLayer && styleLayer.maxzoom !== undefined) {
        if (zoom >= styleLayer.maxzoom) return false;
      }

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
          "icon-anchor",
          "icon-offset",
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
          "text-font",
          "text-anchor",
          "text-offset",
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
      const cameraZoom = this.view?.camera.zoom ?? 0;

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
   * Clean up all resources when the plugin is disposed.
   * Removes event listeners, deletes layers/sources, and disposes child plugins.
   * Call this method when removing the plugin to prevent memory leaks.
   */
  dispose(): void {
    // Clean up zoom change listener
    if (this.view && this.zoomChangeListener) {
      this.view.off("preRender", this.zoomChangeListener);
      this.zoomChangeListener = undefined;
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

    // Dispose TileJsonPlugin (clears attribution credits and events)
    this.tileJsonPlugin.dispose();

    // Clear other state
    this.warnedLayers.clear();
    this.zoomDependentLayers.clear();
    this.hasZoomDependentBackground = false;
    this.parsedStyle = null;
    this.view = undefined;
    this.lastZoom = undefined;
  }
}
