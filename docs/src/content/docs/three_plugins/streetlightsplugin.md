---
title: StreetLightsPlugin
description: Street lamps, roof beacons and moving traffic at night, streamed in around the camera from OpenMapTiles-schema vector tiles.
sidebar:
  order: 4
---

## Overview

`StreetLightsPlugin` turns an OpenMapTiles-schema vector tile set into a city at night. `addRoads()` draws dark road surfaces over the `transportation` layer of a vector source. `start()` then streams the zoom 14 tiles of the same tile set in around the position given to `follow()`, and places street lamps along every road, a red beacon on every roof 90 m or higher, and cars that drive along the road segments.

The plugin fetches those tiles a second time. The engine decodes them for rendering but exposes no feature geometry. The tile set must follow the OpenMapTiles schema: `transportation` features with `class` and `oneway`, and `building` features with `render_height`.

The lamps and beacons are `point` layers. The selective effects given to `start()` apply to them, such as the built-in [`selectiveBloom`](../../three_default_descs/effect-desc/selective-bloom-effect-desc/). The cars are additive points drawn by [`StreetTrafficMeshDesc`](#streettrafficmeshdesc), which the plugin registers on `init()`. Neither needs a light in the scene.

## Usage

```typescript
import ThreeView from "@navaramap/three";
import type { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import {
  StreetLightsPlugin,
  TileJsonPlugin,
  type StreetTrafficDescriptions,
} from "@navaramap/three-plugins";

// The cars move every frame.
const view = new ThreeView<DefaultDescriptions | StreetTrafficDescriptions>({
  container,
  animation: true,
});

const tilejson = new TileJsonPlugin();
const streetLights = new StreetLightsPlugin({ radius: 2 });

view.addPlugin(new DefaultPlugin());
view.addPlugin(tilejson);
view.addPlugin(streetLights);
await view.init();

const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });

// An OpenMapTiles-schema vector tile set. Its TileJSON document also names
// the tile URL template the plugin streams the roads from.
let tileTemplate = "";
tilejson.on("loaded", ({ tilejson: document }) => {
  tileTemplate = document.tiles[0];
});
const streets = await tilejson.addSource({
  type: "vector-tile",
  url: "https://tiles.openfreemap.org/planet",
});

streetLights.addRoads(streets);
streetLights.start({ tileTemplate, effectIds: [bloom.id] });

// Keep the tiles around the camera loaded as it moves.
view.on("postUpdate", () => {
  const { lng, lat } = view.camera.positionGeographic;
  streetLights.follow(lng, lat);
});
```

## Constructor

```typescript
new StreetLightsPlugin(config?: StreetLightsConfig);
```

Register the plugin with `view.addPlugin()` **before** `view.init()`. On `init()` it registers `StreetTrafficMeshDesc` under the key `streetTraffic`.

| Property        | Type                   | Default | Description                                                                                                                   |
| --------------- | ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `radius`        | `number`               | `2`     | Tiles kept loaded around the followed position, as a radius in zoom 14 tiles. `2` is a 5 × 5 block, about 10 km across at Tokyo's latitude. |
| `traffic`       | `StreetTrafficOptions` | `{}`    | Speed multiplier and light size of the cars. See [`StreetTrafficOptions`](#streettrafficoptions).                            |

## Methods

### addRoads(source)

```typescript
addRoads(source: Source): Layer
```

Adds a [vector layer](../../three/layer/vector-layer/) over the `transportation` layer of `source` that draws every road class with traffic as a dark line clamped to the ground, with a width in pixels per class (motorway `6` down to service `1.5`). Other classes, such as rail and paths, are hidden. Must be called **after** `view.init()`. Otherwise the call throws.

Returns the created layer.

### start(options)

```typescript
start(options: StreetLightsStartOptions): void
```

Starts streaming lamps, beacons and traffic from the tiles of `options.tileTemplate`. `follow()` then decides which tiles are loaded. `options.effectIds` are the selective effects the lamps and beacons take part in. Calling `start()` again drops the tiles of the previous start. Must be called **after** `view.init()`. Otherwise the call throws.

### follow(lng, lat)

```typescript
follow(lng: number, lat: number): void
```

Keeps the tiles within `radius` of the tile containing the position loaded, nearest first, and drops the tiles that fell out of range. Nothing happens while the position stays inside the same tile, so it is cheap to call on every `postUpdate`. Must be called **after** `start()`. Otherwise the call throws.

### setVisible(visible)

```typescript
setVisible(visible: boolean): void
```

Shows or hides the whole street-level detail: road surfaces, lamps, beacons and traffic. Use it to switch the detail off above an altitude where it no longer reads.

### setLightsOn(on)

```typescript
setLightsOn(on: boolean): void
```

Switches the lamps, beacons and traffic on or off. The road surfaces stay. Use it to follow the sun.

### update(updates)

```typescript
update(updates: StreetLightsUpdate): void
```

Applies new traffic options to the loaded tiles and to the tiles still to come.

### dispose()

```typescript
dispose(): void
```

Drops every layer, source and mesh the plugin added, and stops the tiles still loading. The plugin cannot be used again afterwards.

## Types

### StreetLightsConfig

```typescript
type StreetLightsConfig = {
  radius?: number;
  traffic?: StreetTrafficOptions;
};
```

The constructor options. See [Constructor](#constructor).

### StreetLightsStartOptions

```typescript
type StreetLightsStartOptions = {
  tileTemplate: string;
  effectIds?: string[];
};
```

| Property       | Type       | Default | Description                                                                                     |
| -------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------- |
| `tileTemplate` | `string`   |         | A `{z}/{x}/{y}` tile URL of an OpenMapTiles-schema tile set, as listed in its TileJSON document. |
| `effectIds`    | `string[]` | `[]`    | Selective effects the lamps and beacons take part in, such as a bloom.                           |

### StreetLightsUpdate

```typescript
type StreetLightsUpdate = {
  traffic?: StreetTrafficOptions;
};
```

### StreetTrafficOptions

```typescript
type StreetTrafficOptions = {
  speed?: number;
  size?: number;
};
```

| Property | Type     | Default | Description                           |
| -------- | -------- | ------- | ------------------------------------- |
| `speed`  | `number` | `1`     | Multiplier on every car's speed.      |
| `size`   | `number` | `2.5`   | Diameter of a car's light in meters.  |

The cars drive at the speed of their road class, from about 5 m/s on service roads to 22 m/s on motorways, each one varied by up to 30 percent.

### StreetTrafficDescriptions

```typescript
type StreetTrafficDescriptions = { mesh: StreetTrafficMeshConfig };
```

The descriptions the plugin registers. Add it to the view's type parameter, as `ThreeView<DefaultDescriptions | StreetTrafficDescriptions>`, for typed mesh handles.

### StreetTrafficMeshDesc

The mesh Descriptor behind the cars, registered under the key `streetTraffic`. One point per car drives its road segment on the GPU and wraps around. Headlights face the camera white, taillights red. The plugin adds one mesh per tile with `view.addMesh()`. Its `streetTraffic` config holds `data`, the per-car segments the plugin builds from the tile, and the [`StreetTrafficOptions`](#streettrafficoptions).

## Notes

- **Evaluated values win over the material.** The plugin sets the visibility of every road, lamp and beacon per feature, so `layer.update({ point: { show } })` on its layers has no effect. Use `setVisible()` and `setLightsOn()` instead.
- **Only the lamps and beacons bloom.** They write the emissive color that `selectiveBloom` reads. The cars are additive points drawn after the G-buffer and do not take part in the effect.
- **The tiles count against the same credit as the source.** The plugin fetches the tiles from the template of the tile set the source shows, so the attribution the source carries covers them.
- **Render every frame.** The cars move with the view's clock, so construct the view with `animation: true`.
- **Zoom 14 only.** The plugin reads the zoom 14 tiles whatever the camera's zoom, so `radius` is in those tiles, about 2 km across at Tokyo's latitude.

## Related Resources

- [About](../about/): Overview of three_plugins
- [TileJsonPlugin](../tilejsonplugin/): Reading the tile URL template from a TileJSON document
- [Vector Layer](../../three/layer/vector-layer/): The layer type behind the roads, lamps and beacons
- [SelectiveBloomEffectDesc](../../three_default_descs/effect-desc/selective-bloom-effect-desc/): The bloom the lamps and beacons take part in
- [Night City](https://navara.world/examples/showcase/night-city): A showcase built on this plugin
