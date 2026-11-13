/**
 * AttributionPlugin — Navara Plugin for map data attribution (credit) UI.
 *
 * Renders a non-modal popover (ⓘ button, bottom-right by default) listing data-source
 * attributions, with a separate always-visible logo frame in the bottom-left
 * corner. The UI is mounted in the element that holds the view's canvas and is
 * positioned against it. Each source can carry zoom-banded child credits that
 * switch as the camera zooms, and per-layer feature credits are tracked
 * dynamically.
 *
 * `ThreeView` creates one by default and exposes it as `view.attribution`
 * (pass `defaultAttribution: false` to opt out).
 *
 * ## Usage
 *
 * ```ts
 * import ThreeView from "@navaramap/three";
 *
 * const view = new ThreeView({ container });
 * await view.init();
 *
 * // A 3D-tiles layer whose tiles embed their own copyright (tracked dynamically).
 * const photorealSource = view.addSource({ type: "3d-tiles", url });
 * const photoreal = view.addLayer({ type: "3d-tiles", source: photorealSource });
 *
 * // `add` / `remove` manage the set of displayed attributions.
 * view.attribution?.add([
 *   {
 *     attribution: "Geospatial Information Authority of Japan (GSI)",
 *     attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
 *     children: [
 *       { attribution: "Nationwide latest aerial photos (seamless)", minZoom: 14, maxZoom: 18 },
 *       { attribution: "GRUS画像（© Axelspace）", minZoom: 14, maxZoom: 18 },
 *     ],
 *   },
 *   {
 *     // Per-tile copyright is tracked dynamically by resolving this layer id.
 *     attribution: "Google Maps Photorealistic 3D Tiles",
 *     creditLayerId: photoreal.id,
 *   },
 *   {
 *     attributionHtml:
 *       '<a href="https://s2maps.eu">Sentinel-2 cloudless 2020</a> by <a href="https://eox.at">EOX IT Services GmbH</a>',
 *   },
 * ]);
 *
 * // Drop a source again when its data leaves the map (matched structurally).
 * view.attribution?.remove([{ attribution: "Google Maps Photorealistic 3D Tiles", creditLayerId: photoreal.id }]);
 *
 * // Re-theme at runtime (e.g. light / dark switch).
 * view.attribution?.setStyle({ backgroundColor: "#14181c", textColor: "#e6e9ee" });
 *
 * // The popover is collapsed by default; show() opens it and hide() collapses
 * // it (the ⓘ button toggles the same state).
 * view.attribution?.hide();
 * view.attribution?.show();
 * ```
 */
import { Plugin } from "@navaramap/core";

import type { ViewContext } from "../../core";
import type ThreeView from "../../index";
import type {
  Layer,
  FeatureCreatedParams,
  FeatureRemovedParams,
  FeatureVisibilityChangedParams,
} from "../../layer";
import { positionIfStatic } from "../../utils/dom";

import {
  aggregateCredits,
  appendSanitizedHtml,
  attributionItemKey,
  createSafeAnchor,
  dedupeAttributionItems,
  isAttributionHtml,
  matchesZoom,
  safeHref,
  type AttributionItem,
  type AttributionStyle,
} from "./attribution";
import {
  STYLE_ELEMENT_ID,
  STYLE_TEXT,
  SVG_ICON_HTML,
} from "./attributionStyles";

export {
  isAttributionHtml,
  type AttributionItem,
  type AttributionSource,
  type AttributionHtml,
  type AttributionChild,
  type AttributionStyle,
} from "./attribution";

type View = ThreeView;

/** Which bottom corner the attribution UI anchors to. */
export type AttributionPosition = "bottom-left" | "bottom-right";

/** Options for {@link AttributionPlugin}. */
export type AttributionPluginOptions = {
  /** Initial color overrides; tweak later with {@link AttributionPlugin.setStyle}. */
  style?: AttributionStyle;
  /**
   * Bottom corner for the ⓘ button and its popover card. Defaults to
   * `"bottom-right"`; use `"bottom-left"` when the bottom-right corner is
   * occupied (e.g. a page with its own HUD there). The logo frame lives in the
   * bottom-left area in both modes; in `"bottom-left"` the ⓘ takes the far-left
   * corner and the logos shift right to sit beside it.
   */
  position?: AttributionPosition;
};

