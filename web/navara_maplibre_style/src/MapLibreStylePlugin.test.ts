import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type ThreeView from "@navaramap/three";
import type { ViewContext } from "@navaramap/three";
import { describe, it, vi, beforeEach, expect } from "vitest";

import { MapLibreStylePlugin } from "./MapLibreStylePlugin";

// Mock @navaramap/core - Plugin is imported from here
vi.mock("@navaramap/core", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  Plugin: class Plugin {
    // Empty base class - don't define init() here to avoid shadowing subclass methods
    // Real Plugin class is abstract and subclasses provide their own init()
  },
}));

// Mock @navaramap/three - provides ThreeView default export and elevation decoders
vi.mock("@navaramap/three", () => {
  class MockThreeView {
    addSource = vi.fn();
    addLayer = vi.fn();
  }

  // Mock Color class with methods used by MapLibreStylePlugin
  class MockColor {
    r = 0;
    g = 0;
    b = 0;

    setStyle(_style: string) {
      // Simple parsing for test purposes
      return this;
    }

    setRGB(r: number, g: number, b: number) {
      this.r = r;
      this.g = g;
      this.b = b;
      return this;
    }
  }

  return {
    default: MockThreeView,
    Color: MockColor,
    TERRARIUM_ELEVATION_DECODER: () => ({ type: "terrarium" }),
    MAPBOX_ELEVATION_DECODER: () => ({ type: "mapbox" }),
  };
});

// Mock TileJsonPlugin with spy methods
const mockTileJsonPluginAddSource = vi
  .fn()
  .mockResolvedValue({ delete: vi.fn() });
const mockTileJsonPluginInit = vi.fn().mockResolvedValue(undefined);
const mockTileJsonPluginDispose = vi.fn();

// Mock @navaramap/three-plugins - TileJsonPlugin is imported from here
vi.mock("@navaramap/three-plugins", () => ({
  TileJsonPlugin: class TileJsonPlugin {
    init = mockTileJsonPluginInit;
    addSource = mockTileJsonPluginAddSource;
    dispose = mockTileJsonPluginDispose;
  },
}));

// Mock ViewContext
const mockViewContext: ViewContext = {} as ViewContext;

// Create mock view
function createMockView(initialZoom = 10): ThreeView {
  const mockGlobe = {
    color: undefined as any,
    opacity: 1,
  };

  const mockCamera = {
    zoom: initialZoom,
  };

  return {
    addSource: vi.fn().mockReturnValue({ delete: vi.fn() }),
    addLayer: vi
      .fn()
      .mockReturnValue({ delete: vi.fn(), on: vi.fn(), forceUpdate: vi.fn() }),
    addFontFamily: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    globe: mockGlobe,
    camera: mockCamera,
  } as unknown as ThreeView;
}

// Helper to set zoom on mock view (works around readonly constraint)
function setMockZoom(view: ThreeView, zoom: number): void {
  (view.camera as { zoom: number }).zoom = zoom;
}

