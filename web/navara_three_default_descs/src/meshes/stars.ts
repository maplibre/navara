import {
  EventHandler,
  STARS_ASSETS_URL,
  STARS_RENDER_ORDER,
} from "@navaramap/three";
import {
  StarsGeometry,
  StarsMaterial,
  type PrecomputedTextures,
} from "@takram/three-atmosphere";
import { Points, Matrix4, Vector3 } from "three";

export type StarsEvents = {
  needsUpdate: () => void;
};

export type StarsOptions = {
  visible?: boolean;
  pointSize?: number;
  intensity?: number;
  background?: boolean;
};

export const DEFAULT_STARS_OPTIONS: Required<StarsOptions> = {
  visible: true,
  pointSize: 1,
  intensity: 10,
  background: true,
};

export class Stars extends EventHandler<StarsEvents> {
  raw: Points<StarsGeometry, StarsMaterial>;
  options: Required<StarsOptions>;

  constructor(data: ArrayBuffer, options?: StarsOptions) {
    super();
    this.raw = new Points(
      new StarsGeometry(data),
      new StarsMaterial({ depthTest: true, depthWrite: false }),
    );
    // StarsMaterial overrides the constructor option; background stars must not occlude the sky.
    this.raw.material.depthWrite = false;
    this.raw.frustumCulled = false;
    this.raw.renderOrder = STARS_RENDER_ORDER;
    this.options = { ...DEFAULT_STARS_OPTIONS, ...(options ?? {}) };

    this.raw.material.pointSize = this.options.pointSize;
    this.raw.material.intensity = this.options.intensity;
    this.raw.material.background = this.options.background;
  }

  static fromUrl(url = STARS_ASSETS_URL, options?: StarsOptions) {
    const instance = new Stars(new ArrayBuffer(0), options);
    fetch(url)
      .then(async (r) => {
        const arrayBuffer = await r.arrayBuffer();
        if (!arrayBuffer) return;
        instance.raw.geometry.copy(new StarsGeometry(arrayBuffer));
      })
      .catch(console.error);
    return instance;
  }

  static async fromUrlAsync(url = STARS_ASSETS_URL, options?: StarsOptions) {
    const arrayBuffer = await fetch(url)
      .then((r) => r.arrayBuffer())
      .catch(console.error);
    if (!arrayBuffer) return;
    return new Stars(arrayBuffer, options);
  }

  setTextures(textures: Partial<PrecomputedTextures>) {
    Object.assign(this.raw.material, textures);
  }

  setRotationFromMatrix(matrix: Matrix4) {
    this.raw.setRotationFromMatrix(matrix);
  }

  updateSunDirection(sunDirection: Vector3) {
    this.raw.material.sunDirection.copy(sunDirection);
  }

  get visible() {
    return this.options.visible;
  }

  set visible(v: boolean) {
    this.options.visible = v;
    this.raw.visible = v;
    this.emit("needsUpdate");
  }

  get pointSize() {
    return this.options.pointSize;
  }
  set pointSize(v: number) {
    this.options.pointSize = v;
    this.raw.material.pointSize = v;
    this.emit("needsUpdate");
  }

  get intensity() {
    return this.options.intensity;
  }
  set intensity(v: number) {
    this.options.intensity = v;
    this.raw.material.intensity = v;
    this.emit("needsUpdate");
  }

  get background() {
    return this.options.background;
  }
  set background(v: boolean) {
    this.options.background = v;
    this.raw.material.background = v;
    this.emit("needsUpdate");
  }
}
