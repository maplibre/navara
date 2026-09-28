---
title: Supported Features
description: サポートされている MapLibre Style 機能とプロパティの完全なリスト
sidebar:
  order: 4
---

このページでは、`@navaramap/maplibre-style` がサポートするすべての MapLibre Style Spec 機能をリストします。以下にリストされているプロパティのみが実際に実装され機能します。同じレイヤータイプの他のプロパティは解析されますが無視されます。

## レイヤータイプ

### ✅ fill

塗りつぶしポリゴン。

**サポートされているペイントプロパティ:**
- `fill-color`
- `fill-opacity`

**サポートされていない:**
- `fill-outline-color`, `fill-antialias`, `fill-translate`, `fill-pattern` など

**例:**

```json
{
  "id": "water",
  "type": "fill",
  "source": "vector-source",
  "source-layer": "water",
  "paint": {
    "fill-color": "#0080ff",
    "fill-opacity": 0.5
  }
}
```

### ✅ fill-extrusion

3D 押し出しポリゴン（建物、地形フィーチャー）。

**サポートされているペイントプロパティ:**
- `fill-extrusion-color`
- `fill-extrusion-opacity`
- `fill-extrusion-height`
- `fill-extrusion-base`

**注:** 垂直高さ値のみ - 平行移動やパターンサポートなし。

**例:**

```json
{
  "id": "buildings",
  "type": "fill-extrusion",
  "source": "vector-source",
  "source-layer": "buildings",
  "paint": {
    "fill-extrusion-color": "#cccccc",
    "fill-extrusion-height": ["get", "height"],
    "fill-extrusion-base": ["get", "min_height"],
    "fill-extrusion-opacity": 0.9
  }
}
```

### ✅ line

ラインとストローク。

**サポートされているペイントプロパティ:**
- `line-color`
- `line-opacity`
- `line-width`

**サポートされていない:**
- `line-dasharray`, `line-pattern`, `line-cap`, `line-join`, `line-gradient` など

**例:**

```json
{
  "id": "roads",
  "type": "line",
  "source": "vector-source",
  "source-layer": "roads",
  "paint": {
    "line-color": "#ffffff",
    "line-width": 2,
    "line-opacity": 0.8
  }
}
```

### ✅ circle

円形ポイントフィーチャー。

**サポートされているペイントプロパティ:**
- `circle-color`
- `circle-opacity`
- `circle-radius`

**サポートされていない:**
- `circle-stroke-*`, `circle-blur`, `circle-translate`, `circle-pitch-scale` など

**例:**

```json
{
  "id": "cities",
  "type": "circle",
  "source": "geojson-source",
  "paint": {
    "circle-color": "#ff0000",
    "circle-radius": 5,
    "circle-opacity": 0.7
  }
}
```

### ✅ symbol

アイコンとテキストラベル。

**サポートされているペイントプロパティ:**
- `icon-color`
- `icon-opacity`
- `text-color`
- `text-opacity`
- `text-halo-color`（レイヤー構築時に一度だけ評価）
- `text-halo-width`（レイヤー構築時に一度だけ評価）

**サポートされているレイアウトプロパティ:**
- `icon-image`
- `icon-size`
- `text-field`
- `text-size`
- `text-font`

**機能:**
- スタイルオーバーライド経由でフォントを設定（[フォント設定](./font-configuration/) 参照）
- `text-font` が `font-faces` からフォントを選択（フォールバック用に文字列または配列をサポート）
- `text-halo-color` と `text-halo-width` が Navara の `outlineColor` と `outlineWidth` にマッピング
- テキストレンダリングは SDF（signed distance field）を使用
- Navara のデクラッタシステムによる自動ラベル重複除去

**制限:**
- `text-halo-*` 式はレイヤー構築時に一度だけ評価され、フィーチャーごとや zoom リアクティブではありません
- `text-anchor`, `icon-anchor`, `text-offset`, `icon-offset` は解析されますが適用されません
- テキスト回転やシンボルソートなし
- スプライトベースのアイコンなし

**例:**

