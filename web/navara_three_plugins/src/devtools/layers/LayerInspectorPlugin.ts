import type {
  Layer,
  LayerDescription,
  SourceDescription,
} from "@navaramap/three";
import type { FolderApi } from "tweakpane";

import {
  DevtoolPlugin,
  type DevtoolContainer,
  type DevtoolPluginOptions,
} from "../DevtoolPlugin";
import type { ProfilerPlugin } from "../profiler/ProfilerPlugin";
import { formatBytes, formatCount } from "../util/format";
import { addHtmlBlock, esc, hint, type HtmlBlock } from "../util/html";
import { Ticker } from "../util/ticker";

import { collectLayerCosts, type LayerCost } from "./layerCost";
import { descriptionOf, trackLayerDescriptions } from "./layerDescriptions";
import { StyleEditor, describeLayerAsCode } from "./layerEditor";
import { labelLayer } from "./layerNames";

export type LayerInspectorPluginOptions = DevtoolPluginOptions & {
  /** When given, the layer list shows each layer's downloads from it. */
  profiler?: ProfilerPlugin;
  /**
   * While the tool is enabled, keep geometries' CPU arrays so wireframes can
   * be drawn (see `ViewContext.retainGeometryArrays`). Costs a JS-heap copy
   * of every terrain and polygon geometry built meanwhile, which the
   * Profiler's JS heap includes. Disabling the tool restores the previous
   * setting; geometries built before it was enabled cannot draw a wireframe.
   * @defaultValue `true`
   */
  wireframe?: boolean;
};

/** Material groups whose `show` hides a layer of that type. */
const SHOWABLE: Record<string, string[]> = {
  vector: ["point", "billboard", "text", "polyline", "polygon"],
  raster: ["raster"],
  "3d-tiles": ["model"],
};

/** The material carrying `showBoundingBox`, per layer type. */
const BOX_GROUP: Record<string, string> = {
  raster: "raster",
  terrain: "terrain",
  "3d-tiles": "model",
};

const UI_INTERVAL_MS = 500;

type Hidden = Map<string, Record<string, boolean | undefined>>;

/**
 * Lists the view's layers with what they cost, and edits any layer's style
 * live. Click a layer to select it; its checkbox hides it. The selected
 * layer gets solo / wireframe / bounding-box toggles and a style form
 * generated from the engine's material schema.
 */
export class LayerInspectorPlugin extends DevtoolPlugin {
  readonly title = "Layers";

  private readonly profiler: ProfilerPlugin | undefined;
  private readonly wireframeSupport: boolean;
  private selectedId = "";
  private list!: HtmlBlock;
  private actions!: FolderApi;
  private readonly toggles = { wireframe: false, boxes: false };
  private wireframeBinding!: { hidden: boolean; refresh(): void };
  private boxesBinding!: { hidden: boolean; refresh(): void };
  /** Set while `syncToggles` pushes the layer's state into the toggles. */
  private syncingToggles = false;
  /** Pending coalesced handling of `layerAdded` / `layerRemoved`. */
  private layersSync: ReturnType<typeof setTimeout> | undefined;
  private styleFolder!: FolderApi;
  private editor: StyleEditor | undefined;
  private editedLayer: Layer | undefined;
  private editRebuild: ReturnType<typeof setTimeout> | undefined;
  /** Per layer: values before this session changed them, for "undo". */
  private readonly originals = new Map<string, Map<string, unknown>>();
  private readonly expanded = new Map<string, boolean>();
  /** Per layer, the `show` each material had before it was hidden. */
  private readonly hidden: Hidden = new Map();
  /** Descriptions of layers deleted here, newest last, for restoring. */
  private readonly removed: LayerDescription[] = [];
  private costs = new Map<string, LayerCost>();
  /**
   * Source descriptions by id, for the layer names. Cleared when sources or
   * layers are added or removed; a `source.update()` alone shows on the next
   * such change.
   */
  private readonly sources = new Map<string, SourceDescription | undefined>();
  private layersFolder!: FolderApi;
  /** Skipped while the list cannot be seen (panel hidden, folder closed). */
  private readonly ticker = new Ticker(UI_INTERVAL_MS, () => {
    if (this.shown && this.layersFolder.expanded) this.refresh();
  });
  /** `retainGeometryArrays` before `onEnable()` turned it on. */
  private retainedBefore: boolean | undefined;
  /** Stops recording layer descriptions; set from `onInit()`. */
  private stopTracking: (() => void) | undefined;

