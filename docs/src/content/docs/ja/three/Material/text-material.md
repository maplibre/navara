---
title: TextMaterial
description: Text material for navara_three
sidebar:
  order: 580
---

`TextMaterial`は、テキストレンダリング用のマテリアルを表します。

## Properties

### backfaceCulling

**Type:** `boolean | undefined`

**Description:** 裏側から見たときにラベルを非表示にするかどうかを指定します。`false` の場合はラベルの両面を描画し、`true` の場合は表側のみを描画します。

カメラに追従して立っているラベル（デフォルト）は常に表側が見えるため、影響はありません。影響があるのは次の 2 つの場合です。[`rotateWithCamera`](#rotatewithcamera) が `false` のラベルは裏側から見えることがあり、その場合は左右反転して表示されますが、この設定を有効にすると非表示になります。[`textFacing`](#textfacing) が `"flat"` のラベルは地球の外側を表側としているため、この設定を有効にすると、大きなラベルのうち地平線の向こう側に回り込んだ部分も非表示になります。

**Default:** `false`

**Example:**

```typescript
{
  text: {
    textFacing: "flat",
    backfaceCulling: true
  }
}
```

### backgroundColor

**Type:** `Color | undefined`

**Description:** テキスト背景の色を`Color`で指定します。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    backgroundColor: new Color().setHex(0xffffff) // 白背景
  }
}
```

### borderColor

**Type:** `Color | undefined`

**Description:** テキスト背景の境界線の色を`Color`で指定します。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    borderColor: new Color().setHex(0x000000) // 黒境界線
  }
}
```

### borderWidth

**Type:** `number | undefined`

**Description:** テキスト境界線の幅を指定します。枠線の高さに対する比率を 0 〜 0.5 の間で指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    borderWidth: 2
  }
}
```

### center

**Type:** [`Vec2`](../../api/types/#vec2) | undefined

**Description:** 中心からのシフト量を指定します。範囲は 0 から 1 の間です。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    center: { x: 0.5, y: 0.0 }
  }
}
```

### clampToGround

**Type:** `boolean | undefined`

**Description:** テキストを地面に固定するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    clampToGround: true
  }
}
```

### color

**Type:** `Color | undefined`

**Description:** テキストの色を`Color`で指定します。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    color: new Color().setHex(0x000000)
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
  text: {
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
  text: {
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
  text: {
    depthTest: true
  }
}
```

### effectIds

**Type:** `string[] | undefined`

**Description:** 適用する Selective Effect の ID を指定します（例: "bloom", "outline"）。SelectiveBloomEffectDesc や SelectiveOutlineEffectDesc と連携して使用します。Bloom ではグリフの塗り部分のみが発光し、アウトラインと背景は発光しません。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
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
  text: {
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
  text: {
    emissiveIntensity: 0.5
  }
}
```

### font

**Type:** `string | undefined`

**Description:** 単一のフォントファイルの URL、または [`view.addFontFamily()`](../../api/threeview-functions/#addfontfamily) で事前に登録したフォントファミリの `family` 名を指定します。サポートされているファイル形式は ttf、otf、woff、woff2 です。

ファミリ名を指定した場合、`text` に含まれる文字の Unicode 範囲をカバーするフェイスファイルのみが読み込まれるため、CJK などの大きなスクリプトを複数のフェイスに分割してオンデマンドに読み込めます。

各コードポイントには、`faces` の並び順で最初に `unicodeRanges` がそのコードポイントを含むフェイスが使用されるため、範囲が重複する場合は先に定義されたエントリが優先されます。どのフェイスにもカバーされないコードポイントは先頭のフェイス（`faces[0]`）にフォールバックするため、宣言された `unicodeRanges` に含まれない文字のためにも先頭のフェイスがダウンロードされる可能性があります。詳細は [`addFontFamily()`](../../api/threeview-functions/#addfontfamily) を参照してください。

フェイスと Unicode 範囲は手書きする代わりに、スタイルシートの `@font-face` ルール（例: Google Fonts CSS API）から導出することもできます。詳細は [Font Family from CSS](../../api/font-family-from-css/) を参照してください。

**Default:** `undefined`（フォントは読み込まれず、フォントを指定するまでテキストレイヤは描画されません）。

**Example (単一フォントファイル):**

```typescript
{
  text: {
    font: "https://example.com/fonts/NotoSansJP-Regular.ttf"
  }
}
```

**Example (登録済みフォントファミリ):**

```typescript
view.addFontFamily({
  family: "MapFont",
  faces: [
    { url: "/fonts/latin.woff2", unicodeRanges: [{ from: 0x0000, to: 0x024f }] },
    { url: "/fonts/cjk.woff2", unicodeRanges: [{ from: 0x4e00, to: 0x9fff }] },
  ],
});

