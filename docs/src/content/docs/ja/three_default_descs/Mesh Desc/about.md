---
title: Mesh Descriptor
description: Mesh descriptor types for navara_three
sidebar:
  order: 100
---

`MeshDesc`は、3Dメッシュオブジェクトをシーンに追加するためのDescriptorタイプです。様々な3Dオブジェクトを表示できます。

すべてのメッシュは [`MeshDesc`](../mesh-desc-base) を継承しており、`position`、`rotation`、`scale`、`matrix`、`matrixWorld`、`geodetic`、`pickable` などの共通プロパティを提供します。トランスフォーム合成、ピッキング、座標変換の詳細については [MeshDesc](../mesh-desc-base) ページを参照してください。

## 利用可能なMeshDescタイプ

navara_threeでは、以下のMeshDescタイプが利用可能です:

| Descriptorタイプ                                     | 説明                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [ArclineMeshDesc](../arcline-mesh-desc)            | 2点間を結ぶアーク状のラインを描画するDescriptor                                           |
| [BoxMeshDesc](../box-mesh-desc)                    | 立方体(Box)ジオメトリを描画するDescriptor                                                 |
| [InstancedBoxMeshDesc](../instanced-box-mesh-desc) | GPU インスタンシングを使用して複数のボックスを1回の描画コールでレンダリングするDescriptor |
| [CylinderMeshDesc](../cylinder-mesh-desc)          | 円柱(Cylinder)ジオメトリを描画するDescriptor                                              |
| [InstancedCylinderMeshDesc](../instanced-cylinder-mesh-desc) | GPU インスタンシングを使用して複数の円柱を1回の描画コールでレンダリングするDescriptor       |
| [GLTFModelDesc](../gltf-model-desc)                | GLTF/GLB形式の3Dモデルを読み込み・表示するDescriptor                                      |
| [InstancedGltfModelMeshDesc](../instanced-gltf-model-mesh-desc) | GPU インスタンシングを使用して GLTF/GLB モデルの複数コピーをレンダリングするDescriptor    |
| [GlowGlobeMeshDesc](../glow-globe-mesh-desc)       | 地球の周りにフレネル効果による光彩(グロー)を表示するDescriptor                            |
| [PlaneMeshDesc](../plane-mesh-desc)                | 平面(Plane)ジオメトリを描画するDescriptor                                                 |
| [PolygonMeshDesc](../polygon-mesh-desc) | 座標列から単一のポリゴンを描画するDescriptor。平面・押し出し・地形へのクランプに対応 |
| [PolylineMeshDesc](../polyline-mesh-desc) | 座標列から単一のポリラインを描画するDescriptor。指定の高さまたは地形へのクランプに対応 |
| [InstancedPlaneMeshDesc](../instanced-plane-mesh-desc) | GPU インスタンシングを使用して複数の平面を1回の描画コールでレンダリングするDescriptor       |
| [RainMeshDesc](../rain-mesh-desc)                  | 雨のパーティクルエフェクトを表示するDescriptor                                            |
| [SkyBoxMeshDesc](../sky-box-mesh-desc)             | シンプルなスカイボックスを描画するDescriptor                                              |
| [SkyMeshDesc](../sky-mesh-desc)                    | 大気散乱による空と太陽・月を描画するDescriptor                                            |
| [SmoothLineMeshDesc](../smooth-line-mesh-desc)     | カトマル・ロム曲線による滑らかなラインを描画するDescriptor                                |
| [SnowMeshDesc](../snow-mesh-desc)                  | 雪のパーティクルエフェクトを表示するDescriptor                                            |
| [SphereMeshDesc](../sphere-mesh-desc)              | 球体(Sphere)ジオメトリを描画するDescriptor                                                |
| [SplatMeshDesc](../splat-mesh-desc)                | SparkJS による 3D Gaussian Splat アセットを描画するDescriptor                            |
| [InstancedSphereMeshDesc](../instanced-sphere-mesh-desc) | GPU インスタンシングを使用して複数の球を1回の描画コールでレンダリングするDescriptor          |
| [StarsDesc](../stars-desc)                         | 星空を描画するDescriptor                                                                  |
| [TubeMeshDesc](../tube-mesh-desc)                  | チューブ(Tube)ジオメトリを描画するDescriptor                                              |
| [AxesHelperDesc](../axes-helper-desc)              | 3軸を可視化するデバッグ用ヘルパーDescriptor                                               |
| [ArrowHelperDesc](../arrow-helper-desc)            | ベクトル方向を可視化するデバッグ用ヘルパーDescriptor                                      |

## 基本的な使い方

MeshDescは、Descriptorクラスを登録した後、`view.addMesh()`メソッドで追加します:

```typescript
import ThreeView, { Color } from "@navaramap/three";
import { BoxMeshDesc } from "@navaramap/three-default-descs";

const view = new ThreeView();

// Descriptorクラスを登録
view.registerMesh("box", BoxMeshDesc);

await view.init();

// BoxMeshDescを経度・緯度（度）と高さ（メートル）で追加
const boxDesc = view.addMesh<BoxMeshDesc>({
  box: {
    width: 100,
    height: 100,
    depth: 100,
    color: new Color().setHex(0xff0000),
  },
  geodetic: { lng: 139.767125, lat: 35.681236, height: 1000 },
});
```

詳細な使用方法は、各Descriptorタイプのドキュメントを参照してください。
