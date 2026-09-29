---
title: ThreeView Properties
description: API Reference for ThreeView Class Properties and Events
sidebar:
  order: 940
---

This page describes all properties and events available on a ThreeView instance.

## Properties

### camera

**Type:** `ThreeViewCamera`

**Read-only** (getter)

The camera controller that manages the view's position, orientation, projection, and interactive control behavior.

**Example:**

```tsx
// Read the camera's geographic position
const pos = view.camera.positionGeographic;

// Subscribe to camera movement events
view.camera.on("moveend", () => {
  console.log("Camera stopped");
});
```

:::tip[Related Documentation]
For full details on all properties, events, and control options, see [ThreeViewCamera Class](../../../three/api/camera/).
:::

### globe

**Type:** `Globe`

**Read-only** (getter)

The Globe instance that manages terrain, imagery layers, and globe-specific settings. Controls various properties related to globe display, including transparency, wireframe display, and elevation heatmap color maps.

**Example:**

```tsx
// Set globe transparency
view.globe.transparent = true;
view.globe.opacity = 0.8;

// Enable wireframe mode
view.globe.wireframe = true;

// Set color map for elevation heatmap
view.globe.elevationColormap = customColorMap;
```

:::tip[Related Documentation]
For details, see [Globe Class](../../../three/api/globe/).
:::

### atmosphere

**Type:** `Atmosphere`

**Read-only** (getter)

The instance that manages the atmosphere system. Handles sun and moon position calculations and atmospheric scattering texture management. When the `date` property is changed, sun and moon directions are automatically recalculated based on the ephemeris and reflected in related Descriptors such as `SunLightDesc` and `SkyMeshDesc`.

**Example:**

```tsx
// Set the date to change the sun position
view.atmosphere.date = new Date("2024-06-21T12:00:00");

// Get the sun direction vector
const sunDirection = view.atmosphere.getSunDirection();

// Determine if the current location is at night
const isNight = view.atmosphere.isAtNight(view.camera.positionECEF);

// Monitor sun direction changes
view.atmosphere.on("sunChanged", (sunDirection) => {
  console.log("Sun direction changed:", sunDirection);
});
```

:::tip[Related Documentation]
For details, see [Atmosphere Class](../../../three/api/atmosphere/).
:::

### toneMappingExposure

**Type:** `number`

Gets or sets the tone mapping exposure value for HDR rendering. Higher values make the scene brighter, lower values make it darker.

**Example:**

```tsx
// Increase exposure for a brighter scene
view.toneMappingExposure = 1.5;

// Decrease exposure for a darker scene
view.toneMappingExposure = 0.8;
```

### lit

**Type:** `boolean`

**Default:** `true`

Gets or sets the scene-level default of the `lit` material option. When `false`, every material that does not set `lit` explicitly outputs **plain albedo**: the lighting equation is skipped on the color output, while the rest of the lit pipeline keeps running: normals and the shadow G-buffer are still written. That combination is the input a deferred lighting pass needs.

Resolution is three-state, and the more specific setting always wins:

| Setting | Result |
| ------- | ------ |
| `lit: true` on a material or mesh | Lit, even when `view.lit` is `false` |
| `lit: false` on a material or mesh | Plain albedo, even when `view.lit` is `true` |
| `lit` unset (`undefined`) | Follows `view.lit` |

