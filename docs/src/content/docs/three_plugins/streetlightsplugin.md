---
title: StreetLightsPlugin
description: Street lamps, roof beacons and moving traffic at night, streamed in around the camera from vector tiles.
sidebar:
  order: 4
since: 0.3.2
---

## Overview

`StreetLightsPlugin` turns roads and buildings into a city at night. `start()` takes the roads and the buildings, each with its tile source, draws the road surfaces and hides every feature without lights. `follow()` then streams the zoom 14 tiles in around a position, and places street lamps along every road, a red beacon on every roof the building reader gives a height, and cars that drive along the road segments.

The roads and buildings each name their source: a TileJSON document, as in `TileJsonPlugin.addSource()`, or a `{z}/{x}/{y}` vector tile URL, as in `view.addSource()`. They give a [`RoadReader`](#roadreader) and a [`BuildingReader`](#buildingreader) for their features' properties. The example below reads the OpenMapTiles schema. The plugin fetches the zoom 14 tiles itself, so a tile set the road surface draws from is requested twice.

The lamps and beacons are `point` layers. The selective effects given to `start()` apply to them, such as the built-in [`selectiveBloom`](../../three_default_descs/effect-desc/selective-bloom-effect-desc/). The cars are additive points drawn by [`StreetTrafficMeshDesc`](#streettrafficmeshdesc), which the plugin registers on `init()`. Neither needs a light in the scene.

## Usage

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import {
  StreetLightsPlugin,
  isRoadClass,
  type StreetTrafficDescriptions,
} from "@navaramap/three-plugins";

// The cars move every frame.
const view = new ThreeView<DefaultDescriptions | StreetTrafficDescriptions>({
  container,
  animation: true,
});

const streetLights = new StreetLightsPlugin();

view.addPlugin(new DefaultPlugin());
view.addPlugin(streetLights);
await view.init();

const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });

// Readers for the OpenMapTiles schema.
await streetLights.start({
  roads: {
    sourceType: "tilejson",
    sourceUrl: "https://tiles.openfreemap.org/planet",
    sourceLayers: ["transportation"],
    polyline: { color: new Color().setStyle("#15171c"), clampToGround: true },
    filterFeatureProperties: ["class", "oneway"],
    evaluateFeature: ({ class: roadClass, oneway }) =>
      isRoadClass(roadClass)
        ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
        : undefined,
  },
  buildings: {
    sourceType: "tilejson",
    sourceUrl: "https://tiles.openfreemap.org/planet",
    sourceLayers: ["building"],
    // Roofs from 90 m up; an outline drawn in parts leaves the beacon to them.
    evaluateFeature: ({ render_height: height, hide_3d }) =>
      typeof height === "number" && height >= 90 && hide_3d !== true
        ? height
        : undefined,
  },
  effectIds: [bloom.id],
});

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

| Property         | Type             | Default | Description                                                                                                 |
| ---------------- | ---------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `tileJsonPlugin` | `TileJsonPlugin` | created | Resolves `tilejson` sources. Created when omitted and disposed with this plugin. One passed in stays yours.   |

## Methods

### start(options)

```typescript
start(options: StreetLightsStartOptions): Promise<void>
```

