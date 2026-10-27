---
title: Globe Class
description: API Reference for Globe Class - 地球表示の設定を管理するクラス
sidebar:
  order: 1000
---

Globe クラスは、地球表示に関するプロパティへのアクセスと変更を行うためのインターフェースを提供します。VectorTile、RasterTile、RasterTerrain など、異なるマテリアルタイプ間で共有される地球表示の設定を管理します。

## アクセス方法

Globe インスタンスは、ThreeView の `globe` プロパティを通じてアクセスします。

```typescript
import ThreeView from "@navaramap/three";

const view = new ThreeView();

await view.init();

// Globe インスタンスにアクセス
const globe = view.globe;

// プロパティを変更
globe.wireframe = true;
globe.opacity = 0.8;
```

## Properties

### maxSse

**Type:** `number`

**Description:** LOD（Level of Detail）計算のためのスクリーンスペースエラー閾値。値が小さいほど詳細なタイルが読み込まれます。

**Default:** `2.0`

:::warning
このプロパティは初期化時のみ有効です。ThreeView のコンストラクタで設定してください。
:::

**Example:**

```typescript
// コンストラクタで設定
const view = new ThreeView({
  maxSse: 1,
});

// 現在の値を取得
console.log(view.globe.maxSse);
```

---

### segments

**Type:** `number`

**Description:** メッシュテッセレーションのセグメント数。値が大きいほど滑らかな地球表面になりますが、パフォーマンスへの影響があります。

**Default:** `64`

:::warning
このプロパティは初期化時のみ有効です。ThreeView のコンストラクタで設定してください。
:::

**Example:**

```typescript
// コンストラクタで設定
const view = new ThreeView({
  segments: 32,
});

// 現在の値を取得
console.log(view.globe.segments);
```

---

### color

**Type:** `Color | undefined`

**Description:** 地球表面の基本色。タイルが読み込まれる前や、タイルがない領域で表示される色を設定します。

**Example:**

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView();

await view.init();

// 色を設定
view.globe.color = new Color().setHex(0x1a1a2e);

// CSS カラー文字列から設定
view.globe.color = new Color().setStyle("#2d3436");
```

---

### hideUnderground

**Type:** `boolean`

**Description:** 地下のジオメトリを非表示にするかどうか。カメラが地球表面の下に入った場合の表示を制御します。

**Default:** `true`

:::warning
この値を無効にすると、エフェクトを使用している場合に予期しない動作が発生する可能性があります。
:::

**Example:**

```typescript
// 地下表示を有効化（地下モデルの可視化など）
view.globe.hideUnderground = false;

// 地下表示を無効化（デフォルト）
view.globe.hideUnderground = true;
```

---

### useNormal

**Type:** `boolean`

**Description:** 法線を使用するかどうか。ライティング計算に影響します。

**Default:** `false`

:::warning
このプロパティは初期化時のみ有効です。ThreeView のコンストラクタで設定してください。
:::

**Example:**

```typescript
// コンストラクタで設定
const view = new ThreeView({
  useNormal: true,
});
```

---

### transparent

**Type:** `boolean`

**Description:** マテリアルを透明にするかどうか。`true` に設定すると、`opacity` プロパティで透明度を調整できます。

**Default:** `false`

:::note
ブレンディングはリソースレイヤーでのみ機能します。
:::

**Example:**

```typescript
// 透明度を有効化
view.globe.transparent = true;
view.globe.opacity = 0.7;
```

---

### opacity

**Type:** `number`

**Description:** マテリアルのグローバル不透明度（0.0〜1.0）。`transparent` が `true` の場合にのみ効果があります。

**Default:** `1.0`

**Example:**

```typescript
// 半透明に設定
view.globe.transparent = true;
view.globe.opacity = 0.5;

// 完全に不透明に戻す
view.globe.opacity = 1.0;
```

---

### wireframe

**Type:** `boolean`

**Description:** ワイヤーフレームモードでマテリアルをレンダリングするかどうか。デバッグやビジュアライゼーション目的で使用します。

**Default:** `false`

**Example:**

```typescript
// ワイヤーフレームモードを有効化
view.globe.wireframe = true;

// ワイヤーフレームモードを無効化
view.globe.wireframe = false;
```

## 初期化時プロパティの設定

一部のプロパティは初期化時のみ設定可能です。これらは ThreeView のコンストラクタオプションで指定します。

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({
  // 初期化時のみ設定可能なプロパティ
  maxSse: 1,
  segments: 64,
  useNormal: true,
  // 実行時に変更可能なプロパティ
  color: new Color().setHex(0x1a1a2e),
  hideUnderground: true,
  transparent: false,
  opacity: 1.0,
  wireframe: false,
});

await view.init();

// 初期化後は実行時プロパティのみ変更可能
view.globe.wireframe = true;
view.globe.opacity = 0.8;
```

## 関連項目

- [Color クラス](../../../three/api/color/) - 色を表現するクラス
- [ThreeView クラス](../../../three/api/threeview-class/) - メインビュークラス
