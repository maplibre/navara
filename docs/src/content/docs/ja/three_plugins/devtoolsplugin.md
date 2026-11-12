---
title: DevtoolsPlugin
description: 動作中のビューを調べる開発用ツールを 1 つのパネルにまとめたプラグイン。プロファイラーとレイヤーインスペクターを備えます。
sidebar:
  order: 7
since: 0.3.2
---

## 概要

`DevtoolsPlugin` は、動作中のビューを調べるためのパネルをページに追加します。パネルにはツールごとのタブがあります。

- **Profiler**: 地図の描画速度とその理由を示します。フレームレート、CPU と GPU のフレーム時間、ドローコール、予算に対するエンジンのメモリ、ソースごとのダウンロード、バックグラウンド処理、そしてレンダラーの画像（法線、深度、影など）を地図の隅に表示します。
- **Layers**: ビューのレイヤーと、それぞれのコスト（メッシュ、メモリ、ダウンロード）を一覧します。レイヤーごとの非表示チェックボックス、solo・ワイヤーフレーム・バウンディングボックスの切り替え、そして選択したレイヤーのマテリアルが受け付けるすべての設定を並べたスタイルフォームを備えます。

各行と各設定は、マウスを重ねると説明を表示します。各ツールには `enabled` の切り替えがあり、無効にしたツールはすべての処理を止めます。

これらのツールは開発ビルドとサンプルページ向けです。アプリケーションに含めて配布しないでください。

## 使い方

