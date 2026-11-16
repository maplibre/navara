---
title: MaterialSchemaPlugin
description: エンジンが受け付けるすべてのレイヤーマテリアルと、各レイヤーの現在のスタイルを、スタイル UI を作るための JSON として提供します。
sidebar:
  order: 8
since: 0.3.2
---

## 概要

`MaterialSchemaPlugin` は、レイヤーのマテリアルをプレーンな JSON で記述します。アプリケーションは、マテリアルのフィールドをハードコードせずに、独自のスタイルエディターを作れます。

- **スキーマ**: レイヤータイプごとのマテリアルと、各マテリアルのすべてのフィールドです。フィールドには種類、説明、エンジンのデフォルト値、受け付ける値、変更が反映されるタイミングが含まれます。
- **レイヤーのスタイル**: `describeLayer(layer)` は、同じフィールドにレイヤーが設定している値を加えて返します。

スキーマはエンジンのソースから生成されるため、インストールしたバージョンが受け付けるフィールドをそのまま並べます。[DevtoolsPlugin](../devtoolsplugin/) の Layers ツールは、このスキーマからスタイルフォームを作ります。

スキーマ自体は `@navaramap/material-schema` パッケージです。依存関係がないため、サーバーや地図のないアプリからも使えます。`@navaramap/three` と同じバージョンを使ってください。Navara のパッケージは同じバージョンでそろってリリースされ、新しいエンジンで追加されたフィールドは古いスキーマにはありません。両方をインストールしている場合、バージョンが異なるとパッケージマネージャーが警告します。

## 使い方

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
    // 例: "polygon color color true 16746496 live"
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

このスキーマで作ったフォームは、`layer.update()` で値を設定します。`color` フィールドは JSON では 16 進数の数値なので、`Color` に戻して渡します。

```typescript
layer.update({
  type: "vector",
  polygon: { color: new Color().setHex(0x00ff00), opacity: 0.5 },
});
```

スキーマだけならビューもエンジンも不要です。`@navaramap/material-schema` から `MATERIAL_SCHEMA` としてインポートします。

```typescript
import { MATERIAL_SCHEMA, materialField } from "@navaramap/material-schema";

MATERIAL_SCHEMA.version; // 記述している Navara のバージョン（例: "0.3.2"）
MATERIAL_SCHEMA.layers.raster; // ["raster", "hillshade", "elevationHeatmap"]
materialField("polygon", "clampToGround")?.applies; // "reload"
```

## コンストラクター

```typescript
new MaterialSchemaPlugin();
```

`view.init()` の**前に** `view.addPlugin()` でプラグインを登録してください。エンジンはレイヤーの設定を返さないため、プラグインは開始後に追加された各レイヤーの description を記録します。それより前に追加されたレイヤーの description は空です。

## プロパティ

### schema

