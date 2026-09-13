---
title: Custom Descriptor
description: カスタム Descriptor の実装について
sidebar:
  order: 1070
---

navara_three では、メッシュ・エフェクト・ライトの各 Descriptor を独自に実装できます。概念については [レイヤーと Descriptor](../../../three/introduction/about-layer/) を参照してください。

## Descriptor の基底クラス

Descriptor の種類に応じて、対応する基底クラスを継承して実装します。

| 種別                 | 基底クラス          | ファクトリメソッド                      | 登録メソッド            |
| -------------------- | ------------------- | --------------------------------------- | ----------------------- |
| メッシュ             | `MeshDesc`          | `createMesh()`                          | `view.registerMesh()`   |
| インスタンスメッシュ | `InstancedMeshDesc` | `createGeometry()` + `createMaterial()` | `view.registerMesh()`   |
| エフェクト           | `EffectDesc`        | `createPass()`                          | `view.registerEffect()` |
| ライト               | `LightDesc`         | `createLight()`                         | `view.registerLight()`  |

すべての基底クラスは `BaseDesc` を継承しており、共通のライフサイクルを持ちます。

## 共通のライフサイクル

| メソッド                         | タイミング                                            | 説明                                                                                       |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `constructor(view, ctx, config)` | Descriptor 生成時                                     | ThreeView、ViewContext、設定を受け取る                                                     |
| `onCreate()`                     | `addMesh()` / `addEffect()` / `addLight()` 呼び出し時 | ファクトリメソッドを呼び出してインスタンスを作成し、シーンに追加する。基底クラスが実装済み |
| `onUpdateConfig(updates)`        | `handle.update()` 呼び出し時                          | 設定の部分更新を処理する                                                                   |
| `onDestroy()`                    | `handle.delete()` 呼び出し時                          | リソースの解放とシーンからの削除                                                           |
| `update(time)`                   | 毎フレーム（オプション）                              | アニメーション処理。実装した場合のみ呼び出される                                           |
| `onResize(width, height)`        | ビューポートリサイズ時（オプション）                  | メッシュのみ。実装した場合のみ呼び出される                                                 |

## 共通プロパティ

| プロパティ  | 型                      | 説明                                                                            |
| ----------- | ----------------------- | ------------------------------------------------------------------------------- |
| `view`      | `ThreeView`             | カメラ、大気、地球などのビュー状態へのアクセスを提供する ThreeView インスタンス |
| `ctx`       | `ViewContext`           | シーン、パス、レンダリング内部へのアクセスを提供するビューコンテキスト          |
| `_instance` | `Instance \| undefined` | 作成された Three.js オブジェクト                                                |
| `id`        | `string`                | Descriptor の一意な識別子                                                       |
| `visible`   | `boolean`               | 表示/非表示                                                                     |

### view と ctx

カスタム Descriptor は `this.view` と `this.ctx` の2つのプロパティを通じて内部 API にアクセスします。

- **`this.view`** (`ThreeView`): 高レベルなビュー状態：カメラ、大気、地球
- **`this.ctx`** (`ViewContext`): レンダリング内部：シーン、ポストプロセッシングパス、バッファ、テクスチャ

#### view プロパティ

[ThreeView Properties](../../../three/api/threeview-properties/) を参照してください。

#### ctx プロパティ

| プロパティ               | 説明                                              |
| ------------------------ | ------------------------------------------------- |
| `ctx.scenes.opaque`      | 不透明オブジェクト用シーン                        |
| `ctx.scenes.transparent` | 半透明オブジェクト用シーン                        |
| `ctx.scenes.mrt`         | Selective Effect（Bloom / Outline）用シーン |
| `ctx.scenes.skyEnvMap`   | 環境マップ用シーン                                |
| `ctx.scenes.light`       | ライト用シーン                                    |
| `ctx.scenes.draped`      | 地形ドレープメッシュ用シーン                      |

#### パス管理

| メソッド                                       | 説明                                 |
| ---------------------------------------------- | ------------------------------------ |
| `ctx.getPass(name)`                            | ポストプロセッシングパスを名前で取得 |
| `ctx.addPass(name, pass)`                      | ポストプロセッシングパスを追加       |
| `ctx.insertPassBefore(targetName, name, pass)` | 対象パスの前にパスを挿入             |
| `ctx.insertPassAfter(targetName, name, pass)`  | 対象パスの後にパスを挿入             |
| `ctx.removePass(name)`                         | ポストプロセッシングパスを名前で削除 |

#### レンダラーアクセス

