/**
 * Converts MapLibre Style layer to Navara layer description.
 */

import { type LayerDescription, type Source } from "@navaramap/three";

import type { StyleEngine } from "../engine/StyleEngine";
import { type StyleLayer } from "../engine/types";

import { toNavaraColor } from "./toEvaluatedValue";

/**
 * Helper to extract sourceLayers from MapLibre's source-layer property.
 * Returns an object with optional sourceLayers array.
 *
 * MapLibre uses singular "source-layer" (string) to specify which layer from a vector tile source to render.
 * Navara uses "sourceLayers" (array) to support multiple source layers in the future.
 */
function getSourceLayersField(styleLayer: StyleLayer): {
  sourceLayers?: string[];
} {
  if ("source-layer" in styleLayer && styleLayer["source-layer"]) {
    return { sourceLayers: [styleLayer["source-layer"]] };
  }
  return {};
}

/**
 * Create layer description for fill layer.
 */
function createFillLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    polygon: {
      clampToGround: true,
    },
  };
}

/**
 * Create layer description for fill-extrusion layer.
 */
function createFillExtrusionLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    polygon: {
      clampToGround: false,
    },
  };
}

/**
 * Create layer description for line layer.
 * Supports both LineString and Polygon sources (polygon boundaries).
 */
function createLineLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    polyline: {
      clampToGround: true,
      // Support deriving polylines from both line and polygon geometries
      // This allows line layers to render polygon boundaries (e.g., country borders)
      geometryTypes: ["line", "polygon"],
    },
  };
}

/**
 * Create layer description for circle layer.
 */
function createCircleLayer(
  source: Source,
  styleLayer: StyleLayer,
): LayerDescription {
  return {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
    point: {
      clampToGround: true,
      center: { x: 0, y: -0.5 },
    },
  };
}

/**
 * Create layer description for raster layer.
 */
function createRasterLayer(source: Source): LayerDescription {
  return {
    type: "raster",
    source,
  };
}

/**
 * Create layer description for hillshade layer.
 */
function createHillshadeLayer(source: Source): LayerDescription {
  return {
    type: "raster",
    source,
    hillshade: {},
  };
}

/**
 * Lazy-initialized transparent placeholder image for expression-based icon-image.
 * Uses canvas.toDataURL() to create a minimal transparent PNG programmatically.
 *
 * Note: While this still produces a data: URL, it's created at runtime via Canvas
 * rather than hardcoded. In strict CSP environments where data: URLs are blocked,
 * consider using constant icon-image values instead of expressions, or configure
 * CSP to allow 'data:' for img-src.
 */
let transparentPlaceholder: string | null = null;

/**
 * Create a minimal transparent image using Canvas API.
 * Returns a data URL, but created programmatically to minimize size.
 * Falls back to SVG data URL in non-browser environments (SSR/Node).
 */
function getTransparentPlaceholder(): string {
  if (transparentPlaceholder) return transparentPlaceholder;

  try {
    // Create a 1x1 transparent canvas
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    // Canvas is already transparent by default
    transparentPlaceholder = canvas.toDataURL("image/png");
    return transparentPlaceholder;
  } catch {
    // Fallback to minimal SVG data URL if Canvas creation fails - cache it
    transparentPlaceholder =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
    return transparentPlaceholder;
  }
}

/**
 * Get icon URL from layout.
 * For constant strings, returns the URL directly.
 * For expressions, returns a transparent placeholder - the actual image will be set
 * dynamically via the `image` property during feature evaluation.
 */
function getIconUrl(iconImage: unknown): string {
  // If icon-image is a constant string, use it directly
  // If it's an expression, use transparent placeholder (will be overridden via feature.image)
  return typeof iconImage === "string" && iconImage
    ? iconImage
    : getTransparentPlaceholder();
}

/**
 * Create layer description for symbol layer.
 * Returns null if the layer is misconfigured (no icon-image or text-field).
 */
