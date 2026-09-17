---
title: ThreeViewCamera クラス
description: ThreeViewCamera クラスの API リファレンス - カメラの位置・向き・操作動作を管理するクラス
sidebar:
  order: 1010
---

`ThreeViewCamera` クラスは、カメラの位置・向き・投影・インタラクティブ操作動作を管理します。`ThreeView` インスタンスの `camera` プロパティ経由でアクセスします。

## アクセス方法

```typescript
import ThreeView from "@navaramap/three";

const view = new ThreeView({ container: element });
await view.init();

const camera = view.camera;
```

## Properties

### raw

**Type:** `PerspectiveCamera`

**Read-only**

Three.js の `PerspectiveCamera` インスタンス。カメラ行列やワールド座標の読み取りなど、Three.js API との**読み取り専用**の連携に使用します。

`raw.fov`（およびその他のフラスタムフィールド）への直接書き込みは避けてください。エンジンは内部フラスタム状態から `raw.fov` を同期するため、直接書き込みは上書きされ、Rust 側のカリング状態が不整合になる恐れがあります。FOV の変更には `fov` セッターを使用してください。

**Example:**

```typescript
// カメラのワールド座標を取得
const position = view.camera.raw.position;

// ThreeViewCamera のセッター経由で FOV を設定（エンジンのフラスタムと同期が保たれる）
view.camera.fov = 60;
```

---

### positionECEF

**Type:** `{ x: number; y: number; z: number }`

**Read-only**

カメラの現在位置（ECEF 座標、メートル単位）。

**Example:**

```typescript
const pos = view.camera.positionECEF;
console.log(`ECEF: ${pos.x}, ${pos.y}, ${pos.z}`);
```

---

### positionGeographic

**Type:** `{ lng: number; lat: number; height: number }`

**Read-only**

カメラの現在位置（地理座標）。

- `lng`: 経度（度）
- `lat`: 緯度（度）
- `height`: 楕円体からの高さ（メートル）

**Example:**

```typescript
const pos = view.camera.positionGeographic;
console.log(`経度: ${pos.lng}, 緯度: ${pos.lat}, 高度: ${pos.height}m`);
```

---

### orientation

**Type:** `{ heading: number; pitch: number; roll: number }`

**Read-only**

カメラの現在の向き。

- `heading`: 方位角（度、0 = 北、時計回り）
- `pitch`: 仰俯角（度、負の値 = 下方向）
- `roll`: ロール角（度）

**Example:**

```typescript
const { heading, pitch, roll } = view.camera.orientation;
console.log(`方位: ${heading}°, 仰俯角: ${pitch}°, ロール: ${roll}°`);
```

---

### fov

**Type:** `number | undefined` (getter) / `number` (setter)

垂直視野角（度）。水平方向の広がりはビューポートのアスペクト比から決まります。

設定時の有効範囲は `1`〜`180` で、範囲外の値は無視されます。読み取りはエンジン未初期化の場合 `undefined` を返します。

**Example:**

```typescript
// 望遠効果（狭い視野角）
view.camera.fov = 30;

// パノラマ効果（広い視野角）
view.camera.fov = 90;

console.log(`視野角: ${view.camera.fov}°`);
```

---

### near

**Type:** `number` (getter / setter)

ニアクリッピングプレーンの距離（メートル）。`0` より大きい値である必要があります。

**Example:**

```typescript
// 現在の値を取得
console.log(view.camera.near);

// 値を設定
view.camera.near = 0.5;
```

---

### far

**Type:** `number` (getter / setter)

ファークリッピングプレーンの距離（メートル）。`near` より大きい値である必要があります。

**Example:**

```typescript
// 現在の値を取得
console.log(view.camera.far);

// 値を設定
view.camera.far = 1e9;
```

---

### options

**Type:** `CameraOptions` (setter)

カメラのインタラクティブ操作動作を設定します。すべてのフィールドはオプションで、指定したフィールドのみが更新されます。

```typescript
type CameraOptions = {
  autoAdjustNearFar?: boolean;
  minimumZoomDistance?: number;
  maximumZoomDistance?: number;
  spinSpeed?: number;
  zoomSpeed?: number;
  spinDuration?: number;
  zoomDuration?: number;
  translateDuration?: number;
  enableSpin?: boolean;
  enableZoom?: boolean;
  enableTilt?: boolean;
};
```

