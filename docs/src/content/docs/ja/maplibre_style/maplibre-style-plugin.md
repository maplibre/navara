---
title: Usage
description: Navara の 3D 地球儀上で MapLibre Style 仕様を解析してレンダリング
sidebar:
  order: 2
---

## 概要

`MapLibreStylePlugin` は [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON 仕様を解析し、そのソースとレイヤーを Navara のレイヤー操作に変換します。これにより、既存の MapLibre GL JS スタイルを最小限の変更で Navara の 3D 地球儀上にレンダリングできます。

## 基本的な使い方

MapLibre Style JSON をプラグインに渡し、`view.init()` の前に追加します：

```typescript
import ThreeView from "@navaramap/three";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";
import style from "./style.json";

const view = new ThreeView({ container });
view.addPlugin(new MapLibreStylePlugin(style));
await view.init();

// データソースをクレジット表示
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);
```

### URL から読み込む

静的な JSON ではなく、リモート URL からスタイルを読み込みます：

```typescript
import ThreeView from "@navaramap/three";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";

const view = new ThreeView({ container });
const styleUrl = "https://example.com/style.json";
view.addPlugin(new MapLibreStylePlugin(styleUrl));
await view.init();
```

プラグインは初期化中にスタイルを取得して解析します。

## 高度な使い方

### フォント設定を使用する

シンボルレイヤーからテキストラベルをレンダリングするには、フォントを事前に読み込み、スタイルオーバーライドとして渡します：

```typescript
import { MapLibreStylePlugin, fetchFontStyleOverrides } from "@navaramap/maplibre-style";

const fontOverrides = await fetchFontStyleOverrides(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap",
);

const plugin = new MapLibreStylePlugin(style, {
  overrides: fontOverrides,
});
view.addPlugin(plugin);
await view.init();
```

複数のフォントの場合：

```typescript
import { MapLibreStylePlugin, fetchFontStyleOverrides } from "@navaramap/maplibre-style";

const [openSans, roboto] = await Promise.all([
  fetchFontStyleOverrides("Open Sans", googleFontsUrl1),
  fetchFontStyleOverrides("Roboto", googleFontsUrl2),
]);

const plugin = new MapLibreStylePlugin(style, {
  overrides: {
    "font-faces": {
      ...openSans["font-faces"],
      ...roboto["font-faces"],
    },
  },
});
view.addPlugin(plugin);
await view.init();
```

### スタイルオーバーライド

スタイルオーバーライドを使用すると、元のスタイル JSON を編集せずにテキストレンダリング用のフォントフェイスを追加できます：

```typescript
const plugin = new MapLibreStylePlugin(style, {
  overrides: {
    // テキストレンダリング用の font-faces を追加
    "font-faces": {
      "Open Sans": [
        {
          url: "https://fonts.gstatic.com/.../opensans.woff2",
          "unicode-range": "U+0-7F",
        },
      ],
    },
  },
});
```

**注:** 現在、`font-faces` オーバーライドのみがサポートされています。他のプロパティ（`layers` や `sources` など）はマージされません。

## 完全な例

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import {
  MapLibreStylePlugin,
  fetchFontStyleOverrides,
} from "@navaramap/maplibre-style";

// フォントを読み込む
const fontOverrides = await fetchFontStyleOverrides(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap",
);

// スタイルを読み込む
const style = await fetch("https://example.com/style.json").then(r => r.json());

// プラグインを作成
const view = new ThreeView({ container });
const tileJsonPlugin = new TileJsonPlugin();
const maplibrePlugin = new MapLibreStylePlugin(style, {
  overrides: fontOverrides,
  tileJsonPlugin,
});

// プラグインを追加
view.addPlugin(new DefaultPlugin());
view.addPlugin(tileJsonPlugin);
view.addPlugin(maplibrePlugin);

await view.init();

// アトリビューションを追加
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);
```

## コンストラクタ

```typescript
new MapLibreStylePlugin(
  styleOrUrl: StyleSpecification | string,
  options?: MapLibreStylePluginOptions
)
```

新しい MapLibre Style プラグインインスタンスを作成します。

### パラメータ

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `styleOrUrl` | `StyleSpecification \| string` | MapLibre Style JSON オブジェクトまたは取得元の URL |
| `options` | `MapLibreStylePluginOptions` | オプション設定 |

### オプション

```typescript
type MapLibreStylePluginOptions = {
  overrides?: Partial<StyleSpecification>;
  tileJsonPlugin?: TileJsonPlugin;
  forceMapLibreFov?: boolean;
};
```

| オプション | 型 | デフォルト | 説明 |
|--------|------|---------|-------------|
| `overrides` | `Partial<StyleSpecification>` | `undefined` | 部分的なスタイルオーバーライド。現在、プラグインがマージするのは `font-faces` のみです。 |
| `tileJsonPlugin` | `TileJsonPlugin` | `undefined` | カスタム TileJsonPlugin インスタンス。提供されない場合、新しいものが作成され内部で管理されます。 |
| `forceMapLibreFov` | `boolean` | `false` | `true` の場合、カメラ計算に MapLibre の固定 FOV（~36.87°）を強制適用します。`false` または `undefined` の場合、Navara のデフォルト FOV を使用します。 |

### 例

```typescript
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";

