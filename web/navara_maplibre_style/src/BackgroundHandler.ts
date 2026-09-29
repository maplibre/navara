import ThreeView, { Color } from "@navaramap/three";

import { toNavaraColor } from "./adapters/toEvaluatedValue";
import type { StyleEngine } from "./engine/StyleEngine";
import type {
  EvaluationContext,
  ParsedStyle,
  StyleLayer,
} from "./engine/types";
import { expressionUsesZoom } from "./utils/expressionHelpers";

/**
 * Handles background layer evaluation and rendering.
 * Caches compiled evaluators to avoid redundant expression compilation.
 */
export class BackgroundHandler {
  /**
   * Cached background evaluators to avoid recompiling expressions on every call.
   * Stores paint object reference for invalidation when style is replaced.
   *
   * Note: Assumes paint objects are treated as immutable. If paint properties
   * are mutated in-place without replacing the object, evaluators may become stale.
   * MapLibre typically replaces style/paint objects rather than mutating them.
   */
  private cache?: {
    layerId: string;
    paintReference: unknown; // Reference to paint object for invalidation
    colorEvaluator: (ctx: EvaluationContext) => unknown;
    opacityEvaluator?: (ctx: EvaluationContext) => unknown;
  };

  /**
   * Precomputed flag: whether background needs re-evaluation on zoom changes.
   * Computed once at construction to avoid repeated layer traversal.
   */
  private readonly hasZoomDependency: boolean;

  /**
   * Precomputed list of background layers in reverse draw order (last to first).
   * Cached to avoid scanning all layers on every apply() call.
   */
  private readonly backgroundLayers: StyleLayer[];

  /**
   * Cached parsed default background color from spec.
   * Used as fallback when no layer applies or on errors.
   */
  private readonly defaultColor: { color: Color; alpha: number };

  constructor(
    private readonly engine: StyleEngine,
    private readonly parsedStyle: ParsedStyle,
  ) {
    // Precompute background layers (in reverse order for efficient lookup)
    this.backgroundLayers = this.parsedStyle.layers
      .filter((layer) => layer.type === "background")
      .reverse();
    // Get and parse spec default for background-color
    const bgColorSpec = this.engine.getPaintSpec(
      "background",
      "background-color",
    );
    const specDefault =
      (bgColorSpec?.default as string | undefined) ?? "#000000";

    const colorResult = toNavaraColor(specDefault);
    if (colorResult) {
      this.defaultColor = colorResult;
    } else {
      // Ultimate fallback if spec default parsing fails
      const fallbackColor = new Color().setRGB(0, 0, 0);
      this.defaultColor = { color: fallbackColor, alpha: 1.0 };
    }

    this.hasZoomDependency = this.computeZoomDependency();
  }

  /**
   * Check if background needs re-evaluation on zoom changes.
   * Returns the precomputed value from construction time.
   */
  needsZoomUpdate(): boolean {
    return this.hasZoomDependency;
  }

