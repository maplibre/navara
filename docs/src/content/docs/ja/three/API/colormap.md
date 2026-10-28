---
title: ColorMap Class
description: API Reference for ColorMap Class - カラーグラデーションを定義するクラス
sidebar:
  order: 980
---

`ColorMap` クラスは、標高ヒートマップなどで使用するカラーグラデーション（色の補間）を定義します。ルックアップテーブル（LUT）に基づいて、0.0〜1.0 の値を色に変換します。

## Constructor

```typescript
new ColorMap(type: ColorMapType, name: string, lut: LUT)
```

**Parameters:**

- `type`: カラーマップの種類
- `name`: カラーマップの名前（識別用）
- `lut`: カラールックアップテーブル（2色以上の配列）

**Example:**

```typescript
import { ColorMap, Color } from "@navaramap/three";

// ref: https://colorbrewer2.org/#type=sequential&scheme=YlGnBu&n=9
const ylGnBu = new ColorMap("sequential", "YlGnBu", [
  new Color().setStyle("#ffffd9"),
  new Color().setStyle("#edf8b1"),
  new Color().setStyle("#c7e9b4"),
  new Color().setStyle("#7fcdbb"),
  new Color().setStyle("#41b6c4"),
  new Color().setStyle("#1d91c0"),
  new Color().setStyle("#225ea8"),
  new Color().setStyle("#253494"),
  new Color().setStyle("#081d58"),
]);

// ref: https://colorbrewer2.org/#type=diverging&scheme=RdYlBu&n=11
const rdYlBu = new ColorMap("diverging", "RdYlBu", [
  new Color().setStyle("#a50026"),
  new Color().setStyle("#d73027"),
  new Color().setStyle("#f46d43"),
  new Color().setStyle("#fdae61"),
  new Color().setStyle("#fee090"),
  new Color().setStyle("#ffffbf"),
  new Color().setStyle("#e0f3f8"),
  new Color().setStyle("#abd9e9"),
  new Color().setStyle("#74add1"),
  new Color().setStyle("#4575b4"),
  new Color().setStyle("#313695"),
]);
```

## Types

### ColorMapType

カラーマップの種類を表す型です。

```typescript
type ColorMapType = "sequential" | "diverging";
```

- `"sequential"`: 連続的なカラーマップ（低→高への単方向グラデーション）
- `"diverging"`: 分岐カラーマップ（中央値を基準に両方向へのグラデーション）

### LUT

ルックアップテーブルの型です。色の配列として定義します。

```typescript
type ColorTuple = [number, number, number]; // [r, g, b] (0.0〜1.0)
type LUT = readonly (ColorTuple | Color)[];
```

各色は以下のいずれかの形式で指定できます：

- `[r, g, b]`: 0.0〜1.0 の範囲の RGB 値の配列
- `Color`: Color クラスのインスタンス

## Properties

### type

**Type:** `ColorMapType`

**Description:** カラーマップの種類（読み取り専用）。

### name

**Type:** `string`

**Description:** カラーマップの名前（読み取り専用）。

### lut

**Type:** `ColorTuple[]`

**Description:** 正規化されたカラールックアップテーブル。コンストラクタで渡された色は内部で `[r, g, b]` 形式に変換されます。

### count

**Type:** `number`

**Description:** LUT に含まれる色の数（読み取り専用）。

## Methods

### linear()

値に対応する補間色を取得します。

**Syntax:**

```typescript
linear(value: number): ColorTuple
```

**Parameters:**

- `value`: 0.0〜1.0 の範囲の値

**Returns:**

補間された `[r, g, b]` 色タプル

---

### quantize()

指定した数の均等に分割された色を取得します。

**Syntax:**

```typescript
quantize(count: number): ColorTuple[]
```

**Parameters:**

- `count`: 取得する色の数（2以上）

**Returns:**

均等に分割された色の配列

---

### ticks()

指定した範囲と数に基づいてティック値を生成します。

**Syntax:**

```typescript
ticks(range: [min: number, max: number], count: number): number[]
```

**Parameters:**

- `range`: 値の範囲 `[最小値, 最大値]`
- `count`: 希望するティック数

**Returns:**

ティック値の配列

---

### createImage()

カラーマップを Canvas 画像として生成します。凡例表示などに使用できます。

**Syntax:**

```typescript
createImage(): HTMLCanvasElement
```

**Returns:**

カラーマップを表す 1 ピクセル高さの Canvas 要素

---

### flatten()

GPU 用にカラーマップを `Float32Array` に変換します。標高ヒートマップレイヤーの `colorMap` プロパティを設定する際に使用します。

**Syntax:**

```typescript
flatten(): Float32Array
```

**Returns:**

アルファ値をすべて 1 にした、フラット化された RGBA 配列（長さ = LUT の色数 × 4）

**標高ヒートマップでの配列の扱い:**