function createSymbolLayer(
  source: Source,
  styleLayer: StyleLayer,
  fontFamily?: string,
  engine?: StyleEngine,
): LayerDescription | null {
  const layout = styleLayer.layout;

  // Check what this symbol layer should render based on layout properties
  const hasIconImage = layout?.["icon-image"] !== undefined;
  const hasTextField = layout?.["text-field"] !== undefined;

  if (!hasIconImage && !hasTextField) {
    // Warn but don't throw - allows loading styles with misconfigured symbol layers
    console.warn(
      `Symbol layer "${styleLayer.id}" has no icon-image or text-field configured. Skipping layer.`,
    );
    return null;
  }

  // Warn if text is configured but no font provided
  if (hasTextField && !fontFamily) {
    console.warn(
      `Symbol layer "${styleLayer.id}" has text-field but no font was provided to MapLibreStylePlugin. ` +
        `Text rendering will be skipped. ` +
        `Provide fontFamily option: new MapLibreStylePlugin(style, { fontFamily: await fetchFontFamilyFromCssForMapLibreStyle('FontName', 'https://...') })`,
    );
    // If there's no icon either, this layer can't render anything - skip it
    if (!hasIconImage) {
      return null;
    }
  }

  // Build layer description based on what's configured
  const layerDesc: LayerDescription = {
    type: "vector",
    source,
    ...getSourceLayersField(styleLayer),
  };

  if (hasIconImage) {
    layerDesc.billboard = {
      size: 1.0,
      height: 1,
      sizeInMeters: false,
      clampToGround: true,
      depthTest: true,
      url: getIconUrl(layout?.["icon-image"]),
      offsetDepth: true,
      transparent: true,
      center: hasTextField ? { x: 1.0, y: -0.5 } : { x: 0.5, y: -0.5 },
    };
  }

  if (hasTextField && fontFamily) {
    layerDesc.text = {
      clampToGround: true,
      font: fontFamily, // Use the font family name registered via addFontFamily
      text: "",
      size: 1.0,
      sizeInMeters: false,
      center: hasIconImage ? { x: 0.0, y: 0.0 } : { x: 0.5, y: 0.0 },
      depthTest: true,
      offsetDepth: true,
      declutter: true, // Enable declutter to hide duplicate/overlapping labels
    };

    // Apply text-halo properties (outlineColor/outlineWidth/outlineOpacity)
    // TODO: Text halo is currently a layer-level property, evaluated once at construction time
    // with properties=undefined and zoom=defaultZoom. This means text-halo expressions cannot
    // use feature properties or respond to zoom changes. To fix this, Navara's EvaluatedValue
    // should support outlineColor/outlineWidth fields so they can be evaluated per-feature.
    if (engine && styleLayer.type === "symbol") {
      const defaultZoom = 10; // Use middle zoom for evaluation

      // Track color alpha separately to combine with explicit opacity at the end
      let haloColorAlpha = 1.0;

      // Evaluate text-halo-color
      const haloColor = styleLayer.paint?.["text-halo-color"];
      if (haloColor !== undefined) {
        try {
          const haloColorSpec = engine.getPaintSpec(
            "symbol",
            "text-halo-color",
          );
          if (haloColorSpec) {
            const evalFn = engine.createValueFn(haloColor, haloColorSpec);
            const colorValue = evalFn({
              properties: undefined,
              zoom: defaultZoom,
            });

            // Convert to Navara Color and extract alpha (don't set opacity yet)
            const colorResult = toNavaraColor(colorValue);
            if (colorResult) {
              layerDesc.text.outlineColor = colorResult.color;
              haloColorAlpha = colorResult.alpha;
            }
          }
        } catch (err) {
          console.warn(
            `Failed to evaluate text-halo-color for layer "${styleLayer.id}":`,
            err,
          );
        }
      }

      // Evaluate text-halo-width
      const haloWidth = styleLayer.paint?.["text-halo-width"];
      if (haloWidth !== undefined) {
        try {
          const haloWidthSpec = engine.getPaintSpec(
            "symbol",
            "text-halo-width",
          );
          if (haloWidthSpec) {
            const evalFn = engine.createValueFn(haloWidth, haloWidthSpec);
            const widthValue = evalFn({
              properties: undefined,
              zoom: defaultZoom,
            });

            if (typeof widthValue === "number" && Number.isFinite(widthValue)) {
              // MapLibre text-halo-width is in screen pixels
              // Navara outlineWidth is in texels at 64px/em reference density
              // For now, use the value directly (may need adjustment based on text-size)
              layerDesc.text.outlineWidth = widthValue;
            }
          }
        } catch (err) {
          console.warn(
            `Failed to evaluate text-halo-width for layer "${styleLayer.id}":`,
            err,
          );
        }
      }

      // Combine color alpha with explicit opacity (if text-halo-opacity is evaluated in future)
      // Only set opacity if a halo color was configured (avoid forcing default when no halo)
      if (layerDesc.text.outlineColor !== undefined) {
        const explicitOpacity = layerDesc.text.outlineOpacity;
        // Only set opacity if there's an explicit value or the color has alpha < 1
        // This preserves undefined behavior when haloColorAlpha === 1.0 (engine default)
        if (explicitOpacity !== undefined || haloColorAlpha !== 1.0) {
          const finalOpacity =
            explicitOpacity !== undefined
              ? haloColorAlpha * explicitOpacity
              : haloColorAlpha;
          // Validate finalOpacity is finite, fall back to 1.0 if NaN/Infinity
          const validOpacity = Number.isFinite(finalOpacity)
            ? finalOpacity
            : 1.0;
          // Clamp to [0, 1] to handle invalid input or multiplication overflow
          layerDesc.text.outlineOpacity = Math.max(
            0,
            Math.min(1, validOpacity),
          );
        }
      }
    }
  }

  return layerDesc;
}

/**
 * Convert MapLibre Style layer to Navara layer description.
 *
 * @param source - Navara source object
 * @param styleLayer - MapLibre layer specification
 * @param fontFamily - Optional font family name for text rendering (ignores style's text-font)
 * @param engine - Optional style engine for evaluating expressions (e.g., text-halo properties)
 * @returns Navara layer description, or null if the layer cannot be processed
 *
 * Note: Returns null for unsupported/misconfigured layers instead of throwing,
 * allowing the plugin to continue loading other layers from third-party styles.
 * Reasons for returning null:
 * - Unsupported layer type (e.g., "background", "sky")
 * - Misconfigured symbol layer (no icon-image or text-field)
 */
export function toLayerDescription(
  source: Source,
  styleLayer: StyleLayer,
  fontFamily?: string,
  engine?: StyleEngine,
): LayerDescription | null {
  switch (styleLayer.type) {
    case "fill":
      return createFillLayer(source, styleLayer);
    case "fill-extrusion":
      return createFillExtrusionLayer(source, styleLayer);
    case "line":
      return createLineLayer(source, styleLayer);
    case "circle":
      return createCircleLayer(source, styleLayer);
    case "raster":
      return createRasterLayer(source);
    case "hillshade":
      return createHillshadeLayer(source);
    case "symbol":
      return createSymbolLayer(source, styleLayer, fontFamily, engine);
    default:
      // Warn but don't throw - allows loading third-party styles with unsupported layers
      // TypeScript exhaustively narrows styleLayer to never, but we handle unknown types at runtime
      console.warn(
        `Layer "${(styleLayer as StyleLayer).id}": Unsupported layer type "${(styleLayer as StyleLayer).type}". Skipping layer.`,
      );
      return null;
  }
}
