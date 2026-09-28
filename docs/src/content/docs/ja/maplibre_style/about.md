---
title: About
description: Navara 向け MapLibre Style サポート - 既存の MapLibre スタイルを 3D 地球儀上でレンダリング
sidebar:
  order: 1
---

## maplibre_style とは

`@navaramap/maplibre-style` は `MapLibreStylePlugin` を提供します。これは [MapLibre Style](https://maplibre.org/maplibre-style-spec/) JSON 仕様を解析し、そのソースとレイヤーを Navara のレイヤー操作とフィーチャーごとの評価器に変換します。これにより、既存の MapLibre GL JS スタイルを最小限の変更で Navara の 3D 地球儀上にレンダリングできます。

プラグインが処理するもの：
- **式の評価** - すべての MapLibre 式（数学、決定、検索、zoom など）
- **背景レイヤー** - インテリジェントなキャッシュを使用して地球の色/不透明度にマッピング
- **複数のソースタイプ** - Vector、raster、raster-DEM、GeoJSON
- **シンボルレイヤー** - SDF テキストと自動デクラッタリングを使用したテキストとアイコンのレンダリング
- **フォント設定** - CSS または直接 font-faces からの柔軟なフォント読み込み

## パッケージ概要

```text
@navaramap/maplibre-style
  ├── MapLibreStylePlugin (メインプラグインクラス)
  └── フォントヘルパー
        ├── fetchFontStyleOverrides (CSS URL からフォントを取得)
        ├── fontFamilyToStyleOverrides (FontFamily をスタイルオーバーライドに変換)
        └── convertFontFacesToFontFamilies (スタイル font-faces を FontFamily に変換)
```

## インストール

```bash
npm install @navaramap/maplibre-style
```

## クイックスタート

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

## 主な機能

### 式のサポート

すべての [MapLibre 式演算子](https://maplibre.org/maplibre-style-spec/expressions/) をサポート：

- **検索:** `get`, `has`, `in`, `index-of`, `length`
- **決定:** `case`, `match`, `coalesce`
- **型:** `to-boolean`, `to-number`, `to-string`, `to-color`, `array`, `literal`, `typeof`
- **文字列:** `concat`, `upcase`, `downcase`
- **数学:** `+`, `-`, `*`, `/`, `%`, `^`, `sqrt`, `log10`, `ln`, `abs`, `ceil`, `floor`, `round`, `min`, `max`
- **比較:** `==`, `!=`, `>`, `>=`, `<`, `<=`
- **論理:** `!`, `all`, `any`
- **Zoom:** `zoom` (現在のカメラズームを使用、ズーム変更時に自動再評価)
- **ジオメトリ:** `geometry-type`, `id`, `properties`

### 背景レイヤーの最適化

背景レイヤーはインテリジェントに管理されます：
- **自動キャッシュ** - 評価器は一度コンパイルされ、レイヤーまたはペイントが変更されるまで再利用されます
- **Zoom 依存性の検出** - 背景は zoom 式または zoom 制約を使用する場合にのみ再評価されます
- **複数レイヤーのサポート** - 複数の背景レイヤーが存在する場合、最後に適用可能なレイヤー（`minzoom`/`maxzoom` と `visibility` を考慮）が使用されます

### フォント設定

フォントは複数の方法で読み込めます：
- **CSS から直接** - `fetchFontStyleOverrides()` で Google Fonts などの CSS URL から取得
- **手動設定** - `fontFamilyToStyleOverrides()` で FontFamily オブジェクトを変換
- **スタイルオーバーライド** - `overrides` オプション経由でフォントを渡す

詳細は [フォント設定](../maplibre-style-plugin/#with-font-configuration) を参照してください。

## 他のパッケージとの関係

```text
@navaramap/three (コア: ThreeView, Plugin, Source, Layer)
  ├── @navaramap/three-default-plugin (DefaultPlugin: descriptor 登録)
  └── @navaramap/maplibre-style (MapLibreStylePlugin: MapLibre Style サポート)
        └── @maplibre/maplibre-gl-style-spec を式評価に使用
```

## サポートされている機能

プラグインは MapLibre Style 仕様の実用的なサブセットをサポート：

**レイヤータイプ:** `fill`, `fill-extrusion`, `line`, `circle`, `symbol`, `raster`, `hillshade`, `background`

**ソースタイプ:** `vector`, `raster`, `raster-dem`, `geojson`

**式:** zoom 依存式を含むすべての演算子

実装されているプロパティの完全なリストは [サポートされている機能](../supported-features/) を参照してください。

## サポートされていない機能

- **Sky と heatmap レイヤー** - 未実装
- **スプライトベースのアイコン** - `fill-pattern`, `line-pattern` 非サポート
- **高度な線スタイリング** - Dasharray、gradient、caps、joins 未実装
- **カメラ式** - `pitch`, `distance-from-center` などは利用不可
- **Glyphs プロトコル** - 代わりにスタイルオーバーライド経由で `font-faces` を使用

## 関連リソース

- [MapLibreStylePlugin](../maplibre-style-plugin/) - 使い方ガイド、API リファレンス、フォント設定
- [サポートされている機能](../supported-features/) - 完全な機能マトリックス