  /**
   * Rebuilds the form after an update from elsewhere (the app, an action
   * here). Deferred: it runs inside the layer's `updated` emit, and
   * re-registering a listener during an emit would revisit it forever.
   */
  private readonly onEdited = (): void => {
    if (this.editor?.isApplying()) return;
    this.scheduleEditorRebuild();
  };

  constructor(options: LayerInspectorPluginOptions = {}) {
    super(options);
    this.profiler = options.profiler;
    this.wireframeSupport = options.wireframe ?? true;
  }

  protected onInit(): void {
    // Before anything else, and whether or not the tool is enabled: `init()`
    // runs before the app can add a layer, so every layer is recorded.
    this.stopTracking = trackLayerDescriptions(this.view);
    const ui = this.ui;

    const layers = ui.addFolder({ title: "Layers" });
    this.layersFolder = layers;
    this.list = addHtmlBlock(layers);
    this.list.element.addEventListener("click", this.onListClick);

    this.actions = ui.addFolder({ title: "Selected layer" });
    this.buildActions(this.actions);

    this.styleFolder = ui.addFolder({ title: "Style" });
    hint(
      this.styleFolder,
      "Every style setting of the selected layer. Values marked • are set on the layer; the others show the engine default. Hover a setting for what it does.",
    );
  }

  protected onEnable(): void {
    if (this.wireframeSupport) {
      this.retainedBefore = this.ctx.retainGeometryArrays;
      this.ctx.retainGeometryArrays = true;
    }
    this.view.on("layerAdded", this.onLayersChanged);
    this.view.on("layerRemoved", this.onLayersChanged);
    this.view.on("sourceAdded", this.onSourceAdded);
    this.sources.clear();
    this.ticker.start();
    this.onLayersChanged();
  }

  protected onDisable(): void {
    this.view.off("layerAdded", this.onLayersChanged);
    this.view.off("layerRemoved", this.onLayersChanged);
    this.view.off("sourceAdded", this.onSourceAdded);
    this.cancelLayersSync();
    this.ticker.stop();
    this.showAll();
    if (this.retainedBefore !== undefined) {
      this.ctx.retainGeometryArrays = this.retainedBefore;
      this.retainedBefore = undefined;
    }
  }

  protected onDispose(): void {
    this.stopTracking?.();
    this.cancelLayersSync();
    if (this.editRebuild !== undefined) clearTimeout(this.editRebuild);
    this.editor?.dispose();
    this.editedLayer?.off("updated", this.onEdited);
    this.list.element.removeEventListener("click", this.onListClick);
  }

  /** The layer selected in the panel. */
  selected(): Layer | undefined {
    return this.layerList().find((l) => l.id === this.selectedId);
  }

  /** Selects a layer by id (or clears the selection). */
  select(id: string): void {
    this.selectedId = id;
    this.syncSelection();
  }

  /**
   * Resident cost per layer id, plus the globe-tile and untagged buckets.
   * Updated while the layer list can be seen.
   */
  get layerCosts(): ReadonlyMap<string, LayerCost> {
    return this.costs;
  }

