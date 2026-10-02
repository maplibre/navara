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

### backfaceCulling

**Type:** `boolean | undefined`

**Description:** 裏側から見たときにビルボードを非表示にするかどうかを指定します。`false` の場合はビルボードの両面を描画し、`true` の場合は表側のみを描画します。

カメラに追従して立っているビルボード（デフォルト）は常に表側が見えるため、影響はありません。影響があるのは次の 2 つの場合です。[`rotateWithCamera`](#rotatewithcamera) が `false` のビルボードは裏側から見えることがあり、その場合は左右反転して表示されますが、この設定を有効にすると非表示になります。[`billboardFacing`](#billboardfacing) が `"flat"` のビルボードは地球の外側を表側としているため、この設定を有効にすると、大きなビルボードのうち地平線の向こう側に回り込んだ部分も非表示になります。

**Default:** `false`

**Example:**

```typescript
{
  billboard: {
    billboardFacing: "flat",
    backfaceCulling: true
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

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めると、デフォルトではラインの頂点ごとに 1 つのビルボードを描画します。ラインに沿って繰り返し配置するには [`placement`](#placement) を指定してください。`"polygon"` を含めるとポリゴンリングの頂点ごとに 1 つのビルボードを描画します（リングを閉じる重複頂点はスキップされます）。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

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

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** ラインジオメトリ上でのビルボードの配置方法を指定します。[`geometryTypes`](#geometrytypes) に `"line"` が含まれる場合のみ有効です。ポイントジオメトリは常にその地点に、ポリゴンリングは常に頂点ごとにビルボードが配置されます。

- `"point"`：ラインの頂点ごとに 1 つのビルボードを配置します。
- `"line"`：[`spacing`](#spacing) ごとにラインに沿ってビルボードを繰り返し配置します。ラインの頂点の位置に関係なく等間隔になります。
- `"line-center"`：各ラインの長さの中間点に 1 つのビルボードを配置します。

`"line"` と `"line-center"` では、各ビルボードは配置された位置でのラインの向きにも回転します（[`rotateToLine`](#rotatetoline) を参照）。

このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` では読み込み済みのビルボードは再構築されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `"point"`

**Example:**

```typescript
{
  billboard: {
    url: "/icons/arrow.png",
    geometryTypes: ["line"],
    placement: "line",
    spacing: 120, // 画面上のピクセル
    billboardFacing: "flat",
    rotateWithCamera: false, // 矢印を地表に寝かせ、ラインに沿った向きにする
    clampToGround: true
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

### billboardFacing

**Type:** `"upright" | "flat" | undefined`

**Description:** ビルボードを立てて表示するか、地球表面に寝かせて表示するかを指定します。`"upright"` は立てた状態に保ちます。`"flat"` はアンカー位置の周辺で地球の曲率に沿って地表に配置するため、地表に描かれているように見え、カメラのピッチに応じて短縮されます。

[`rotateWithCamera`](#rotatewithcamera) との組み合わせで、次の 4 通りの表示になります。

| `billboardFacing` | `rotateWithCamera` | 表示 |
| --- | --- | --- |
| `"upright"` | `true` | 画面に正対するビルボード。短縮されません（デフォルト） |
| `"upright"` | `false` | 地表に立ち、方位は固定されます |
| `"flat"` | `true` | 地表に描かれ、常に視点の方を向くように回転します |
| `"flat"` | `false` | 地表に描かれ、北を上にして地図とともに回転します |

[`FeatureEvaluator`](../../api/feature-evaluator/) から `facing` として地物ごとに指定することもできます。

**Default:** `"upright"`

**Example:**

```typescript
{
  billboard: {
    billboardFacing: "flat"
  }
}
```

### rotateToLine

**Type:** `boolean | undefined`

**Description:** ライン沿いに配置したビルボードをラインに合わせて回転させるかどうかを指定します。`true` の場合、アンカー位置でのラインの向きを方位角として [`rotation`](#rotation) に加算します。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用されます。

加算される方位角は、ビルボードが地表に固定されているときに地図上の向きとして意味を持つため、`billboardFacing: "flat"` と `rotateWithCamera: false` と組み合わせてください。画像の上端がラインの進行方向を向き、`rotation` でそこからさらに回転させられます。カメラに追従するビルボードでは、方位角は画面上で画像を回転させるだけです。

このオプションはジオメトリ構築時に適用されます。`layer.update()` では読み込み済みのビルボードには反映されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
    geometryTypes: ["line"],
    placement: "line",
    billboardFacing: "flat",
    rotateWithCamera: false,
    rotateToLine: true,
    rotation: 90 // ラインの進行方向の右側を向ける
  }
}
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** ビルボードをカメラに追従して回転させるかどうかを指定します。`true` の場合は常に視点の方を向きます。`false` の場合はアンカー位置のローカルな東・北・上の座標系に固定され、カメラを動かしても向きは変わりません。`"upright"` では地表に立って南を向くため、真上から見ると縁しか見えずに消え、裏側からは鏡像になります。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定することもできます。

**Default:** `true`

**Example:**

```typescript
{
  billboard: {
    billboardFacing: "upright",
    rotateWithCamera: false
  }
}
```

### rotation

**Type:** `number | undefined`

**Description:** ビルボードを自身の平面内で、アンカー位置を中心に回転させる角度を度数で指定します。正面から見て時計回りです。回転は [`billboardFacing`](#billboardfacing) と [`rotateWithCamera`](#rotatewithcamera) で決まる向きに対して追加で適用されます。

回転の中心がビルボードのどこになるかは [`center`](#center) で決まります。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定できるため、レイヤー内のビルボードごとに異なる向きにできます。

**Default:** `0.0`

**Example:**

```typescript
{
  billboard: {
    rotation: 45
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

### spacing

**Type:** `number | undefined`

**Description:** [`placement`](#placement) が `"line"` のときに繰り返し配置するビルボードの間隔を、画面上のピクセルで指定します。単位は `geojson` ソースでも `vector-tile` ソースでも同じです。

ライン上に表示するビルボードは、カメラの移動に合わせて決め直されます。カメラを引くとビルボードは間引かれ、近づくと間にビルボードが追加されます。ビルボードがラインに沿って移動することはなく、表示されるか消えるかのどちらかです。画面上の間隔は `spacing` の 1〜2 倍に保たれます。これは傾けた視点でも同様で、画面の手前側と奥側でそれぞれの密度になります。

ラインの中間点のビルボードは常に残り、画面上で `spacing` より短いラインにはそのビルボードだけが配置されます。GeoJSON ソースで地表にごく近づいた場合（ストリートレベル）や、ベクタータイルが自身のズームレベルよりかなり深く表示されている場合（オーバーズーム）は、ビルボードがそれ以上追加されなくなり、`spacing` より広い間隔になります。

MapLibre の `symbol-spacing` と同様に、`spacing` の 4 分の 3 より幅の広いビルボードは、繰り返しの間隔が「ビルボードの幅 + `spacing` の 4 分の 1」に広がります。また、ベクタータイルソースでは、各タイルは自身の範囲内にだけビルボードを配置します。間隔はタイルごとに決まるため、`spacing` をどれだけ大きくしても、繰り返しの間隔はおよそ 1 タイル分（画面上で 512〜1024 ピクセル）までになります。

このオプションはジオメトリ構築時に適用されます。`layer.update()` では読み込み済みのビルボードは再構築されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `250.0`

**Example:**

```typescript
{
  billboard: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 120
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