describe("MapLibreStylePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTileJsonPluginAddSource.mockClear();
    mockTileJsonPluginInit.mockClear();
    mockTileJsonPluginDispose.mockClear();
  });

  describe("Initialization", () => {
    it("should initialize successfully with minimal style", async () => {
      const style: StyleSpecification = {
        version: 8,
        name: "test",
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);
    });

    it("should initialize with GeoJSON sources", async () => {
      const style: StyleSpecification = {
        version: 8,
        name: "test",
        sources: {
          test: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);
    });

    it("should initialize with layers", async () => {
      const style: StyleSpecification = {
        version: 8,
        name: "test",
        sources: {
          test: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          {
            id: "test-layer",
            type: "fill",
            source: "test",
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify source was added
      expect(view.addSource).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "geojson",
          data: expect.objectContaining({
            type: "FeatureCollection",
          }),
        }),
      );

      // Verify layer was added
      expect(view.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "vector",
          source: expect.anything(),
        }),
      );
    });
  });

  describe("Background Layer", () => {
    it("should apply background color to globe", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#ff0000" },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();

      // Verify color starts as undefined
      expect(view.globe.color).toBeUndefined();

      await plugin.init(view, mockViewContext);

      // Verify globe color was set to red (#ff0000)
      expect(view.globe.color).toBeDefined();
      const color = view.globe.color as unknown as {
        r: number;
        g: number;
        b: number;
      };
      expect(color.r).toBeCloseTo(1, 1);
      expect(color.g).toBeCloseTo(0, 1);
      expect(color.b).toBeCloseTo(0, 1);
    });

    it("should apply background opacity to globe", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              "background-color": "#ff0000",
              "background-opacity": 0.5,
            },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify opacity was set
      expect(view.globe.opacity).toBe(0.5);
    });

    it("should apply default background-color (#000000) when only background-opacity is set", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              // Only opacity, no color specified - should default to black
              "background-opacity": 0.8,
            },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify default black color was applied
      expect(view.globe.color).toBeDefined();
      const color = view.globe.color as unknown as {
        r: number;
        g: number;
        b: number;
      };
      expect(color.r).toBe(0);
      expect(color.g).toBe(0);
      expect(color.b).toBe(0);
      // Verify opacity was also applied
      expect(view.globe.opacity).toBe(0.8);
    });

    it("should select last background layer when multiple exist", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background-1",
            type: "background",
            paint: { "background-opacity": 0.3 },
          },
          {
            id: "background-2",
            type: "background",
            paint: { "background-opacity": 0.7 },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Should use the last layer's opacity
      expect(view.globe.opacity).toBe(0.7);
    });

    it("should respect minzoom and skip layers below threshold", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background-high-zoom",
            type: "background",
            minzoom: 10,
            paint: { "background-opacity": 0.8 },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      // Set camera zoom below minzoom
      const view = createMockView(5);
      await plugin.init(view, mockViewContext);

      // Background layer should not apply (zoom < minzoom)
      // Opacity should remain at default 1
      expect(view.globe.opacity).toBe(1);
    });

    it("should respect maxzoom and skip layers at or above threshold", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background-low-zoom",
            type: "background",
            maxzoom: 10,
            paint: { "background-opacity": 0.3 },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      // Set camera zoom at maxzoom (exclusive)
      const view = createMockView(10);
      await plugin.init(view, mockViewContext);

      // Background layer should not apply (zoom >= maxzoom)
      expect(view.globe.opacity).toBe(1);
    });

    it("should apply background layer within minzoom/maxzoom range", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background-mid-zoom",
            type: "background",
            minzoom: 5,
            maxzoom: 15,
            paint: { "background-opacity": 0.6 },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      // Set camera zoom within range
      const view = createMockView(10);
      await plugin.init(view, mockViewContext);

      // Background layer should apply
      expect(view.globe.opacity).toBe(0.6);
    });

    it("should skip background layers with visibility=none", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "hidden-background",
            type: "background",
            layout: { visibility: "none" },
            paint: { "background-opacity": 0.5 },
          },
          {
            id: "visible-background",
            type: "background",
            paint: { "background-opacity": 0.7 },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Should use the visible layer, not the hidden one
      expect(view.globe.opacity).toBe(0.7);
    });

    it("should extract alpha from rgba() color strings", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "rgba(255, 0, 0, 0.5)" },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Alpha from rgba should be extracted
      expect(view.globe.opacity).toBe(0.5);
    });

    it("should extract alpha from #RRGGBBAA hex colors", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#ff0000cc" }, // cc = 204/255 ≈ 0.8
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Alpha from #RRGGBBAA should be extracted (approximately 0.8)
      expect(view.globe.opacity).toBeCloseTo(0.8, 1);
    });

    it("should multiply color alpha with background-opacity", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              "background-color": "rgba(255, 0, 0, 0.8)", // alpha = 0.8
              "background-opacity": 0.5, // explicit opacity = 0.5
            },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Final opacity should be 0.8 * 0.5 = 0.4
      expect(view.globe.opacity).toBe(0.4);
    });

    it("should update background on zoom changes when crossing minzoom/maxzoom boundaries", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "bg-low-zoom",
            type: "background",
            maxzoom: 8,
            paint: {
              "background-color": "#ff0000", // Red for low zoom
              "background-opacity": 0.3,
            },
          },
          {
            id: "bg-mid-zoom",
            type: "background",
            minzoom: 8,
            maxzoom: 15,
            paint: {
              "background-color": "#00ff00", // Green for mid zoom
              "background-opacity": 0.6,
            },
          },
          {
            id: "bg-high-zoom",
            type: "background",
            minzoom: 15,
            paint: {
              "background-color": "#0000ff", // Blue for high zoom
              "background-opacity": 0.9,
            },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView(5); // Start in low-zoom range
      await plugin.init(view, mockViewContext);

      // Initially should use bg-low-zoom (red, 0.3)
      expect(view.globe.opacity).toBe(0.3);
      let color = view.globe.color as unknown as {
        r: number;
        g: number;
        b: number;
      };
      expect(color.r).toBeCloseTo(1, 1); // Red
      expect(color.g).toBeCloseTo(0, 1);
      expect(color.b).toBeCloseTo(0, 1);

      // Get the preRender listener
      const preRenderCall = (view.on as any).mock.calls.find(
        (call: any) => call[0] === "preRender",
      );
      expect(preRenderCall).toBeDefined();
      const preRenderListener = preRenderCall[1];

      // First call to initialize lastZoom
      preRenderListener();

      // Simulate zoom crossing into mid-zoom range (5 → 10)
      setMockZoom(view, 10);
      preRenderListener();

      // Should now use bg-mid-zoom (green, 0.6)
      expect(view.globe.opacity).toBe(0.6);
      color = view.globe.color as unknown as {
        r: number;
        g: number;
        b: number;
      };
      expect(color.r).toBeCloseTo(0, 1);
      expect(color.g).toBeCloseTo(1, 1); // Green
      expect(color.b).toBeCloseTo(0, 1);

      // Simulate zoom crossing into high-zoom range (10 → 16)
      setMockZoom(view, 16);
      preRenderListener();

      // Should now use bg-high-zoom (blue, 0.9)
      expect(view.globe.opacity).toBe(0.9);
      color = view.globe.color as unknown as {
        r: number;
        g: number;
        b: number;
      };
      expect(color.r).toBeCloseTo(0, 1);
      expect(color.g).toBeCloseTo(0, 1);
      expect(color.b).toBeCloseTo(1, 1); // Blue
    });
  });

  describe("Zoom Change Detection", () => {
    it("should register preRender listener for zoom changes", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify preRender listener was registered
      expect(view.on).toHaveBeenCalledWith("preRender", expect.any(Function));
    });
  });

  describe("Source Creation", () => {
    it("should call tileJsonPlugin.addSource for TileJSON url sources", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {
          "vector-source": {
            type: "vector",
            url: "https://example.com/tiles.json",
          },
        },
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify TileJsonPlugin.addSource was called with url
      expect(mockTileJsonPluginAddSource).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/tiles.json",
          id: "vector-source",
          type: "vector-tile",
        }),
      );
    });

    it("should call view.addSource for direct tiles array sources", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {
          "vector-source": {
            type: "vector",
            tiles: ["https://example.com/{z}/{x}/{y}.pbf"],
            minzoom: 5,
            maxzoom: 14,
          },
        },
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify view.addSource was called with correct parameters including zoom limits
      expect(view.addSource).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "vector-source",
          type: "vector-tile",
          url: "https://example.com/{z}/{x}/{y}.pbf",
          minZoom: 5,
          maxZoom: 14,
        }),
      );
    });

    it("should call tileJsonPlugin.addSource for raster TileJSON url sources", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {
          "raster-source": {
            type: "raster",
            url: "https://example.com/raster-tiles.json",
            minzoom: 0,
            maxzoom: 18,
          },
        },
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify TileJsonPlugin.addSource was called with correct type and url
      expect(mockTileJsonPluginAddSource).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/raster-tiles.json",
          id: "raster-source",
          type: "raster-tile",
          minzoom: 0,
          maxzoom: 18,
        }),
      );
    });

    it("should call tileJsonPlugin.addSource for raster-dem TileJSON url sources", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {
          "dem-source": {
            type: "raster-dem",
            url: "https://example.com/dem-tiles.json",
            encoding: "terrarium",
            minzoom: 0,
            maxzoom: 15,
          },
        },
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      expect(mockTileJsonPluginAddSource).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/dem-tiles.json",
          id: "dem-source",
          type: "raster-dem",
          encoding: "terrarium",
          minzoom: 0,
          maxzoom: 15,
        }),
      );
    });

    it("should accept terrarium and mapbox encodings for raster-dem", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {
          "dem-terrarium": {
            type: "raster-dem",
            tiles: ["https://example.com/{z}/{x}/{y}.png"],
            encoding: "terrarium",
          },
          "dem-mapbox": {
            type: "raster-dem",
            tiles: ["https://example.com/{z}/{x}/{y}.png"],
            encoding: "mapbox",
          },
        },
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Both sources should be added
      expect(view.addSource).toHaveBeenCalledTimes(2);
    });
  });

  describe("Zoom Re-evaluation", () => {
    it("should call forceUpdate on zoom-dependent layers when zoom changes", async () => {
      const mockLayer = {
        delete: vi.fn(),
        on: vi.fn(),
        forceUpdate: vi.fn(),
      };

      const style: StyleSpecification = {
        version: 8,
        sources: {
          test: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          {
            id: "zoom-dependent-layer",
            type: "fill",
            source: "test",
            paint: {
              // Zoom-dependent expression
              "fill-color": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                "#ff0000",
                10,
                "#00ff00",
              ],
            },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      view.addLayer = vi.fn().mockReturnValue(mockLayer);

      await plugin.init(view, mockViewContext);

      // Get the preRender listener
      const preRenderCall = (view.on as any).mock.calls.find(
        (call: any) => call[0] === "preRender",
      );
      expect(preRenderCall).toBeDefined();
      const preRenderListener = preRenderCall[1];

      // First call initializes lastZoom with current zoom
      preRenderListener();

      // Simulate zoom change beyond threshold
      setMockZoom(view, 15); // Changed from initial 10 by > 0.5
      preRenderListener();

      // forceUpdate should be called on the zoom-dependent layer
      expect(mockLayer.forceUpdate).toHaveBeenCalled();
    });

    it("should not call forceUpdate on layers without zoom-dependent expressions", async () => {
      const mockLayer = {
        delete: vi.fn(),
        on: vi.fn(),
        forceUpdate: vi.fn(),
      };

      const style: StyleSpecification = {
        version: 8,
        sources: {
          test: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          {
            id: "constant-layer",
            type: "fill",
            source: "test",
            paint: {
              // Constant color (no zoom dependency)
              "fill-color": "#ff0000",
            },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      view.addLayer = vi.fn().mockReturnValue(mockLayer);

      await plugin.init(view, mockViewContext);

      // Get the preRender listener
      const preRenderCall = (view.on as any).mock.calls.find(
        (call: any) => call[0] === "preRender",
      );
      const preRenderListener = preRenderCall[1];

      // Simulate zoom change
      setMockZoom(view, 15);
      preRenderListener();

      // forceUpdate should NOT be called for constant layers
      expect(mockLayer.forceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Cleanup", () => {
    it("should remove zoom listener on dispose", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      plugin.dispose();

      // Verify listener was removed
      expect(view.off).toHaveBeenCalledWith("preRender", expect.any(Function));
    });

    it("should dispose child TileJsonPlugin to prevent memory leaks", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {
          "raster-tiles": {
            type: "raster",
            tiles: ["https://example.com/{z}/{x}/{y}.png"],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "raster-layer",
            type: "raster",
            source: "raster-tiles",
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Clear previous calls
      mockTileJsonPluginDispose.mockClear();

      // Dispose the plugin
      plugin.dispose();

      // Verify TileJsonPlugin.dispose() was called
      expect(mockTileJsonPluginDispose).toHaveBeenCalledTimes(1);
    });
  });
});
