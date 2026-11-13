---
title: Text3DMeshDesc
description: navara_three 向けの押し出し 3D 文字 Mesh Descriptor
sidebar:
  order: 119
since: 0.3.2
---

`Text3DMeshDesc` クラスは、文字を立体の 3D オブジェクトとして描画する Mesh Descriptor です。フォントファイルから各文字の輪郭を読み取り、指定した厚みまで押し出します。

`DefaultPlugin` により `"text3D"` mesh キーで登録されているため、`view.addMesh({ text3D: { ... } })` 呼び出しはこの Descriptor にルーティングされます。

フォントはメッシュを追加したときに取得されます。`addMesh` は即座にハンドルを返し、フォントのロード完了後に文字が表示されます。フォントを取得できない場合や読み取れない場合は `error` イベントで通知されます。

文字は配置した位置に直立します。文字ブロックの下端中央が配置位置に乗り（下端は最終行のフォントの descender の位置で、文字の内容によって動きません）、`geodetic` では文字の正面が `heading` の方位を向きます。

以下のプロパティに加えて、基底クラスの共通プロパティ（`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`visible`）が利用できます。詳細は [MeshDesc](../mesh-desc-base) を参照してください。

## Properties

### text

**Type:** `string`

**Description:** 表示する文字列。必須パラメータです。改行（`\n`）で新しい行が始まり、各行は左揃えになります。

**Example:**

```typescript
{
  text3D: {
    text: "Navara\n3D",
    font: "/fonts/your-font.ttf",
  }
}
```

### font

**Type:** `string`

**Description:** フォントファイルの URL。必須パラメータです。TTF のフォントファイル、または three.js の typeface.json フォントを指定できます。フォントはアプリケーション側でホストしてください。たとえばプロジェクトの `public/fonts/` 配下に置いて `/fonts/your-font.ttf` のように参照するか、ライセンスが確認された外部ホストの URL を指定します。

フォントファイルは 1 つのスタイルだけを持つため、イタリックや別のウェイトは別のファイルです。そのファイルの URL を指定してください。

`update()` で `font` を変更すると、新しいフォントが読み込まれるまでは現在のフォントのまま表示されます。続けて複数のフォントを指定した場合は、最後に指定したフォントが使われます。

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
  }
}
```

### size

**Type:** `number`

**Description:** 文字のサイズ（メートル）。大文字の高さがおよそこの値になり、正確な高さはフォントによって変わります。

**Default:** `100`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    size: 150,
  }
}
```

### lineHeight

**Type:** `number`

**Description:** 連続する行のベースライン同士の間隔を、`size` の倍数で指定します。未設定の場合は、フォントが定義する行間が使われます。

**Default:** フォントの行間

**Example:**

```typescript
{
  text3D: {
    text: "Navara\n3D",
    font: "/fonts/your-font.ttf",
    lineHeight: 1.5,
  }
}
```

### depth

**Type:** `number`

**Description:** 文字の厚み（メートル）。正面から背面までの距離です。

**Default:** `50`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    depth: 60,
  }
}
```

### curveSegments

**Type:** `number`

**Description:** 文字の輪郭の各曲線を近似する点の数。値を大きくすると曲線が滑らかになり、三角形の数が増えます。

**Default:** `12`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    curveSegments: 4,
  }
}
```

### bevelEnabled

**Type:** `boolean`

**Description:** 文字の縁に面取り（ベベル）を付けるかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    bevelEnabled: true,
  }
}
```

### bevelThickness

**Type:** `number`

**Description:** ベベルの奥行き（メートル）。ベベルは文字の手前と奥に追加されるため、全体の厚みはこの値の 2 倍ぶん増えます。`size` に連動しない絶対的な長さです。

**Default:** `10`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    bevelEnabled: true,
    bevelThickness: 4,
  }
}
```

### bevelSize

**Type:** `number`

**Description:** ベベルが文字の輪郭から外側に広がる距離（メートル）。各ストロークは両側にこの値ぶん太くなります。`size` に連動しない絶対的な長さです。

**Default:** `8`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    bevelEnabled: true,
    bevelSize: 3,
  }
}
```

### color

**Type:** `Color`

