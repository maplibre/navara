---
title: navara_three_api
description: navara_three API reference for Three.js integration utilities
sidebar:
  order: 900
---

navara_three_api は、Three.js と Navara エンジンを統合するためのユーティリティ関数を提供する API です。地理空間計算、座標変換、交差判定、RTE（Relative to Eye）レンダリングなど、3D 地理空間アプリケーション開発に必要な機能を Three.js の型システムと統合して提供します。

## 初期化

### initNavaraApi()

Navara API を初期化します。他の API 関数を使用する前に、必ずこの関数を呼び出してください。

**Syntax:**

```typescript
async function initNavaraApi(): Promise<void>;
```

:::note
`navara_three` を使用する場合は、この関数を呼び出す必要はありません。
:::

**Returns:**

初期化完了時に解決される Promise

**Example:**

```typescript
import { initNavaraApi } from "@navaramap/three-api";

// アプリケーション起動時に初期化
await initNavaraApi();
```

## Ellipsoid Functions

WGS84 楕円体の基本パラメータを取得する関数群です。

### getWGS84SemiMajorAxis()

WGS84 楕円体の長半径を取得します。

**Syntax:**

```typescript
function getWGS84SemiMajorAxis(): number;
```

**Returns:**

WGS84 楕円体の長半径（メートル）

**Example:**

```typescript
const semiMajorAxis = getWGS84SemiMajorAxis();
console.log(`長半径: ${semiMajorAxis} m`); // 長半径: 6378137 m
```

### getWGS84SemiMinorAxis()

WGS84 楕円体の短半径を取得します。

**Syntax:**

```typescript
function getWGS84SemiMinorAxis(): number;
```

**Returns:**

WGS84 楕円体の短半径（メートル）

**Example:**

```typescript
const semiMinorAxis = getWGS84SemiMinorAxis();
console.log(`短半径: ${semiMinorAxis} m`); // 短半径: 6356752.314245 m
```

### getWGS84EccentricitySquared()

WGS84 楕円体の離心率の二乗を取得します。

**Syntax:**

```typescript
function getWGS84EccentricitySquared(): number;
```

**Returns:**

WGS84 楕円体の離心率の二乗

### getWGS84Flattening()

WGS84 楕円体の扁平率を取得します。

**Syntax:**

```typescript
function getWGS84Flattening(): number;
```

**Returns:**

WGS84 楕円体の扁平率

### getWGS84Eccentricity()

WGS84 楕円体の離心率を取得します。

**Syntax:**

```typescript
function getWGS84Eccentricity(): number;
```

**Returns:**

WGS84 楕円体の離心率

## Coordinate Transformation

座標系間の変換を行う関数群です。Three.js の Vector3 型と統合されています。

### geodeticToVector3(lle)

測地座標（緯度経度高度）を Three.js の Vector3（ECEF 座標系）に変換します。

**Syntax:**

```typescript
function geodeticToVector3(lle: LatLngHeight): Vector3;
```

**Parameters:**

- `lle`: 変換する測地座標
  - `lat`: 緯度（度）
  - `lng`: 経度（度）
  - `height`: 高度（メートル）

**Returns:**

ECEF 座標系での位置（Three.js Vector3）

**Example:**

```typescript
import { geodeticToVector3 } from "@navaramap/three-api";

const lle = {
  lat: 35.6762, // 東京の緯度
  lng: 139.6503, // 東京の経度
  height: 100,
};
const position = geodeticToVector3(lle);
console.log(`位置: [${position.x}, ${position.y}, ${position.z}]`);
```

### vector3ToGeodetic(xyz)

Three.js の Vector3（ECEF 座標系）を測地座標（緯度経度高度）に変換します。

**Syntax:**

```typescript
function vector3ToGeodetic(xyz: Vector3): LatLngHeight;
```

**Parameters:**

- `xyz`: 変換する ECEF 座標（Three.js Vector3）

**Returns:**

測地座標:
- `lat`: 緯度（度）
- `lng`: 経度（度）
- `height`: 高度（メートル）

**Example:**

```typescript
import { vector3ToGeodetic } from "@navaramap/three-api";
import { Vector3 } from "three";

const position = new Vector3(-3946416, 3364068, 3702654);
const lle = vector3ToGeodetic(position);
console.log(`緯度: ${lle.lat}°`);
console.log(`経度: ${lle.lng}°`);
console.log(`高度: ${lle.height} m`);
```

### degreeToRadian(degree)

角度を度からラジアンに変換します。Navara の API における緯度経度はすでに度単位のため、このヘルパーは Three.js の Euler `rotation` フィールドなどラジアンを取る計算にのみ必要です。

