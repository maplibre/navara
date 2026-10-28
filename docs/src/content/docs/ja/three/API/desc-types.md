---
title: Descriptor Types
description: API Reference for Layer, BaseHandle, and BaseDesc types
sidebar:
  order: 950
---

navara_three では、レイヤーは以下の 4 種類に分類されます：

1. **リソースレイヤー** - 外部データソースから地理データを読み込んで表示するレイヤー（ラスタータイル、地形、GeoJSON、3D Tiles など）
2. **メッシュ Descriptor** - 3D メッシュオブジェクトをシーンに追加する Descriptor
3. **エフェクト Descriptor** - ポストプロセッシングエフェクトを適用する Descriptor
4. **ライト Descriptor** - シーンの照明を管理する Descriptor

リソースレイヤーと Descriptor（メッシュ・エフェクト・ライト）では、返却されるハンドルクラスが異なります。

## Layer

リソースレイヤー（imagery、terrain、GeoJSON、3D Tiles など）を制御するためのハンドルクラスです。`ThreeView.addLayer()` でリソースレイヤーを追加した際に返されます。

### Properties

#### id

**Type:** `string`

**Description:** レイヤーの一意な識別子。

### Methods

#### update()

レイヤーの設定を更新します。

**Syntax:**

```typescript
update(l: LayerDescription): void
```

**Parameters:**

- `l`: 新しいレイヤー設定

**Example:**

```typescript
const geoJsonSource = view.addSource({
  type: "geojson",
  url: "https://example.com/data.geojson",
});

const geoJsonHandle = view.addLayer({
  type: "vector",
  source: geoJsonSource,
  point: { color: 0xff0000 },
});

// レイヤー設定を更新
geoJsonHandle.update({
  type: "vector",
  source: geoJsonSource,
  point: { color: 0x00ff00 },
});
```

#### delete()

シーンからレイヤーを削除し、リソースを解放します。削除後はレイヤーを使用しないでください。

**Syntax:**

```typescript
delete(): void
```

**Example:**

```typescript
geoJsonHandle.delete();
```

#### forceUpdate()

次のフレームでレイヤーの更新をマークします。`featureUpdated` イベントをトリガーする必要がある場合に呼び出します。

**Syntax:**

```typescript
forceUpdate(): void
```

**Example:**

```typescript
// スタイル変更後に再評価をトリガー
layer.forceUpdate();
```

### Events