Opens the sources of the roads and buildings, draws the road surfaces, and starts streaming lamps, beacons and traffic. `follow()` then decides which tiles are loaded. On the road surface, every feature the road reader skips, such as rail and paths, is hidden. The rest get the width of their [`RoadClass`](#roadclass). Roads and buildings with the same `sourceType` and `sourceUrl` share one source. Buildings get a source of their own only for a TileJSON document, which also carries their credit. A `vector-tile` URL is read directly, since the plugin draws no building layer. Calling `start()` again drops everything the previous start added once the new sources are open. A call overtaken by a later `start()` or by `dispose()` opens nothing. Must be called **after** `view.init()`. Otherwise the returned promise rejects.

### follow(lng, lat)

```typescript
follow(lng: number, lat: number): void
```

Keeps the tiles within `radius` of the tile containing the position loaded, nearest first, and drops the tiles that fell out of range. Nothing happens while the position stays inside the same tile, so it is cheap to call on every `postUpdate`. A tile the server answers with 404 holds no lights. Must be called **after** the promise returned by `start()` has resolved. Otherwise the call throws.

### setVisible(visible, part?)

```typescript
setVisible(visible: boolean, part?: StreetLightsPart): void
```

Shows or hides one `part` of the street-level detail, or all of them (road surfaces, lamps, beacons and traffic) when `part` is omitted. Use all of them to switch the detail off above an altitude where it no longer reads, and a part to drop, for example, the traffic alone.

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

Drops every source, layer and mesh the plugin added, including the road surfaces, and stops the tiles still loading. A `TileJsonPlugin` the plugin created is disposed too. The plugin cannot be used again afterwards.

## Types

### StreetLightsConfig

```typescript
type StreetLightsConfig = {
  tileJsonPlugin?: TileJsonPlugin;
};
```

The constructor options. See [Constructor](#constructor).

### StreetLightsStartOptions

```typescript
type StreetLightsStartOptions = {
  roads: StreetLightsRoads;
  buildings: StreetLightsBuildings;
  radius?: number;
  traffic?: StreetTrafficOptions;
  effectIds?: string[];
};
```

| Property    | Type                    | Default | Description                                                                                                                   |
| ----------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `roads`     | `StreetLightsRoads`     |         | The roads: their source, look and reader. See [`StreetLightsRoads`](#streetlightsroads).                                    |
| `buildings` | `StreetLightsBuildings` |         | The buildings: their source and reader. See [`StreetLightsBuildings`](#streetlightsbuildings).                               |
| `radius`    | `number`                | `2`     | Tiles kept loaded around the followed position, as a radius in zoom 14 tiles. `2` is a 5 × 5 block, about 10 km across at Tokyo's latitude. |
| `traffic`   | `StreetTrafficOptions`  | `{}`    | Speed multiplier and light size of the cars. Replaces what an earlier `update()` applied. See [`StreetTrafficOptions`](#streettrafficoptions). |
| `effectIds` | `string[]`              | `[]`    | Selective effects the lamps and beacons take part in, such as a bloom.                                                        |

### StreetLightsSource

```typescript
type StreetLightsSource = {
  sourceType: "tilejson" | "vector-tile";
  sourceUrl: string;
  sourceLayers: string[];
};
```

| Property       | Type                           | Default | Description                                                                                                                   |
| -------------- | ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `sourceType`   | `"tilejson" \| "vector-tile"` |         | `tilejson` is a TileJSON document, as in `TileJsonPlugin.addSource()`, read for the first tile URL it lists. `vector-tile` is a tile URL, as in `view.addSource()`. |
| `sourceUrl`    | `string`                       |         | The TileJSON document, or a `{z}/{x}/{y}` vector tile URL.                                                                   |
| `sourceLayers` | `string[]`                     |         | Source layers holding the features, as in `view.addLayer()`.                                                                 |

### StreetLightsRoads

```typescript
type StreetLightsRoads = StreetLightsSource &
  RoadsReading & {
    polyline?: NonNullable<VectorLayer["polyline"]>;
  };
```

| Property   | Type                                   | Default | Description                                                                                                       |
| ---------- | -------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `polyline` | `NonNullable<VectorLayer["polyline"]>` | `{}`    | The road surface's material, as `polyline` in `view.addLayer()`. The plugin sets each feature's `show` and `width`. |

The reader comes from [`RoadsReading`](#roadsreading).

### RoadsReading

```typescript
type RoadsReading = {
  evaluateFeature: RoadReader;
  filterFeatureProperties?: string[];
};
```

| Property                  | Type         | Default | Description                                                                                                       |
| ------------------------- | ------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `evaluateFeature`         | `RoadReader` |         | Reads one road feature: its [`RoadClass`](#roadclass) and direction. See [`RoadReader`](#roadreader).            |
| `filterFeatureProperties` | `string[]`   | all     | Properties `evaluateFeature` needs. It sees only these, both on the road surface and when the lamps and cars are placed, so list every name it reads. Without a list it sees every property, and the road surface reads them all on each evaluation. |

### StreetLightsBuildings

```typescript
type StreetLightsBuildings = StreetLightsSource & {
  evaluateFeature: BuildingReader;
};
```

`evaluateFeature` reads one building feature: its roof height, or `undefined` for no beacon. See [`BuildingReader`](#buildingreader).

### RoadReader

```typescript
type RoadReader = (
  properties: Record<string, unknown>,
) => { roadClass: RoadClass; oneway?: Oneway } | undefined;

type Oneway = 1 | -1 | 0;
```

Reads one road feature's properties: the [`RoadClass`](#roadclass) it is drawn and lit as, and its direction (`1` forward only, `-1` backward only, `0` both ways, the default), or `undefined` for a feature that carries no lights. A tile set with its own road kinds maps them onto these classes:

```typescript
import type { RoadReader } from "@navaramap/three-plugins";

const read: RoadReader = ({ highway }) =>
  highway === "main"
    ? { roadClass: "primary" }
    : highway === "local"
      ? { roadClass: "minor" }
      : undefined;

// Given to `start()` as `roads: { ..., filterFeatureProperties: ["highway"], evaluateFeature: read }`.
```

### BuildingReader

```typescript
type BuildingReader = (properties: Record<string, unknown>) => number | undefined;
```

Reads one building feature's properties: the height of its roof in meters above the ellipsoid, or `undefined` for a building without a beacon. The beacon sits 2 m above that height and is not clamped to the ground, so for buildings standing on terrain, add the ground height. A roof height taken from the tile set as it is, such as OpenMapTiles `render_height`, matches buildings extruded from the ellipsoid.

### RoadClass

```typescript
type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "minor"
  | "service";
```

The road classes the plugin knows, from motorways down to service roads. Each has a fixed road surface width, lamp spacing and traffic density, wider and denser toward `motorway`. A reader for another tile set maps its own road kinds onto these.

### isRoadClass(value)

```typescript
isRoadClass(value: unknown): value is RoadClass
```

Whether a tile value names a [`RoadClass`](#roadclass), for a reader that passes a property through, as the OpenMapTiles `class` in the example above. Own keys only: a value named like an `Object.prototype` member is not a road.

### StreetLightsPart

```typescript
type StreetLightsPart = "roads" | "lamps" | "beacons" | "traffic";
```

A part of the street-level detail that [`setVisible()`](#setvisiblevisible-part) can hide on its own.

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
- **Credits come from the sources.** A `tilejson` source shows the attribution its document declares, for the roads and the buildings alike. For a `vector-tile` source, add the data's credit to `view.attribution` yourself.
- **Render every frame.** The cars move with the view's clock, so construct the view with `animation: true`.
- **Zoom 14 only.** The plugin reads the zoom 14 tiles whatever the camera's zoom, so `radius` is in those tiles, about 2 km across at Tokyo's latitude.

## Related Resources

- [About](../about/): Overview of three_plugins
- [TileJsonPlugin](../tilejsonplugin/): The resolver behind `tilejson` sources
- [Vector Layer](../../three/layer/vector-layer/): The layer type behind the roads, lamps and beacons
- [SelectiveBloomEffectDesc](../../three_default_descs/effect-desc/selective-bloom-effect-desc/): The bloom the lamps and beacons take part in
- [Night City](https://navara.world/examples/showcase/night-city): A showcase built on this plugin
