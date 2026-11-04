---
title: StreetLightsPlugin
description: Street lamps, roof beacons and moving traffic at night, streamed in around the camera from vector tiles.
sidebar:
  order: 4
---

## Overview

`StreetLightsPlugin` turns a vector tile set of roads and buildings into a city at night. `addRoads()` takes a polyline layer over the road centerlines as the road surfaces and hides every feature without lights. `start()` then streams the zoom 14 tiles of the same tile set in around the position given to `follow()`, and places street lamps along every road, a red beacon on every tall roof, and cars that drive along the road segments.

The plugin fetches those tiles a second time. The engine decodes them for rendering but exposes no feature geometry. The tiles are read through the `roads` and `buildings` options, which default to the OpenMapTiles schema: `transportation` features with `class` and `oneway`, and `building` features with `render_height`. Another schema needs its own [`RoadReader`](#roadreader) and [`BuildingReader`](#buildingreader).

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

// Dark road surfaces; the plugin hides every class that carries no lights.
const roads = view.addLayer({
  type: "vector",
  source: streets,
  sourceLayers: ["transportation"],
  polyline: { color: new Color().setStyle("#15171c"), clampToGround: true },
});
streetLights.addRoads(roads);
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
| `roads`         | `StreetLightsRoads`    | `{}`    | Which tile layer holds the roads and how to read them. See [`StreetLightsRoads`](#streetlightsroads).                        |
| `buildings`     | `StreetLightsBuildings` | `{}`   | Which tile layer holds the buildings and how to read them. See [`StreetLightsBuildings`](#streetlightsbuildings).            |

## Methods

### addRoads(layer)

```typescript
addRoads(layer: Layer): void
```

Takes a [vector layer](../../three/layer/vector-layer/) with a `polyline` material over the road centerlines as the road surfaces. Every feature the road reader skips, such as rail and paths, is hidden. The rest get the width of their [`RoadClass`](#roadclass), and follow `setVisible()`. The layer's own material gives the color and the clamping. The layer stays yours to delete. While the plugin holds it, its per-feature `show` and `width` are the plugin's, so another evaluator on the same layer competes with it. Giving the same layer again does nothing. Features the layer already holds are evaluated again on the next frame. The layer must show only the tile layer named by `roads.layer` (`transportation` by default), so give it `sourceLayers` with that same name (`["transportation"]` by default): the lamps and cars come from those roads, and other line layers can carry the same properties (OpenMapTiles `transportation_name` does) and would be drawn as roads too. Must be called **after** `view.init()`. Otherwise the call throws.

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

Drops every layer, source and mesh the plugin added, stops the tiles still loading, and detaches from the road layers given to `addRoads()`. Those layers stay yours. The `show` and `width` the plugin already set stay on their features, since Navara cannot clear evaluated values, so delete the layer or evaluate it again yourself. The plugin cannot be used again afterwards.

## Types

### StreetLightsConfig

```typescript
type StreetLightsConfig = {
  radius?: number;
  traffic?: StreetTrafficOptions;
  roads?: StreetLightsRoads;
  buildings?: StreetLightsBuildings;
};
```

The constructor options. See [Constructor](#constructor).

### StreetLightsRoads

```typescript
type StreetLightsRoads = { layer?: string } & (
  | { read?: undefined; properties?: undefined }
  | { read: RoadReader; properties?: string[] }
);
```

| Property     | Type         | Default            | Description                                                                                                                      |
| ------------ | ------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `layer`      | `string`     | `"transportation"` | Tile layer holding the road centerlines.                                                                                         |
| `read`       | `RoadReader` | OpenMapTiles       | Reads one road feature. The default reads `class` as the [`RoadClass`](#roadclass) and reads `oneway`.                                  |
| `properties` | `string[]`   | see description    | Properties a custom `read` needs, given only together with it. The reader sees only these, both on the road layer and when the lamps and cars are placed, so list every name it reads. Without a list it sees every property, and the road layer reads them all on each evaluation. The default reader brings its own list. |

### StreetLightsBuildings

```typescript
type StreetLightsBuildings = {
  layer?: string;
  read?: BuildingReader;
};
```

| Property | Type             | Default      | Description                                                                                  |
| -------- | ---------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `layer`  | `string`         | `"building"` | Tile layer holding the building footprints.                                                  |
| `read`   | `BuildingReader` | OpenMapTiles | Reads one building feature. The default takes `render_height` and gives a beacon from 90 m up. |

### RoadReader

```typescript
type RoadReader = (
  properties: Record<string, unknown>,
) => { roadClass: RoadClass; oneway?: Oneway } | undefined;

type Oneway = 1 | -1 | 0;
```

Reads one road feature's properties: the [`RoadClass`](#roadclass) it is drawn and lit as, and its direction (`1` forward only, `-1` backward only, `0` both ways, the default), or `undefined` for a feature that carries no lights. A tile set with its own road kinds maps them onto these classes:

```typescript
import { StreetLightsPlugin } from "@navaramap/three-plugins";

const streetLights = new StreetLightsPlugin({
  roads: {
    layer: "roads",
    properties: ["highway"],
    read: ({ highway }) =>
      highway === "main"
        ? { roadClass: "primary" }
        : highway === "local"
          ? { roadClass: "minor" }
          : undefined,
  },
});
```

### BuildingReader

```typescript
type BuildingReader = (properties: Record<string, unknown>) => number | undefined;
```

Reads one building feature's properties: the height of its roof in meters above the ellipsoid, or `undefined` for a building without a beacon. The beacon sits 2 m above that height and is not clamped to the ground, so for buildings standing on terrain, add the ground height. The default reader returns OpenMapTiles `render_height` as it is, which matches buildings extruded from the ellipsoid.

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

The road classes the plugin knows, named after OpenMapTiles `transportation` classes from motorways down to service roads. Each has a fixed road surface width, lamp spacing and traffic density, wider and denser toward `motorway`. A reader for another tile set maps its own road kinds onto these.

### StreetLightsStartOptions

```typescript
type StreetLightsStartOptions = {
  tileTemplate: string;
  effectIds?: string[];
};
```

| Property       | Type       | Default | Description                                                                                     |
| -------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------- |
| `tileTemplate` | `string`   |         | A `{z}/{x}/{y}` tile URL of the tile set the road layer shows, as listed in its TileJSON document. |
| `effectIds`    | `string[]` | `[]`    | Selective effects the lamps and beacons take part in, such as a bloom.                           |

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
- **The tiles count against the same credit as the source.** The plugin fetches the tiles from the template of the tile set the source shows, so the attribution the source carries covers them.
- **Render every frame.** The cars move with the view's clock, so construct the view with `animation: true`.
- **Zoom 14 only.** The plugin reads the zoom 14 tiles whatever the camera's zoom, so `radius` is in those tiles, about 2 km across at Tokyo's latitude.

## Related Resources

- [About](../about/): Overview of three_plugins
- [TileJsonPlugin](../tilejsonplugin/): Reading the tile URL template from a TileJSON document
- [Vector Layer](../../three/layer/vector-layer/): The layer type behind the roads, lamps and beacons
- [SelectiveBloomEffectDesc](../../three_default_descs/effect-desc/selective-bloom-effect-desc/): The bloom the lamps and beacons take part in
- [Night City](https://navara.world/examples/showcase/night-city): A showcase built on this plugin