**Syntax:**

```typescript
function degreeToRadian(degree: number): number;
```

**Parameters:**

- `degree`: 度単位の角度

**Returns:**

ラジアン単位の角度

**Example:**

```typescript
const radians = degreeToRadian(90);
console.log(`90度 = ${radians} ラジアン`); // 90度 = 1.5708 ラジアン
```

### radianToDegree(radian)

角度をラジアンから度に変換します。

**Syntax:**

```typescript
function radianToDegree(radian: number): number;
```

**Parameters:**

- `radian`: ラジアン単位の角度

**Returns:**

度単位の角度

**Example:**

```typescript
const degrees = radianToDegree(Math.PI);
console.log(`π ラジアン = ${degrees}度`); // π ラジアン = 180度
```

## Screen-World Projection

スクリーン座標と世界座標間の変換を行う関数群です。Three.js の PerspectiveCamera と統合されています。

### convertScreenToWorld(window, camera, vec2)

スクリーン座標を世界座標に変換します。

**Syntax:**

```typescript
function convertScreenToWorld(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  vec2: Vector2
): Vector3 | undefined;
```

**Parameters:**

- `windowObject`: ウィンドウ情報
  - `width`: ウィンドウの幅
  - `height`: ウィンドウの高さ
  - `pixelRatio`: デバイスのピクセル比
- `camera`: Three.js の PerspectiveCamera
- `vec2`: スクリーン座標（Three.js Vector2）

**Returns:**

世界座標での位置、または交差しない場合は undefined

**Example:**

```typescript
import { convertScreenToWorld } from "@navaramap/three-api";
import { Vector2 } from "three";

// ウィンドウ情報オブジェクトを作成
const windowObject = {
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  pixelRatio: window.devicePixelRatio
};

const screenPos = new Vector2(event.clientX, event.clientY);

const worldPos = convertScreenToWorld(windowObject, camera, screenPos);
if (worldPos) {
  console.log(`世界座標: [${worldPos.x}, ${worldPos.y}, ${worldPos.z}]`);
}
```

### convertWorldToScreen(window, camera, worldPos)

世界座標をスクリーン座標に変換します。

**Syntax:**

```typescript
function convertWorldToScreen(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  worldPos: Vector3
): Vector2 | undefined;
```

**Parameters:**

- `windowObject`: ウィンドウ情報
- `camera`: Three.js の PerspectiveCamera
- `worldPos`: 世界座標での位置（Three.js Vector3）

**Returns:**

スクリーン座標、または視野外の場合は undefined

**Example:**

```typescript
import { convertWorldToScreen, geodeticToVector3 } from "@navaramap/three-api";

const lle = { lat: 35.6812, lng: 139.7671, height: 100 };
const worldPos = geodeticToVector3(lle);

const screenPos = convertWorldToScreen(window, camera, worldPos);
if (screenPos) {
  console.log(`スクリーン座標: [${screenPos.x}, ${screenPos.y}]`);
}
```

## Intersection and Ray Casting

交差判定とレイキャスティングを行う関数群です。

### getPlaneFromPointNormal(point, normal)

点と法線ベクトルから平面を作成します。

**Syntax:**

```typescript
function getPlaneFromPointNormal(point: Vector3, normal: Vector3): Plane;
```

**Parameters:**

- `point`: 平面上の点（Three.js Vector3）
- `normal`: 平面の法線ベクトル（Three.js Vector3）

**Returns:**

作成された平面

**Example:**

```typescript
import { getPlaneFromPointNormal } from "@navaramap/three-api";
import { Vector3 } from "three";

const point = new Vector3(0, 0, 0);
const normal = new Vector3(0, 0, 1); // Z軸方向
const plane = getPlaneFromPointNormal(point, normal);
```

### getPickRay(window, camera, vec2)

スクリーン座標からピッキング用のレイを生成します。

**Syntax:**

```typescript
function getPickRay(
  windowObject: WindowObject,
  camera: PerspectiveCamera,
  vec2: Vector2
): Ray;
```

**Parameters:**

- `windowObject`: ウィンドウ情報
- `camera`: Three.js の PerspectiveCamera
- `vec2`: スクリーン座標（Three.js Vector2）

**Returns:**

生成されたレイ

**Example:**

```typescript
import { getPickRay } from "@navaramap/three-api";
import { Vector2 } from "three";

const screenPos = new Vector2(event.clientX, event.clientY);
const ray = getPickRay(window, camera, screenPos);
```