/**
 * Number of live instances using the shared `<style>` element. The style is
 * injected once and removed only when the last instance tears down, so
 * multiple plugins don't duplicate the id or strip each other's styles.
 */
let styleRefCount = 0;

/**
 * Built-in Navara credit, always shown as the first attribution. It is kept
 * separate from the user-managed set, so `add` / `remove` / `clear` never touch
 * it, and it keeps the UI visible even before any data-source credit is added.
 */
const NAVARA_CREDIT: AttributionItem = {
  attribution: "Navara",
  attributionUrl: "https://navara.world/",
};

/**
 * Renders map data attributions as a non-modal popover (ⓘ button, bottom-right
 * by default). Top-level sources can carry nested, optionally zoom-banded child
 * credits.
 *
 * A `ThreeView` creates one by default (`view.attribution`); construct it
 * manually and `view.addPlugin(plugin)` **before** `view.init()` only when the
 * view was created with `defaultAttribution: false`.
 */
export class AttributionPlugin extends Plugin<View, ViewContext> {
  private view?: View;
  private items: AttributionItem[] = [];

  private styleEl?: HTMLStyleElement;
  private dock?: HTMLDivElement;
  private card?: HTMLDivElement;
  private listEl?: HTMLUListElement;
  private logosEl?: HTMLDivElement;
  private toggle?: HTMLButtonElement;
  /** Undoes the positioning applied to the element the UI is mounted in. */
  private restoreMount?: () => void;
  // Collapsed by default; users open it with the toggle.
  private isOpen = false;

  /** Last computed integer zoom level. Used to skip no-op re-renders. */
  private lastZoomLevel?: number;
  /** Whether any source has zoom-banded children — gates the per-frame poll. */
  private hasZoomBands = false;

  /** Per-layer dynamic credits, keyed by `layer.id`. */
  private layerCredits = new Map<
    string,
    { credits: Map<bigint, string>; visible: Set<bigint> }
  >();
  private layerCleanups: (() => void)[] = [];

  /** Color overrides, applied as CSS custom properties on the dock. */
  private style: AttributionStyle;

  /** Bottom corner for the ⓘ button / popover card. */
  private position: AttributionPosition;

  private boundKeydown: (event: KeyboardEvent) => void;
  private boundPreRender: () => void;

  constructor(options: AttributionPluginOptions = {}) {
    super();
    this.style = options.style ?? {};
    this.position = options.position ?? "bottom-right";
    this.boundKeydown = this.handleKeydown.bind(this);
    this.boundPreRender = this.handlePreRender.bind(this);
  }

  /**
   * The full list to render: the built-in Navara credit first, then the
   * user-managed set. Always non-empty, so the dock stays visible.
   */
  private displayedItems(): AttributionItem[] {
    return [NAVARA_CREDIT, ...this.items];
  }

  async init(view: View, _ctx: ViewContext): Promise<void> {
    this.view = view;
    // Recompute the zoom level on render. `fov` is undefined until the first
    // frame, so a camera `moveend` alone would miss the initial value on a
    // static map; `preRender` reliably fires while the scene renders. The
    // level-change gate in `handlePreRender` keeps this from churning the DOM.
    view.on("preRender", this.boundPreRender);
    // Build the UI now that the view exists. The built-in Navara credit is
    // always present, so the dock shows even before any source is added.
    this.apply();
  }

  /**
   * Add attributions to the displayed set. Merged with the current entries;
   * exact duplicates are dropped so several data sources that share one credit
   * (e.g. multiple Overture themes) render a single line, not one each.
   *
   * Sources that declare a `creditLayerId` have that layer's per-feature credits
   * tracked dynamically; the layer is resolved from the view by id, so callers
   * don't pass the `Layer` object separately.
   *
   * @param items - Attribution entries (sources or raw HTML credits)
   */
  add(items: AttributionItem[]): void {
    this.items = dedupeAttributionItems([...this.items, ...items]);
    this.apply();
  }