| メソッド               | 説明                                       |
| ---------------------- | ------------------------------------------ |
| `ctx.getRenderer()`    | WebGLRenderer インスタンスを取得           |
| `ctx.getInputBuffer()` | エフェクトコンポーザーの入力バッファを取得 |

#### Descriptor の検索

| メソッド                | 説明                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| `ctx.findEffect(key)`   | `key` で登録されたアクティブなエフェクト Descriptor（例: `"mrt"`）      |
| `ctx.findLight(key)`    | `key` で登録されたアクティブなライト Descriptor（例: `"sun"`）          |
| `ctx.findMesh(key)`     | `key` で登録されたアクティブなメッシュ Descriptor（例: `"gltfModel"`）  |

シーンの既存設定を重複して持たずに引き継ぐために使います。たとえばカスタムのライティングエフェクトは、独自オプションを増やす代わりに `ctx.findLight("sun")` から太陽の強度と色を読めます。該当する Descriptor が無ければ `undefined` を返します。

#### バッファ / テクスチャアクセス

| メソッド                      | 説明                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `ctx.getRenderTarget()`       | メインレンダーターゲット（G-buffer を含む）を取得    |
| `ctx.getGlobeDepthTexture()`  | ポストプロセッシング用のグローブ深度テクスチャを取得 |
| `ctx.getGlobeNormalTexture()` | 地形のみの法線を画面座標で取得。`requiredBuffers` に `globeNormal` を宣言すること（未宣言だと 1x1 のまま） |
| `ctx.getNormalTexture()`      | G-buffer からシーン法線テクスチャを取得              |
| `ctx.getEffectIdsTexture()`   | G-buffer からエフェクト ID テクスチャを取得          |
| `ctx.getEmissiveTexture()`    | G-buffer からエミッシブテクスチャを取得              |
| `ctx.getShadowTexture()`      | G-buffer からシャドウテクスチャ（R=影の量、0=非影..1=完全な影）を取得 |

#### シャドウ（実験的）

| メソッド                             | 説明                             |
| ------------------------------------ | -------------------------------- |
| `ctx.applyShadowMaterial(material)`  | CSM シャドウをマテリアルに適用   |
| `ctx.removeShadowMaterial(material)` | CSM シャドウをマテリアルから削除 |

## G-Buffer（MRT）への出力

Navara は複数のレンダーターゲット（MRT）からなる G-buffer にレンダリングします。深度・法線を利用するエフェクト（SSAO、SSR、Outline、大気透視、雲）や Selective Effect（Bloom / Outline）はこれらのアタッチメントを読み取るため、メッシュがそれらのエフェクトに参加できるのは、そのマテリアルが G-buffer に書き込む場合だけです。

常に存在するのは color と normal だけです。それ以外は必要に応じて確保され、**隙間なく後ろに詰められる**ため、ロケーションは構成によって変わります。シェーダーには各バッファの `layout(location = …)` が define として渡されます。

| アタッチメント | ロケーション | 内容                                                         | 確保される条件            |
| -------------- | ------------ | ------------------------------------------------------------ | ------------------------- |
| Color          | 0            | `gl_FragColor`                                                | 常時                      |
| Normal         | 1            | ビュー空間の法線（＋マテリアルプロパティ）                    | 常時                      |
| Effect ID      | 可変         | Selective Effect のビットマスク                                | `buffers.selectiveEffect` |
| Emissive       | 可変         | Selective Effect の加算エミッシブ                              | `buffers.emissive`        |
| Shadow         | 可変         | R = 影の量（0=非影..1=完全な影）、G = albedo 出力フラグ       | `buffers.shadow`          |

オプションのアタッチメント index はハードコードせず、後述の `ViewContext` のアクセサから取得してください。

### 組み込みマテリアルは自動対応

`@navaramap/three` を import すると、組み込みの Three.js マテリアル（`MeshStandardMaterial`、`MeshBasicMaterial`、`MeshLambertMaterial`、`MeshPhongMaterial`、`SpriteMaterial`、`PointsMaterial`）は G-buffer に書き込むよう自動的にパッチされます。カスタム Descriptor がこれらを使う場合、何もする必要はありません。

### カスタムマテリアルは明示的な有効化が必要

`ShaderMaterial` と three-stdlib の `LineMaterial` は Three.js の `ShaderLib` を経由しないため、Navara は自動でパッチできません。`setupMaterialForMRT()` で有効化してください。

