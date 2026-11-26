---
title: ThreeView Events
description: API Reference for ThreeView Class Events
sidebar:
  order: 920
---

このページでは、ThreeView インスタンスで利用可能なすべてのイベントを説明します。

## Methods

### on()

様々なビューイベントのイベントリスナーを登録します。

```tsx
on<K extends keyof ViewEvents>(event: K, handler: ViewEvents[K]): void
```

### off()

イベントリスナーを削除します。

```tsx
off<K extends keyof ViewEvents>(event: K, handler: ViewEvents[K]): void
```

**Example:**

```tsx
const resizeHandler = (width, height) => {
  console.log(`Resized to ${width}x${height}`);
};

// Register event listener
view.on("resize", resizeHandler);

// Later, remove the listener
view.off("resize", resizeHandler);
```

### Advanced Example

```tsx
// Create named handlers for easy cleanup
const handlers = {
  handleClick: (event) => {
    console.log("Clicked:", event);
  },
  handleResize: (width, height) => {
    console.log(`Resized: ${width}x${height}`);
  },
  handlePick: (info) => {
    if (info) {
      console.log("Picked:", info.properties);
    }
  },
};

// Register multiple listeners
view.on("click", handlers.handleClick);
view.on("resize", handlers.handleResize);
view.on("featureClick", handlers.handlePick);

// Later, cleanup all listeners
view.off("click", handlers.handleClick);
view.off("resize", handlers.handleResize);
view.off("featureClick", handlers.handlePick);
```

## Event Types

### resize

**Description:**

ウィンドウがリサイズされたときに発火します。幅と高さをピクセル単位で受け取ります。

**Handler Type:**

```tsx
(width: number, height: number) => void
```

**Parameters:**

- `width`: リサイズ後の幅（ピクセル）
- `height`: リサイズ後の高さ（ピクセル）

**Example:**

```tsx
view.on("resize", (width, height) => {
  console.log(`ウィンドウがリサイズされました: ${width}x${height}`);
});
```

### featureClick

**Description:**

地物がクリックまたはタップされたときに発火します。クリックされた地物情報、または何もない場所をクリックした場合は `null` を受け取ります。クリックの生の座標が必要な場合は `click` イベントを使用してください。

クリックピックは遅延起動されます。`featureClick` のリスナーが 1 つ以上登録されている間だけ GPU ピックが実行されます。

:::note
このイベントを使用するには、ThreeView のコンストラクタで `picking: true` を設定する必要があります（デフォルトで有効）。
:::

**Handler Type:**

```tsx
(info: PickedFeature | null) => void
```

**Parameters:**

- `info`: クリックされた地物情報、または `null`

```tsx
type PickedFeature = {
  batchId: number; // バッチ ID
  properties: Record<string, unknown> | undefined; // 地物のプロパティ
  layerId: string | undefined; // レイヤー ID
  featureId?: string | number; // GeoJSON のトップレベル `id` または MVT の地物 ID（ない場合は undefined）
  featureSetId?: FeatureSetId; // フィーチャーセット ID。レイヤーの featureCreated と同じ値（フィーチャーセットに属さない場合は undefined）
  content?: FeatureSetContent; // フィーチャーセットの読み込み元コンテンツ（3D Tiles の credit とメタデータ）。featureCreated と同じ値
};
```

**Example:**

```tsx
view.on("featureClick", (info) => {
  if (info) {
    console.log("選択された地物:", info.properties);
    console.log("レイヤー ID:", info.layerId);
    console.log("バッチ ID:", info.batchId);
  } else {
    console.log("地物が選択されていません");
  }
});
```

### featureHover

**Description:**

ポインタの移動によってホバー中の地物が変わったときに発火します。新たにホバーされた地物、またはどのピッカブルな地物からもポインタが外れた場合は `null` を受け取ります。ポインタ移動のたびではなく、ホバー対象が変化したときのみ発火します。

ホバーピッキングはポインタ移動中に毎フレーム GPU ピックを実行するため、遅延起動されます。`featureHover`・`featureEnter`・`featureLeave` のいずれかのリスナーが登録されている間だけピックが実行され、ボタンや指が押されている間（カメラドラッグ中など）は抑制されます。タッチは接触中が常に押下扱いになるため、ホバー系イベントはタッチでは発火しません。

