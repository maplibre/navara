---
title: FeatureEvaluator
description: API Reference for FeatureEvaluator class
sidebar:
  order: 960
---

FeatureEvaluator は、地物データへのアクセスと、プロパティに基づいた地物の動的スタイリングを提供するクラスです。Layer の `featureCreated` および `featureUpdated` イベントを通じて取得できます。

このクラスを使用して以下のことができます：
- データソースから地物プロパティを読み取る
- プロパティに基づいて地物を動的にスタイリングする

:::note
イベントの詳細なパラメータ型については [Descriptor Types](../desc-types#events) を参照してください。
:::

## Properties

### id

**Type:** `FeatureSetId`

**Description:** このフィーチャーセットの一意な識別子を取得します。

**Example:**

```typescript
layer.on("featureCreated", ({ evaluator }) => {
  console.log("地物ID:", evaluator.id);
});
```

## Types

### FeatureInfo

```typescript
type FeatureInfo = {
  batchId: number;
  properties: Record<string, unknown> | undefined;
  layerId: string | undefined;
};
```

### FeatureEvaluatorCallback

```typescript
type FeatureEvaluatorCallback = (
  info: FeatureInfo,
) => Partial<EvaluatedValue>;
```

## Methods

### readFeatureProperties()

データソースからこの地物のプロパティを読み取ります。コールバックはこの地物内の各バッチに対して呼び出されます。

**Syntax:**

```typescript
readFeatureProperties(
  f: (info: FeatureInfo) => void
): void
```

**Parameters:**

- `f`: 各バッチの FeatureInfo オブジェクトを受け取るコールバック関数

**Example:**

```typescript
// すべてのプロパティをログ出力
evaluator.readFeatureProperties(({ batchId, properties }) => {
  console.log(`バッチ ${batchId}:`, properties);
});

evaluator.readFeatureProperties(({ properties }) => {
  const attributes = properties?.["attributes"] ?? {};
  const minHeight = attributes["minHeight"];
  const maxHeight = attributes["maxHeight"];
  console.log("高さ範囲:", minHeight, "-", maxHeight);
});
```

### readFilteredFeatureProperties()

データソースからこの地物の指定されたルートプロパティキーのみを読み取ります。少数のプロパティのみが必要な場合、`readFeatureProperties()` よりも効率的です。

**Syntax:**

```typescript
readFilteredFeatureProperties(
  keys: string[],
  f: (info: FeatureInfo) => void
): void
```

**Parameters:**

- `keys`: 読み取るルートプロパティキーの配列
- `f`: フィルタリングされたプロパティのみを含む FeatureInfo オブジェクトを受け取るコールバック関数

**Example:**

```typescript
evaluator.readFilteredFeatureProperties(["height", "name"], ({ batchId, properties }) => {
  console.log(`バッチ ${batchId}: height=${properties?.["height"]}, name=${properties?.["name"]}`);
});
```

### evaluate()

プロパティに基づいて地物に動的スタイルを評価・適用します。コールバックはこの地物内の各バッチ（サブ地物）に対して呼び出されます。

**Syntax:**

```typescript
evaluate(
  f: FeatureEvaluatorCallback,
  options?: {
    filters?: string[];
  }
): void
```

**Parameters:**

- `f`: FeatureInfo オブジェクトを受け取り、スタイル値を返すコールバック関数
- `options`: オプションの設定
  - `options.filters`: 読み取るルートプロパティキーの配列。指定した場合、一致するプロパティのみがコールバックに渡され、大規模なデータセットでのパフォーマンスが向上します。

**Returns:**

コールバック関数は以下のプロパティを含むオブジェクトを返すことができます：

| Property | Type | Description |
|----------|------|-------------|
| `color` | `Color` | 地物の色（`new Color()` を使用） |
| `show` | `boolean` | 地物の表示/非表示 |
| `height` | `number` | 地物の高さ（メートル） |
| `extrudedHeight` | `number` | ポリゴンの押し出し高さ（メートル） |
| `text` | `string` | ラベルテキストの内容（テキスト/ラベル地物用） |
| `width` | `number` | ライン幅（ピクセル、ポリライン地物用） |
| `dashArray` | `number[]` | ダッシュと隙間の長さ（線幅の倍数、ポリライン地物用）。空の配列を返すとその地物は実線になります。マテリアルの [`dashArray`](../../../three/material/polyline-material/#dasharray) を上書きします |
| `cap` | `"butt" \| "round" \| "square"` | 各ダッシュの端の形状（ポリライン地物用）。マテリアルの [`cap`](../../../three/material/polyline-material/#cap) を上書きします |
| `size` | `number` | ポイント/テキストサイズ（メートルまたはピクセル、ポイント/テキスト地物用） |
| `letterSpacing` | `number` | 文字間に追加する間隔（em 単位、テキスト地物用）。マテリアルの [`letterSpacing`](../../../three/material/text-material/#letterspacing) を上書きします |
| `opacity` | `number` | 地物の不透明度、範囲 0.0-1.0（ポリゴン/ポイント/ビルボード/モデル/テキスト用） |
| `declutterPriority` | `number` | デクラッターの配置優先度。値が大きいほど重なりの競合に勝ちます（[`declutter`](../../../three/material/text-material/#declutter) が有効なポイント/ビルボード/テキスト用）。レイヤーの `declutterPriority` を上書きします |
| `image` | `string \| null` | 画像の URL（ビルボード地物用）。個別の URL ごとに一度だけ読み込まれ、レイヤーのテクスチャアトラスにパックされます。`null` を返すと以前に設定した地物ごとの画像がクリアされ、ビルボードマテリアルのデフォルト `url` に戻ります（マテリアルに `url` がない場合、その地物は非表示になります） |
| `facing` | `"upright" \| "flat"` | ポイント、ビルボード、ラベルを画面と同じ平面に表示する（`"upright"`）か、地球表面に寝かせる（`"flat"`）か（ポイント/ビルボード/テキスト用）。マテリアルの `pointFacing`/`billboardFacing`/`textFacing` から決まる値を上書きします |
| `rotateWithCamera` | `boolean` | ポイント、ビルボード、ラベルをカメラに合わせて回転させる（`true`）か、地図に合わせて回転させる（`false`）か（ポイント/ビルボード/テキスト用）。ライン沿いでは、`false` でラベルがラインに沿い、`true` で `spreadGlyphs` を指定しない限りまっすぐ描かれます。マテリアルの `rotateWithCamera` から決まる値を上書きします |
| `spreadGlyphs` | `boolean` | ラベルをライン沿いに文字ごとに配置するか（ライン沿いに配置したテキスト用）。マテリアルの `spreadGlyphs` を上書きします。たとえば、ほかのラベルは文字ごとに配置するレイヤーで、筆記体のように文字がつながる文字体系やフォントのラベルだけを単語ごとに保てます |
| `rotation` | `number` | 平面内の回転角。単位は度で、正面から見て時計回りです（ポイント/ビルボード/テキスト用）。地物はアンカーを中心に回転しますが、ラインに沿うラベルでは各文字が自身の中心を軸に回転します。レイヤー内の地物ごとに異なる向きにできます。マテリアルの `rotation` を上書きします |
| `emissive` | `Color` | 発光色（バッチ化されたポリゴン/3D Tiles モデル/ポイント/ビルボード/テキスト用。batch/feature id を持たないモデルでは無視されます）。`emissiveIntensity` と組み合わせて Selective Bloom を駆動します。テキストではグリフの塗り部分のみが発光し、アウトラインと背景は発光しません |
| `emissiveIntensity` | `number` | 発光強度の乗数（バッチ化されたポリゴン/3D Tiles モデル/ポイント/ビルボード/テキスト用） |

:::note
評価されたスタイルはレイヤーのデフォルトスタイルを上書きします。
:::

地物ごとの `facing` と `rotateWithCamera` は、MapLibre の `"auto"` のようには解決されません。それぞれ、マテリアルで決まった向きのうち自身に対応する側だけを置き換えます。そのため、ポイントラベルで `rotateWithCamera: false` だけを返すと、ラベルは `"upright"` のままカメラの方位に合わせて回転します。北を上にして地表に描くには、`facing: "flat"` も返してください。

**Example:**

```typescript
import { Color } from "@navaramap/three";

// 3D Tiles の建物を高さで色分け
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const measuredHeight = properties?.["height"] as number;

    const color = (() => {
      if (measuredHeight < 30) return new Color().setStyle("#00ff00");
      if (measuredHeight < 60) return new Color().setStyle("#ffff00");
      if (measuredHeight < 90) return new Color().setStyle("#ff00ff");
      return new Color().setStyle("#ff0000");
    })();

    return {
      color,
      show: measuredHeight >= 30, // 低い建物を非表示
    };
  });
});
```

```typescript
// GeoJSON ポリゴンにプロパティベースの押し出しを適用
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const height = (properties?.["height"] as number) ?? 0;
    const extrudedHeight = (properties?.["extrudedHeight"] as number) ?? 0;

    return {
      height,
      extrudedHeight,
    };
  });
});
```

```typescript
// MVT 地物をカテゴリプロパティで色分け
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const category = properties?.["category"] as string;

    const color = (() => {
      if (category === "A") return "#0000ff";
      if (category === "B") return "#00ff00";
      return "#ff0000";
    })();

    return {
      color: new Color().setStyle(color),
    };
  });
});
```

```typescript
// テキストラベルのフィルタリングとスタイリング
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const text = properties?.["name"] as string;

    return {
      text,
      show: !!text,
    };
  });
});
```

```typescript
// プロパティに基づいて地物ごとのビルボード画像を設定
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      const icon = properties?.["icon"] as string | undefined;
      // icon を持たない地物にはビルボードマテリアルのデフォルト url が適用される。
      // `image: null` は以前に設定した画像のクリアにもなる
      return { image: icon ? `/icons/${icon}.svg` : null };
    },
    { filters: ["icon"] },
  );
});
```

```typescript
// featureClick イベントで選択した地物をハイライト
let selectedId: string | undefined;

// クリックで地物を選択
view.on("featureClick", (info) => {
  selectedId = info?.properties?.["id"] as string;
  layer.forceUpdate(); // スタイルを再評価
});

// 選択状態に基づいて色を変更
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(({ properties }) => {
    const id = properties?.["id"] as string;

    return {
      color: new Color().setHex(selectedId === id ? 0xff0000 : 0xffffff),
    };
  });
});
```

```typescript
// Selective Bloom でプロパティに応じて地物を発光させる
// （レイヤーのマテリアルの `effectIds` に bloom エフェクトを指定しておくこと）
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => ({
      emissive: new Color().setStyle("#7fd0ff"),
      emissiveIntensity: (properties?.["glow"] as number) ?? 0,
    }),
    { filters: ["glow"] },
  );
});
```

## EvaluatedValue Type

`evaluate()` コールバックから返すことができる型の定義：

```typescript
type EvaluatedValue = {
  /** 地物の色 */
  color?: Color;
  /** 地物の表示/非表示 */
  show?: boolean;
  /** ポリゴンの押し出し高さ（メートル） */
  extrudedHeight?: number;
  /** 地物の高さ（メートル） */
  height?: number;
  /** ラベルテキストの内容 */
  text?: string;
  /** ライン幅（ピクセル、ポリライン地物用） */
  width?: number;
  /** ポイント/テキストサイズ（メートルまたはピクセル、ポイント/テキスト地物用） */
  size?: number;
  /** 文字間に追加する間隔（em 単位、テキスト地物用）。マテリアルの
   * `letterSpacing` を上書きします */
  letterSpacing?: number;
  /** 地物の不透明度、範囲 0.0-1.0（ポリゴン/ポイント/ビルボード/モデル/テキスト用） */
  opacity?: number;
  /** デクラッターの配置優先度。値が大きいほど重なりの競合に勝ちます
   * （`declutter` が有効なポイント/ビルボード/テキスト用）。レイヤーの
   * `declutterPriority` を上書きします */
  declutterPriority?: number;
  /** 画像の URL（ビルボード地物用）。個別の URL ごとに一度だけ読み込まれ、
   * レイヤーのテクスチャアトラスにパックされます。`null` は以前に設定した
   * 地物ごとの画像をクリアし、ビルボードマテリアルのデフォルト url に戻します */
  image?: string | null;
  /** ポイント、ビルボード、ラベルを画面と同じ平面に表示する（"upright"）か、
   * 地球表面に寝かせる（"flat"）か（ポイント/ビルボード/テキスト用）。
   * マテリアルの facing 設定を上書きします */
  facing?: "upright" | "flat";
  /** ポイント、ビルボード、ラベルをカメラに合わせて回転させる（`true`）か、
   * 地図に合わせて回転させる（`false`）か（ポイント/ビルボード/テキスト用）。
   * ライン沿いでは、`false` でラベルがラインに沿います */
  rotateWithCamera?: boolean;
  /** ラベルをライン沿いに文字ごとに配置するか
   * （ライン沿いに配置したテキスト用） */
  spreadGlyphs?: boolean;
  /** 平面内の回転角。単位は度で、正面から見て時計回り
   * （ポイント/ビルボード/テキスト用）。ラインに沿うラベルでは各文字が
   * 自身の中心を軸に回転します */
  rotation?: number;
  /** 発光色（バッチ化されたポリゴン/3D Tiles モデル/ポイント/ビルボード/
   * テキスト用。batch/feature id を持たないモデルでは無視されます）。
   * `emissiveIntensity` と組み合わせて Selective Bloom を駆動します。
   * テキストではグリフの塗り部分のみが発光します */
  emissive?: Color;
  /** 発光強度の乗数（バッチ化されたポリゴン/3D Tiles モデル/ポイント/
   * ビルボード/テキスト用） */
  emissiveIntensity?: number;
};
```

:::tip[推奨]
`evaluate()` は変更したいプロパティのみを返してください。すべてのプロパティはオプショナルです。
:::
