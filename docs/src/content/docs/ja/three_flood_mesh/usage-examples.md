---
title: 使用例
description: TimeSeriesFloodMeshDesc で洪水の時系列を再生・読み込み・切り替えるレシピ
sidebar:
  order: 3
since: nightly
---

## 洪水シミュレーションの再生

```typescript
import ThreeView from "@navaramap/three";
import {
  loadTimeSeriesFlood,
  TimeSeriesFloodMeshDesc,
  timeToFrame,
} from "@navaramap/three-flood-mesh";

const view = new ThreeView({
  animation: true,
});
await view.init();
view.registerMesh("timeSeriesFlood", TimeSeriesFloodMeshDesc);

const series = await loadTimeSeriesFlood({
  url: "https://example.com/flood.zarr",
  onProgress: (fraction) => {
    status.textContent = `読み込み中 ${Math.round(fraction * 100)}%`;
  },
});

// 洪水全体を見渡す。
const { west, south, east, north } = series.bounds;
const lat = (south + north) / 2;
const size = Math.max(
  (east - west) * 111_320 * Math.cos((lat * Math.PI) / 180),
  (north - south) * 110_950,
);
view.flyTo({ lng: (west + east) / 2, lat, distance: size, pitch: -45 });

const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { series, frame: 0 },
});

// 1 秒にシミュレーション上の 10 分進める。フレームの間隔によらず一定の速さになる。
const start = series.times[0].getTime();
const end = series.times[series.times.length - 1].getTime();
const startedAt = performance.now();
view.on("preUpdate", () => {
  const elapsed = (performance.now() - startedAt) * 600;
  const time = start + (elapsed % (end - start));
  water.update({ timeSeriesFlood: { frame: timeToFrame(series, time) } });
});
```

## 認証が必要なサーバーからの読み込み

```typescript
const series = await loadTimeSeriesFlood({
  url: "https://data.example.com/flood.zarr",
  fetch: (request) => {
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(new Request(request, { headers }));
  },
});
```

## Worker での読み込み

読み込みではすべてのチャンクを復号してプロパティを導出し、符号付き距離が保存されていなければ汀線までの距離も計算します。大きな時系列では数秒スレッドが止まります。`url` を指定したメッシュは専用の Worker で読み込むので、ページは操作できるままです。

```typescript
const water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { url: "https://example.com/flood.zarr", frame: 0 },
});
const series = await new Promise<TimeSeriesFloodSeries>((resolve, reject) => {
  water.ref.on("load", resolve);
  water.ref.on("error", reject);
});
```

時系列はただのデータだけを持つので、`loadTimeSeriesFlood` を自前の Worker で実行することもできます。Worker に渡せない `fetch` でリクエストを送る場合などです。

```typescript
// flood-worker.ts
import { loadTimeSeriesFlood } from "@navaramap/three-flood-mesh";

self.onmessage = async ({ data: url }: MessageEvent<string>) => {
  self.postMessage(await loadTimeSeriesFlood({ url }));
};

// main.ts
const worker = new Worker(new URL("./flood-worker.ts", import.meta.url), {
  type: "module",
});
worker.postMessage("https://example.com/flood.zarr");
const series = await new Promise<TimeSeriesFloodSeries>((resolve) => {
  worker.onmessage = (event) => resolve(event.data);
});
```

## シナリオの切り替え

1 つのメッシュは 1 つの時系列を描きます。別の破堤点のような別の時系列を表示するには、メッシュを削除して新しい時系列のメッシュを追加します。

```typescript
let water = view.addMesh<TimeSeriesFloodMeshDesc>({
  timeSeriesFlood: { series: scenarios[0] },
});

const show = (series: TimeSeriesFloodSeries) => {
  water.delete();
  water = view.addMesh<TimeSeriesFloodMeshDesc>({
    timeSeriesFlood: { series, frame: 0 },
  });
};
```