### getRayPlaneIntersection(ray, plane)

レイと平面の交点を計算します。

**Syntax:**

```typescript
function getRayPlaneIntersection(ray: Ray, plane: Plane): Vector3 | undefined;
```

**Parameters:**

- `ray`: 交差判定を行うレイ
- `plane`: 交差判定を行う平面

**Returns:**

交点の座標（Three.js Vector3）、または交差しない場合は undefined

**Example:**

```typescript
import {
  getPickRay,
  getPlaneFromPointNormal,
  getRayPlaneIntersection,
} from "@navaramap/three-api";
import { Vector2, Vector3 } from "three";

// マウス位置からレイを生成
const screenPos = new Vector2(event.clientX, event.clientY);
const ray = getPickRay(window, camera, screenPos);

// 地面平面を定義
const groundPlane = getPlaneFromPointNormal(
  new Vector3(0, 0, 0),
  new Vector3(0, 0, 1)
);

// 交点を計算
const intersection = getRayPlaneIntersection(ray, groundPlane);
if (intersection) {
  console.log(
    `クリック位置: [${intersection.x}, ${intersection.y}, ${intersection.z}]`
  );
}
```

### getHeightFromEllipsoid(point)

指定した点の楕円体からの高度を取得します。

**Syntax:**

```typescript
function getHeightFromEllipsoid(point: Vector3): number;
```

**Parameters:**

- `point`: 高度を計算する点の ECEF 座標（Three.js Vector3）

**Returns:**

楕円体からの高度（メートル）

**Example:**

```typescript
import { getHeightFromEllipsoid } from "@navaramap/three-api";
import { Vector3 } from "three";

const position = new Vector3(-3946416, 3364068, 3702654);
const height = getHeightFromEllipsoid(position);
console.log(`高度: ${height} m`);
```

## Surface Normal and Reference Frames

地表面の法線ベクトルと参照フレームを計算する関数群です。

### geodeticSurfaceNormal(lle)

測地座標での地表面法線ベクトルを計算します。

**Syntax:**

```typescript
function geodeticSurfaceNormal(lle: LatLngHeight): Vector3;
```

**Parameters:**

- `lle`: 測地座標

**Returns:**

正規化された地表面法線ベクトル（Three.js Vector3）

**Example:**

```typescript
import { geodeticSurfaceNormal } from "@navaramap/three-api";

const lle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};
const normal = geodeticSurfaceNormal(lle);
console.log(`法線ベクトル: [${normal.x}, ${normal.y}, ${normal.z}]`);
```

### scaleToGeodeticSurface(xyz)

直交座標の位置を、測地法線に沿って WGS84 楕円体表面へ投影します。

**Syntax:**

```typescript
function scaleToGeodeticSurface(xyz: Vector3): Vector3 | undefined;
```

**Parameters:**

- `xyz`: ECEF 座標（Three.js Vector3）

**Returns:**

ECEF 座標での表面位置（Three.js Vector3）。位置が楕円体の中心に近すぎて投影できない場合は `undefined`

**Example:**

```typescript
import { scaleToGeodeticSurface } from "@navaramap/three-api";

const surface = scaleToGeodeticSurface(camera.position);
if (surface) {
  console.log(`表面位置: [${surface.x}, ${surface.y}, ${surface.z}]`);
}
```

### eastNorthUpToFixedFrame(origin)

East-North-Up 座標系から固定フレームへの変換行列を取得します。

**Syntax:**

```typescript
function eastNorthUpToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: 原点の ECEF 座標（Three.js Vector3）

**Returns:**

4x4 変換行列（Three.js Matrix4）

**Example:**

```typescript
import {
  eastNorthUpToFixedFrame,
  geodeticToVector3,
} from "@navaramap/three-api";

const tokyoLle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};
const origin = geodeticToVector3(tokyoLle);
const matrix = eastNorthUpToFixedFrame(origin);

// オブジェクトに適用
mesh.matrix.copy(matrix);
mesh.matrixAutoUpdate = false;
```

### northEastDownToFixedFrame(origin)

North-East-Down 座標系から固定フレームへの変換行列を取得します。

**Syntax:**

```typescript
function northEastDownToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: 原点の ECEF 座標（Three.js Vector3）

**Returns:**

4x4 変換行列（Three.js Matrix4）

### northUpEastToFixedFrame(origin)

North-Up-East 座標系から固定フレームへの変換行列を取得します。

**Syntax:**