// スタイルオブジェクトを使用
const plugin = new MapLibreStylePlugin(styleJson);

// スタイル URL を使用
const plugin = new MapLibreStylePlugin("https://example.com/style.json");

// オプション付き
const plugin = new MapLibreStylePlugin(styleJson, {
  overrides: await fetchFontStyleOverrides("Open Sans", cssUrl),
});
```

## メソッド

### dispose()

```typescript
dispose(): void
```

プラグインが削除されたときにすべてのリソースをクリーンアップします。イベントリスナーを削除し、レイヤー/ソースを削除し、子プラグインを破棄します。メモリリークを防ぐために、プラグインを削除する際にこのメソッドを呼び出してください。

`dispose()` を呼び出した後、プラグインインスタンスは再利用すべきではありません。

```typescript
plugin.dispose();
```

## ヘルパー関数

### fetchFontStyleOverrides()

```typescript
async function fetchFontStyleOverrides(
  familyName: string,
  cssUrl: string | string[]
): Promise<Partial<StyleSpecification>>
```

CSS URL（例：Google Fonts）からフォントファイルを取得し、`font-faces` 設定を含むスタイルオーバーライドを返します。

#### パラメータ

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `familyName` | `string` | 登録するフォントファミリー名（例："Open Sans"） |
| `cssUrl` | `string \| string[]` | フォントを取得する CSS URL |

#### 戻り値

`Promise<Partial<StyleSpecification>>` - `font-faces` フィールドが設定されたスタイルオーバーライド。

#### 例

```typescript
import { fetchFontStyleOverrides } from "@navaramap/maplibre-style";

const overrides = await fetchFontStyleOverrides(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap"
);

const plugin = new MapLibreStylePlugin(style, { overrides });
```

### fontFamilyToStyleOverrides()

```typescript
function fontFamilyToStyleOverrides(
  fontFamilies: FontFamily[]
): Partial<StyleSpecification>
```

Navara の `FontFamily` オブジェクトを MapLibre Style の `font-faces` 形式に変換します。

#### パラメータ

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `fontFamilies` | `FontFamily[]` | 変換する FontFamily オブジェクトの配列 |

#### 戻り値

`Partial<StyleSpecification>` - `font-faces` フィールドを含むスタイルオーバーライド。

#### 例

```typescript
import { fetchFontFamilyFromCss } from "@navaramap/three";
import { fontFamilyToStyleOverrides } from "@navaramap/maplibre-style";

const openSans = await fetchFontFamilyFromCss(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap"
);

const roboto = await fetchFontFamilyFromCss(
  "Roboto",
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400&display=swap"
);