:::note
このイベントを使用するには、ThreeView のコンストラクタで `picking: true` を設定する必要があります（デフォルトで有効）。
:::

**Handler Type:**

```tsx
(info: PickedFeature | null) => void
```

**Parameters:**

- `info`: ホバー中の地物情報、または `null`

**Example:**

```tsx
view.on("featureHover", (info) => {
  view.canvas.style.cursor = info ? "pointer" : "";
});
```

### featureEnter

**Description:**

ポインタがピッカブルな地物のホバーを開始したときに発火します。`featureLeave` とともに、`featureHover` と同じホバーピッキングから合成されるため、同じ起動条件が適用されます。

**Handler Type:**

```tsx
(info: PickedFeature) => void
```

**Parameters:**

- `info`: ホバーが開始された地物

**Example:**

```tsx
view.on("featureEnter", (info) => {
  console.log("地物にホバー開始:", info.properties);
});
```

### featureLeave

**Description:**

直前までホバーしていた地物からポインタが外れたときに発火します。離れた地物を受け取ります。ある地物から別の地物へ直接ポインタが移動した場合、前の地物の `featureLeave` が新しい地物の `featureEnter` より先に発火します。

**Handler Type:**

```tsx
(info: PickedFeature) => void
```

**Parameters:**

- `info`: ホバーが終了した地物

**Example:**

```tsx
view.on("featureLeave", (info) => {
  console.log("地物からホバー終了:", info.properties);
});
```

### layer

**Description:**

レイヤー関連のイベントが発生したときに発火します。

**Handler Type:**

```tsx
<K extends keyof LayerEvent>(
  k: K,
  layerId: string,
  ...args: Parameters<LayerEvent[K]>
) => void
```

**Example:**

```tsx
view.on("layer", (eventType, layerId, ...args) => {
  console.log(`Layer ${layerId} event: ${eventType}`, args);
});
```

### preUpdate

**Description:**

更新処理の前に発火します。`DOMHighResTimeStamp` をタイムスタンプとして受け取ります。

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp`（ミリ秒単位の高精度タイムスタンプ）

**Example:**

```tsx
view.on("preUpdate", (time) => {
  // 更新前のカスタムロジック
  console.log(`更新前: ${time}ms`);
});
```

### postUpdate

**Description:**

状態変更が発生した更新処理の後に発火します。`DOMHighResTimeStamp` をタイムスタンプとして受け取ります。

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp`（ミリ秒単位の高精度タイムスタンプ）

**Example:**

```tsx
view.on("postUpdate", (time) => {
  // 更新後のカスタムロジック
  console.log(`更新後: ${time}ms`);
});
```

### preRender

**Description:**