```typescript
function northUpEastToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: 原点の ECEF 座標（Three.js Vector3）

**Returns:**

4x4 変換行列（Three.js Matrix4）

### northWestUpToFixedFrame(origin)

North-West-Up 座標系から固定フレームへの変換行列を取得します。

**Syntax:**

```typescript
function northWestUpToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: 原点の ECEF 座標（Three.js Vector3）

**Returns:**

4x4 変換行列（Three.js Matrix4）

### westUpNorthToFixedFrame(origin)

West-Up-North 座標系から固定フレームへの変換行列を取得します。

WUN は `+Z` 軸が北を指す唯一の右手系 Y-up 接線フレームであり、glTF 自身の規約（前方 `+Z`、上方 `+Y`、右方 `-X`）と3軸すべてで一致します。加工されていない glTF アセットをこのフレームに配置する場合、`Rx(+90°)` の軸補正は**不要**です。その補正は、オブジェクトごとに適用するのではなく、ここで一度だけフレームの定義自体に吸収されています。[軸の向きの規約](../../../three_default_descs/mesh-desc/mesh-desc-base/#軸の向きの規約gltf-の-y-up-とタイルの-z-up) を参照してください。

**Syntax:**

```typescript
function westUpNorthToFixedFrame(origin: Vector3): Matrix4;
```

**Parameters:**

- `origin`: 原点の ECEF 座標（Three.js Vector3）

**Returns:**

WUN から ECEF への 4x4 変換行列（Three.js Matrix4）

**Example:**

```typescript
import {
  westUpNorthToFixedFrame,
  geodeticToVector3,
} from "@navaramap/three-api";

const origin = geodeticToVector3({
  lat: 35.681236,
  lng: 139.767125,
  height: 0,
});
const matrix = westUpNorthToFixedFrame(origin);
```

### headingPitchRollToFixedFrame(placement)

地理的な位置に WUN 接線フレームを構築し、そこに heading・pitch・roll・scale を合成します。地理的な配置をワールド行列に変換する単一の呼び出しです。

`lng`/`lat` とここでのすべての角度は度単位です。これは [geodeticToVector3(lle)](#geodetictovector3lle) や `setCamera`、`geodetic` メッシュ Descriptor フィールドと同じ規約です。

**Syntax:**

```typescript
function headingPitchRollToFixedFrame(
  placement: Omit<GeodeticPlacement, "heightReference">
): Matrix4;
```

**Parameters:**

- `placement`: 度とメートルで指定する地理的配置
  - `lng`: 経度（度、必須）
  - `lat`: 緯度（度、必須）
  - `height`: 楕円体からの高さ（メートル、デフォルト `0`）
  - `heading`: アセットの前方（glTF の `+Z`）が向く、北からの時計回りの角度（度、デフォルト `0`）
  - `pitch`: ノーズアップを正とする角度（度、デフォルト `0`）
  - `roll`: 右翼下げを正とする角度（度、デフォルト `0`）
  - `scale`: フレームの一様または軸ごとのスケール（デフォルト `1`）

`heightReference` は、この型では意図的に受け付けていません。地形相対の高さの解決には view からのサンプリングが必要なため、これはメッシュ Descriptor の `geodetic` フィールドの役割です。

**Returns:**

配置されたローカルフレームから ECEF への 4x4 変換行列（Three.js Matrix4）

**Example:**

```typescript
import { headingPitchRollToFixedFrame } from "@navaramap/three-api";

const matrix = headingPitchRollToFixedFrame({
  lng: 138.036142,
  lat: 36.085621,
  height: 1,
  heading: 321,
});
```

`heading` はアセットの前方が向くコンパス方位で、前方とは glTF 自身の `+Z` です（`setCamera` と同じ規約です）。他の地球エンジンではアセットの前方として扱う軸が異なるため、他エンジンから移植したモデルでは heading に 90° の倍数を加える必要がある場合があります。

## RTE (Relative to Eye) Rendering

大規模な座標系で高精度レンダリングを実現するための RTE レンダリング機能です。

### encodePositionRTE(original, resultHigh?, resultLow?)

位置を RTE レンダリング用の高精度・低精度 Vector3 コンポーネントにエンコードします。位置を2つの float コンポーネントに分割することで、GPU 倍精度エミュレーションを実現します。

**Syntax:**

```typescript
function encodePositionRTE(
  original: Vector3,
  resultHigh?: Vector3,
  resultLow?: Vector3,
): { high: Vector3; low: Vector3 }
```

**Parameters:**

- `original`: エンコードする位置
- `resultHigh`: 高精度コンポーネントを格納するオプションの Vector3（GC 回避のため再利用可能）
- `resultLow`: 低精度コンポーネントを格納するオプションの Vector3（GC 回避のため再利用可能）

**Returns:**

`high` と `low` の Vector3 コンポーネントを持つオブジェクト

**Example:**

```typescript
import { encodePositionRTE } from "@navaramap/three-api";
import { Vector3 } from "three";

const position = new Vector3(6378137, 0, 0);
const { high, low } = encodePositionRTE(position);
// high + low ≈ 元の位置（GPU 精度が向上）
```

### calcModelMatrixRTE(objectMatrixWorld, matrixWorldInverse, result?)

RTE レンダリング用のモデル行列を計算します。平行移動成分をゼロにした行列を返します。

**Syntax:**

```typescript
function calcModelMatrixRTE(
  objectMatrixWorld: Matrix4,
  matrixWorldInverse: Matrix4,
  result?: Matrix4
): Matrix4;
```

**Parameters:**

- `objectMatrixWorld`: オブジェクトのワールド行列（Three.js Matrix4）
- `matrixWorldInverse`: カメラのワールド逆行列（Three.js Matrix4）
- `result`: 結果を格納する行列（省略時は新規作成）

**Returns:**

RTE 用のモデル行列（Three.js Matrix4）

**Example:**

```typescript
import { calcModelMatrixRTE } from "@navaramap/three-api";
import { Matrix4 } from "three";

const rteMatrix = calcModelMatrixRTE(
  mesh.matrixWorld,
  camera.matrixWorldInverse
);

// シェーダーで使用
material.uniforms.modelMatrix.value = rteMatrix;
```

### calcCameraPosition(cameraPosition, modelMatrixWorld)

RTE レンダリング用のカメラ位置をエンコードします。高精度な位置情報を high と low の 2 つの Vector3 に分割します。

**Syntax:**

```typescript
function calcCameraPosition(
  cameraPosition: Vector3,
  modelMatrixWorld: Matrix4
): {
  high: Vector3;
  low: Vector3;
};
```

**Parameters:**

- `cameraPosition`: カメラの位置（Three.js Vector3）
- `modelMatrixWorld`: モデルのワールド行列（Three.js Matrix4）

**Returns:**

エンコードされたカメラ位置:
- `high`: 上位ビット（高精度成分）
- `low`: 下位ビット（低精度成分）

```typescript
type EncodedPosition = {
  high: Vector3;
  low: Vector3;
};
```

**Example:**

```typescript
import { calcCameraPosition } from "@navaramap/three-api";

const encodedCameraPos = calcCameraPosition(camera.position, mesh.matrixWorld);

// シェーダーで使用
material.uniforms.cameraPositionHigh.value = encodedCameraPos.high;
material.uniforms.cameraPositionLow.value = encodedCameraPos.low;
```

### composeWorldMatrixForRTE(frameMatrix, localMatrix)

フレーム行列とローカル変換を合成し、結果を RTE レンダリング用の平行移動 Vector3 と回転・スケールのみの Matrix4 に分割します。平行移動は GPU 精度のために high/low の RTE uniform としてエンコードされ、回転・スケール行列はメッシュの matrixWorld に設定されてシェーダーの modelMatrix uniform となります。

**Syntax:**

```typescript
function composeWorldMatrixForRTE(
  frameMatrix: Matrix4,
  localMatrix: Matrix4,
  resultPosition?: Vector3,
  resultRotationScale?: Matrix4
): {
  position: Vector3;
  rotationScale: Matrix4;
};
```

**Parameters:**

- `frameMatrix`: フレーム変換行列（例: NUE-to-ECEF）（Three.js Matrix4）
- `localMatrix`: フレーム内で合成するローカル T\*R\*S 変換（Three.js Matrix4）
- `resultPosition`（省略可）: 抽出された平行移動を格納する Vector3（GC 回避のため再利用可能）
- `resultRotationScale`（省略可）: 平行移動をゼロにした行列を格納する Matrix4（GC 回避のため再利用可能）

**Returns:**

RTE レンダリング用に分解された結果:
- `position`: 合成行列から抽出されたワールド位置
- `rotationScale`: 平行移動がゼロにされた合成行列

```typescript
type ComposeWorldMatrixForRTEResult = {
  position: Vector3;
  rotationScale: Matrix4;
};
```

**Example:**

```typescript
import { composeWorldMatrixForRTE, encodePositionRTE } from "@navaramap/three-api";

// NUE-to-ECEF フレームとローカルオフセットを合成し、RTE 用に分割
const { position, rotationScale } = composeWorldMatrixForRTE(
  nueToEcefMatrix,
  localTransformMatrix,
);

// ワールド位置を high/low uniform としてエンコード
const posHigh = new Vector3();
const posLow = new Vector3();
encodePositionRTE(position, posHigh, posLow);

// 回転・スケールをメッシュに適用（平行移動は RTE uniform で処理）
mesh.matrixAutoUpdate = false;
mesh.matrixWorldAutoUpdate = false;
mesh.matrixWorld.copy(rotationScale);
```

## EllipsoidGeodesic

楕円体表面上の測地線計算を行うクラスです。2 点間の測地線距離、方位角、補間点の計算などを提供します。インスタンス生成時に共通変数を事前計算することで、最適化されたパフォーマンスを実現します。

### constructor(start, end)

楕円体上の 2 点間の測地線を作成します。

**Syntax:**

```typescript
constructor(start: LatLngHeight, end: LatLngHeight)
```

**Parameters:**

- `start`: 開始点の測地座標（緯度経度は度単位）
- `end`: 終了点の測地座標（緯度経度は度単位）

**Example:**

```typescript
import { EllipsoidGeodesic } from "@navaramap/three-api";

const start = {
  lat: 35.6762, // 東京
  lng: 139.6503,
  height: 0,
};
const end = {
  lat: 34.6937, // 大阪
  lng: 135.5023,
  height: 0,
};

const geodesic = new EllipsoidGeodesic(start, end);
```

### distance

開始点と終了点間の測地線距離（メートル）を取得します。

**Syntax:**

```typescript
get distance(): number
```

**Returns:**

測地線距離（メートル）

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);
console.log(`距離: ${geodesic.distance} m`); // 距離: 401747.8... m
```

### converged

測地線計算が収束したかどうかを取得します。開始点と終了点がほぼ対蹠点（地球の反対側）にある場合は最短経路を確実に求められないため `false` を返します。この場合 `distance` はおおよその推定値であり、補間メソッドは信頼できない経路をたどる代わりに端点にスナップします。

**Syntax:**

```typescript
get converged(): boolean
```

**Returns:**

計算が収束した場合は `true`、ほぼ対蹠点の場合は `false`

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

if (!geodesic.converged) {
  console.warn("ほぼ対蹠点のため距離は概算値です");
}
```

### startHeading

開始点での方位角（度）を取得します。

**Syntax:**

```typescript
get startHeading(): number
```

**Returns:**

開始点での方位角（度）

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);
console.log(`開始点方位角: ${geodesic.startHeading}°`);
```

### endHeading

終了点での方位角（度）を取得します。

**Syntax:**

```typescript
get endHeading(): number
```

**Returns:**

終了点での方位角（度）

### start

開始点の測地座標を取得します。

**Syntax:**

```typescript
get start(): LatLngHeight
```

**Returns:**

開始点の測地座標

### end

終了点の測地座標を取得します。

**Syntax:**

```typescript
get end(): LatLngHeight
```

**Returns:**

終了点の測地座標

### interpolatePoints(granularity?)

測地線パスに沿って補間点を生成します。

**Syntax:**

```typescript
interpolatePoints(granularity?: number): LatLngHeight[]
```

**Parameters:**

- `granularity`: 補間点間の距離（メートル）。省略時は WASM 側のデフォルト値が使用されます（測地線を適切に表現する粒度）

**Returns:**

補間された測地座標の配列。`converged` が `false` の場合は開始点と終了点のみを返します

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

// 1000m間隔で補間点を生成
const points = geodesic.interpolatePoints(1000);
console.log(`補間点数: ${points.length}`);

points.forEach((point, index) => {
  console.log(`点${index}: 緯度=${point.lat}°, 経度=${point.lng}°`);
});
```

