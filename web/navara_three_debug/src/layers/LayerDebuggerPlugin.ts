import type { Layer, LayerDescription } from "@navaramap/three";
import type { FolderApi } from "tweakpane";

import { DebugPlugin, type DebugPluginOptions } from "../DebugPlugin";
import type { ProfilerPlugin } from "../profiler/ProfilerPlugin";
import { formatBytes, padLeft, padRight } from "../util/format";
import { addTable } from "../util/table";
import { Ticker } from "../util/ticker";

import { collectLayerCosts, type LayerCost } from "./layerCost";
import { LayerEditor, describeLayerAsCode } from "./layerEditor";

export type LayerDebuggerPluginOptions = DebugPluginOptions & {
  /** When given, the layer list shows each layer's network traffic from it. */
  profiler?: ProfilerPlugin;
};

/** Material groups whose `show` hides a layer of that type. */
const SHOWABLE: Record<string, string[]> = {
  vector: ["point", "billboard", "text", "polyline", "polygon"],
  raster: ["raster"],
  terrain: ["terrain"],
  "3d-tiles": ["model"],
};

const UI_INTERVAL_MS = 500;

type Hidden = Map<string, Record<string, boolean | undefined>>;

/**
 * Lists the view's resource layers with their resident cost, edits any
 * layer's settings live through a generated form, and offers solo / hide,
 * wireframe, bounding-box, delete / re-add and copy-as-code actions.
 */
export class LayerDebuggerPlugin extends DebugPlugin {
  readonly title = "Layers";

  private readonly profiler: ProfilerPlugin | undefined;
  private readonly list = { table: "" };
  private readonly costText = { table: "" };
  private readonly selection = { layer: "" };
  private selectBinding: { dispose(): void } | undefined;
  private editorFolder: FolderApi | undefined;
  private editor: LayerEditor | undefined;
  private editedLayer: Layer | undefined;
  private editRebuild: ReturnType<typeof setTimeout> | undefined;
  /**
   * Runs inside the layer's `updated` emit, so the rebuild is deferred:
   * re-registering a listener while its emit iterates the listener set would
   * visit it again at once and never end.
   */
  private readonly onEdited = (): void => {
    if (this.editRebuild !== undefined) return;
    this.editRebuild = setTimeout(() => {
      this.editRebuild = undefined;
      this.rebuildEditor();
    }, 0);
  };

  /** Per layer, the `show` each material had before it was hidden. */
  private readonly hidden: Hidden = new Map();
  /** Descriptions of deleted layers, for re-adding. */
  private readonly removed = new Map<string, LayerDescription>();
  private costs = new Map<string, LayerCost>();
  private readonly ticker = new Ticker(UI_INTERVAL_MS, () => this.refresh());

  constructor(options: LayerDebuggerPluginOptions = {}) {
    super(options);
    this.profiler = options.profiler;
  }

  protected onInit(): void {
    const ui = this.ui;
    const layers = ui.addFolder({ title: "Layers" });
    addTable(layers, this.list, "table", 8);
    this.rebuildSelect();

    const actions = ui.addFolder({ title: "Actions" });
    actions.addButton({ title: "Solo" }).on("click", () => this.solo());
    actions.addButton({ title: "Hide / show" }).on("click", () => {
      const layer = this.selected();
      if (!layer) return;
      if (this.hidden.has(layer.id)) this.show(layer);
      else this.hide(layer);
    });
    actions.addButton({ title: "Show all" }).on("click", () => this.showAll());
    actions
      .addButton({ title: "Toggle wireframe (polygon)" })
      .on("click", () => this.toggle("polygon", "wireframe"));
    actions.addButton({ title: "Toggle bounding boxes" }).on("click", () => {
      for (const group of ["model", "raster", "terrain"]) {
        this.toggle(group, "showBoundingBox");
      }
    });
    actions.addButton({ title: "Delete" }).on("click", () => {
      const layer = this.selected();
      if (!layer) return;
      this.removed.set(layer.id, layer.description as LayerDescription);
      layer.delete();
    });
    actions.addButton({ title: "Re-add last deleted" }).on("click", () => {
      const last = Array.from(this.removed.entries()).pop();
      if (!last) return;
      this.removed.delete(last[0]);
      const layer = this.view.addLayer(last[1]);
      this.selection.layer = layer.id;
      this.rebuildSelect();
    });
    actions.addButton({ title: "Copy as code" }).on("click", () => {
      const layer = this.selected();
      if (!layer) return;
      void navigator.clipboard?.writeText(describeLayerAsCode(layer));
    });

    this.editorFolder = ui.addFolder({ title: "Settings" });
    this.rebuildEditor();

    const costs = ui.addFolder({ title: "Resident cost", expanded: false });
    addTable(costs, this.costText, "table", 10);
  }

