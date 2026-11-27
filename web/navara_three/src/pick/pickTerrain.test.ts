import {
  type Mesh,
  PerspectiveCamera,
  type Scene,
  type ShaderMaterial,
  Texture,
  Vector2,
  type WebGLRenderer,
} from "three";
import { describe, expect, it } from "vitest";

import { TerrainPicker } from "./pickTerrain";

const CSS_WIDTH = 800;
const CSS_HEIGHT = 600;
const PIXEL_RATIO = 2;

/**
 * Renderer stub for a canvas whose top-left corner sits at `rect` in client
 * coordinates (`rect: undefined` stands for an OffscreenCanvas). Records the
 * sample position of each depth pick render; every readback returns a
 * reversed depth of 0.5.
 */
const createRendererStub = (rect?: { left: number; top: number }) => {
  const samples: Vector2[] = [];
  const fillDepth = (pixels: Float32Array) => {
    pixels[0] = 0.5;
    return pixels;
  };
  const renderer = {
    domElement: rect
      ? {
          getBoundingClientRect: () => ({
            ...rect,
            width: CSS_WIDTH,
            height: CSS_HEIGHT,
          }),
        }
      : {},
    getContext: () => ({
      drawingBufferWidth: CSS_WIDTH * PIXEL_RATIO,
      drawingBufferHeight: CSS_HEIGHT * PIXEL_RATIO,
    }),
    getPixelRatio: () => PIXEL_RATIO,
    setRenderTarget: () => {},
    render: (scene: Scene) => {
      const material = (scene.children[0] as Mesh).material as ShaderMaterial;
      samples.push(material.uniforms.samplePos.value.clone());
    },
    readRenderTargetPixels: (
      _target: unknown,
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      pixels: Float32Array,
    ) => fillDepth(pixels),
    readRenderTargetPixelsAsync: async (
      _target: unknown,
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      pixels: Float32Array,
    ) => fillDepth(pixels),
  };
  return { renderer: renderer as unknown as WebGLRenderer, samples };
};

const createCamera = () => {
  const camera = new PerspectiveCamera(60, CSS_WIDTH / CSS_HEIGHT, 1, 1e7);
  camera.position.set(1, 2, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
};

// x/y are client coordinates
// (MouseEvent.clientX/clientY), so the picked texel is the one under the
// pointer wherever the canvas sits on the page.
describe("TerrainPicker client coordinates", () => {
  const offset = { left: 300, top: 50 };
  const points = [
    [0, 0],
    [123.4, 456.7],
    [CSS_WIDTH - 1, CSS_HEIGHT - 1],
  ];

  it("picks the same texel and position on an offset canvas", () => {
    const camera = createCamera();
    const depth = new Texture();
    const atOrigin = createRendererStub({ left: 0, top: 0 });
    const offsetCanvas = createRendererStub(offset);
    const picker = new TerrainPicker("reversed");

    for (const [x, y] of points) {
      const expected = picker.pick(x, y, atOrigin.renderer, depth, camera);
      const actual = picker.pick(
        offset.left + x,
        offset.top + y,
        offsetCanvas.renderer,
        depth,
        camera,
      );
      expect(actual).not.toBeNull();
      expect(actual).toEqual(expected);
    }
    expect(offsetCanvas.samples).toEqual(atOrigin.samples);
  });

  it("picks the same texel and position on an offset canvas (async)", async () => {
    const camera = createCamera();
    const depth = new Texture();
    const atOrigin = createRendererStub({ left: 0, top: 0 });
    const offsetCanvas = createRendererStub(offset);
    const picker = new TerrainPicker("reversed");

    for (const [x, y] of points) {
      const expected = await picker.pickAsync(
        x,
        y,
        atOrigin.renderer,
        depth,
        camera,
      );
      const actual = await picker.pickAsync(
        offset.left + x,
        offset.top + y,
        offsetCanvas.renderer,
        depth,
        camera,
      );
      expect(actual).not.toBeNull();
      expect(actual).toEqual(expected);
    }
    expect(offsetCanvas.samples).toEqual(atOrigin.samples);
  });

  it("takes coordinates as canvas-relative on a canvas without a client rect", () => {
    const camera = createCamera();
    const depth = new Texture();
    const atOrigin = createRendererStub({ left: 0, top: 0 });
    const offscreen = createRendererStub();
    const picker = new TerrainPicker("reversed");

    for (const [x, y] of points) {
      expect(picker.pick(x, y, offscreen.renderer, depth, camera)).toEqual(
        picker.pick(x, y, atOrigin.renderer, depth, camera),
      );
    }
    expect(offscreen.samples).toEqual(atOrigin.samples);
  });
});
