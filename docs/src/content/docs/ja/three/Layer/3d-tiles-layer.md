---
title: 3D Tiles Layer
description: 3d-tiles の Source（建物、点群、フォトグラメトリ）を描画する
sidebar:
  order: 440
---

`3d-tiles` レイヤーは、[`3d-tiles`](../../../three/source/3d-tiles-source/) の Source（3D Tiles 形式の大規模な 3D データセット。建物モデル、点群、フォトリアルなタイルなど）を、モデルの見た目で描画します。

## プロパティ

| プロパティ | 型                 | 説明                                 |
| -------- | ------------------ | ------------------------------------ |
| `type`   | `"3d-tiles"`       | レイヤータイプ（必須）。               |
| `source` | `Source \| string` | `3d-tiles` の Source（必須）。         |

### 描画オプション

| マテリアル                                                     | 設定キー   | 説明                           |
| ------------------------------------------------------------- | ---------- | ------------------------------ |
| [ModelMaterial](../../../three/material/model-material/) | `model`    | 3D モデルの見た目を制御します。 |

## 使用例

### 基本的なタイルセット

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView(/* options */);
await view.init();

const tileset = view.addSource({
  type: "3d-tiles",
  url: "https://example.com/tileset.json",
});

view.addLayer({
  type: "3d-tiles",
  source: tileset,
  model: { show: true, color: new Color().setHex(0xffffff), metalness: 0.1, roughness: 0.1 },
});
```

### Google Photorealistic 3D Tiles

```typescript
const tileset = view.addSource({
  type: "3d-tiles",
  url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${YOUR_GOOGLE_MAPS_API_KEY}`,
});

const layer = view.addLayer({ type: "3d-tiles", source: tileset, model: { maxSse: 30 } });
```

:::note
`Layer` ハンドルは `featureCreated` / `featureRemoved` / `featureVisibilityChanged` イベントを発行します。`featureCreated` は各タイルの credit を `content.credit` として含んでいます。Google Photorealistic 3D Tiles のような Source では、[利用規約](https://cloud.google.com/maps-platform/terms)で要求されるとおり、これらを使って帰属表示（アトリビューション）を表示してください。対応する仕様（b3dm、pnts、glTF 拡張）については [3D Tiles Source](../../../three/source/3d-tiles-source/) のページを参照してください。
:::

## 関連リソース

- [3D Tiles Source](../../../three/source/3d-tiles-source/): 対応形式と拡張
- [ModelMaterial](../../../three/material/model-material/): モデルの詳細設定
