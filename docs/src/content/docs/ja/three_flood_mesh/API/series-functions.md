---
title: 時系列の関数
description: loadTimeSeriesFlood、sampleTimeSeriesFlood、timeToFrame、frameToTime
sidebar:
  order: 2
since: nightly
---

## loadTimeSeriesFlood

**型:** `(options: TimeSeriesFloodSeriesOptions) => Promise<TimeSeriesFloodSeries>`

**説明:** Zarr グループから水面の時系列を読み込みます。返り値を `series` プロパティに渡します。

**例:**

```typescript
import { loadTimeSeriesFlood } from "@navaramap/three-flood-mesh";

const series = await loadTimeSeriesFlood({
  url: "https://example.com/flood.zarr",
  variables: { waterLevel: "level", signedDistance: "shore_distance" },
});
```

### TimeSeriesFloodSeriesOptions

`url` か `store` のどちらかを指定します。

| プロパティ   | 型                                                       | 説明                                                                                                                                          |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`        | `string \| URL`                                          | Zarr グループの URL。相対 URL はページを基準に解決します。アクセストークンなどのクエリ文字列はすべてのリクエストに付きます                    |
| `fetch`      | `((request: Request) => Promise<Response>) \| undefined` | `url` と組み合わせて、`fetch` の代わりに各リクエストを送ります。ヘッダーの追加や URL の署名に使います。404 は存在しないチャンクとして読みます |
| `store`      | `Readable`                                               | グループをルートに持つ [zarrita](https://zarrita.dev/) のストア。変換関数が書き出した `Map` など                                              |
| `variables`  | `TimeSeriesFloodVariables \| undefined`                  | 読み込む配列の名前                                                                                                                            |
| `signal`     | `AbortSignal \| undefined`                               | 読み込みを中断します。中断すると signal の reason で reject します                                                                            |
| `onProgress` | `((fraction: number) => void) \| undefined`              | 読み込みの進み具合に応じて、終わった作業のおおよその割合（0 から 1）を受け取ります                                                            |

### TimeSeriesFloodVariables

| プロパティ       | 型                                           | 既定値          | 説明                                                                                                                                  |
| ---------------- | -------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `waterLevel`     | `string \| undefined`                        | `"water_level"` | 水面の高さ                                                                                                                            |
| `time`           | `string \| undefined`                        | `"time"`        | 時刻の座標                                                                                                                            |
| `lat`            | `string \| undefined`                        | `"lat"`         | 緯度の座標                                                                                                                            |
| `lng`            | `string \| undefined`                        | `"lon"`         | 経度の座標                                                                                                                            |
| `signedDistance` | `string \| undefined`                        | —               | 計算済みの汀線までの符号付き距離。指定しない場合はグループの `signed_distance` 属性が示す配列を使います                               |
| `properties`     | `string[] \| undefined`                      | —               | 読み込むプロパティの配列。指定しない場合はグループの `properties` 属性に列挙された配列を読みます                                      |
| `ground`         | `string \| undefined`                        | —               | `depth` を求める、WGS84 楕円体からの地盤高の配列。指定しない場合はグループの `ground` 属性が示す配列を使います                        |
| `flow`           | `[east: string, north: string] \| undefined` | —               | 流速の東向き・北向きの配列（m/s。[流れ](../../how-it-works/#流れ)を参照）。指定しない場合はグループの `flow` 属性が示す配列を使います |

### TimeSeriesFloodSeries

| プロパティ   | 型                                                             | 説明                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `times`      | `readonly Date[]`                                              | 各フレームの時刻                                                                                                                                                                                                     |
| `changes`    | `readonly number[]`                                            | フレーム `k` から `k + 1` の間に浸水・乾燥が切り替わるセルの数。水が大きく動く区間で再生を遅くする、などに使えます                                                                                                   |
| `bounds`     | `{ west: number; south: number; east: number; north: number }` | いずれかのフレームで水が届くセルの範囲（度）                                                                                                                                                                         |
| `properties` | `Record<string, TimeSeriesFloodProperty>`                      | 色分けに使えるプロパティ（保存されたものと派生したもの）。`min` と `max` は時系列全体の値域、`low` と `high` は外れ値を除いた色スケール向けの 2 / 98 パーセンタイル、`units` と `label` は分かる場合の単位と説明です |

時系列はただのデータだけを持つので、Worker から postMessage で渡せます（[Worker での読み込み](../../usage-examples/#worker-での読み込み) を参照）。

## sampleTimeSeriesFlood

**型:** `(series: TimeSeriesFloodSeries, position: { lng: number; lat: number }, frame: number | "max") => TimeSeriesFloodSample | undefined`

**説明:** ある地点（度）の水を、水面の描画どおりに返します。クリックした地点の浸水深を表示する、などに使えます。地点はそのセルの値を取ります。小数の `frame` は水面と同じように次のフレームとの間を補間します。`"max"` は時系列全体での各値の最大を返します（`extent: "max"` の水面と同じ）。水が一度も届かない地点では `undefined` を返します。

| プロパティ   | 型                       | 説明                                                                                                               |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `wet`        | `boolean`                | その地点が水に浸かっているかどうか                                                                                 |
| `level`      | `number \| undefined`    | 浸水している場合の、WGS84 楕円体からの水面の高さ（メートル）。`heightOffset` は加えません                          |
| `properties` | `Record<string, number>` | 時系列のプロパティの値。時間で変わらないプロパティは値があれば常に、変わるプロパティは浸水しているときだけ含みます |

**例:**

```typescript
import { vector3ToGeodetic } from "@navaramap/three";
import { sampleTimeSeriesFlood } from "@navaramap/three-flood-mesh";

view.on("click", (event) => {
  const picked = view.pickDepthPosition(event.clientX, event.clientY);
  if (!picked) return;
  const sample = sampleTimeSeriesFlood(
    series,
    vector3ToGeodetic(picked),
    frame,
  );
  console.log(sample?.properties.depth);
});

// グラフ用に、ある地点の各フレームの浸水深を取る。
const depths = series.times.map(
  (_, k) => sampleTimeSeriesFlood(series, { lng, lat }, k)?.properties.depth,
);
```

## timeToFrame / frameToTime

**型:** `(series: TimeSeriesFloodSeries, time: Date | number) => number` / `(series: TimeSeriesFloodSeries, frame: number) => Date`

**説明:** 時刻（`Date` またはエポックからのミリ秒）と、その時刻を表示する小数のフレームを相互に変換します。前後のフレームの間を補間するので、フレームの間隔が一定でなくても使えます。どちらも最初と最後のフレームの範囲に収めます。

**例:**

```typescript
import { frameToTime, timeToFrame } from "@navaramap/three-flood-mesh";

water.update({
  timeSeriesFlood: {
    frame: timeToFrame(series, new Date("2024-10-21T03:00:00Z")),
  },
});
label.textContent = frameToTime(series, frame).toLocaleString();
```
