---
title: OverlayPlugin
description: World-to-screen HTML overlay projection plugin for navara_three.
sidebar:
  order: 3
---

## Overview

`OverlayPlugin` tracks a set of geographic positions (lat/lng/alt) and projects them to screen coordinates on every render frame. This enables HTML overlays (markers, labels, tooltips) that stay anchored to world positions as the camera moves.

The plugin handles only the projection math. Rendering the actual HTML elements is left to your application, giving full control over styling and interaction.

## Usage

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { OverlayPlugin, moveOverlayElement } from "@navaramap/three-plugins";

const view = new ThreeView({ container, animation: true });
const defaultPlugin = new DefaultPlugin();
const overlayPlugin = new OverlayPlugin({ maxDistance: 100_000 });

view.addPlugin(defaultPlugin);
view.addPlugin(overlayPlugin);
await view.init();

// Set positions to track
overlayPlugin.setPositions([
  { id: "tokyo-tower", lng: 139.7454, lat: 35.6586, alt: 0 },
  { id: "skytree", lng: 139.8107, lat: 35.7101, alt: 0 },
]);

// Update HTML elements every frame
const unsub = overlayPlugin.onUpdate(({ projected }) => {
  for (const [id, pos] of projected) {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "";
      moveOverlayElement(el, pos.x, pos.y);
    }
  }
});

// Cleanup
unsub();
overlayPlugin.dispose();
```

## Constructor

```typescript
new OverlayPlugin(config?: OverlayConfig)
```

### OverlayConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxDistance` | `number` | `100_000` | Positions farther than this distance (in meters) from the camera are skipped |

## Methods

### setPositions(positions)

```typescript
setPositions(positions: WorldPosition[]): void
```

Replaces the set of world positions to track. The next frame projects the new positions and calls the `onUpdate` listeners, and a frame is rendered for this even when the map is idle. Calls made within one frame, including from an `onUpdate` listener, are projected together on the next frame.

### onUpdate(fn)

```typescript
onUpdate(fn: (state: OverlayState) => void): () => void
```

Subscribes to projection updates. The callback fires on every rendered frame with the latest projected screen coordinates. Without `animation: true`, the view renders only when something changes (the camera moves, data loads, `setPositions()` is called). A new listener receives the current projection on the next frame, which is rendered for this even when the map is idle. Returns an unsubscribe function.

### dispose()

```typescript
dispose(): void
```

Removes the `preRender` hook, clears all listeners, and resets internal state.

## Types

### WorldPosition

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique identifier used as the key in the projected map |
| `lng` | `number` | Longitude in degrees |
| `lat` | `number` | Latitude in degrees |
| `alt` | `number` | Altitude in meters |

### ProjectedPosition

| Property | Type | Description |
|----------|------|-------------|
| `x` | `number` | Screen X coordinate in pixels |
| `y` | `number` | Screen Y coordinate in pixels |
| `distance` | `number` | Distance from the camera in meters (ECEF euclidean) |

### OverlayState

| Property | Type | Description |
|----------|------|-------------|
| `projected` | `Map<string, ProjectedPosition>` | Map of position IDs to their screen coordinates. Only contains positions within `maxDistance`. |

## Utility Functions

### moveOverlayElement(el, x, y)

```typescript
moveOverlayElement(el: HTMLElement, x: number, y: number): void
```

Positions an absolutely-positioned HTML element at the given screen coordinates using a GPU-accelerated CSS `translate()` transform. This is a convenience function. You can implement your own positioning logic if needed.

## Extracting Distance for UI

The `distance` field in `ProjectedPosition` can be used to drive visual effects like opacity fading or size scaling:

```typescript
overlayPlugin.onUpdate(({ projected }) => {
  for (const [id, pos] of projected) {
    const el = document.getElementById(id);
    if (!el) continue;

    moveOverlayElement(el, pos.x, pos.y);

    // Fade out markers as they get farther away
    const opacity = Math.max(0.3, 1 - pos.distance / 100_000);
    el.style.opacity = String(opacity);
  }
});
```

## Related Resources

- [PersonViewPlugin](../personviewplugin/): Combine with OverlayPlugin for interactive person-view navigation with markers
- [About three_plugins](../about/): Package overview