**Description:** 文字の色を `Color` インスタンスで指定します。`Color` クラスは 16 進数カラーコードや CSS 形式の色指定をサポートします。

**Default:** `new Color().setStyle("#ffffff")`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
  }
}
```

### sideColor

**Type:** `Color`

**Description:** 正面と背面のあいだにある側面の色を `Color` インスタンスで指定します。ベベルも側面に含まれます。

**Default:** `color` の値

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
    sideColor: new Color().setStyle("#ffffff"),
  }
}
```

### emissiveColor

**Type:** `Color`

**Description:** 自己発光色を `Color` インスタンスで指定します。光と反対を向いた面を含め、すべての面の陰影付きの色に加算されます。

**Default:** `new Color().setHex(0x000000)`

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    emissiveColor: new Color().setStyle("#ff0000"),
    emissiveIntensity: 0.3,
  }
}
```

### sideEmissiveColor

**Type:** `Color`

**Description:** 側面の自己発光色を `Color` インスタンスで指定します。黒を指定すると、正面と背面だけが発光します。

**Default:** `emissiveColor` の値

**Example:**

```typescript
import { Color } from "@navaramap/three";

{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
    sideColor: new Color().setStyle("#ffffff"),
    emissiveColor: new Color().setStyle("#ff0000"),
    sideEmissiveColor: new Color().setHex(0x000000),
    emissiveIntensity: 0.3,
  }
}
```

### emissiveIntensity

**Type:** `number`

**Description:** 自己発光の強度を指定します。

**Default:** `0`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    emissiveIntensity: 0.5,
  }
}
```

### opacity

**Type:** `number`

**Description:** 不透明度を指定します。0.0（完全透明）から 1.0（完全不透明）の範囲で指定します。

**Default:** `1`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    opacity: 0.5,
    transparent: true,
  }
}
```

### transparent

**Type:** `boolean`

**Description:** 透明度を有効にするかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    transparent: true,
  }
}
```

### castShadow

**Type:** `boolean`

**Description:** 文字が影を投影するかどうかを指定します。影に必要なシーンの設定は [影を落とす文字](#影を落とす文字) を参照してください。

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    castShadow: true,
  }
}
```

### receiveShadow

**Type:** `boolean`

**Description:** 文字が影を受けるかどうかを指定します。

**Default:** `false`

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    receiveShadow: true,
  }
}
```

## Config

### effectIds

**Type:** `string[]` (optional)

**Description:** このメッシュに適用する Selective Effect の Descriptor ID の配列を指定します。

**Example:**

```typescript
{
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    effectIds: ["bloom-effect", "outline-effect"],
  }
}
```

## イベント

### load

**Description:** フォントのロードが完了し、そのフォントで文字が表示されるたびに発火します。`update()` で `font` を変更した後も発火します。読み込みに失敗した場合は発火しません（代わりに `error` イベントが発火します）。

**Example:**

```typescript
sign.ref.on("load", () => {
  console.log("Text displayed!");
});
```

### error

**Description:** フォントを取得できないとき、または読み取れないときに発火します。最初のフォントであれば、`update()` で別の `font` を指定するまで文字は作成されません。それ以外の場合は、現在のフォントのまま表示されます。同じ URL をもう一度指定すると読み込みを再試行します。

**Example:**

```typescript
sign.ref.on("error", (error) => {
  console.warn("Font failed to load:", error);
});
```

## Usage Examples

### 基本的な使い方

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { Text3DMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>();
view.addPlugin(new DefaultPlugin()); // "text3D" → Text3DMeshDesc を登録
await view.init();

// 文字にはシーンのライトで陰影が付く
view.addLight({ ambient: { intensity: 0.6 } });
view.addLight({ sun: { intensity: 1.8 } });

const sign = view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    size: 150,
    depth: 60,
    color: new Color().setStyle("#ff0000"),
  },
  // 文字の下端中央がこの位置に立ち、正面は南を向く
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180 },
});
```

### 文字の変更

すべてのプロパティは `update()` で変更できます。`undefined` を指定したプロパティは変更されないため、一度設定した `sideColor`・`sideEmissiveColor`・`lineHeight` は既定値に戻りません。戻す場合は値を明示して指定してください。フォントのロード前に行った更新は、文字が表示されるときに反映されます。

```typescript
sign.update({
  text3D: {
    text: "Navara\n3D",
    font: "/fonts/another-font.ttf",
    color: new Color().setStyle("#0091ff"),
  },
});
```

### フォントの切り替え

イタリックは別のフォントファイルです。新しいフォントが読み込まれるまでは現在のフォントのまま表示され、読み取れないフォントでは `error` イベントが発火して表示は元のまま残ります。

```typescript
sign.ref.on("load", () => {
  console.log("Font switched");
});
sign.ref.on("error", (error) => {
  console.warn("Font failed to load:", error);
});