### interpolateDistance(distance)

測地線パス上の指定距離の位置にある点を取得します。

**Syntax:**

```typescript
interpolateDistance(distance: number): LatLngHeight
```

**Parameters:**

- `distance`: 開始点からの距離（メートル）

**Returns:**

指定距離の位置の測地座標。`converged` が `false` の場合は近い方の端点を返します

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

// 中間点を取得
const midpoint = geodesic.interpolateDistance(geodesic.distance / 2);
console.log(`中間点: 緯度=${midpoint.lat}°, 経度=${midpoint.lng}°`);
```

### dispose()

WASM メモリを解放します。測地線オブジェクトが不要になったら呼び出してください。

**Syntax:**

```typescript
dispose(): void
```

**Example:**

```typescript
const geodesic = new EllipsoidGeodesic(start, end);

// 測地線計算を実行
const distance = geodesic.distance;
const points = geodesic.interpolatePoints(1000);

// 使用完了後にメモリを解放
geodesic.dispose();
```

### 完全な使用例

```typescript
import {
  initNavaraApi,
  EllipsoidGeodesic,
  geodeticToVector3,
} from "@navaramap/three-api";

await initNavaraApi();

// 東京から大阪への測地線を作成
const tokyo = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};
const osaka = {
  lat: 34.6937,
  lng: 135.5023,
  height: 0,
};