```typescript
import { setupMaterialForMRT } from "@navaramap/three";

const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader });

// フラグメントシェーダー内のビュー空間法線変数名を指定します（既定は "normal"）。
setupMaterialForMRT(material, { normal: "vNormal" });

// LineMaterial は自動的に検出・振り分けされます（その場合 `normal` は無視されます）。
setupMaterialForMRT(lineMaterial);
```

| パラメータ       | 型               | 説明                                                                                                                                     |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `material`       | `ShaderMaterial` | パッチ対象のカスタムマテリアル。`LineMaterial`（`ShaderMaterial` を継承）は自動的に検出・処理されます                                    |
| `options.normal` | `string`         | フラグメントシェーダー内の**ビュー空間**法線変数名。既定は `"normal"`。`packNormalToVec2` でパックされるため、ビュー空間である必要があります |

これを省略すると、メッシュは法線 / エフェクト ID / エミッシブのアタッチメントに何も書き込まないため、深度・法線ベースのエフェクトや Selective Effect がそのメッシュ上で壊れます（法線が不正になり、Bloom や Outline が効かなくなります）。

要件と挙動：

- フラグメントシェーダーは `options.normal` で指定した名前のビュー空間法線を公開している必要があります。
- 頂点・フラグメントシェーダーの最後の `}` は `main()` を閉じるものとみなされます。
- WebGL2 / GLSL 3 が必要です（Navara の既定）。
- 冪等です。同じマテリアルに対して再度呼んでも何も起こりません。

組み込みマテリアルの自動パッチは、import 時に内部の `overrideMaterialsForMRT()` が実行します。アプリケーションコードから呼ぶことはありません。

#### 完全な例

必要なのは 2 つで、**どちらか一方でも欠けると、深度・法線ベースのエフェクトに一切参加しないメッシュが黙って出来上がります**。

1. `setupMaterialForMRT()`: マテリアルがアタッチメントに書き込むようにする
2. `getPassKey()` が `"mrt"` を返す、すなわちメッシュを G-buffer パスで描画する。既定は `"opaque"` で、これは G-buffer のコピー**後**に合成されるため、そこに置かれたメッシュはマテリアルが何をしていても書き込みません

```typescript
import ThreeView, {
  MeshDesc,
  setupMaterialForMRT,
  type MeshConfig,
  type MeshUpdate,
  type PassKey,
  type ViewContext,
} from "@navaramap/three";
import { Mesh, ShaderMaterial, SphereGeometry, Uniform, Vector3 } from "three";

type Description = { glowSphere?: { radius?: number } };
type GlowSphereConfig = MeshConfig & Description;
type GlowSphereUpdate = MeshUpdate & Description;

class GlowSphereDesc extends MeshDesc<
  GlowSphereConfig,
  GlowSphereUpdate,
  Mesh<SphereGeometry, ShaderMaterial>
> {
  private config: GlowSphereConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: GlowSphereConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  protected override getPassKey(): PassKey {
    return "mrt";
  }

  createMesh() {
    const material = new ShaderMaterial({
      uniforms: { uColor: new Uniform(new Vector3(0.1, 0.8, 0.5)) },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        void main() {
          gl_FragColor = vec4(uColor, 1.0);
        }
      `,
    });

    setupMaterialForMRT(material, { normal: "vNormal" });

    const radius = this.config.glowSphere?.radius ?? 100;
    return new Mesh(new SphereGeometry(radius, 32, 32), material);
  }
}

const view = new ThreeView();
view.registerMesh("glowSphere", GlowSphereDesc);
await view.init();