:::note
これらのイベントの背景にあるデータ構造（Layer、FeatureSet、Feature、Batch）については [レイヤーと Descriptor](../../introduction/about-layer/#レイヤーのデータ構造) を参照してください。イベントコールバックで使用する `FeatureEvaluator` クラスについては [FeatureEvaluator](../feature-evaluator/) を参照してください。
:::

#### featureCreated

**Description:** レイヤー内で新しい地物が作成されたときに発火します。

**Handler Type:**

```typescript
(params: FeatureCreatedParams) => void
```

**FeatureCreatedParams:**

| Property       | Type                  | Description                                |
| -------------- | --------------------- | ------------------------------------------ |
| `featureSetId` | `FeatureSetId`        | 作成されたフィーチャーセットの一意な識別子 |
| `evaluator`    | `FeatureEvaluator`    | 地物のスタイリングに使用する評価クラス     |
| `credit`       | `string \| undefined` | データソースのクレジット情報（オプション） |

**Example:**

```typescript
layer.on("featureCreated", ({ evaluator }) => {
  console.log("地物が作成されました:", evaluator.id);
});
```

#### featureUpdated

**Description:** レイヤー内の地物が更新されたときに発火します。

**Handler Type:**

```typescript
(params: FeatureUpdatedParams) => void
```

**FeatureUpdatedParams:**

| Property       | Type               | Description                                |
| -------------- | ------------------ | ------------------------------------------ |
| `featureSetId` | `FeatureSetId`     | 更新されたフィーチャーセットの一意な識別子 |
| `evaluator`    | `FeatureEvaluator` | 地物のスタイリングに使用する評価クラス     |
| `updatedAt`    | `number`           | 更新時刻（タイムスタンプ）                 |

**Example:**

```typescript
layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate((_batchId, property) => {
    const height = property?.["height"] as number;
    return {
      color: new Color().setStyle(height > 50 ? "#ff0000" : "#00ff00"),
    };
  });
});
```

#### featureVisibilityChanged

**Description:** 地物の可視性が変更されたときに発火します。

**Handler Type:**

```typescript
(params: FeatureVisibilityChangedParams) => void
```

**FeatureVisibilityChangedParams:**

| Property       | Type           | Description                                  |
| -------------- | -------------- | -------------------------------------------- |
| `featureSetId` | `FeatureSetId` | 可視性が変更されたフィーチャーセットの識別子 |
| `visible`      | `boolean`      | フィーチャーセットが現在可視かどうか         |

#### featureRemoved

**Description:** レイヤーから地物が削除されたときに発火します。

**Handler Type:**

```typescript
(params: FeatureRemovedParams) => void
```

**FeatureRemovedParams:**

| Property       | Type           | Description                          |
| -------------- | -------------- | ------------------------------------ |
| `featureSetId` | `FeatureSetId` | 削除されたフィーチャーセットの識別子 |

#### updated

**Description:** `update()`（または `view.updateLayerById()`）で新しい設定が適用された後に発火します。ハンドラーには渡された設定がそのまま渡されます。

**Handler Type:**

```typescript
(l: LayerDescription) => void
```

**Example:**

```typescript
layer.on("updated", (description) => {
  console.log("レイヤーが更新されました", description);
});
```

#### deleted

**Description:** レイヤーが削除されたときに発火します。

**Handler Type:**

```typescript
() => void
```

**Example:**

```typescript
layer.on("deleted", () => {
  console.log("レイヤーが削除されました");
});
```

---

## BaseHandle

メッシュ、ライト、エフェクトを制御するためのハンドルクラスです。`ThreeView.addMesh()`、`ThreeView.addLight()`、`ThreeView.addEffect()` で Descriptor を追加した際に返されます。

### Properties

#### id

**Type:** `string`

**Description:** Descriptor の一意な識別子。

**Example:**

```typescript
// SkyMeshDesc が登録済みであること
const skyHandle = view.addMesh<SkyMeshDesc>({ sky: {} });
console.log("Descriptor ID:", skyHandle.id);
```

#### visible

**Type:** `boolean`

**Description:** Descriptor がシーンで表示されているかどうか。

**Example:**

```typescript
// 表示状態を確認
console.log("表示中:", skyHandle.visible);

// 表示/非表示を切り替え
skyHandle.visible = false;
```

#### ref

**Type:** `T` (BaseDesc のサブクラス)

**Description:** 基底 Descriptor インスタンスへの直接アクセスを提供します。ハンドルを介して公開されていない Descriptor 固有のメソッドやプロパティにアクセスするために使用します。

**Example:**

```typescript
// SkyMeshDesc が登録済みであること
const skyHandle = view.addMesh<SkyMeshDesc>({ sky: {} });

// 基底 Descriptor インスタンスにアクセス
const skyDesc = skyHandle.ref;
```

### Methods

#### update()

部分的な更新で Descriptor 設定を更新します。指定されたプロパティのみが変更され、その他は変更されません。

**Syntax:**

```typescript
update(updates: UpdateConfig): void
```

**Parameters:**

- `updates`: 更新するプロパティを含む部分的な設定オブジェクト

**Example:**

```typescript
// SkyMeshDesc が登録済みであること
const skyHandle = view.addMesh<SkyMeshDesc>({ sky: {} });

// 設定を更新
skyHandle.update({ sky: { sunAngularRadius: 0.05 } });
```

#### delete()

シーンから Descriptor を削除し、リソースを解放します。削除後はハンドルを使用しないでください。

**Syntax:**

```typescript
delete(): void
```

**Example:**

```typescript
skyHandle.delete();
```

### Events

#### deleted

**Description:** Descriptor が削除されたときに発火します。

**Handler Type:**

```typescript
() => void
```

**Example:**

```typescript
skyHandle.on("deleted", () => {
  console.log("SkyMeshが削除されました");
});
```

---

## BaseDesc

メッシュ、ライト、エフェクトの抽象基底クラスです。カスタム Descriptor を作成するにはこのクラスを拡張します。

これらはリソースレイヤーと異なり、純粋にクライアントサイドであり、外部ソースからデータを読み込みません。Three.js オブジェクトを直接作成します。

### Type Parameters

- `Config` - Descriptor の設定型（BaseDescConfig を拡張）
- `UpdateConfig` - 更新可能な設定プロパティ（BaseDescConfigUpdate を拡張）
- `Instance` - Descriptor が作成する基底の Three.js オブジェクト型
- `CustomEvent` - Descriptor が発火できる追加のカスタムイベント

### Properties

#### id

**Type:** `string`

**Description:** Descriptor の一意な識別子。`config.id` で指定するか、自動生成されます。

#### visible

**Type:** `boolean`

**Description:** Descriptor が現在表示されているかどうかを取得または設定します。

### Methods

#### onCreate() (abstract)

Descriptor がシーンに追加されたときに呼び出されます。Three.js オブジェクトを作成するためにオーバーライドします。ここで `this._instance` を初期化し、適切なシーンに追加する必要があります。

**Syntax:**

```typescript
abstract onCreate(): void
```

#### onUpdateConfig()

`BaseHandle.update()` を介して Descriptor 設定が更新されたときに呼び出されます。カスタム設定の更新を処理するためにオーバーライドします。

**Syntax:**

```typescript
onUpdateConfig(updates: UpdateConfig): void
```

**Parameters:**

- `updates`: 更新される設定プロパティ

#### onDestroy()

`BaseHandle.delete()` を介して Descriptor が削除されたときに呼び出されます。リソースをクリーンアップするためにオーバーライドします。`super.onDestroy()` を呼び出すことを忘れないでください。

**Syntax:**

```typescript
onDestroy(): void
```

### Example

```typescript
import { BaseDesc, type BaseDescConfig } from "@navaramap/three";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

// カスタム設定型を定義
type MyBoxConfig = BaseDescConfig & {
  size?: number;
  color?: number;
};

// カスタム Descriptor を作成
class MyBoxDesc extends BaseDesc<MyBoxConfig, MyBoxConfig, Mesh> {
  private size: number;
  private color: number;

  constructor(view: ThreeView, ctx: ViewContext, config: MyBoxConfig) {
    super(view, ctx, config);
    this.size = config.size ?? 1;
    this.color = config.color ?? 0xff0000;
  }

  onCreate() {
    const geometry = new BoxGeometry(this.size, this.size, this.size);
    const material = new MeshBasicMaterial({ color: this.color });
    this._instance = new Mesh(geometry, material);
    this.ctx.scenes.opaque.add(this._instance);
  }

  onUpdateConfig(updates: MyBoxConfig) {
    super.onUpdateConfig(updates);

    if (updates.color !== undefined && this._instance) {
      (this._instance.material as MeshBasicMaterial).color.set(updates.color);
    }
  }

  onDestroy() {
    if (this._instance) {
      this.ctx.scenes.opaque.remove(this._instance);
      this._instance.geometry.dispose();
      (this._instance.material as MeshBasicMaterial).dispose();
    }
    super.onDestroy();
  }
}
```

### BaseDescConfig

すべてのメッシュ・エフェクト・ライトに共通する基本設定オプション。

| Property  | Type                   | Default  | Description                |
| --------- | ---------------------- | -------- | -------------------------- |
| `id`      | `string \| undefined`  | 自動生成 | Descriptor のカスタム ID      |
| `visible` | `boolean \| undefined` | `true`   | Descriptor を表示するかどうか |
