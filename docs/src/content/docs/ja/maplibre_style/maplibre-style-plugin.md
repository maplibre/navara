---
title: MapLibreStylePlugin
description: Navara の 3D 地球儀上で MapLibre Style 仕様を解析してレンダリング
sidebar:
  order: 2
---

## 概要

`MapLibreStylePlugin` は [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON 仕様を解析し、そのソースとレイヤーを Navara のレイヤー操作に変換します。これにより、既存の MapLibre GL JS スタイルを最小限の変更で Navara の 3D 地球儀上にレンダリングできます。

プラグインは自動的に以下を処理します：
- 式の評価（サポートされている MapLibre 演算子。zoom 依存式を含む）
- インテリジェントなキャッシュを使用した背景レイヤー
- 複数のソースタイプ（vector、raster、raster-DEM、GeoJSON）
- SDF テキストレンダリングと自動デクラッタリングを使用したシンボルレイヤー
- CSS または直接 font-faces からのフォント設定

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
const styleUrl = "https://example.com/style.json";
const plugin = new MapLibreStylePlugin(styleUrl);
view.addPlugin(plugin);
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

#### 複数のフォント

異なるシンボルレイヤー用に複数のフォントを読み込みます：

```typescript
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
```

#### レイヤーでのフォント選択

シンボルレイヤーは `text-font` を使用してフォントを選択します：

```json
{
  "layout": {
    "text-field": ["get", "name"],
    "text-font": ["Open Sans"]
  }
}
```

フォールバックフォントの場合、複数のオプションを提供します：

```json
{
  "layout": {
    "text-font": ["Noto Sans CJK", "Open Sans", "Arial"]
  }
}
```

**注:** `glyphs` プロパティはサポートされていません。代わりにスタイルオーバーライド経由で `font-faces` を使用してください。

### カスタム TileJsonPlugin を使用する

`TileJsonPlugin` インスタンスを複数のプラグイン間で共有します：

```typescript
import { TileJsonPlugin } from "@navaramap/three-plugins";
import { MapLibreStylePlugin } from "@navaramap/maplibre-style";

const tileJsonPlugin = new TileJsonPlugin();

const plugin = new MapLibreStylePlugin(style, {
  tileJsonPlugin,
});

view.addPlugin(tileJsonPlugin);
view.addPlugin(plugin);
await view.init();
```

`tileJsonPlugin` を提供すると、プラグインは独自のインスタンスを作成せず、破棄もしません。

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

### Zoom 依存スタイル

プラグインは zoom 依存式を自動的に処理し、zoom 変更時にフィーチャーを再評価します：

```typescript
const style = {
  version: 8,
  sources: {
    // ... ソース
  },
  layers: [
    {
      id: "buildings",
      type: "fill-extrusion",
      source: "vector-source",
      "source-layer": "buildings",
      paint: {
        // 高さは zoom に応じて増加
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          0,
          16,
          ["get", "height"],
        ],
        // 色は zoom に応じて変化
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          "#cccccc",
          16,
          "#888888",
        ],
      },
    },
  ],
};
```

フィーチャーは zoom が 0.1 以上変化すると自動的に再評価され、スムーズなフェードトランジションが適用されます。

### 背景レイヤー

背景レイヤーは地球の色と不透明度にマッピングされます：

```typescript
const style = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#000033",
        "background-opacity": 0.8,
      },
    },
  ],
};
```

複数の背景レイヤーが存在する場合、最後に適用可能なレイヤー（`minzoom`/`maxzoom` と `visibility` を考慮）が使用されます。背景は式を使用して zoom レベルに応じて変化できます。

### 完全な例

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
};
```

| オプション | 型 | デフォルト | 説明 |
|--------|------|---------|-------------|
| `overrides` | `Partial<StyleSpecification>` | `undefined` | 部分的なスタイルオーバーライド。現在、プラグインがマージするのは `font-faces` のみです。 |
| `tileJsonPlugin` | `TileJsonPlugin` | `undefined` | カスタム TileJsonPlugin インスタンス。提供されない場合、新しいものが作成され内部で管理されます。 |

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
   - すべてのソースとレイヤーを追加
   - zoom 変更検出を設定
4. **使用** - プラグインがアクティブになりスタイルを管理
5. **破棄** - `plugin.dispose()` がリソースをクリーンアップ

## パフォーマンス

### 背景レイヤーのキャッシュ

- 評価器は一度コンパイルされキャッシュされます
- アクティブレイヤーまたはペイントが変更されたときのみ再コンパイル
- Zoom 依存性の検出により不要な再評価をスキップ

### Zoom 変更検出

- フィーチャーは zoom が 0.1 以上変化したときのみ再評価
- Zoom 依存性のないレイヤーは再評価をスキップ
- スムーズなフェードトランジションにより視覚的な不連続性を最小化

### 式のコンパイル

- 式は初期化時にレイヤーごとに一度コンパイル
- 評価器はレイヤー内のすべてのフィーチャーで再利用
- キャッシュされた評価器はペイントプロパティが変更されるまで持続

## 関連リソース

- [サポートされている機能](../supported-features/) - 完全な機能マトリックス
- [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/) - 公式仕様
