import { EventHandler } from "@navaramap/core";
import { AmbientLight as AmbientLightImpl, Color } from "three";

export type AmbientLightEvents = {
  needsUpdate: () => void;
};

export type AmbientLightOptions = {
  color?: Color;
  /**
   * Intensity of the ambient light.
   *
   * Diffuse shading divides the lit result by π (the Lambert BRDF), so
   * without tone mapping an intensity of 1 renders a surface at about
   * 32% of its albedo. Set this to `Math.PI` in that setup to render
   * surfaces at their true albedo.
   * @default 1
   */
  intensity?: number;
};

const DEFAULT_AMBIENT_LIGHT_OPTIONS: Required<AmbientLightOptions> = {
  color: new Color(0xffffff),
  intensity: 1,
};

export class AmbientLight extends EventHandler<AmbientLightEvents> {
  raw: AmbientLightImpl;
  private options: AmbientLightOptions;

  constructor(options: AmbientLightOptions = {}) {
    super();

    this.options = { ...DEFAULT_AMBIENT_LIGHT_OPTIONS, ...options };

    this.raw = new AmbientLightImpl(this.options.color, this.options.intensity);
  }

  get color() {
    return this.raw.color;
  }
  set color(v: Color) {
    this.raw.color.copy(v);
    this.emit("needsUpdate");
  }

  get intensity() {
    return this.raw.intensity;
  }
  set intensity(v: number) {
    this.raw.intensity = v;
    this.emit("needsUpdate");
  }

  get visible() {
    return this.raw.visible;
  }
  set visible(v: boolean) {
    this.raw.visible = v;
    this.emit("needsUpdate");
  }
}
