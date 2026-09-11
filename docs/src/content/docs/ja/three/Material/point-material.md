---
title: PointMaterial
description: Point material for navara_three
sidebar:
  order: 530
---

`PointMaterial`は、ポイントジオメトリレンダリング用のマテリアルを表します。

## Properties

### center

**Type:** `{ x: number, y: number }`

**Description:** 中心からのシフト量を指定します。範囲は 0 から 1 の間です。単位は、ポイントの丸に対する相対位置です。

**Default:** Required

**Example:**

```typescript
{
  point: {
    center: { x: 0.5, y: 0.5 }
  }
}
```

### clampToGround

**Type:** `boolean`

**Description:** 地面に張り付けるかどうかを指定します。

**Default:** Required

**Example:**

```typescript
{
  point: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color`

**Description:** ポイントの色を`Color`インスタンスで指定します。

**Default:** Required

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  point: {
    color: new Color().setHex(0xff0000)
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
  point: {
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
  point: {
    declutter: true,
    declutterPriority: 1
  }
}
```

### depthTest

**Type:** `boolean | undefined`

**Description:** 前面のモデルが背面のモデルを隠すかどうかを決定する変数です。

**Default:** `true`

**Example:**

```typescript
{
  point: {
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
  point: {
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
  point: {
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
  point: {
    emissiveIntensity: 0.5
  }
}
```

### geometryTypes

**Type:** `("point" | "line" | "polygon")[] | undefined`

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めるとラインの頂点ごとに、`"polygon"` を含めるとポリゴンリングの頂点ごとに 1 つのポイントを描画します（リングを閉じる重複頂点はスキップされます）。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

**Default:** `["point"]`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["point", "polygon"]
  }
}
```

### height

**Type:** `number`

**Description:** 高さを指定します。単位はメートルです。

**Default:** Required

**Example:**

```typescript
{
  point: {
    height: 100 // 100メートル
  }
}
```

### offsetDepth

**Type:** `boolean | undefined`

**Description:** 地球表面との重なりを回避します。ポイントが地球表面にめり込まないようにする場合に使用します。

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    offsetDepth: true
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** ポイントの不透明度を指定します。有効範囲は 0.0（完全に透明）から 1.0（完全に不透明）です。

**Default:** `1.0`

**Example:**

```typescript
{
  point: {
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
  point: {
    sizeInMeters: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** ポイントを表示するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    show: true
  }
}
```

### size

**Type:** `number`

**Description:** ポイントのサイズを指定します。単位はメートルです。

**Default:** Required

**Example:**

```typescript
{
  point: {
    size: 10 // 10メートル
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** ポイントの透過度を考慮するかどうかを指定します。true にするとエフェクトを有効にしたときにポイントがうまく表示されないことがあるので注意してください。

**Default:** `undefined`

**Example:**

```typescript
{
  point: {
    transparent: false
  }
}
```
