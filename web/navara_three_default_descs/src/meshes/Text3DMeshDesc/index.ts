import type ThreeView from "@navaramap/three";
import {
  MeshDescWithSelectiveEffect,
  setupSelectiveEffectUniforms,
  type Color,
  type MeshConfigWithSelectiveEffect,
  type MeshUpdateWithSelectiveEffect,
  type ViewContext,
} from "@navaramap/three";
import { Mesh, MeshLambertMaterial, type ExtrudeGeometry } from "three";
import invariant from "tiny-invariant";

import { loadTextFont, type TextFont } from "./font";
import {
  TEXT_GEOMETRY_KEYS,
  createTextGeometry,
  type TextGeometryOptions,
} from "./geometry";

type Text3DOptions = TextGeometryOptions & {
  color?: Color;
  /** Color of the sides between the front and the back. Defaults to `color`. */
  sideColor?: Color;
  emissiveColor?: Color;
  /** Emissive color of the sides. Defaults to `emissiveColor`. */
  sideEmissiveColor?: Color;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  effectIds?: string[];
};

export type Text3DMeshConfig = MeshConfigWithSelectiveEffect & {
  text3D?: Text3DOptions & {
    /** URL of a TTF font file or of a three.js typeface.json font. */
    font: string;
  };
};

export type Text3DMeshUpdate = MeshUpdateWithSelectiveEffect & {
  text3D?: Partial<Text3DOptions> & {
    /**
     * Loads another font. The text keeps the current font until it loads; when
     * several are requested, the last one wins.
     */
    font?: string;
  };
};

export type Text3DMeshEvent = {
  /** Emitted each time a font has loaded and the text is displayed with it. */
  load: () => void;
  /** Emitted when fetching or reading a font fails. */
  error: (error: unknown) => void;
  needsUpdate: () => void;
};

/** The front and back faces, then the sides (bevel included). */
type Text3DMaterials = [faces: MeshLambertMaterial, sides: MeshLambertMaterial];

type Text3DMesh = Mesh<ExtrudeGeometry, Text3DMaterials>;

/** The entries of `patch` that are set: `undefined` leaves an option as is. */
function definedOnly<T extends object>(patch: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in patch) {
    if (patch[key] !== undefined) result[key] = patch[key];
  }
  return result;
}

function applyStyle(mesh: Text3DMesh, options: Text3DOptions): void {
  const [faces, sides] = mesh.material;
  const { color, emissiveColor } = options;
  faces.color.set(color?.raw ?? 0xffffff);
  sides.color.set((options.sideColor ?? color)?.raw ?? 0xffffff);
  faces.emissive.set(emissiveColor?.raw ?? 0x000000);
  sides.emissive.set(
    (options.sideEmissiveColor ?? emissiveColor)?.raw ?? 0x000000,
  );

  const transparent = options.transparent ?? false;
  for (const material of mesh.material) {
    material.emissiveIntensity = options.emissiveIntensity ?? 0;
    material.opacity = options.opacity ?? 1;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.needsUpdate = true;
    }
  }

  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
}

/**
 * Extruded 3D text. The text stands upright on its placement: it reads along
 * the frame's +X, its bottom center sits on the origin and its front faces
 * +Z, so under `geodetic` the front faces `heading`.
 */
export class Text3DMeshDesc extends MeshDescWithSelectiveEffect<
  Text3DMeshConfig,
  Text3DMeshUpdate,
  Text3DMesh,
  Text3DMeshEvent
