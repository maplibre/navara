---
title: PointMaterial
description: Point material for navara_three
sidebar:
  order: 530
---

`PointMaterial`は、ポイントジオメトリレンダリング用のマテリアルを表します。

## Properties

### backfaceCulling

**Type:** `boolean | undefined`

**Description:** 裏側から見たときにポイントを非表示にするかどうかを指定します。`false` の場合はポイントの両面を描画し、`true` の場合は表側のみを描画します。

裏側がカメラから見えるのは、地表に寝かせたポイント（[`pointFacing`](#pointfacing) を参照）だけです。地球の外側を表側としているため、この設定を有効にすると、大きなポイントのうち地平線の向こう側に回り込んだ部分が非表示になります。`"upright"` のポイントは常に画面と同じ平面で視点の方を向いているため、影響はありません。

**Default:** `false`

**Example:**

```typescript
{
  point: {
    pointFacing: "flat",
    backfaceCulling: true
  }
}
```

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

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めると、デフォルトではラインの頂点ごとに 1 つのポイントを描画します。ラインに沿って繰り返し配置するには [`placement`](#placement) を指定してください。`"polygon"` を含めるとポリゴンリングの頂点ごとに 1 つのポイントを描画します（リングを閉じる重複頂点はスキップされます）。[`placement`](#placement) でリングに沿って配置することもできます。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

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

### ignorePlacement

**Type:** `boolean | undefined`

**Description:** このポイントのボックスを衝突判定から外し、後から配置されるラベルやスプライトが重なれるようにします。このポイント自体は、[`overlap`](#overlap) で許可しない限り、先に配置されたものと衝突すると非表示になります。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。

**Default:** `false`

**Example:**

```typescript
{
  point: {
    ignorePlacement: true
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

### overlap

**Type:** `"never" | "always" | "cooperative" | undefined`

**Description:** 先に配置されたラベルやスプライトの上にこのポイントを重ねて描画できるかを指定します（[`declutterPriority`](#declutterpriority) が大きいものから配置されます）。`"never"` はいずれかと衝突すると非表示にします。`"always"` は非表示にしません。そのボックスは、[`ignorePlacement`](#ignoreplacement) を設定しない限り、後から配置される `"never"` のものを遠ざけます。`"cooperative"` は `"never"` のものと衝突した場合にのみ非表示にします。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。

**Default:** `"never"`

**Example:**

```typescript
{
  point: {
    overlap: "always"
  }
}
```

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** ラインおよびポリゴンジオメトリ上でのポイントの配置方法を指定します。[`geometryTypes`](#geometrytypes) に `"line"` または `"polygon"` が含まれる場合のみ有効です。ポイントジオメトリは常にその地点にポイントが配置されます。

- `"point"`：ラインの頂点およびポリゴンリングの頂点ごとに 1 つのポイントを配置します。
- `"line"`：[`spacing`](#spacing) ごとにラインに沿ってポイントを繰り返し配置します。ラインの頂点の位置に関係なく等間隔になります。ポリゴンの境界リング（穴を含む）にも同じように沿って配置します。
- `"line-center"`：各ラインまたはポリゴンリングの長さの中間点に 1 つのポイントを配置します。

`"line"` と `"line-center"` では、各ポイントは配置された位置でのラインの向きにも回転します（[`rotateToLine`](#rotatetoline) を参照）。[`pointFacing`](#pointfacing) と [`rotateWithCamera`](#rotatewithcamera) を指定しない場合は、地表に寝かせて地図に合わせた向きになります。

このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` では読み込み済みのポイントは再構築されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `"point"`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 50, // 画面上のピクセル
    size: 6,
    sizeInMeters: false,
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
  point: {
    sizeInMeters: true
  }
}
```

### pointFacing

**Type:** `"upright" | "flat" | undefined`

**Description:** ポイントを画面と同じ平面に表示するか、地球表面に寝かせて表示するかを指定します。MapLibre の `icon-pitch-alignment` に相当します（`"upright"` が `"viewport"`、`"flat"` が `"map"`）。`"upright"` のポイントは、カメラのピッチにかかわらず短縮されません。`"flat"` はアンカー位置の周辺で地球の曲率に沿って地表に配置するため、地表に描かれているように見え、カメラのピッチに応じて短縮されます。

[`rotateWithCamera`](#rotatewithcamera) との組み合わせで、次の 4 通りの表示になります。

| `pointFacing` | `rotateWithCamera` | 表示 |
| --- | --- | --- |
| `"upright"` | `true` | 画面に正対するビルボード（`placement: "point"` でのデフォルト） |
| `"upright"` | `false` | 画面と同じ平面に表示され、カメラの方位に合わせて回転し、ポイントの x 軸が東を向きます |
| `"flat"` | `true` | 地表に描かれ、常に視点の方を向くように回転します |
| `"flat"` | `false` | 地表に描かれ、北を上にして地図とともに回転します（ライン沿いでのデフォルト） |

[`FeatureEvaluator`](../../api/feature-evaluator/) から `facing` として地物ごとに指定することもできます。

**Default:** `"upright"`、`rotateWithCamera` が `false` の場合は `"flat"`（MapLibre の `"auto"`）

**Example:**

```typescript
{
  point: {
    pointFacing: "flat"
  }
}
```

### rotateToLine

**Type:** `boolean | undefined`

**Description:** ライン沿いに配置したポイントをラインに合わせて回転させるかどうかを指定します。`true` の場合、アンカー位置でのラインの向きを方位角として [`rotation`](#rotation) に加算します。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用されます。

加算される方位角は、ポイントが地図に合わせた向き（[`rotateWithCamera`](#rotatewithcamera) が `false`。ライン沿いでのデフォルト）のときに地図上の向きとして意味を持ちます。`"upright"` の場合は画面と同じ平面に表示され、カメラの方位とラインの方位角を合わせた分だけ回転します。カメラに合わせて回転するポイントでは、方位角は画面上で回転させるだけです。

このオプションはジオメトリ構築時に適用されます。`layer.update()` では読み込み済みのポイントには反映されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `true`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    pointFacing: "flat",
    rotateWithCamera: false,
    rotateToLine: true
  }
}
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** ポイントをカメラに合わせて回転させるか、地図に合わせて回転させるかを指定します。MapLibre の `icon-rotation-alignment` に相当します（`true` が `"viewport"`、`false` が `"map"`）。`true` の場合は画面上で正立し、画面に正対するビルボードになります。[`pointFacing`](#pointfacing) が `"flat"` のときは、常に視点の方を向くように回転して地表に描かれます。`false` の場合は地図に合わせた向きになります。`"upright"` では画面と同じ平面に元の大きさのまま表示されますが、カメラの方位に合わせて回転して x 軸が常に東を向き、カメラが南を向くと上下逆さまになります。`"flat"` では北を上にして地表に描かれ、地図とともに回転します。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定することもできます。

**Default:** `placement: "point"` では `true`、ライン沿いでは `false`（MapLibre の `"auto"`）

**Example:**

```typescript
{
  point: {
    pointFacing: "upright",
    rotateWithCamera: false // 画面上に表示し、カメラの方位に合わせて回転
  }
}
```

### rotation

**Type:** `number | undefined`

**Description:** ポイントを自身の平面内で、アンカー位置を中心に回転させる角度を度数で指定します。正面から見て時計回りです。回転は [`pointFacing`](#pointfacing) と [`rotateWithCamera`](#rotatewithcamera) で決まる向きに対して追加で適用されます。

回転の中心がポイントのどこになるかは [`center`](#center) で決まります。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定できるため、レイヤー内のポイントごとに異なる向きにできます。

**Default:** `0.0`

**Example:**

```typescript
{
  point: {
    rotation: 45
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

### spacing

**Type:** `number | undefined`

**Description:** [`placement`](#placement) が `"line"` のときに繰り返し配置するポイントの間隔を、画面上のピクセルで指定します。単位は `geojson` ソースでも `vector-tile` ソースでも同じです。

ライン上に表示するポイントは、カメラの移動に合わせて決め直されます。カメラを引くとポイントは間引かれ、近づくと間にポイントが追加されます。ポイントがラインに沿って移動することはなく、表示されるか消えるかのどちらかです。画面上の間隔は `spacing` の 1〜2 倍に保たれます。これは傾けた視点でも同様で、画面の手前側と奥側でそれぞれの密度になります。

ラインの中間点のポイントは常に残り、画面上で `spacing` より短いラインにはそのポイントだけが配置されます。GeoJSON ソースで地表にごく近づいた場合（ストリートレベル）や、ベクタータイルが自身のズームレベルよりかなり深く表示されている場合（オーバーズーム）は、ポイントがそれ以上追加されなくなり、`spacing` より広い間隔になります。

MapLibre の `symbol-spacing` と同様に、ラインに沿った長さが `spacing` の 4 分の 3 を超えるポイントは、繰り返しの間隔が「その長さ + `spacing` の 4 分の 1」に広がります。長さはポイント自身の向きで測ります。`rotateToLine` ではポイントの上側がラインの方向を向くため高さが長さになり、`rotation` はそこからさらに回転させます。また、ベクタータイルソースでは、各タイルは自身の範囲内にだけポイントを配置します。間隔はタイルごとに決まるため、`spacing` をどれだけ大きくしても、繰り返しの間隔はおよそ 1 タイル分（画面上で 512〜1024 ピクセル）までになります。

このオプションはジオメトリ構築時に適用されます。`layer.update()` では読み込み済みのポイントは再構築されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `250.0`

**Example:**

```typescript
{
  point: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 100
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
