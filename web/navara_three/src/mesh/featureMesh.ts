import { Unimplemented } from "@navaramap/core";
import type { Color, Material } from "three";

export class FeatureMesh {
  _setFeatureColor(_color: Color, _material?: Material) {
    throw new Unimplemented();
  }
  _getFeatureColor(): Color {
    throw new Unimplemented();
  }
  _setFeatureShow(_visible: boolean) {
    throw new Unimplemented();
  }
  _setFeatureHeight(_height: number) {
    throw new Unimplemented();
  }
  _setFeatureOpacity(_opacity: number) {
    throw new Unimplemented();
  }
  _setFrustumCulled(_culled: boolean) {
    throw new Unimplemented();
  }
}

export const isFeatureMesh = (v: object): v is FeatureMesh => {
  return (
    "_setFeatureColor" in v &&
    "_getFeatureColor" in v &&
    "_setFeatureShow" in v &&
    "_setFeatureHeight" in v &&
    "_setFeatureOpacity" in v &&
    "_setFrustumCulled" in v
  );
};