sign.update({ text3D: { font: "/fonts/your-font-italic.ttf" } });
```

### 正面と側面の色

側面には別の色を指定できます。正面と背面だけを発光させるには、側面の発光色を黒にします。

```typescript
view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    color: new Color().setStyle("#ff0000"),
    sideColor: new Color().setStyle("#ffffff"),
    emissiveColor: new Color().setStyle("#ff0000"),
    sideEmissiveColor: new Color().setHex(0x000000),
    emissiveIntensity: 0.3,
  },
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180 },
});
```

### ベベル付きの文字

ベベルの長さは絶対値なので、`size` に合わせて指定してください。

```typescript
view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    size: 150,
    depth: 60,
    bevelEnabled: true,
    bevelThickness: 4,
    bevelSize: 3,
  },
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180 },
});
```

### 影を落とす文字

影には、`shadow: true` で作成した view と [sun light](../../light-desc/sun-light-desc) が必要です。地形に影を表示するには、地形のマテリアルに [`receiveShadow`](../../../three/material/terrain-material/#receiveshadow) を、ソースに `requestVertexNormals` を設定します。

```typescript
import ThreeView from "@navaramap/three";
import type { Text3DMeshDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";

const view = new ThreeView<DefaultDescriptions>({ shadow: true });
const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);
await view.init();

// 影を落とす sun light を追加する
defaultPlugin.addDefaultPhotorealScene();

const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/terrain/{z}/{x}/{y}.terrain",
  requestVertexNormals: true,
});
view.addLayer({
  type: "terrain",
  source: terrain,
  terrain: { receiveShadow: true },
});

view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    castShadow: true,
  },
  // 地形から 100 m 浮かせて、影が文字から離れた位置に落ちるようにする
  geodetic: {
    lng: 139.7671,
    lat: 35.6812,
    height: 100,
    heading: 180,
    heightReference: "terrain",
  },
});
```

### 寝かせた文字

`pitch` を `90` にすると、文字は正面を上に向けて寝ます。`heading: 180` と組み合わせると文字の上端が北を向くため、北を上にした地図で正しい向きに読めます。

```typescript
view.addMesh<Text3DMeshDesc>({
  text3D: {
    text: "Navara",
    font: "/fonts/your-font.ttf",
    depth: 10,
  },
  geodetic: { lng: 139.7671, lat: 35.6812, heading: 180, pitch: 90 },
});
```

## 対応仕様

### フォントフォーマット

| フォントフォーマット | 説明 |
| ------------------ | ---- |
| `.ttf` | TrueType フォント |
| typeface.json | three.js のフォント形式。フォントファイルから [facetype.js](https://gero3.github.io/facetype.js/) で変換します |

フォーマットは URL ではなく、ファイルの内容から判定されます。

:::note
- OTF フォントは読み込めますが、three.js 0.185 より前では文字の穴が正しく描画されません。WOFF2 フォントには対応していません。そのフォントの TTF ファイルを使用してください。
- バリアブルフォントは既定のスタイルで描画されます。特定のウェイトを使うには、静的なフォントファイルを使用してください。
:::

## 既知の制約

- **単純な文字組み**: 文字は送り幅に従って順に並べられます。カーニング、合字、右から左に書く文字や複雑な組版が必要な文字には対応していません。
- **フォントに含まれない文字**: フォントに含まれない文字は、フォントの代替グリフで描画されます。typeface.json フォントでは `?` のグリフが使われるため、`?` を含むフォントが必要です。改行として扱われるのは `\n` だけで、タブなどの他の制御文字は通常の文字として扱われます。
- **picking 非対応**: 文字は `pickable` に対応していません。