const geodesic = new EllipsoidGeodesic(tokyo, osaka);

// 距離と方位角を表示
console.log(`距離: ${(geodesic.distance / 1000).toFixed(2)} km`);
console.log(`開始方位角: ${geodesic.startHeading.toFixed(2)}°`);
console.log(`終了方位角: ${geodesic.endHeading.toFixed(2)}°`);

// 10km間隔で補間点を生成し、3D座標に変換
const points = geodesic.interpolatePoints(10000);
const positions = points.map((point) => geodeticToVector3(point));

// Three.js でラインを描画
const lineGeometry = new BufferGeometry().setFromPoints(positions);
const lineMaterial = new LineBasicMaterial({ color: "#ff0000" });
const line = new Line(lineGeometry, lineMaterial);
scene.add(line);

// メモリを解放
geodesic.dispose();
```

## Types

### LatLngHeight

測地座標を表すインターフェースです。

```typescript
interface LatLngHeight {
  lat: number; // 緯度（度）
  lng: number; // 経度（度）
  height: number; // 高度（メートル）
}
```

### LatLng

緯度経度を表すインターフェースです。

```typescript
interface LatLng {
  lat: number;  // 緯度（度）
  lng: number;  // 経度（度）
}
```

### WindowObject

ウィンドウ情報を表すインターフェースです。スクリーン座標変換関数に渡します。

```typescript
interface WindowObject {
  width: number; // ウィンドウの幅（ピクセル）
  height: number; // ウィンドウの高さ（ピクセル）
  pixelRatio: number; // デバイスピクセル比
}
```

## Usage Examples

### @navaramap/three から API を使用する場合

`@navaramap/three` を使用する場合は、`@navaramap/three-api` の API が `@navaramap/three` から再エクスポートされているため、そちらから直接 import することができます。

:::tip[推奨]
`@navaramap/three` を使用する場合は、`@navaramap/three` から API をインポートすることを推奨します。この場合、`initNavaraApi()` の呼び出しは不要です（`ThreeView.init()` が内部で初期化を行います）。
:::

`@navaramap/three` から API を使用して、地球上でモデルを動的に移動させる例です：

```typescript
import ThreeView, {
  geodeticToVector3,
  geodeticSurfaceNormal,
} from "@navaramap/three";
import { GLTFModelDesc } from "@navaramap/three-default-descs";
import { Vector3, Quaternion, Euler, Matrix4 } from "three";