| オプション | 型 | デフォルト | 説明 |
|---|---|---|---|
| `autoAdjustNearFar` | `boolean` | `true` | カメラの高度に応じてニア/ファークリッピングプレーンを自動調整する |
| `minimumZoomDistance` | `number` | 約6,356,752 | 地球表面からの最小ズーム距離（メートル） |
| `maximumZoomDistance` | `number` | 約63,567,523 | 地球表面からの最大ズーム距離（メートル） |
| `spinSpeed` | `number` | `2.0` | マウスドラッグによる回転速度の倍率 |
| `zoomSpeed` | `number` | `0.6` | スクロールホイールによるズーム速度の倍率 |
| `spinDuration` | `number` | `500` | マウスドラッグを離した後のスピン慣性の持続時間（ミリ秒） |
| `zoomDuration` | `number` | `100` | スクロールホイール入力後のズーム慣性の持続時間（ミリ秒） |
| `translateDuration` | `number` | `500` | 移動慣性の持続時間（ミリ秒） |
| `enableSpin` | `boolean` | `true` | ドラッグ／スワイプによる回転（スピン）を有効にするかどうか |
| `enableZoom` | `boolean` | `true` | スクロールホイールおよびピンチ／スプレッドによるズームを有効にするかどうか |
| `enableTilt` | `boolean` | `true` | Ctrl+左ドラッグ、右クリックドラッグ、ダブルスワイプ、回転ジェスチャーによるチルトを有効にするかどうか |

**Example:**

```typescript
// すべてのインタラクティブ操作を無効化（プログラム制御専用の場合など）
view.camera.options = {
  enableSpin: false,
  enableZoom: false,
  enableTilt: false,
};

// 慣性の感触を調整
view.camera.options = {
  spinDuration: 1000,
  zoomDuration: 50,
  translateDuration: 800,
};

// 固定高度アプリ向けにズーム範囲を制限
view.camera.options = {
  minimumZoomDistance: 500,
  maximumZoomDistance: 5_000_000,
};
```

## Events

`ThreeViewCamera` は `EventHandler` を継承し、以下のイベントを発行します。`on()` でサブスクライブし、`off()` でアンサブスクライブします。

ユーザー操作とカメラ移動メソッドは、いずれもイベントを発行します。瞬時に完了する呼び出し（`setCamera()`、`lookAt()`、`rotateAroundAxis()`、`duration: 0` の `flyTo()`）は 1 フレーム内で完了するため、`move` と `moveend` をまとめて発行し、`movestart` は発行しません。各イベントは 1 フレームにつき最大 1 回発行されます。

ただし follow モードは例外です。`cameraFollow()` または `cameraFreeLook()` が有効な間、カメラは毎フレーム再配置されますが、これらのイベントは発行されません。追従中のカメラを追跡するには、`positionGeographic` / `orientation` をポーリングしてください（view の `preRender` などで）。

### movestart

連続的な移動（ユーザー操作、その慣性、アニメーション付きの `flyTo()`）が開始したときに一度発行されます。瞬時に完了する変更では、開始すべき移動が存在しないため発行されません。

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("movestart", () => {
  console.log("カメラが移動を開始しました");
});
```

---

### move

カメラが移動中の毎フレームに発行されます。また、瞬時に完了する変更ごとに一度発行されます。カメラ位置の表示をあらゆる変更に追従させたい場合は、このイベントを購読してください。

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("move", () => {
  const pos = view.camera.positionGeographic;
  console.log(`移動中 — 高度: ${pos.height.toFixed(0)}m`);
});
```

---

### moveend

カメラが停止したとき、および瞬時に完了する変更ごとに一度発行されます。

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("moveend", () => {
  const pos = view.camera.positionGeographic;
  console.log(`停止: 経度=${pos.lng.toFixed(4)}, 緯度=${pos.lat.toFixed(4)}`);
});
```

---

### frustumChanged

カメラのフラスタムパラメータ（FOV・ニア・ファー）が変更されたときに発行されます。

**Handler type:** `() => void`

**Example:**

```typescript
view.camera.on("frustumChanged", () => {
  console.log(`FOV: ${view.camera.fov}°`);
});
```

## イベントメソッド

### on()

カメライベントをサブスクライブします。

**Syntax:**

```typescript
on(event: CameraEventName, handler: () => void): void
```

**Example:**

```typescript
const handler = () => console.log("カメラが移動しました");
view.camera.on("move", handler);
```

---

### off()

登録済みのハンドラーをアンサブスクライブします。

**Syntax:**

```typescript
off(event: CameraEventName, handler: () => void): void
```

**Example:**

```typescript
view.camera.off("move", handler);
```

---

### once()

イベントに一度だけ反応するハンドラーを登録します（実行後は自動的にアンサブスクライブされます）。

**Syntax:**

```typescript
once(event: CameraEventName, handler: () => void): void
```

**Example:**

```typescript
view.camera.once("moveend", () => {
  console.log("最初の移動が完了しました");
});
```

## 関連項目

- [ThreeView プロパティ](../../../three/api/threeview-properties/): `view.camera` やその他のビュープロパティ
- [ThreeView 関数](../../../three/api/threeview-functions/): `setCamera()`、`flyTo()`、`lookAt()` などのカメラ移動メソッド
