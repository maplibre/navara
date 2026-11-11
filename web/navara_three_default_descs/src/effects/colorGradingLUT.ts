import {
  blendFunction,
  type BlendMode,
  Effect,
  type EffectOptions,
} from "@navaramap/three";
import { LookupTexture, RawImageData, LUT3DEffect } from "postprocessing";
import { type Camera, TextureLoader } from "three";
import { LUT3dlLoader } from "three/examples/jsm/loaders/LUT3dlLoader.js";
import { LUTCubeLoader } from "three/examples/jsm/loaders/LUTCubeLoader.js";

export type ColorGradingLUTOptions = {
  /** URL of the LUT file to load, supported formats are .cube, .3dl, .png, .jpg, .jpeg
   *
   *  Example LUTs can be found at:
   *
   *  web/navara-three/example/helpers/constants.ts: LUT_DATASETS
   */
  url?: string;
  /** Blend mode of the effect. */
  blendMode?: BlendMode;
  /** Opacity of the effect. */
  opacity?: number;
} & EffectOptions;

export class ColorGradingLUT extends Effect<
  LUT3DEffect,
  ColorGradingLUTOptions
> {
  private static lutCubeLoader: LUTCubeLoader | undefined;
  private static lut3dlLoader: LUT3dlLoader | undefined;
  private static textureLoader: TextureLoader | undefined;
  /** A load that completes after dispose must not install its LUT. */
  private disposed = false;

  constructor(camera: Camera, options?: ColorGradingLUTOptions) {
    const lut = LookupTexture.createNeutral(8);
    const effect = new LUT3DEffect(lut);
    super(camera, effect, options);
    this.loadLUT(options?.url || "", effect);
  }

  private loadLUT(url: string, effect: LUT3DEffect) {
    if (url.length === 0) return;

    const urlPath = new URL(url).pathname;
    const extension = urlPath.split(".").pop()?.toLowerCase();

    if (extension === "cube") {
      if (!ColorGradingLUT.lutCubeLoader) {
        ColorGradingLUT.lutCubeLoader = new LUTCubeLoader();
      }
      ColorGradingLUT.lutCubeLoader.load(
        url,
        (t) => {
          if (this.disposed) {
            t.texture3D.dispose();
            return;
          }
          const lut = new LookupTexture(
            t.texture3D.image.data as ArrayBufferView,
            t.size,
          );
          lut.type = t.texture3D.type;
          lut.colorSpace = t.texture3D.colorSpace;
          lut.generateMipmaps = false;

          // Dispose the old LUT texture before assigning a new one
          if (effect.lut) {
            effect.lut.dispose();
          }

          effect.lut = lut;
          t.texture3D.dispose();
          this.emit("needsUpdate");
        },
        undefined,
        (err) => {
          console.error(`Failed to load LUT from ${url}:`, err);
        },
      );
    } else if (extension === "3dl") {
      if (!ColorGradingLUT.lut3dlLoader) {
        ColorGradingLUT.lut3dlLoader = new LUT3dlLoader();
      }
      ColorGradingLUT.lut3dlLoader.load(
        url,
        (t) => {
          if (this.disposed) {
            t.texture3D.dispose();
            return;
          }
          const lut = new LookupTexture(
            t.texture3D.image.data as ArrayBufferView,
            t.size,
          );
          lut.type = t.texture3D.type;
          lut.colorSpace = t.texture3D.colorSpace;
          lut.generateMipmaps = false;

          // Dispose the old LUT texture before assigning a new one
          if (effect.lut) {
            effect.lut.dispose();
          }

          effect.lut = lut;
          t.texture3D.dispose();
          this.emit("needsUpdate");
        },
        undefined,
        (err) => {
          console.error(`Failed to load LUT from ${url}:`, err);
        },
      );
    } else if (
      extension === "png" ||
      extension === "jpg" ||
      extension === "jpeg"
    ) {
      if (!ColorGradingLUT.textureLoader) {
        ColorGradingLUT.textureLoader = new TextureLoader();
      }
      ColorGradingLUT.textureLoader.load(
        url,
        (t) => {
          if (this.disposed) {
            t.dispose();
            return;
          }
          const { width, height } = t.image;
          // LUT size is cube root of pixel count
          // Image pixels = N^3 (one pixel per LUT entry)
          // Image is square, so: width * height = width^2 = N^3
          const size = Math.cbrt(width * height);

          // lut size must be integer to be valid
          if (Number.isInteger(size) === false) {
            console.error(`Invalid LUT texture size: ${width}x${height}`);
            t.dispose();
            return;
          }

          const { data } = RawImageData.from(t.image as unknown as ImageData);

          const lut = new LookupTexture(data, size);
          lut.type = t.type;
          lut.colorSpace = t.colorSpace;
          lut.generateMipmaps = false;

          // Dispose the old LUT texture before assigning a new one
          if (effect.lut) {
            effect.lut.dispose();
          }

          effect.lut = lut;
          t.dispose();
          this.emit("needsUpdate");
        },
        undefined,
        (err) => {
          console.error(`Failed to load LUT from ${url}:`, err);
        },
      );
    } else {
      console.warn(`Unsupported LUT file format: ${extension}`);
      return;
    }
  }

  set url(url: string) {
    if (!this.rawEffect) return;
    if (this.options?.url === url) return;

    this.options.url = url;
    this.loadLUT(url, this.rawEffect);
  }

  set blendMode(mode: BlendMode) {
    if (!this.rawEffect) return;
    if (this.options?.blendMode === mode) return;

    this.options.blendMode = mode;
    this.rawEffect.blendMode.blendFunction = blendFunction(mode);
    this.emit("needsUpdate");
  }

  set opacity(value: number) {
    if (!this.rawEffect) return;
    if (this.options?.opacity === value) return;

    this.options.opacity = value;
    this.rawEffect.blendMode.opacity.value = value;
    this.emit("needsUpdate");
  }

  dispose() {
    this.disposed = true;
    if (this.rawEffect && this.rawEffect.lut) {
      this.rawEffect.lut.dispose();
    }
    super.dispose();
  }

  protected onMounted(): void {
    if (!this.rawEffect) return;
    this.rawEffect.blendMode.blendFunction = blendFunction(
      this.options?.blendMode ?? "src",
    );
    this.rawEffect.blendMode.opacity.value = this.options?.opacity ?? 1.0;
  }
}