const view = new ThreeView({ container });

view.registerMesh("gltfModel", GLTFModelDesc);
await view.init();

view.setCamera({
  lng: 139.6503,
  lat: 35.6762,
  height: 1000,
});

// 大阪の初期位置
let longitude = 135.5023;
const latitude = 34.6937;
const altitude = 0;

// GLTFモデルを追加
const modelDesc = view.addMesh<GLTFModelDesc>({
  gltfModel: { url: "/path/to/model.glb" },
  position: geodeticToVector3({
    lat: latitude,
    lng: longitude,
    height: altitude,
  }),
});

// アニメーションループ - 地球の周りをモデルを移動
const animate = () => {
  // 経度を更新（地球の周りを移動）
  longitude += 0.01;

  // 新しい位置を計算
  const pos = geodeticToVector3({
    lat: latitude,
    lng: longitude,
    height: altitude,
  });

  // 地表面の法線を計算
  const normal = geodeticSurfaceNormal({
    lat: latitude,
    lng: longitude,
    height: altitude,
  });

  // 移動方向を計算
  const nextLongitude = longitude + 0.01;
  const nextPos = geodeticToVector3({
    lat: latitude,
    lng: nextLongitude,
    height: altitude,
  });
  const direction = new Vector3().subVectors(nextPos, pos).normalize();

  // 回転を計算（法線を上方向として移動方向に向ける）
  const right = new Vector3().crossVectors(direction, normal).normalize();
  const up = new Vector3().crossVectors(right, direction).normalize();

  const rotationMatrix = new Matrix4();
  rotationMatrix.makeBasis(right, up, direction.clone().negate());

  const quaternion = new Quaternion();
  quaternion.setFromRotationMatrix(rotationMatrix);
  const euler = new Euler().setFromQuaternion(quaternion);

  // モデルの位置と回転を更新
  modelDesc.update({
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
  });

  requestAnimationFrame(animate);
};

