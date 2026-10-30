---
title: StreetLightsPlugin
description: OpenMapTiles スキーマのベクトルタイルから、カメラ周辺に夜の街灯・屋上灯・流れる車をストリーミングするプラグイン。
sidebar:
  order: 4
---

## 概要

`StreetLightsPlugin` は、OpenMapTiles スキーマのベクトルタイルセットを夜の街に変えます。`addRoads()` はベクトルソースの `transportation` レイヤーの上に暗い路面を描きます。`start()` は同じタイルセットのズーム 14 のタイルを `follow()` に渡した位置の周辺にストリーミングし、すべての道路に沿った街灯、高さ 90 m 以上のすべての屋上の赤い灯、道路の区間を走る車を配置します。

プラグインはこれらのタイルをもう一度取得します。エンジンは描画のためにタイルを復号しますが、フィーチャーのジオメトリを公開しないためです。タイルセットは OpenMapTiles スキーマに従っている必要があります。`transportation` フィーチャーに `class` と `oneway`、`building` フィーチャーに `render_height` が必要です。

街灯と屋上灯は `point` レイヤーです。`start()` に渡した Selective Effect（組み込みの [`selectiveBloom`](../../three_default_descs/effect-desc/selective-bloom-effect-desc/) など）がそれらに適用されます。車は [`StreetTrafficMeshDesc`](#streettrafficmeshdesc) が描く加算合成の点で、プラグインが `init()` 時に登録します。どちらもシーンにライトは必要ありません。

## 使い方

```typescript
import ThreeView from "@navaramap/three";
import type { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import {
  StreetLightsPlugin,
  TileJsonPlugin,
  type StreetTrafficDescriptions,
} from "@navaramap/three-plugins";

// 車は毎フレーム動きます。
const view = new ThreeView<DefaultDescriptions | StreetTrafficDescriptions>({
  container,
  animation: true,
});

const tilejson = new TileJsonPlugin();
const streetLights = new StreetLightsPlugin({ radius: 2 });

view.addPlugin(new DefaultPlugin());
view.addPlugin(tilejson);
view.addPlugin(streetLights);
await view.init();

const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });

// OpenMapTiles スキーマのベクトルタイルセット。その TileJSON ドキュメントは、
// プラグインが道路をストリーミングするタイル URL テンプレートも示します。
let tileTemplate = "";
tilejson.on("loaded", ({ tilejson: document }) => {
  tileTemplate = document.tiles[0];
});
const streets = await tilejson.addSource({
  type: "vector-tile",
  url: "https://tiles.openfreemap.org/planet",
});

streetLights.addRoads(streets);
streetLights.start({ tileTemplate, effectIds: [bloom.id] });

// カメラの移動に合わせて、周辺のタイルを読み込んだ状態に保ちます。
view.on("postUpdate", () => {
  const { lng, lat } = view.camera.positionGeographic;
  streetLights.follow(lng, lat);
});
```

## コンストラクタ

```typescript
new StreetLightsPlugin(config?: StreetLightsConfig);
```

`view.init()` の**前に** `view.addPlugin()` でプラグインを登録してください。`init()` 時にキー `streetTraffic` で `StreetTrafficMeshDesc` を登録します。

| プロパティ | 型                     | デフォルト | 説明                                                                                                                |
| ---------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `radius`   | `number`               | `2`        | 追従位置の周辺で読み込んだ状態に保つタイル数を、ズーム 14 のタイル単位の半径で指定します。`2` は 5 × 5 ブロックで、東京の緯度では差し渡し約 10 km です。 |
| `traffic`  | `StreetTrafficOptions` | `{}`       | 車の速度倍率と灯りの大きさ。[`StreetTrafficOptions`](#streettrafficoptions) を参照してください。                   |

## メソッド

### addRoads(source)

```typescript
addRoads(source: Source): Layer
```

`source` の `transportation` レイヤーの上に [ベクトルレイヤー](../../three/layer/vector-layer/) を追加し、交通のある道路クラスすべてを地面にクランプした暗い線として描きます。線幅はクラスごとのピクセル値です（motorway の `6` から service の `1.5` まで）。鉄道や歩道などそれ以外のクラスは非表示になります。`view.init()` の**後に**呼び出す必要があります。それ以外の場合はエラーをスローします。

作成したレイヤーを返します。

### start(options)

```typescript
start(options: StreetLightsStartOptions): void
```

`options.tileTemplate` のタイルから街灯・屋上灯・車のストリーミングを開始します。どのタイルを読み込むかは `follow()` が決めます。`options.effectIds` は街灯と屋上灯が参加する Selective Effect です。`start()` を再度呼び出すと、前回の開始分のタイルを破棄します。`view.init()` の**後に**呼び出す必要があります。それ以外の場合はエラーをスローします。

### follow(lng, lat)

```typescript
follow(lng: number, lat: number): void
```

位置を含むタイルから `radius` 以内のタイルを近い順に読み込んだ状態に保ち、範囲外になったタイルを破棄します。位置が同じタイル内にとどまる間は何もしないため、毎 `postUpdate` で呼び出しても軽量です。`start()` の**後に**呼び出す必要があります。それ以外の場合はエラーをスローします。

### setVisible(visible)

```typescript
setVisible(visible: boolean): void
```

街路レベルの細部全体（路面、街灯、屋上灯、車）の表示と非表示を切り替えます。細部が判別できなくなる高度以上で消すために使います。

### setLightsOn(on)

```typescript
setLightsOn(on: boolean): void
```

街灯・屋上灯・車の点灯と消灯を切り替えます。路面は残ります。太陽に合わせるために使います。

### update(updates)

```typescript
update(updates: StreetLightsUpdate): void
```

新しい交通オプションを、読み込み済みのタイルとこれから読み込むタイルに適用します。

### dispose()

```typescript
dispose(): void
```

プラグインが追加したすべてのレイヤー・ソース・メッシュを破棄し、読み込み中のタイルを停止します。その後プラグインは再利用できません。

## 型

### StreetLightsConfig

```typescript
type StreetLightsConfig = {
  radius?: number;
  traffic?: StreetTrafficOptions;
};
```

コンストラクタのオプションです。[コンストラクタ](#コンストラクタ) を参照してください。

### StreetLightsStartOptions

```typescript
type StreetLightsStartOptions = {
  tileTemplate: string;
  effectIds?: string[];
};
```

| プロパティ     | 型         | デフォルト | 説明                                                                                                   |
| -------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `tileTemplate` | `string`   |            | OpenMapTiles スキーマのタイルセットの `{z}/{x}/{y}` タイル URL。TileJSON ドキュメントに記載されているものです。 |
| `effectIds`    | `string[]` | `[]`       | 街灯と屋上灯が参加する Selective Effect（Bloom など）。                                                 |

### StreetLightsUpdate

```typescript
type StreetLightsUpdate = {
  traffic?: StreetTrafficOptions;
};
```

### StreetTrafficOptions

```typescript
type StreetTrafficOptions = {
  speed?: number;
  size?: number;
};
```

| プロパティ | 型       | デフォルト | 説明                             |
| ---------- | -------- | ---------- | -------------------------------- |
| `speed`    | `number` | `1`        | すべての車の速度に掛かる倍率。   |
| `size`     | `number` | `2.5`      | 車の灯りの直径（メートル）。     |

車は道路クラスごとの速度で走ります。service 道路の約 5 m/s から motorway の 22 m/s までで、1 台ごとに最大 30 パーセント変化します。

### StreetTrafficDescriptions

```typescript
type StreetTrafficDescriptions = { mesh: StreetTrafficMeshConfig };
```

プラグインが登録する Description です。メッシュハンドルに型を付けるため、`ThreeView<DefaultDescriptions | StreetTrafficDescriptions>` のようにビューの型パラメータに加えてください。

### StreetTrafficMeshDesc

車を描くメッシュ Descriptor で、キー `streetTraffic` で登録されます。車 1 台につき 1 点が GPU 上で道路区間を走り、端まで来ると戻ります。カメラを向くヘッドライトは白、テールライトは赤です。プラグインはタイルごとに 1 つのメッシュを `view.addMesh()` で追加します。`streetTraffic` 設定は、プラグインがタイルから組み立てる車ごとの区間 `data` と、[`StreetTrafficOptions`](#streettrafficoptions) を持ちます。

## 補足

- **評価された値はマテリアルより優先されます。** プラグインはすべての道路・街灯・屋上灯の表示をフィーチャーごとに設定するため、そのレイヤーへの `layer.update({ point: { show } })` は効きません。代わりに `setVisible()` と `setLightsOn()` を使ってください。
- **Bloom に参加するのは街灯と屋上灯だけです。** これらは `selectiveBloom` が読む emissive 色を書き込みます。車は G-buffer の後に描かれる加算合成の点で、エフェクトには参加しません。
- **タイルの出典はソースと同じです。** プラグインはソースが表示しているタイルセットのテンプレートからタイルを取得するため、ソースが持つアトリビューションがそのまま適用されます。
- **毎フレーム描画してください。** 車はビューの時計で動くため、`animation: true` でビューを構築してください。
- **ズーム 14 のみです。** プラグインはカメラのズームに関係なくズーム 14 のタイルを読むため、`radius` はそのタイル単位です。東京の緯度では 1 タイルが差し渡し約 2 km です。

## 関連リソース

- [About](../about/): three_plugins の概要
- [TileJsonPlugin](../tilejsonplugin/): TileJSON ドキュメントからタイル URL テンプレートを読む
- [Vector Layer](../../three/layer/vector-layer/): 路面・街灯・屋上灯の背後にあるレイヤー種別
- [SelectiveBloomEffectDesc](../../three_default_descs/effect-desc/selective-bloom-effect-desc/): 街灯と屋上灯が参加する Bloom
- [Night City](https://navara.world/examples/showcase/night-city): このプラグインで構築したショーケース