  private buildActions(folder: DevtoolContainer): void {
    const buttons = [
      [
        "Solo",
        "Hide every other layer. Show all brings them back.",
        () => this.solo(),
      ],
      [
        "Show all",
        "Show every layer hidden from this panel.",
        () => this.showAll(),
      ],
      [
        "Copy as code",
        "Copies a view.addLayer({...}) call that re-creates this layer with its current settings.",
        () => {
          const layer = this.selected();
          if (layer)
            void navigator.clipboard?.writeText(describeLayerAsCode(layer));
        },
      ],
      [
        "Delete layer",
        "Removes the layer from the view. Restore adds it back (as a new layer).",
        () => this.deleteSelected(),
      ],
      [
        "Restore deleted",
        "Adds back the layer deleted last from this panel.",
        () => this.restore(),
      ],
    ] as const;
    const row = addHtmlBlock(folder);
    row.render(
      `<div class="btns">${buttons
        .map(
          ([title, tip], i) =>
            `<button data-action="${i}" title="${esc(tip)}">${esc(title)}</button>`,
        )
        .join("")}</div>`,
    );
    row.element.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      const action = buttons[Number(button?.dataset.action)];
      if (action) action[2]();
    });

    // `refresh()` in `syncToggles` emits `change` too; only a click may act.
    this.wireframeBinding = folder
      .addBinding(this.toggles, "wireframe")
      .on("change", (ev) => {
        if (!this.syncingToggles) this.setWireframe(ev.value);
      });
    this.boxesBinding = folder
      .addBinding(this.toggles, "boxes", { label: "bounding boxes" })
      .on("change", (ev) => {
        if (!this.syncingToggles) this.setBoundingBoxes(ev.value);
      });
    hint(
      this.boxesBinding as unknown as { element: HTMLElement },
      "Draws each tile's or model's bounding box: the volume used for culling and level of detail.",
    );
  }

  /**
   * Coalesced: a style can add hundreds of layers in one go, and each sync
   * walks every scene. The selection form is rebuilt only if the selected
   * layer changed.
   */
  private readonly onLayersChanged = (): void => {
    if (this.layersSync !== undefined) return;
    this.layersSync = setTimeout(() => {
      this.layersSync = undefined;
      // A removed layer may have taken its source with it.
      this.sources.clear();
      if (!this.selected()) this.selectedId = this.layerList()[0]?.id ?? "";
      this.syncSelection();
    }, 0);
  };

  private readonly onSourceAdded = (): void => {
    this.sources.clear();
  };

  private readonly sourceOf = (id: string): SourceDescription | undefined => {
    if (!this.sources.has(id)) {
      this.sources.set(id, this.view.getSourceDescription(id));
    }
    return this.sources.get(id);
  };

  private cancelLayersSync(): void {
    if (this.layersSync === undefined) return;
    clearTimeout(this.layersSync);
    this.layersSync = undefined;
  }

  private readonly onListClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("tr[data-layer]");
    if (!row) return;
    const id = row.dataset.layer ?? "";
    const layer = this.layerList().find((l) => l.id === id);
    if (!layer) return;
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      if (target.checked) this.show(layer);
      else this.hide(layer);
    } else {
      this.select(id);
    }
    this.refresh();
  };

  private layerList(): Layer[] {
    return Array.from(this.view.layers);
  }

  /**
   * Points the actions and the style form at the selected layer, rebuilding
   * them only when it changed, then refreshes the list.
   */
  private syncSelection(): void {
    const layer = this.selected();
    if (layer !== this.editedLayer) {
      this.editedLayer?.off("updated", this.onEdited);
      this.editedLayer = layer;
      layer?.on("updated", this.onEdited);
      this.syncToggles();
      this.rebuildEditor();
    }
    // The name follows the description, which edits change.
    this.actions.title = layer
      ? `Selected: ${labelLayer(layer, this.sourceOf).name}`
      : "Selected layer";
    this.refresh();
  }

  private syncToggles(): void {
    const layer = this.selected();
    const desc = (layer ? descriptionOf(layer) : {}) as unknown as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const type = (layer && descriptionOf(layer).type) ?? "";
    const polygon = type === "vector" && desc.polygon !== undefined;
    const globe = type === "terrain" || type === "raster";
    this.wireframeBinding.hidden =
      !this.wireframeSupport || !(polygon || globe);
    this.toggles.wireframe = polygon
      ? desc.polygon?.wireframe === true
      : this.view.globe.wireframe;
    hint(
      this.wireframeBinding as unknown as { element: HTMLElement },
      globe
        ? "Draws every terrain tile as wireframe. Terrain and imagery share the globe's tiles, so this applies to all of them."
        : "Draws this layer's polygons as wireframe (polygon.wireframe).",
    );
    const boxGroup = BOX_GROUP[type];
    this.boxesBinding.hidden = boxGroup === undefined;
    this.toggles.boxes =
      boxGroup !== undefined && desc[boxGroup]?.showBoundingBox === true;
    this.syncingToggles = true;
    try {
      this.wireframeBinding.refresh();
      this.boxesBinding.refresh();
    } finally {
      this.syncingToggles = false;
    }
  }

  private scheduleEditorRebuild(): void {
    if (this.editRebuild !== undefined) return;
    this.editRebuild = setTimeout(() => {
      this.editRebuild = undefined;
      this.syncToggles();
      this.rebuildEditor();
    }, 0);
  }

  private rebuildEditor(): void {
    this.editor?.dispose();
    this.editor = undefined;
    const layer = this.selected();
    this.styleFolder.title = layer
      ? `Style: ${labelLayer(layer, this.sourceOf).name}`
      : "Style";
    if (!layer) return;
    let originals = this.originals.get(layer.id);
    if (!originals) {
      originals = new Map();
      this.originals.set(layer.id, originals);
    }
    this.editor = new StyleEditor(this.styleFolder, layer, {
      originals,
      expanded: this.expanded,
      onStructureChange: () => this.scheduleEditorRebuild(),
    });
  }

  private refresh(): void {
    this.costs = collectLayerCosts(this.ctx);
    this.list.render(this.renderList());
  }

  private renderList(): string {
    const network = this.profiler?.networkBySource();
    const rows = this.layerList().map((layer) => {
      const label = labelLayer(layer, this.sourceOf);
      const cost = this.costs.get(layer.id);
      const type = descriptionOf(layer).type ?? "";
      const visible = !this.hidden.has(layer.id);
      const canHide = SHOWABLE[type] !== undefined;
      const net = label.sourceId ? network?.get(label.sourceId) : undefined;
      const onGlobe = type === "terrain" || type === "raster";
      const objects = cost?.objects
        ? `<span title="${formatCount(cost.triangles)} triangles">${cost.objects}</span>`
        : `<span class="muted" title="${
            onGlobe
              ? "Drawn on the globe tiles: see Globe tiles below."
              : "Draped onto the globe tiles (see Globe tiles), or nothing loaded yet."
          }">globe</span>`;
      const memory = cost
        ? formatBytes(cost.geometryBytes + cost.textureBytes)
        : "";
      const downloads = net
        ? `<span title="${net.requests} requests${net.failed ? `, ${net.failed} failed` : ""}">${formatBytes(net.bytes)}${net.failed ? ` <span class="warn">✗</span>` : ""}</span>`
        : network
          ? `<span class="muted">–</span>`
          : "";
      const checkbox = canHide
        ? `<input type="checkbox" ${visible ? "checked" : ""} title="Show / hide (sets show on its styles)">`
        : `<input type="checkbox" checked disabled title="The engine cannot hide a terrain layer (terrain.show has no effect); delete it instead.">`;
      return `<tr class="click${layer.id === this.selectedId ? " selected" : ""}" data-layer="${esc(layer.id)}" title="${esc(`${label.name}\n${label.origin}\nlayer ${layer.id}`)}">
<td>${checkbox}</td>
<td class="name"><span${visible ? "" : ' class="muted"'}>${esc(label.name)}</span><br><span class="muted">${esc(label.origin)}</span></td>
<td class="num">${objects}</td><td class="num">${memory}</td>${network ? `<td class="num">${downloads}</td>` : ""}
</tr>`;
    });
    const bucket = (key: string, name: string, title: string) => {
      const c = this.costs.get(key);
      if (!c) return "";
      return `<tr class="muted" title="${esc(`${title}\n${formatCount(c.triangles)} triangles`)}"><td></td><td class="name">${name}</td><td class="num">${c.objects}</td><td class="num">${formatBytes(c.geometryBytes + c.textureBytes)}</td>${network ? "<td></td>" : ""}</tr>`;
    };
    return `<table>
<tr><th></th><th>Layer</th><th class="num" title="Meshes in the scene (hover a number for its triangles)">Objects</th><th class="num" title="Geometry and texture memory of its meshes (an estimate)">Memory</th>${network ? '<th class="num" title="Bytes downloaded from its source (hover for requests)">Download</th>' : ""}</tr>
${rows.join("\n") || `<tr><td colspan="5" class="muted">No layers</td></tr>`}
${bucket("(terrain tiles)", "Globe tiles", "Terrain tiles, shared by the terrain layer, imagery and everything draped on them. Their textures hold the draped layers.")}
${bucket("(mesh descriptors, other)", "Other meshes", "Meshes added with view.addMesh and other objects that belong to no layer.")}
</table>
<div class="note">Click a layer to select it. Hover for details.</div>`;
  }

  private hide(layer: Layer): void {
    if (this.hidden.has(layer.id)) return;
    const desc = descriptionOf(layer) as unknown as Record<
      string,
      { show?: boolean } | undefined
    >;
    const saved: Record<string, boolean | undefined> = {};
    const patch: Record<string, { show: boolean }> = {};
    for (const group of SHOWABLE[descriptionOf(layer).type ?? ""] ?? []) {
      // A vector style the layer does not have draws nothing anyway.
      if (descriptionOf(layer).type === "vector" && !desc[group]) continue;
      saved[group] = desc[group]?.show;
      patch[group] = { show: false };
    }
    this.hidden.set(layer.id, saved);
    update(layer, patch);
  }

  private show(layer: Layer): void {
    const saved = this.hidden.get(layer.id);
    if (!saved) return;
    this.hidden.delete(layer.id);
    const patch: Record<string, { show: boolean }> = {};
    for (const [group, show] of Object.entries(saved)) {
      patch[group] = { show: show ?? true };
    }
    update(layer, patch);
  }

  private solo(): void {
    const target = this.selected();
    if (!target) return;
    for (const layer of this.layerList()) {
      if (layer === target) this.show(layer);
      else this.hide(layer);
    }
    this.refresh();
  }

  private showAll(): void {
    for (const layer of this.layerList()) this.show(layer);
    this.hidden.clear();
    this.refresh();
  }

  private setWireframe(on: boolean): void {
    const layer = this.selected();
    if (!layer) return;
    if (descriptionOf(layer).type === "vector") {
      update(layer, { polygon: { wireframe: on } });
    } else {
      this.view.globe.wireframe = on;
      this.view.forceUpdate();
    }
  }

  private setBoundingBoxes(on: boolean): void {
    const layer = this.selected();
    const group = layer && BOX_GROUP[descriptionOf(layer).type ?? ""];
    if (!layer || !group) return;
    update(layer, { [group]: { showBoundingBox: on } });
  }

  private deleteSelected(): void {
    const layer = this.selected();
    if (!layer) return;
    this.removed.push(descriptionOf(layer) as LayerDescription);
    this.hidden.delete(layer.id);
    layer.delete();
  }

  private restore(): void {
    const description = this.removed.pop();
    if (!description) return;
    this.select(this.view.addLayer(description).id);
  }
}

function update(layer: Layer, patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) return;
  layer.update({
    type: descriptionOf(layer).type,
    ...patch,
  } as unknown as LayerDescription);
}
