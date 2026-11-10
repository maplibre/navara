---
title: StreetLightsPlugin
description: ベクトルタイルから、カメラ周辺に夜の街灯・屋上灯・流れる車をストリーミングするプラグイン。
sidebar:
  order: 4
---

## 概要

`StreetLightsPlugin` は、道路と建物を夜の街に変えます。`start()` は道路と建物をそれぞれのタイルソースとともに受け取り、路面を描いて、灯りを持たないフィーチャーを非表示にします。続いて `follow()` に渡した位置の周辺にズーム 14 のタイルをストリーミングし、すべての道路に沿った街灯、建物リーダーが高さを返した屋上の赤い灯、道路の区間を走る車を配置します。

道路と建物は、それぞれのソースを指定します。`TileJsonPlugin.addSource()` と同じ TileJSON ドキュメントか、`view.addSource()` と同じ `{z}/{x}/{y}` のベクトルタイル URL です。フィーチャーのプロパティを読む [`RoadReader`](#roadreader) と [`BuildingReader`](#buildingreader) も渡します。下の例は OpenMapTiles スキーマを読みます。プラグインはズーム 14 のタイルを自分で取得するため、路面が描くタイルセットは 2 回要求されます。

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
  isRoadClass,
  type StreetTrafficDescriptions,
} from "@navaramap/three-plugins";

// 車は毎フレーム動きます。
const view = new ThreeView<DefaultDescriptions | StreetTrafficDescriptions>({
  container,
  animation: true,
});

const streetLights = new StreetLightsPlugin();

view.addPlugin(new DefaultPlugin());
view.addPlugin(streetLights);
await view.init();

const bloom = view.addEffect<SelectiveBloomEffectDesc>({ selectiveBloom: {} });

// OpenMapTiles スキーマ用のリーダー。
await streetLights.start({
  roads: {
    sourceType: "tilejson",
    sourceUrl: "https://tiles.openfreemap.org/planet",
    sourceLayers: ["transportation"],
    polyline: { color: new Color().setStyle("#15171c"), clampToGround: true },
    filterFeatureProperties: ["class", "oneway"],
    evaluateFeature: ({ class: roadClass, oneway }) =>
      isRoadClass(roadClass)
        ? { roadClass, oneway: oneway === 1 || oneway === -1 ? oneway : 0 }
        : undefined,
  },
  buildings: {
    sourceType: "tilejson",
    sourceUrl: "https://tiles.openfreemap.org/planet",
    sourceLayers: ["building"],
    // 90 m 以上の屋上に灯りを置きます。部品に分かれた外形は、灯りを部品に任せます。
    evaluateFeature: ({ render_height: height, hide_3d }) =>
      typeof height === "number" && height >= 90 && hide_3d !== true
        ? height
        : undefined,
  },
  effectIds: [bloom.id],
});

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