view.addMesh<GlowSphereDesc>({
  glowSphere: { radius: 200 },
  position: { x: 0, y: 0, z: 6_400_000 },
});
```

### G-Buffer の読み取り

これらのバッファをカスタムエフェクトから読み取るには、`ctx` の [バッファ / テクスチャアクセス](#バッファ--テクスチャアクセス) アクセサを使うか、[`find<MRTPassEffectDesc>("mrt")`](#他のエフェクトを参照) で他のエフェクトから MRT パスを参照します。

エフェクト ID・エミッシブ・シャドウ・globeNormal のバッファはオプションです。アクティブなエフェクトが `static requiredBuffers` で宣言している間だけ存在し（例: `["selectiveEffect", "emissive"]` / `["shadow"]` / `["globeNormal"]`）、それ以外ではアクセサは `undefined` を返します。

`globeNormal` だけは性質が異なり、G-buffer のアタッチメントではなく**地形法線の画面座標コピー**です。そのためアタッチメント枠を消費せず、デバイスの `MAX_DRAW_BUFFERS` にも数えられません。未宣言の場合はコピー先が 1x1 のままで、`ctx.getGlobeNormalTexture()` が返すテクスチャは意味のあるサンプリングができません。これらを読み取るカスタムエフェクトは、ビューにバッファを確保させるため `requiredBuffers` を宣言してください。なお、確保されるバッファ構成の変更はアタッチメントの再確保とシェーダーの再コンパイルを伴うため、エフェクトは一度追加したら削除・再追加を繰り返さず、`update()` で調整してください。また構成変更でアタッチメントは再構築されるため、これらのテクスチャはパス生成時にキャッシュせず、毎フレーム（`update()` やパスの `render()` で）取得してください。

サンプリング時に注意すべきエンコーディング:

- 法線バッファの RG チャンネルは**ビュー空間法線の octahedral エンコード**です。`@navaramap/three` がエクスポートする `NORMAL_PACKING_SHADER` GLSL 文字列の `unpackVec2ToNormal()` でデコードしてください（単純な `xy * 2 - 1` の再構成では誤った陰影になります）。
- シャドウバッファは `R = 影の量`（0=非影..1=完全な影）、`G = albedo 出力フラグ`（[`lit`](../../../three/api/threeview-properties/#lit) オプションで color が素の albedo のとき 1。deferred lighting パスが「このピクセルを照らす」マスクとして使います）を保持します。
- 深度テクスチャは Three.js の packing 規約に従います。MRT パスの `depthBufferPacking` / `globeDepthBufferPacking` を確認し、`@navaramap/three` がエクスポートする `DEPTH_PACKING_SHADER` GLSL 文字列（Three.js の `packing` チャンク）のヘルパーでアンパックしてください。

## カスタムメッシュ

### 型パラメータ

```typescript
class MyMeshDesc extends MeshDesc<
  Config,      // Descriptor の設定型（MeshConfig を拡張）
  UpdateConfig, // 更新時の設定型（MeshUpdate を拡張）
  InstanceObj,  // Three.js オブジェクトの型（Object3D を拡張）
> {}
```

### 設定型の定義

```typescript
import type { MeshConfig, MeshUpdate } from "@navaramap/three";

type MyMeshDescription = {
  myMesh?: {
    radius?: number;
    color?: Color;
  };
};

type MyMeshConfig = MeshConfig & MyMeshDescription;
type MyMeshUpdate = MeshUpdate & MyMeshDescription;
```

### 基底クラスが管理するプロパティ

`MeshDesc` は `position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`pickable`、`visible` を自動的に処理します。そのためカスタム Descriptor もビルトインと同様に `geodetic` で経度・緯度に配置できます。これらのプロパティ、トランスフォーム合成モード、ピッキング動作の詳細については [MeshDesc](../../../three_default_descs/mesh-desc/mesh-desc-base) を参照してください。

### レンダーパスの指定

`getPassKey()` をオーバーライドして、メッシュの描画先シーンを変更できます。

| PassKey         | 説明                                        |
| --------------- | ------------------------------------------- |
| `"opaque"`      | 不透明レンダリング（デフォルト）            |
| `"transparent"` | 半透明レンダリング                          |
| `"mrt"`         | Selective Effect 用（Bloom / Outline） |
| `"skyEnvMap"`   | 環境マップ用                                |
| `"draped"`      | 地形ドレープレンダリング用                  |

### 実装例

```typescript
import ThreeView, {
  MeshDesc,
  type MeshConfig,
  type MeshUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import {
  Mesh,
  SphereGeometry,
  MeshStandardMaterial,
} from "three";

// 設定型を定義
type MySphereMeshDescription = {
  mySphere?: {
    radius?: number;
    color?: Color;
    castShadow?: boolean;
  };
};
type MySphereMeshConfig = MeshConfig & MySphereMeshDescription;
type MySphereMeshUpdate = MeshUpdate & MySphereMeshDescription;

export class MySphereMeshDesc extends MeshDesc<
  MySphereMeshConfig,
  MySphereMeshUpdate,
  Mesh<SphereGeometry, MeshStandardMaterial>
> {
  private config: MySphereMeshConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MySphereMeshConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  // Three.js オブジェクトを作成して返す
  createMesh() {
    const cfg = this.config.mySphere ?? {};
    const geometry = new SphereGeometry(cfg.radius ?? 1);
    const material = new MeshStandardMaterial({
      color: cfg.color?.raw ?? 0xffffff,
    });
    const mesh = new Mesh(geometry, material);

    // シャドウを有効にする場合
    if (cfg.castShadow) {
      mesh.castShadow = true;
      this.ctx.applyShadowMaterial(material);
    }

    return mesh;
  }

  // 部分更新を処理
  onUpdateConfig(updates: MySphereMeshUpdate) {
    if (updates.mySphere && this._instance) {
      if (updates.mySphere.radius !== undefined) {
        // ジオメトリの再作成が必要な場合は recreate() を呼ぶ
        this.recreate();
      }
      if (updates.mySphere.color !== undefined) {
        this._instance.material.color.set(updates.mySphere.color.raw);
      }
      this.emit("needsUpdate");
    }
    // 基底クラスの処理（position, scale, rotation, visible）
    super.onUpdateConfig(updates);
  }

  // リソースの解放
  onDestroy() {
    if (this._instance) {
      this._instance.geometry.dispose();
      this._instance.material.dispose();
    }
    super.onDestroy();
  }
}
```