  /**
   * Remove attributions from the displayed set. Entries are matched
   * structurally (same rendered content), so pass the same object shape that
   * was added — no separate id is needed. Unmatched entries are ignored.
   *
   * @param items - Attribution entries to drop
   */
  remove(items: AttributionItem[]): void {
    const keys = new Set(items.map(attributionItemKey));
    this.items = this.items.filter(
      (item) => !keys.has(attributionItemKey(item)),
    );
    this.apply();
  }

  /**
   * Remove all user-added attributions, keeping the plugin usable. The built-in
   * Navara credit and the dock stay visible; the logo frame hides if no logo
   * remains. Use {@link dispose} to tear the DOM down.
   */
  clear(): void {
    this.items = [];
    this.apply();
  }

  /** Resolve/track the current items' credit layers and render. */
  private apply(): void {
    const layers = this.resolveCreditLayers(this.items);
    // Retrack only when the credit-layer set changes (avoids wiping tracked credits).
    const nextIds = new Set(layers.map((l) => l.id));
    const sameSet =
      nextIds.size === this.layerCredits.size &&
      [...nextIds].every((id) => this.layerCredits.has(id));
    if (!sameSet) this.trackLayers(layers);
    this.render();
  }

  /**
   * Resolve the `Layer` objects referenced by sources' `creditLayerId`, deduped
   * by id so a layer referenced by multiple sources is tracked only once.
   */
  private resolveCreditLayers(items: AttributionItem[]): Layer[] {
    const view = this.view;
    if (!view) return [];
    const seen = new Set<string>();
    const layers: Layer[] = [];
    for (const item of items) {
      if (isAttributionHtml(item) || !item.creditLayerId) continue;
      if (seen.has(item.creditLayerId)) continue;
      seen.add(item.creditLayerId);
      const layer = view.findLayerById(item.creditLayerId);
      if (layer) layers.push(layer);
    }
    return layers;
  }

  /**
   * Open the attribution popover. It is collapsed by default, so call this (or
   * use the ⓘ button, which toggles the same state) to open it. Affects the
   * popover card only — the always-visible logo frame stays put.
   */
  show(): void {
    this.setOpen(true);
  }

  /**
   * Close the attribution popover. Affects the popover card only; the tracked
   * attributions and the always-visible logo frame are untouched (use
   * {@link remove} to drop entries, {@link dispose} to tear everything down).
   */
  hide(): void {
    this.setOpen(false);
  }

  /** Release all DOM nodes, camera listeners, and layer listeners. */
  dispose(): void {
    this.view?.off("preRender", this.boundPreRender);
    this.teardownDom();
    this.items = [];
    this.view = undefined;
  }

  /**
   * Update the UI colors. Merges over the current style and re-themes the live
   * DOM in place (no rebuild), so it suits runtime switches like light ⇄ dark.
   */
  setStyle(style: AttributionStyle): void {
    this.style = { ...this.style, ...style };
    this.applyStyle();
  }

  /** Push the current style onto the dock as CSS custom properties. */
  private applyStyle(): void {
    const dock = this.dock;
    if (!dock) return;
    const set = (name: string, value: string | undefined): void => {
      if (value !== undefined) dock.style.setProperty(name, value);
    };
    set("--nvr-attr-title", this.style.titleColor);
    set("--nvr-attr-link", this.style.linkColor);
    set("--nvr-attr-bullet", this.style.listStyleColor);
    set("--nvr-attr-text", this.style.textColor);
    set("--nvr-attr-nested", this.style.nestedTextColor);
    set("--nvr-attr-bg", this.style.backgroundColor);
    set("--nvr-attr-border", this.style.borderColor);
  }

  /**
   * Build / refresh the popover DOM from {@link displayedItems}, filtering
   * zoom-banded children by the current camera zoom.
   */
  private render(): void {
    if (!this.view) return;
    this.ensureDom(this.view);
    const items = this.displayedItems();
    this.hasZoomBands = items.some(
      (item) =>
        !isAttributionHtml(item) &&
        (item.children?.some(
          (c) => c.minZoom !== undefined || c.maxZoom !== undefined,
        ) ??
          false),
    );
    this.lastZoomLevel = this.currentZoomLevel();
    this.populateList();
    this.populateLogos();
    // The dock always shows: the built-in Navara credit is always present. The
    // logo frame only shows when at least one source declares a logo.
    if (this.dock) this.dock.hidden = false;
    const hasLogos = items.some(
      (item) => !isAttributionHtml(item) && !!item.logo,
    );
    if (this.logosEl) this.logosEl.hidden = !hasLogos;
  }

