---
title: ThreeView Functions
description: API Reference for ThreeView Class Functions
sidebar:
  order: 930
---

このページでは、ThreeView インスタンスで利用可能なすべての関数（メソッド）を説明します。

## Methods

### addLayer()

navara_three に新しいリソースレイヤーを追加します。このメソッドは、リソースレイヤー（vector、raster、terrain、3d-tiles）をサポートします。各リソースレイヤーは、`source` プロパティを介して [source](../../../three/source/about/) を参照します。メッシュには `addMesh()`、ライトには `addLight()`、エフェクトには `addEffect()` を使用してください。

**Syntax:**

```tsx
addLayer(l: LayerDescription): Layer
```

**Parameters:**

LayerDescription の設定項目については、[レイヤーの種類](../../../three/layer/about/) と各レイヤータイプのページを参照してください。

**Returns:**

```tsx
Layer;
```

リソースレイヤーの `Layer` インスタンスを返します。

**Example:**

```tsx
const source = view.addSource({
  type: "raster-tile",
  url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
  maxZoom: 23,
});

const layer = view.addLayer({
  type: "raster",
  source,
  raster: {
    color: new Color().setStyle("#cccccc"),
  },
});
```

### addSource()

データ[source](../../../three/source/about/)を登録し、`Source` ハンドルを返します。Source は、データがどこから来て、どのように取得／デコードされるかを記述します。レイヤーの `source` プロパティ（ハンドルまたはその `id`）を介して、リソースレイヤーから参照します。

**Syntax:**

```tsx
addSource(s: SourceDescription): Source
```

**Parameters:**

利用可能な Source のタイプとそのフィールドについては、[About Source](../../../three/source/about/) を参照してください。

**Returns:**

```tsx
Source;
```

`id`、`type`、`update(s)`、`delete()` を公開する `Source` ハンドル。

**Example:**

```tsx
const imagery = view.addSource({
  type: "raster-tile",
  url: "https://example.com/{z}/{x}/{y}.png",
  maxZoom: 19,
});

view.addLayer({ type: "raster", source: imagery });

// 後で
imagery.update({ type: "raster-tile", url: "https://example.com/new/{z}/{x}/{y}.png" });
imagery.delete();
```

### updateLayerById()

`addLayer()` で追加したリソースレイヤーの設定を ID で更新します。

**Syntax:**

```tsx
updateLayerById(id: string, l: LayerDescription): void
```

**Parameters:**

- `id`: 更新するレイヤーの一意識別子
- `l`: 更新したいプロパティを指定します

**Example:**

```tsx
const id = layer.id; // addLayer の戻り値からレイヤー ID を取得

// `source` はレイヤーが参照している raster-tile source です。
view.updateLayerById(id, {
  type: "raster",
  source,
  raster: {
    color: new Color().setStyle("#ffffff"),
  },
});
```

### updateMeshById()

メッシュディスクリプタの設定を ID で更新します。
`addMesh()` と同じディスクリプタ形式を受け付けます。

**Syntax:**

```tsx
updateMeshById(id: string, updates: OmitType<MeshConfig | D["mesh"]>): void
```

**Parameters:**

- `id`: 更新するメッシュの一意識別子
- `updates`: 更新するプロパティを含む設定オブジェクト（`addMesh()` と同じ形式）

**Example:**

```tsx
const handle = view.addMesh<BoxMeshDesc>({ box: { width: 100 } });

view.updateMeshById(handle.id, { box: { width: 200 } });
```

### updateLightById()

ライトディスクリプタの設定を ID で更新します。
`addLight()` と同じディスクリプタ形式を受け付けます。

**Syntax:**

```tsx
updateLightById(id: string, updates: OmitType<LightConfig | D["light"]>): void
```

**Parameters:**

- `id`: 更新するライトの一意識別子
- `updates`: 更新するプロパティを含む設定オブジェクト（`addLight()` と同じ形式）

**Example:**

```tsx
const handle = view.addLight<SunLightDesc>({ sun: { intensity: 1.0 } });

view.updateLightById(handle.id, { sun: { intensity: 0.5 } });
```

### updateEffectById()

エフェクトディスクリプタの設定を ID で更新します。
`addEffect()` と同じディスクリプタ形式を受け付けます。

**Syntax:**

```tsx
updateEffectById(id: string, updates: OmitType<BuiltInEffectDescription | EffectConfig | D["effect"]>): void
```

**Parameters:**

- `id`: 更新するエフェクトの一意識別子
- `updates`: 更新するプロパティを含む設定オブジェクト（`addEffect()` と同じ形式）

**Example:**

```tsx
const handle = view.addEffect<SSAOEffectDesc>({ ssao: { radius: 0.5 } });

view.updateEffectById(handle.id, { ssao: { radius: 1.0 } });
```

### deleteLayerById()

リソースレイヤーを ID で削除します。

**Syntax:**

```tsx
deleteLayerById(id: string): boolean
```

**Parameters:**