### 登録と使用

```typescript
import ThreeView from "@navaramap/three";

const view = new ThreeView({});
view.registerMesh("mySphere", MySphereMeshDesc);
await view.init();

const handle = view.addMesh<MySphereMeshDesc>({
  mySphere: { radius: 100, color: new Color().setHex(0x00aaff) },
  position: { x: 0, y: 0, z: 6378137 },
});

// 部分更新
handle.update({ mySphere: { color: new Color().setHex(0xff0000) } });
```

### フレームごとのアニメーション

`update()` メソッドを実装すると、毎フレーム呼び出されます。

```typescript
export class RotatingBoxDesc extends MeshDesc</* ... */> {
  createMesh() {
    // ...
  }

  // 毎フレーム呼び出される
  update(time: number) {
    if (this._instance) {
      this._instance.rotation.y = time * 0.001;
    }
  }
}
```

## Custom Instanced Mesh Desc

同じジオメトリの多数のコピーを1回の描画コールでレンダリングするには、`InstancedMeshDesc` を使用します。すべてのインスタンスは1つのジオメトリとマテリアルを共有し、`instanceMatrix` と `instanceColor` でインスタンスごとの差異を表現します。

### Type Parameters

```typescript
class MyInstancedDesc extends InstancedMeshDesc<
  TGeometry,    // Three.js BufferGeometry type
  TMaterial,    // Three.js Material type
  Config,       // Descriptor configuration type (extends InstancedMeshConfig)
  UpdateConfig, // Update configuration type (extends InstancedMeshUpdate)
  ChildConfig,  // Per-instance configuration type (extends InstancedChildConfig)
> {}
```

### InstancedChildConfig

インスタンスごとの共通トランスフォームフィールド：