> {
  /** The last requested font. */
  private fontUrl: string;
  /** The last requested font failed, so requesting it again retries it. */
  private fontFailed = false;
  /** Resolves the wait of `onCreate` after its font failed. */
  private fontRequested?: () => void;
  private options: Text3DOptions;
  private font?: TextFont;
  /** The URL `font` was loaded from. */
  private fontLoadedUrl?: string;
  /** Built by `onCreate` to verify the font; `createMesh` takes it. */
  private pendingGeometry?: ExtrudeGeometry;

  constructor(view: ThreeView, ctx: ViewContext, config: Text3DMeshConfig) {
    const { text3D } = config;
    if (!text3D) {
      throw new Error("Text3DMesh configuration is required");
    }
    // Propagate initial effectIds to base MeshDesc
    super(
      view,
      ctx,
      text3D.effectIds ? { ...config, effectIds: text3D.effectIds } : config,
    );
    const { font, ...options } = text3D;
    this.fontUrl = font;
    this.options = options;
  }

  /**
   * Async (see `BaseDesc.onCreate`): the mesh is created once the font has
   * loaded. When the font fails, `error` is emitted and creation waits for
   * another font from `update()`.
   */
  override async onCreate(): Promise<void> {
    for (;;) {
      const url = this.fontUrl;
      let font: TextFont | undefined;
      let geometry: ExtrudeGeometry | undefined;
      try {
        font = await loadTextFont(url);
        // Another font was requested meanwhile: load that one instead.
        if (!this.destroyed && url === this.fontUrl) {
          geometry = createTextGeometry(font, this.options);
        }
      } catch (error) {
        if (this.destroyed) return;
        if (url === this.fontUrl) {
          // Set before `error` is emitted: its handler may request a font.
          const requested = new Promise<void>((resolve) => {
            this.fontRequested = resolve;
          });
          this.failFont(error);
          await requested;
        }
      }
      // Deleted while the font was loading — don't create anything.
      if (this.destroyed) return;
      if (font && geometry && url === this.fontUrl) {
        this.font = font;
        this.fontLoadedUrl = url;
        this.pendingGeometry = geometry;
        break;
      }
    }
    super.onCreate();
    this.emit("load");
  }

  createMesh(): Text3DMesh {
    const geometry = this.pendingGeometry ?? this.buildGeometry(this.options);
    this.pendingGeometry = undefined;
    const materials: Text3DMaterials = [
      new MeshLambertMaterial(),
      new MeshLambertMaterial(),
    ];

    const mesh = new Mesh(geometry, materials);
    applyStyle(mesh, this.options);

    for (const material of materials) {
      setupSelectiveEffectUniforms(material);
      // Emit CSM event for shadow map integration
      this.ctx.applyShadowMaterial(material);
    }
    return mesh;
  }

  /** The base class sets the mask on a single material; this mesh has two. */
  protected override updateEffectIdsMask(): void {
    const mask =
      this._effectIds.length > 0
        ? this.ctx.selectiveEffectRegistry.computeMask(this._effectIds)
        : 0;
    for (const material of this._instance?.material ?? []) {
      material.userData.uEffectIdsMask.value = mask;
    }
  }

  private async reloadFont(url: string): Promise<void> {
    let font: TextFont;
    try {
      font = await loadTextFont(url);
    } catch (error) {
      if (!this.destroyed && url === this.fontUrl) this.failFont(error);
      return;
    }
    if (this.destroyed || url !== this.fontUrl) return;
    const mesh = this._instance;
    invariant(
      mesh,
      "Text3DMeshDesc: a font reloads only after the mesh exists",
    );
    let geometry: ExtrudeGeometry;
    try {
      geometry = createTextGeometry(font, this.options);
    } catch (error) {
      this.failFont(error);
      return;
    }
    this.replaceGeometry(mesh, geometry);
    this.font = font;
    this.fontLoadedUrl = url;
    this.requestUpdate();
    this.emit("load");
  }

  private failFont(error: unknown): void {
    this.fontFailed = true;
    console.error("Text3DMeshDesc: the font could not be used:", error);
    this.emit("error", error);
  }

  private replaceGeometry(mesh: Text3DMesh, geometry: ExtrudeGeometry): void {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  private buildGeometry(options: Text3DOptions): ExtrudeGeometry {
    invariant(this.font, "Text3DMeshDesc: the font loads before the mesh");
    return createTextGeometry(this.font, options);
  }

  override onUpdateConfig(updates: Text3DMeshUpdate): void {
    const patch = updates.text3D;
    if (!patch) {
      super.onUpdateConfig(updates);
      return;
    }

    // The base class validates the transform first: its throw leaves this
    // descriptor as it was.
    super.onUpdateConfig(
      patch.effectIds === undefined
        ? updates
        : { ...updates, effectIds: patch.effectIds },
    );

    const { font, ...optionsPatch } = patch;
    const current = this.options;
    const next = { ...current, ...definedOnly(optionsPatch) };
    // Before the font has loaded there is no mesh: `onCreate` builds it from
    // the options stored here.
    const mesh = this._instance;
    if (mesh) {
      if (TEXT_GEOMETRY_KEYS.some((key) => next[key] !== current[key])) {
        // Built before the old geometry is released, so a throw changes nothing.
        this.replaceGeometry(mesh, this.buildGeometry(next));
      }
      applyStyle(mesh, next);
    }
    this.options = next;

    if (font !== undefined && (font !== this.fontUrl || this.fontFailed)) {
      this.fontUrl = font;
      this.fontFailed = false;
      // Back to the displayed font: the pending load is dropped, nothing is fetched.
      if (font === this.fontLoadedUrl) return;
      // Before the mesh exists, `onCreate` picks up the new URL itself.
      if (mesh) void this.reloadFont(font);
      else this.fontRequested?.();
    }
  }

  override onDestroy(): void {
    // Ends the wait of `onCreate`, which then sees `destroyed`.
    this.fontRequested?.();
    // Must run before `super.onDestroy()`, which detaches `raw` from its
    // scene and then clears `_instance`.
    const mesh = this._instance;
    if (mesh) {
      mesh.geometry.dispose();
      for (const material of mesh.material) {
        this.ctx.removeShadowMaterial(material);
        material.dispose();
      }
    }
    super.onDestroy();
  }
}
