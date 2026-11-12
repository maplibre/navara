---
title: TimeSeriesFloodMeshDesc
description: 時系列の洪水の水面を描画するメッシュ Descriptor
sidebar:
  order: 1
since: nightly
---

`TimeSeriesFloodMeshDesc` クラスは、洪水シミュレーションの結果のように時間とともに変化する水面を描画するメッシュです。緯度経度の等間隔格子上の水面の高さの時系列を、[Zarr](https://zarr.dev/) ストアから `loadTimeSeriesFlood` で読み込むか、`url` を指定してメッシュ自身に Worker で読み込ませます。すべてのフレームを GPU 上に保持するので、`frame` を変えても再読み込みや再構築は行われません。

`view.init()` の後、追加する前に `view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc)` で登録してください。水面は Navara の水として描かれ、波、フレネルによる空の反射、太陽のきらめきが付きます。view に `sky: { envMap: true }` のメッシュがあれば空の環境マップを反射し、なければライトプローブの低周波の空を反射します。

以下のプロパティに加えて、基底クラスの共通プロパティ（`visible` など）が利用できます。詳細は [MeshDesc](../../../three_default_descs/mesh-desc/mesh-desc-base/) を参照してください。

## プロパティ

### series

**型:** `TimeSeriesFloodSeries`

**説明:** 描画する時系列。`loadTimeSeriesFlood` の返り値です。`series` と `url` のどちらかを指定します。どちらも `update()` では差し替えられません。別の時系列を表示するには、メッシュを削除して新しく追加してください（[シナリオの切り替え](../../usage-examples/#シナリオの切り替え) を参照）。

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
  }
}
```

### url

**型:** `string | URL`

**説明:** メッシュが `loadTimeSeriesFlood` と同じように Worker で読み込む Zarr グループの URL。相対 URL はページを基準に解決します。水面は時系列の読み込みが終わると表示され、時系列は `load` イベントで受け取れます（[イベント](#イベント) を参照）。読み込み中、エンジンの Worker プールはこの Worker にコアを 1 つ譲ります。その間もほかのプロパティは更新でき、水面が表示されるときに反映されます。`fetch` でリクエストを送る場合や `store` から読む場合は、`loadTimeSeriesFlood` で読み込んで `series` に渡してください。

**例:**

```typescript
{
  timeSeriesFlood: {
    url: "https://example.com/flood.zarr",
  }
}
```

### variables

**型:** `TimeSeriesFloodVariables | undefined`

**説明:** `url` を指定したときに読む配列の名前（[TimeSeriesFloodVariables](../series-functions/#timeseriesfloodvariables) を参照）。

**例:**

```typescript
{
  timeSeriesFlood: {
    url: "https://example.com/flood.zarr",
    variables: { waterLevel: "level" },
  }
}
```

### frame

**型:** `number | undefined`

**説明:** 表示するフレームの番号。整数を指定すると、そのフレームをデータどおりに表示します。小数を指定すると、フレーム `Math.floor(frame)` と次のフレームの間の状態を表示します。このとき 2 つのフレームの高さを混ぜ、汀線を各フレームの汀線までの距離に沿って移動させます。間の形は幾何的なもので、水の流れを再現するものではありません。データのフレームだけを表示するには `Math.floor(frame)` を渡します。ある時刻を表示するフレームは `timeToFrame` で求められます。

**既定値:** `0`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    frame: 12.5,
  }
}
```

### extent

**型:** `"frame" | "max" | undefined`

**説明:** 水面が覆う範囲。`"frame"` は表示中のフレームの水を描きます。`"max"` はいずれかのフレームで水が届くすべてのセルを、その最高水位で描き、時間で変わるプロパティはその最大値を表示します。`frame` は無視されます。浸水到達時間、浸水継続時間、最大浸水深のような、洪水全体の地図に使います。

**既定値:** `"frame"`

**例:**

```typescript
// 洪水全体での最大浸水深を、ハザードマップの区分で表示する。
water.update({
  timeSeriesFlood: {
    extent: "max",
    colorBy: {
      property: "depth",
      scale: { type: "threshold", breaks: [0.5, 3, 5, 10, 20], colors },
    },
  },
});
```

### heightOffset

**型:** `number | undefined`

**説明:** 水面の高さに加えるメートル数。別の高さの基準の地形に水面を合わせる場合などに使います。