// テキストレイヤのマテリアルで使用:
{
  text: {
    font: "MapFont"
  }
}
```

### geometryTypes

**Type:** `("point" | "line" | "polygon")[] | undefined`

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めると、デフォルトではラインの頂点ごとに 1 つのラベルを描画します。ラインに沿ってラベルを配置するには [`placement`](#placement) を指定してください。`"polygon"` を含めるとポリゴンリングの頂点ごとに 1 つのラベルを描画します（リングを閉じる重複頂点はスキップされます）。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

**Default:** `["point"]`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["point", "polygon"]
  }
}
```

### height

**Type:** `number | undefined`

**Description:** テキストの高度を指定します。単位はメートルです。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    height: 100 // 100メートル
  }
}
```

### keepUpright

**Type:** `boolean | undefined`

**Description:** ライン沿いに配置したラベルが上下逆さまに読める向きになる場合に反転し、ラインがどちら向きに描かれていても名前が読めるようにします。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用されます。ラベルの読み方向はカメラに依存するため、カメラの移動に合わせて判定し直されます。`layer.update()` で変更した値は、表示中のラベルにも反映されます。

**Default:** `true`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    keepUpright: false // 常にラインが描かれた向きに読む
  }
}
```

### lang

**Type:** `string | undefined`

**Description:** テキストシェーピング用の言語コードを指定します（例: "en", "ja", "ar"）。テキストを正しくレンダリングするために使用されます。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    lang: "ja"
  }
}
```

### lineHeight

**Type:** `number | undefined`

**Description:** 複数行テキストの行の高さを、フォント本来の行の高さ（アセンダー − ディセンダー + ラインギャップ）に対する倍率で指定します。

**Default:** `1.0`

**Example:**

```typescript
{
  text: {
    lineHeight: 1.2
  }
}
```

### lineOffset

**Type:** `number | undefined`

**Description:** ライン沿いに配置したラベルを、ラインから横方向にずらします。正の値はラインの進行方向の左側に移動し、ラベルが左から右に読める向きのときはラインの上側になります。単位は [`size`](#size) と同じで、[`sizeInMeters`](#sizeinmeters) が `true` のときはメートル、それ以外はピクセルです。道路の上ではなく道路の脇に名前を置きたい場合に使用します。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用されます。`layer.update()` で変更した値は、表示中のラベルにも反映されます。

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    size: 14,
    sizeInMeters: false,
    lineOffset: 10 // ラインから 10 ピクセル横に配置
  }
}
```

### maxAngle

**Type:** `number | undefined`

**Description:** ライン沿いに配置したラベルの下でラインが曲がってよい角度の上限（度）です。これを超えるラベルは読みにくいため非表示になります。角度はフォントサイズの約 1.5 倍の短い区間ごとに合計し、その区間をラベルに沿ってずらしながら判定します。そのため、近接した小さな角が重なると非表示になることがある一方、長く緩やかなカーブは全体でどれだけ曲がっていても表示されます。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用されます。ラベルが収まるかどうかはカメラの移動に合わせて判定し直され、`layer.update()` で変更した値は表示中のラベルにも反映されます。