レンダリング前に発火します。`animation: true` の場合、毎フレーム発火します。`DOMHighResTimeStamp` をタイムスタンプとして受け取ります。

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp`（ミリ秒単位の高精度タイムスタンプ）

**Example:**

```tsx
view.on("preRender", (time) => {
  // レンダリング前のカスタムロジック
  console.log(`レンダリング前: ${time}ms`);
});
```

### postRender

**Description:**

レンダリング後に発火します。`animation: true` の場合、毎フレーム発火します。`DOMHighResTimeStamp` をタイムスタンプとして受け取ります。

**Handler Type:**

```tsx
(time: number) => void
```

**Parameters:**

- `time`: `DOMHighResTimeStamp`（ミリ秒単位の高精度タイムスタンプ）

**Example:**

```tsx
view.on("postRender", (time) => {
  // レンダリング後のカスタムロジック
  console.log(`レンダリング後: ${time}ms`);
});
```

### pointerdown

**Description:**

マップ上でポインタ（マウスボタン・タッチ・ペン）が押されたときに発火します。マップ座標を含む `MapPointerEvent` を受け取ります。入力の種類は `event.pointerType`（`"mouse"`・`"touch"`・`"pen"`）で判別できます。

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: ポインタイベント（マップ座標を含む）

```tsx
type MapPointerEvent = {
  map: { x: number; y: number; z: number }; // 地球表面上の ECEF 座標
} & PointerEvent;
```

**Example:**

```tsx
view.on("pointerdown", (event) => {
  console.log(`ポインタダウン位置: ${event.clientX}, ${event.clientY}`);
  console.log(
    `マップ座標（ECEF）: ${event.map.x}, ${event.map.y}, ${event.map.z}`
  );
});
```

### pointerenter

**Description:**

ポインタが canvas 領域に入ったときに発火します。マップ座標を含む `MapPointerEvent` を受け取ります。

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: ポインタイベント（マップ座標を含む）

**Example:**

```tsx
view.on("pointerenter", (event) => {
  console.log("ポインタがマップに入りました");
  console.log(`マップ座標: ${event.map.x}, ${event.map.y}, ${event.map.z}`);
});
```

### pointerleave

**Description:**

ポインタが canvas 領域から出たときに発火します。マップ座標を含む `MapPointerEvent` を受け取ります。タッチの場合は指が離れた後に発火します。

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: ポインタイベント（マップ座標を含む）

**Example:**

```tsx
view.on("pointerleave", (event) => {
  console.log("ポインタがマップから出ました");
});
```

### pointermove

**Description:**

マップ上でポインタが移動したときに発火します。マップ座標を含む `MapPointerEvent` を受け取ります。タッチの場合は指がマップ上をドラッグしている間に発火します。

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: ポインタイベント（マップ座標を含む）

**Example:**

```tsx
view.on("pointermove", (event) => {
  console.log(`ポインタ位置: ${event.clientX}, ${event.clientY}`);
  console.log(
    `マップ座標（ECEF）: ${event.map.x}, ${event.map.y}, ${event.map.z}`
  );
});
```

### pointerup

**Description:**

マップ上でポインタ（マウスボタン・タッチ・ペン）が離されたときに発火します。マップ座標を含む `MapPointerEvent` を受け取ります。

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: ポインタイベント（マップ座標を含む）

**Example:**

```tsx
view.on("pointerup", (event) => {
  console.log(`ポインタアップ位置: ${event.clientX}, ${event.clientY}`);
  console.log(`マップ座標: ${event.map.x}, ${event.map.y}, ${event.map.z}`);
});
```

### pointercancel

**Description:**

ブラウザがアクティブなポインタをキャンセルしたとき（システムジェスチャーがタッチを引き継いだときなど）に発火します。マップ座標を含まない生の `PointerEvent` を受け取ります。

**Handler Type:**

```tsx
(event: PointerEvent) => void
```

**Example:**

```tsx
view.on("pointercancel", () => {
  console.log("ポインタ操作がキャンセルされました");
});
```

### idle

**Description:**

データやタイルの処理がアイドル状態になったとき、つまりタイルの読み込みやデータ処理などの更新が `idleThreshold` ミリ秒以上発生しなかったときに発火します。常時実行されるアニメーションやエフェクトはアクティビティとして扱われないため、それらが動作中でもこのイベントは発火します。アイドル期間中に最大 1 回だけ発火し、処理が再開されるとリセットされます。

**Handler Type:**

```tsx
() => void
```

**Example:**

```tsx
view.on("idle", () => {
  console.log("エンジンがアイドル状態になりました");
});
```

:::tip
`idleThreshold` コンストラクタオプションで、イベントが発火するまでのアイドル時間を設定できます。デフォルトは 100 ms です。
:::

### click

**Description:**

マップがクリックまたはタップされたときに発火します。マップ座標を含む `MapPointerEvent` を受け取ります。入力の種類は `event.pointerType` で判別できます。

**Handler Type:**

```tsx
(event: MapPointerEvent) => void
```

**Parameters:**

- `event`: ポインタイベント（マップ座標を含む）

**Example:**

```tsx
view.on("click", (event) => {
  console.log(`クリック位置: ${event.clientX}, ${event.clientY}`);
  console.log(`入力の種類: ${event.pointerType}`);
  console.log(
    `マップ座標（ECEF）: ${event.map.x}, ${event.map.y}, ${event.map.z}`
  );
});
```
