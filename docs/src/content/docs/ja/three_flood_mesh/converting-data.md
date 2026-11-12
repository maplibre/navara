---
title: データの変換
description: 洪水シミュレーションの出力から TimeSeriesFloodMeshDesc が読む Zarr グループを navara-flood-zarr コマンドか変換 API で書き出す
sidebar:
  order: 4
since: nightly
---

`@navaramap/three-flood-mesh/convert` エントリーは、このパッケージが読む Zarr グループを、計算済みの `signed_distance` を含めて書き出します。ブラウザでも Node でも動き、`three` も `@navaramap/three` も必要ありません。入力は必要になってから読むファイルで、ブラウザの `File` か `{ name, read }` の組です。出力は空の書き込み可能な zarrita ストアで、ブラウザなら `Map`、Node なら `FileSystemStore` などです。`navara-flood-zarr` コマンド（Node）は、設定ファイルに従ってパスに対して変換関数を実行します（[コマンド](#コマンド) を参照）。ブラウザ用エントリー `@navaramap/three-flood-mesh` にはどちらも含まれません。

[洪水データの作り方](../preparing-data/) で、種類ごとに実際のデータセットを変換し、どの変換関数を選ぶかを説明しています。

| 変換関数          | `"type"`     | `"format"`          | 入力                                                                                           |
| ----------------- | ------------ | ------------------- | ---------------------------------------------------------------------------------------------- |
| `convertRasters`  | `"rasters"`  | `"csv"`, `"netcdf"` | 時刻ごとの等間隔格子の値。浸水セルを並べた CSV ファイルか、時刻ごとに 1 つの netCDF のラスター |
| `convertMesh`     | `"mesh"`     | `"csv"`, `"netcdf"` | 時刻ごとの非構造メッシュ上の値。CSV ファイルか、netCDF ファイル                                |
| `convertPolygons` | `"polygons"` | `"czml"`            | 時刻ごとの浸水域の輪郭を持つ CZML ファイル                                                     |

`"type"` はデータの形で、これで変換関数が決まります。`"format"` は読み込む形式で、既定では入力の拡張子から決めます（`.csv`、`.nc`・`.grd`・`.sww`、`.czml`）。

各変換関数のオプションは [変換関数](../api/converters/) にあります。

どれも書き出した内容（`FloodZarrInfo`）を返します。格子の大きさ、残したフレーム、一度でも浸水するセルの数と、`textureBytes`（水面と保存した各プロパティの表示中に必要な GPU メモリ。[GPU メモリ](../how-it-works/#gpu-メモリ) を参照）です。

## 高さ

`loadTimeSeriesFlood` は WGS84 楕円体高を扱います。`VerticalDatum` は、基準面の楕円体からの高さを足して入力の高さを楕円体高に変換するもので、変換関数は一度でも浸水したすべてのセルの中心で一度だけそれをサンプリングします。`TileGeoid` は、コマンドが地形をサンプリングするのと同じ方法で `raster-dem` ソースからそれを読みます。CSV とラスターの変換関数の既定は、日本のシミュレーション出力に合わせて EGM2008 の標高（`Egm2008Geoid`）、`convertPolygons` の既定は CZML に合わせて楕円体高（`Ellipsoid`）です。Node では EGM2008 のタイルを任意の peer dependency の `sharp` で読みます。ブラウザでは自前で復号します。

地盤高を指定すると、変換関数はそれを水位と同じ基準で `ground` プロパティとして保存し、グループの `ground` 属性でその名前を示します。`loadTimeSeriesFlood` はそこから `depth` を派生させます。

頂点が水面の高さだけを持つ CZML のように地盤高のないデータは、地形から地盤高を取れます（`terrain`。`convertRasters` と `convertPolygons` で使えます）。地形には、`addSource` と同じ形の楕円体高の `raster-dem` ソースか、`TerrainSampler` を渡します。変換関数は、一度でも浸水したすべてのセルの中心で一度だけ地形をサンプリングし、その高さを保存します。`raster-dem` ソースは、`@navaramap/three` の `sampleTerrainMostDetailed` と同じように、エンジンの WASM を使ってサンプリングします。ブラウザでも、`ThreeView` が動かない Node でも使えます。Node ではタイルを `sharp` で復号します。`TerrainSampler` は `sampleTerrainMostDetailed` と同じ形の関数です。`ThreeView` があれば、`(positions) => view.sampleTerrainMostDetailed(terrainSource, positions)` でビューが表示している地形から取れます。ただし、地形レイヤーで高さを誇張していないときに限ります。この地形はシミュレーションが使った地盤とは別物なので、水が浅いところでは、両者の差が水深を上回ります。水面が地形より低いのに浸水しているセルもあり、その水深は 0 になります。

投影座標は `Projection`（`projection`）で変換します。`PlaneRectangular` は JGD2011 の平面直角座標系（EPSG:6669 から EPSG:6687）で、各組を東向き・北向きの順、つまり測量の Y 列、X 列の順に取ります。

## コマンド

コマンドの引数は設定ファイル一つで、変換関数のオプション（`ConvertConfig`）を、その `"type"` と、拡張子で分からないときは `"format"` とともに書きます。パスと glob パターンはファイルからの相対です。大抵は JSON で足ります。同じオブジェクトを default export する JavaScript モジュールなら、`properties` のコールバックや `VerticalDatum`、`Projection` のインスタンスも書けます。

設定ファイルでは、一部のオプションを API と違う形で書きます。

- `interval`：秒数、または `"30m"`、`"1h"` のような時間。
- `maxLevelError` と `maxErrorShare`（既定は `0.01`）：`tolerance` の各フィールド。
- `properties`：名前ごとに取得元の名前、または `source`、`precision`、`units`、`label`。
- `datum`：`"egm2008"`、`"ellipsoid"`、または `VerticalDatum` を default export するモジュールのパス。
- `terrain`：`addSource` と同じ形の `raster-dem` ソース。`elevationDecoder` には、`ElevationDecoder.terrarium()` なら `"terrarium"` のようにエンジンの decoder の名前（`"japanGSI"`、`"mapbox"`、`"terrarium"`）を書くか、すべてのフィールドを書きます。モジュールなら代わりに `TerrainSampler` を渡せます。
- `projection`：JGD2011 の平面直角座標系の系の EPSG コード（`"EPSG:6669"` から `"EPSG:6687"`）、または `Projection` を default export するモジュールのパス。
- `timePattern`：パターンの文字列。
- `epoch`：日時の文字列。

コマンドは変換関数が書き出した内容を表示し、変換が成功したときにだけ `output` のグループを置き換えます。Node 22 以降が必要です。省略可能なピア依存はパッケージと一緒にはインストールされません。EGM2008 の高さを変換するか地形をサンプリングするなら `sharp` を、netCDF-4 を読むなら `h5wasm` をインストールしてください。

```sh
# パッケージをインストール済みの場合
npx navara-flood-zarr flood.json
# インストールしていない場合
npx -p @navaramap/three-flood-mesh@nightly -p sharp navara-flood-zarr flood.json
```

```json
{
  "type": "rasters",
  "inputs": ["csv/flood_*m.csv"],
  "output": "flood.zarr",
  "corners": [
    ["west", "south"],
    ["east", "north"]
  ],
  "ground": "ground",
  "depth": "depth",
  "timePattern": "_(\\d+)m\\.csv$",
  "timeUnit": "minutes",
  "epoch": "2026-01-01T00:00:00Z",
  "interval": "30m",
  "maxLevelError": 0.05,
  "properties": {
    "speed": {
      "source": "speed",
      "precision": 0.001,
      "units": "m/s",
      "label": "flow speed"
    }
  }
}
```

地盤高のない CZML で、楕円体高を Mapbox Terrain-RGB のタイルで配信する [Re:Earth Terrain](https://terrain.reearth.land/) から地盤高を取る場合：

```json
{
  "type": "polygons",
  "input": "flood-simulation.czml",
  "output": "flood.zarr",
  "terrain": {
    "type": "raster-dem",
    "url": "https://terrain.reearth.land/mapterhorn-egm08/mapbox/ellipsoid/{z}/{x}/{y}.webp",
    "maxZoom": 14,
    "elevationDecoder": "mapbox"
  }
}
```

平面直角座標系 9 系の 25 m 格子のセルで、高さが T.P. の場合：

```json
{
  "type": "rasters",
  "inputs": ["result_*.csv"],
  "output": "flood.zarr",
  "center": ["Y", "X"],
  "projection": "EPSG:6677",
  "resolution": 25,
  "level": "level",
  "timePattern": "_(\\d+)\\.csv$",
  "timeUnit": "minutes",
  "epoch": "2024-06-01T00:00:00Z"
}
```

津波シミュレーションの netCDF のラスターを、ラスターの流速を保存するモジュールで変換する場合（流速の大きさは読み込み時に導出します）：

```javascript
export default {
  type: "rasters",
  output: "tsunami.zarr",
  inputs: ["eta/eta_*.nc"],
  series: { u: ["u/u_*.nc"], v: ["v/v_*.nc"] },
  ground: "bathymetry.nc",
  groundScale: -1,
  projection: "EPSG:6674",
  resolution: 5,
  timePattern: "_(\\d+)\\.nc$",
  timeUnit: "seconds",
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  properties: ({ u, v }) => ({ flow_east: u, flow_north: v }),
  precision: { flow_east: 0.01, flow_north: 0.01 },
  units: { flow_east: "m/s", flow_north: "m/s" },
};
```

## API の使い方

Node で、API でファイルに対して変換する場合：

```typescript
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import FileSystemStore from "@zarrita/storage/fs";
import {
  convertRasters,
  VerticalDatum,
  type TerrainPosition,
} from "@navaramap/three-flood-mesh/convert";

// 楕円体から 40 m 上のジオイドを基準とする標高。
class ConstantGeoid extends VerticalDatum {
  readonly name = "geoid at 40 m";
  offsets(positions: TerrainPosition[]) {
    return positions.map(() => 40);
  }
}

await convertRasters({
  inputs: ["flood.csv"].map((path) => ({
    name: basename(path),
    read: () => readFile(path),
  })),
  output: new FileSystemStore("flood.zarr"),
  corners: [
    ["west", "south"],
    ["east", "north"],
  ],
  level: "level",
  time: "time",
  datum: new ConstantGeoid(),
  // 位置と時刻を除く列が数値で渡る。
  properties: ({ speed, depth }) => ({
    speed,
    rank: Number(depth) >= 3 ? 2 : Number(depth) >= 0.5 ? 1 : 0,
  }),
  precision: { speed: 0.01, rank: 1 },
  units: { speed: "m/s" },
});
```

ブラウザで、ユーザーが選んだファイルを、`ThreeView` が表示している地形から地盤高を取りながらメモリ上に変換して表示する場合：

```typescript
import { convertPolygons } from "@navaramap/three-flood-mesh/convert";
import { loadTimeSeriesFlood } from "@navaramap/three-flood-mesh";

const store = new Map<string, Uint8Array>();
await convertPolygons({
  input: fileInput.files[0],
  output: store,
  resolution: 25,
  terrain: (positions) =>
    view.sampleTerrainMostDetailed(terrainSource, positions),
  properties: ["depth"],
  precision: { depth: 0.01 },
});
const series = await loadTimeSeriesFlood({ store });
```