| Property   | Type      | Description                                                                  |
| ---------- | --------- | ---------------------------------------------------------------------------- |
| `position` | [`XYZ`](../../../three/api/types/#xyz) | Local position relative to the parent group                                  |
| `rotation` | [`XYZ`](../../../three/api/types/#xyz) | Local rotation (Euler angles in radians)                                     |
| `scale`    | [`XYZ`](../../../three/api/types/#xyz) | Local scale                                                                  |
| `matrix`   | `Matrix4` | Pre-computed transform matrix. When set, position/rotation/scale are ignored |

### Abstract Methods

| Method                     | Return Type               | Description                                                         |
| -------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `createGeometry()`         | `TGeometry`               | Create the shared geometry for all instances                        |
| `createMaterial()`         | `TMaterial`               | Create the shared material for all instances                        |
| `getChildConfigs()`        | `ChildConfig[]`           | Extract the initial array of instance configs from the layer config |
| `getInstanceColor(config)` | `ThreeColor \| undefined` | Extract the per-instance color, or undefined for default white      |

### Optional Override Methods

| Method                             | Description                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `getInstanceScale(config, target)` | Compute per-instance scale. Override to incorporate geometry-specific dimensions (e.g., width/height/depth) |
| `composeInstanceMatrix(config)`    | Compose the transform matrix for one instance. Override for custom transform logic                          |

### Instance Management Methods

| Method                    | Signature                                               | Description                                 |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `add(config)`             | `(config: ChildConfig) => number`                       | Add a new instance. Returns the index       |
| `removeAt(index)`         | `(index: number) => void`                               | Remove by index (swap-with-last, O(1))      |
| `updateAt(index, config)` | `(index: number, config: Partial<ChildConfig>) => void` | Update an instance at the given index       |
| `clear()`                 | `() => void`                                            | Remove all instances                        |
| `replaceAll(configs)`     | `(configs: ChildConfig[]) => void`                      | Batch replace all instances (single update) |
| `count`                   | `number` (getter)                                       | Number of active instances                  |

### Implementation Example

```typescript
import ThreeView, {
  InstancedMeshDesc,
  type InstancedMeshConfig,
  type InstancedMeshUpdate,
  type InstancedChildConfig,
  type ViewContext,
  Color,
} from "@navaramap/three";
import {
  BoxGeometry,
  MeshStandardMaterial,
  Color as ThreeColor,
} from "three";

// Per-instance configuration
type MyBoxChild = InstancedChildConfig & {
  color?: Color;
};

// Descriptor configuration
type MyBoxesConfig = InstancedMeshConfig & {
  boxes?: { children?: MyBoxChild[] };
};
type MyBoxesUpdate = InstancedMeshUpdate & {
  boxes?: { children?: MyBoxChild[] };
};

export class MyBoxesDesc extends InstancedMeshDesc<
  BoxGeometry,
  MeshStandardMaterial,
  MyBoxesConfig,
  MyBoxesUpdate,
  MyBoxChild
> {
  private config: MyBoxesConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MyBoxesConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createGeometry() {
    return new BoxGeometry(1, 1, 1);
  }

  createMaterial() {
    return new MeshStandardMaterial();
  }

  getChildConfigs(): MyBoxChild[] {
    return this.config.boxes?.children ?? [];
  }

  getInstanceColor(config: MyBoxChild): ThreeColor | undefined {
    return config.color ? new ThreeColor(config.color.raw) : undefined;
  }
}
```

### Registration and Usage

```typescript
import ThreeView, { Color } from "@navaramap/three";

const view = new ThreeView({});
view.registerMesh("myBoxes", MyBoxesDesc);
await view.init();

const handle = view.addMesh<MyBoxesDesc>({
  boxes: {
    children: [
      { position: { x: 0, y: 0, z: 100 }, color: new Color().setHex(0xff0000) },
      { position: { x: 200, y: 0, z: 100 }, color: new Color().setHex(0x00ff00) },
    ],
  },
  position: { x: 0, y: 0, z: 6378137 },
});

// Add an instance dynamically
handle.ref.add({ position: { x: 400, y: 0, z: 100 }, color: new Color().setHex(0x0000ff) });

// Update instance at index 0
handle.ref.updateAt(0, { color: new Color().setHex(0xffff00) });

// Remove instance at index 1
handle.ref.removeAt(1);
```

## カスタムエフェクト

### 型パラメータ

```typescript
class MyEffectDesc extends EffectDesc<
  Config,      // Descriptor の設定型（EffectConfig を拡張）
  UpdateConfig, // 更新時の設定型（EffectUpdate を拡張）
  InstanceObj,  // ポストプロセッシングパスの型
> {}
```

### static プロパティ（パイプライン順序）

エフェクト Descriptor には、レンダーパイプライン内での挿入位置を制御する static プロパティがあります。

| プロパティ         | 型         | 説明                                                                             |
| ------------------ | ---------- | -------------------------------------------------------------------------------- |
| `key`              | `string`   | **必須**。エフェクト Descriptor の一意なキー名                                   |
| `insertAfter`      | `string[]` | 指定したエフェクトの後に挿入（優先）                                             |
| `insertBefore`     | `string[]` | 指定したエフェクトの前に挿入（`insertAfter` が見つからない場合のフォールバック） |
| `allowDuplication` | `boolean`  | 同じエフェクトの複数インスタンスを許可するか                                     |

挿入順序は `insertAfter` → `insertBefore` → 末尾に追加 の優先度で決まります。

### 実装例

```typescript
import ThreeView, {
  EffectDesc,
  type EffectConfig,
  type EffectUpdate,
  type ViewContext,
} from "@navaramap/three";

type MyEffectDescription = {
  myEffect?: {
    intensity?: number;
  };
};
type MyEffectConfig = EffectConfig & MyEffectDescription;
type MyEffectUpdate = EffectUpdate & MyEffectDescription;

export class MyEffectDesc extends EffectDesc<
  MyEffectConfig,
  MyEffectUpdate,
  MyPostProcessingPass
> {
  // パイプライン内の順序を制御
  static key = "myEffect";
  static insertAfter = ["clouds"];
  static insertBefore = ["transparent"];

  private config: MyEffectConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MyEffectConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  // ポストプロセッシングパスを作成して返す
  createPass() {
    const cfg = this.config.myEffect ?? {};
    return new MyPostProcessingPass({
      intensity: cfg.intensity ?? 1.0,
    });
  }

  onUpdateConfig(updates: MyEffectUpdate) {
    if (updates.myEffect && this._instance) {
      if (updates.myEffect.intensity !== undefined) {
        this._instance.intensity = updates.myEffect.intensity;
      }
      this.emit("needsUpdate");
    }
    super.onUpdateConfig(updates);
  }
}
```

### 他のエフェクトを参照

`find()` で他の登録済みエフェクトを参照できます。

```typescript
createPass() {
  const mrt = this.find<MRTPassEffectDesc>("mrt");
  // ...
}
```

## カスタムライト

### 型パラメータ

```typescript
class MyLightDesc extends LightDesc<
  Config,      // Descriptor の設定型（LightConfig を拡張）
  UpdateConfig, // 更新時の設定型（LightUpdate を拡張）
  InstanceObj,  // Three.js Light の型
> {}
```

### 基底クラスが管理するプロパティ

| プロパティ | 型            | 説明         |
| ---------- | ------------- | ------------ |
| `position` | `{ x, y, z }` | ライトの位置 |
| `visible`  | `boolean`     | 表示/非表示  |

ライトは自動的に `ctx.scenes.light` シーンに追加されます。

### 実装例

```typescript
import ThreeView, {
  LightDesc,
  type LightConfig,
  type LightUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import { PointLight } from "three";

type MyPointLightDescription = {
  myPointLight?: {
    color?: Color;
    intensity?: number;
    distance?: number;
  };
};
type MyPointLightConfig = LightConfig & MyPointLightDescription;
type MyPointLightUpdate = LightUpdate & MyPointLightDescription;

export class MyPointLightDesc extends LightDesc<
  MyPointLightConfig,
  MyPointLightUpdate,
  PointLight
> {
  private config: MyPointLightConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: MyPointLightConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createLight() {
    const cfg = this.config.myPointLight ?? {};
    const light = new PointLight(
      cfg.color?.raw ?? 0xffffff,
      cfg.intensity ?? 1,
      cfg.distance ?? 0,
    );
    return light;
  }

  onUpdateConfig(updates: MyPointLightUpdate) {
    if (updates.myPointLight && this._instance) {
      if (updates.myPointLight.color !== undefined) {
        this._instance.color.set(updates.myPointLight.color.raw);
      }
      if (updates.myPointLight.intensity !== undefined) {
        this._instance.intensity = updates.myPointLight.intensity;
      }
      if (updates.myPointLight.distance !== undefined) {
        this._instance.distance = updates.myPointLight.distance;
      }
      this.emit("needsUpdate");
    }
    super.onUpdateConfig(updates);
  }
}
```

## BaseHandle

`view.addMesh()` / `view.addEffect()` / `view.addLight()` から返される `BaseHandle<T>` は、オブジェクトを制御するためのハンドルです。

| プロパティ / メソッド | 型        | 説明                                         |
| --------------------- | --------- | -------------------------------------------- |
| `id`                  | `string`  | オブジェクトの一意な識別子                   |
| `visible`             | `boolean` | 表示/非表示の取得・設定                      |
| `ref`                 | `T`       | 基底 Descriptor インスタンスへの直接アクセス |
| `update(updates)`     | `void`    | 設定の部分更新                               |
| `delete()`            | `void`    | オブジェクトの削除。`onDestroy()` が呼ばれる |

## カスタム Descriptor でのピッキング実装

ユーザー向けのピッキング概要については [MeshDesc: ピッキング](../../../three_default_descs/mesh-desc/mesh-desc-base/#ピッキング) を参照してください。このセクションでは、カスタム Descriptor を作成する際にピッキングサポートを実装する方法を説明します。

### PickableMeshWrapper によるターンキーピッキング

標準的な Three.js マテリアル（`MeshStandardMaterial`、`MeshLambertMaterial` など）や `ShaderMaterial` を使用する Descriptor では、メッシュを `PickableMeshWrapper` でラップします。ピッキングシェーダーコードが自動的に注入されます。

```typescript
import ThreeView, {
  MeshDesc,
  PickableMeshWrapper,
  type MeshConfig,
  type MeshUpdate,
  type ViewContext,
  Color,
} from "@navaramap/three";
import { Mesh, BoxGeometry, MeshStandardMaterial } from "three";

type MyConfig = MeshConfig & { myBox?: { color?: Color } };
type MyUpdate = MeshUpdate & { myBox?: { color?: Color } };

class MyPickableBoxDesc extends MeshDesc<
  MyConfig, MyUpdate, Mesh
> {
  private config: MyConfig;
  private pickWrapper?: PickableMeshWrapper;

  constructor(view: ThreeView, ctx: ViewContext, config: MyConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  get batchId(): number | undefined {
    return this.pickWrapper?.batchId;
  }

  createMesh() {
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: this.config.myBox?.color?.raw ?? 0xffffff }),
    );

    if (this.config.pickable) {
      this.pickWrapper = new PickableMeshWrapper(mesh, this.ctx);
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }

    return mesh;
  }

  onDestroy() {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
    }
    super.onDestroy();
  }
}
```

### インスタンスメッシュのピッキング

インスタンスメッシュには `PickableInstancedMeshWrapper` を使用します。インスタンスごとに一意のバッチ ID が割り当てられ、クリックされた個々のインスタンスを特定できます。

```typescript
import {
  InstancedMeshDesc,
  PickableInstancedMeshWrapper,
} from "@navaramap/three";

class MyPickableInstancedDesc extends InstancedMeshDesc</* ... */> {
  private pickWrapper?: PickableInstancedMeshWrapper;

  get batchIds(): readonly number[] {
    return this.pickWrapper?.batchIds ?? [];
  }

  override onCreate() {
    super.onCreate();
    if (this.config.pickable) {
      this.pickWrapper = new PickableInstancedMeshWrapper(
        this.raw, this.count, this.ctx,
      );
      this.ctx.registerPickableMesh(this.id, this.pickWrapper);
    }
  }

  protected override onInstanceAdded(index: number) {
    this.pickWrapper?.addInstance();
  }

  protected override onInstanceRemoved(index: number, wasLast: boolean) {
    this.pickWrapper?.removeInstanceAt(index);
  }

  protected override onInstanceMeshReplaced(newMesh: InstancedMesh) {
    this.pickWrapper?.syncMesh(newMesh);
  }

  onDestroy() {
    if (this.pickWrapper) {
      this.ctx.unregisterPickableMesh(this.id);
    }
    super.onDestroy();
  }
}
```

### PickableMesh によるカスタムピッキング

完全にカスタムなシェーダーを持つ Descriptor では、`PickableMesh` インターフェースを直接実装します。フラグメントシェーダーで、ピッキングユニフォームがアクティブな場合にバッチ ID を RGB カラーとしてエンコードする必要があります。

```typescript
import { type PickableMesh } from "@navaramap/three";

class CustomPickable extends Object3D implements PickableMesh {
  batchId: number;
  private mesh: Mesh;

  constructor(mesh: Mesh, ctx: ViewContext) {
    super();
    this.mesh = mesh;
    this.batchId = ctx.genGlobalBatchId() ?? 0;
    mesh.material.uniforms.uBatchId.value = this.batchId;
  }

  onBeforePicking() {
    this.mesh.material.uniforms.uPicking.value = 1;
  }

  onAfterPicking() {
    this.mesh.material.uniforms.uPicking.value = 0;
  }

  getRenderable() {
    return this.mesh;
  }
}
```

フラグメントシェーダーでのバッチ ID エンコーディング:

```glsl
vec3 batchIdToColor(float id) {
  float r = floor(id / 65536.0);
  float g = floor(mod(id / 256.0, 256.0));
  float b = mod(id, 256.0);
  return vec3(r, g, b) / 255.0;
}

// メイン関数内:
if (uPicking > 0.0) {
  gl_FragColor = vec4(batchIdToColor(uBatchId), 1.0);
  return;
}
```

### ViewContext ピッキング API

| メソッド                              | 説明                                     |
| ------------------------------------- | ---------------------------------------- |
| `ctx.genGlobalBatchId()`              | ピッキング用のユニークなバッチ ID を生成 |
| `ctx.registerPickableMesh(key, mesh)` | ピッカブルメッシュを登録                 |
| `ctx.unregisterPickableMesh(key)`     | ピッカブルメッシュの登録を解除           |

## 関連リソース

- [レイヤーと Descriptor](../../../three/introduction/about-layer/) - レイヤーとオブジェクトの概念と種類
- [About Plugin](../../../three/introduction/about-plugin/) - プラグインシステムの概念
- [Plugin API](../../../three/core/plugin/) - プラグインの実装方法
- [three_default_descs](../../../three_default_descs/about/) - デフォルト Descriptor の実装例