  protected onEnable(): void {
    this.view.on("layerAdded", this.onLayersChanged);
    this.view.on("layerRemoved", this.onLayersChanged);
    this.ticker.start();
    this.refresh();
  }

  protected onDisable(): void {
    this.view.off("layerAdded", this.onLayersChanged);
    this.view.off("layerRemoved", this.onLayersChanged);
    this.ticker.stop();
    this.showAll();
  }

  protected onDispose(): void {
    if (this.editRebuild !== undefined) clearTimeout(this.editRebuild);
    this.editor?.dispose();
    this.editedLayer?.off("updated", this.onEdited);
  }

  /** The layer selected in the panel. */
  selected(): Layer | undefined {
    for (const layer of this.view.layers) {
      if (layer.id === this.selection.layer) return layer;
    }
    return undefined;
  }

  /** Resident cost per layer id (plus the terrain and untagged buckets). */
  get layerCosts(): ReadonlyMap<string, LayerCost> {
    return this.costs;
  }

  private readonly onLayersChanged = (): void => {
    this.rebuildSelect();
    this.refresh();
  };

  private layerList(): Layer[] {
    return Array.from(this.view.layers);
  }

  private rebuildSelect(): void {
    const layers = this.layerList();
    if (!layers.some((l) => l.id === this.selection.layer)) {
      this.selection.layer = layers[0]?.id ?? "";
    }
    this.selectBinding?.dispose();
    const options: Record<string, string> = {};
    for (const [i, layer] of layers.entries()) {
      options[`${i} ${layer.description.type} ${layer.id.slice(0, 8)}`] =
        layer.id;
    }
    this.selectBinding = this.ui
      .addBinding(this.selection, "layer", { options, index: 2 })
      .on("change", () => this.rebuildEditor());
    this.rebuildEditor();
  }

  private rebuildEditor(): void {
    if (!this.editorFolder) return;
    this.editor?.dispose();
    this.editor = undefined;
    const layer = this.selected();
    if (layer !== this.editedLayer) {
      this.editedLayer?.off("updated", this.onEdited);
      this.editedLayer = layer;
      // An update from anywhere (the app, an action here) refreshes the form.
      layer?.on("updated", this.onEdited);
    }
    this.editorFolder.title = layer
      ? `Settings: ${layer.description.type} ${layer.id.slice(0, 8)}`
      : "Settings";
    if (!layer) return;
    this.editor = new LayerEditor(this.editorFolder, layer);
  }