**Default:** `45.0`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    maxAngle: 90 // よりきついカーブにもラベルを配置
  }
}
```

### maxWidth

**Type:** `number | undefined`

**Description:** 1 行の最大幅を em 単位（`size` の倍数）で指定します。この幅を超えると、テキストは単語の境界で折り返されます。`0` を指定すると折り返しは無効になります。`text` 内の明示的な `\n` 文字は、この設定に関わらず常に改行されます。値が em 単位のため、`sizeInMeters` の有無に関わらず折り返し幅はテキストサイズに比例します。

**Default:** `0`（折り返しなし）

**Example:**

```typescript
{
  text: {
    maxWidth: 10 // 10 em を超える行を折り返す
  }
}
```

### offsetDepth

**Type:** `boolean | undefined`

**Description:** 地球表面との重なりを回避します。テキストが地球表面にめり込まないようにする場合に使用します。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    offsetDepth: true
  }
}
```

### opacity

**Type:** `number | undefined`

**Description:** テキストの不透明度を指定します。範囲は 0.0（完全に透明）から 1.0（完全に不透明）です。

**Default:** `1.0`

**Example:**

```typescript
{
  text: {
    opacity: 0.5
  }
}
```

### outlineColor

**Type:** `Color | undefined`

**Description:** テキストアウトラインの色を`Color`で指定します。

**Default:** `undefined`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text: {
    outlineColor: new Color().setHex(0x000000) // 黒アウトライン
  }
}
```

### outlineOpacity

**Type:** `number | undefined`

**Description:** テキストアウトラインの不透明度を指定します。範囲は 0.0 から 1.0 です。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    outlineOpacity: 0.8
  }
}
```

### outlineWidth

**Type:** `number | undefined`

**Description:** アウトラインの太さを CSS ピクセル単位で指定します。

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
    outlineWidth: 2
  }
}
```

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** ラインジオメトリ上でのラベルの配置方法を指定します。[`geometryTypes`](#geometrytypes) に `"line"` が含まれる場合のみ有効です。ポイントジオメトリは常にその地点に、ポリゴンリングは常に頂点ごとにラベルが配置されます。

- `"point"`：ラインの頂点ごとに 1 つのラベルを配置します。
- `"line"`：[`spacing`](#spacing) ごとにラインに沿ってラベルを繰り返し配置します。地図上の道路名のように、単語ごとにラインのカーブに沿って曲がります。各単語はその下のラインの向きに合わせて回転し、単語内の文字はまっすぐ並んだままです。
- `"line-center"`：各ラインの長さの中間点に 1 つのラベルを配置し、同じようにラインに沿って曲げます。

ライン沿いのラベルは、読みにくくなる場合は描画されずに非表示になります。

- アンカーの左右に残っているラインよりもラベルが長い場合
- ラベルが [`maxAngle`](#maxangle) を超えて曲がる場合

これらの判定はカメラの移動に合わせて再実行されます。

ライン沿いのラベルでは [`keepUpright`](#keepupright) と [`lineOffset`](#lineoffset) も使用できます。テキストをラインに沿って地表に寝かせるため、通常は `textFacing: "flat"` と組み合わせます。

このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` では読み込み済みのラベルは再構築されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `"point"`

**Example:**

