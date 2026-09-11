---
title: TextMaterial
description: Text material for navara_three
sidebar:
  order: 580
---

`TextMaterial`は、テキストレンダリング用のマテリアルを表します。

## Properties

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

**Description:** 発光の強度を指定します。Bloom エフェクトが有効な場合のデフォルト値は 0.3 です。

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

**Description:** このマテリアルが消費するソースジオメトリのカテゴリーです。`"line"` を含めるとラインの頂点ごとに、`"polygon"` を含めるとポリゴンリングの頂点ごとに 1 つのラベルを描画します（リングを閉じる重複頂点はスキップされます）。配列を指定するとデフォルトは置き換えられるため、ポイントジオメトリも描画し続けたい場合は `"point"` を含めてください。このオプションはジオメトリ構築時に適用されます。レイヤー作成時に指定してください。`layer.update()` で変更しても読み込み済みのタイルには反映されず、変更後に読み込まれたタイルにのみ適用されます（すべてに反映するにはレイヤーを作り直してください）。

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

