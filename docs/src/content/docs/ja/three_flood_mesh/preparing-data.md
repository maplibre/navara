---
title: 洪水データの作り方
description: 洪水シミュレーションの出力を種類ごとに例を挙げて時系列に変換する
sidebar:
  order: 5
since: nightly
---

`loadTimeSeriesFlood` は、緯度経度の等間隔格子上の水面の高さを持つ Zarr グループを読みます。そのグループを洪水シミュレーションの出力から書き出すのが `navara-flood-zarr` コマンドです。このページでは、入力の種類ごとに例を挙げて、元のファイルからビューアで再生できる時系列までを説明します。オプションの一覧は [変換関数](../api/converters/) にあります。

## 変換の選び方

| 手元のデータ                                                                    | `type` と形式       | 主な出典                                                                                |
| ------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| 浸水した格子セルを時刻ごとに 1 行ずつ並べた CSV（セルの四隅か中心の座標を含む） | `rasters`、CSV      | 国土交通省の浸水シミュレーションの CSV（25 m メッシュ）、平面直角座標系の格子の出力     |
| 時刻ごとに 1 つの netCDF のラスターファイル                                     | `rasters`、netCDF   | 等間隔格子の津波・洪水モデル                                                            |
| 時刻ごとの非構造メッシュ上の値（netCDF ファイルか CSV）、または点だけのデータ   | `mesh`、netCDF・CSV | TELEMAC、ANUGA、HEC-RAS 2D などの水理モデル（[mesh](#mesh非構造メッシュの出力) を参照） |
| 時刻ごとの浸水範囲を、頂点に水面の高さを持つ CZML のポリゴンで示したもの        | `polygons`、CZML    | PLATEAU の浸水シミュレーションの CZML                                                   |

`type` はデータの形で、これで変換関数（`convertRasters`、`convertMesh`、`convertPolygons`）が決まります。形式は、`format` で指定しなければ拡張子から決めます。

それぞれで残る情報が違います。

- **`rasters`** は、シミュレーションが計算したセルごとの値を、CSV の行かラスターからそのまま取り込みます。流速のような数値の列や同じ時刻のほかのラスターは、どれでもプロパティとして保存でき、流速ベクトルは[流れ](../how-it-works/#流れ)にもできます。`resolution` を指定すると、指定した格子の各セルの中にある元セルを平均するので、格子より細かいセルに向きます。高さは、日本のシミュレーション出力に合わせて既定では標高（EGM2008）として扱います。地盤高を指定すると、浸水深は保存せず読み込み時に導出します。
- **`polygons`** は、輪郭の頂点の水面の高さを内側のセルに補間するので、高さの滑らかさは輪郭しだいです。プロパティはパケットの `properties` からしか取れず、ポリゴンの色だけで示された区分は読めません。高さは、CZML に合わせて既定では WGS84 楕円体高として扱います。
- **`mesh`** は、メッシュの節点（または面）の値を三角形の上で補間し、指定した大きさの格子に取り直します。プロパティと地盤高は、ファイルの変数か節点と値の行から、`rasters` と同じように保存します。

## 手順

1. 入力を確認します。列やパケットの構成、文字コード、各時刻の時間の示し方、高さの基準を見ます。
2. 変換のオプションを設定ファイルに書きます。JSON か、コールバックでプロパティを導出するなら JavaScript モジュールです。パスと glob パターンはファイルからの相対で書きます。
3. コマンドを実行します。

   ```sh
   npx -p @navaramap/three-flood-mesh@nightly -p sharp navara-flood-zarr flood.json
   ```

4. 表示されるレポート（[レポートの見方](#レポートの見方) を参照）を読み、格子・フレーム数・GPU メモリがおかしければオプションを調整します。
5. Zarr グループを静的ファイルとして配信し、`loadTimeSeriesFlood({ url })` で読み込みます。空のチャンクは書き出されないので、存在しないチャンクにはサーバーが 404 を返す必要があります。どのパスにもページを返す SPA のフォールバックがあると、読み込みに失敗します。

### レポートの見方

下の [CSV の例](#rasters格子セルの-csv) では、コマンドは次のように表示します。

```
source 141 × 347 cells; grid 28.5 × 23.1 m (standard mesh / 40), 143 × 349 cells, 11 of 13 frames, 38349 wet cells in 5 tiles
GPU textures: 2.0 MB for the water surface, 1.0 MB for speed while shown, 0.1 MB for ground while shown
```

- `source`：入力を読み込んだ格子の大きさ（横と縦のセル数）。
- `grid`：セルの大きさと、それが標準地域メッシュの分割か、`resolution` で取り直したもの（`sampled`）か、どちらでもないか。シミュレーションと違う大きさなら、格子の検出を誤っています。
- `11 of 13 frames`：読み込んだ時刻のうち残したフレーム数。`interval` は時刻を間引き、`maxLevelError` はその後、他の時刻からの補間で再現できない時刻だけを残します。
- `wet cells`：一度でも浸水するセルの数。
- `GPU textures`：ビューアに必要なメモリ。フレームを減らすと小さくなります。

## rasters：格子セルの CSV

例として、破堤のシミュレーションが 6 時間分、10 分おきに 1 つの CSV を出力するとします。ファイル名は破堤からの分数です（`flood_0000m.csv`、`flood_0010m.csv`、…）。各行は標準地域メッシュを 40 分割した格子の浸水セルで、南西と北東の隅の座標を持ちます。

```
cell,ground,depth,speed,west,south,east,north
10800,10.00,0.10,0.00,135.0000000,35.0056250,135.0003125,35.0058333
10801,10.03,0.10,0.00,135.0003125,35.0056250,135.0006250,35.0058333
```

`ground`（地盤高）と `depth`（浸水深）の単位はメートルで、地盤高はジオイドからの高さです。`speed` は流速で、単位は m/s です。

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
      "label": "Flow speed"
    }
  }
}
```

- `corners`：対角の 2 隅から、セルの中心と大きさを求めます。
- `ground` と `depth`：足すと水位になります。地盤高も保存するので、`loadTimeSeriesFlood` が `depth` を導出し、ビューアは浸水深やその最大値で色分けできます。
- `timePattern`・`timeUnit`・`epoch`：パターンの最初のグループでファイル名から分数を取り出し、`epoch` から数えます。ここでの `epoch` は破堤時刻の仮の値です。
- `interval` と `maxLevelError`：37 時刻を 30 分おきに間引き（13 時刻）、さらに補間した水位が他の時刻と 5 cm 以内に収まる 11 フレームだけを残します。
- `properties`：流速を `speed` として、1 mm/s 単位にパックして保存します。

レポートの格子は標準地域メッシュの 40 分割です。保存するのは、シミュレーションが計算した値だけにします。ハザードマップの浸水深ランクのような区分は浸水深のしきい値なので、ビューアで `colorBy` の区切りとして適用します。

セルの中心で与えられた格子には、`corners` の代わりに `"center": ["lng", "lat"]` を指定します。セルの大きさは中心の間隔から求めます。平面直角座標系の格子は緯度経度の格子ではないので、`projection` と取り直す大きさの `resolution` を指定します（[コマンド](../converting-data/#コマンド) の例を参照）。

## polygons：CZML の浸水範囲の輪郭

例として、洪水シミュレーションが CZML を出力し、各パケットが各時刻の浸水範囲を格子のセルに沿った輪郭で示すとします。各パケットはその時刻の有効期間（`availability`）を持ち、各頂点に楕円体からの水面の高さがあります。

```json
{
  "id": "step-1",
  "availability": "2026-01-01T00:00:00Z/2026-01-01T01:00:00Z",
  "polygon": {
    "positions": {
      "cartographicDegrees": [135.0, 35.0, 48.5, 135.0003125, 35.0, 48.5, …]
    },
    "perPositionHeight": true
  }
}
```

設定にはファイルを書くだけです。

```json
{
  "type": "polygons",
  "input": "flood.czml",
  "output": "flood.zarr"
}
```

輪郭が格子に沿っていれば、格子は輪郭から求め、レポートに `standard mesh / 40` のように表示されます。レポートの三角形分割の外に出たセル（`cell-steps outside the triangulation`）は 0 になるはずです。0 でなければ輪郭が重なっているか格子に沿っていないので、代わりに `resolution` で格子に取り直します。

各時刻は、有効期間の始まりの時刻として扱います。各状態を期間の終わりの時刻で示す CZML では、`"time": "end"` を加えます。

深さ数十 cm の水は、別の標高モデルの地形では水面より地形が高くなって隠れることがよくあります。[`showUnderground`](../api/time-series-flood-mesh-desc/#showunderground) を使うと、こうした水を地形の上に描けます。

## mesh：非構造メッシュの出力

非構造メッシュのモデルは、場所によって間隔の違う節点（または面）で値を出します。`mesh` は、メッシュの三角形の上で線形補間して、`resolution` メートルの格子に取り直します。読むのは、メッシュと時刻ごとの値を持つ netCDF ファイル（UGRID 規約に従ったものか、`x`、`y`、`volumes` の三角形のもの）か、ほかの形式から書き出した CSV ファイルです。

### netCDF：ダム決壊の計算結果

例として、ダム決壊のシミュレーションが 2 秒おきに保存した netCDF ファイル `dam-break.nc` を出力するとします。平面直角座標系 6 系の節点 `x` と `y`、三角形 `volumes`、地盤高 `elevation` と、節点ごと・時刻ごとの水位 `stage` と運動量 `xmomentum`、`ymomentum` が入っています。コールバックで流速を求めるため、モジュールで変換します。

```js
// dam-break.mjs
export default {
  type: "mesh",
  input: "dam-break.nc",
  output: "dam-break.zarr",
  projection: "EPSG:6674",
  resolution: 20,
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  maxLevelError: 0.05,
  properties: ({ stage, elevation, xmomentum, ymomentum }) => ({
    speed: Math.hypot(xmomentum, ymomentum) / Math.max(stage - elevation, 0.01),
  }),
  precision: { speed: 0.01 },
  units: { speed: "m/s" },
  labels: { speed: "Flow speed" },
};
```

- `level` と `ground`：`volumes` の三角形のファイルでは既定で `stage` と `elevation` です。三角形の一部の節点が乾いているときは、そこで 0 として浸水深を補間するので、水は乾いた側へ向かって薄くなります。`minDepth`（0.01 m）より浅い節点とセルは乾いているとみなします。
- `projection`：節点は 6 系の東向き・北向きの座標です。モデル独自の局所座標なら、代わりに `Projection` を default export するモジュールのパスを指定します。
- `epoch`：このファイルの時刻は計算開始からの秒数です。ここでの `epoch` はダムの決壊時刻の仮の値です。
- `interval`：20 秒ごとに時刻を残し、そのうえで `maxLevelError` がキーフレームを選びます。
- `resolution`：モデルの最も細かい要素に近い大きさを選びます。粗い要素の上は補間するので、格子は要素より細かくて構いません。

UGRID のファイルでは、`"level": "mesh2d_s1"` のように `level`、`ground`、`depth` で変数名を指定します。面の上の値は、その面全体に入ります。

### CSV

ほかの形式は、3 種類の CSV に書き出します。

- `nodes.csv`：節点ごとに 1 行。`id`、位置、地盤高のように時間で変わらない列。
- `faces.csv`：面ごとに 1 行。`id` と、面を囲む順に並べた節点の id。四角形のセルのような 4 節点以上の面は三角形に分けます。
- 時刻ごとの値：浸水した節点ごとに 1 行。`id` と水位または浸水深、プロパティの列。行のない節点は乾いているとみなします。

次のスクリプトは、上の netCDF ファイルから 20 秒ごとに、浸水した節点だけを書き出します。形式ごとの節点・面・値を CSV に対応づける例です。

```python
import os

import numpy as np
import netCDF4

d = netCDF4.Dataset("dam-break.nc")
x = np.asarray(d["x"][:])
y = np.asarray(d["y"][:])
ground = np.asarray(d["elevation"][:])

with open("nodes.csv", "w") as f:
    f.write("id,x,y,ground\n")
    for i in range(len(x)):
        f.write(f"{i},{x[i]:.2f},{y[i]:.2f},{ground[i]:.3f}\n")
with open("faces.csv", "w") as f:
    f.write("id,n1,n2,n3\n")
    for k, (a, b, c) in enumerate(d["volumes"][:]):
        f.write(f"{k},{a},{b},{c}\n")

os.makedirs("values", exist_ok=True)
for k, t in enumerate(d["time"][:]):
    if t % 20:
        continue
    stage = np.asarray(d["stage"][k])
    depth = stage - ground
    speed = np.hypot(d["xmomentum"][k], d["ymomentum"][k]) / np.maximum(depth, 0.01)
    wet = depth > 0.01
    with open(f"values/step_{int(t):05d}s.csv", "w") as f:
        f.write("id,level,speed\n")
        for i in np.nonzero(wet)[0]:
            f.write(f"{i},{stage[i]:.3f},{speed[i]:.2f}\n")
```

```json
{
  "type": "mesh",
  "nodes": "nodes.csv",
  "faces": "faces.csv",
  "inputs": ["values/step_*s.csv"],
  "output": "dam-break.zarr",
  "position": ["x", "y"],
  "projection": "EPSG:6674",
  "resolution": 20,
  "level": "level",
  "ground": "ground",
  "timePattern": "_(\\d+)s\\.csv$",
  "timeUnit": "seconds",
  "epoch": "2026-01-01T00:00:00Z",
  "maxLevelError": 0.05,
  "properties": {
    "speed": {
      "source": "speed",
      "precision": 0.01,
      "units": "m/s",
      "label": "Flow speed"
    }
  }
}
```

セル中心の水位のように値が面にあるときは `"valuesOn": "faces"` を指定します。各値の行が面を示し、その値が面全体に入ります。

### ほかの形式

どのモデルの出力も、同じ 3 つを別の名前で持っています。UGRID に従った netCDF と、`x`、`y`、`volumes` の三角形の netCDF はそのまま読みます。ほかは形式ごとのライブラリで読み、上と同じように CSV に書き出します。たとえば次のとおりです。

| モデル     | 形式               | ライブラリ              | 節点と面                                              | 値                                        |
| ---------- | ------------------ | ----------------------- | ----------------------------------------------------- | ----------------------------------------- |
| ANUGA      | `.sww`（NetCDF-3） | そのまま読む（`input`） | `x`、`y`（と `xllcorner`、`yllcorner`）、`volumes`    | 節点の `stage`、`xmomentum`、`ymomentum`  |
| TELEMAC    | `.slf`（SELAFIN）  | TELEMAC の Python API   | 座標と接続表（`IKLE`）                                | 節点の `FREE SURFACE`、`WATER DEPTH` など |
| HEC-RAS 2D | `.p##.hdf`（HDF5） | `h5py`、`ras-commander` | 面の頂点（face point）と各セルの頂点                  | セル中心の水面（`valuesOn: "faces"`）     |
| D-Flow FM  | UGRID（NetCDF-4）  | そのまま読む（`input`） | `mesh2d_node_x`、`mesh2d_node_y`、`mesh2d_face_nodes` | 面の `mesh2d_s1`                          |
| MIKE 21 FM | `.dfsu`            | `mikeio`                | 要素の表                                              | 要素の `Surface elevation`                |

### 点だけのデータ

メッシュなしで書き出されたセル中心のような、面のない点は三角形分割（Delaunay）します。`faces` を省き、残す三角形の辺の長さの上限 `maxEdge`（メートル）を指定して、離れた浸水域が乾いた土地をまたいでつながらないようにします。`nodes` がなければ、各値の行がその点の位置（`position` の列）を持ち、同じ位置の行は同じ節点です。浸水域の縁まで水が届くよう、乾いた点も水位のない行として含めてください。浸水した点だけを三角形分割すると、一番外側の浸水点で終わってしまいます。`maxEdge` より長くて除いた三角形の数は、レポートに表示されます。

## rasters：津波のグリッド

例として、津波シミュレーションが平面直角座標系 6 系の 2 m 格子の netCDF のグリッドを出力するとします。水位と流速の各成分が、10 秒おきの出力ステップごとに 1 ファイルずつあり、ファイル名は地震発生からの秒数です。ほかに水深と建物の静的なグリッドがあります。モデルは高さを T.P. +1 m の基準面から数えます。

```
eta/eta_00000.nc    水位（m）。乾いたところは欠損
u/u_00000.nc        x 方向（東）の流速（m/s）
v/v_00000.nc        y 方向（北）の流速（m/s）
bathymetry.nc       モデルの基準面から下向きの深さ（m）。陸では負
buildings.nc        建物のあるところで 0 以外
```

グリッドの構成は `ncdump -h` で確認できます。netCDF-4 のグリッドには `h5wasm` パッケージが必要です（`npm install h5wasm`）。

```javascript
export default {
  type: "rasters",
  output: "tsunami.zarr",
  inputs: ["eta/eta_*.nc"],
  series: { u: ["u/u_*.nc"], v: ["v/v_*.nc"] },
  ground: "bathymetry.nc",
  groundScale: -1,
  datumOffset: 1,
  buildings: "buildings.nc",
  projection: "EPSG:6674",
  resolution: 5,
  timePattern: "_(\\d+)\\.nc$",
  timeUnit: "seconds",
  epoch: "2026-01-01T00:00:00Z",
  interval: 20,
  maxLevelError: 0.05,
  properties: ({ u, v }) => ({ flow_east: u, flow_north: v }),
  precision: { flow_east: 0.01, flow_north: 0.01 },
  units: { flow_east: "m/s", flow_north: "m/s" },
};
```

- モジュール：流速のラスターを `flow_east` と `flow_north` にするコールバックは JSON では書けません。この 2 つのプロパティが波を運ぶ流れになり、流速の大きさは読み込み時に導出します。
- `flow_east` と `flow_north`：各成分の向きは、ファイルにはまず記録されていません。モデルの資料か質量保存で確認してください。符号が正しいときだけ `dη/dt` と `-div(h v)` が相関します。
- `resolution`：5 m の各セルが、その中の 2 m の元セルを平均します。セルの水位は、浸水した元セルの平均です。
- `ground`、`groundScale`、`datumOffset`：水深はモデルの基準面からの深さなので符号を反転し、地盤高と水位の両方を 1 m 上げて T.P. にします。ファイルには記録されていないので、水位の基準はモデルの資料で確認してください。
- `buildings`：モデルは建物のセルを乾いたままにします。それを除くと、建物の間のセルは道路が浸水していれば浸水になります。
- `interval` と `maxLevelError`：津波は速く変わるので、5 cm 以内に補間できるステップはわずかです。10 秒おきのステップに `interval` を 20 秒にすると、フレーム数と GPU メモリは半分になります。

このようなシミュレーションでは海も浸水しているので、海面もグリッドの端まで描かれます。
