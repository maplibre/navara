import type ThreeView from "@navaramap/three";
import { Color } from "@navaramap/three";
import {
  LightDesc,
  type LightConfig,
  type ViewContext,
  type LightUpdate,
} from "@navaramap/three";
import { Material } from "three";

import { SunLight, type SunLightOptions } from "./sunLight";

type Description = {
  /**
   * Sun light configuration options. Includes all CSM (Cascaded Shadow Maps) settings.
   * Color can be specified as a number (hex value) or Navara Color instance.
   */
  sun?: Omit<SunLightOptions, "color"> & { color?: Color };
};

export type SunLightConfig = LightConfig & Description;

export type SunLightUpdate = LightUpdate & Description;

export class SunLightDesc extends LightDesc<
  SunLightConfig,
  SunLightUpdate,
  SunLight
> {
  private config: SunLightConfig;

  constructor(view: ThreeView, ctx: ViewContext, config: SunLightConfig) {
    super(view, ctx, config);
    this.config = config;
  }

  createLight() {
    const options = this.config.sun ?? {};
    const color = options.color ? options.color.raw : undefined;

    const sunLight = new SunLight(this.view.camera.raw, {
      ...options,
      ...(color ? { color } : {}),
    } as SunLightOptions);

    // Set up atmosphere integration. The transmittance texture is only
    // needed to compute the sun color from the atmosphere, so skip the
    // request entirely while `applyColor` uses the configured color.
    if (!sunLight.applyColor) {
      this.requestTransmittanceTexture(sunLight);
    }

    sunLight.on("needsUpdate", () => this.emit("needsUpdate"));
    sunLight.on("_csmChanged", this.updateSceneLights.bind(this));

    return sunLight;
  }

  onUpdateConfig(updates: SunLightUpdate): void {
    super.onUpdateConfig(updates);

    if (this.config.sun && updates.sun && this._instance) {
      Object.assign(this.config.sun, updates.sun);

      // Update intensity
      if (updates.sun.intensity !== undefined) {
        this._instance.intensity = updates.sun.intensity;
      }

      // Update color
      if (updates.sun.color !== undefined) {
        this._instance.color = updates.sun.color.raw;
      }

      if (updates.sun.applyColor !== undefined) {
        this._instance.applyColor = updates.sun.applyColor;
        // Turning applyColor off makes the sun color depend on the
        // atmosphere again; fetch the texture then (no-op if already loaded).
        if (!updates.sun.applyColor) {
          this.requestTransmittanceTexture(this._instance);
        }
      }

      // Shadow
      if (updates.sun.castShadow !== undefined) {
        this._instance.castShadow = updates.sun.castShadow;
      }
      if (updates.sun.shadowMapSize !== undefined) {
        this._instance.shadowMapSize = updates.sun.shadowMapSize;
      }
      if (updates.sun.shadowFar !== undefined) {
        this._instance.shadowFar = updates.sun.shadowFar;
      }
      if (updates.sun.shadowCascadeCount !== undefined) {
        this._instance.shadowCascadeCount = updates.sun.shadowCascadeCount;
      }
      if (updates.sun.shadowMode !== undefined) {
        this._instance.shadowMode = updates.sun.shadowMode;
      }
      if (updates.sun.shadowLambda !== undefined) {
        this._instance.shadowLambda = updates.sun.shadowLambda;
      }
      if (updates.sun.shadowMargin !== undefined) {
        this._instance.shadowMargin = updates.sun.shadowMargin;
      }
      if (updates.sun.shadowFade !== undefined) {
        this._instance.shadowFade = updates.sun.shadowFade;
      }
      if (updates.sun.shadowIntensity !== undefined) {
        this._instance.shadowIntensity = updates.sun.shadowIntensity;
      }
      if (updates.sun.shadowBias !== undefined) {
        this._instance.shadowBias = updates.sun.shadowBias;
      }
      if (updates.sun.shadowNormalBias !== undefined) {
        this._instance.shadowNormalBias = updates.sun.shadowNormalBias;
      }
      if (updates.sun.shadowRadius !== undefined) {
        this._instance.shadowRadius = updates.sun.shadowRadius;
      }
      if (updates.sun.debugCSMHelper !== undefined) {
        this._instance.debugCSMHelper = updates.sun.debugCSMHelper;
      }
    }
  }

  private requestTransmittanceTexture(sunLight: SunLight): void {
    this.view.atmosphere.onTexturesReady(
      (t) => sunLight.setTransmittanceTexture(t.transmittanceTexture),
      { transmittance: true },
    );
  }

  onCreate() {
    super.onCreate();

    // Add initial lights to scene
    this.updateSceneLights();

    // Listen for shadow material events.
    this.ctx.on("shadowApplied", (m: Material) => {
      this._instance?.setupMaterialForCSM(m);
    });
    this.ctx.on("shadowRemoved", (m: Material) => {
      this._instance?.removeMaterialFromCSM(m);
    });
  }

  update(_time: number): void {
    if (!this._instance) return;

    // Update sun direction from atmosphere
    this._instance.updateSunDirection(this.view.atmosphere.sunDirection);

    // Update position to camera position for proper lighting.
    const cameraPosition = this.view.camera.raw.position;
    this._instance.updateTargetPosition(cameraPosition);

    this._instance.update();
  }

  onDestroy(): void {
    // Remove CSM lights and helper from scene before parent cleanup
    this.removeLightsFromScene();
    super.onDestroy();
  }

  /**
   * Update scene lights based on current CSM state
   */
  private updateSceneLights(): void {
    if (!this._instance) return;

    // Remove existing lights first
    this.removeLightsFromScene();

    // Add appropriate lights to scene
    const sceneLights = this._instance.getSceneLights();
    const lightScene = this.ctx.scenes.light;
    lightScene.add(sceneLights);

    // Keep the CSM lights FIRST in traversal order. Shadow indices are
    // assigned in traversal order among shadow-casting lights, and both the
    // CSM fragment sampling and the view-space shadow matrices assume the
    // cascades occupy the first CSM_CASCADE_COUNT slots — a shadow-casting
    // directional light added earlier in the scene would silently shift them.
    const index = lightScene.children.indexOf(sceneLights);
    if (index > 0) {
      lightScene.children.splice(index, 1);
      lightScene.children.unshift(sceneLights);
    }

    // Add CSM helper if available and enabled
    const helper = this._instance.getSceneHelper();
    if (helper) {
      this.ctx.scenes.opaque.add(helper);
    }
  }

  /**
   * Remove all lights and helpers from scene
   */
  private removeLightsFromScene(): void {
    if (!this._instance) return;

    // Remove CSM lights
    const sceneLights = this._instance.getCSM().directionalLights;
    sceneLights.removeFromParent();

    // Remove CSM helper
    const helper = this._instance.getSceneHelper();
    if (helper) {
      helper.removeFromParent();
    }

    // Remove sun light
    if (this.raw) {
      this.raw.removeFromParent();
    }
  }
}