```typescript
import ThreeView from "@navaramap/three";
import { DefaultPlugin } from "@navaramap/three-default-plugin";
import { DevtoolsPlugin } from "@navaramap/three-plugins";

const view = new ThreeView({ container });

const devtools = new DevtoolsPlugin();

view.addPlugin(new DefaultPlugin());
view.addPlugin(devtools);
await view.init();

// ` キーでパネルの表示・非表示を切り替えます。
// コードからツールを無効にすると、追加したリスナーをすべて外します。
if (devtools.profiler) devtools.profiler.enabled = false;
```

使うツールとその設定はコンストラクタで指定します。

```typescript
const devtools = new DevtoolsPlugin({
  tools: ["layers"],
  panel: { visible: false, hotkey: "F2" },
  layers: { wireframe: false },
});
```

`DevtoolsPlugin` には peer dependency の `postprocessing` が必要です。パネル用の `tweakpane` は同梱されます。

## コンストラクタ

```typescript
new DevtoolsPlugin(options?: DevtoolsPluginOptions);
```

プラグインは `view.init()` の**前に** `view.addPlugin()` で登録してください。Layers ツールは `init()` の中で各レイヤーの設定の記録を始めるため、それ以降に追加されたレイヤーだけを把握します。

| プロパティ | 型                                           | デフォルト               | 説明                                                                                                  |
| ---------- | -------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `tools`    | `DevtoolName[]`                              | `["profiler", "layers"]` | 追加するツール。この順にタブが並びます。[`DevtoolName`](#devtoolname) を参照してください。              |
| `panel`    | `DevtoolsPanelOptions`                       | `{}`                     | パネルのタイトル、サイズ、ホットキー、初期表示。[`DevtoolsPanelOptions`](#devtoolspaneloptions) を参照してください。 |
| `profiler` | `{ enabled?: boolean }`                      | `{}`                     | Profiler の設定。`enabled` は有効な状態で始めるかどうかです（デフォルト `true`）。                      |
| `layers`   | `{ enabled?: boolean; wireframe?: boolean }` | `{}`                     | Layers ツールの設定。[ワイヤーフレームとメモリ](#ワイヤーフレームとメモリ) を参照してください。          |

## プロパティ

### panel

**型:** `DevtoolsPanel`

**説明:** ツールをタブとして持つパネルです。`panel.visible` で表示・非表示を設定し、`panel.toggle()` で切り替えます。

### profiler

**型:** `ProfilerPlugin | undefined`

**説明:** Profiler です。`tools` に含まれないときは `undefined` です。`enabled` で有効・無効を切り替えます。`record(count)` は次に描画される `count` フレームを記録し、それぞれの時間とパスごとのコストで resolve します。

### layers

**型:** `LayerInspectorPlugin | undefined`

**説明:** Layers ツールです。`tools` に含まれないときは `undefined` です。`enabled` で有効・無効を切り替えます。`select(id)` は id でレイヤーを選択し、`selected()` は選択中のレイヤーを返します。

## メソッド

### dispose()

```typescript
dispose(): void
```

すべてのツールを無効にし、パネルをページから取り除きます。`view.dispose()` もこのメソッドを呼ぶため、ツールはビューと一緒に止まります。複数回呼んでも問題ありません。

## Profiler

Navara は何かが変わったときだけ描画するため、フレームレートとフレーム時間は描画されたフレームを対象にします。地図が静止している間、サマリーは「idle」と表示します。

| セクション                | 表示する内容                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the frame time goes | 直近に描画されたフレーム。エンジンの更新、読み込みと構築、各レンダーパス（CPU 時間、GPU 時間、ドローコール）、その他。                              |
| Memory                    | 種類ごとのエンジンのメモリと予算、再利用のために保持しているタイルのキャッシュ、詳細度を下げているかどうか。Worker、フォント、JS のヒープは予算の外に表示します。 |
| Downloads                 | ソースごとのリクエスト数とバイト数。                                                                                                                |
| Background work           | 種類ごと（地形タイル、Worker タスク、フィーチャー、画像テクスチャ、ダウンロード）の待ち処理と Worker スレッド。                                     |
| Draw details              | 直近に描画されたフレームのドローコール、三角形、ジオメトリ、テクスチャ、そして直近 5 秒にコンパイルされたシェーダープログラム。数が落ち着かない場合は、毎フレーム何かが再コンパイルされています。 |
| Screen buffers            | 画面サイズのレンダーターゲット。所有するパスごとに表示します。                                                                                      |
| Buffer viewer             | レンダラーの画像を 1 つ地図の隅に表示します。シーンの色、法線、粗さ、反射率、深度（距離として）、影、選択エフェクト、emissive。使えないバッファは理由を表示します。 |
| Record frames             | 次の N フレームの時間とパスごとのコストを JSON としてダウンロードします。                                                                           |

GPU 時間には WebGL 拡張 `EXT_disjoint_timer_query_webgl2`（デスクトップ版 Chrome）が必要です。拡張がない場合、GPU の列は空になります。

## Layers

レイヤーをクリックすると選択されます。チェックボックスは、そのマテリアルに `show: false` を設定してレイヤーを隠します。

スタイルフォームは、選択したレイヤーのマテリアルのすべての設定を並べます。レイヤーが設定している項目には `•` が付き、それ以外はエンジンのデフォルト値を表示します。変更は編集と同時に反映され、「Undo my changes」で元の値に戻ります。フォームが表示するのは、アプリが `addLayer()` に渡した設定にすべての `layer.update()` を重ねたもので、エンジンが導出する値ではありません。

### ワイヤーフレームとメモリ

ワイヤーフレームの切り替えには各ジオメトリの頂点配列を JS メモリに残す必要があります。Layers ツールは有効な間、その間に作られたすべての地形とポリゴンのジオメトリについてそれを保持します。Profiler の JS ヒープにはそのコピーが含まれます。ツールを無効にすると保持をやめますが、ツールを有効にする前に作られたジオメトリはワイヤーフレームを表示できません。コピーを除いてメモリを測るには `layers: { wireframe: false }` を渡してください。このときワイヤーフレームの切り替えは非表示になります。

## 型

### DevtoolName

```typescript
type DevtoolName = "profiler" | "layers";
```

`DevtoolsPlugin` が追加できるツール。タブの名前で表します。

### DevtoolsPluginOptions

```typescript
type DevtoolsPluginOptions = {
  tools?: DevtoolName[];
  panel?: DevtoolsPanelOptions;
  profiler?: { enabled?: boolean };
  layers?: { enabled?: boolean; wireframe?: boolean };
};
```

コンストラクタの設定です。[コンストラクタ](#コンストラクタ) を参照してください。

### DevtoolsPanelOptions

```typescript
type DevtoolsPanelOptions = {
  title?: string;
  container?: HTMLElement;
  hotkey?: string | null;
  width?: number;
  visible?: boolean;
};
```

| プロパティ  | 型               | デフォルト          | 説明                                                                                                             |
| ----------- | ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `title`     | `string`         | `"Navara devtools"` | パネルのタイトル。                                                                                               |
| `container` | `HTMLElement`    | `document.body`     | パネルを追加する要素。                                                                                           |
| `hotkey`    | `string \| null` | `` "`" ``           | パネルの表示・非表示を切り替えるキー（`KeyboardEvent.key`）。テキスト入力にフォーカスがある間は無視されます。`null` で無効になります。 |
| `width`     | `number`         | `440`               | パネルの幅（CSS ピクセル）。                                                                                     |
| `visible`   | `boolean`        | `true`              | パネルを表示した状態で始めるかどうか。                                                                           |

## 補足

- **開発専用です。** Profiler は有効な間 `fetch` と各レンダーパスをラップし、Layers ツールは有効な間、ワイヤーフレームのためにジオメトリ配列を保持します。どちらもアプリケーションには不要な時間とメモリを使います。
- **ツールを 1 つだけ使う。** `ProfilerPlugin` と `LayerInspectorPlugin` もエクスポートされています。どちらかを単独で `view.addPlugin()` に渡すと、そのツールだけが専用のパネルに表示されます。

## 関連リソース

- [About](../about/): three_plugins の概要
- [Devtools のサンプル](https://navara.world/examples/plugin/devtools): 地形、画像、ベクトルタイル、3D Tiles の上で動くプラグイン
