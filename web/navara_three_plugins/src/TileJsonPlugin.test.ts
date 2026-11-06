import { describe, it, expect, vi, afterEach } from "vitest";

import { TileJsonPlugin, type TileJson } from "./TileJsonPlugin";

// Importing the real @navaramap/three touches WASM/os at module load, which fails
// in the test environment. TileJsonPlugin only needs `Plugin`, `EventHandler`,
// and the elevation decoder factories as runtime values (everything else it
// imports from there is type-only), so stub the module. The decoder factories
// return sentinels the tests can assert on; the EventHandler stub mirrors the
// real on/once/off/emit/clear.
/* eslint-disable @typescript-eslint/no-extraneous-class */
vi.mock("@navaramap/three", () => ({
  default: class ThreeView {},
  Plugin: class Plugin {},
  MAPBOX_ELEVATION_DECODER: () => ({ decoder: "mapbox" }),
  TERRARIUM_ELEVATION_DECODER: () => ({ decoder: "terrarium" }),
  EventHandler: class EventHandler {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private listeners = new Map<string, Set<(...a: any[]) => void>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(k: string, f: (...a: any[]) => void) {
      let set = this.listeners.get(k);
      if (!set) {
        set = new Set();
        this.listeners.set(k, set);
      }
      set.add(f);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    once(k: string, f: (...a: any[]) => void) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrap = (...a: any[]) => {
        this.off(k, wrap);
        f(...a);
      };
      this.on(k, wrap);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    off(k: string, f: (...a: any[]) => void) {
      this.listeners.get(k)?.delete(f);
    }
    clear(k: string) {
      this.listeners.get(k)?.clear();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit(k: string, ...a: any[]) {
      [...(this.listeners.get(k) ?? [])].forEach((f) => f(...a));
    }
  },
}));
/* eslint-enable @typescript-eslint/no-extraneous-class */

// A spyable fake of the view-owned attribution UI (`view.attribution`).
function makeFakeAttribution() {
  return { add: vi.fn(), remove: vi.fn() };
}

// A minimal fake of the pieces of ThreeView / Source that TileJsonPlugin touches.
function makeFakeView(attribution: unknown = makeFakeAttribution()) {
  let counter = 0;
  const view = {
    attribution,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addSource: vi.fn((desc: any) => ({
      id: desc.id ?? `src-${counter++}`,
      type: desc.type,
    })),
  };
  return { view };
}

function initPlugin(view: unknown) {
  const plugin = new TileJsonPlugin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugin.init(view as any, {} as any);
  return plugin;
}

// Stub fetch so addSource() resolves the given TileJSON document from its URL.
function stubTileJson(doc: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 404,
      statusText: ok ? "OK" : "Not Found",
      json: async () => doc,
    })),
  );
}

const RASTER_DOC: TileJson = {
  tilejson: "3.0.0",
  tiles: ["https://a.example/{z}/{x}/{y}.png"],
  attribution: "© Example",
  minzoom: 3,
  maxzoom: 18,
};

