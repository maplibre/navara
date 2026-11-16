import type ThreeView from "@navaramap/three";
import type { Layer } from "@navaramap/three";
import { describe, expect, it, vi } from "vitest";

import { MaterialSchemaPlugin, type LayerStyle } from "./MaterialSchemaPlugin";

// Importing `@navaramap/three` at runtime loads the worker pool.
vi.mock("@navaramap/three", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  Plugin: class Plugin {},
  Color: class Color {
    hex = 0;
    setHex(hex: number): this {
      this.hex = hex;
      return this;
    }
    toHex(): number {
      return this.hex;
    }
  },
}));
const { Color } = await import("@navaramap/three");

/** The handful of `on` / `off` / `emit` the plugin uses. */
function emitter() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(name: string, fn: (...args: unknown[]) => void) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)?.add(fn);
    },
    off(name: string, fn: (...args: unknown[]) => void) {
      handlers.get(name)?.delete(fn);
    },
    emit(name: string, ...args: unknown[]) {
      for (const fn of handlers.get(name) ?? []) fn(...args);
    },
    count(name: string) {
      return handlers.get(name)?.size ?? 0;
    },
  };
}

async function setup() {
  const view = emitter();
  const plugin = new MaterialSchemaPlugin();
  await plugin.init(view as unknown as ThreeView);
  const add = (desc: Record<string, unknown>) => {
    const layer = emitter();
    view.emit("layerAdded", layer, desc);
    return layer as unknown as Layer & ReturnType<typeof emitter>;
  };
  return { view, plugin, add };
}

const material = (style: LayerStyle, key: string) =>
  style.materials.find((m) => m.key === key);
const field = (style: LayerStyle, key: string, name: string) =>
  material(style, key)?.fields.find((f) => f.name === name);

describe("MaterialSchemaPlugin.describeLayer", () => {
  it("lists every material of the layer type, marking the ones it carries", async () => {
    const { plugin, add } = await setup();
    const style = plugin.describeLayer(
      add({ type: "vector", source: "s", polygon: { opacity: 0.5 } }),
    );
    expect(style.type).toBe("vector");
    expect(style.materials.map((m) => [m.key, m.present])).toEqual([
      ["point", false],
      ["billboard", false],
      ["text", false],
      ["polyline", false],
      ["polygon", true],
    ]);
  });

  it("gives set values, else defaults, as JSON", async () => {
    const { plugin, add } = await setup();
    const layer = add({
      type: "vector",
      source: "s",
      polygon: { color: new Color().setHex(0xff0000) },
      polyline: { dashArray: new Float32Array([2, 1]) },
    });
    const style = plugin.describeLayer(layer);
    expect(field(style, "polygon", "color")).toMatchObject({
      set: true,
      value: 0xff0000,
      default: 0xffffff,
    });
    expect(field(style, "polygon", "wireframe")).toMatchObject({
      set: false,
      value: false,
    });
    expect(field(style, "polyline", "dashArray")?.value).toEqual([2, 1]);
    expect(JSON.parse(JSON.stringify(style))).toEqual(style);
  });

  it("follows updates", async () => {
    const { plugin, add } = await setup();
    const layer = add({ type: "vector", source: "s", polygon: {} });
    layer.emit("updated", { type: "vector", polygon: { opacity: 0.25 } });
    expect(
      field(plugin.describeLayer(layer), "polygon", "opacity"),
    ).toMatchObject({ set: true, value: 0.25 });
  });

  it("is empty for a layer added before it started", async () => {
    const { plugin } = await setup();
    expect(plugin.describeLayer(emitter() as unknown as Layer)).toEqual({
      type: "",
      materials: [],
    });
  });

  it("stops listening when disposed, and with the view", async () => {
    const { view, plugin, add } = await setup();
    const layer = add({ type: "vector", source: "s" });
    view.emit("disposed");
    expect(view.count("layerAdded")).toBe(0);
    expect(view.count("disposed")).toBe(0);
    expect(layer.count("updated")).toBe(0);
    plugin.dispose();
  });

  it("reads a terrain layer's ellipsoid as its terrain material", async () => {
    const { plugin, add } = await setup();
    const layer = add({
      type: "terrain",
      ellipsoid: { waterMaskColor: new Color().setHex(0x336699) },
    });
    const style = plugin.describeLayer(layer);
    expect(material(style, "terrain")?.present).toBe(true);
    expect(field(style, "terrain", "waterMaskColor")).toMatchObject({
      set: true,
      value: 0x336699,
    });
  });

  it("returns values a caller can change without changing the schema", async () => {
    const { plugin, add } = await setup();
    const layer = add({ type: "vector", source: "s", point: {} });
    const types = field(plugin.describeLayer(layer), "point", "geometryTypes");
    (types?.value as string[]).push("line");
    (types?.options as string[]).push("x");
    const again = field(plugin.describeLayer(layer), "point", "geometryTypes");
    expect(again?.value).toEqual(again?.default);
    expect(again?.options).not.toContain("x");
    expect(Object.isFrozen(plugin.schema.materials.point)).toBe(true);
  });

  it("returns a copy from description()", async () => {
    const { plugin, add } = await setup();
    const layer = add({ type: "vector", source: "s", polygon: { opacity: 1 } });
    const desc = plugin.description(layer) as unknown as {
      polygon: { opacity: number };
    };
    desc.polygon.opacity = 0.2;
    expect(
      field(plugin.describeLayer(layer), "polygon", "opacity"),
    ).toMatchObject({ value: 1 });
  });

  it("moves to a new view when initialized again", async () => {
    const { view: first, plugin } = await setup();
    const second = emitter();
    await plugin.init(second as unknown as ThreeView);
    expect(first.count("layerAdded")).toBe(0);
    expect(first.count("disposed")).toBe(0);
    expect(second.count("layerAdded")).toBe(1);
    plugin.dispose();
    expect(second.count("layerAdded")).toBe(0);
  });

  it("shares one tracker between plugins on the same view", async () => {
    const { view, add } = await setup();
    const other = new MaterialSchemaPlugin();
    await other.init(view as unknown as ThreeView);
    expect(view.count("layerAdded")).toBe(1);
    const layer = add({ type: "vector", source: "s" });
    expect(layer.count("updated")).toBe(1);
    other.dispose();
    expect(view.count("layerAdded")).toBe(1);
  });
});