  /**
   * Compute whether background needs re-evaluation on zoom changes.
   * Called once at construction time.
   * Returns true if:
   * - Any background layer uses zoom expressions in paint properties, OR
   * - Any background layer has zoom constraints (minzoom/maxzoom affects which layer applies or if default background is used)
   */
  private computeZoomDependency(): boolean {
    // Use precomputed backgroundLayers to avoid redundant filtering
    if (this.backgroundLayers.length === 0) {
      return false;
    }

    // Check each background layer for zoom-dependent properties
    for (const layer of this.backgroundLayers) {
      const bgLayer = layer as StyleLayer & { type: "background" };

      // Zoom constraints affect whether the layer applies (even for a single layer)
      if (bgLayer.minzoom !== undefined || bgLayer.maxzoom !== undefined) {
        return true;
      }

      // Check if background-color or background-opacity use zoom expressions
      if (bgLayer.paint) {
        const bgColor = bgLayer.paint["background-color"];
        const bgOpacity = bgLayer.paint["background-opacity"];

        if (expressionUsesZoom(bgColor) || expressionUsesZoom(bgOpacity)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Apply default background to the view.
   * Used as fallback when no layer applies or on errors.
   * Matches MapLibre's fallback: opaque black background.
   */
  private applyDefaultBackground(view: ThreeView): void {
    // Apply cached default color (typically black #000000)
    // Note: view.globe.color is a getter/setter, so we must assign rather than modify
    // Clone the cached color to avoid shared mutable state
    view.globe.color = this.defaultColor.color.clone();

    // MapLibre's fallback background is always fully opaque
    view.globe.opacity = 1.0;
    view.globe.transparent = false;
  }

  /**
   * Apply background color to the view at the given zoom level.
   * Reuses compiled evaluators when the background layer hasn't changed.
   */
  apply(view: ThreeView, zoom: number): void {
    // Find the LAST applicable background layer (later layers override earlier ones)
    // Use precomputed backgroundLayers (already in reverse order) to avoid scanning all layers
    let backgroundLayer: StyleLayer | undefined;
    for (const layer of this.backgroundLayers) {
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

    // If no background layer applies, reset to MapLibre's default background (#000000)
    if (!backgroundLayer) {
      this.applyDefaultBackground(view);
      return;
    }

    // Type guard: ensure this is actually a background layer with background paint
    if (backgroundLayer.type !== "background") return;

    // Check if we need to recompile evaluators (layer ID or paint object reference changed)
    // Note: Uses reference equality; won't detect in-place paint mutations
    const needsRecompile =
      !this.cache ||
      this.cache.layerId !== backgroundLayer.id ||
      this.cache.paintReference !== backgroundLayer.paint;

    if (needsRecompile) {
      // Compile and cache evaluators
      try {
        const bgColorSpec = this.engine.getPaintSpec(
          "background",
          "background-color",
        );
        const specDefault =
          (bgColorSpec?.default as string | undefined) ?? "#000000";

        const colorEvaluator = this.engine.createValueFn(
          backgroundLayer.paint?.["background-color"] ?? specDefault,
          bgColorSpec ?? { type: "color", default: specDefault },
        );

        let opacityEvaluator: ((ctx: EvaluationContext) => unknown) | undefined;
        if (backgroundLayer.paint?.["background-opacity"] !== undefined) {
          opacityEvaluator = this.engine.createValueFn(
            backgroundLayer.paint["background-opacity"],
            { type: "number", default: 1 },
          );
        }

        this.cache = {
          layerId: backgroundLayer.id,
          paintReference: backgroundLayer.paint,
          colorEvaluator,
          opacityEvaluator,
        };
      } catch (err) {
        console.warn("Failed to compile background evaluators", err);
        this.applyDefaultBackground(view);
        return;
      }
    }

    // Safety check: ensure cache exists after compilation
    if (!this.cache) {
      this.applyDefaultBackground(view);
      return;
    }

    // Evaluate background-color using cached evaluator
    let colorAlpha = 1.0;
    let colorSet = false;
    try {
      const colorValue = this.cache.colorEvaluator({
        properties: undefined,
        zoom,
      });

      // Convert to Navara Color and extract alpha using helper
      const colorResult = toNavaraColor(colorValue);
      if (colorResult) {
        // Assign the evaluated color directly
        // Note: view.globe.color is a getter/setter, so we must assign rather than modify
        view.globe.color = colorResult.color;
        colorAlpha = colorResult.alpha;
        colorSet = true;
      }
    } catch (err) {
      console.warn("Failed to evaluate background-color", err);
    }

    // If color evaluation/parsing failed, apply default background and stop
    if (!colorSet) {
      this.applyDefaultBackground(view);
      return;
    }

    // Evaluate background-opacity using cached evaluator
    let explicitOpacity: number | undefined;
    if (this.cache.opacityEvaluator) {
      try {
        const opacityValue = this.cache.opacityEvaluator({
          properties: undefined,
          zoom,
        });
        if (typeof opacityValue === "number" && Number.isFinite(opacityValue)) {
          explicitOpacity = opacityValue;
        }
      } catch (err) {
        console.warn("Failed to evaluate background-opacity", err);
      }
    }

    // Combine color alpha and explicit opacity (both default to 1.0 if not set)
    const finalOpacity = colorAlpha * (explicitOpacity ?? 1.0);

    // Validate and clamp opacity to [0, 1] to prevent rendering bugs
    const validOpacity = Number.isFinite(finalOpacity) ? finalOpacity : 1.0;
    const clampedOpacity = Math.max(0, Math.min(1, validOpacity));

    // Apply validated opacity to the globe
    view.globe.opacity = clampedOpacity;
    view.globe.transparent = clampedOpacity < 1.0;
  }

  /**
   * Clear cached evaluators (e.g., when style changes).
   */
  clearCache(): void {
    this.cache = undefined;
  }
}
