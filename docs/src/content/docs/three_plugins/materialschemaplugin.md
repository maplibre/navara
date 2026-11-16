---
title: MaterialSchemaPlugin
description: Every layer material the engine accepts, and each layer's current style, as JSON for building a style UI.
sidebar:
  order: 8
since: 0.3.2
---

## Overview

`MaterialSchemaPlugin` describes layer materials as plain JSON, so an application can build its own style editor without hard-coding the material fields.

- **The schema**: the materials each layer type takes, and every field of each material with its kind, documentation, engine default, accepted values, and when a change takes effect.
- **A layer's style**: `describeLayer(layer)` returns the same fields with the values the layer sets.

The schema is generated from the engine sources, so it lists exactly the fields the installed version accepts. The Layers tool of [DevtoolsPlugin](../devtoolsplugin/) builds its style form from it.

The schema itself is the package `@navaramap/material-schema`. It has no dependencies, so a server or an app without a map can use it too. Use the same version of it as of `@navaramap/three`: Navara packages are released together, and a field added in a newer engine is not in an older schema. When both are installed, the package manager warns if the versions differ.

## Usage

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { MaterialSchemaPlugin } from "@navaramap/three-plugins";

const view = new ThreeView({ container });

const materials = new MaterialSchemaPlugin();

view.addPlugin(new DefaultPlugin());
view.addPlugin(materials);
await view.init();

const source = view.addSource({
  type: "geojson",
  url: "https://example.com/buildings.geojson",
});
const layer = view.addLayer({
  type: "vector",
  source,
  polygon: { color: new Color().setHex(0xff8800) },
});

for (const material of materials.describeLayer(layer).materials) {
  for (const field of material.fields) {
    // e.g. "polygon color color true 16746496 live"
    console.log(
      material.key,
      field.name,
      field.kind,
      field.set,
      field.value,
      field.applies,
    );
  }
}
```

A form built from it sets a value with `layer.update()`. A `color` field is a hex number in the JSON, so pass it back as a `Color`:

```typescript
layer.update({
  type: "vector",
  polygon: { color: new Color().setHex(0x00ff00), opacity: 0.5 },
});
```

The schema alone needs no view or engine. Import it as `MATERIAL_SCHEMA` from `@navaramap/material-schema`:

```typescript
import { MATERIAL_SCHEMA, materialField } from "@navaramap/material-schema";

