import {
  AlwaysDepth,
  WebGLRenderer,
  WebGLRenderTarget,
  Mesh,
  PerspectiveCamera,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  Color,
  Scene,
  ShaderMaterial,
  Vector2,
  type Texture,
} from "three";

import { BufferView } from "../bufferView";
import { DrapedMesh } from "../mesh/DrapedMesh";
import { isPickableMesh, type PickableMesh } from "../mesh/pickableMesh";
import { TileScene } from "../scene";
import type { MeshCache } from "../type";
import type { RefThree } from "../uniforms";

export type PickHelperOptions = {
  debug: boolean;
};

/**
 * Writes the packed globe depth into the depth buffer, so draped meshes can
 * be stencil-clipped against the terrain as in the main pass.
 */
function createGlobeDepthScene(globeDepth: RefThree<Texture>): Scene {
  const material = new ShaderMaterial({
    uniforms: { tGlobeDepth: globeDepth },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D tGlobeDepth;
      void main() {
        vec2 uv = gl_FragCoord.xy / vec2(textureSize(tGlobeDepth, 0));
        gl_FragDepth = unpackRGBAToDepth(texture2D(tGlobeDepth, uv));
      }
    `,
    colorWrite: false,
    depthFunc: AlwaysDepth,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  return scene;
}

/**
 * Travel tolerance in CSS pixels between pointerdown and pointerup to count as a click.
 * Follows Cesium's `_clickPixelTolerance` (MapLibre uses 3px).
 * ref: https://github.com/CesiumGS/cesium/blob/9fda7ab97a762e40c74b1d0e1814c98a2de43337/packages/engine/Source/Core/ScreenSpaceEventHandler.js#L1012
 * ref: https://github.com/maplibre/maplibre-gl-js/blob/3a0a4f795fef5b2a29034d71833475589c344eaf/src/ui/map.ts#L542
 */
export const CLICK_PIXEL_TOLERANCE = 5;

/**
 * Travel tolerance for touch taps. Finger contact jitters far more than a
 * mouse, so follows MapLibre's tap `MAX_DIST` instead.
 * ref: https://github.com/maplibre/maplibre-gl-js/blob/3a0a4f795fef5b2a29034d71833475589c344eaf/src/ui/handler/tap_recognizer.ts
 */
export const TAP_PIXEL_TOLERANCE = 30;

export function isClickGesture(
  downPosition: Vector2,
  upPosition: Vector2,
  tolerance: number = CLICK_PIXEL_TOLERANCE,
): boolean {
  return downPosition.distanceTo(upPosition) < tolerance;
}

/**
 * Pick search radius in CSS pixels around the pointer. The pick reads a
 * (2r+1)² window and takes the non-zero batch id closest to its center, so
 * small features (points, thin lines) don't demand pixel-perfect aim.
 */
export const PICK_RADIUS = 3;

/** Pick search radius for touch: fingertips land less precisely than a cursor. */
export const TOUCH_PICK_RADIUS = 10;

/**
 * GPU picking using a dedicated render pass over a small search window.
 *
 * The pick pass does NOT reuse the main render pipeline (globe / MRT /
 * draped / copy passes). Instead, every pickable raw — regardless of
 * which pass scene (opaque, mrt, ...) it normally lives in — is
 * temporarily re-parented into a dedicated `pickScene` for the render
 * and then restored to its original parent afterwards. This guarantees
 * the pick buffer contains exactly the pickable content and nothing
 * else can leak in (globe tiles, outlines, draped features, sky, etc.).
 *
 * Re-parenting is safe because pass scenes all have identity world
 * transforms, so world matrices of the re-parented objects are
 * unaffected.
 *
 * Two gestures trigger a pick: a click or touch tap (pointerdown/pointerup
 * within {@link CLICK_PIXEL_TOLERANCE} / {@link TAP_PIXEL_TOLERANCE}) and
 * hovering, throttled to at most one pick per animation frame. Both are
 * lazy: a pick runs only while the matching `shouldClickPick` /
 * `shouldHoverPick` gate returns true (i.e. someone is listening for the
 * result). The gestures are detected from pointer events, which fire for
 * touch as well. The camera-input handlers call `preventDefault()` on
 * touch events, so the compatibility mouse events never do.
 */
export class PickHelper {
  private element: HTMLElement;
  private pixelBuffer: Uint8Array;
  private _renderer: WebGLRenderer;
  private _camera: PerspectiveCamera;
  private _meshes: MeshCache;
  private onPickCallback: (pickArr: number[]) => void;

  /** Dedicated scene used only during the pick render. */
  private readonly pickScene = new Scene();
  /** The terrain tiles, drawn before the draped pickables. */
  private readonly groundScene = new Scene();
  /** The main pass's globe scene, which holds the terrain tiles. */
  private readonly globeScene: Scene;
  /** Holds one draped pickable at a time for its stencil passes. */
  private readonly drapedScene = new Scene();
  private readonly globeDepthScene: Scene;

  private debugBufferView?: BufferView;
  private debugRenderTarget?: WebGLRenderTarget;
  /** Full-size render target used for click picking with scissor restriction. */
  private pickRenderTarget: WebGLRenderTarget;

  private onHoverCallback: (pickArr: number[]) => void;
  /** Click picks run only while this returns true (e.g. featureClick listeners exist). */
  private shouldClickPick: () => boolean;
  /** Hover picks run only while this returns true (e.g. hover listeners exist). */
  private shouldHoverPick: () => boolean;

  private pointerDownPosition?: Vector2;
  private pointerDownHandler: (event: PointerEvent) => void;
  private pointerUpHandler: (event: PointerEvent) => void;
  private pointerCancelHandler: () => void;
  private hoverMoveHandler: (event: PointerEvent) => void;
  private hoverLeaveHandler: () => void;
  /** Latest pointermove position awaiting a hover pick, in client coords. */
  private hoverPosition?: Vector2;
  private hoverRafId?: number;

  constructor(
    element: HTMLElement,
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
    meshes: MeshCache,
    onPickCallback: (pickArr: number[]) => void,
    onHoverCallback: (pickArr: number[]) => void,
    shouldClickPick: () => boolean,
    shouldHoverPick: () => boolean,
    globeDepth: RefThree<Texture>,
    globeScene: Scene,
    options?: PickHelperOptions,
  ) {
    this.element = element;
    this.pixelBuffer = new Uint8Array(4);
    this._renderer = renderer;
    this._camera = camera;
    this._meshes = meshes;
    this.onPickCallback = onPickCallback;
    this.onHoverCallback = onHoverCallback;
    this.shouldClickPick = shouldClickPick;
    this.shouldHoverPick = shouldHoverPick;
    this.globeDepthScene = createGlobeDepthScene(globeDepth);
    this.globeScene = globeScene;

    this.pointerDownHandler = (event: PointerEvent) =>
      this.onPointerDown(event);
    this.pointerUpHandler = (event: PointerEvent) => this.onPointerUp(event);
    this.pointerCancelHandler = () => this.onPointerCancel();
    this.hoverMoveHandler = (event: PointerEvent) =>
      this.onHoverPointerMove(event);
    this.hoverLeaveHandler = () => this.onHoverPointerLeave();

    const width = this._renderer.getContext().drawingBufferWidth;
    const height = this._renderer.getContext().drawingBufferHeight;

    this.pickRenderTarget = new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      depthBuffer: true,
      stencilBuffer: true,
    });

    if (options?.debug) {
      this.debugBufferView = new BufferView(width, height);
      this.debugRenderTarget = new WebGLRenderTarget(width, height, {
        format: RGBAFormat,
        depthBuffer: true,
        stencilBuffer: true,
      });
    }
  }

  private onPointerDown(event: PointerEvent) {
    // A second concurrent pointer (e.g. the pinch-zoom finger) turns the
    // gesture into something other than a tap; abandon the pending click.
    if (!event.isPrimary) {
      this.pointerDownPosition = undefined;
      return;
    }
    this.pointerDownPosition = new Vector2(event.clientX, event.clientY);
  }

  private onPointerUp(event: PointerEvent) {
    if (!event.isPrimary) return;

    const downPosition = this.pointerDownPosition;
    this.pointerDownPosition = undefined;
    if (!downPosition) return;

    // Skip the GPU pick entirely when nobody is listening for the result.
    if (!this.shouldClickPick()) return;

    const tolerance =
      event.pointerType === "touch"
        ? TAP_PIXEL_TOLERANCE
        : CLICK_PIXEL_TOLERANCE;
    if (
      isClickGesture(
        downPosition,
        new Vector2(event.clientX, event.clientY),
        tolerance,
      )
    ) {
      this.onClickPick(event);
    }
  }

  /** The browser took over the gesture (scroll, app switch): not a click. */
  private onPointerCancel() {
    this.pointerDownPosition = undefined;
  }

  enablePick(bPick: boolean) {
    if (bPick) {
      this.element.addEventListener("pointerdown", this.pointerDownHandler);
      this.element.addEventListener("pointerup", this.pointerUpHandler);
      this.element.addEventListener("pointercancel", this.pointerCancelHandler);
      this.element.addEventListener("pointermove", this.hoverMoveHandler);
      this.element.addEventListener("pointerleave", this.hoverLeaveHandler);
    } else {
      this.element.removeEventListener("pointerdown", this.pointerDownHandler);
      this.element.removeEventListener("pointerup", this.pointerUpHandler);
      this.element.removeEventListener(
        "pointercancel",
        this.pointerCancelHandler,
      );
      this.element.removeEventListener("pointermove", this.hoverMoveHandler);
      this.element.removeEventListener("pointerleave", this.hoverLeaveHandler);
      this.cancelPendingHoverPick();
    }
  }

  /**
   * Hover picking: schedules at most one GPU pick per animation frame from
   * the latest pointermove position. Suppressed while any button is pressed
   * (Camera drags would otherwise trigger a pick per frame. For touch,
   * contact itself sets `buttons`, so touch never hover-picks) and while
   * `shouldHoverPick` returns false, so pages without hover listeners pay
   * nothing.
   */
  private onHoverPointerMove(event: PointerEvent) {
    if (event.buttons !== 0 || !this.shouldHoverPick()) return;

    if (!this.hoverPosition) this.hoverPosition = new Vector2();
    this.hoverPosition.set(event.clientX, event.clientY);

    if (this.hoverRafId !== undefined) return;
    this.hoverRafId = requestAnimationFrame(() => {
      this.hoverRafId = undefined;
      const position = this.hoverPosition;
      if (!position) return;
      this.hoverPosition = undefined;

      // Listeners may have been removed between the pointermove that
      // scheduled this frame and now. Re-check so no orphan pick runs.
      if (!this.shouldHoverPick()) return;

      const batchId = this.pickBatchIdAt(position.x, position.y);
      this.onHoverCallback(batchId > 0 ? [batchId] : []);
    });
  }

  private onHoverPointerLeave() {
    this.cancelPendingHoverPick();
    // Report "nothing hovered" so diff-based enter/leave synthesis can
    // close out the current hover when the cursor exits the canvas.
    if (this.shouldHoverPick()) {
      this.onHoverCallback([]);
    }
  }

  private cancelPendingHoverPick() {
    if (this.hoverRafId !== undefined) {
      cancelAnimationFrame(this.hoverRafId);
      this.hoverRafId = undefined;
    }
    this.hoverPosition = undefined;
  }

  /**
   * Moves every pickable raw (visible, currently parented) into the
   * dedicated `pickScene` and activates the picking uniforms on its
   * wrapper. Terrain tiles go to `groundScene` instead, and draped meshes
   * are returned, to be stencil-clipped between the two. `teardown` restores
   * original parents and deactivates the uniforms.
   */
  private stagePickables(pickingCoord?: Vector2): {
    teardown: () => void;
    draped: [DrapedMesh, Object3D][];
  } {
    const restoreParents: [Object3D, Object3D][] = [];
    const activated: PickableMesh[] = [];
    const draped: [DrapedMesh, Object3D][] = [];

    for (const [_key, obj] of this._meshes) {
      if (!isPickableMesh(obj)) continue;

      const raw = obj.getRenderable();
      const originalParent = raw.parent;

      // Only pick visible, currently-parented renderables. A mesh that's
      // hidden or detached isn't rendered in the main view, so picking
      // it would be surprising.
      if (!originalParent || !raw.visible) continue;

      obj.onBeforePicking(pickingCoord);
      activated.push(obj);

      // Draped vector-tile meshes live inside a TileScene and are picked
      // through their owning TileMesh's composite atlas — the per-layer RT
      // is re-rendered with pick mode active (the onBeforePicking above
      // flipped the mesh's own enhancer into pick mode) and the atlas then
      // carries the pick IDs into the main pick render. Reparenting them
      // here would (a) empty the TileScene so the per-layer RT renders
      // nothing and (b) make them draw at their un-draped 3D position in
      // pickScene, where they depth-fight with the terrain.
      if (originalParent instanceof TileScene) continue;

      // Drawn as is, the stencil volume would be pickable over its whole
      // height range rather than where it meets the ground.
      if (raw instanceof DrapedMesh && raw.enabled()) {
        draped.push([raw, originalParent]);
        continue;
      }

      if (originalParent === this.globeScene) {
        this.groundScene.add(raw);
        restoreParents.push([raw, originalParent]);
        continue;
      }

      // Scene.add auto-removes from the previous parent. Both parents
      // are pass scenes with identity world transforms, so the raw's
      // world matrix is unaffected.
      this.pickScene.add(raw);
      restoreParents.push([raw, originalParent]);
    }

    return {
      teardown: () => {
        for (const [raw, parent] of restoreParents) parent.add(raw);
        for (const w of activated) w.onAfterPicking();
      },
      draped,
    };
  }

  /**
   * Draws each draped pickable where its volume meets the globe, then puts
   * back the depth of the pickable terrain alone, so the remaining pickables
   * are occluded the same with or without draped ones.
   */
  private renderDraped(draped: readonly [DrapedMesh, Object3D][]) {
    this._renderer.clear(false, true, true);
    this._renderer.render(this.globeDepthScene, this._camera);

    for (const [mesh, parent] of draped) {
      this.drapedScene.add(mesh);
      mesh.process(() => this._renderer.render(this.drapedScene, this._camera));
      parent.add(mesh);
    }

    this._renderer.clear(false, true, true);
    if (this.groundScene.children.length > 0) {
      // Locked, since every material sets its own `colorWrite`.
      const colorBuffer = this._renderer.state.buffers.color;
      colorBuffer.setMask(false);
      colorBuffer.setLocked(true);
      this._renderer.render(this.groundScene, this._camera);
      colorBuffer.setLocked(false);
      colorBuffer.setMask(true);
    }
  }

  /**
   * Dedicated picking render: clears the target to black (batchId=0) and
   * renders only the pickable raws, regardless of which pass scene they
   * normally live in.
   */
  public processRender(target: WebGLRenderTarget, pickingCoord?: Vector2) {
    const origClearColor = new Color();
    this._renderer.getClearColor(origClearColor);
    const origClearAlpha = this._renderer.getClearAlpha();
    const origRenderTarget = this._renderer.getRenderTarget();
    const origAutoClear = this._renderer.autoClear;

    const { teardown, draped } = this.stagePickables(pickingCoord);

    this._renderer.setClearColor(0x000000, 1);
    this._renderer.setRenderTarget(target);
    // Terrain, then draped, then the rest, as in the main pass: a draped
    // mesh draws without a depth test, so it must cover the terrain but come
    // before the pickables that stand in front of it.
    this._renderer.autoClear = false;
    this._renderer.clear(true, true, true);
    if (this.groundScene.children.length > 0) {
      this._renderer.render(this.groundScene, this._camera);
    }
    if (draped.length > 0) {
      this.renderDraped(draped);
    }
    this._renderer.render(this.pickScene, this._camera);

    teardown();

    this._renderer.setRenderTarget(origRenderTarget);
    this._renderer.setClearColor(origClearColor, origClearAlpha);
    this._renderer.autoClear = origAutoClear;
  }

  public setSize(width: number, height: number) {
    this.pickRenderTarget.setSize(width, height);
    this.debugRenderTarget?.setSize(width, height);
    if (this.debugBufferView) {
      this.debugBufferView.canvas.width = width;
      this.debugBufferView.canvas.height = height;
      this.debugBufferView.canvasForImage.width = width;
      this.debugBufferView.canvasForImage.height = height;
    }
  }

  public renderDebugCanvas() {
    if (!this.debugBufferView || !this.debugRenderTarget) return;

    // Full-screen debug view: no view-offset so we can see everything.
    this.processRender(this.debugRenderTarget);
    this.debugBufferView.render(this._renderer, this.debugRenderTarget);
  }

  private onClickPick(event: PointerEvent) {
    const radius =
      event.pointerType === "touch" ? TOUCH_PICK_RADIUS : PICK_RADIUS;
    const batchId = this.pickBatchIdAt(event.clientX, event.clientY, radius);
    const pickArr = batchId > 0 ? [batchId] : [];
    this.onPickCallback(pickArr);
  }

  /**
   * Runs the pick render in a search window around the given client
   * coordinates and returns the non-zero batch ID closest to its center
   * (0 when nothing pickable is inside the window).
   */
  private pickBatchIdAt(
    clientX: number,
    clientY: number,
    radiusCss: number = PICK_RADIUS,
  ): number {
    const rect = this.element.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const pixelRatio = this._renderer.getPixelRatio();
    const fullWidth = this._renderer.getContext().drawingBufferWidth;
    const fullHeight = this._renderer.getContext().drawingBufferHeight;

    // gl_FragCoord-style pixel-space coords (centers at 0.5, 1.5, ...).
    // Clamp to valid viewport bounds.
    const pixelX = Math.max(
      0,
      Math.min(Math.floor(x * pixelRatio), fullWidth - 1),
    );
    const pixelY = Math.max(
      0,
      Math.min(Math.floor(y * pixelRatio), fullHeight - 1),
    );
    const pickingCoord = new Vector2(
      pixelX + 0.5,
      fullHeight - pixelY - 0.5, // flip Y for WebGL
    );
    const readY = fullHeight - 1 - pixelY;

    // The search window in device pixels, clamped to the viewport.
    const radius = Math.max(0, Math.round(radiusCss * pixelRatio));
    const minX = Math.max(0, pixelX - radius);
    const maxX = Math.min(fullWidth - 1, pixelX + radius);
    const minY = Math.max(0, readY - radius);
    const maxY = Math.min(fullHeight - 1, readY + radius);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;

    // Keep the camera projection unchanged for wide lines / screen-space
    // expanded shaders, and limit fragment work to the window via scissor.
    this._renderer.setScissor(minX, minY, width, height);
    this._renderer.setScissorTest(true);

    this.processRender(this.pickRenderTarget, pickingCoord);

    if (this.pixelBuffer.length < width * height * 4) {
      this.pixelBuffer = new Uint8Array(width * height * 4);
    }
    this._renderer.readRenderTargetPixels(
      this.pickRenderTarget,
      minX,
      minY,
      width,
      height,
      this.pixelBuffer,
    );

    this._renderer.setScissorTest(false);

    // The non-zero batch id nearest to the pointer wins, so a small feature
    // beside a large one is still pickable by aiming at it.
    let bestId = 0;
    let bestDistSq = Infinity;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const i = (row * width + col) * 4;
        const id =
          (this.pixelBuffer[i] << 16) +
          (this.pixelBuffer[i + 1] << 8) +
          this.pixelBuffer[i + 2];
        if (id === 0) continue;
        const dx = minX + col - pixelX;
        const dy = minY + row - readY;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestId = id;
        }
      }
    }
    return bestId;
  }

  public dispose() {
    this.enablePick(false);
    this.pickRenderTarget.dispose();
    this.debugRenderTarget?.dispose();
    this.debugBufferView?.dispose();
  }
}
