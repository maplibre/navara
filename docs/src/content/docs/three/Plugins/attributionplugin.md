---
title: AttributionPlugin
description: Non-modal, zoom-aware data attribution (credit) UI plugin for navara_three.
sidebar:
  order: 1040
---

## Overview

`AttributionPlugin` shows an attribution (credit) UI for your map's data sources. **`ThreeView` creates the attribution UI by default and exposes it as `view.attribution`** (pass `defaultAttribution: false` to opt out and build your own UI). A built-in **"Navara" credit is always shown first**, so the UI is visible even before you add any source. The popover lists the active sources and is **collapsed by default**. A small ⓘ button (in a bottom corner, bottom-right by default) toggles it (`show()` opens it and `hide()` closes it). It is non-modal: the map stays interactive (pan / zoom / rotate) while the popover is open.

The UI is placed inside the element that holds the view's canvas (the `container` option, or the parent element of `canvas`) and is anchored to its bottom corners. If that element has `position: static`, the plugin sets it to `position: relative` until the plugin is disposed. When the canvas sits directly in `<body>`, the UI is anchored to the viewport.

It covers the three things map attributions usually need:

- **Zoom-aware credits**: a source can carry child credits that apply only within a zoom range, so only the relevant ones are shown and they switch as the user zooms.
- **Per-layer credits**: credits supplied by layers (such as a 3D tile's copyright) are tracked automatically as the displayed data changes, and nested under the source you link with `creditLayerId`.
- **Always-visible logos**: logos that must always be shown (e.g. Google) sit in a separate logo frame in the bottom-left corner, independent of whether the popover is open.

Credits may contain inline `<a>` links. They are sanitized before display. The colors are themeable at runtime with [`setStyle()`](#setstylestyle).

## Usage

```typescript
import ThreeView from "@navaramap/three";

// ThreeView creates the attribution UI by default; access it via view.attribution.
const view = new ThreeView({ container });
await view.init();

// Raster basemap: its tiles contain no credit metadata, so declare it statically.
const basemap = view.addSource({
  type: "raster-tile",
  url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
  maxZoom: 18,
});
view.addLayer({ type: "raster", source: basemap });

// 3D tiles whose tiles embed their own copyright (tracked dynamically).
const photorealSource = view.addSource({
  type: "3d-tiles",
  url: "https://tile.googleapis.com/v1/3dtiles/root.json?key=YOUR_KEY",
});
const photoreal = view.addLayer({ type: "3d-tiles", source: photorealSource });

// `add` / `remove` manage the displayed credits. `view.attribution`
// is `undefined` if you opted out with `defaultAttribution: false` (or in a
// worker / no-DOM environment).
view.attribution?.add([
  {
    attribution: "Geospatial Information Authority of Japan (GSI)",
    attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    children: [
      { attribution: "Nationwide latest aerial photos (seamless)", minZoom: 14, maxZoom: 18 },
      { attribution: "GRUS画像（© Axelspace）", minZoom: 14, maxZoom: 18 },
    ],
  },
  {
    attribution: "Google Maps Photorealistic 3D Tiles",
    logo: "/credits/GoogleMaps.png",
    // `logoUrl` makes the logo a link; omit it for a display-only mark.
    logoUrl: "https://www.google.com/maps",
    // Nest this layer's per-tile credits under this source. The layer is
    // resolved from the view by id, so you don't pass it separately.
    creditLayerId: photoreal.id,
  },
  {
    attributionHtml:
      '<a href="https://s2maps.eu">Sentinel-2 cloudless 2020</a> by <a href="https://eox.at">EOX IT Services GmbH</a>',
  },
]);

// Drop a source again when its data leaves the map. Matching is structural, so
// pass the same shape you added (here, including `logo`).
view.attribution?.remove([
  {
    attribution: "Google Maps Photorealistic 3D Tiles",
    logo: "/credits/GoogleMaps.png",
    logoUrl: "https://www.google.com/maps",
    creditLayerId: photoreal.id,
  },
]);

// The popover is collapsed by default; show() opens it and hide() collapses it
// (the ⓘ button toggles the same state).
view.attribution?.hide();
view.attribution?.show();
```

## Enabling & access

`ThreeView` creates the attribution UI by default and exposes it as a readonly getter:

```typescript
view.attribution; // AttributionPlugin | undefined
```

Configure or disable it with the `defaultAttribution` option:

```typescript
new ThreeView({
  // `false` to opt out and build your own UI, or an object to set the initial
  // colors / corner. Defaults to `true`.
  defaultAttribution?:
    | boolean
    | { style?: AttributionStyle; position?: "bottom-left" | "bottom-right" };
});
```

`view.attribution` is `undefined` when disabled via `defaultAttribution: false`, or in a worker / no-DOM environment (the built-in plugin needs the DOM). `position` chooses the bottom corner for the ⓘ button and its popover card (default `"bottom-right"`). Use `"bottom-left"` when the bottom-right corner is occupied, e.g. a page with its own HUD there. The logo frame lives in the bottom-left area in both modes. In `"bottom-left"` the ⓘ takes the far-left corner and the logos shift right to sit beside it. `style` sets the initial colors (see [AttributionStyle](#attributionstyle)).

**Advanced:** `AttributionPlugin` is also exported from `@navaramap/three` and can be constructed manually (`new AttributionPlugin({ style?, position? })`) and registered with `view.addPlugin()` **before** `view.init()`, e.g. to attach one to a view created with `defaultAttribution: false`.

## Methods

### add(items)

```typescript
add(items: AttributionItem[]): void
```

Adds the specified credits to the attribution UI, merging them with the current entries. Exact-duplicate entries are dropped, so several data sources that share one credit render a single line. Sources that set `creditLayerId` have the credits supplied by that layer tracked dynamically: the layer is resolved from the view by id, so you don't pass it separately.

### remove(items)

```typescript
remove(items: AttributionItem[]): void
```

Removes the specified credits from the attribution UI. Entries are matched structurally (by their rendered content), so pass the same object shape you added. No separate id is needed. Unmatched entries are ignored.

Use it for statically-added credits you want to toggle by camera or app state. For example, pair `add()` / `remove()` with camera moves to show a top-level source only within a range that its `children` zoom bands can't express. Credits tracked via `creditLayerId` are dropped automatically when their layer is deleted, so those don't need `remove()`.

### clear()

```typescript
clear(): void
```

Removes all user-added credits while keeping the plugin alive: the popover, listeners, and styles it added stay, so you can add credits again later with `add()`. The built-in "Navara" credit and the ⓘ button stay visible. The logo frame hides itself when no logo remains. Use `dispose()` to tear the DOM down instead.

### show()

```typescript
show(): void
```

Opens the attribution popover. It is collapsed by default, so call this method or use the ⓘ button to open it. Affects the popover card only. The always-visible logo frame stays put.

### hide()

```typescript
hide(): void
```

Closes the attribution popover. Affects the popover card only. The tracked credits and the always-visible logo frame are untouched. Use `remove()` to drop entries, or `dispose()` to tear everything down.

### dispose()

```typescript
dispose(): void
```

Removes the UI and releases everything the plugin set up. `view.attribution` is disposed automatically by `view.dispose()`, so you only need to call this on a manually-created instance.

### setStyle(style)

```typescript
setStyle(style: AttributionStyle): void
```

Updates the UI colors at runtime. Merges over the current style and applies the change to the live UI without rebuilding the DOM, so it suits switching between light and dark modes.

```typescript
view.attribution?.setStyle({
  backgroundColor: "rgba(20, 24, 28, 0.92)",
  textColor: "#e6e9ee",
  nestedTextColor: "rgba(230, 233, 238, 0.64)",
  linkColor: "#8ab4f8",
});
```

## Types

### AttributionItem

Each entry is either a structured source or a raw HTML credit:

```typescript
type AttributionItem = AttributionSource | AttributionHtml;
```

### AttributionSource

| Property         | Type                              | Description                                                                           |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `attribution`    | `string`                          | Top-level source / provider name                                                      |
| `attributionUrl` | `string \| undefined`             | Optional link for the source name                                                     |
| `logo`           | `string \| undefined`             | Optional logo image URL, shown in the always-visible bottom-left logo frame           |
| `logoUrl`        | `string \| undefined`             | Optional click target for the `logo`. The logo is linked only when this is set        |
| `children`       | `AttributionChild[] \| undefined` | Optional credits shown only at their zoom range                                       |
| `creditLayerId`  | `string \| undefined`             | Optional `layer.id`. Credits supplied by that layer are nested under this source      |

### AttributionHtml

| Property          | Type     | Description                                      |
| ----------------- | -------- | ------------------------------------------------ |
| `attributionHtml` | `string` | A credit written as HTML with inline `<a>` links |

### AttributionChild

| Property        | Type                  | Description                                          |
| --------------- | --------------------- | --------------------------------------------------- |
| `attribution`   | `string`              | Credit text. May contain inline `<a>` links         |
| `minZoom`       | `number \| undefined` | Lowest zoom this credit applies to (omit for none)  |
| `maxZoom`       | `number \| undefined` | Highest zoom this credit applies to (omit for none) |

### AttributionStyle

All fields are optional. An unset field keeps the default color. Colors are applied as CSS custom properties, so changes via `setStyle()` take effect immediately.

| Property          | Type                  | Description                                   |
| ----------------- | --------------------- | --------------------------------------------- |
| `titleColor`      | `string \| undefined` | Source title text color                       |
| `linkColor`       | `string \| undefined` | Link and info-icon color                      |
| `listStyleColor`  | `string \| undefined` | Bullet (list marker) color                    |
| `textColor`       | `string \| undefined` | Body text color                               |
| `nestedTextColor` | `string \| undefined` | Nested child-credit text color                |
| `backgroundColor` | `string \| undefined` | Popover and button background color           |
| `borderColor`     | `string \| undefined` | Header divider color (useful for dark themes) |

## Notes

- **Zoom ranges are for raster sources you declare yourself.** Tiles like GSI or OpenStreetMap don't carry their own credits, so describe their zoom-dependent credits with `children`.
- **Per-layer credits come from the tiles.** Only sources that embed a copyright (such as Google Photorealistic 3D Tiles) produce credits through `creditLayerId`. For everything else, use `children`.
- **Mandated logos go in the logo frame, not the popover.** Use `logo` only for marks you are required to keep visible at all times. Ordinary sources are best shown as text. A logo is an unlinked image by default. Set `logoUrl` to make it link to the provider's page. Some marks must be shown but not turned into a link, so leave `logoUrl` unset for those.
- **Links are scheme-checked.** Every credit link (`attributionUrl`, `logoUrl`, inline `<a>` in `attributionHtml` / `attribution`, and `<a>` embedded in credits supplied by a layer) is kept only for safe schemes (`http` / `https` / `mailto`, or relative URLs). Anything else (e.g. `javascript:`) is dropped to plain text. This makes it safe to render links even from untrusted tile metadata.
- **Bare URLs are auto-linked.** A plain `http(s)` URL inside credit text is turned into a clickable link automatically, so you can paste an official notice verbatim without hand-wrapping the URL in `<a>`. The wording (and the URL) stays unchanged.

## Related Resources

- [OverlayPlugin](../../../three_plugins/overlayplugin/): World-to-screen HTML overlay projection
- [About three_plugins](../../../three_plugins/about/): Package overview
