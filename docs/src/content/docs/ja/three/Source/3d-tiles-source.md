---
title: 3D Tiles Source
description: 3d-tiles（3D Tiles タイルセット）の Source
sidebar:
  order: 360
---

`3d-tiles` Source は 3D Tiles タイルセット（`tileset.json` 階層）を指します。[`3d-tiles`](../../../three/layer/3d-tiles-layer/) レイヤーで描画します。

## プロパティ

| プロパティ | 型           | デフォルト | 説明                     |
| -------- | ------------ | ---------- | ------------------------ |
| `type`   | `"3d-tiles"` | （必須） | Source のタイプ。        |
| `url`    | `string`     | （必須） | `tileset.json` の URL。  |
| `crs`    | `string`     | —          | コンテンツの座標参照系。 |

## 対応仕様

### 3D Tiles 1.0

| タイルフォーマット             | 説明                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| b3dm (Batched 3D Model)        | 建物などのバッチ化された 3D モデル。                        |
| pnts (Point Cloud)             | 点群データ。[PNTS の属性](#pnts-の属性)を参照してください。 |
| Google Photorealistic 3D Tiles | Google Maps Platform が提供するフォトリアリスティックタイル。 |

### PNTS の属性

Navara が読み取るのは pnts の feature table の一部です。点の色は sRGB として扱われます。位置を `POSITION_QUANTIZED` でしか持たないタイルは描画されません。

| セマンティクス                    | 対応状況                                  |
| --------------------------------- | ----------------------------------------- |
| `POSITION`                        | ✅                                        |
| `POSITION_QUANTIZED`              | ❌                                        |
| `RTC_CENTER`                      | ✅                                        |
| `RGB`                             | ⚠️ Draco 圧縮されたタイルのみ             |
| `RGBA`                            | ⚠️ Draco 圧縮されたタイルのみ             |
| `RGB565`                          | ❌                                        |
| `CONSTANT_RGBA`                   | ❌                                        |
| `NORMAL` / `NORMAL_OCT16P`        | ❌                                        |
| `BATCH_ID` と batch table         | ❌                                        |
| `3DTILES_draco_point_compression` | ⚠️ `POSITION`、`RGB`、`RGBA` のみ         |

### 3D Tiles 1.1

| 機能                         | 説明                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| GLB コンテンツ               | GLB（バイナリ glTF）をコンテンツフォーマットとして使用するタイル。                          |
| GLB POINTS プリミティブ      | `mode: POINTS` の glTF メッシュを点群として描画（3D Tiles 1.1 の点群対応）。               |
| `EXT_mesh_features`          | glTF メッシュ内の FeatureId セットによるフィーチャー識別。                                  |
| `EXT_structural_metadata`    | glTF アセットに埋め込まれたプロパティテーブルによるフィーチャーごとのメタデータへのアクセス。 |
| `KHR_draco_mesh_compression` | Draco 圧縮されたメッシュデータのデコード。                                                  |
| `KHR_mesh_quantization`      | 量子化された頂点属性によるコンパクトな glTF アセットへの対応。                              |
| `EXT_meshopt_compression`    | meshopt 圧縮バッファのデコード。                                                            |

:::note
対応しているのは GLB（バイナリ glTF コンテナ）のコンテンツのみです。外部 `.bin` バッファを参照するプレーンな `.gltf` ファイルには未対応です。また Implicit tiling にも対応していないため、タイルセットは `tileset.json` で明示的なタイル階層を記述する必要があります。
:::

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