```typescript
import ThreeView, { Color, fetchFontFamilyFromCss } from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";

const view = new ThreeView({ canvas: document.querySelector("canvas")! });
view.addPlugin(new DefaultPlugin());
await view.init();

view.addFontFamily(
  await fetchFontFamilyFromCss(
    "Arsenal",
    "https://fonts.googleapis.com/css2?family=Arsenal:wght@700",
  ),
);

const source = view.addSource({
  type: "geojson",
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Riverside Avenue" },
        geometry: {
          type: "LineString",
          coordinates: [
            [139.76, 35.68],
            [139.77, 35.685],
            [139.78, 35.683],
            [139.79, 35.688],
          ],
        },
      },
    ],
  },
});

const streets = view.addLayer({
  type: "vector",
  source,
  text: {
    font: "Arsenal",
    geometryTypes: ["line"],
    placement: "line",
    spacing: 250, // 画面上のピクセル
    textFacing: "flat",
    size: 18,
    sizeInMeters: false,
    clampToGround: true,
    color: new Color().setStyle("#ffffff"),
    outlineColor: new Color().setStyle("#111318"),
    outlineWidth: 4,
  },
});

streets.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => ({ text: properties?.["name"] as string, show: true }),
    { filters: ["name"] },
  );
});
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** ラベルをカメラに追従して回転させるかどうかを指定します。

`true` の場合、ラベルは常に視点の方を向きます。[`textFacing`](#textfacing) が `"upright"` のときは画面に正対するビルボードになります。`"flat"` のときは地表の法線を軸に回転し、テキストが常に左から右に読める向きになります。

`false` の場合、ラベルはアンカー位置のローカルな東・北・上の座標系に固定され、カメラを動かしても向きは変わりません。`"upright"` では地表に立って南を向く看板になります。北向きのカメラからは読めますが、真上から見ると縁しか見えずに消え、裏側からは鏡像になります。`"flat"` では北を上にして地表に描かれ、地図とともに回転します。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定することもできます。

**Default:** `true`

**Example:**

```typescript
{
  text: {
    textFacing: "flat",
    rotateWithCamera: false // 北を上にして地表に描く
  }
}
```

### rotation

**Type:** `number | undefined`

**Description:** ラベルを自身の平面内で、アンカー位置を中心に回転させる角度を度数で指定します。正面から見て時計回りです。回転は [`textFacing`](#textfacing) と [`rotateWithCamera`](#rotatewithcamera) で決まる向きに対して追加で適用されます。ビルボードでは画面上で回転し、地表のラベルでは方位角のように回転します。

回転の中心がテキストのどこになるかは [`center`](#center) で決まります。たとえば `{ x: 0.5, y: 0.5 }` ならテキストの中央、`{ x: 0.5, y: 0.0 }` ならテキストブロックの下端が中心になります。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定できるため、レイヤー内のラベルごとに異なる向きにできます。

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
    textFacing: "flat",
    rotateWithCamera: false,
    rotation: 45, // 地表上で時計回りに 45 度回転
    center: { x: 0.5, y: 0.5 } // テキストの中央を軸に回転
  }
}
```

### highQuality

**Type:** `boolean | undefined`

**Description:** 高品質なグリフ描画を有効にします。`true` の場合、テキストは MSDF アトラスを使用し、大きなサイズでも角の鋭さを保ちますが、1 グリフあたりのラスタライズ処理コストは大幅に増加します。`false` または省略した場合は、デフォルトのシングルチャネル SDF アトラスを使用し、ラスタライズが非常に高速ですが、極端なズーム時に角がわずかに丸くなります。

**Default:** `false`

**Example:**

```typescript
{
  text: {
    highQuality: true
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
  text: {
    sizeInMeters: true
  }
}
```

### show

**Type:** `boolean | undefined`

**Description:** テキストを表示するかどうかを指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    show: true
  }
}
```

### size

**Type:** `number | undefined`

**Description:** テキストのサイズを指定します。単位はピクセルです。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    size: 16
  }
}
```

### spacing

**Type:** `number | undefined`

