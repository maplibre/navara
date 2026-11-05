---
title: StreetLightsPlugin
description: ベクトルタイルから、カメラ周辺に夜の街灯・屋上灯・流れる車をストリーミングするプラグイン。
sidebar:
  order: 4
---

## 概要

`StreetLightsPlugin` は、道路と建物を持つベクトルタイルセットを夜の街に変えます。`addRoads()` は道路の中心線の上に置いたポリラインレイヤーを路面として受け取り、灯りを持たないフィーチャーを非表示にします。`start()` は同じタイルセットのズーム 14 のタイルを `follow()` に渡した位置の周辺にストリーミングし、すべての道路に沿った街灯、建物リーダーが高さを返した屋上の赤い灯、道路の区間を走る車を配置します。

プラグインはこれらのタイルをもう一度取得します。エンジンは描画のためにタイルを復号しますが、フィーチャーのジオメトリを公開しないためです。プラグインはタイルのスキーマを知りません。`roads` と `buildings` オプションでタイルレイヤーの名前を指定し、そのタイルセットのプロパティを読む [`RoadReader`](#roadreader) と [`BuildingReader`](#buildingreader) を渡します。下の例は OpenMapTiles スキーマを読みます。

街灯と屋上灯は `point` レイヤーです。`start()` に渡した Selective Effect（組み込みの [`selectiveBloom`](../../three_default_descs/effect-desc/selective-bloom-effect-desc/) など）がそれらに適用されます。車は [`StreetTrafficMeshDesc`](#streettrafficmeshdesc) が描く加算合成の点で、プラグインが `init()` 時に登録します。どちらもシーンにライトは必要ありません。

## 使い方

```typescript
import ThreeView, { Color } from "@navaramap/three";
import type { SelectiveBloomEffectDesc } from "@navaramap/three-default-descs";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import {
  StreetLightsPlugin,
  TileJsonPlugin,
  isRoadClass,
  type StreetTrafficDescriptions,
} from "@navaramap/three-plugins";

// 車は毎フレーム動きます。
const view = new ThreeView<DefaultDescriptions | StreetTrafficDescriptions>({
  container,
  animation: true,
});

const tilejson = new TileJsonPlugin();
// プラグインはタイルのスキーマを知りません。このリーダーが OpenMapTiles を対応付けます。
const streetLights = new StreetLightsPlugin({
  radius: 2,
  roads: {
    layer: "transportation",
    properties: ["class", "oneway"],
    read: ({ class: roadClass, oneway }) =>
      isRoadClass(roadClass)
        ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
        : undefined,
  },
  buildings: {
    layer: "building",
    // 90 m 以上に灯りを置きます。部品に分かれた外形は、灯りを部品に任せます。
    read: ({ render_height: height, hide_3d }) =>
      typeof height === "number" && height >= 90 && hide_3d !== true
        ? height
        : undefined,
  },
});

view.addPlugin(new DefaultPlugin());
view.addPlugin(tilejson);
view.addPlugin(streetLights);
await view.init();

const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });

// タイルセット。その TileJSON ドキュメントは、プラグインが道路を
// ストリーミングするタイル URL テンプレートも示します。
let tileTemplate = "";
tilejson.on("loaded", ({ tilejson: document }) => {
  tileTemplate = document.tiles[0];
});
const streets = await tilejson.addSource({
  type: "vector-tile",
  url: "https://tiles.openfreemap.org/planet",
});

// 暗い路面。灯りを持たないクラスはプラグインが非表示にします。
const roads = view.addLayer({
  type: "vector",
  source: streets,
  sourceLayers: ["transportation"],
  polyline: { color: new Color().setStyle("#15171c"), clampToGround: true },
});
streetLights.addRoads(roads);
streetLights.start({ tileTemplate, effectIds: [bloom.id] });

// カメラの移動に合わせて、周辺のタイルを読み込んだ状態に保ちます。
view.on("postUpdate", () => {
  const { lng, lat } = view.camera.positionGeographic;
  streetLights.follow(lng, lat);
});
```

## コンストラクタ

```typescript
new StreetLightsPlugin(config: StreetLightsConfig);
```

`view.init()` の**前に** `view.addPlugin()` でプラグインを登録してください。`init()` 時にキー `streetTraffic` で `StreetTrafficMeshDesc` を登録します。

| プロパティ | 型                     | デフォルト | 説明                                                                                                                |
| ---------- | ---------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `radius`   | `number`               | `2`        | 追従位置の周辺で読み込んだ状態に保つタイル数を、ズーム 14 のタイル単位の半径で指定します。`2` は 5 × 5 ブロックで、東京の緯度では差し渡し約 10 km です。 |
| `traffic`  | `StreetTrafficOptions` | `{}`       | 車の速度倍率と灯りの大きさ。[`StreetTrafficOptions`](#streettrafficoptions) を参照してください。                   |
| `roads`    | `StreetLightsRoads`    |            | 道路を持つタイルレイヤーとその読み方。[`StreetLightsRoads`](#streetlightsroads) を参照してください。                |
| `buildings` | `StreetLightsBuildings` |          | 建物を持つタイルレイヤーとその読み方。[`StreetLightsBuildings`](#streetlightsbuildings) を参照してください。        |

## メソッド

### addRoads(layer)

```typescript
addRoads(layer: Layer): void
```

道路の中心線の上に `polyline` マテリアルで置いた [ベクトルレイヤー](../../three/layer/vector-layer/) を路面として受け取ります。道路リーダーが読み飛ばすフィーチャー（鉄道や歩道など）は非表示になり、残りは [`RoadClass`](#roadclass) の幅になって、`setVisible()` に従います。色とクランプはレイヤー自身のマテリアルで決まります。レイヤーを削除するのは呼び出し側です。プラグインが持っている間、フィーチャーごとの `show` と `width` はプラグインのものなので、同じレイヤーに別の評価器を付けると競合します。同じレイヤーを再度渡しても何もしません。レイヤーが既に持っているフィーチャーは次のフレームで評価し直されます。レイヤーは `roads.layer` で指定したタイルレイヤーだけを表示する必要があるので、`sourceLayers` に同じ名前を指定してください。街灯と車はその道路から作られ、他の線のレイヤーも同じプロパティを持つことがある（OpenMapTiles の `transportation_name` など）ため、指定しないとそれらも道路として描かれます。`view.init()` の**後に**呼び出す必要があります。それ以外の場合はエラーをスローします。

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

### setVisible(visible, part?)

```typescript
setVisible(visible: boolean, part?: StreetLightsPart): void
```

街路レベルの細部のうち `part` で指定した部分の表示と非表示を切り替えます。`part` を省略すると、すべての部分（路面、街灯、屋上灯、車）を切り替えます。すべての部分は細部が判別できなくなる高度以上で消すために、個別の部分は車だけを消すといった用途に使います。

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

プラグインが追加したすべてのレイヤー・ソース・メッシュを破棄し、読み込み中のタイルを停止し、`addRoads()` に渡した道路レイヤーから切り離します。それらのレイヤーは呼び出し側のものとして残ります。Navara は評価済みの値を消せないため、プラグインが設定した `show` と `width` はフィーチャーに残ります。レイヤーを削除するか、自分で評価し直してください。その後プラグインは再利用できません。

## 型

### StreetLightsConfig

```typescript
type StreetLightsConfig = {
  radius?: number;
  traffic?: StreetTrafficOptions;
  roads: StreetLightsRoads;
  buildings: StreetLightsBuildings;
};
```

コンストラクタのオプションです。[コンストラクタ](#コンストラクタ) を参照してください。

### StreetLightsRoads

```typescript
type StreetLightsRoads = {
  layer: string;
  read: RoadReader;
  properties?: string[];
};
```

| プロパティ   | 型           | デフォルト         | 説明                                                                                                              |
| ------------ | ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `layer`      | `string`     |                    | 道路の中心線を持つタイルレイヤー。                                                                                |
| `read`       | `RoadReader` |                    | 道路フィーチャーを 1 つ読み取り、[`RoadClass`](#roadclass) と向きを返します。[`RoadReader`](#roadreader) を参照してください。 |
| `properties` | `string[]`   | すべて             | `read` が必要とするプロパティ。リーダーには道路レイヤーでも街灯・車の配置でもこれらだけが渡されるので、リーダーが読む名前をすべて指定してください。省略するとすべてのプロパティが渡され、道路レイヤーは評価のたびに全プロパティを読みます。 |

### StreetLightsBuildings

```typescript
type StreetLightsBuildings = {
  layer: string;
  read: BuildingReader;
};
```

| プロパティ | 型               | デフォルト   | 説明                                                                                         |
| ---------- | ---------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `layer`    | `string`         |              | 建物のフットプリントを持つタイルレイヤー。                                                   |
| `read`     | `BuildingReader` |              | 建物フィーチャーを 1 つ読み取り、屋上の高さを返します。灯りを置かない建物では `undefined` を返します。[`BuildingReader`](#buildingreader) を参照してください。 |

### RoadReader

```typescript
type RoadReader = (
  properties: Record<string, unknown>,
) => { roadClass: RoadClass; oneway?: Oneway } | undefined;

type Oneway = 1 | -1 | 0;
```

道路フィーチャーのプロパティを 1 つ読み取り、描画と灯りに使う [`RoadClass`](#roadclass) と向き（`1` は順方向のみ、`-1` は逆方向のみ、`0` は双方向でデフォルト）を返します。灯りを持たないフィーチャーでは `undefined` を返します。独自の道路の種類を持つタイルセットでは、それをこれらのクラスに対応付けます。

```typescript
import type { RoadReader } from "@navaramap/three-plugins";

const read: RoadReader = ({ highway }) =>
  highway === "main"
    ? { roadClass: "primary" }
    : highway === "local"
      ? { roadClass: "minor" }
      : undefined;

// プラグインには `roads: { layer: "roads", properties: ["highway"], read }` として渡します。
```

### BuildingReader

```typescript
type BuildingReader = (properties: Record<string, unknown>) => number | undefined;
```

建物フィーチャーのプロパティを 1 つ読み取り、屋上の高さを楕円体からのメートルで返します。灯りを置かない建物では `undefined` を返します。屋上灯はその高さの 2 m 上に置かれ、地面にはクランプされないため、地形の上に建つ建物では地面の高さを足してください。タイルセットの屋上の高さ（OpenMapTiles の `render_height` など）をそのまま返すと、楕円体から押し出した建物と合います。

### RoadClass

```typescript
type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "minor"
  | "service";
```

プラグインが扱う道路クラスです。高速道路から敷地内通路までの段階になっています。クラスごとに路面の幅、街灯の間隔、車の密度が決まっていて、`motorway` に近いほど太く密になります。別のタイルセット用のリーダーは、そのデータの道路の種類をこれらのクラスに対応付けます。

### isRoadClass(value)

```typescript
isRoadClass(value: unknown): value is RoadClass
```

タイルの値が [`RoadClass`](#roadclass) のいずれかの名前かどうかを判定します。上の OpenMapTiles の `class` のように、プロパティをそのまま通すリーダー向けです。自身のキーだけを見るので、`Object.prototype` のメンバーと同じ名前の値は道路になりません。

### StreetLightsStartOptions

```typescript
type StreetLightsStartOptions = {
  tileTemplate: string;
  effectIds?: string[];
};
```

| プロパティ     | 型         | デフォルト | 説明                                                                                                   |
| -------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `tileTemplate` | `string`   |            | 路面レイヤーが表示しているタイルセットの `{z}/{x}/{y}` タイル URL。TileJSON ドキュメントに記載されているものです。 |
| `effectIds`    | `string[]` | `[]`       | 街灯と屋上灯が参加する Selective Effect（Bloom など）。                                                 |

### StreetLightsPart

```typescript
type StreetLightsPart = "roads" | "lamps" | "beacons" | "traffic";
```

[`setVisible()`](#setvisiblevisible-part) で個別に非表示にできる、街路レベルの細部の部分です。

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