const overrides = fontFamilyToStyleOverrides([openSans, roboto]);
const plugin = new MapLibreStylePlugin(style, { overrides });
```

### convertFontFacesToFontFamilies()

```typescript
function convertFontFacesToFontFamilies(
  fontFaces: FontFacesSpecification
): FontFamily[]
```

MapLibre Style の `font-faces` を Navara の `FontFamily` オブジェクトに変換します。既存のスタイルからフォントを抽出するのに便利です。

#### パラメータ

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `fontFaces` | `FontFacesSpecification` | MapLibre Style の font-faces オブジェクト |

#### 戻り値

`FontFamily[]` - Navara FontFamily オブジェクトの配列。

#### 例

```typescript
import { convertFontFacesToFontFamilies } from "@navaramap/maplibre-style";

// スタイルからフォントを抽出
const fontFamilies = convertFontFacesToFontFamilies(style["font-faces"]);

// フォントを手動で登録
for (const family of fontFamilies) {
  view.addFontFamily(family);
}
```

## 型

### MapLibreStylePluginOptions

```typescript
type MapLibreStylePluginOptions = {
  overrides?: Partial<StyleSpecification>;
  tileJsonPlugin?: TileJsonPlugin;
};
```

`MapLibreStylePlugin` コンストラクタの設定オプション。

詳細は [コンストラクタオプション](#オプション) を参照してください。

### StyleSpecification

`@maplibre/maplibre-gl-style-spec` で定義されています。完全なスキーマについては [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) を参照してください。

### FontFacesSpecification

`StyleSpecification` の一部で、テキストレンダリング用のフォントファイルを定義します：

```typescript
type FontFacesSpecification = {
  [familyName: string]:
    | FontFaceSpecification
    | FontFaceSpecification[];
};

type FontFaceSpecification = {
  url: string;
  "unicode-range"?: string | string[];
};
```

#### 例

```json
{
  "font-faces": {
    "Open Sans": [
      {
        "url": "https://fonts.gstatic.com/.../opensans-regular.woff2",
        "unicode-range": "U+0-7F"
      },
      {
        "url": "https://fonts.gstatic.com/.../opensans-japanese.woff2",
        "unicode-range": "U+3040-309F, U+30A0-30FF"
      }
    ]
  }
}
```

## ライフサイクル

プラグインは標準的な Navara プラグインライフサイクルに従います：

1. **構築** - `new MapLibreStylePlugin(style, options)`
2. **登録** - `view.addPlugin(plugin)` (`view.init()` の前)
3. **初期化** - `await view.init()` がプラグインの `init()` メソッドをトリガー
   - 必要に応じて URL からスタイルを取得
   - スタイルを解析して検証
   - `font-faces` からフォントを登録
   - 背景ハンドラーを初期化
   - ルートプロパティからカメラ位置を適用（center、zoom、pitch、bearing など）
   - すべてのソースとレイヤーを追加
   - zoom 変更検出を設定
4. **使用** - プラグインがアクティブになりスタイルを管理
5. **破棄** - `plugin.dispose()` がリソースをクリーンアップ

## 完全な例

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";
import {
  MapLibreStylePlugin,
  fetchFontStyleOverrides,
} from "@navaramap/maplibre-style";

// フォントを読み込む
const fontOverrides = await fetchFontStyleOverrides(
  "Open Sans",
  "https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap",
);

// スタイルを読み込む
const style = await fetch("https://example.com/style.json").then(r => r.json());

// プラグインを作成
const view = new ThreeView({ container });
const tileJsonPlugin = new TileJsonPlugin();
const maplibrePlugin = new MapLibreStylePlugin(style, {
  overrides: fontOverrides,
  tileJsonPlugin,
});

// プラグインを追加
view.addPlugin(new DefaultPlugin());
view.addPlugin(tileJsonPlugin);
view.addPlugin(maplibrePlugin);

await view.init();

// アトリビューションを追加
view.attribution?.add([
  {
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
  },
]);
```

## 関連リソース

- [サポートされている機能](../supported-features/) - 完全な機能マトリックス
- [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) - 公式仕様