- `id`: 削除するレイヤーの一意識別子

**Returns:** レイヤーが見つかり削除された場合は `true`、それ以外は `false`。

**Example:**

```tsx
const id = layer.id;

view.deleteLayerById(id);
```

### deleteMeshById()

メッシュディスクリプタを ID で削除します。

**Syntax:**

```tsx
deleteMeshById(id: string): boolean
```

**Parameters:**

- `id`: 削除するメッシュの一意識別子

**Returns:** メッシュが見つかり削除された場合は `true`、それ以外は `false`。

**Example:**

```tsx
view.deleteMeshById(handle.id);
```

### deleteLightById()

ライトディスクリプタを ID で削除します。

**Syntax:**

```tsx
deleteLightById(id: string): boolean
```

**Parameters:**

- `id`: 削除するライトの一意識別子

**Returns:** ライトが見つかり削除された場合は `true`、それ以外は `false`。

**Example:**

```tsx
view.deleteLightById(handle.id);
```

### deleteEffectById()

エフェクトディスクリプタを ID で削除します。

**Syntax:**

```tsx
deleteEffectById(id: string): boolean
```

**Parameters:**

- `id`: 削除するエフェクトの一意識別子

**Returns:** エフェクトが見つかり削除された場合は `true`、それ以外は `false`。

**Example:**

```tsx
view.deleteEffectById(handle.id);
```

### init()

3D エンジン、WASM モジュールを初期化し、メインレンダリングループを開始します。ビューを使用する前に必ずこのメソッドを呼び出す必要があります。

**Syntax:**

```tsx
async init(): Promise<void>
```

**Returns:**

初期化が完了したときに解決される `Promise<void>`。

**Example:**

```tsx
const view = new ThreeView();
await view.init();

// init() 後にレイヤーを追加
const osm = view.addSource({
  type: "raster-tile",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxZoom: 19,
});

view.addLayer({ type: "raster", source: osm });
```

### dispose()

すべてのリソースを解放し、レンダリングループを停止します。ビューが不要になったときにこのメソッドを呼び出してください。

**Syntax:**

```tsx
dispose(): void
```

**Example:**

```tsx
// コンポーネントのアンマウント時にクリーンアップ
view.dispose();
```

### resize()

レンダラーのサイズを変更し、カメラのアスペクト比を更新します。`disableAutoResize` が `true` でない限り、ウィンドウリサイズ時に自動的に呼び出されます。

**Syntax:**

```tsx
resize(width?: number, height?: number, pixelRatio?: number): void
```

**Parameters:**

- `width`: 新しい幅（ピクセル）。省略時は canvas サイズを使用
- `height`: 新しい高さ（ピクセル）。省略時は canvas サイズを使用
- `pixelRatio`: デバイスピクセル比率

**Example:**

```tsx
// 明示的にサイズを指定してリサイズ
view.resize(1920, 1080, 2);

// 現在の canvas サイズでリサイズ（ピクセル比率のみ更新）
view.resize(undefined, undefined, window.devicePixelRatio);
```

### setCamera()

カメラの位置と向きを即座に設定します。アニメーションなしで直接カメラを移動します。

**Syntax:**

```tsx
setCamera(camPos: CameraPosition): void
```

**Parameters:**

- `camPos`: カメラ位置と向き

```tsx
type CameraPosition = {
  lng?: number;
  lat?: number;
  height?: number;
  pitch?: number;
  heading?: number;
  roll?: number;
  distance?: number;
};
```

| フィールド | 型 | 説明 |
|---|---|---|
| `lng` | `number` | 経度（度） |
| `lat` | `number` | 緯度（度） |
| `height` | `number` | 楕円体からの高さ（メートル）。`distance` も指定した場合は、カメラ自身の高度ではなく**ターゲット点の標高**として使用されます。カメラはその標高のターゲット点から `distance` メートル離れた位置に配置されます。 |
| `pitch` | `number` | ピッチ角（度） |
| `heading` | `number` | ヘディング角（度） |
| `roll` | `number` | ロール角（度） |
| `distance` | `number` | カメラの前方方向に沿ったターゲット地点からの距離（メートル）。指定した場合、カメラの前方レイが `lng`/`lat`/`height` のターゲット点をこの距離で通過するように配置されます。省略した場合は `height` がカメラ自身の高度（地表法線方向）として使用されます。 |

**Example:**

```tsx
// 高度指定：地表法線方向に 1000m 上空の東京にカメラを配置
view.setCamera({
  lng: 139.7671,
  lat: 35.6812,
  height: 1000,
  pitch: -45,
  heading: 0,
  roll: 0,
});

// 距離指定：富士山山頂（標高 3776m）を 5000m 離れた位置でフレーミング
view.setCamera({
  lng: 138.7274,
  lat: 35.3606,
  height: 3776,
  distance: 5000,
  pitch: -20,
  heading: 0,
});
```

### moveCamera()

指定された方向に、指定された量だけカメラを移動します。

**Syntax:**