  private refresh(): void {
    this.costs = collectLayerCosts(this.ctx);
    const perSource = this.profiler?.networkMeter.perSource();
    const lines = [
      `${padRight("#", 3)}${padRight("type", 9)}${padRight("id", 9)}${padRight("source", 20)}${padLeft("objs", 6)}${padLeft("tris", 9)}${padLeft("bytes", 9)}${perSource ? padLeft("net", 16) : ""}`,
    ];
    for (const [i, layer] of this.layerList().entries()) {
      const desc = layer.description;
      const sourceId = "source" in desc ? String(desc.source ?? "") : "";
      const source = sourceId
        ? this.view.getSourceDescription(sourceId)
        : undefined;
      const host = hostOf((source as { url?: string } | undefined)?.url);
      const cost = this.costs.get(layer.id);
      const hiddenMark = this.hidden.has(layer.id) ? "·" : " ";
      let net = "";
      if (perSource && source) {
        const stats = perSource.find(
          (s) => s.sourceId === `${source.type} ${host}`,
        );
        net = stats
          ? padLeft(`${stats.requests} req ${formatBytes(stats.bytes)}`, 16)
          : padLeft("-", 16);
      }
      lines.push(
        `${padRight(String(i), 3)}${padRight(desc.type ?? "?", 9)}${padRight(
          hiddenMark + layer.id.slice(0, 7),
          9,
        )}${padRight(source ? `${source.type} ${host}` : sourceId, 20)}${padLeft(cost?.objects ?? 0, 6)}${padLeft(cost?.triangles ?? 0, 9)}${padLeft(cost ? formatBytes(cost.geometryBytes + cost.textureBytes) : "-", 9)}${net}`,
      );
    }
    this.list.table = lines.join("\n");

    const rows = Array.from(this.costs.values()).sort(
      (a, b) =>
        b.geometryBytes + b.textureBytes - (a.geometryBytes + a.textureBytes),
    );
    const costLines = [
      `${padRight("layer", 16)}${padLeft("objs", 6)}${padLeft("vis", 5)}${padLeft("inst", 7)}${padLeft("tris", 10)}${padLeft("geom", 10)}${padLeft("tex", 10)}`,
    ];
    for (const c of rows) {
      costLines.push(
        `${padRight(c.key, 16)}${padLeft(c.objects, 6)}${padLeft(c.visible, 5)}${padLeft(c.instances, 7)}${padLeft(c.triangles, 10)}${padLeft(formatBytes(c.geometryBytes), 10)}${padLeft(formatBytes(c.textureBytes), 10)}`,
      );
    }
    costLines.push("draped layers bake into terrain tiles (no own objects)");
    this.costText.table = costLines.join("\n");
  }

  private showable(layer: Layer): string[] {
    return SHOWABLE[layer.description.type ?? ""] ?? [];
  }

  private hide(layer: Layer): void {
    if (this.hidden.has(layer.id)) return;
    const desc = layer.description as unknown as Record<
      string,
      { show?: boolean } | undefined
    >;
    const saved: Record<string, boolean | undefined> = {};
    const patch: Record<string, { show: boolean }> = {};
    for (const group of this.showable(layer)) {
      // A vector material the description lacks renders nothing anyway.
      if (layer.description.type === "vector" && !desc[group]) continue;
      saved[group] = desc[group]?.show;
      patch[group] = { show: false };
    }
    this.hidden.set(layer.id, saved);
    this.update(layer, patch);
  }

  private show(layer: Layer): void {
    const saved = this.hidden.get(layer.id);
    if (!saved) return;
    this.hidden.delete(layer.id);
    const patch: Record<string, { show: boolean }> = {};
    for (const [group, show] of Object.entries(saved)) {
      patch[group] = { show: show ?? true };
    }
    this.update(layer, patch);
  }

  private solo(): void {
    const target = this.selected();
    if (!target) return;
    for (const layer of this.layerList()) {
      if (layer === target) this.show(layer);
      else this.hide(layer);
    }
  }

  private showAll(): void {
    for (const layer of this.layerList()) this.show(layer);
    this.hidden.clear();
  }

  private toggle(group: string, field: string): void {
    const layer = this.selected();
    if (!layer) return;
    const desc = layer.description as unknown as Record<
      string,
      Record<string, unknown> | undefined
    >;
    if (!this.showable(layer).includes(group)) return;
    if (layer.description.type === "vector" && !desc[group]) return;
    const current = desc[group]?.[field] === true;
    this.update(layer, { [group]: { [field]: !current } });
  }

  private update(layer: Layer, patch: Record<string, unknown>): void {
    if (Object.keys(patch).length === 0) return;
    layer.update({
      type: layer.description.type,
      ...patch,
    } as unknown as LayerDescription);
  }
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, window.location.href).host;
  } catch {
    return url;
  }
}
