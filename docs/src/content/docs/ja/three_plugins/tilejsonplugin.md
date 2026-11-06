---
title: TileJsonPlugin
description: TileJSON 3.0.0 ドキュメントの URL から navara_three にタイルソースを登録するプラグイン。
sidebar:
  order: 6
---

## 概要

`TileJsonPlugin` は [TileJSON 3.0.0](https://github.com/mapbox/tilejson-spec/tree/master/3.0.0) ドキュメントを取得し、それを 1 つの Navara ソースとして登録します。タイル URL テンプレート、ズーム範囲、アトリビューションを手作業で `view.addSource()` にコピーする代わりに、ドキュメントの URL をプラグインに渡すだけで、これらのフィールドをドキュメントから導出します。

`addSource()` は [`ThreeView.addSource`](../../three/source/about/) と同じ形をしています。判別用の `type` と任意の `id` を渡しますが、`url` はタイルテンプレートではなく TileJSON ドキュメントを指します。

ドキュメントの `attribution` クレジットは、ビュー組み込みのアトリビューション UI（[`view.attribution`](../../three/plugins/attributionplugin/)）を通じて自動的に表示されます。

TileJSON にはラスター画像・ベクトルタイル・標高タイルを確実に見分けるフィールドがないため、対象となるソースの `type`（`"raster-tile"`、`"vector-tile"`、または `"raster-dem"`）は呼び出し側が指定します。

独自のクレジット UI を構築したい場合は、組み込み UI を無効化し（`new ThreeView({ defaultAttribution: false })`）、各ドキュメントのアトリビューションを [`loaded`](#イベント) イベントから受け取ってください。

## 使い方

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { TileJsonPlugin } from "@navaramap/three-plugins";

const view = new ThreeView({ container });

const tilejson = new TileJsonPlugin();

view.addPlugin(new DefaultPlugin());
view.addPlugin(tilejson);
await view.init();

// TileJSON ドキュメントを取得し、ラスターソースとして登録します。ドキュメントの
// `minzoom` / `maxzoom` / `scheme` はソースへ引き渡され、`attribution` は
// 組み込みのアトリビューション UI によって表示されます。
const source = await tilejson.addSource({
  type: "raster-tile",
  id: "basemap",
  url: "https://example.com/tiles.json",
});

// 返されたハンドルでソースを参照するか…
view.addLayer({ type: "raster", source });
// id を直接参照します。
view.addLayer({ type: "raster", source: "basemap" });

const dem = await tilejson.addSource({
  type: "raster-dem",
  url: "https://example.com/terrain.json",
});
view.addLayer({ type: "terrain", source: dem });
```

## コンストラクタ

```typescript
new TileJsonPlugin();
```

プラグインは `view.init()` の**前に** `view.addPlugin()` で登録してください。コンストラクタはオプションを取りません。アトリビューションはビュー組み込みの UI で処理され、独自の UI を使いたい場合は [`loaded`](#イベント) イベントを購読します。

## メソッド

### addSource(desc)

```typescript
addSource(desc: TileJsonSourceDescription): Promise<Source>
```

`desc.url` にある TileJSON ドキュメントを取得し、指定した `desc.type` のソースを 1 つ作成します。`view.init()` の**後に**呼び出してください。それ以前に呼ぶと例外が投げられます。

ドキュメントから作成されるソースへのマッピングは次のとおりです。

| TileJSON フィールド | `raster-tile` ソース      | `raster-dem` ソース                          | `vector-tile` ソース              |
| ------------------- | ------------------------- | -------------------------------------------- | --------------------------------- |
| `tiles[0]`          | `url`                     | `url`                                        | `url`                             |
| `minzoom`           | `minZoom`                 | `minZoom`                                    | —（エンジンに該当フィールドなし） |
| `maxzoom`           | `maxZoom`                 | `maxZoom`                                    | `maxZoom`                         |
| `scheme: "tms"`     | `tms: true`               | `tms: true`                                  | —（エンジンに該当フィールドなし） |
| `tileSize`          | —                         | `tileSize`（デフォルト `512`）               | —                                 |
| `encoding`          | —                         | `elevationDecoder`（デフォルト `"mapbox"`）  | —                                 |
| `attribution`       | `view.attribution` で表示 | `view.attribution` で表示                    | `view.attribution` で表示         |

表の `tiles[0]` と `attribution` を除く各フィールドは、`desc` 側でも同名で指定できます。指定した場合は取得したドキュメントの値より優先されます。`raster-dem` では `encoding` が標高デコーダー（`"mapbox"` または `"terrarium"`）を選択し、未知のエンコーディングの場合は誤ったデコーダーでソースを作らず、呼び出しが失敗します。

TileJSON の `tiles` 配列には、同じタイルセットに対する複数のミラーエンドポイントが列挙されることがあります。Navara のソースは単一の URL を取るため、最初のエンドポイントのみを使用し、残りは `console.warn` を出して無視します。

`attribution` クレジットはビュー組み込みのアトリビューション UI（`view.attribution`）に追加されます。複数回の `addSource()` から得たクレジットは重複が除去されるため、共有・重複するクレジットは 1 度だけ表示されます。組み込み UI を無効化している場合（`defaultAttribution: false`）はこの処理はスキップされます。その場合は [`loaded`](#イベント) イベントからアトリビューションを取得してください。

ソースの登録後、作成されたソース・解析済みドキュメント・そのアトリビューションを伴って [`loaded`](#イベント) イベントが発火します。

戻り値は作成された [`Source`](../../three/source/about/) ハンドルです。レイヤーは、返されたハンドルまたは `desc.id` のいずれかで参照できます。

### on / once / off

```typescript
on<E extends keyof TileJsonPluginEventMap>(event: E, listener: TileJsonPluginEventMap[E]): void
once<E extends keyof TileJsonPluginEventMap>(event: E, listener: TileJsonPluginEventMap[E]): void
off<E extends keyof TileJsonPluginEventMap>(event: E, listener: TileJsonPluginEventMap[E]): void
```

プラグインの[イベント](#イベント)を購読・1 回だけ購読・購読解除します。ペイロードは [`loaded`](#イベント) を参照してください。

### dispose()

```typescript
dispose(): void
```

このプラグインが `view.attribution` に追加したクレジットを（HTML による構造的マッチで）取り除き、すべてのイベントリスナーを解除します。組み込み UI はプラグインではなくビューが所有するため、削除されるのはこのプラグインが追加したクレジットのみで、UI 全体ではありません。ビューが先に破棄された場合、`view.attribution` は既に存在せず、この処理は何もしません。

## イベント

[`on`](#on--once--off) / `once` で購読し、`off` で購読解除します。

### loaded

`addSource()` が成功するたびに、ソースの登録後に 1 度発火します。ペイロードにより、組み込み UI に頼らず独自のクレジット UI を駆動できます。

| プロパティ    | 型                    | 説明                                                         |
| ------------- | --------------------- | ------------------------------------------------------------ |
| `source`      | `Source`              | ドキュメントに対して作成された Navara ソース。               |
| `tilejson`    | `TileJson`            | 取得・検証済みの TileJSON ドキュメント。                     |
| `attribution` | `string \| undefined` | ドキュメントが `attribution` を宣言している場合、その HTML。 |

```typescript
const view = new ThreeView({ container, defaultAttribution: false });
const tilejson = new TileJsonPlugin();
view.addPlugin(tilejson);
await view.init();

tilejson.on("loaded", ({ source, attribution }) => {
  if (attribution) renderMyCredit(source.id, attribution);
});
```

## 型

### TileJsonSourceType

```typescript
type TileJsonSourceType = "raster-tile" | "vector-tile" | "raster-dem";
```

TileJSON ドキュメントをどの Navara ソースタイプとして具体化するか。TileJSON にはラスター画像・ベクトルタイル・標高タイルを確実に見分けるフィールドがないため、呼び出し側が指定します。

### TileJsonSourceDescription

```typescript
type TileJsonSourceDescription =
  | TileJsonRasterTileSourceDescription
  | TileJsonVectorTileSourceDescription
  | TileJsonRasterDemSourceDescription;
```

`type` で判別されるユニオン型です。すべてのバリアントが以下のフィールドを共有します。「ドキュメントを上書き」とあるフィールドは省略可能で、指定した場合は取得したドキュメントの同名フィールドの値より優先されます。

| プロパティ | 型                    | 説明                                                                                                                                            |
| ---------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`     | `TileJsonSourceType`  | 作成する Navara ソースタイプ（`addSource` と同様）。                                                                                            |
| `url`      | `string`              | 取得・展開する TileJSON 3.0.0 ドキュメントの URL（タイルテンプレートではありません）。                                                          |
| `id`       | `string \| undefined` | 任意の呼び出し側指定ソース ID。返されたハンドルを保持せずに id でレイヤーからソースを参照するのに便利です。省略した場合はエンジンが生成します。 |
| `minzoom`  | `number \| undefined` | ドキュメントの `minzoom` を上書きします。                                                                                                       |
| `maxzoom`  | `number \| undefined` | ドキュメントの `maxzoom` を上書きします。                                                                                                       |
| `scheme`   | `"xyz" \| "tms" \| undefined` | ドキュメントの `scheme` を上書きします。                                                                                                |

`raster-dem` バリアント（`TileJsonRasterDemSourceDescription`）では、さらに次のフィールドを指定できます。

| プロパティ | 型                                 | 説明                                                                 |
| ---------- | ---------------------------------- | -------------------------------------------------------------------- |
| `tileSize` | `number \| undefined`              | ドキュメントの `tileSize` を上書きします。デフォルトは `512` です。  |
| `encoding` | `TileJsonDemEncoding \| undefined` | ドキュメントの `encoding` を上書きします。デフォルトは `"mapbox"` です。 |

### TileJsonDemEncoding

```typescript
type TileJsonDemEncoding = "mapbox" | "terrarium";
```

`raster-dem` ドキュメントの RGB タイルが標高をどのようにエンコードしているか。MapLibre の `encoding` の値に対応します。MapLibre の `"custom"`（自由形式のデコード係数）はサポートしていません。

### TileJsonLoadedEvent

[`loaded`](#loaded) イベントのペイロード。上記の表を参照してください。

### TileJson

このプラグインが利用する TileJSON 3.0.0 ドキュメントの部分集合です。その他の仕様フィールド（`bounds`、`center`、`grids` など）は無視されます。

| プロパティ    | 型                    | デフォルト | 説明                                                                                          |
| ------------- | --------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `tilejson`    | `string`              | —          | ドキュメントが準拠する TileJSON 仕様の semver（例: `"3.0.0"`）。省略可能です。                    |
| `tiles`       | `string[]`            | —          | タイル URL テンプレート（`{z}/{x}/{y}`）。仕様上、必須かつ空でない配列です。                  |
| `attribution` | `string \| undefined` | —          | ビュー組み込みのアトリビューション UI を通じて表示されるアトリビューション／クレジット HTML。 |
| `minzoom`     | `number \| undefined` | `0`        | 最小ズームレベル。ラスターソースにのみ適用されます。                                          |
| `maxzoom`     | `number \| undefined` | `30`       | 最大ズームレベル。                                                                            |
| `scheme`      | `"xyz" \| "tms"`      | `"xyz"`    | タイルスキーム。`"tms"` は Y 軸を反転します（ラスターソースのみ）。                           |
| `tileSize`    | `number \| undefined` | `512`      | タイルサイズ（ピクセル）。TileJSON 仕様にはありませんが、MapLibre 向けタイルサーバーが出力します。`raster-dem` ソースにのみ適用されます。 |
| `encoding`    | `TileJsonDemEncoding \| undefined` | `"mapbox"` | DEM タイルの標高エンコーディング。TileJSON 仕様にはありませんが、MapLibre 向けタイルサーバーが出力します。`raster-dem` ソースにのみ適用されます。 |

ドキュメントは取得時に検証されます。`tilejson` が存在するが `major.minor.patch` 形式のバージョンでない場合、あるいは `tiles` が欠けている、または空の場合、`addSource()` は失敗します。`tilejson` が欠けている場合は、MapLibre と同様に受け付けます。

## 補足

- **タイルテンプレートではなくドキュメントの URL。** `desc.url` は TileJSON JSON ドキュメントのアドレスです。タイル URL テンプレートはドキュメントの `tiles` フィールドから得られます。ここに `{z}/{x}/{y}` テンプレートを渡さないでください。
- **ソースの `type` は指定が必要。** TileJSON はタイルセットがラスター画像・ベクトル・標高データのいずれかを示さないため、ドキュメントが配信するタイルに合わせて `"raster-tile"`、`"vector-tile"`、または `"raster-dem"` を選んでください。
- **ベクトルソースは `minzoom` と `scheme` を無視します。** エンジンのベクトルタイルソースには `minZoom` や `tms` フィールドがないため、`"vector-tile"` では `maxzoom` のみが引き継がれます。
- **`tileSize` と `encoding` は MapLibre 拡張です。** TileJSON 仕様にはありませんが、MapLibre 向けの DEM タイルサーバーが一般的に含めており、デフォルト値（`512` / `"mapbox"`）も MapLibre に合わせています。`encoding` が `"mapbox"` / `"terrarium"` 以外の場合、`addSource()` は失敗します。

## 関連リソース

- [AttributionPlugin](../../three/plugins/attributionplugin/): `view.attribution` で参照できる組み込みのアトリビューション（クレジット）UI。このプラグインが既定で供給します
- [About three_plugins](../about/): パッケージ概要
- [Raster Layer](../../three/layer/raster-layer/): Raster レイヤーのリファレンス
- [Terrain Layer](../../three/layer/terrain-layer/): `raster-dem` ソースを描画する Terrain レイヤーのリファレンス