- **レイアウト**: 各色は 4 つの値（`r, g, b, a`）で、それぞれ [0, 1] の範囲です。`flatten()` はアルファ値を常に 1 にします。半透明や透明の色が必要な場合は、`Float32Array` を自分で作成してください。
- **配置**: 色は `minHeight` から `maxHeight` まで等間隔に配置されます。[`colorStops`](../../../three/material/elevation-heatmap-material/#colorstops) を指定すると、各色を正確な標高に配置できます。
- **更新**: 新しい `colorMap` を `layer.update()` または `view.updateLayerById()` に渡します。`colorMap` を含まない更新では現在のカラーマップが維持され、`colorMap: undefined` を指定するとグレースケールに戻ります。

## 使用例

### 標高ヒートマップでの使用

```typescript
import ThreeView, {
  ColorMap,
  Color,
  TERRARIUM_ELEVATION_DECODER,
} from "@navaramap/three";

const view = new ThreeView({
  animation: true,
});

await view.init();

// ref: https://colorbrewer2.org/#type=diverging&scheme=Spectral&n=11
const spectralColorMap = new ColorMap("diverging", "Spectral", [
  new Color().setStyle("#9e0142"),
  new Color().setStyle("#d53e4f"),
  new Color().setStyle("#f46d43"),
  new Color().setStyle("#fdae61"),
  new Color().setStyle("#fee08b"),
  new Color().setStyle("#ffffbf"),
  new Color().setStyle("#e6f598"),
  new Color().setStyle("#abdda4"),
  new Color().setStyle("#66c2a5"),
  new Color().setStyle("#3288bd"),
  new Color().setStyle("#5e4fa2"),
]);

// カラーマップを使った標高ヒートマップレイヤーを追加
const demSource = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrain/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});
view.addLayer({
  type: "raster",
  source: demSource,
  elevationHeatmap: {
    colorMap: spectralColorMap.flatten(),
    maxHeight: 3000,
    minHeight: 0,
  },
});
```

### 動的なカラーマップ切り替え

```typescript
import ThreeView, { ColorMap, Color, TERRARIUM_ELEVATION_DECODER, type LayerDescription } from "@navaramap/three";

const view = new ThreeView();
await view.init();

// 複数のカラーマップを定義
const colorMaps = {
  // ref: https://colorbrewer2.org/#type=sequential&scheme=YlGnBu&n=9
  ylGnBu: new ColorMap("sequential", "YlGnBu", [
    new Color().setStyle("#ffffd9"),
    new Color().setStyle("#edf8b1"),
    new Color().setStyle("#c7e9b4"),
    new Color().setStyle("#7fcdbb"),
    new Color().setStyle("#41b6c4"),
    new Color().setStyle("#1d91c0"),
    new Color().setStyle("#225ea8"),
    new Color().setStyle("#253494"),
    new Color().setStyle("#081d58"),
  ]),

  // ref: https://colorbrewer2.org/#type=diverging&scheme=RdYlGn&n=11
  rdYlGn: new ColorMap("diverging", "RdYlGn", [
    new Color().setStyle("#a50026"),
    new Color().setStyle("#d73027"),
    new Color().setStyle("#f46d43"),
    new Color().setStyle("#fdae61"),
    new Color().setStyle("#fee08b"),
    new Color().setStyle("#ffffbf"),
    new Color().setStyle("#d9ef8b"),
    new Color().setStyle("#a6d96a"),
    new Color().setStyle("#66bd63"),
    new Color().setStyle("#1a9850"),
    new Color().setStyle("#006837"),
  ]),

  // ref: https://colorbrewer2.org/#type=diverging&scheme=BrBG&n=11
  brBG: new ColorMap("diverging", "BrBG", [
    new Color().setStyle("#543005"),
    new Color().setStyle("#8c510a"),
    new Color().setStyle("#bf812d"),
    new Color().setStyle("#dfc27d"),
    new Color().setStyle("#f6e8c3"),
    new Color().setStyle("#f5f5f5"),
    new Color().setStyle("#c7eae5"),
    new Color().setStyle("#80cdc1"),
    new Color().setStyle("#35978f"),
    new Color().setStyle("#01665e"),
    new Color().setStyle("#003c30"),
  ]),
};

const demSource = view.addSource({
  type: "raster-dem",
  url: "https://example.com/terrain/{z}/{x}/{y}.png",
  elevationDecoder: TERRARIUM_ELEVATION_DECODER(),
  maxZoom: 15,
});

const layerDef: LayerDescription = {
  type: "raster",
  source: demSource.id,
  elevationHeatmap: {
    colorMap: colorMaps.rdYlGn.flatten(),
    maxHeight: 3000,
    minHeight: 0,
  },
};

const layer = view.addLayer(layerDef);

// カラーマップを切り替える関数
function setColorMap(name: keyof typeof colorMaps) {
  if (layerDef.elevationHeatmap) {
    layerDef.elevationHeatmap.colorMap = colorMaps[name].flatten();
    view.updateLayerById(layer.id, layerDef);
  }
}

// 使用例
setColorMap("rdYlGn");
```

## 関連項目

- [Color クラス](../../../three/api/color/) - 色を表現するクラス
- [ElevationHeatmapMaterial](../../../three/material/elevation-heatmap-material/) - 標高ヒートマップレイヤーでカラーマップを使用