MATERIAL_SCHEMA.version; // the Navara version it describes, e.g. "0.3.2"
MATERIAL_SCHEMA.layers.raster; // ["raster", "hillshade", "elevationHeatmap"]
materialField("polygon", "clampToGround")?.applies; // "reload"
```

## Constructor

```typescript
new MaterialSchemaPlugin();
```

Register the plugin with `view.addPlugin()` **before** `view.init()`. It records the description of each layer added after it starts, because the engine does not report a layer's settings back. A layer added before that has an empty description.

## Properties

### schema

**Type:** [`MaterialSchema`](#materialschema)

**Description:** Every layer material, generated from the engine sources. The same object as `MATERIAL_SCHEMA` from `@navaramap/material-schema`.

## Methods

### describeLayer()

```typescript
describeLayer(layer: Layer): LayerStyle
```

Returns the layer's materials with their fields and current values as plain JSON. It lists every material the layer type takes, in schema order. `present` tells whether the layer's description carries the material. A vector layer draws only the materials it carries, and the other layer types always draw theirs. See [`LayerStyle`](#layerstyle).

A value is the one the app set with `addLayer()` and `layer.update()`, else the engine default. It is not read back from the engine.

### description()

```typescript
description(layer: Layer): LayerDescription
```

Returns the layer's configuration as the app set it: the description passed to `addLayer()` with every `layer.update()` merged on top. Fields never set are absent. A `Source` is stored as its id, and a terrain layer's `ellipsoid` as `terrain`. The result is a copy: changing it does not change the layer, so call `layer.update()` for that.

### dispose()

```typescript
dispose(): void
```

Stops recording layer descriptions. `view.dispose()` calls it too. Calling it more than once is safe.

## Functions

Exported by `@navaramap/material-schema`.

### materialField()

```typescript
materialField(key: string, name: string): MaterialField | undefined
```

Returns the field `name` of the material `key` (e.g. `"polygon"`, `"opacity"`).

## Types

`MaterialSchema`, `MaterialField`, `FieldKind` and `FieldApplies` are exported by `@navaramap/material-schema`, and `LayerStyle` by `@navaramap/three-plugins`.

### MaterialSchema

```typescript
type MaterialSchema = {
  version: string;
  layers: Record<string, string[]>;
  materials: Record<string, MaterialField[]>;
};
```

| Property    | Type                              | Description                                                                                                                        |
| ----------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `version`   | `string`                          | The Navara version the schema describes, the same as the `@navaramap/three` version it matches.                                    |
| `layers`    | `Record<string, string[]>`        | Layer `type` to the material keys its description takes, e.g. `vector` to `["point", "billboard", "text", "polyline", "polygon"]`. |
| `materials` | `Record<string, MaterialField[]>` | Material key to its fields, in source order.                                                                                       |

### MaterialField

```typescript
type MaterialField = {
  name: string;
  kind: FieldKind;
  doc?: string;
  default?: unknown;
  options?: string[];
  applies: FieldApplies;
  note?: string;
};
```

| Property  | Type                            | Description                                                                                                             |
| --------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `name`    | `string`                        | The field name in the layer description.                                                                                |
| `kind`    | [`FieldKind`](#fieldkind)       | The value type.                                                                                                         |
| `doc`     | `string \| undefined`           | What the field does.                                                                                                    |
| `default` | `unknown`                       | The engine's value when the field is not set, as JSON. Absent when the engine derives it from other fields or the data. |
| `options` | `string[] \| undefined`         | The accepted values of an `enum` or `enumList` field.                                                                   |
| `applies` | [`FieldApplies`](#fieldapplies) | When a change takes effect.                                                                                             |
| `note`    | `string \| undefined`           | More on when the field applies, e.g. the cases where a `"reload"` field applies at once.                                |

### FieldKind

```typescript
type FieldKind =
  | "boolean"
  | "number"
  | "color"
  | "enum"
  | "enumList"
  | "string"
  | "point"
  | "list";
```

| Kind       | Value                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boolean`  | `true` or `false`.                                                                                                                                                            |
| `number`   | A number.                                                                                                                                                                     |
| `color`    | A `Color` in the layer description. A hex number such as `0xff0000` in the schema and in `describeLayer()`.                                                                   |
| `enum`     | One of `options`.                                                                                                                                                             |
| `enumList` | A list of `options`.                                                                                                                                                          |
| `string`   | Any string.                                                                                                                                                                   |
| `point`    | `{ x: number, y: number }`.                                                                                                                                                   |
| `list`     | Any other list or structure, as JSON. A typed array is a plain array in `describeLayer()`: pass it back with the type the layer description declares, such as `Float32Array`. |

### FieldApplies

```typescript
type FieldApplies = "live" | "reload" | "never";
```

| Value      | Meaning                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"live"`   | Applies as soon as `layer.update()` sets it.                                                                                                                                                                                      |
| `"reload"` | The engine reads it only when it builds the layer, its tiles or its meshes. What is already drawn changes after the layer is removed and added again. Vector tile and tiled layers also use the new value for tiles loaded later. |
| `"never"`  | The engine does not read it on this layer type.                                                                                                                                                                                   |

### LayerStyle

```typescript
type LayerStyle = {
  type: string;
  materials: MaterialState[];
};

type MaterialState = {
  key: string;
  present: boolean;
  fields: FieldState[];
};

type FieldState = MaterialField & {
  set: boolean;
  value?: unknown;
};
```

| Property                | Type      | Description                                                                                                  |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `LayerStyle.type`       | `string`  | The layer `type`. `""` for a layer added before the plugin started.                                          |
| `MaterialState.key`     | `string`  | The material key in the layer description, e.g. `"polygon"`.                                                 |
| `MaterialState.present` | `boolean` | Whether the description carries the material.                                                                |
| `FieldState.set`        | `boolean` | Whether the layer sets the field.                                                                            |
| `FieldState.value`      | `unknown` | The layer's value, else `default`, as JSON. Absent when the layer leaves it unset and the engine derives it. |

## Related Resources

- [About](../about/): Overview of three_plugins
- [DevtoolsPlugin](../devtoolsplugin/): A style editor built on this plugin
