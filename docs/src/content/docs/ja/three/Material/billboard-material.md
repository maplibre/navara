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

裏側がカメラから見えるのは、地表に寝かせたビルボード（[`billboardFacing`](#billboardfacing) を参照）だけです。地球の外側を表側としているため、この設定を有効にすると、大きなビルボードのうち地平線の向こう側に回り込んだ部分が非表示になります。`"upright"` のビルボードは常に画面と同じ平面で視点の方を向いているため、影響はありません。

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

### declutterPadding

**Type:** `number[] | undefined`

**Description:** スプライトの衝突判定ボックスの周囲に加える余白で、[`sizeInMeters`](#sizeinmeters) にかかわらず画面上のピクセル単位です。CSS の padding と同じく 1 〜 4 個の値で指定します（`[全辺]`、`[上下, 左右]`、`[上, 左右, 下]`、`[上, 右, 下, 左]`）。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。MapLibre の `icon-padding` に相当します。

**Default:** `[2]`

**Example:**

```typescript
{
  billboard: {
    declutterPadding: [4, 8]
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

### declutterRank

**Type:** `number | undefined`

**Description:** デクラッターの大まかな配置順で、[`declutterPriority`](#declutterpriority) より先に比較されます。ランクの高いマテリアルのスプライトは、優先度にかかわらず、ランクの低いラベルやスプライトより先に配置されます。そのため、地物ごとの `declutterPriority` は同じランクのラベルやスプライトの順序だけを入れ替えます。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。

**Default:** `0.0`

**Example:**

```typescript
{
  billboard: {
    declutterRank: 1
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

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めると、デフォルトではラインごとに 1 つのビルボードを、その最初の頂点に描画します。MapLibre がライン上の `symbol-placement: "point"` のアイコンを配置するのと同じです。ラインに沿って繰り返し配置するには [`placement`](#placement) を指定してください。`"polygon"` を含めるとポリゴンごとに 1 つのビルボードを、ポリゴン内部で辺から最も遠い地点に描画します（MultiPolygon は各パーツに 1 つずつ）。[`placement`](#placement) でリングに沿って配置することもできます。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

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

### ignorePlacement

**Type:** `boolean | undefined`

**Description:** このスプライトのボックスを衝突判定から外し、後から配置されるラベルやスプライトが重なれるようにします。このスプライト自体は、[`overlap`](#overlap) で許可しない限り、先に配置されたものと衝突すると非表示になります。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。MapLibre の `icon-ignore-placement` に相当します。

**Default:** `false`

**Example:**

```typescript
{
  billboard: {
    ignorePlacement: true
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

### overlap

**Type:** `"never" | "always" | "cooperative" | undefined`

**Description:** 先に配置されたラベルやスプライトの上にこのスプライトを重ねて描画できるかを指定します（[`declutterRank`](#declutterrank)、次に [`declutterPriority`](#declutterpriority) が大きいものから配置されます）。`"never"` はいずれかと衝突すると非表示にします。`"always"` は非表示にしません。そのボックスは、[`ignorePlacement`](#ignoreplacement) を設定しない限り、後から配置される `"never"` のものを遠ざけます。`"cooperative"` は `"never"` のものと衝突した場合にのみ非表示にします。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。MapLibre の `icon-overlap` に相当します。

**Default:** `"never"`

**Example:**

```typescript
{
  billboard: {
    overlap: "always"
  }
}
```

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** ラインおよびポリゴンジオメトリ上でのビルボードの配置方法を指定します。[`geometryTypes`](#geometrytypes) に `"line"` または `"polygon"` が含まれる場合のみ有効です。ポイントジオメトリは常にその地点にビルボードが配置されます。

- `"point"`：ラインごとにその最初の頂点に 1 つのビルボードを配置し、ポリゴンにはポリゴン内部で辺から最も遠い地点に 1 つのビルボードを配置します。ベクタータイルソースでは、最初の頂点がタイルの外にある（タイルで切られた）ラインには、そのタイルではビルボードを配置しません。
- `"line"`：[`spacing`](#spacing) ごとにラインに沿ってビルボードを繰り返し配置します。ラインの頂点の位置に関係なく等間隔になります。ポリゴンの境界リング（穴を含む）にも同じように沿って配置します。
- `"line-center"`：各ラインまたはポリゴンリングの長さの中間点に 1 つのビルボードを配置します。

`"line"` と `"line-center"` では、各ビルボードはアンカー位置に 1 枚の画像として配置され、その位置でのラインの向きに回転します（[`rotateToLine`](#rotatetoline) を参照）。[`billboardFacing`](#billboardfacing) と [`rotateWithCamera`](#rotatewithcamera) を指定しない場合は地表に寝かせて地図に合わせた向きになるため、矢印の画像はラインの進行方向を指します。

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

**Description:** ビルボードを画面と同じ平面に表示するか、地球表面に寝かせて表示するかを指定します。MapLibre の `icon-pitch-alignment` に相当します（`"upright"` が `"viewport"`、`"flat"` が `"map"`）。`"upright"` のビルボードは、カメラのピッチにかかわらず短縮されません。`"flat"` はアンカー位置の周辺で地球の曲率に沿って地表に配置するため、地表に描かれているように見え、カメラのピッチに応じて短縮されます。

[`rotateWithCamera`](#rotatewithcamera) との組み合わせで、次の 4 通りの表示になります。

| `billboardFacing` | `rotateWithCamera` | 表示 |
| --- | --- | --- |
| `"upright"` | `true` | 画面に正対するビルボード（`placement: "point"` でのデフォルト） |
| `"upright"` | `false` | 画面と同じ平面に表示され、カメラの方位に合わせて回転し、ビルボードの x 軸が東を向きます |
| `"flat"` | `true` | 地表に描かれ、常に視点の方を向くように回転します |
| `"flat"` | `false` | 地表に描かれ、北を上にして地図とともに回転します（ライン沿いでのデフォルト） |

[`FeatureEvaluator`](../../api/feature-evaluator/) から `facing` として地物ごとに指定することもできます。

**Default:** `"upright"`、`rotateWithCamera` が `false` の場合は `"flat"`（MapLibre の `"auto"`）

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

加算される方位角は、ビルボードが地図に合わせた向き（[`rotateWithCamera`](#rotatewithcamera) が `false`）のときに地図上の向きとして意味を持ちます。ライン沿いでのデフォルトのように地表に寝かせている場合は、画像の上端がラインの進行方向を向き、`rotation` でそこからさらに回転させられます。`"upright"` の場合は画面と同じ平面に表示され、カメラの方位とラインの方位角を合わせた分だけ回転します。カメラに合わせて回転するビルボードでは、方位角は画面上で画像を回転させるだけです。

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

**Description:** ビルボードをカメラに合わせて回転させるか、地図に合わせて回転させるかを指定します。MapLibre の `icon-rotation-alignment` に相当します（`true` が `"viewport"`、`false` が `"map"`）。`true` の場合は画面上で正立し、画面に正対するビルボードになります。[`billboardFacing`](#billboardfacing) が `"flat"` のときは、常に視点の方を向くように回転して地表に描かれます。`false` の場合は地図に合わせた向きになります。`"upright"` では画面と同じ平面に元の大きさのまま表示されますが、カメラの方位に合わせて回転して x 軸が常に東を向き、カメラが南を向くと上下逆さまになります。`"flat"` では北を上にして地表に描かれ、地図とともに回転します。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定することもできます。

**Default:** `placement: "point"` では `true`、ライン沿いでは `false`（MapLibre の `"auto"`）

**Example:**

```typescript
{
  billboard: {
    billboardFacing: "upright",
    rotateWithCamera: false // 画面上に表示し、カメラの方位に合わせて回転
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

MapLibre の `symbol-spacing` と同様に、ラインに沿った長さが `spacing` の 4 分の 3 を超えるビルボードは、繰り返しの間隔が「その長さ + `spacing` の 4 分の 1」に広がります。長さはビルボード自身の向きで測ります。`rotateToLine` では画像の上側がラインの方向を向くため高さが長さになり、`rotation` はそこからさらに回転させます。また、ベクタータイルソースでは、各タイルは自身の範囲内にだけビルボードを配置します。間隔はタイルごとに決まるため、`spacing` をどれだけ大きくしても、繰り返しの間隔はおよそ 1 タイル分（画面上で 512〜1024 ピクセル）までになります。

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