| プロパティ       | 型               | デフォルト | 説明                                                                                                                   |
| ---------------- | ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tileJsonPlugin` | `TileJsonPlugin` | 内部で生成 | `tilejson` ソースを解決します。省略すると内部で生成し、このプラグインと一緒に破棄します。渡したものは呼び出し側のものとして残ります。 |

## メソッド

### start(options)

```typescript
start(options: StreetLightsStartOptions): Promise<void>
```

道路と建物のソースを開き、路面を描いて、街灯・屋上灯・車のストリーミングを開始します。どのタイルを読み込むかは `follow()` が決めます。路面では、道路リーダーが読み飛ばすフィーチャー（鉄道や歩道など）は非表示になり、残りは [`RoadClass`](#roadclass) の幅になります。`sourceType` と `sourceUrl` が同じ道路と建物は、1 つのソースを共有します。建物に専用のソースを作るのは TileJSON ドキュメントの場合だけで、出典もそこから表示されます。`vector-tile` の URL は直接読みます。プラグインは建物のレイヤーを描かないためです。`start()` を再度呼び出すと、新しいソースが開いた時点で、前回の開始で追加したものをすべて破棄します。後の `start()` や `dispose()` に追い越された呼び出しは、何も開かずに戻ります。`view.init()` の**後に**呼び出す必要があります。それ以外の場合は、返り値の Promise が reject されます。

### follow(lng, lat)

```typescript
follow(lng: number, lat: number): void
```

位置を含むタイルから `radius` 以内のタイルを近い順に読み込んだ状態に保ち、範囲外になったタイルを破棄します。位置が同じタイル内にとどまる間は何もしないため、毎 `postUpdate` で呼び出しても軽量です。サーバーが 404 を返すタイルには灯りを置きません。`start()` が返す Promise が解決した**後に**呼び出す必要があります。それ以外の場合はエラーをスローします。

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

プラグインが追加したすべてのソース・レイヤー・メッシュを路面も含めて破棄し、読み込み中のタイルを停止します。プラグインが生成した `TileJsonPlugin` も破棄します。その後プラグインは再利用できません。

## 型

### StreetLightsConfig

```typescript
type StreetLightsConfig = {
  tileJsonPlugin?: TileJsonPlugin;
};
```

コンストラクタのオプションです。[コンストラクタ](#コンストラクタ) を参照してください。

### StreetLightsStartOptions

```typescript
type StreetLightsStartOptions = {
  roads: StreetLightsRoads;
  buildings: StreetLightsBuildings;
  radius?: number;
  traffic?: StreetTrafficOptions;
  effectIds?: string[];
};
```

| プロパティ  | 型                      | デフォルト | 説明                                                                                                                |
| ----------- | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `roads`     | `StreetLightsRoads`     |            | 道路のソース、見た目、リーダー。[`StreetLightsRoads`](#streetlightsroads) を参照してください。                      |
| `buildings` | `StreetLightsBuildings` |            | 建物のソースとリーダー。[`StreetLightsBuildings`](#streetlightsbuildings) を参照してください。                      |
| `radius`    | `number`                | `2`        | 追従位置の周辺で読み込んだ状態に保つタイル数を、ズーム 14 のタイル単位の半径で指定します。`2` は 5 × 5 ブロックで、東京の緯度では差し渡し約 10 km です。 |
| `traffic`   | `StreetTrafficOptions`  | `{}`       | 車の速度倍率と灯りの大きさ。以前の `update()` で適用した値を置き換えます。[`StreetTrafficOptions`](#streettrafficoptions) を参照してください。 |
| `effectIds` | `string[]`              | `[]`       | 街灯と屋上灯が参加する Selective Effect（Bloom など）。                                                             |

### StreetLightsSource

```typescript
type StreetLightsSource = {
  sourceType: "tilejson" | "vector-tile";
  sourceUrl: string;
  sourceLayers: string[];
};
```

| プロパティ     | 型                             | デフォルト | 説明                                                                                                                           |
| -------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `sourceType`   | `"tilejson" \| "vector-tile"` |            | `tilejson` は `TileJsonPlugin.addSource()` と同じ TileJSON ドキュメントで、列挙された最初のタイル URL を読みます。`vector-tile` は `view.addSource()` と同じタイル URL です。 |
| `sourceUrl`    | `string`                       |            | TileJSON ドキュメント、または `{z}/{x}/{y}` のベクトルタイル URL。                                                             |
| `sourceLayers` | `string[]`                     |            | フィーチャーを持つソースレイヤー。`view.addLayer()` と同じです。                                                               |

### StreetLightsRoads

```typescript
type StreetLightsRoads = StreetLightsSource &
  RoadsReading & {
    polyline?: VectorLayer["polyline"];
  };
```

| プロパティ | 型                        | デフォルト | 説明                                                                                                        |
| ---------- | ------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `polyline` | `VectorLayer["polyline"]` | `{}`       | 路面のマテリアル。`view.addLayer()` の `polyline` と同じです。各フィーチャーの `show` と `width` はプラグインが設定します。 |

リーダーは [`RoadsReading`](#roadsreading) から来ます。

### RoadsReading

```typescript
type RoadsReading = {
  evaluateFeature: RoadReader;
  filterFeatureProperties?: string[];
};
```

| プロパティ                | 型           | デフォルト | 説明                                                                                                        |
| ------------------------- | ------------ | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `evaluateFeature`         | `RoadReader` |            | 道路フィーチャーを 1 つ読み取り、[`RoadClass`](#roadclass) と向きを返します。[`RoadReader`](#roadreader) を参照してください。 |
| `filterFeatureProperties` | `string[]`   | すべて     | `evaluateFeature` が必要とするプロパティ。路面でも街灯・車の配置でもこれらだけが渡されるので、読む名前をすべて指定してください。省略するとすべてのプロパティが渡され、路面は評価のたびに全プロパティを読みます。 |

### StreetLightsBuildings

```typescript
type StreetLightsBuildings = StreetLightsSource & {
  evaluateFeature: BuildingReader;
};
```

`evaluateFeature` は建物フィーチャーを 1 つ読み取り、屋上の高さを返します。灯りを置かない建物では `undefined` を返します。[`BuildingReader`](#buildingreader) を参照してください。

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

// `start()` には `roads: { ..., filterFeatureProperties: ["highway"], evaluateFeature: read }` として渡します。
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
- **出典はソースから表示されます。** `tilejson` ソースは、道路でも建物でも、ドキュメントが宣言するアトリビューションを表示します。`vector-tile` ソースでは、データの出典を自分で `view.attribution` に追加してください。
- **毎フレーム描画してください。** 車はビューの時計で動くため、`animation: true` でビューを構築してください。
- **ズーム 14 のみです。** プラグインはカメラのズームに関係なくズーム 14 のタイルを読むため、`radius` はそのタイル単位です。東京の緯度では 1 タイルが差し渡し約 2 km です。

## 関連リソース

- [About](../about/): three_plugins の概要
- [TileJsonPlugin](../tilejsonplugin/): `tilejson` ソースを解決するプラグイン
- [Vector Layer](../../three/layer/vector-layer/): 路面・街灯・屋上灯の背後にあるレイヤー種別
- [SelectiveBloomEffectDesc](../../three_default_descs/effect-desc/selective-bloom-effect-desc/): 街灯と屋上灯が参加する Bloom
- [Night City](https://navara.world/examples/showcase/night-city): このプラグインで構築したショーケース