  /** Create the dock DOM and inject (or reuse) the shared styles. */
  private ensureDom(view: View): void {
    if (!this.styleEl) {
      // Reuse a shared style element if another instance already injected it,
      // and count this instance as an owner (removed on the last teardown).
      const existing = document.getElementById(STYLE_ELEMENT_ID);
      if (existing instanceof HTMLStyleElement) {
        this.styleEl = existing;
      } else {
        const style = document.createElement("style");
        style.id = STYLE_ELEMENT_ID;
        style.textContent = STYLE_TEXT;
        document.head.appendChild(style);
        this.styleEl = style;
      }
      styleRefCount += 1;
    }
    if (this.dock) return;

    // Mount next to the canvas so the UI stays inside the map; a canvas placed
    // directly in <body> fills the page, so the UI anchors to the viewport.
    const mount = view.canvas.parentElement ?? document.body;
    const fixed = mount === document.body;
    if (!fixed) this.restoreMount = positionIfStatic(mount);

    const dock = document.createElement("div");
    dock.className = "navara-attr-dock";
    if (this.position === "bottom-left") {
      dock.classList.add("navara-attr-dock--left");
    }
    if (fixed) dock.classList.add("navara-attr-dock--fixed");

    const card = document.createElement("div");
    card.className = "navara-attr-card";
    // Reflect the current open intent (see setOpen).
    card.hidden = !this.isOpen;

    const head = document.createElement("div");
    head.className = "navara-attr-head";
    const title = document.createElement("h3");
    title.textContent = "Attributions";
    const close = document.createElement("button");
    close.className = "navara-attr-close";
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => this.setOpen(false));
    head.appendChild(title);
    head.appendChild(close);

    const list = document.createElement("ul");
    list.className = "navara-attr-list";

    card.appendChild(head);
    card.appendChild(list);

    const toggle = document.createElement("button");
    toggle.className = "navara-attr-toggle";
    toggle.type = "button";
    toggle.innerHTML = SVG_ICON_HTML;
    toggle.setAttribute("aria-expanded", String(this.isOpen));
    toggle.setAttribute(
      "aria-label",
      this.isOpen ? "Hide attributions" : "Show attributions",
    );
    toggle.addEventListener("click", () => this.setOpen());

    dock.appendChild(card);
    dock.appendChild(toggle);
    mount.appendChild(dock);

    // Always-visible logo frame in the separate bottom-left corner, so
    // contractually-mandated marks stay visible independent of the popover.
    const logoFrame = document.createElement("div");
    logoFrame.className = "navara-attr-logoframe";
    // In bottom-left mode the ⓘ button sits at the far left, so shift the logo
    // frame right of it to keep them in one row instead of overlapping.
    if (this.position === "bottom-left") {
      logoFrame.classList.add("navara-attr-logoframe--left");
    }
    if (fixed) logoFrame.classList.add("navara-attr-logoframe--fixed");
    mount.appendChild(logoFrame);

    document.addEventListener("keydown", this.boundKeydown);

