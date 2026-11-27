---
title: OverlayPlugin
description: navara_three 向けのワールド座標からスクリーン座標への HTML オーバーレイ投影プラグイン。
sidebar:
  order: 3
---

## 概要

`OverlayPlugin` は、地理座標（緯度/経度/高度）のセットを追跡し、毎レンダーフレームでスクリーン座標に投影します。これにより、カメラの移動に追従する HTML オーバーレイ（マーカー、ラベル、ツールチップなど）を実現できます。

プラグインが担当するのは投影計算のみです。実際の HTML 要素のレンダリングはアプリケーション側に委ねられるため、スタイリングやインタラクションを完全に制御できます。

## 使い方

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { OverlayPlugin, moveOverlayElement } from "@navaramap/three-plugins";

const view = new ThreeView({ container, animation: true });
const defaultPlugin = new DefaultPlugin();
const overlayPlugin = new OverlayPlugin({ maxDistance: 100_000 });

view.addPlugin(defaultPlugin);
view.addPlugin(overlayPlugin);
await view.init();

// 追跡する位置を設定
overlayPlugin.setPositions([
  { id: "tokyo-tower", lng: 139.7454, lat: 35.6586, alt: 0 },
  { id: "skytree", lng: 139.8107, lat: 35.7101, alt: 0 },
]);

// 毎フレーム HTML 要素を更新
const unsub = overlayPlugin.onUpdate(({ projected }) => {
  for (const [id, pos] of projected) {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = "";
      moveOverlayElement(el, pos.x, pos.y);
    }
  }
});

// クリーンアップ
unsub();
overlayPlugin.dispose();
```

## コンストラクタ

```typescript
new OverlayPlugin(config?: OverlayConfig)
```

### OverlayConfig

| プロパティ | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `maxDistance` | `number` | `100_000` | カメラからこの距離（メートル）以上離れた位置はスキップされる |

## メソッド

### setPositions(positions)

```typescript
setPositions(positions: WorldPosition[]): void
```

追跡するワールド座標のセットを置き換えます。次のフレームで新しい位置が投影され、`onUpdate` のリスナーが呼び出されます。マップが静止していても、このためにフレームが描画されます。1 フレームの間の呼び出し（`onUpdate` のリスナーの中からの呼び出しを含む）は、まとめて次のフレームで投影されます。

### onUpdate(fn)

```typescript
onUpdate(fn: (state: OverlayState) => void): () => void
```

投影更新を購読します。コールバックは描画されるフレームごとに、最新の投影スクリーン座標とともに呼び出されます。`animation: true` でない場合、ビューは何かが変化したとき（カメラの移動、データの読み込み、`setPositions()` の呼び出し）にだけ描画します。新しいリスナーは次のフレームで現在の投影結果を受け取ります。マップが静止していても、このためにフレームが描画されます。購読解除関数を返します。

### dispose()

```typescript
dispose(): void
```

`preRender` フックを削除し、すべてのリスナーをクリアし、内部状態をリセットします。

## 型

### WorldPosition

| プロパティ | 型 | 説明 |
|-----------|------|------|
| `id` | `string` | 投影マップのキーとして使用される一意の識別子 |
| `lng` | `number` | 経度（度） |
| `lat` | `number` | 緯度（度） |
| `alt` | `number` | 高度（メートル） |

### ProjectedPosition

| プロパティ | 型 | 説明 |
|-----------|------|------|
| `x` | `number` | スクリーン X 座標（ピクセル） |
| `y` | `number` | スクリーン Y 座標（ピクセル） |
| `distance` | `number` | カメラからの距離（メートル、ECEF ユークリッド距離） |

### OverlayState

| プロパティ | 型 | 説明 |
|-----------|------|------|
| `projected` | `Map<string, ProjectedPosition>` | 位置 ID からスクリーン座標へのマップ。`maxDistance` 以内の位置のみ含まれる。 |

## ユーティリティ関数

### moveOverlayElement(el, x, y)

```typescript
moveOverlayElement(el: HTMLElement, x: number, y: number): void
```

絶対配置された HTML 要素を、GPU アクセラレーションされた CSS `translate()` 変換を使用して指定のスクリーン座標に配置します。便利関数であり、独自の配置ロジックを実装することもできます。

## 距離情報を UI に活用する

`ProjectedPosition` の `distance` フィールドを使って、不透明度のフェードやサイズのスケーリングなどの視覚効果を実現できます。

```typescript
overlayPlugin.onUpdate(({ projected }) => {
  for (const [id, pos] of projected) {
    const el = document.getElementById(id);
    if (!el) continue;

    moveOverlayElement(el, pos.x, pos.y);

    // 距離に応じてマーカーをフェードアウト
    const opacity = Math.max(0.3, 1 - pos.distance / 100_000);
    el.style.opacity = String(opacity);
  }
});
```

## 関連リソース

- [PersonViewPlugin](../personviewplugin/): OverlayPlugin と組み合わせて一人称 / 三人称ビューのナビゲーションとマーカーを実現
- [About three_plugins](../about/): パッケージ概要
