import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type ThreeView from "@navaramap/three";
import type { ViewContext } from "@navaramap/three";
import { describe, it, vi, beforeEach, afterEach, expect } from "vitest";

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

    clone(): MockColor {
      const copy = new MockColor();
      copy.r = this.r;
      copy.g = this.g;
      copy.b = this.b;
      return copy;
    }
  }

  return {
    default: MockThreeView,
    Color: MockColor,
    TERRARIUM_ELEVATION_DECODER: () => ({ type: "terrarium" }),
    MAPBOX_ELEVATION_DECODER: () => ({ type: "mapbox" }),
    radianToDegree: (rad: number) => (rad * 180) / Math.PI,
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
    transparent: false,
  };

  const mockCamera = {
    zoom: initialZoom,
    fov: 50, // Default FOV
    on: vi.fn(),
    off: vi.fn(),
  };

  const view = {
    addSource: vi.fn().mockReturnValue({ delete: vi.fn() }),
    addLayer: vi
      .fn()
      .mockReturnValue({ delete: vi.fn(), on: vi.fn(), forceUpdate: vi.fn() }),
    addFontFamily: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    globe: mockGlobe,
    camera: mockCamera,
    getZoomLevel: vi.fn(() => mockCamera.zoom),
    setCamera: vi.fn(),
    zoomLevelToCameraHeight: vi.fn((zoom: number) => {
      // Simple mock: return a distance based on zoom
      // Higher zoom = smaller distance
      return 10000000 / Math.pow(2, zoom);
    }),
  } as unknown as ThreeView;

  return view;
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

  afterEach(() => {
    vi.restoreAllMocks();
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

      // Get the move listener
      const moveCall = (view.camera.on as any).mock.calls.find(
        (call: any) => call[0] === "move",
      );
      expect(moveCall).toBeDefined();
      const moveListener = moveCall[1];

      // First call to initialize lastZoom
      moveListener();

      // Simulate zoom crossing into mid-zoom range (5 → 10)
      setMockZoom(view, 10);
      moveListener();

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
      moveListener();

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

    // BackgroundHandler-specific tests: zoom-dependency detection and caching
    describe("BackgroundHandler zoom updates and caching", () => {
      it("should not update when background has no zoom dependencies", async () => {
        const style: StyleSpecification = {
          version: 8,
          sources: {},
          layers: [
            {
              id: "bg-static",
              type: "background",
              paint: {
                "background-color": "#ff0000",
                "background-opacity": 0.5,
              },
              // No minzoom/maxzoom, no zoom expressions
            },
          ],
        };

        const plugin = new MapLibreStylePlugin(style);
        const view = createMockView(0);

        // Spy on engine to verify background is not re-evaluated on zoom changes
        const createValueFnSpy = vi.spyOn(
          (plugin as any).engine,
          "createValueFn",
        );

        await plugin.init(view, mockViewContext);
        const initCallCount = createValueFnSpy.mock.calls.length;

        // Get the move listener
        const moveCall = (view.camera.on as any).mock.calls.find(
          (call: any) => call[0] === "move",
        );
        const moveListener = moveCall[1];

        moveListener(); // Initialize lastZoom

        // Simulate zoom changes
        setMockZoom(view, 5);
        moveListener();
        setMockZoom(view, 10);
        moveListener();

        // Engine should not be called again (no zoom dependencies, no re-compilation)
        expect(createValueFnSpy.mock.calls.length).toBe(initCallCount);

        // Verify background color remains correct
        expect(view.globe.opacity).toBe(0.5);
      });

      it("should only update when zoom dependencies exist and cache evaluators", async () => {
        const style: StyleSpecification = {
          version: 8,
          sources: {},
          layers: [
            {
              id: "bg-static",
              type: "background",
              maxzoom: 5,
              paint: { "background-color": "#ff0000" }, // Static, but has maxzoom
            },
            {
              id: "bg-dynamic",
              type: "background",
              minzoom: 5,
              paint: {
                "background-opacity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  5,
                  0.5,
                  10,
                  1.0,
                ],
              },
            },
          ],
        };

        const plugin = new MapLibreStylePlugin(style);
        const view = createMockView(0);

        // Spy on engine to verify caching
        const createValueFnSpy = vi.spyOn(
          (plugin as any).engine,
          "createValueFn",
        );

        await plugin.init(view, mockViewContext);
        const firstCallCount = createValueFnSpy.mock.calls.length;

        // Get the move listener
        const moveCall = (view.camera.on as any).mock.calls.find(
          (call: any) => call[0] === "move",
        );
        const moveListener = moveCall[1];

        moveListener(); // Initialize lastZoom

        // Zoom within same layer - should reuse cache
        setMockZoom(view, 2);
        moveListener();
        expect(createValueFnSpy.mock.calls.length).toBe(firstCallCount);

        // Cross layer boundary - should recompile
        setMockZoom(view, 8);
        moveListener();
        expect(createValueFnSpy.mock.calls.length).toBeGreaterThan(
          firstCallCount,
        );
        expect(view.globe.opacity).toBeCloseTo(0.8, 1); // Zoom expression evaluated
      });
    });

    // BackgroundHandler-specific tests: default background fallback
    it("should reset to default background when no layer applies", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [
          {
            id: "bg",
            type: "background",
            minzoom: 5,
            maxzoom: 10,
            paint: { "background-opacity": 0.5 },
          },
        ],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView(7); // Within range
      await plugin.init(view, mockViewContext);

      expect(view.globe.opacity).toBe(0.5); // Layer applies

      // Get the move listener
      const moveCall = (view.camera.on as any).mock.calls.find(
        (call: any) => call[0] === "move",
      );
      const moveListener = moveCall[1];

      moveListener(); // Initialize lastZoom

      // Zoom out of range
      setMockZoom(view, 12);
      moveListener();

      // Should reset to default (#000000, opacity 1.0)
      expect(view.globe.opacity).toBe(1.0);
      expect(view.globe.transparent).toBe(false);
      const color = view.globe.color as unknown as {
        r: number;
        g: number;
        b: number;
      };
      expect(color.r).toBe(0);
      expect(color.g).toBe(0);
      expect(color.b).toBe(0);
    });
  });

  describe("Zoom Change Detection", () => {
    it("should register move listener for zoom changes", async () => {
      const style: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify move listener was registered on camera
      expect(view.camera.on).toHaveBeenCalledWith("move", expect.any(Function));
    });
  });

  describe("Camera Initialization", () => {
    it("should set MapLibre FOV and apply camera when style defines center and zoom", async () => {
      const style: StyleSpecification = {
        version: 8,
        center: [139.7, 35.7],
        zoom: 12,
        pitch: 60,
        bearing: 45,
        centerAltitude: 100,
        roll: 5,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify MapLibre FOV was set (0.6435011087932844 rad ≈ 36.87°)
      expect(view.camera.fov).toBeCloseTo(36.87, 1);

      // Verify setCamera was called with correct parameters
      expect(view.setCamera).toHaveBeenCalledWith(
        expect.objectContaining({
          lng: 139.7,
          lat: 35.7,
          height: 100, // centerAltitude
          distance: expect.any(Number), // from zoomToCameraDistance
          heading: 45, // bearing → heading
          pitch: -30, // pitch 60 → Navara pitch -30
          roll: 5,
        }),
      );
    });

    it("should use default values for omitted optional camera properties", async () => {
      const style: StyleSpecification = {
        version: 8,
        center: [100, 50],
        zoom: 5,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // Verify setCamera was called with defaults
      expect(view.setCamera).toHaveBeenCalledWith(
        expect.objectContaining({
          lng: 100,
          lat: 50,
          height: 0, // default centerAltitude
          heading: 0, // default bearing
          pitch: -90, // default pitch (straight down)
          roll: 0, // default roll
        }),
      );
    });

    it("should not apply camera when center is missing", async () => {
      const style: StyleSpecification = {
        version: 8,
        zoom: 12,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // setCamera should not be called
      expect(view.setCamera).not.toHaveBeenCalled();
    });

    it("should not apply camera when zoom is missing", async () => {
      const style: StyleSpecification = {
        version: 8,
        center: [139.7, 35.7],
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      await plugin.init(view, mockViewContext);

      // setCamera should not be called
      expect(view.setCamera).not.toHaveBeenCalled();
    });

    it("should register frustumChanged listener when camera not ready", async () => {
      const style: StyleSpecification = {
        version: 8,
        center: [139.7, 35.7],
        zoom: 12,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      // Mock view where getZoomLevel returns undefined (camera not ready)
      const view = createMockView();
      (view.getZoomLevel as any).mockReturnValue(undefined);

      await plugin.init(view, mockViewContext);

      // Verify frustumChanged listener was registered
      expect(view.camera.on).toHaveBeenCalledWith(
        "frustumChanged",
        expect.any(Function),
      );
    });

    it("should apply camera when frustumChanged fires and camera becomes ready", async () => {
      const style: StyleSpecification = {
        version: 8,
        center: [139.7, 35.7],
        zoom: 12,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();

      // Start with camera not ready
      (view.getZoomLevel as any).mockReturnValueOnce(undefined);

      await plugin.init(view, mockViewContext);

      // Get the frustumChanged listener
      const frustumChangedCall = (view.camera.on as any).mock.calls.find(
        (call: any) => call[0] === "frustumChanged",
      );
      expect(frustumChangedCall).toBeDefined();
      const listener = frustumChangedCall[1];

      // Camera becomes ready
      (view.getZoomLevel as any).mockReturnValue(12);

      // Invoke listener
      listener();

      // Now setCamera should have been called
      expect(view.setCamera).toHaveBeenCalled();

      // Listener should be removed
      expect(view.camera.off).toHaveBeenCalledWith("frustumChanged", listener);
    });

    it("should clean up frustumChanged listener on dispose", async () => {
      const style: StyleSpecification = {
        version: 8,
        center: [139.7, 35.7],
        zoom: 12,
        sources: {},
        layers: [],
      };

      const plugin = new MapLibreStylePlugin(style);
      const view = createMockView();
      (view.getZoomLevel as any).mockReturnValue(undefined);

      await plugin.init(view, mockViewContext);

      // Get the registered listener
      const frustumChangedCall = (view.camera.on as any).mock.calls.find(
        (call: any) => call[0] === "frustumChanged",
      );
      const listener = frustumChangedCall[1];

      plugin.dispose();

      // Verify listener was removed
      expect(view.camera.off).toHaveBeenCalledWith("frustumChanged", listener);
    });

    it("should convert pitch correctly for different angles", async () => {
      // Test pitch=0 (straight down)
      const style0: StyleSpecification = {
        version: 8,
        center: [0, 0],
        zoom: 5,
        pitch: 0,
        sources: {},
        layers: [],
      };

      const plugin0 = new MapLibreStylePlugin(style0);
      const view0 = createMockView();
      await plugin0.init(view0, mockViewContext);

      expect(view0.setCamera).toHaveBeenCalledWith(
        expect.objectContaining({ pitch: -90 }),
      );

      // Test pitch=45
      const style45: StyleSpecification = {
        version: 8,
        center: [0, 0],
        zoom: 5,
        pitch: 45,
        sources: {},
        layers: [],
      };

      const plugin45 = new MapLibreStylePlugin(style45);
      const view45 = createMockView();
      await plugin45.init(view45, mockViewContext);

      expect(view45.setCamera).toHaveBeenCalledWith(
        expect.objectContaining({ pitch: -45 }),
      );

      // Test pitch=90 (horizontal)
      const style90: StyleSpecification = {
        version: 8,
        center: [0, 0],
        zoom: 5,
        pitch: 90,
        sources: {},
        layers: [],
      };

      const plugin90 = new MapLibreStylePlugin(style90);
      const view90 = createMockView();
      await plugin90.init(view90, mockViewContext);

      expect(view90.setCamera).toHaveBeenCalledWith(
        expect.objectContaining({ pitch: 0 }),
      );
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

      // Get the move listener
      const moveCall = (view.camera.on as any).mock.calls.find(
        (call: any) => call[0] === "move",
      );
      expect(moveCall).toBeDefined();
      const moveListener = moveCall[1];

      // First call initializes lastZoom with current zoom
      moveListener();

      // Simulate zoom change beyond threshold
      setMockZoom(view, 15); // Changed from initial 10 by > 0.5
      moveListener();

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

      // Get the move listener
      const moveCall = (view.camera.on as any).mock.calls.find(
        (call: any) => call[0] === "move",
      );
      const moveListener = moveCall[1];

      // Simulate zoom change
      setMockZoom(view, 15);
      moveListener();

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

      // Verify listener was removed from camera
      expect(view.camera.off).toHaveBeenCalledWith(
        "move",
        expect.any(Function),
      );
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
