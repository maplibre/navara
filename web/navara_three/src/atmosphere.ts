import { EventHandler, Observed, type XYZ } from "@navaramap/core";
import { exaggerateTerrainHeight } from "@navaramap/engine";
import {
  getECIToECEFRotationMatrix,
  getMoonDirectionECEF,
  getSunDirectionECEF,
  IRRADIANCE_TEXTURE_HEIGHT,
  IRRADIANCE_TEXTURE_WIDTH,
  SCATTERING_TEXTURE_DEPTH,
  SCATTERING_TEXTURE_HEIGHT,
  SCATTERING_TEXTURE_WIDTH,
  TRANSMITTANCE_TEXTURE_HEIGHT,
  TRANSMITTANCE_TEXTURE_WIDTH,
  type AtmosphereOverlay,
  type AtmosphereShadow,
  type AtmosphereShadowLength,
  type PrecomputedTextures,
} from "@takram/three-atmosphere";
import {
  Ellipsoid,
  EXR3DTextureLoader,
  EXRTextureLoader,
} from "@takram/three-geospatial";
import {
  LinearFilter,
  Matrix4,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from "three";

import { type ThreeViewCamera } from "./camera";
import { ATMOSPHERE_TEXTURE_URLS, STBN_URL } from "./constants";
import {
  dateForSolarTime,
  getSolarTime as solarTimeAt,
  getSunElevation as sunElevationAt,
  shiftDateToElevation,
  shiftDateToHourAngle,
} from "./solar";
import {
  IDENTITY_TERRAIN_EXAGGERATION,
  type TerrainExaggeration,
} from "./terrain/exaggeration";

/**
 * Events emitted by the {@link Atmosphere} class.
 */
export type AtmosphereEvents = {
  /** Emitted when the atmosphere needs to trigger a re-render. */
  needsUpdate: () => void;
  /** Emitted each time a precomputed atmosphere texture finishes loading. */
  textureLoaded: () => void;
  /** Emitted when the atmosphere is disposed. */
  disposed: () => void;
  /** Emitted when the sun direction changes. */
  sunChanged: (sunDirection: Vector3) => void;
};

/**
 * Names of the precomputed atmosphere textures that can be loaded
 * individually.
 */
export type AtmosphereTextureName =
  "transmittance" | "scattering" | "irradiance" | "higherOrderScattering";

/**
 * Which precomputed textures a consumer needs, e.g.
 * `{ transmittance: true }`. Only `true` is allowed as a value so that every
 * listed texture is guaranteed to be loaded.
 */
export type AtmosphereTextureNeeds = Partial<
  Record<AtmosphereTextureName, true>
>;

const ATMOSPHERE_TEXTURE_KEYS = {
  transmittance: "transmittanceTexture",
  scattering: "scatteringTexture",
  irradiance: "irradianceTexture",
  higherOrderScattering: "higherOrderScatteringTexture",
} as const satisfies Record<AtmosphereTextureName, keyof PrecomputedTextures>;

const ATMOSPHERE_TEXTURE_FILES: Record<AtmosphereTextureName, string> = {
  transmittance: "transmittance.exr",
  scattering: "scattering.exr",
  irradiance: "irradiance.exr",
  higherOrderScattering: "higher_order_scattering.exr",
};

const ALL_ATMOSPHERE_TEXTURE_NAMES = Object.keys(
  ATMOSPHERE_TEXTURE_KEYS,
) as AtmosphereTextureName[];

type TextureImageData = { data: ArrayBufferView | null };

/** Textures whose CPU data is dropped once uploaded to the GPU. */
const CPU_RELEASED_TEXTURE_NAMES: readonly AtmosphereTextureName[] = [
  "scattering",
  "higherOrderScattering",
];

/**
 * Retries of a failed re-fetch after a context restore. The first waits 1 s and
 * each next one twice as long (31 s in all).
 */
const MAX_RELOAD_RETRIES = 5;

/** A re-fetch of a released texture; `timer` is set while it waits to retry. */
type Reload = { attempt: number; timer?: ReturnType<typeof setTimeout> };

/**
 * The textures guaranteed to be present in an {@link Atmosphere.onTexturesReady}
 * callback for a given needs declaration.
 */
export type LoadedAtmosphereTextures<N extends AtmosphereTextureNeeds> =
  Required<
    Pick<
      PrecomputedTextures,
      `${Extract<keyof N, AtmosphereTextureName>}Texture`
    >
  >;

/**
 * Configuration options for the {@link Atmosphere} class.
 */
export type AtmosphereOptions = {
  /**
   * URL of a directory to load precomputed atmosphere textures from. The
   * directory must keep the original filenames (`transmittance.exr` etc.).
   * When omitted, the assets bundled with the package are used.
   */
  atmosphereAssetsUrl?: string | undefined;
  /** URL to load STBN (Spatio-Temporal Blue Noise) textures from. */
  stbnUrl?: string;
  /** Date used for calculating sun/moon positions. Defaults to current date. */
  date?: Date;
};

/**
 * Default values for {@link AtmosphereOptions}.
 */
export const DEFAULT_ATMOSPHERE_OPTIONS: Required<
  Omit<AtmosphereOptions, "atmosphereAssetsUrl">
> &
  Pick<AtmosphereOptions, "atmosphereAssetsUrl"> = {
  atmosphereAssetsUrl: undefined,
  stbnUrl: STBN_URL,
  date: new Date(),
};

/**
 * Context for atmosphere rendering.
 *
 * Manages sun/moon positions, precomputed atmosphere textures, and related state.
 * Some variables are shared with Clouds and AerialPerspective.
 */
export class Atmosphere extends EventHandler<AtmosphereEvents> {
  /**
   * @private
   */
  private renderer: WebGLRenderer;

  /**
   * Current sun direction in ECEF coordinates.
   */
  sunDirection = new Vector3();

  /**
   * Current moon direction in ECEF coordinates.
   */
  moonDirection = new Vector3();

  /**
   * @private
   */
  private rotationMatrix = new Matrix4();

  /**
   * Ellipsoid the atmosphere takes as its ground: WGS84 with every radius
   * moved by the height the terrain exaggeration renders sea level at, so
   * terrain sunk below WGS84 stays above the ground. Its radii change in
   * place; consumers that copy them (into uniforms) must reassign it.
   */
  readonly ellipsoid = new Ellipsoid(
    Ellipsoid.WGS84.radii.x,
    Ellipsoid.WGS84.radii.y,
    Ellipsoid.WGS84.radii.z,
  );

  /**
   * @private
   */
  private terrainExaggeration: TerrainExaggeration =
    IDENTITY_TERRAIN_EXAGGERATION;

  /**
   * Precomputed atmosphere textures used for rendering. Each texture is
   * loaded lazily when a consumer declares a need for it via
   * {@link onTexturesReady}, so the object may hold any subset at a time.
   */
  textures: Partial<PrecomputedTextures> = {};

  // Variables that come from Clouds.
  overlay = new Observed<AtmosphereOverlay | null>(null);
  shadow = new Observed<AtmosphereShadow | null>(null);
  shadowLength = new Observed<AtmosphereShadowLength | null>(null);
  enableShadows = new Observed<boolean>(true);

  /**
   * @private
   */
  private needsUpdate = false;

  /**
   * @private
   */
  private options: AtmosphereOptions;

  /**
   * @private
   */
  private _camera: ThreeViewCamera | undefined;

  /**
   * In-flight per-texture loading promises, shared across consumers so each
   * asset is fetched only once.
   * @private
   */
  private texturePromises = new Map<AtmosphereTextureName, Promise<void>>();

  /**
   * The re-fetch in progress for each released texture.
   * @private
   */
  private reloads = new Map<AtmosphereTextureName, Reload>();

  /**
   * Creates a new Atmosphere instance.
   * @param renderer - The WebGL renderer whose context restores re-fetch the
   * released textures.
   * @param options - Configuration options for the atmosphere.
   * @param camera - Camera reference used by {@link setDateAt}.
   */
  constructor(
    renderer: WebGLRenderer,
    options: AtmosphereOptions = {},
    camera?: ThreeViewCamera,
  ) {
    super();

    this.renderer = renderer;
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.options = { ...DEFAULT_ATMOSPHERE_OPTIONS, ...options };
    this._camera = camera;

    this.onUpdate();
  }

  /**
   * Marks the atmosphere as needing an update.
   * @private
   */
  onUpdate = () => {
    this.needsUpdate = true;
    this.emit("needsUpdate");
  };

  /**
   * Loads all precomputed atmosphere textures asynchronously.
   *
   * Each texture loads automatically once a consumer declares a need for it
   * via {@link onTexturesReady}; call this manually only to prefetch every
   * texture ahead of time.
   *
   * @returns A promise that resolves when all textures are loaded.
   */
  async initTextures() {
    await Promise.all(
      ALL_ATMOSPHERE_TEXTURE_NAMES.map((name) => this.loadTexture(name)),
    );
  }

  /**
   * Loads a single precomputed texture, sharing in-flight loads and caching
   * the result. A failed load is forgotten so the next request retries it.
   * @private
   */
  private loadTexture(name: AtmosphereTextureName): Promise<void> {
    let promise = this.texturePromises.get(name);
    if (promise == null) {
      promise = this.fetchTexture(name)
        .then((texture) => {
          texture.minFilter = LinearFilter;
          texture.magFilter = LinearFilter;
          if (CPU_RELEASED_TEXTURE_NAMES.includes(name)) {
            // Only the 2D textures are sampled on the CPU (sun light color,
            // sky light probe); onContextRestored re-fetches the 3D ones.
            // dataReady = false lets three allocate the texture after a
            // context restore without uploading the missing data.
            texture.onUpdate = () => {
              (texture.image as TextureImageData).data = null;
              texture.source.dataReady = false;
            };
          }
          Object.assign(this.textures, {
            [ATMOSPHERE_TEXTURE_KEYS[name]]: texture,
          });
          this.emit("textureLoaded");
        })
        .catch((e: unknown) => {
          // Allow retrying after a failed load instead of caching the
          // rejection.
          this.texturePromises.delete(name);
          throw e;
        });
      this.texturePromises.set(name, promise);
    }
    return promise;
  }

  /**
   * three.js re-uploads textures from their CPU data after a context restore,
   * so the released ones are fetched again (usually from the HTTP cache). A
   * fetch in flight is kept and a pending retry starts over, both with the
   * full retry budget.
   * @private
   */
  private onContextRestored = () => {
    for (const name of CPU_RELEASED_TEXTURE_NAMES) {
      const reload = this.reloads.get(name);
      if (reload == null) {
        this.reloadReleasedTexture(name, { attempt: 0 });
        continue;
      }
      reload.attempt = 0;
      if (reload.timer != null) {
        clearTimeout(reload.timer);
        this.reloadReleasedTexture(name, reload);
      }
    }
  };

  /**
   * Fetches a released texture's data into the same texture object, so
   * consumers keep their references. Retries up to {@link MAX_RELOAD_RETRIES}
   * times and stops once the data is back or the atmosphere is disposed.
   * @private
   */
  private reloadReleasedTexture(name: AtmosphereTextureName, reload: Reload) {
    const texture = this.textures[ATMOSPHERE_TEXTURE_KEYS[name]];
    if (texture == null || (texture.image as TextureImageData).data != null) {
      this.reloads.delete(name);
      return;
    }
    reload.timer = undefined;
    this.reloads.set(name, reload);
    this.fetchTexture(name)
      .then((reloaded) => {
        if (this.reloads.get(name) !== reload) return;
        this.reloads.delete(name);
        texture.image = reloaded.image;
        texture.source.dataReady = true;
        texture.needsUpdate = true;
        this.emit("textureLoaded");
      })
      .catch((e: unknown) => {
        if (this.reloads.get(name) !== reload) return;
        console.error("Failed to reload atmosphere texture:", e);
        if (reload.attempt >= MAX_RELOAD_RETRIES) {
          this.reloads.delete(name);
          return;
        }
        const delay = 1000 * 2 ** reload.attempt;
        reload.attempt += 1;
        reload.timer = setTimeout(
          () => this.reloadReleasedTexture(name, reload),
          delay,
        );
      });
  }

  /**
   * Loads a texture file. The EXR loaders decode to half floats
   * (`HalfFloatType`, `Uint16Array`).
   * @private
   */
  private fetchTexture(name: AtmosphereTextureName): Promise<Texture> {
    const assetsUrl = this.options.atmosphereAssetsUrl;
    const file = ATMOSPHERE_TEXTURE_FILES[name];
    const url =
      assetsUrl == null
        ? ATMOSPHERE_TEXTURE_URLS[file]
        : `${assetsUrl.replace(/\/+$/, "")}/${file}`;
    switch (name) {
      case "transmittance":
        return new EXRTextureLoader({
          width: TRANSMITTANCE_TEXTURE_WIDTH,
          height: TRANSMITTANCE_TEXTURE_HEIGHT,
        }).loadAsync(url);
      case "irradiance":
        return new EXRTextureLoader({
          width: IRRADIANCE_TEXTURE_WIDTH,
          height: IRRADIANCE_TEXTURE_HEIGHT,
        }).loadAsync(url);
      case "scattering":
      case "higherOrderScattering":
        return new EXR3DTextureLoader({
          width: SCATTERING_TEXTURE_WIDTH,
          height: SCATTERING_TEXTURE_HEIGHT,
          depth: SCATTERING_TEXTURE_DEPTH,
        }).loadAsync(url);
    }
  }

  /**
   * @private
   */
  _dispose() {
    this.renderer.domElement.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    for (const { timer } of this.reloads.values()) {
      clearTimeout(timer);
    }
    this.reloads.clear();
    for (const texture of Object.values(this.textures)) {
      texture?.dispose();
    }
    this.textures = {};
    this.texturePromises.clear();
    this.emit("disposed");
  }

  /**
   * Invokes the callback once every needed precomputed texture is loaded —
   * immediately if they already are.
   *
   * Registering also starts loading the needed textures if they aren't loaded
   * yet, so a texture is only fetched once something that needs it exists.
   *
   * @param callback - Receives the textures; the ones listed in `needs` are
   * guaranteed to be present.
   * @param needs - The textures the caller needs, e.g.
   * `{ transmittance: true }`. Omit to load all of them.
   *
   * @example
   * atmosphere.onTexturesReady(
   *   (t) => light.setTransmittanceTexture(t.transmittanceTexture),
   *   { transmittance: true },
   * );
   */
  onTexturesReady<
    N extends AtmosphereTextureNeeds = Record<AtmosphereTextureName, true>,
  >(
    callback: (textures: LoadedAtmosphereTextures<N>) => void,
    needs?: N,
  ): void {
    const names =
      needs == null
        ? ALL_ATMOSPHERE_TEXTURE_NAMES
        : ALL_ATMOSPHERE_TEXTURE_NAMES.filter((name) => needs[name]);
    for (const name of names) {
      this.loadTexture(name).catch((e: unknown) => {
        console.error("Failed to load atmosphere textures:", e);
      });
    }

    const isReady = () =>
      names.every(
        (name) => this.textures[ATMOSPHERE_TEXTURE_KEYS[name]] != null,
      );
    const invoke = () => {
      callback(this.textures as LoadedAtmosphereTextures<N>);
    };
    if (isReady()) {
      invoke();
    } else {
      const listener = () => {
        if (!isReady()) return;
        this.off("textureLoaded", listener);
        invoke();
      };
      this.on("textureLoaded", listener);
    }
  }

  /**
   * Returns a clone of the current sun direction vector.
   * @returns A new Vector3 representing the sun direction in ECEF coordinates.
   */
  getSunDirection(): Vector3 {
    return this.sunDirection.clone();
  }

  /**
   * Returns a clone of the current moon direction vector.
   * @returns A new Vector3 representing the moon direction in ECEF coordinates.
   */
  getMoonDirection(): Vector3 {
    return this.moonDirection.clone();
  }

  /**
   * Returns a clone of the ECI to ECEF rotation matrix.
   * @returns A new Matrix4 representing the rotation from ECI to ECEF coordinates.
   */
  getRotationMatrix(): Matrix4 {
    return this.rotationMatrix.clone();
  }

  /**
   * Updates sun/moon directions and rotation matrix if needed, and moves
   * {@link ellipsoid} to the sea level `terrainExaggeration` renders.
   * @private
   */
  _update(terrainExaggeration: TerrainExaggeration) {
    if (terrainExaggeration !== this.terrainExaggeration) {
      this.terrainExaggeration = terrainExaggeration;
      const [scale, relativeHeight] = terrainExaggeration;
      const seaLevel = exaggerateTerrainHeight(0, scale, relativeHeight);
      const wgs84 = Ellipsoid.WGS84.radii;
      this.ellipsoid.radii.set(
        wgs84.x + seaLevel,
        wgs84.y + seaLevel,
        wgs84.z + seaLevel,
      );
    }

    if (this.needsUpdate) {
      getSunDirectionECEF(this.date, this.sunDirection);
      getMoonDirectionECEF(this.date, this.moonDirection);
      getECIToECEFRotationMatrix(this.date, this.rotationMatrix);

      this.emit("sunChanged", this.sunDirection.clone());
    }

    this.needsUpdate = false;
  }

  /**
   * Determines whether a given position is on the night side of the Earth.
   * @param position - The position in ECEF coordinates to check.
   * @returns `true` if the position is on the night side, `false` otherwise.
   */
  isAtNight(position: XYZ): boolean {
    const normalizedPosition = new Vector3(position.x, position.y, position.z)
      .clone()
      .normalize();
    const dotProduct = normalizedPosition.dot(this.sunDirection);
    return dotProduct < 0;
  }

  /**
   * Returns the sun's elevation angle in degrees above the local horizon at
   * `location` for the current {@link date}. Positive is above the horizon,
   * negative below (night); includes atmospheric refraction.
   *
   * @example
   * const elevation = view.atmosphere.getSunElevation(view.camera.positionGeographic);
   * if (elevation < 0) console.log("The sun has set.");
   */
  getSunElevation(location: { lat: number; lng: number }): number {
    return sunElevationAt(this.date, location.lat, location.lng);
  }

  /**
   * Returns the local apparent solar time at `lng` for the current
   * {@link date}, in hours in the range [0, 24) where 12 is solar noon.
   * Accounts for the equation of time.
   *
   * @example
   * const hours = view.atmosphere.getSolarTime({ lng: 139.69 }); // e.g. 6.3 = 06:18
   */
  getSolarTime(location: { lng: number }): number {
    return solarTimeAt(this.date, location.lng);
  }

  /**
   * Sets {@link date} so the local apparent solar time at `lng` equals `hours`
   * (0–24), keeping the same solar day. Inverse of {@link getSolarTime}.
   *
   * @example
   * view.atmosphere.setSolarTime({ lng: 139.69 }, 6.3); // sunrise over Tokyo
   */
  setSolarTime(location: { lng: number }, hours: number): void {
    this.date = dateForSolarTime(this.date, location.lng, hours);
  }

  /**
   * Gets the current date used for calculating sun/moon positions.
   */
  get date() {
    return this.options.date ?? DEFAULT_ATMOSPHERE_OPTIONS.date;
  }

  /**
   * Sets the date used for calculating sun/moon positions.
   * Triggers an update to recalculate celestial body directions.
   */
  set date(v: Date) {
    this.options.date = v;
    this.onUpdate();
  }

  /**
   * Adjusts `atmosphere.date` so that the local solar time at `to` matches the
   * local solar time at `from`.
   *
   * The calculation is based on the sun's hour angle, which increases
   * monotonically over a solar day, giving exactly one solution per day with no
   * morning/afternoon ambiguity. The equation of time is accounted for
   * automatically.
   *
   * @example
   * // atmosphere.date shows 08:00 local solar time at Tokyo.
   * view.atmosphere.setDateAt({ lng: 139.69 }, { lng: 0 });
   * // → atmosphere.date is now 08:00 local solar time at London
   *
   * @param from - Source location. Only `lng` (degrees) affects the result.
   * @param to   - Target location. Only `lng` (degrees) affects the result.
   */
  setDateAt(
    from: { lng: number; lat?: number },
    to: { lng: number; lat?: number },
  ): void {
    this.date = shiftDateToHourAngle(this.date, from.lng, to.lng, to.lat);
  }

  /**
   * Adjusts `atmosphere.date` so that the sun elevation at `to` matches the
   * sun elevation at `from`.
   *
   * Morning/afternoon context is preserved. If the target elevation cannot be
   * reached at `to` (e.g. polar night), the date is clamped to solar noon
   * there.
   *
   * @example
   * // atmosphere.date shows sun at 30° elevation over Tokyo.
   * view.atmosphere.setElevationAt({ lat: 35.68, lng: 139.69 }, { lat: 51.5, lng: -0.12 });
   * // → atmosphere.date adjusted so sun is also at 30° elevation over London
   *
   * @param from - Source location (both `lat` and `lng` required).
   * @param to   - Target location (both `lat` and `lng` required).
   */
  setElevationAt(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): void {
    this.date = shiftDateToElevation(
      this.date,
      from.lat,
      from.lng,
      to.lat,
      to.lng,
    );
  }

  /**
   * Convenience wrapper for {@link setDateAt} that uses the camera position as
   * `from`.
   *
   * @example
   * // Camera is over Tokyo showing 08:00 local solar time.
   * view.atmosphere.setDateFromCameraAt({ lng: 0 }); // adjust to London
   * // → atmosphere.date is now 08:00 local solar time at London
   *
   * @param to - Target location. Only `lng` (degrees) affects the result.
   */
  setDateFromCameraAt(to: { lng: number; lat?: number }): void {
    const { lng: fromLng } = this._camera?.positionGeographic ?? { lng: 0 };
    this.setDateAt({ lng: fromLng }, to);
  }

  /**
   * Convenience wrapper for {@link setElevationAt} that uses the camera
   * position as `from`.
   *
   * @example
   * // Camera is over Tokyo with sun at 30° elevation.
   * view.atmosphere.setElevationFromCameraAt({ lat: 51.5, lng: -0.12 }); // adjust to London
   * // → atmosphere.date adjusted so sun is also at 30° elevation over London
   *
   * @param to - Target location (both `lat` and `lng` required).
   */
  setElevationFromCameraAt(to: { lat: number; lng: number }): void {
    const { lng: fromLng, lat: fromLat } = this._camera?.positionGeographic ?? {
      lng: 0,
      lat: 0,
    };
    this.setElevationAt({ lat: fromLat, lng: fromLng }, to);
  }
}
