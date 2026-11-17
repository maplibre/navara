import type {
  PolygonInternalMaterial,
  PolygonMaterial,
} from "@navaramap/engine";

export class PolygonMaterialLike {
  clampToGround?: boolean;
  tiled?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  color?: number;
  extrudedHeight?: number;
  height?: number;
  show?: boolean;
  perPositionHeight?: boolean;
  extrusionBase?: string;
  wireframe?: boolean;
  outline?: boolean;
  __internal__?: PolygonInternalMaterial | undefined;

  constructor(material: PolygonMaterial) {
    this.clampToGround = material.clampToGround;
    this.tiled = material.tiled;
    this.receiveShadow = material.receiveShadow;
    this.castShadow = material.castShadow;
    this.color = material.color;
    this.extrudedHeight = material.extrudedHeight;
    this.height = material.height;
    this.show = material.show;

    this.perPositionHeight = material.perPositionHeight;
    this.extrusionBase = material.extrusionBase;

    this.wireframe = material.wireframe;
    this.outline = material.outline;
  }

  free(): void {}
}
