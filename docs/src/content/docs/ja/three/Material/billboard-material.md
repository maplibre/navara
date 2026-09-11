---
title: BillboardMaterial
description: Billboard material for navara_three
sidebar:
  order: 510
---

`BillboardMaterial`は、ビルボードレンダリング用のマテリアルを表します。

## Properties

### alphaTest

**Type:** `number | undefined`

**Description:** 画像の RGBA の A が 閾値 以下の場合はそのピクセルをレンダリングしないようになります。

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    alphaTest: 0.5
  }
}
```

### center

**Type:** [`Vec2`](../../api/types/#vec2)

**Description:** 中心からのシフト量を指定します。範囲は 0 から 1 の間です。

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    center: { x: 0.5, y: 0.5 }
  }
}
```

### clampToGround

**Type:** `boolean`

**Description:** 地面に沿わせるかどうかを指定します。

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** ビルボードの色を`Color`インスタンスで指定します。

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  billboard: {
    color: new Color().setHex(0xffffff)
  }
}
```

### declutter

**Type:** `boolean | undefined`

**Description:** 画面空間でのデクラッター（重なり除去）に参加します。ラベルやスプライトが画面上で重なった場合、優先度の低いものが非表示になります。デフォルトで有効です。すべてのラベルを無条件に描画するには `false` を設定します。

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
    declutter: false
  }
}
```

### declutterPriority

**Type:** `number | undefined`

**Description:** デクラッターの配置優先度です。値が大きいほど重なりの競合に勝ちます。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。[`FeatureEvaluator.evaluate()`](../../api/feature-evaluator/#evaluate) で地物ごとに上書きできます。

**Default:** `0.0`

**Example:**

```typescript
{
  billboard: {
    declutter: true,
    declutterPriority: 1
  }
}
```

### depthTest

**Type:** `boolean`

**Description:** 前面のモデルが背面のモデルを隠すかどうかを決定する変数です。

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
    depthTest: true
  }
}
```

### effectIds

**Type:** `string[] | undefined`

**Description:** 適用する Selective Effect の ID を指定します（例: "bloom", "outline"）。SelectiveBloomEffectDesc や SelectiveOutlineEffectDesc と連携して使用します。

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    effectIds: ["bloom", "outline"]
  }
}
```

### emissiveColor

**Type:** `Color | undefined`

**Description:** 発光色を`Color`インスタンスで指定します。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  billboard: {
    emissiveColor: new Color().setHex(0xff0000)
  }
}
```

### emissiveIntensity

**Type:** `number | undefined`

**Description:** 発光の強度を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    emissiveIntensity: 0.5
  }
}
```

### geometryTypes

**Type:** `("point" | "line" | "polygon")[] | undefined`

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めるとラインの頂点ごとに、`"polygon"` を含めるとポリゴンリングの頂点ごとに 1 つのビルボードを描画します（リングを閉じる重複頂点はスキップされます）。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

**Default:** `["point"]`

**Example:**

```typescript
{
  billboard: {
    geometryTypes: ["point", "line"]
  }
}
```

### height

**Type:** `number`

**Description:** ビルボードの高さを指定します。単位はメートルです。

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    height: 100 // 100メートル
  }
}
```

### offsetDepth

**Type:** `boolean | undefined`

**Description:** 地球表面との重なりを回避します。ビルボードが地球表面にめり込まないようにする場合に使用します。

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    offsetDepth: true
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** ビルボードの不透明度を指定します。有効範囲は 0.0（完全に透明）から 1.0（完全に不透明）です。

**Default:** `1.0`

**Example:**

```typescript
{
  billboard: {
    transparent: true,
    opacity: 0.5 // 50%の不透明度
  }
}
```

### sizeInMeters

**Type:** `boolean | undefined`

**Description:** サイズをメートル単位で指定するかどうか。false の場合、サイズはピクセル単位です。

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
    sizeInMeters: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** ビルボードを表示するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    show: true
  }
}
```

### size

**Type:** `number`

**Description:** ビルボードのサイズを指定します。単位はメートルです。

**Default:** Required

**Example:**

```typescript
{
  billboard: {
    size: 10 // 10メートル
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** ビルボードの透過度を考慮するかどうかを指定します。true にするとエフェクトを有効にしたときにビルボードがうまく表示されないことがあるので注意してください。

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    transparent: false
  }
}
```

### url

**Type:** `string | undefined`

**Description:** オブジェクトの URL を指定します。画像ファイルをサポートします。これはレイヤー内のすべての地物に適用されるデフォルト画像です。[`FeatureEvaluator.evaluate()`](../../api/feature-evaluator/#evaluate) から `image` を返すことで、地物ごとに上書きできます。`image: null` を返すと、上書きした地物はこのデフォルトに戻ります。

**Default:** `undefined`

**Example:**

```typescript
{
  billboard: {
    url: "https://example.com/icons/marker.png"
  }
}
```

:::note
すべての画像を [`FeatureEvaluator`](../../api/feature-evaluator/) から指定する場合は、`url` を省略してください。その場合、地物は `image` が設定されるまで表示されず、`image: null` はデフォルトに戻すのではなく地物を非表示にします。
:::