    this.dock = dock;
    this.card = card;
    this.listEl = list;
    this.logosEl = logoFrame;
    this.toggle = toggle;
    this.applyStyle();
  }

  /** Create a bullet list item, returning the `<li>` and its text `<span>`. */
  private createItemShell(): { li: HTMLLIElement; text: HTMLSpanElement } {
    const li = document.createElement("li");
    li.className = "navara-attr-item";
    const name = document.createElement("div");
    name.className = "navara-attr-name";
    const bullet = document.createElement("span");
    bullet.className = "navara-attr-bullet";
    name.appendChild(bullet);
    const text = document.createElement("span");
    name.appendChild(text);
    li.appendChild(name);
    return { li, text };
  }

  /**
   * Rebuild the list. Each source shows its sub-credits — zoom-filtered static
   * `children` plus the dynamic credits of the layer it links via
   * `creditLayerId` — as a nested list.
   */
  private populateList(): void {
    if (!this.listEl) return;
    this.listEl.replaceChildren();

    for (const item of this.displayedItems()) {
      const { li, text } = this.createItemShell();

      if (isAttributionHtml(item)) {
        appendSanitizedHtml(text, item.attributionHtml);
        this.listEl.appendChild(li);
        continue;
      }

      const href = item.attributionUrl
        ? safeHref(item.attributionUrl)
        : undefined;
      if (href) {
        text.appendChild(createSafeAnchor(href, item.attribution));
      } else {
        text.textContent = item.attribution;
      }

      // Sub-credits: zoom-banded static children, then the linked layer's
      // dynamic credits. Both go through the sanitizer so embedded `<a>` links
      // stay clickable while scripts/handlers from untrusted tile metadata are
      // dropped to text.
      const sub = document.createElement("ul");
      sub.className = "navara-attr-related";
      if (item.children) {
        for (const child of item.children) {
          if (!matchesZoom(child, this.lastZoomLevel)) continue;
          const childLi = document.createElement("li");
          appendSanitizedHtml(childLi, child.attribution);
          sub.appendChild(childLi);
        }
      }
      if (item.creditLayerId) {
        for (const credit of this.layerCreditStrings(item.creditLayerId)) {
          const creditLi = document.createElement("li");
          appendSanitizedHtml(creditLi, credit);
          sub.appendChild(creditLi);
        }
      }

      if (sub.childElementCount > 0) li.appendChild(sub);

      this.listEl.appendChild(li);
    }
  }

  /** Aggregated, deduped credit strings for a tracked layer's visible features. */
  private layerCreditStrings(layerId: string): string[] {
    const state = this.layerCredits.get(layerId);
    if (!state) return [];
    const strings: string[] = [];
    for (const id of state.visible) {
      const credit = state.credits.get(id);
      if (credit) strings.push(credit);
    }
    return aggregateCredits(strings);
  }

  /**
   * Rebuild the list if the popover is open; while closed, do nothing —
   * `setOpen()` repopulates on open, so deferred updates are picked up then.
   */
  private requestRender(): void {
    if (this.dock && this.isOpen) this.populateList();
  }

  /** Rebuild the always-visible logo frame from sources that declare a `logo`. */
  private populateLogos(): void {
    if (!this.logosEl) return;
    this.logosEl.replaceChildren();

    for (const item of this.displayedItems()) {
      if (isAttributionHtml(item) || !item.logo) continue;
      const img = document.createElement("img");
      img.src = item.logo;
      img.alt = item.attribution;
      img.className = "navara-attr-logo";
      img.draggable = false;

      // Link the logo only when the source declares a (safe) `logoUrl`, opened in
      // a new tab. A mark that must be shown but not turned into a link omits
      // `logoUrl` and stays a plain `<img>`.
      const href = item.logoUrl ? safeHref(item.logoUrl) : undefined;
      let node: HTMLElement = img;
      if (href) {
        node = createSafeAnchor(href);
        node.appendChild(img);
      }
      this.logosEl.appendChild(node);
    }
  }

  /** Open / close the popover. Non-modal: no backdrop is added. */
  private setOpen(open?: boolean): void {
    // Record intent before the DOM guard; ensureDom() applies it when the card is built.
    this.isOpen = open ?? !this.isOpen;
    if (!this.card || !this.toggle) return;
    this.card.hidden = !this.isOpen;
    this.toggle.setAttribute("aria-expanded", String(this.isOpen));
    // Keep the accessible name in sync with what activating the button does.
    this.toggle.setAttribute(
      "aria-label",
      this.isOpen ? "Hide attributions" : "Show attributions",
    );
    // On open, refresh once: the per-frame zoom poll is skipped while closed,
    // so the zoom band may be stale.
    if (this.isOpen) {
      if (this.hasZoomBands) this.lastZoomLevel = this.currentZoomLevel();
      this.populateList();
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.isOpen) this.setOpen(false);
  }

  /**
   * Recompute the zoom and, only when the integer level changed, re-render the
   * list (a "quiet" update — no flicker, no animation). Called on every
   * `preRender`; the level-change gate makes it a no-op unless the band changes.
   */
  private handlePreRender(): void {
    // Poll only while the popover is open and a source has zoom bands. The
    // `camera.zoom` poll crosses the WASM boundary, so skipping it while closed
    // (or when nothing is zoom-banded) avoids per-frame overhead for users who
    // never open the UI; `setOpen()` refreshes the level on open.
    if (!this.dock || !this.hasZoomBands || !this.isOpen) return;
    const level = this.currentZoomLevel();
    if (level === this.lastZoomLevel) return;
    this.lastZoomLevel = level;
    this.requestRender();
  }

  /**
   * Current integer Web Mercator zoom level. The engine computes the fractional
   * zoom (altitude/FOV/viewport) in Rust via `camera.zoom`; floor it to a tile
   * level for band matching. `undefined` (e.g. before the first frame) shows all
   * bands.
   */
  private currentZoomLevel(): number | undefined {
    const z = this.view?.camera.zoom;
    return z === undefined ? undefined : Math.floor(z);
  }

  /**
   * Remove this instance's DOM nodes, document + layer listeners, and state.
   * The shared style element is removed only when the last instance tears down.
   */
  private teardownDom(): void {
    for (const off of this.layerCleanups) off();
    this.layerCleanups = [];

    if (this.dock) {
      document.removeEventListener("keydown", this.boundKeydown);
      this.dock.remove();
    }
    this.logosEl?.remove();
    this.restoreMount?.();
    this.restoreMount = undefined;
    if (this.styleEl) {
      // Only remove the shared style when the last owning instance tears down.
      styleRefCount = Math.max(0, styleRefCount - 1);
      if (styleRefCount === 0) this.styleEl.remove();
    }
    this.dock = undefined;
    this.card = undefined;
    this.listEl = undefined;
    this.logosEl = undefined;
    this.toggle = undefined;
    this.styleEl = undefined;
    this.isOpen = false;

    this.layerCredits.clear();
  }

  /**
   * Subscribe to the given layers' feature events and merge per-feature credits
   * into the rendered list as features appear / disappear. Detaches any
   * previously registered listeners first, so repeated `add()` / `remove()`
   * don't leak.
   */
  private trackLayers(layers: Layer[]): void {
    for (const off of this.layerCleanups) off();
    this.layerCleanups = [];
    this.layerCredits.clear();

    for (const layer of layers) {
      const state = {
        credits: new Map<bigint, string>(),
        visible: new Set<bigint>(),
      };
      this.layerCredits.set(layer.id, state);

      // Track only features that actually carry a credit: layers can emit many
      // credit-less features (e.g. PLATEAU), and tracking them would grow these
      // sets unbounded and churn the UI with no visible effect.
      const onCreated = ({ featureSetId, credit }: FeatureCreatedParams) => {
        if (!credit) return;
        state.credits.set(featureSetId, credit);
        state.visible.add(featureSetId);
        this.requestRender();
      };
      const onRemoved = ({ featureSetId }: FeatureRemovedParams) => {
        if (!state.credits.has(featureSetId)) return;
        state.credits.delete(featureSetId);
        state.visible.delete(featureSetId);
        this.requestRender();
      };
      const onVisibility = ({
        featureSetId,
        visible,
      }: FeatureVisibilityChangedParams) => {
        if (!state.credits.has(featureSetId)) return;
        if (visible) state.visible.add(featureSetId);
        else state.visible.delete(featureSetId);
        this.requestRender();
      };
      // Assigned below; declared first so `onDeleted` can reference it.
      let detach = () => {};
      // `deleted` fires once for the layer (no per-feature `featureRemoved`).
      // Fully release the layer — drop its credits entry and detach its
      // listeners (and this cleanup) — so a deleted layer doesn't linger until
      // the next add()/remove()/clear() or dispose().
      const onDeleted = () => {
        detach();
        this.layerCleanups = this.layerCleanups.filter((c) => c !== detach);
        this.layerCredits.delete(layer.id);
        this.requestRender();
      };
      detach = () => {
        layer.off("featureCreated", onCreated);
        layer.off("featureRemoved", onRemoved);
        layer.off("featureVisibilityChanged", onVisibility);
        layer.off("deleted", onDeleted);
      };

      layer.on("featureCreated", onCreated);
      layer.on("featureRemoved", onRemoved);
      layer.on("featureVisibilityChanged", onVisibility);
      layer.on("deleted", onDeleted);
      this.layerCleanups.push(detach);
    }
  }
}
