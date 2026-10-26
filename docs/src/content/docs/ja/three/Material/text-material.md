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

裏側がカメラから見えるのは、地表に寝かせたラベル（[`textFacing`](#textfacing) を参照）だけです。地球の外側を表側としているため、この設定を有効にすると、大きなラベルのうち地平線の向こう側に回り込んだ部分が非表示になります。`"upright"` のラベルは常に画面と同じ平面で視点の方を向いているため、影響はありません。

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

### declutterRank

**Type:** `number | undefined`

**Description:** デクラッターの大まかな配置順で、[`declutterPriority`](#declutterpriority) より先に比較されます。ランクの高いマテリアルのラベルは、優先度にかかわらず、ランクの低いラベルやスプライトより先に配置されます。そのため、地物ごとの `declutterPriority` は同じランクのラベルやスプライトの順序だけを入れ替えます。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。

**Default:** `0.0`

**Example:**

```typescript
{
  text: {
    declutterRank: 1
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

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めると、デフォルトではラインごとに 1 つのラベルを、その最初の頂点に描画します。MapLibre がライン上の `symbol-placement: "point"` のシンボルを配置するのと同じです。ラインに沿ってラベルを配置するには [`placement`](#placement) を指定してください。`"polygon"` を含めるとポリゴンごとに 1 つのラベルを、ポリゴン内部で辺から最も遠い地点に描画します（MultiPolygon は各パーツに 1 つずつ）。[`placement`](#placement) でリングに沿って配置することもできます。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

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

### ignorePlacement

**Type:** `boolean | undefined`

**Description:** このラベルのボックスを衝突判定から外し、後から配置されるラベルやスプライトが重なれるようにします。このラベル自体は、[`overlap`](#overlap) で許可しない限り、先に配置されたものと衝突すると非表示になります。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。MapLibre の `text-ignore-placement` に相当します。

**Default:** `false`

**Example:**

```typescript
{
  text: {
    ignorePlacement: true
  }
}
```

### keepUpright

**Type:** `boolean | undefined`

**Description:** ライン沿いに配置したラベルが上下逆さまに読める向きになる場合に反転し、ラインがどちら向きに描かれていても名前が読めるようにします。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用され、まっすぐ描かれるラベル（[`rotateWithCamera`](#rotatewithcamera) を参照）は反転しません。ラベルの読み方向はカメラに依存するため、カメラの移動に合わせて判定し直されます。`layer.update()` で変更した値は、表示中のラベルにも反映されます。

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

### letterSpacing

**Type:** `number | undefined`

**Description:** 文字間に追加する間隔を em 単位（`size` の倍数）で指定します。間隔は文字と文字の間にのみ追加され、最後の文字の後には追加されないため、揃え位置やアンカーには影響しません。また、[`maxWidth`](#maxwidth) による折り返し幅の計算にも含まれます。負の値を指定すると字間が詰まります。結合文字（アクセント記号など）は基底文字から離れません。アラビア文字を含むラベルでは、連結された字形が崩れるため間隔は無視されます。フィーチャー評価の `letterSpacing` キーで、フィーチャーごとに指定することもできます。

**Default:** `0`

**Example:**

```typescript
{
  text: {
    letterSpacing: 0.2 // 文字間に 0.2 em を追加
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

**Description:** ライン沿いに配置したラベルを、ラインから横方向にずらします。正の値はラインの進行方向の左側に移動し、ラベルが左から右に読める向きのときはラインの上側になります。単位は [`size`](#size) と同じで、[`sizeInMeters`](#sizeinmeters) が `true` のときはメートル、それ以外はピクセルです。道路の上ではなく道路の脇に名前を置きたい場合に使用します。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用され、まっすぐ描かれるラベル（[`rotateWithCamera`](#rotatewithcamera) を参照）には適用されません。`layer.update()` で変更した値は、表示中のラベルにも反映されます。

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

**Description:** ライン沿いに配置したラベルの下でラインが曲がってよい角度の上限（度）です。これを超えるラベルは読みにくいため非表示になります。角度はフォントサイズの約 1.5 倍の短い区間ごとに合計し、その区間をラベルに沿ってずらしながら判定します。そのため、近接した小さな角が重なると非表示になることがある一方、長く緩やかなカーブは全体でどれだけ曲がっていても表示されます。[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用されます。まっすぐ描かれるラベル（[`rotateWithCamera`](#rotatewithcamera) を参照）は曲がらないため、この判定の対象外です。ラベルが収まるかどうかはカメラの移動に合わせて判定し直され、`layer.update()` で変更した値は表示中のラベルにも反映されます。

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

### overlap

**Type:** `"never" | "always" | "cooperative" | undefined`

**Description:** 先に配置されたラベルやスプライトの上にこのラベルを重ねて描画できるかを指定します（[`declutterRank`](#declutterrank)、次に [`declutterPriority`](#declutterpriority) が大きいものから配置されます）。`"never"` はいずれかと衝突すると非表示にします。`"always"` は非表示にしません。そのボックスは、[`ignorePlacement`](#ignoreplacement) を設定しない限り、後から配置される `"never"` のものを遠ざけます。`"cooperative"` は `"never"` のものと衝突した場合にのみ非表示にします。[`declutter`](#declutter) が有効な場合にのみ意味を持ちます。MapLibre の `text-overlap` に相当します。

**Default:** `"never"`

**Example:**

```typescript
{
  text: {
    overlap: "always"
  }
}
```

### placement

**Type:** `"point" | "line" | "line-center" | undefined`

**Description:** ラインおよびポリゴンジオメトリ上でのラベルの配置方法を指定します。[`geometryTypes`](#geometrytypes) に `"line"` または `"polygon"` が含まれる場合のみ有効です。ポイントジオメトリは常にその地点にラベルが配置されます。

- `"point"`：ラインごとにその最初の頂点に 1 つのラベルを配置し、ポリゴンにはポリゴン内部で辺から最も遠い地点に 1 つのラベルを配置します。ベクタータイルソースでは、最初の頂点がタイルの外にある（タイルで切られた）ラインには、そのタイルではラベルを配置しません。
- `"line"`：[`spacing`](#spacing) ごとにラインに沿ってラベルを繰り返し配置します。デフォルトでは、地図上の道路名のように、単語ごとにラインのカーブに沿って曲がります。各単語はその下のラインの向きに合わせて回転し、単語内の文字はまっすぐ並んだままです。文字ごとに回転させるには [`spreadGlyphs`](#spreadglyphs) を指定します。ポリゴンの境界リング（穴を含む）にも同じように沿って配置します。
- `"line-center"`：各ラインまたはポリゴンリングの長さの中間点に 1 つのラベルを配置し、同じように沿って曲げます。

ライン沿いのラベルは、読みにくくなる場合は描画されずに非表示になります。

- アンカーの左右に残っているラインよりもラベルが長い場合
- ラベルが [`maxAngle`](#maxangle) を超えて曲がる場合

これらの判定はカメラの移動に合わせて再実行されます。

ライン沿いのラベルでは [`keepUpright`](#keepupright)、[`lineOffset`](#lineoffset)、[`spreadGlyphs`](#spreadglyphs) も使用できます。[`rotateWithCamera`](#rotatewithcamera)、[`spreadGlyphs`](#spreadglyphs)、[`textFacing`](#textfacing) をいずれも指定しない場合、ラベルは地表に寝かせてラインに沿って配置されます。これらの組み合わせで配置が決まります。

| `rotateWithCamera` | `spreadGlyphs` | `textFacing` | 表示 |
| --- | --- | --- | --- |
| `false`（デフォルト） | `false`（デフォルト） | `"flat"`（デフォルト） | 単語がラインに沿って地表に寝かせて配置され、各単語はまっすぐのままです |
| `false` | `true` | `"flat"` | 各文字が地表に寝かせて配置され、その下のラインの向きに合わせて回転します（MapLibre のデフォルトの道路名。`text-rotation-alignment` と `text-pitch-alignment` がともに `"map"`） |
| `false` | どちらでも | `"upright"` | 文字（`spreadGlyphs` を指定しない場合は単語）は、アンカー位置での大きさのまま画面と同じ平面に表示されます。画面上に見えるラインに沿って間隔が決まり、それぞれ画面上でのラインの向きに合わせて回転します（`text-rotation-alignment: "map"` と `text-pitch-alignment: "viewport"`） |
| `true` | `true` | どちらでも | 各文字はライン上に配置され、ポイントラベルと同じようにカメラに追従して回転します。間隔は画面上で決まります（`text-rotation-alignment: "viewport-glyph"`） |
| `true` | `false` | どちらでも | ラベルは曲がらず、各アンカー位置にポイントラベルとまったく同じように、回転や背景も含めてまっすぐ描かれます（`text-rotation-alignment: "viewport"`） |

まっすぐ描かれるラベルも [`spacing`](#spacing) ごとに繰り返し配置されますが、[`keepUpright`](#keepupright) による反転、[`maxAngle`](#maxangle) による判定、[`lineOffset`](#lineoffset) は適用されません。

このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` では読み込み済みのラベルは再構築されないため、変更するにはレイヤーを削除して追加し直してください。

**Default:** `"point"`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line", // ラインに沿って繰り返し、曲がりに合わせて配置
    textFacing: "flat"
  }
}
```

### rotateWithCamera

**Type:** `boolean | undefined`

**Description:** ラベルをカメラに合わせて回転させるか、地図に合わせて回転させるかを指定します。MapLibre の `text-rotation-alignment` に相当します（`true` が `"viewport"`、`false` が `"map"`）。

`true` の場合、ラベルは画面上で常に左から右に読める向きになります。[`textFacing`](#textfacing) が `"upright"` のときは画面に正対するビルボードになります。`"flat"` のときは地表の法線を軸に回転し、テキストが常に左から右に読める向きになります。

`false` の場合、ラベルは地図に合わせた向きになります。`"upright"` では画面と同じ平面に元の大きさのまま表示されますが、カメラの方位に合わせて回転し、x 軸が常に東を向きます。テキストは東西方向に沿って読む向きになり、北を上にした地図のラベルと同じく、カメラが南を向くと上下逆さまになります。`"flat"` では北を上にして地表に描かれ、地図とともに回転します。

[`placement`](#placement) が `"line"` または `"line-center"` のとき、`false` ではラベルがラインに沿います。`true` では、[`spreadGlyphs`](#spreadglyphs) を指定しない限り、各アンカー位置にポイントラベルと同じようにまっすぐ描かれます。それぞれの配置は [`placement`](#placement) を参照してください。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定することもできます。

**Default:** `placement: "point"` では `true`、ライン沿いでは `false`（MapLibre の `"auto"`）

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

[`placement`](#placement) が `"line"` または `"line-center"` のときは、各文字がライン上の位置を保ったまま自身の中心を軸に回転します。MapLibre のライン沿いラベルでの `text-rotate` と同じ動作です。まっすぐ描かれるラベル（[`spreadGlyphs`](#spreadglyphs) を指定せず `rotateWithCamera: true` の場合）は、ポイントラベルと同じくアンカー位置を中心に全体が回転します。

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

### spreadGlyphs

**Type:** `boolean | undefined`

**Description:** ライン沿いに配置したラベルを、単語ごとではなく文字ごとに配置します。各文字の向きは [`rotateWithCamera`](#rotatewithcamera) によって決まります。

- `false`（ライン沿いでのデフォルト）：各文字がその下のラインの向きに合わせて回転します。MapLibre の `symbol-placement: "line"` と同じ配置です。単語はまっすぐのままではなくカーブに沿って曲がり、急なカーブでは単語内の文字の間隔が開きます。
- `true`：各文字は、同じ [`textFacing`](#textfacing) のポイントラベルと同じようにカメラに追従して回転します。ラインがどの向きでもテキストは読める向きに保たれます（MapLibre の `text-rotation-alignment: "viewport-glyph"`）。また、各文字は同じ大きさに保たれ、画面上に見えるラインに沿って間隔が決まります。そのため、カメラから遠ざかる向きのラインでも文字の間隔は均等に保たれます。`spreadGlyphs` を指定しない場合、`rotateWithCamera: true` ではラベルはまっすぐ描かれます。

[`placement`](#placement) が `"line"` または `"line-center"` のときのみ使用されます。`layer.update()` で変更した値は、表示中のラベルにも反映されます。

[`FeatureEvaluator`](../../api/feature-evaluator/) から地物ごとに指定することもできます。たとえば、レイヤーのほかのラベルは文字ごとに配置しつつ、筆記体のように文字がつながる文字体系やフォントのラベルだけを単語ごとに保てます。

**Default:** `false`

**Example:**

```typescript
{
  text: {
    geometryTypes: ["line"],
    placement: "line",
    textFacing: "flat",
    rotateWithCamera: false, // MapLibre の道路名のようにラインに沿わせる
    spreadGlyphs: true
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

**Description:** ラベルを画面と同じ平面に表示するか、地球表面に寝かせて表示するかを指定します。MapLibre の `text-pitch-alignment` に相当します（`"upright"` が `"viewport"`、`"flat"` が `"map"`）。`"upright"` のラベルは、カメラのピッチにかかわらず短縮されません。`"flat"` はラベルをアンカー位置の周辺で地球表面に沿わせて配置します。地球の曲率に沿うため、長いテキストでも両端が地表から浮き上がりません。寝かせたラベルは地表に描かれているように見え、カメラのピッチに応じて短縮されます。

ポイントラベルでは、[`rotateWithCamera`](#rotatewithcamera) との組み合わせで、次の 4 通りの表示になります。

| `textFacing` | `rotateWithCamera` | 表示 |
| --- | --- | --- |
| `"upright"` | `true` | 画面に正対するビルボード（デフォルト） |
| `"upright"` | `false` | 画面と同じ平面に表示され、カメラの方位に合わせて回転し、テキストは東西方向に沿って読む向きになります（カメラが南を向くと上下逆さま） |
| `"flat"` | `true` | 地表に描かれ、常に左から右に読める向きに回転します |
| `"flat"` | `false` | 地表に描かれ、北を上にして地図とともに回転します |

ライン沿いのラベルについては [`placement`](#placement) を参照してください。

[`FeatureEvaluator`](../../api/feature-evaluator/) から `facing` として地物ごとに指定することもできます。

**Default:** `"upright"`、`rotateWithCamera` が `false` の場合は `"flat"`（MapLibre の `"auto"`）

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

