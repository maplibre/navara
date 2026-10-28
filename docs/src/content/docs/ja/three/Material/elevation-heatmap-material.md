---
title: ElevationHeatmapMaterial
description: navara_three の標高ヒートマップマテリアル
sidebar:
  order: 590
---

`ElevationHeatmapMaterial` は、[`raster`](../../../three/layer/raster-layer/) レイヤー上で標高を色分けされたヒートマップとして可視化するための描画オプションを保持します。DEM タイルをデコードし、標高値に基づいてカラーマップを適用します。`elevationHeatmap` キーで設定します。

DEM タイルをデコードするため、[`raster-dem`](../../../three/source/raster-dem-source/) の Source が必要です。標高デコーダは、このマテリアルではなく Source から取得されます。

## ユースケース

- 地形の標高分布を視覚的に表現する
- 地形解析や山岳地帯の可視化
- 標高データの直感的な理解

## プロパティ

### colorMap

**型:** `Float32Array | undefined`

**デフォルト:** `undefined`

**説明:** このレイヤー用のカラールックアップテーブル。フラット化された RGBA の `Float32Array` で、[`ColorMap.flatten()`](../../../three/api/colormap/#flatten) で作成できます。省略した場合、標高はグレースケールで表示されます。配列の形式、色の配置（[`colorStops`](#colorstops) も参照）、実行時の変更方法は [ColorMap](../../../three/api/colormap/) を参照してください。

```typescript
import { ColorMap, Color } from "@navaramap/three";

const colorMap = new ColorMap("sequential", "Example", [
  new Color().setStyle("#ffffd9"),
  new Color().setStyle("#1d91c0"),
  new Color().setStyle("#081d58"),
]);

{
  elevationHeatmap: {
    colorMap: colorMap.flatten(),
    maxHeight: 3000,
  }
}
```

### colorStops

**型:** `Float32Array | undefined`

**デフォルト:** `undefined`

**説明:** `colorMap` の各エントリの標高（メートル）を昇順で指定します。エントリ `i` は正確に `colorStops[i]` の標高に描画され、2 つのストップの間の標高は両者の色を補間します。そのため、間隔が不均等なストップ（たとえば 0 m の急な海岸線）も正確な位置に保たれます。最初のストップより低い標高は最初の色、最後のストップより高い標高は最後の色で表示されます。指定している間、`minHeight`、`maxHeight`、`logarithmic` は色に影響しません。`colorMap` のエントリ数と同じ数の値が必要で、そうでない場合は警告を出して無視され、色は等間隔に配置されます。`colorStops` を含まない更新では現在のストップが維持されます。

```typescript
{
  elevationHeatmap: {
    // 海面下は濃い青、海岸は緑、3000 m で白
    colorMap: new Float32Array([
      0, 0.1, 0.4, 1,
      0, 0.6, 0.2, 1,
      1, 1, 1, 1,
    ]),
    colorStops: new Float32Array([-1000, 1, 3000]),
  }
}
```

### maxHeight

**型:** `number | undefined`

**デフォルト:** `1000`

**説明:** カラーマップの最大標高（メートル）。これを超える標高はカラーマップの最大色で表示されます。`colorStops` を指定している間は色に影響しません。

```typescript
{ elevationHeatmap: { maxHeight: 3000 } }
```

### minHeight

**型:** `number | undefined`

**デフォルト:** `0`

**説明:** カラーマップの最小標高（メートル）。これ以下の標高はカラーマップの最小色で表示されます。`colorStops` を指定している間は色に影響しません。

```typescript
{ elevationHeatmap: { minHeight: 0 } }
```

### logarithmic

**型:** `boolean | undefined`

**デフォルト:** `false`

**説明:** 対数スケールを使用するかどうか。低地と高地の範囲が大きい場合に、低地の微妙な標高差をより見やすくします。

```typescript
{ elevationHeatmap: { logarithmic: true } }
```

### logBoundary

**型:** `number | undefined`

**デフォルト:** `10`

**説明:** `logarithmic` が有効なときに、対数計算の基準として使用される境界値。`-logBoundary` から `logBoundary` までの標高は線形に、それ以外は対数でスケーリングされます。1 より大きい値である必要があり、1 以下の値は `10` として扱われます。

```typescript
{ elevationHeatmap: { logBoundary: 1000 } }
```

### filter

**型:** `string | undefined`

**デフォルト:** `"linear"`

**説明:** DEM のピクセル間の標高をどのようにサンプリングするかを `"linear"` または `"nearest"` で指定します。`"linear"` はデコードした標高を補間して色をなめらかに変化させ、`"nearest"` は最も近いピクセルを使うため、DEM の各ピクセルが単色のブロックとして表示されます。それ以外の値は `"linear"` として扱われます。

```typescript
{ elevationHeatmap: { filter: "nearest" } }
```

## 使用例

### 基本的な使い方

```typescript
import ThreeView, { TERRARIUM_ELEVATION_DECODER } from "@navaramap/three";

const view = new ThreeView({ container: document.getElementById("map") });
await view.init();

const dem = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrarium/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});

view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: { maxHeight: 3000, minHeight: 0 },
});
```

### 対数スケール

```typescript
view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: { maxHeight: 3000, minHeight: 0, logarithmic: true, logBoundary: 1000 },
});
```

### カラーマップのカスタマイズ

各レイヤーは独自のカラーマップを持つことができます。`colorMap` プロパティで定義します。

```typescript
import ThreeView, { ColorMap, Color, TERRARIUM_ELEVATION_DECODER } from "@navaramap/three";

const view = new ThreeView();
await view.init();

// ref: https://colorbrewer2.org/#type=diverging&scheme=RdYlBu&n=11
const rdYlBuColorMap = new ColorMap("diverging", "RdYlBu", [
  new Color().setStyle("#313695"),
  new Color().setStyle("#4575b4"),
  new Color().setStyle("#74add1"),
  new Color().setStyle("#abd9e9"),
  new Color().setStyle("#e0f3f8"),
  new Color().setStyle("#ffffbf"),
  new Color().setStyle("#fee090"),
  new Color().setStyle("#fdae61"),
  new Color().setStyle("#f46d43"),
  new Color().setStyle("#d73027"),
  new Color().setStyle("#a50026"),
]);

const dem = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrarium/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});

view.addLayer({
  type: "raster",
  source: dem,
  elevationHeatmap: {
    colorMap: rdYlBuColorMap.flatten(),
    maxHeight: 3000,
    minHeight: 0,
  },
});
```

## 関連リソース

- [Raster Layer](../../../three/layer/raster-layer/): このマテリアルの使い方
- [Raster DEM Source](../../../three/source/raster-dem-source/): DEM の Source とその標高デコーダ
- [ColorMap class](../../../three/api/colormap/): カラーマップの作成と管理
- [HillshadeMaterial](../../../three/material/hillshade-material/): DEM タイルから生成する陰影起伏