**既定値:** `0`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    heightOffset: -0.5,
  }
}
```

### showUnderground

**型:** `number | undefined`

**説明:** 地形が水面より上にあっても水を表示する、地形の高さの上限（メートル）。地形がシミュレーションの地面と異なると、浅い水が地形のすぐ下になって隠れることがあります。手前の地形が水面からこの値未満しか高くない水は、地形の表面に描きます。山の向こうの海のように、それより深く地形の下にある水は隠れたままです。`0` では地形の下の水をすべて隠します。水の手前にある建物は、どちらの場合も水を隠します。

高さは視線に沿って求めるため、地平線に近い低い視点からは、低い土手のすぐ奥の水が土手の上に描かれることがあります。

**既定値:** `0`

**例:**

```typescript
// 別の標高モデルの地形の上に、5 m セルの浅い内水を表示する
{
  timeSeriesFlood: {
    series,
    showUnderground: 2,
  }
}
```

### color

**型:** `Color | undefined`

**説明:** 水の色。深い水はこの色より暗く描かれます。

**既定値:** `#5a3f1c`

**例:**

```typescript
import { Color } from "@navaramap/three";

{
  timeSeriesFlood: {
    series,
    color: new Color().setStyle("#3f6f8f"),
  }
}
```

### opacity

**型:** `number | undefined`

**説明:** 水が深いところの不透明度。

**既定値:** `0.9`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    opacity: 0.95,
  }
}
```

### shallowOpacity

**型:** `number | undefined`

**説明:** 水が浅いところの不透明度。水面とその奥の地形の間の水が厚くなるにつれて、`shallowOpacity` から `opacity` に変わります。水中の建物は奥の地形と同じように覆われるので、水面より上の部分だけが見えます。

**既定値:** `0.2`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    shallowOpacity: 0.3,
  }
}
```

### absorption

**型:** `number | undefined`

**説明:** 視線方向の水の厚さ 1 メートルあたりに不透明になる速さ。大きいほど浅い水も深く見えます。

**既定値:** `0.5`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    absorption: 1.0,
  }
}
```

### waveStrength

**型:** `number | undefined`

**説明:** 波の大きさ、険しさ、速さを決めます。`1` 程度で穏やかなさざ波、`5` で中程度、`20` で嵐です。波はフレームが描画されている間だけ動きます。view の `animation: true` などで描画を続けてください。

**既定値:** `5`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveStrength: 2,
  }
}
```

### waveDirection

**型:** `number | undefined`

**説明:** 波の進む方向。北から時計回りの度数で指定します。

**既定値:** `0`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveDirection: 90,
  }
}
```

### flowSpeed

**型:** `number | undefined`

**説明:** 波を水面全体で `waveDirection` の向きに運ぶ流れの速さ（m/s）。波の大きさや傾きは変わりません。[流れ](../../how-it-works/#流れ)のある時系列はそちらに従い、この値を無視します。

**既定値:** `0`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveDirection: 90,
    flowSpeed: 2,
  }
}
```

### waveExaggeration

**型:** `number | undefined`

**説明:** 波の大きさと速さを保ったまま、傾きだけを拡大縮小します。`0` で静かな鏡面になります。

**既定値:** `1`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    waveExaggeration: 0.5,
  }
}
```

### waterScale

**型:** `"ocean" | "large" | "medium" | "small" | undefined`

**説明:** 波が発達する開けた水面の広さで、波の大きさを決めます。`"ocean"` は `waveStrength` が許す大きさまで発達し、`"large"` は約 20 km、`"medium"` は約 2 km、`"small"` は約 200 m を想定します。

**既定値:** `"medium"`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    waterScale: "small",
  }
}
```

### doubleSide

**型:** `boolean | undefined`

**説明:** 水面を下側からも描き、深い浸水の地上視点のように水中にあるカメラからも見えるようにします。下側から見た水面は水そのものの色を見せ、何も反射しません。

**既定値:** `false`

**例:**

```typescript
{
  timeSeriesFlood: {
    series,
    doubleSide: true,
  }
}
```

### colorBy

**型:** `TimeSeriesFloodColorBy | null | undefined`

**説明:** 水面を水として描く代わりに、時系列のプロパティで色分けします。色分けした水面はライティングも反射もしないので凡例と照らし合わせて読め、不透明度は深さによらず一定です。`null` で水の描画に戻ります。変更すると `transition` ミリ秒かけて色がクロスフェードします。