The option is available on the [`terrain`](../../../three/material/terrain-material/#lit), [`polygon`](../../../three/material/polygon-material/#lit), [`polyline`](../../../three/material/polyline-material/#lit) and [`model`](../../../three/material/model-material/#lit) materials, and top-level on any mesh Descriptor config (see [MeshDesc](../../../three_default_descs/mesh-desc/mesh-desc-base/#lighting-lit)). Materials that are unlit by nature (`point`, `billboard`, `text`) are unaffected.

**Example:**

```tsx
// Scene default: everything outputs plain albedo
view.lit = false;

// …except this mesh, which stays forward-lit
view.addMesh<SphereMeshDesc>({
  sphere: { radius: 100 },
  position,
  lit: true,
});
```

:::note
Toggling `lit` (on the view, a material, or a mesh) recompiles the affected shaders once. It is a configuration switch, not a per-frame control.
:::

:::tip[Related Documentation]
For a worked deferred lighting effect that consumes the albedo output together with the normal and shadow G-buffers, see [Custom Descriptor: Buffer / Texture Access](../../../three/core/custom-desc/#buffer--texture-access).
:::

### buffers

**Type:** `ResolvedGBufferOptions`

**Read-only** (getter)

The buffers currently allocated, as `{ selectiveEffect, emissive, shadow, globeNormal }` booleans. This is **derived**, not configured: the view allocates the union of what the active effect Descriptors declare, through `static requiredBuffers` or a `getRequiredBuffers()` override, and releases a buffer when the last effect needing it is removed or an effect stops declaring it.

The first three are G-buffer attachments. `globeNormal` is a separate screen-space copy of the terrain normal, so it takes no attachment slot (see [Custom Descriptor: Buffer / Texture Access](../../../three/core/custom-desc/#buffer--texture-access)).

**Example:**

```tsx
console.log(view.buffers);
// { selectiveEffect: false, emissive: false, shadow: false, globeNormal: false }
```

:::tip[Related Documentation]
For declaring `requiredBuffers` or `getRequiredBuffers()` and reading the buffers from a custom effect, see [Custom Descriptor: Buffer / Texture Access](../../../three/core/custom-desc/#buffer--texture-access).
:::

### animation

**Type:** `boolean`

Gets or sets whether continuous animation mode is enabled. When `true`, renders every frame. When `false`, renders only on changes.

**Example:**

```tsx
// Enable continuous rendering
view.animation = true;

// Render only when needed (power saving)
view.animation = false;
```

### screenSize

**Type:** `Vector2`

Gets the current screen size in pixels.

**Read-only**

**Example:**

```tsx
const size = view.screenSize;
console.log(`Screen size: ${size.x} x ${size.y} pixels`);
```

### pixelRatio

**Type:** `number`

Gets the current device pixel ratio.

**Read-only**

**Example:**

```tsx
const ratio = view.pixelRatio;
console.log(`Pixel ratio: ${ratio}`);
```

### shadowMapViewersEnabled

**Type:** `boolean`

Gets or sets whether the shadow map debug viewers are displayed on screen.

**Example:**

```tsx
// Show shadow map debug views
view.shadowMapViewersEnabled = true;

// Hide debug views
view.shadowMapViewersEnabled = false;
```

### cacheBytes

**Type:** `number | undefined`

Gets or sets the tile-cache memory budget in bytes (see the [`cacheBytes` option](../threeview-class#cachebytes)). The getter returns the resolved budget (`undefined` before `init()` when no explicit option was given). Lowering it at runtime evicts retained tiles down to the new budget over the next frames. Setting `undefined` disables budgeting entirely, restoring the original destroy-on-unvisited tile lifecycle.

**Example:**

```tsx
// Read the resolved budget
console.log(`cache budget: ${(view.cacheBytes ?? 0) / 1024 / 1024} MB`);

// Shrink the budget at runtime (evicts down to it over the next frames)
view.cacheBytes = 256 * 1024 * 1024;

// Disable tile-cache budgeting
view.cacheBytes = undefined;
```

### lodFog

**Type:** getter `LodFogSettings | undefined` / setter `Partial<LodFogSettings>`

Gets or sets the LOD fog settings (see the [`lodFog` option](../threeview-class#lodfog)): a distance-based screen-space-error relaxation that keeps far tiles coarser. The getter returns the resolved settings (`undefined` before `init()`). Partial values assigned to the setter merge over the current settings. The next traversal re-selects tile LODs with the new curve.

**Example:**

```tsx
// Strengthen the distance degrade — far tiles settle coarser
view.lodFog = { density: 2.5e-4, sseFactor: 3.0 };

// Only change one field; the rest keeps its current value
view.lodFog = { sseFactor: 4.0 };
```

### dynamicSse

**Type:** getter `DynamicSseSettings | undefined` / setter `Partial<DynamicSseSettings>`

Gets or sets the dynamic screen-space-error settings (see the [`dynamicSse` option](../threeview-class#dynamicsse)): tilted, street-level horizon views tolerate a larger error for far tiles. The getter returns the resolved settings (`undefined` before `init()`). Partial values assigned to the setter merge over the current settings. The next traversal re-selects tile LODs with the new curve.

**Example:**

```tsx
// Disable dynamic SSE
view.dynamicSse = { enabled: false };

// Tune the relaxation strength for horizon views
view.dynamicSse = { sseFactor: 16.0, heightFalloff: 0.25 };
```