```json
{
  "id": "place-labels",
  "type": "symbol",
  "source": "vector-source",
  "source-layer": "places",
  "layout": {
    "text-field": ["get", "name"],
    "text-font": ["Open Sans"],
    "text-size": 14
  },
  "paint": {
    "text-color": "#000000",
    "text-halo-color": "#ffffff",
    "text-halo-width": 2
  }
}
```

### ⚠️ raster (Layer)

ラスター画像表示レイヤー。

**サポート:**
- 基本的なラスタータイル表示

**サポートされていない:**
- `raster-opacity`, `raster-brightness-min`, `raster-brightness-max`, `raster-contrast`, `raster-saturation`, `raster-fade-duration` などのペイントプロパティは解析されますが適用されません

**例:**

```json
{
  "id": "satellite",
  "type": "raster",
  "source": "satellite-source"
}
```

### ⚠️ hillshade

標高データの陰影起伏可視化。

**サポート:**
- 基本的な陰影起伏レンダリング

**サポートされていない:**
- ペイントプロパティは処理されません

**例:**

```json
{
  "id": "hillshade",
  "type": "hillshade",
  "source": "dem-source"
}
```

### ✅ background

グローバル背景色/不透明度。

**サポートされているペイントプロパティ:**
- `background-color`
- `background-opacity`

**サポートされているレイアウトプロパティ:**
- `visibility`

**機能:**
- 背景レイヤーは `view.globe.color` と `view.globe.opacity` にマッピング
- ソース不要
- 複数の背景レイヤーが存在する場合、最後に適用可能なレイヤー（`minzoom`/`maxzoom` と `visibility` を考慮）が使用されます
- 背景評価器はキャッシュされ、アクティブレイヤーが変更されたときのみ再コンパイル
- Zoom 依存背景（zoom 式または zoom 制約を使用）は zoom 変更時に自動的に再評価

**例:**

```json
{
  "id": "background",
  "type": "background",
  "paint": {
    "background-color": "#000033",
    "background-opacity": 0.8
  }
}
```

### ❌ サポートされていない

- `sky` - 未実装
- `heatmap` - 未実装

## ソースタイプ

### ✅ geojson

GeoJSON フィーチャーコレクション。

**サポートされている形式:**

インラインデータ:
```json
{
  "type": "geojson",
  "data": {
    "type": "FeatureCollection",
    "features": [...]
  }
}
```

URL 参照:
```json
{
  "type": "geojson",
  "data": "https://example.com/data.geojson"
}
```

### ✅ vector

ベクタータイル（Mapbox Vector Tiles / MVT）。

**サポートされている形式:**

直接タイル URL:
```json
{
  "type": "vector",
  "tiles": ["https://example.com/{z}/{x}/{y}.pbf"]
}
```

TileJSON URL:
```json
{
  "type": "vector",
  "url": "https://example.com/tiles.json"
}
```

**注:** `tiles`（直接 URL 配列）と `url`（TileJSON）の両方がサポートされています。

### ✅ raster (Source)

画像用のラスタータイルソース。

**サポートされている形式:**

直接タイル URL:
```json
{
  "type": "raster",
  "tiles": ["https://example.com/{z}/{x}/{y}.png"],
  "tileSize": 256
}
```

TileJSON URL:
```json
{
  "type": "raster",
  "url": "https://example.com/tiles.json"
}
```

**注:** `tiles` と `url`（TileJSON）の両方がサポートされています。

### ✅ raster-dem

ラスター標高タイル。

**サポートされている形式:**

直接タイル URL:
```json
{
  "type": "raster-dem",
  "tiles": ["https://example.com/{z}/{x}/{y}.png"],
  "encoding": "terrarium"
}
```

TileJSON URL:
```json
{
  "type": "raster-dem",
  "url": "https://example.com/tiles.json",
  "encoding": "terrarium"
}
```

**サポートされているエンコーディング:**
- `terrarium` - Terrarium 形式（Mapzen/AWS terrain tiles）
- `mapbox` - Mapbox RGB エンコーディング

**機能:**
- 3D 地形レンダリング用の `terrain` プロパティと併用可能
- `tiles` と `url`（TileJSON）の両方がサポートされています

### ❌ サポートされていない

- `image` - 未実装
- `video` - 未実装
- `canvas` - 未実装

## 式のサポート