const DOC_URL = "https://example/tiles.json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TileJsonPlugin.addSource", () => {
  it("fetches the document and creates a raster-tile source with zoom + id mapped", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a.example/{z}/{x}/{y}.png"],
      minzoom: 5,
      maxzoom: 16,
    } satisfies TileJson);

    const source = await plugin.addSource({
      type: "raster-tile",
      id: "basemap",
      url: DOC_URL,
    });

    expect(fetch).toHaveBeenCalledWith(DOC_URL);
    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(view.addSource).toHaveBeenCalledWith({
      type: "raster-tile",
      url: "https://a.example/{z}/{x}/{y}.png",
      id: "basemap",
      minZoom: 5,
      maxZoom: 16,
    });
    // A single Source handle is returned, carrying the caller-provided id.
    expect(source).toMatchObject({ id: "basemap", type: "raster-tile" });
  });

  it("uses only the first tile endpoint when the document lists mirrors", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubTileJson({
      tilejson: "3.0.0",
      tiles: [
        "https://a.example/{z}/{x}/{y}.png",
        "https://b.example/{z}/{x}/{y}.png",
      ],
    } satisfies TileJson);

    await plugin.addSource({ type: "raster-tile", url: DOC_URL });

    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(view.addSource).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://a.example/{z}/{x}/{y}.png" }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/mirror/));
    warn.mockRestore();
  });

  it("sets tms on raster sources when scheme is tms", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.png"],
      scheme: "tms",
    } satisfies TileJson);

    await plugin.addSource({ type: "raster-tile", url: DOC_URL });

    expect(view.addSource).toHaveBeenCalledWith(
      expect.objectContaining({ tms: true }),
    );
  });

  it("omits minZoom/tms for vector-tile sources (engine has no such fields)", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.pbf"],
      minzoom: 4,
      maxzoom: 14,
      scheme: "tms",
    } satisfies TileJson);

    await plugin.addSource({ type: "vector-tile", id: "v", url: DOC_URL });

    const desc = view.addSource.mock.calls[0][0];
    expect(desc).toEqual({
      type: "vector-tile",
      url: "https://a/{z}/{x}/{y}.pbf",
      id: "v",
      maxZoom: 14,
    });
    expect(desc).not.toHaveProperty("minZoom");
    expect(desc).not.toHaveProperty("tms");
  });

  it("creates a raster-dem source with MapLibre defaults (tileSize 512, mapbox encoding)", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.png"],
      minzoom: 2,
      maxzoom: 12,
    } satisfies TileJson);

    await plugin.addSource({ type: "raster-dem", id: "dem", url: DOC_URL });

    expect(view.addSource).toHaveBeenCalledWith({
      type: "raster-dem",
      url: "https://a/{z}/{x}/{y}.png",
      id: "dem",
      minZoom: 2,
      maxZoom: 12,
      tileSize: 512,
      elevationDecoder: { decoder: "mapbox" },
    });
  });

  it("honors the document's MapLibre-compatible tileSize/encoding for raster-dem", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
    } satisfies TileJson);

    await plugin.addSource({ type: "raster-dem", url: DOC_URL });

    expect(view.addSource).toHaveBeenCalledWith(
      expect.objectContaining({
        tileSize: 256,
        elevationDecoder: { decoder: "terrarium" },
      }),
    );
  });

  it("rejects an unsupported raster-dem encoding", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.png"],
      encoding: "custom" as never,
    } satisfies TileJson);

    await expect(
      plugin.addSource({ type: "raster-dem", url: DOC_URL }),
    ).rejects.toThrow(/unsupported raster-dem encoding/);
    expect(view.addSource).not.toHaveBeenCalled();
  });

  it("prefers description-level fields over the fetched document", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.png"],
      minzoom: 0,
      maxzoom: 10,
      scheme: "xyz",
      tileSize: 512,
      encoding: "mapbox",
    } satisfies TileJson);

    await plugin.addSource({
      type: "raster-dem",
      url: DOC_URL,
      minzoom: 3,
      maxzoom: 15,
      scheme: "tms",
      tileSize: 256,
      encoding: "terrarium",
    });

    expect(view.addSource).toHaveBeenCalledWith({
      type: "raster-dem",
      url: "https://a/{z}/{x}/{y}.png",
      minZoom: 3,
      maxZoom: 15,
      tms: true,
      tileSize: 256,
      elevationDecoder: { decoder: "terrarium" },
    });
  });

  it("applies description-level fields even when the document omits them", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.png"],
    } satisfies TileJson);

    await plugin.addSource({
      type: "raster-tile",
      url: DOC_URL,
      minzoom: 4,
      maxzoom: 8,
    });

    expect(view.addSource).toHaveBeenCalledWith(
      expect.objectContaining({ minZoom: 4, maxZoom: 8 }),
    );
  });

  it("throws when the TileJSON fetch fails", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({}, false);

    await expect(
      plugin.addSource({
        type: "raster-tile",
        url: "https://example/missing.json",
      }),
    ).rejects.toThrow(/failed to fetch TileJSON/);
  });

  it("rejects an invalid tilejson version field", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({ tilejson: "nope", tiles: ["https://a/{z}/{x}/{y}.png"] });

    await expect(
      plugin.addSource({ type: "raster-tile", url: DOC_URL }),
    ).rejects.toThrow(/tilejson.*version/i);
  });

  it("accepts a document without a tilejson version field", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({ tiles: ["https://a/{z}/{x}/{y}.png"] });

    await expect(
      plugin.addSource({ type: "raster-tile", url: DOC_URL }),
    ).resolves.toBeDefined();
  });

  it("rejects a missing/empty tiles array", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({ tilejson: "3.0.0", tiles: [] });

    await expect(
      plugin.addSource({ type: "raster-tile", url: DOC_URL }),
    ).rejects.toThrow(/tiles.*non-empty/);
  });

  it("throws when called before init()", async () => {
    const plugin = new TileJsonPlugin();
    await expect(
      plugin.addSource({ type: "raster-tile", url: DOC_URL }),
    ).rejects.toThrow(/after view\.init/);
  });
});