```tsx
moveCamera(move: CameraDirection, amount: number): void
```

**Parameters:**

- `move`: カメラの移動方向
- `amount`: 動かす量（メートル）

`CameraDirection` は以下の値を持つ enum です：

```tsx
enum CameraDirection {
  Forward,
  Backward,
  Left,
  Right,
  Up,
  Down,
}
```

**Example:**

```tsx
import ThreeView, { CameraDirection } from "@navaramap/three";

view.moveCamera(CameraDirection.Forward, 100);
view.moveCamera(CameraDirection.Up, 50);
```

### moveCameraWithDirection()

カスタム方向ベクトルでカメラを移動します。

**Syntax:**

```tsx
moveCameraWithDirection(dir: number[], amount: number): void
```

**Parameters:**

- `dir`: [x, y, z] 方向ベクトル
- `amount`: 動かす量（メートル）

**Example:**

```tsx
view.moveCameraWithDirection([1, 0, 0], 100);
```

### flyTo()

カメラをターゲット位置にアニメーションで移動します。飛行アーク（弧）を描いて滑らかに移動します。経度は対蹠線（antimeridian）をまたぐ場合も短い方の経路を通り、高度は `maxHeight` を頂点とするアークを描きます。

返される Promise は、飛行が完了すると `true`、中断されると `false` で解決されます。中断は、新しい `flyTo()` での上書きや [`setCamera()`](#setcamera) の呼び出しなど、飛行以外のカメラ操作によって発生します。飛行中に新しい `flyTo()` を発行すると、進行中の飛行は中断され、現在のカメラ姿勢から新しい飛行が開始されます。

**Syntax:**

```tsx
flyTo(
  camPos: CameraPosition &
    Required<Pick<CameraPosition, "lng" | "lat">> &
    ({ height: number } | { distance: number }),
  options?: FlyToOptions
): Promise<boolean>

type FlyToOptions = {
  duration?: number;
  maxHeight?: number;
  easing?: FlyToEasing;
};

type FlyToEasing =
  | "linear"
  | "quadInOut"
  | "cubicInOut"
  | "cubicOut"
  | "quinticInOut";
```

**Parameters:**

- `camPos`: ターゲット位置。`lng` と `lat` が必須で、加えて `height` または `distance` のいずれかを指定します。
  - `lng`: 経度（度）— **必須**
  - `lat`: 緯度（度）— **必須**
  - `height`: 楕円体からの高さ（メートル）。`distance` も指定した場合は、カメラ自身の高度ではなく**ターゲット点の標高**として使用されます。
  - `pitch`: ピッチ角（度）
  - `heading`: ヘディング角（度）
  - `roll`: ロール角（度）
  - `distance`: カメラの前方方向に沿ったターゲット地点からの距離（メートル）。指定した場合、カメラの前方レイが `lng`/`lat`/`height` のターゲット点をこの距離で通過するように配置されます。省略した場合は `height` がカメラ自身の高度として使用されます。
- `options`: 飛行オプション。
  - `duration`: アニメーション時間（ミリ秒）。省略時は飛行距離から自動算出されます（2〜3 秒）。`0` を渡すと即座にジャンプします。
  - `maxHeight`: 飛行アーク中の最大高度（メートル）
  - `easing`: 飛行時間に適用するイージングのプリセット。省略時は `"quinticInOut"`、高度 11,500m 超からの下降時は `"cubicOut"` が使用されます。

**Returns:** `Promise<boolean>`。飛行が完了すると `true`、中断されると `false`。

**Example:**

```tsx
// 高度指定：東京へ 3 秒かけて飛行（最大高度 5000m）
const completed = await view.flyTo(
  {
    lng: 139.7671,
    lat: 35.6812,
    height: 1000,
    pitch: -45,
    heading: 0,
  },
  { duration: 3000, maxHeight: 5000 }
);
if (!completed) {
  // 別の flyTo や setCamera などによって中断された
}

// 距離指定：東京タワー（地上）へ 2000m の距離からアプローチ（イージング指定）
view.flyTo(
  {
    lng: 139.7454,
    lat: 35.6586,
    height: 0,
    distance: 2000,
    pitch: -30,
    heading: 45,
  },
  { duration: 4000, easing: "cubicInOut" }
);
```

### lookAt()

カメラをターゲット位置に向け、オフセット位置に配置します。オフセットは East-North-Up（ENU）座標系で指定します。

**Syntax:**

```tsx
lookAt(target: LatLngHeight, offset: Vector3): void
```

**Parameters:**

- `target`: ターゲットの測地位置
  - `lng`: 経度（度）
  - `lat`: 緯度（度）
  - `height`: 高度（メートル）
- `offset`: ターゲットからのオフセット（ENU 座標系、メートル）
  - `x`: 東方向
  - `y`: 北方向
  - `z`: 上方向

**Example:**

```tsx
import { Vector3 } from "three";

// 東京タワーを 1000m 上空から見下ろす
view.lookAt(
  { lng: 139.7454, lat: 35.6586, height: 0 },
  new Vector3(0, 0, 1000) // 真上 1000m
);

// 斜め後ろから見る
view.lookAt(
  { lng: 139.7454, lat: 35.6586, height: 0 },
  new Vector3(500, -500, 500) // 東に 500m、南に 500m、上に 500m
);
```

### cameraFollow()

カメラフォローモードを有効または無効にします。有効にすると、カメラは指定されたターゲット位置を中心に移動します。

**Syntax:**

```tsx
cameraFollow(enabled: boolean, target?: LatLngHeight, offset?: Vector3): void
```

**Parameters:**

- `enabled`: フォローモードを有効にするかどうか
- `target`: 中心とするターゲット位置
  - `lng`: 経度（度）
  - `lat`: 緯度（度）
  - `height`: 高度（メートル）
- `offset`: ターゲットからのオフセット（ENU 座標系、メートル）

**Example:**

```tsx
import { Vector3 } from "three";

view.cameraFollow(
  true,
  { lng: 139.7671, lat: 35.6812, height: 100 },
  new Vector3(0, -200, 100) // 南に 200m、上に 100m
);

// フォローモードを無効にする
view.cameraFollow(false);
```

### cameraFreeLook()

位置固定のフリールックモードを有効／無効にします。カメラはターゲット位置に固定されたまま、マウスドラッグで向きだけがその場で回転します。視点位置を動かしたくない一人称視点の「見回し」操作に有用です。

**Syntax:**

```tsx
cameraFreeLook(enabled: boolean, target?: LatLngHeight): void
```

**Parameters:**

- `enabled`: フリールックモードを有効にするかどうか
- `target`: カメラを固定するターゲット位置
  - `lng`: 経度（度）
  - `lat`: 緯度（度）
  - `height`: 高さ（メートル）

呼び出し間でターゲットが移動した場合（プレイヤーが歩くなど）、カメラも一緒に平行移動します。向きは保持されます。このモードではマウスホイールによるズームは無効です（カメラと注視点の距離がゼロのため）。

**Example:**

```tsx
// プレイヤーの目線位置にカメラをロックし、ドラッグで見回す
view.cameraFreeLook(true, { lng: 139.7671, lat: 35.6812, height: 105 });

// フリールックモードを無効にする
view.cameraFreeLook(false);
```

### sampleTerrainHeight()

指定した測地位置での地形の高さを同期的に取得します。地形データがまだ読み込まれていない場合は `undefined` を返します。[`exaggeration`](../../../three/material/terrain-material/#exaggeration) を設定している場合は、描画される地表に合わせて拡大後の高さを返します。

このメソッドはレンダリング用に常駐しているタイルしか読まないため、カメラが遠くにある間は粗い LOD タイルの高さ (真の地表高から数十メートルずれうる値) を返します。カメラの状態に関係なく正確な高さが必要な場合（例: オブジェクトの地表への設置）は、代わりに [`sampleTerrainMostDetailed()`](#sampleterrainmostdetailed) を使ってください。

**Syntax:**

```tsx
sampleTerrainHeight(pos: LatLng): number | undefined
```

**Parameters:**

- `pos`: 測地位置
  - `lat`: 緯度（度）
  - `lng`: 経度（度）

**Returns:**

地形の高さ（メートル）、または地形データが利用できない場合は `undefined`

**Example:**

```tsx
// 緯度・経度を度で指定
const lat = 35.6812;
const lng = 139.7671;

const height = view.sampleTerrainHeight({ lat, lng });

if (height !== undefined) {
  console.log(`地形の高さ: ${height}m`);
} else {
  console.log("地形データがまだ読み込まれていません");
}
```

### sampleTerrainMostDetailed()

地形ソースが提供する最も詳細なズームレベルで地形の高さを非同期にサンプリングします。必要なタイルはネットワークから取得されます。`sampleTerrainHeight()` はレンダリング用に常駐しているタイルしか読まないため、カメラが遠くにあると粗い高さ（または `undefined`）を返しますが、この API はカメラのストリーミング状態に関係なく正確な地表の高さを解決します。その場所へ移動する前にオブジェクトを地面に設置する用途に使ってください。`source` を描画している地形レイヤーが [`exaggeration`](../../../three/material/terrain-material/#exaggeration) を設定している場合は、描画される地表に合わせて拡大後の高さを返します。

位置はタイルごとにグループ化され、同じタイルは一度だけ取得されます。サンプリングはソースの `maxZoom` から始まり、404 の場合はデータが見つかるまで親タイルへフォールバックするので、実際のカバレッジが設定した `maxZoom` より浅いソースでも解決できます。`401`/`403` はトークンの問題が暗黙的に粗い高さとして返さないよう呼び出し全体を reject し、サーバーエラーはリトライ後、該当位置の `height` を `undefined` にします。

**Syntax:**

```tsx
sampleTerrainMostDetailed(
  source: SourceRef,
  positions: LatLng[],
  options?: SampleTerrainOptions,
): Promise<SampledTerrainPosition[]>
```

**Parameters:**

- `source`: 登録済みの `quantized-mesh` / `raster-dem` ソース。`addSource` が返す `Source` ハンドル、またはその id
- `positions`: サンプリングする測地位置の配列
  - `lat`: 緯度（度）
  - `lng`: 経度（度）
- `options.level`: ソースの `maxZoom` から探索する代わりに、この固定ズームレベルでサンプリングします。固定レベルでは親タイルへのフォールバックは行われません。
- `options.signal`: 取得中のタイルフェッチをキャンセルする `AbortSignal`。

**Returns:**

入力位置ごとに 1 件、同じ順序で結果を返す Promise。各結果は `lat`/`lng` をそのまま返し、`height`（メートル。タイルを取得・デコードできなかった場合は `undefined`）と `level`（実際にサンプリングしたズームレベル）を持ちます。

**Example:**

```tsx
const terrain = view.addSource({
  type: "quantized-mesh",
  url: "https://example.com/{z}/{x}/{y}.terrain",
  maxZoom: 15,
});
view.addLayer({ type: "terrain", source: terrain });

const lat = 35.6812;
const lng = 139.7671;

const [ground] = await view.sampleTerrainMostDetailed(terrain, [{ lat, lng }]);
if (ground.height !== undefined) {
  // カメラが遠くにあっても、モデルを地表にぴったり設置できる
  const surface = geodeticToVector3({ lat, lng, height: ground.height });
  view.addMesh({
    gltfModel: { url: "https://example.com/model.glb" },
    matrixWorld: northUpEastToFixedFrame(surface),
  });
}
```

### observeTerrainHeightAt()

特定の位置での地形高さの変更を監視します。コールバックは高さが最初にサンプリングされたときに呼ばれ、その位置の地形が読み込み済みなら登録直後に呼ばれます。その後は、位置を含む地形タイルが読み込まれたときや地形の誇張率が変わったときに、高さが変わればそのたびに呼ばれます。[`exaggeration`](../../../three/material/terrain-material/#exaggeration) を設定している場合は、描画される地表に合わせて拡大後の高さを返します。

**Syntax:**

```tsx
observeTerrainHeightAt(pos: LatLng, cb: (height: number) => void): () => void
```

**Parameters:**

- `pos`: 監視する位置
  - `lat`: 緯度（度）
  - `lng`: 経度（度）
- `cb`: 高さが更新されたときに呼び出されるコールバック

**Returns:**

監視を停止するためのクリーンアップ関数

**Example:**

```tsx
// 緯度・経度を度で指定
const lat = 35.6812;
const lng = 139.7671;

const cleanup = view.observeTerrainHeightAt({ lat, lng }, (height) => {
  console.log(`地形の高さが更新されました: ${height}m`);
});

// 後で監視を停止
cleanup();
```

### sampleTerrainHeightRange()

地理的な範囲内の地面の最低・最高の高さを同期的に取得します。`sampleTerrainHeight()` と同じくレンダリング用に読み込み済みの地形タイルだけを読み、地形タイルがまだ読み込まれていない範囲は `0` として扱います。地面を包み込む必要があるもの、たとえば地形の下から上まで届くボリュームの大きさを決めるときに使います。[`exaggeration`](../../../three/material/terrain-material/#exaggeration) を設定している場合は、まだ読み込まれていない範囲の `0` も含めて、描画される地表に合わせて拡大後の範囲を返します。

**Syntax:**

```tsx
sampleTerrainHeightRange(
  extent: GeographicExtent,
): { min: number; max: number } | undefined
```

**Parameters:**

- `extent`: 地理的な範囲
  - `west`: 西端の経度（度）
  - `south`: 南端の緯度（度）
  - `east`: 東端の経度（度）
  - `north`: 北端の緯度（度）

**Returns:**

最低・最高の高さ（メートル、楕円体基準）。エンジンが地形をまだセットアップしていない場合は `undefined`

**Example:**

```tsx
const range = view.sampleTerrainHeightRange({
  west: 138.7,
  south: 35.3,
  east: 138.8,
  north: 35.4,
});

if (range) {
  console.log(`地面の高さ: ${range.min}m から ${range.max}m`);
}
```

### observeTerrainHeightRange()

範囲内の [`sampleTerrainHeightRange()`](#sampleterrainheightrange) の結果を監視します。コールバックは範囲が最初に計算されたときに呼ばれ、その後は範囲に重なる地形タイルが読み込まれたときや地形の誇張率が変わったときに、値が変わればそのたびに呼ばれます。

**Syntax:**

```tsx
observeTerrainHeightRange(
  extent: GeographicExtent,
  cb: (range: { min: number; max: number }) => void,
): () => void
```

**Parameters:**

- `extent`: `sampleTerrainHeightRange()` と同じ、度単位の地理的な範囲。`west` は `east` 以下である必要があり、日付変更線をまたぐ範囲には対応していません。
- `cb`: 最低・最高の高さ（メートル、楕円体基準）を受け取るコールバック

**Returns:**

監視を停止するクリーンアップ関数

**Example:**

```tsx
const cleanup = view.observeTerrainHeightRange(
  { west: 138.7, south: 35.3, east: 138.8, north: 35.4 },
  ({ min, max }) => {
    console.log(`地面の高さ: ${min}m から ${max}m`);
  },
);

// 後で監視を停止
cleanup();
```

### rotateAroundAxis()

指定した軸を中心にカメラを回転させます。ゼロベクトルを指定するとデフォルトの軸が使用されます。

**Syntax:**

```tsx
rotateAroundAxis(axis: Vector3, angle: number): void
```

**Parameters:**

- `axis`: 回転軸
- `angle`: 回転角度（ラジアン）

**Example:**

```tsx
import { Vector3 } from "three";

// Y 軸を中心に 45 度回転
view.rotateAroundAxis(new Vector3(0, 1, 0), Math.PI / 4);
```

### rotateAround()

カメラを現在の注視点またはビューの中心を軸に回転させます。

**Syntax:**

```tsx
rotateAround(angle: number): void
```

**Parameters:**

- `angle`: 回転角度（ラジアン）

**Example:**

```tsx
// 45 度回転
view.rotateAround(Math.PI / 4);

// 自動回転アニメーション
const animate = () => {
  view.rotateAround(0.005);
  requestAnimationFrame(animate);
};
animate();
```

### forceUpdate()

次のフレームでシーンを強制的に再レンダリングします。`animation: false` の場合に手動で更新をトリガーするときに使用します。

**Syntax:**

```tsx
forceUpdate(): void
```

**Example:**

```tsx
view.forceUpdate();
```

### pickTerrainPosition()

スクリーン座標で地形位置をピックします。マウスイベントの `clientX`、`clientY` と同じ CSS ピクセル座標を使用します。

**Syntax:**

```tsx
pickTerrainPosition(x: number, y: number): Vector3 | null
```

**Parameters:**

- `x`: スクリーン X 座標（CSS ピクセル、`MouseEvent.clientX` と同じ）
- `y`: スクリーン Y 座標（CSS ピクセル、`MouseEvent.clientY` と同じ）

**Returns:**

ワールド位置（ECEF 座標）、または地形がヒットしない場合は `null`

**Example:**

```tsx
// クリック位置の地形座標を取得
view.on("click", (event) => {
  const position = view.pickTerrainPosition(event.clientX, event.clientY);
  if (position) {
    console.log(`ECEF 座標: ${position.x}, ${position.y}, ${position.z}`);
  } else {
    console.log("地形がヒットしませんでした");
  }
});
```

### pickDepthPosition()

スクリーン座標でシーン全体の深度バッファを使用してワールド位置をピックします。`pickTerrainPosition()` と異なり、このメソッドは地形だけでなく全てのレンダリングジオメトリ（メッシュなど）を含む深度テクスチャを読み取るため、地形の手前に他のオブジェクトがある場合でもヒットを返します。

**Syntax:**

```tsx
pickDepthPosition(x: number, y: number): Vector3 | null
```

**Parameters:**

- `x`: スクリーン X 座標（CSS ピクセル、`MouseEvent.clientX` と同じ）
- `y`: スクリーン Y 座標（CSS ピクセル、`MouseEvent.clientY` と同じ）

**Returns:**

ワールド位置（ECEF 座標）、または何もヒットしない場合は `null`

**Example:**

```tsx
view.on("click", (event) => {
  const position = view.pickDepthPosition(event.clientX, event.clientY);
  if (position) {
    console.log(`ECEF 座標: ${position.x}, ${position.y}, ${position.z}`);
  } else {
    console.log("何もヒットしませんでした");
  }
});
```

### registerMesh()

カスタムメッシュクラスを登録します。

**Syntax:**

```tsx
registerMesh(name: string, meshClass: MeshDescConstructor): void
```

**Parameters:**

- `name`: 登録するメッシュの名前
- `meshClass`: メッシュのコンストラクタ

**Example:**

```tsx
class CustomMeshDesc extends MeshDesc {
  onCreate() {
    // カスタム実装
  }
}

view.registerMesh("customMesh", CustomMeshDesc);
```

### registerLight()

カスタムライトクラスを登録します。

**Syntax:**

```tsx
registerLight(name: string, lightClass: LightDescConstructor): void
```

**Parameters:**

- `name`: 登録するライトの名前
- `lightClass`: ライトのコンストラクタ

**Example:**

```tsx
class CustomLightDesc extends LightDesc {
  onCreate() {
    // カスタム実装
  }
}

view.registerLight("customLight", CustomLightDesc);
```

### registerEffect()

カスタムエフェクトクラスを登録します。

**Syntax:**

```tsx
registerEffect(name: string, effectClass: EffectDescConstructor): void
```

**Parameters:**

- `name`: 登録するエフェクトの名前
- `effectClass`: エフェクトのコンストラクタ

**Example:**

```tsx
class CustomEffectDesc extends EffectDesc {
  onCreate() {
    // カスタム実装
  }
}

view.registerEffect("customEffect", CustomEffectDesc);
```

### addPlugin()

プラグインを登録します。`view.init()` の前に呼び出す必要があります。

**Syntax:**

```tsx
addPlugin(plugin: Plugin): this
```

**Parameters:**

- `plugin`: `Plugin` インスタンス

**Example:**

```typescript
const view = new ThreeView({});
view.addPlugin(pluginA).addPlugin(pluginB);
await view.init();
```

### addFontFamily()

複数のフェイスから構成されるフォントファミリを登録します。各フェイスは Unicode 範囲の集合をカバーし、個別のフォントファイル URL（ttf、otf、woff、woff2）を指します。ファミリを登録すると、テキストレイヤは [`material.font`](../../../three/material/text-material/#font) で `family` 名を指定してこのファミリを参照できます。ラベルの `text` に含まれる文字の Unicode 範囲をカバーするフェイスのみがダウンロードされます。

**フェイスの優先順位とフォールバック:**

- フェイスは `faces` 配列に並んだ順に評価されます。`text` 内の各コードポイントには、`unicodeRanges` にそのコードポイントを含む最初のフェイスが使用されます。したがって範囲が重複する場合は、先に定義されたエントリが優先されます。
- どのフェイスにもカバーされないコードポイントは、先頭のフェイス（`faces[0]`）にフォールバックします。このため、先頭のフェイスは、宣言された `unicodeRanges` に含まれない文字のためにもダウンロードされる可能性があります。

この挙動を予測しやすくするため、フォールバックとして使いたいフェイスをインデックス `0` に配置してください。残りのフェイスはその後に、範囲が重複した場合に優先度が高い順に並べてください。

`ThreeView` インスタンスを返すため、メソッドチェーンが可能です。

**Syntax:**

```tsx
addFontFamily(family: FontFamily): this
```

**Parameters:**

- `family`: `FontFamily` オブジェクト。
  - `family`: `material.font` からこのファミリを参照するために使う一意の名前。
  - `faces`: `FontFace` エントリの配列。各エントリは以下を持ちます:
    - `url`: フォントファイルの URL。
    - `unicodeRanges`: このフェイスがカバーするコードポイント範囲 `{ from, to }`（両端を含む）の配列。

**Example:**

```typescript
view.addFontFamily({
  family: "MapFont",
  faces: [
    {
      url: "/fonts/latin.woff2",
      unicodeRanges: [{ from: 0x0000, to: 0x024f }],
    },
    {
      url: "/fonts/cjk.woff2",
      unicodeRanges: [{ from: 0x4e00, to: 0x9fff }],
    },
  ],
});

const source = view.addSource({
  type: "geojson",
  url: "/cities.geojson",
});

const layer = view.addLayer({
  type: "vector",
  source,
  text: {
    font: "MapFont",
  },
});

layer.on("featureUpdated", ({ evaluator }) => {
  evaluator.evaluate(
    ({ properties }) => {
      const name = properties?.["name"] as string | undefined;
      return { text: name ?? "", show: !!name };
    },
    { filters: ["name"] },
  );
});
```

:::tip[推奨]
フェイスと Unicode 範囲を手書きする代わりに、スタイルシートの `@font-face` ルール（例: Google Fonts CSS API）から [`fetchFontFamilyFromCss()`](../../../three/api/font-family-from-css/) で導出できます:

```typescript
view.addFontFamily(
  await fetchFontFamilyFromCss(
    "MapFont",
    "https://fonts.googleapis.com/css2?family=Noto+Sans&family=Noto+Sans+JP",
  ),
);
```

:::

### removeFontFamily()

登録済みのフォントファミリを名前で削除します。削除後もこのファミリを参照しているテキストレイヤは、該当ファミリを解決できなくなります。

`ThreeView` インスタンスを返すため、メソッドチェーンが可能です。

**Syntax:**

```tsx
removeFontFamily(family: string): this
```

**Parameters:**

- `family`: `addFontFamily()` に渡した `family` 名。

**Example:**

```typescript
view.removeFontFamily("MapFont");
```

### setSseMultiplierRange()

メモリ圧 SSE デグレードの範囲を実行時に更新します。`min` はバジェット圧がなくても適用される安静時の乗数で（1 より大きい値は安静時でも遠くのタイルを粗くします）、`max` はメモリ圧下で動的デグレードが到達できる上限です。次のトラバーサルで新しい範囲によりタイル LOD が再選択されます。`min = max = 1` を設定すると圧によるデグレードが完全に無効化されます。

**Syntax:**

```tsx
setSseMultiplierRange(min: number, max: number): void
```

**Parameters:**

- `min`: バジェット圧なしで適用される安静時（ベース）の SSE 乗数
- `max`: 動的なメモリ圧デグレードが到達できる上限

**Example:**

```tsx
// 安静時も遠くのタイルをやや粗く保ち、圧下では最大 8 倍までデグレードを許容
view.setSseMultiplierRange(1.5, 8.0);

// メモリ圧デグレードを完全に無効化
view.setSseMultiplierRange(1, 1);
```

:::tip[関連ドキュメント]
デバイス依存のデフォルトは [`memoryBudget` オプション](../threeview-class#memorybudget)（`sseMultiplierMin` / `sseMultiplierMax`）で設定できます。
:::

### memoryStats()

エンジンのメモリ使用量のスナップショット（WASM バッファバイト数、GPU 推定値、保持中タイル数）を返します。`init()` 前は `undefined` を返します。

**Syntax:**

```tsx
memoryStats(): MemoryStats | undefined
```

**Returns:**

プレーンな `MemoryStats` オブジェクト。`init()` 前は `undefined`:

```tsx
type MemoryStats = {
  // WASM リニアメモリ内のタイルペイロード・ジオメトリ・DEM バッファの合計バイト数
  bufferTotalBytes: number;
  // JS 側バッファストアが保持するバイト数（フェッチした MVT pbf やワーカー生成
  // ジオメトリなど、WASM リニアメモリに入らないもの）。bufferTotalBytes には含まれません。
  externalBufferBytes: number;
  // バッファストアが追跡するバッファ数
  bufferCount: number;
  // 推定 GPU バイト数（テクスチャ、ジオメトリ、レンダーターゲット）
  gpuBytesEst: number;
  // バッファストア外の CPU バイト数（主にフィーチャ属性テーブル）
  externalCpuBytes: number;
  // 処理中フェッチの予約バイト数（フェッチ完了時に解放）
  reservedBytes: number;
  // 設定されたタイルキャッシュバジェット。バジェット管理が無効の場合は undefined
  budgetBytes: number | undefined;
  // 破棄されたタイルの累計数
  evictedCount: number;
  // 現在のメモリ圧 SSE 乗数（1 = 圧なし）
  sseMultiplier: number;
  // パイプラインごとの保持中（非アクティブ化されキャッシュ済み）タイル数
  retainedVector: number;
  retainedTerrain: number;
  retainedRaster: number;
  retainedTiles3d: number;
};
```

**Example:**

```tsx
const stats = view.memoryStats();
if (stats) {
  const MB = 1024 * 1024;
  console.log(`WASM buffers: ${(stats.bufferTotalBytes / MB).toFixed(1)} MB`);
  console.log(`GPU estimate: ${(stats.gpuBytesEst / MB).toFixed(1)} MB`);
  console.log(`evicted: ${stats.evictedCount}, sse x${stats.sseMultiplier}`);
}
```

### workerMemoryStats()

ワーカー側メモリのスナップショットを返します。タイルワーカーごとの WASM ヒープ（プールのタスク後プローブによるポイントインタイムのサンプル。このメソッド呼び出しでも新しいプローブが要求され、その結果は*次回*の呼び出しに反映されます）と、フォントワーカーのヒープ / キャッシュ内訳を含みます。`init()` 前は `undefined` を返します。

**Syntax:**

```tsx
async workerMemoryStats(): Promise<WorkerMemoryStats | undefined>
```

**Returns:**

`WorkerMemoryStats` オブジェクトに解決される `Promise`。`init()` 前は `undefined`:

```tsx
type WorkerMemoryStats = {
  // タイルワーカープールのヒープ（各スロットは初回プローブまで undefined）
  tileWorkers:
    | {
        // スロットごとの直近プローブ済み WASM ヒープ（undefined = 未プローブ）
        perSlot: (number | undefined)[];
        // プローブ済みヒープの合計
        totalBytes: number;
        // スロットのリサイクル基準となるワーカーごとのバジェット
        maxWorkerHeapBytes: number;
      }
    | undefined;
  // フォントワーカーのヒープ / キャッシュ内訳。フォント未使用の間は undefined
  fontWorker:
    | {
        // フォントワーカーの WASM リニアメモリ合計（縮小しません）
        heapBytes: number;
        fontCount: number;
        atlasCount: number;
        glyphCount: number;
        // キャッシュが保持する生のフォントファイルバイト数
        fontBytes: number;
        // モノクロ（SDF/MSDF）アトラスのピクセルバイト数
        atlasBytes: number;
        // COLRv1 カラーアトラスのピクセルバイト数
        colorAtlasBytes: number;
        // 設定されたキャッシュバジェット。無制限の場合は undefined
        budgetBytes?: number;
      }
    | undefined;
};
```

**Example:**

```tsx
const stats = await view.workerMemoryStats();
if (stats?.tileWorkers) {
  const MB = 1024 * 1024;
  console.log(`tile workers: ${(stats.tileWorkers.totalBytes / MB).toFixed(1)} MB`);
}
if (stats?.fontWorker) {
  console.log(`font atlas bytes: ${stats.fontWorker.atlasBytes}`);
}
```