animate();
```

### 基本的な座標変換

:::note
`@navaramap/three-api` を直接使用する場合は、使用前に `initNavaraApi()` を呼び出す必要があります。
`@navaramap/three` を使用する場合は、上記の「@navaramap/three から API を使用する場合」のセクションを参照してください。
:::

```typescript
import {
  initNavaraApi,
  geodeticToVector3,
  vector3ToGeodetic,
} from "@navaramap/three-api";

// 初期化
await initNavaraApi();

const tokyoLle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 100,
};

// 測地座標をECEF座標に変換
const ecefPos = geodeticToVector3(tokyoLle);
console.log(`ECEF座標: [${ecefPos.x}, ${ecefPos.y}, ${ecefPos.z}]`);

// ECEF座標を測地座標に戻す
const convertedLle = vector3ToGeodetic(ecefPos);
console.log(`緯度: ${convertedLle.lat}°`);
console.log(`経度: ${convertedLle.lng}°`);
console.log(`高度: ${convertedLle.height} m`);
```

### スクリーンピッキング

```typescript
import {
  getPickRay,
  getPlaneFromPointNormal,
  getRayPlaneIntersection,
  getHeightFromEllipsoid,
} from "@navaramap/three-api";
import { Vector2, Vector3 } from "three";

// マウスクリックイベントハンドラ
canvas.addEventListener("click", (event) => {
  const windowObject = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    pixelRatio: window.devicePixelRatio
  };

  // マウス位置
  const screenPos = new Vector2(event.clientX, event.clientY);

  // ピッキングレイを生成
  const ray = getPickRay(windowObject, camera, screenPos);

  // 地面平面（Z=0）を定義
  const groundPlane = getPlaneFromPointNormal(
    new Vector3(0, 0, 0),
    new Vector3(0, 0, 1)
  );

  // 交点を計算
  const intersection = getRayPlaneIntersection(ray, groundPlane);

  if (intersection) {
    console.log("クリックした地面の位置:", intersection);

    // 交点の高度を確認
    const height = getHeightFromEllipsoid(intersection);
    console.log("楕円体からの高度:", height);
  }
});
```

### ローカル座標系の設定

```typescript
import {
  geodeticToVector3,
  eastNorthUpToFixedFrame,
} from "@navaramap/three-api";
import { Mesh, BoxGeometry, MeshBasicMaterial } from "three";

// 東京の位置
const tokyoLle = {
  lat: 35.6762,
  lng: 139.6503,
  height: 0,
};

// ECEF座標を取得
const origin = geodeticToVector3(tokyoLle);

// East-North-Up座標系の変換行列を取得
const enuMatrix = eastNorthUpToFixedFrame(origin);

// メッシュを作成して配置
const geometry = new BoxGeometry(100, 100, 100);
const material = new MeshBasicMaterial({ color: "#ff0000" });
const mesh = new Mesh(geometry, material);

// ENU座標系の変換行列を適用
mesh.matrix.copy(enuMatrix);
mesh.matrixAutoUpdate = false;

scene.add(mesh);
```

### スクリーン座標と世界座標の相互変換

```typescript
import {
  convertScreenToWorld,
  convertWorldToScreen,
  geodeticToVector3,
} from "@navaramap/three-api";
import { Vector2 } from "three";

const windowObject = {
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  pixelRatio: window.devicePixelRatio
};

// 世界座標をスクリーン座標に変換
const worldPos = geodeticToVector3({
  lat: 35.6762,
  lng: 139.6503,
  height: 100,
});

const screenPos = convertWorldToScreen(windowObject, camera, worldPos);
if (screenPos) {
  console.log(`スクリーン座標: [${screenPos.x}, ${screenPos.y}]`);

  // HTMLエレメントを配置
  const label = document.getElementById("label");
  label.style.left = `${screenPos.x}px`;
  label.style.top = `${screenPos.y}px`;
}

// スクリーン座標を世界座標に変換
const mousePos = new Vector2(event.clientX, event.clientY);
const pickedWorldPos = convertScreenToWorld(windowObject, camera, mousePos);
if (pickedWorldPos) {
  console.log(
    `世界座標: [${pickedWorldPos.x}, ${pickedWorldPos.y}, ${pickedWorldPos.z}]`
  );
}
```