**Description:** [`placement`](#placement) が `"line"` のときに繰り返し配置するラベルの間隔を、画面上のピクセルで指定します。単位は `geojson` ソースでも `vector-tile` ソースでも同じです。

ライン上に表示するラベルは、カメラの移動に合わせて決め直されます。カメラを引くとラベルは間引かれ、近づくと間にラベルが追加されます。ラベルがラインに沿って移動することはなく、表示されるか消えるかのどちらかです。画面上の間隔は `spacing` の 1〜2 倍に保たれます。これは傾けた視点でも同様で、画面の手前側と奥側でそれぞれの密度になります。

ラインの中間点のラベルは常に残り、画面上で `spacing` より短いラインにはそのラベルだけが配置されます。GeoJSON ソースで地表にごく近づいた場合（ストリートレベル）や、ベクタータイルが自身のズームレベルよりかなり深く表示されている場合（オーバーズーム）は、ラベルがそれ以上追加されなくなり、`spacing` より広い間隔になります。

さらに、MapLibre の `symbol-spacing` と同じ次の規則が適用されます。

- `spacing` の 4 分の 3 より長いラベルは、繰り返しの間隔が「ラベルの長さ + `spacing` の 4 分の 1」に広がります。長い名前は非表示にならず、間隔を空けて配置されます。
- 同じタイル内で、同じテキストの先行ラベルから `spacing` の半分未満の距離にあるラベルは非表示になります。複数のラインに分かれた道路や、同じ名前の上下線に同じ場所で 2 度ラベルが付くことはありません。
- ベクタータイルソースでは、各タイルは自身の範囲内にだけラベルを配置します。ラベルの間隔はタイルごとに決まるため、`spacing` をどれだけ大きくしても、繰り返しの間隔はおよそ 1 タイル分（画面上で 512〜1024 ピクセル）までになります。

このオプションはジオメトリ構築時に適用されます。`layer.update()` では読み込み済みのラベルは再構築されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `250.0`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    spacing: 400
  }
}
```

### text

**Type:** `string | undefined`

**Description:** 表示するテキスト内容を指定します。

**Default:** `undefined`

**Example:**

```typescript
{
  text: {
    text: "Tokyo Station"
  }
}
```

### textAlign

**Type:** `string | undefined`

**Description:** 複数行テキストブロック内での行の水平方向の配置を指定します。`"left"`、`"center"`、`"right"` のいずれかを指定します。テキストが複数行になる場合（[`maxWidth`](#maxwidth) または明示的な `\n` 文字による）にのみ効果があります。

**Default:** `"center"`

**Example:**

```typescript
{
  text: {
    textAlign: "left"
  }
}
```

### textFacing

**Type:** `"upright" | "flat" | undefined`

**Description:** ラベルを立てて表示するか、地球表面に寝かせて表示するかを指定します。`"upright"` はラベルを立てた状態に保ちます。`"flat"` はラベルをアンカー位置の周辺で地球表面に沿わせて配置します。地球の曲率に沿うため、長いテキストでも両端が地表から浮き上がりません。寝かせたラベルは地表に描かれているように見え、カメラのピッチに応じて短縮されます。

[`rotateWithCamera`](#rotatewithcamera) との組み合わせで、次の 4 通りの表示になります。

| `textFacing` | `rotateWithCamera` | 表示 |
| --- | --- | --- |
| `"upright"` | `true` | 画面に正対するビルボード。短縮されません（デフォルト） |
| `"upright"` | `false` | 地表に立つ看板。方位は固定されます |
| `"flat"` | `true` | 地表に描かれ、常に左から右に読める向きに回転します |
| `"flat"` | `false` | 地表に描かれ、北を上にして地図とともに回転します |

[`FeatureEvaluator`](../../api/feature-evaluator/) から `facing` として地物ごとに指定することもできます。

**Default:** `"upright"`

**Example:**

```typescript
{
  text: {
    textFacing: "flat"
  }
}
```

### transparent

**Type:** `boolean | undefined`

**Description:** 透明度とアルファブレンディングを有効にします。有効にすると、`opacity` プロパティを使用して透明度を制御できます。

**Default:** `true`

**Example:**

```typescript
{
  text: {
    transparent: true,
    opacity: 0.5
  }
}
```