| プロパティ    | 型                          | 既定値    | 説明                                                                                                                                                                                                                                               |
| ------------- | --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `property`    | `string`                    | —         | `series.properties` にある名前                                                                                                                                                                                                                     |
| `scale`       | `TimeSeriesFloodColorScale` | —         | 値から色を決める方法（下記）                                                                                                                                                                                                                       |
| `interpolate` | `boolean \| undefined`      | 下記参照  | セル中心の間とフレームの間で値を滑らかに変化させるかどうか。オフにすると、各セルはフレーム `Math.floor(frame)` の自身の値を表示します。そのフレームでまだ乾いている、移動中の汀線の内側のセルは次のフレームの値です。`category` 以外では既定でオン |
| `opacity`     | `number \| undefined`       | `0.85`    | 色分けした水面の不透明度                                                                                                                                                                                                                           |
| `missing`     | `Color \| undefined`        | `#808080` | プロパティに値がないところの色                                                                                                                                                                                                                     |
| `transition`  | `number \| undefined`       | `300`     | `colorBy` を変えたときに色がクロスフェードするミリ秒数                                                                                                                                                                                             |

`TimeSeriesFloodColorScale` は次のいずれかです。

- `{ type: "linear", stops: [value, Color][] }`：stop を通るグラデーション。両端の外側は端の色になります。色はリニア RGB で補間します。
- `{ type: "threshold", breaks: number[], colors: Color[] }`：順序のある区分。`breaks[i - 1]` 以上 `breaks[i]` 未満の値に `colors[i]` を使うので、色は区切りより一つ多くなります（区切りは 32 個まで）。補間がオンなら、区分の境界は補間した値に従い、等値線のようになります。
- `{ type: "category", values: number[], colors: Color[], other?: Color }`：列挙した値ごとに一色、それ以外は `other`（値は 32 個まで）。補間は既定でオフなので、セルが 2 つのカテゴリの間の値を表示することはありません。

色は他の描画と同じく view のトーンマッピングを通ります。事前に露出で割っておくので、ニュートラルなトーンマッピングなら指定どおりの色で表示されます。

**例:**

```typescript
import { Color } from "@navaramap/three";

const color = (style: string) => new Color().setStyle(style);

// ハザードマップの浸水深の区分。
water.update({
  timeSeriesFlood: {
    colorBy: {
      property: "depth",
      scale: {
        type: "threshold",
        breaks: [0.5, 3, 5, 10, 20],
        colors: [
          "#f7f5a9",
          "#ffd8c0",
          "#ffb7b7",
          "#ff9191",
          "#f285c9",
          "#dc7adc",
        ].map(color),
      },
    },
  },
});

// 水が届くすべてのセルで、浸水するまでの時間。
const { max, units } = series.properties.arrival;
water.update({
  timeSeriesFlood: {
    extent: "max",
    colorBy: {
      property: "arrival",
      scale: {
        type: "linear",
        stops: [
          [0, color("#30123b")],
          [max / 2, color("#72fe5e")],
          [max, color("#7a0403")],
        ],
      },
    },
  },
});
legend.title = `到達時間（${units}）`;

// 水の描画に戻す。
water.update({ timeSeriesFlood: { colorBy: null, extent: "frame" } });
```

## イベント

メッシュは次のイベントを発行し、`handle.ref.on()` で受け取れます。いずれも `url` の読み込みを知らせます。メッシュの `series` プロパティは描画している時系列で、`url` の読み込み中は `undefined` です。

| イベント   | リスナー                                  | 説明                                                     |
| ---------- | ----------------------------------------- | -------------------------------------------------------- |
| `progress` | `(fraction: number) => void`              | 読み込みが進んだ。済んだ作業のおおよその割合（0 から 1） |
| `load`     | `(series: TimeSeriesFloodSeries) => void` | 時系列を読み込み、水面を表示した                         |
| `error`    | `(error: unknown) => void`                | 読み込みに失敗した                                       |

**例:**

```typescript
const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "https://example.com/flood.zarr" },
});
water.ref.on("progress", (fraction) => {
  status.textContent = `読み込み中 ${Math.round(fraction * 100)}%`;
});
water.ref.on("load", (series) => {
  slider.max = series.times.length - 1;
});
water.ref.on("error", (error) => {
  status.textContent = `読み込みに失敗しました: ${String(error)}`;
});
```