**型:** [`MaterialSchema`](#materialschema)

**説明:** エンジンのソースから生成された、すべてのレイヤーマテリアルです。`@navaramap/material-schema` の `MATERIAL_SCHEMA` と同じオブジェクトです。

## メソッド

### describeLayer()

```typescript
describeLayer(layer: Layer): LayerStyle
```

レイヤーのマテリアルを、フィールドと現在の値とともにプレーンな JSON で返します。そのレイヤータイプが受け付けるすべてのマテリアルを、スキーマの順に並べます。`present` は、レイヤーの description がそのマテリアルを持っているかを示します。vector レイヤーは持っているマテリアルだけを描画し、その他のレイヤータイプは常に自分のマテリアルを描画します。[`LayerStyle`](#layerstyle) を参照してください。

値は、アプリが `addLayer()` と `layer.update()` で設定したもので、設定がなければエンジンのデフォルト値です。エンジンから読み戻した値ではありません。

### description()

```typescript
description(layer: Layer): LayerDescription
```

アプリが設定したとおりのレイヤーの設定を返します。`addLayer()` に渡した description に、すべての `layer.update()` を重ねたものです。一度も設定されていないフィールドは含まれません。`Source` は id として、terrain レイヤーの `ellipsoid` は `terrain` として保存されます。戻り値はコピーです。変更してもレイヤーは変わらないため、変更するには `layer.update()` を呼んでください。

### dispose()

```typescript
dispose(): void
```

レイヤーの description の記録を止めます。`view.dispose()` からも呼ばれます。複数回呼んでも安全です。

## 関数

`@navaramap/material-schema` がエクスポートします。

### materialField()

```typescript
materialField(key: string, name: string): MaterialField | undefined
```

マテリアル `key` のフィールド `name` を返します（例: `"polygon"`、`"opacity"`）。

## 型

`MaterialSchema`、`MaterialField`、`FieldKind`、`FieldApplies` は `@navaramap/material-schema` が、`LayerStyle` は `@navaramap/three-plugins` がエクスポートします。

### MaterialSchema

```typescript
type MaterialSchema = {
  version: string;
  layers: Record<string, string[]>;
  materials: Record<string, MaterialField[]>;
};
```

| プロパティ  | 型                                | 説明                                                                                                                                                         |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`   | `string`                          | スキーマが記述している Navara のバージョンです。対応する `@navaramap/three` のバージョンと同じです。                                                         |
| `layers`    | `Record<string, string[]>`        | レイヤーの `type` から、その description が受け付けるマテリアルのキーへの対応です。例: `vector` は `["point", "billboard", "text", "polyline", "polygon"]`。 |
| `materials` | `Record<string, MaterialField[]>` | マテリアルのキーから、そのフィールドへの対応です。ソースの順に並びます。                                                                                     |

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

| プロパティ | 型                              | 説明                                                                                                                         |
| ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `name`     | `string`                        | レイヤーの description でのフィールド名です。                                                                                |
| `kind`     | [`FieldKind`](#fieldkind)       | 値の種類です。                                                                                                               |
| `doc`      | `string \| undefined`           | フィールドの働きです。                                                                                                       |
| `default`  | `unknown`                       | フィールドが設定されていないときのエンジンの値です（JSON）。エンジンが他のフィールドやデータから導出する場合は含まれません。 |
| `options`  | `string[] \| undefined`         | `enum` と `enumList` フィールドが受け付ける値です。                                                                          |
| `applies`  | [`FieldApplies`](#fieldapplies) | 変更が反映されるタイミングです。                                                                                             |
| `note`     | `string \| undefined`           | 反映のタイミングについての補足です。例: `"reload"` のフィールドがすぐに反映される場合。                                      |

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

| 種類       | 値                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boolean`  | `true` または `false`。                                                                                                                                                         |
| `number`   | 数値。                                                                                                                                                                          |
| `color`    | レイヤーの description では `Color`。スキーマと `describeLayer()` では `0xff0000` のような 16 進数の数値。                                                                      |
| `enum`     | `options` のいずれか。                                                                                                                                                          |
| `enumList` | `options` のリスト。                                                                                                                                                            |
| `string`   | 任意の文字列。                                                                                                                                                                  |
| `point`    | `{ x: number, y: number }`。                                                                                                                                                    |
| `list`     | その他のリストや構造（JSON）。型付き配列は `describeLayer()` では通常の配列になります。戻すときは、レイヤーの description が宣言する型（`Float32Array` など）で渡してください。 |

### FieldApplies

```typescript
type FieldApplies = "live" | "reload" | "never";
```

| 値         | 意味                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"live"`   | `layer.update()` で設定するとすぐに反映されます。                                                                                                                                                                                      |
| `"reload"` | エンジンは、レイヤー、そのタイル、またはメッシュを作るときにだけ読みます。すでに描画済みのものは、レイヤーを削除して追加し直した後に変わります。ベクタータイルとタイル化されたレイヤーは、後から読み込むタイルにも新しい値を使います。 |
| `"never"`  | このレイヤータイプでは、エンジンは読みません。                                                                                                                                                                                         |

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

| プロパティ              | 型        | 説明                                                                                                      |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `LayerStyle.type`       | `string`  | レイヤーの `type` です。プラグインの開始前に追加されたレイヤーでは `""` です。                            |
| `MaterialState.key`     | `string`  | レイヤーの description でのマテリアルのキーです。例: `"polygon"`。                                        |
| `MaterialState.present` | `boolean` | description がそのマテリアルを持っているかどうかです。                                                    |
| `FieldState.set`        | `boolean` | レイヤーがそのフィールドを設定しているかどうかです。                                                      |
| `FieldState.value`      | `unknown` | レイヤーの値、なければ `default` です（JSON）。レイヤーが設定せず、エンジンが導出する場合は含まれません。 |

## 関連リソース

- [About](../about/): three_plugins の概要
- [DevtoolsPlugin](../devtoolsplugin/): このプラグインをもとにしたスタイルエディター
