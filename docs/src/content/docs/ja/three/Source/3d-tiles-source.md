---
title: 3D Tiles Source
description: 3d-tiles（3D Tiles タイルセット）の Source
sidebar:
  order: 360
---

`3d-tiles` Source は 3D Tiles タイルセット（`tileset.json` 階層）を指します。[`3d-tiles`](../../../three/layer/3d-tiles-layer/) レイヤーで描画します。

## プロパティ

| プロパティ | 型           | デフォルト | 説明                     |
| ---------- | ------------ | ---------- | ------------------------ |
| `type`     | `"3d-tiles"` | （必須）   | Source のタイプ。        |
| `url`      | `string`     | （必須）   | `tileset.json` の URL。  |
| `crs`      | `string`     | —          | コンテンツの座標参照系。 |

## 対応仕様

### 3D Tiles 1.0

Google Maps Platform の Google Photorealistic 3D Tiles に対応しています。コンテンツのフォーマットに対応していないタイルはスキップされ、タイルセットの残りはそのまま描画されます。

| タイルフォーマット                                    | 対応状況                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| b3dm (Batched 3D Model)                               | ⚠️ glTF 2.0 のペイロードのみ                                   |
| pnts (Point Cloud)                                    | ⚠️ feature table の一部のみ。[PNTS の属性](#pnts-の属性)を参照 |
| i3dm (Instanced 3D Model)                             | ❌                                                             |
| cmpt (Composite)                                      | ❌                                                             |
| 外部タイルセット（コンテンツとしての `tileset.json`） | ✅                                                             |

### PNTS の属性

Navara が読み取るのは pnts の feature table の一部です。点の色は sRGB として扱われます。色を持たないタイルはレイヤーの色で描画されます。点の alpha（`RGBA` や `CONSTANT_RGBA`）は、レイヤーの material で `transparent: true` を指定したときだけ適用されます。指定がなければ点は不透明で描画されます。半透明の点は並べ替えずにブレンドするため、点が重なる箇所では描画順によって結果が変わることがあります。

| セマンティクス                    | 対応状況                          |
| --------------------------------- | --------------------------------- |
| `POSITION`                        | ✅                                |
| `POSITION_QUANTIZED`              | ✅                                |
| `RTC_CENTER`                      | ✅                                |
| `RGB`                             | ✅                                |
| `RGBA`                            | ✅                                |
| `RGB565`                          | ✅                                |
| `CONSTANT_RGBA`                   | ✅                                |
| `NORMAL` / `NORMAL_OCT16P`        | ❌                                |
| `BATCH_ID` と batch table         | ❌                                |
| `3DTILES_draco_point_compression` | ⚠️ `POSITION`、`RGB`、`RGBA` のみ |

### 3D Tiles 1.1

| 機能                         | 説明                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| GLB コンテンツ               | GLB（バイナリ glTF）をコンテンツフォーマットとして使用するタイル。                            |
| glTF コンテンツ              | glTF（JSON 形式の `.gltf`）をコンテンツフォーマットとして使用するタイル。                     |
| GLB POINTS プリミティブ      | `mode: POINTS` の glTF メッシュを点群として描画（3D Tiles 1.1 の点群対応）。                  |
| `EXT_mesh_features`          | glTF メッシュ内の FeatureId セットによるフィーチャー識別。                                    |
| `EXT_structural_metadata`    | glTF アセットに埋め込まれたプロパティテーブルによるフィーチャーごとのメタデータへのアクセス。 |
| tileset のメタデータ         | tileset・タイル・コンテンツ・グループの `metadata`。[メタデータ](#メタデータ)を参照。         |
| `KHR_draco_mesh_compression` | Draco 圧縮されたメッシュデータのデコード。                                                    |
| `KHR_mesh_quantization`      | 量子化された頂点属性によるコンパクトな glTF アセットへの対応。                                |
| `EXT_meshopt_compression`    | meshopt 圧縮バッファのデコード。                                                              |

:::note
Implicit tiling には対応していないため、タイルセットは `tileset.json` で明示的なタイル階層を記述する必要があります。
:::

### タイルセットの機能

| 機能                                                            | 対応状況             |
| --------------------------------------------------------------- | -------------------- |
| `refine`（`ADD` / `REPLACE`）                                   | ✅                   |
| タイルの `transform`                                            | ✅                   |
| b3dm の `RTC_CENTER` と glTF の `CESIUM_RTC`                    | ✅                   |
| `data:` URI のコンテンツ                                        | ✅                   |
| タイルごとの複数のコンテンツ（`contents`）                      | ✅                   |
| 1.0 以前のタイルセット（`content.url`、旧形式の b3dm ヘッダー） | ✅                   |
| `viewerRequestVolume`                                           | ❌                   |
| `asset.gltfUpAxis`                                              | ⚠️ `Y`（既定値）のみ |

## メタデータ

Navara は tileset・タイル・コンテンツ・グループのメタデータを、3D Tiles 1.1 の core と 1.0 の `3DTILES_metadata` 拡張のどちらで書かれていても読み、各値を tileset の `schema` で解決します。`normalized`・`offset`・`scale` を適用し、`noData` の値はそのプロパティの `default`（なければ `null`）に置き換え、省略されたプロパティには `default` を補います。

- タイル・コンテンツ・グループのメタデータは、レイヤーの `featureCreated` イベントでフィーチャーセットごとに `content.metadata: { tile?, content?, group? }` として届きます（`content.type` は `"3d-tiles"`）。ビューの `featureClick` / `featureHover` / `featureEnter` イベントでも、ピックしたフィーチャーに同じ `content` が付きます。
- tileset のメタデータと schema は、読み込みごとに 1 回レイヤーの `tilesetLoaded` イベントで届き、その後も `layer.tileset` から読めます。

schema はルート tileset JSON 内に書かれている必要があります（`schemaUri` は取得しません）。CesiumJS と同じく、すべてのタイルはルート tileset の `schema` と `groups` で解決し、外部（ネストした）tileset の `schema` と `groups` は無視します。implicit tiling の subtree にあるメタデータは読みません。

```typescript
const layer = view.addLayer({ type: "3d-tiles", source: tileset });

layer.on("tilesetLoaded", ({ metadata }) => {
  console.log("Tileset metadata:", metadata?.properties);
});

view.on("featureClick", (info) => {
  const content = info?.content;
  if (content?.type === "3d-tiles") {
    console.log("Tile metadata:", content.metadata?.tile);
  }
});
```

## 使用例

```typescript
import ThreeView from "@navaramap/three";

const tileset = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});
view.addLayer({ type: "3d-tiles", source: tileset, model: { opacity: 1.0 } });
```

## 関連リソース

- [About Source](../../../three/source/about/)
- [ModelMaterial](../../../three/material/model-material/): 3D モデルの描画オプション