describe("TileJsonPlugin attribution wiring", () => {
  it("shows the document's attribution through the view's built-in attribution UI", async () => {
    const attribution = makeFakeAttribution();
    const { view } = makeFakeView(attribution);
    const plugin = initPlugin(view);
    stubTileJson(RASTER_DOC);

    await plugin.addSource({ type: "raster-tile", url: DOC_URL });
    expect(attribution.add).toHaveBeenCalledWith([
      { attributionHtml: "© Example" },
    ]);
  });

  it("skips attribution when the built-in UI is disabled (view.attribution undefined)", async () => {
    const { view } = makeFakeView(undefined);
    const plugin = initPlugin(view);
    stubTileJson(RASTER_DOC);

    // No throw even though there's no attribution UI to feed.
    await expect(
      plugin.addSource({ type: "raster-tile", url: DOC_URL }),
    ).resolves.toMatchObject({ type: "raster-tile" });
  });

  it("removes only its own credits from the view-owned UI on dispose", async () => {
    const attribution = makeFakeAttribution();
    const { view } = makeFakeView(attribution);
    const plugin = initPlugin(view);

    stubTileJson(RASTER_DOC);
    await plugin.addSource({ type: "raster-tile", url: DOC_URL });
    attribution.add.mockClear();

    plugin.dispose();
    // The view owns the UI, so dispose drops only the credits this plugin added
    // (not the whole UI), matched structurally by their html.
    expect(attribution.remove).toHaveBeenCalledWith([
      { attributionHtml: "© Example" },
    ]);
    expect(attribution.add).not.toHaveBeenCalled();
  });

  it("does not touch the view-owned UI on dispose when it contributed no credits", async () => {
    const attribution = makeFakeAttribution();
    const { view } = makeFakeView(attribution);
    const plugin = initPlugin(view);

    plugin.dispose();
    expect(attribution.remove).not.toHaveBeenCalled();
  });

  it("de-duplicates credits across multiple addSource() calls", async () => {
    const attribution = makeFakeAttribution();
    const { view } = makeFakeView(attribution);
    const plugin = initPlugin(view);

    stubTileJson(RASTER_DOC);
    await plugin.addSource({ type: "raster-tile", url: DOC_URL });

    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://c/{z}/{x}/{y}.png"],
      attribution: "© Other",
    } satisfies TileJson);
    await plugin.addSource({ type: "raster-tile", url: DOC_URL });

    // Same credit again — should not be re-added to the UI.
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://d/{z}/{x}/{y}.png"],
      attribution: "© Example",
    } satisfies TileJson);
    await plugin.addSource({ type: "raster-tile", url: DOC_URL });

    expect(attribution.add).toHaveBeenCalledTimes(2);
    expect(attribution.add).toHaveBeenNthCalledWith(1, [
      { attributionHtml: "© Example" },
    ]);
    expect(attribution.add).toHaveBeenNthCalledWith(2, [
      { attributionHtml: "© Other" },
    ]);
  });
});

describe("TileJsonPlugin loaded event", () => {
  it("emits `loaded` with the source, document, and attribution after addSource", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson(RASTER_DOC);

    const onLoaded = vi.fn();
    plugin.on("loaded", onLoaded);

    const source = await plugin.addSource({
      type: "raster-tile",
      url: DOC_URL,
    });

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith({
      source,
      tilejson: RASTER_DOC,
      attribution: "© Example",
    });
  });

  it("emits `loaded` with attribution undefined when the document declares none", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson({
      tilejson: "3.0.0",
      tiles: ["https://a/{z}/{x}/{y}.png"],
    } satisfies TileJson);

    const onLoaded = vi.fn();
    plugin.on("loaded", onLoaded);

    await plugin.addSource({ type: "raster-tile", url: DOC_URL });
    expect(onLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ attribution: undefined }),
    );
  });

  it("off() stops delivery to a listener", async () => {
    const { view } = makeFakeView();
    const plugin = initPlugin(view);
    stubTileJson(RASTER_DOC);

    const onLoaded = vi.fn();
    plugin.on("loaded", onLoaded);
    plugin.off("loaded", onLoaded);

    await plugin.addSource({ type: "raster-tile", url: DOC_URL });
    expect(onLoaded).not.toHaveBeenCalled();
  });
});