すべての [MapLibre 式演算子](https://maplibre.org/maplibre-style-spec/expressions/) がサポートされています：

### 検索

- `get` - フィーチャープロパティ値を取得
- `has` - フィーチャーがプロパティを持つか確認
- `in` - 値が配列内にあるか確認
- `index-of` - 配列内の値のインデックスを検索
- `length` - 配列の長さを取得

### 決定

- `case` - 条件分岐
- `match` - パターンマッチング
- `coalesce` - 最初の非 null 値

### 型

- `to-boolean` - boolean に変換
- `to-number` - 数値に変換
- `to-string` - 文字列に変換
- `to-color` - 色に変換
- `array` - 配列型をアサート
- `literal` - リテラル配列/オブジェクト
- `typeof` - 型名を取得

### 文字列

- `concat` - 文字列を連結
- `upcase` - 大文字に変換
- `downcase` - 小文字に変換

### 数学

- `+`, `-`, `*`, `/`, `%`, `^` - 算術演算子
- `sqrt`, `log10`, `ln` - 対数関数
- `abs`, `ceil`, `floor`, `round` - 丸め関数
- `min`, `max` - 最小/最大値

### 比較

- `==`, `!=` - 等価性
- `>`, `>=`, `<`, `<=` - 比較

### 論理

- `!` - 論理 NOT
- `all` - 論理 AND
- `any` - 論理 OR

### Zoom

- `zoom` - 現在のカメラ zoom レベル

**機能:**
- すべてのフィーチャーに現在のカメラ zoom を使用
- zoom が 0.1 以上変化すると自動的にフィーチャーを再評価
- zoom 変更時の表示/非表示にスムーズなフェードトランジション

### ジオメトリ

- `geometry-type` - フィーチャージオメトリタイプ
- `id` - フィーチャー ID
- `properties` - フィーチャープロパティオブジェクト

### カメラ（サポートされていない）

- `pitch` - カメラピッチ角度（利用不可）
- `distance-from-center` - 画面中心からの距離（利用不可）

## その他の機能

### Terrain

raster-DEM ソースからの 3D 地形レンダリング。

**例:**

```json
{
  "terrain": {
    "source": "dem-source",
    "exaggeration": 1.5
  }
}
```

### Font Faces

シンボルレイヤー用のフォント設定。

**例:**

```json
{
  "font-faces": {
    "Open Sans": [
      {
        "url": "https://fonts.gstatic.com/.../opensans.woff2",
        "unicode-range": "U+0-7F"
      }
    ]
  }
}
```

詳細は [フォント設定](./font-configuration/) を参照してください。

### Attribution

`url` フィールドを使用した TileJSON ソース使用時、ソースのアトリビューションが自動的に処理されます。

## パフォーマンス最適化

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

## 既知の制限

### ソース

- **複数のタイル URL** - `tiles` 配列の最初の URL のみ使用（負荷分散非サポート）

### レイヤー

- **限定的なプロパティサポート** - 多くの MapLibre Style Spec プロパティが未実装（上記のレイヤーセクション参照）
- **パターンやスプライトなし** - `fill-pattern`, `line-pattern`, スプライトベースのアイコン非サポート
- **高度な線スタイリングなし** - Dasharray、gradient、caps、joins 未実装
- **限定的なラスターサポート** - 基本表示のみ、ペイントプロパティなし
- **ヒートマップレイヤーなし** - 未実装
- **Sky レイヤーなし** - 未実装

### 式

- **カメラ式** - `pitch`, `distance-from-center` などは利用不可

### シンボルレイヤー

- **テキストハロー制限** - `text-halo-color` と `text-halo-width` はレイヤー構築時に一度だけ評価され、フィーチャーごとや zoom リアクティブではありません
- **テキスト回転なし** - 回転テキストの限定的サポート
- **シンボルソートなし** - z-order は `symbol-sort-key` で制御されません
- **テキストレンダリングの違い** - SDF テキストは MapLibre GL JS とわずかに異なる場合があります

### パフォーマンス

- **大量のフィーチャー数** - 数千のフィーチャーを持つシンボルレイヤーは低性能デバイスでパフォーマンスに影響する可能性があります
