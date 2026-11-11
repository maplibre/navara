import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  Frustum,
  LinearFilter,
  Matrix4,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  RGFormat,
  Sphere,
  Vector3,
} from "three";

import {
  effectiveRange,
  projectSphereBoundsNdc,
  tileContributionEstimate,
} from "./math";

/** Everything {@link FogLightTileGrid.populate} needs for one rebuild. */
export type FogLightTileGridInput = {
  camera: PerspectiveCamera | OrthographicCamera;
  /** world -> clip */
  vpM: Matrix4;
  /** world -> view */
  viewM: Matrix4;
  /** Per-light color (rgb) + intensity (a) */
  buf0: Float32Array;
  /**
   * Per-light position (xyz) + effective range (w). populate() bakes the
   * range into w; the caller uploads the texture when it reports a change.
   */
  buf1: Float32Array;
  /** Per-light user radii (upper bound of the effective range) */
  userRadii: Float32Array;
  lightCount: number;
  fogDensity: number;
  haloFalloff: number;
  extentScale: number;
  maxFar: number;
};

/**
 * CPU side of the FogLight tiled culling
 * (idea: https://www.aortiz.me/2018/12/21/CG.html).
 *
 * Owns the screen-tile grid: which lights each tile iterates on the GPU
 * (uLightGrid / uLightIndex) plus the residual haze texture (uResidual) that
 * absorbs lights dropped by the per-tile cap. Each rebuild:
 *
 * 1. bakes per-light effective ranges and ranks lights by apparent
 *    brightness,
 * 2. registers each light on the tiles its projected bounds cover — tiles at
 *    capacity keep the strongest per-tile contributors (a per-tile min-heap
 *    makes replace-weakest O(log cap)), and
 * 3. folds whichever lights lose into the residual haze so overload dims
 *    gracefully instead of stepping at tile borders.
 */
export class FogLightTileGrid {
  gridW = 0;
  gridH = 0;
  indexTexW = 0;
  indexTexH = 1;
  /** Per-tile registered-light counts, exposed for diagnostics */
  tileCounts?: Uint16Array;

  private readonly tileSizePx: number;
  private _maxLightsPerTile: number;
  private width = 0;
  private height = 0;

  // GPU-facing data
  private gridTex?: DataTexture;
  private indexTex?: DataTexture;
  private residualTex?: DataTexture;
  private gridBuf?: Float32Array;
  private indexBuf?: Float32Array;
  private residualBuf?: Float32Array;

  // Per-tile working state
  private residualEnergy?: Float32Array;
  private slotVals?: Float32Array;
  private heapReady?: Uint8Array;
  private tileDirs?: Float32Array;

  // Per-light scratch, grown on demand
  private reff = new Float32Array(0);
  private importance = new Float32Array(0);
  private dist = new Float32Array(0);
  private ldir = new Float32Array(0);
  private pxX = new Float32Array(0);
  private pxY = new Float32Array(0);
  private order: number[] = [];

  // Reused instances to avoid per-rebuild allocations
  private readonly frustum = new Frustum();
  private readonly viewScratch = new Vector3();
  private readonly ndcScratch = new Vector3();
  private readonly sphereScratch = new Sphere();
  private readonly boundsScratch = new Float32Array(4);

  constructor(tileSizePx: number, maxLightsPerTile: number) {
    this.tileSizePx = tileSizePx;
    this._maxLightsPerTile = maxLightsPerTile;
  }

  dispose(): void {
    this.gridTex?.dispose();
    this.indexTex?.dispose();
    this.residualTex?.dispose();
  }

  get gridTexture(): DataTexture | undefined {
    return this.gridTex;
  }
  get indexTexture(): DataTexture | undefined {
    return this.indexTex;
  }
  get residualTexture(): DataTexture | undefined {
    return this.residualTex;
  }

  get maxLightsPerTile(): number {
    return this._maxLightsPerTile;
  }
  set maxLightsPerTile(v: number) {
    this._maxLightsPerTile = v;
    // Reallocate the index texture with the new stride
    this.allocate();
  }

  /** Low-res render size in pixels; recomputes the tile grid dimensions. */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gridW = Math.max(1, Math.ceil(width / this.tileSizePx));
    this.gridH = Math.max(1, Math.ceil(height / this.tileSizePx));
    this.allocate();
  }

  private allocate(): void {
    const gridTexelCount = this.gridW * this.gridH;

    // uLightGrid (gridW x gridH, RG32F: offset, count)
    if (!this.gridBuf || this.gridBuf.length !== gridTexelCount * 2) {
      this.gridBuf = new Float32Array(gridTexelCount * 2);
      if (!this.gridTex) {
        this.gridTex = new DataTexture(
          this.gridBuf,
          this.gridW,
          this.gridH,
          RGFormat,
          FloatType,
        );
        this.gridTex.magFilter = this.gridTex.minFilter = NearestFilter;
        this.gridTex.wrapS = this.gridTex.wrapT = ClampToEdgeWrapping;
        this.gridTex.needsUpdate = true;
      } else {
        this.rebind(this.gridTex, this.gridBuf, this.gridW, this.gridH);
      }
    }

    if (!this.tileCounts || this.tileCounts.length !== gridTexelCount) {
      this.tileCounts = new Uint16Array(gridTexelCount);
    }
    const slotCount = gridTexelCount * this._maxLightsPerTile;
    if (!this.slotVals || this.slotVals.length !== slotCount) {
      this.slotVals = new Float32Array(slotCount);
      this.heapReady = new Uint8Array(gridTexelCount);
    }
    if (!this.tileDirs || this.tileDirs.length !== gridTexelCount * 3) {
      this.tileDirs = new Float32Array(gridTexelCount * 3);
    }

    // uResidual (rgb = premultiplied haze, a = mean light distance). It is
    // bilinearly interpolated in the shader (manually, via texelFetch).
    if (!this.residualBuf || this.residualBuf.length !== gridTexelCount * 4) {
      this.residualBuf = new Float32Array(gridTexelCount * 4);
      this.residualEnergy = new Float32Array(gridTexelCount);
      if (!this.residualTex) {
        this.residualTex = new DataTexture(
          this.residualBuf,
          this.gridW,
          this.gridH,
          RGBAFormat,
          FloatType,
        );
        this.residualTex.magFilter = this.residualTex.minFilter = LinearFilter;
        this.residualTex.wrapS = this.residualTex.wrapT = ClampToEdgeWrapping;
        this.residualTex.needsUpdate = true;
      } else {
        this.rebind(this.residualTex, this.residualBuf, this.gridW, this.gridH);
      }
    }

    // uLightIndex: fixed-stride packing — each tile reserves
    // ceil(maxLightsPerTile / 4) RGBA texels, laid out in a near-square
    // texture to stay under the max texture size.
    const strideTexels = Math.max(1, Math.ceil(this._maxLightsPerTile / 4));
    const indexTexelCapacity = Math.max(1, gridTexelCount * strideTexels);
    if (!this.indexBuf || this.indexBuf.length !== indexTexelCapacity * 4) {
      this.indexTexW = Math.ceil(Math.sqrt(indexTexelCapacity));
      this.indexTexH = Math.ceil(indexTexelCapacity / this.indexTexW);
      this.indexBuf = new Float32Array(this.indexTexW * this.indexTexH * 4);
      if (!this.indexTex) {
        this.indexTex = new DataTexture(
          this.indexBuf,
          this.indexTexW,
          this.indexTexH,
          RGBAFormat,
          FloatType,
        );
        this.indexTex.magFilter = this.indexTex.minFilter = NearestFilter;
        this.indexTex.wrapS = this.indexTex.wrapT = ClampToEdgeWrapping;
        this.indexTex.needsUpdate = true;
      } else {
        this.rebind(
          this.indexTex,
          this.indexBuf,
          this.indexTexW,
          this.indexTexH,
        );
      }
    }
  }

  // Resizing a DataTexture requires releasing the GL texture: three allocates
  // immutable storage on first upload, so an in-place image swap would
  // texSubImage past the old dimensions (GL_INVALID_VALUE).
  private rebind(
    tex: DataTexture,
    data: Float32Array,
    width: number,
    height: number,
  ): void {
    tex.image.data = data;
    tex.image.width = width;
    tex.image.height = height;
    tex.dispose();
    tex.needsUpdate = true;
  }

  /**
   * Rebuild the grid for the current camera and light set.
   * @returns true when effective ranges baked into `buf1` changed, i.e. the
   * caller must re-upload its light data texture.
   */
  populate(input: FogLightTileGridInput): boolean {
    if (
      !this.gridBuf ||
      !this.indexBuf ||
      !this.gridTex ||
      !this.indexTex ||
      !this.tileCounts ||
      !this.residualBuf ||
      !this.residualEnergy ||
      !this.residualTex ||
      !this.slotVals ||
      !this.heapReady ||
      !this.tileDirs
    ) {
      return false;
    }
    const width = this.width;
    const height = this.height;
    if (width <= 0 || height <= 0) return false;

    const {
      camera,
      vpM,
      viewM,
      buf0,
      buf1,
      userRadii,
      lightCount,
      fogDensity,
      haloFalloff,
      extentScale,
      maxFar,
    } = input;

    const tileCounts = this.tileCounts;
    const indexBuf = this.indexBuf;
    const residualBuf = this.residualBuf;
    const residualEnergy = this.residualEnergy;
    const slotVals = this.slotVals;
    const heapReady = this.heapReady;
    const tileDirs = this.tileDirs;
    const gridW = this.gridW;
    const gridH = this.gridH;
    const tileSize = this.tileSizePx;
    const cap = this._maxLightsPerTile;

    // Reset per-tile state; grid metadata is fully overwritten below
    tileCounts.fill(0);
    residualBuf.fill(0);
    residualEnergy.fill(0);
    heapReady.fill(0);

    const halfW = 0.5 * width;
    const halfH = 0.5 * height;
    const frustum = this.frustum.setFromProjectionMatrix(vpM);
    const view = this.viewScratch;
    const ndc = this.ndcScratch;
    const sphere = this.sphereScratch;
    const bounds = this.boundsScratch;

    const projM = camera.projectionMatrix;
    const fx = Math.abs(projM.elements[0]);
    const fy = Math.abs(projM.elements[5]);

    // Fixed-stride packing parameters
    const strideTexels = Math.max(1, Math.ceil(cap / 4));
    const strideScalars = strideTexels * 4; // components per tile

    // Pass 1: bake effective ranges and rank lights by apparent brightness.
    if (this.reff.length < lightCount) {
      this.reff = new Float32Array(lightCount);
      this.importance = new Float32Array(lightCount);
      this.dist = new Float32Array(lightCount);
      this.ldir = new Float32Array(lightCount * 3);
      this.pxX = new Float32Array(lightCount);
      this.pxY = new Float32Array(lightCount);
    }
    const reffArr = this.reff;
    const importance = this.importance;
    const distArr = this.dist;
    const ldir = this.ldir;
    const pxX = this.pxX;
    const pxY = this.pxY;
    const order = this.order;
    order.length = 0;
    let bakedRangeChanged = false;
    for (let i = 0; i < lightCount; i++) {
      const base = i * 4;
      const intensity = buf0[base + 3];
      // fround so the change check compares like with like — buf1 is a
      // Float32Array and a double would never equal its stored value,
      // flagging a texture re-upload on every rebuild
      const reff = Math.fround(
        effectiveRange(intensity, fogDensity, userRadii[i], haloFalloff),
      );
      reffArr[i] = reff;
      // Bake the effective range into the position texture's w channel so
      // the shader reads it directly instead of recomputing per pixel.
      if (buf1[base + 3] !== reff) {
        buf1[base + 3] = reff;
        bakedRangeChanged = true;
      }
      if (intensity <= 0 || reff <= 0) continue;

      // Far-distance culling: if the nearest point of the light's influence
      // sphere is beyond maxFar from the camera, skip it.
      view.set(buf1[base], buf1[base + 1], buf1[base + 2]);
      const distance = camera.position.distanceTo(view);
      distArr[i] = distance;
      if (distance - reff * extentScale > maxFar) continue;

      // Apparent-brightness proxy, used only for ranking
      importance[i] = (intensity * reff) / Math.max(distance, 1);
      order.push(i);
    }

    // Insert brightest-first so tiles fill with strong candidates and
    // replacements stay rare.
    order.sort((a, b) => importance[b] - importance[a]);

    const isPerspective = camera instanceof PerspectiveCamera;

    // World-space ray direction through each tile center. This makes the
    // per-tile estimates exact at any angle — a screen-space distance would
    // diverge (tan) for lights beside or behind the camera, which is exactly
    // the inside-the-fog geometry.
    if (isPerspective) {
      const me = camera.matrixWorld.elements;
      const rx = me[0];
      const ry = me[1];
      const rz = me[2];
      const ux = me[4];
      const uy = me[5];
      const uz = me[6];
      const bx = me[8];
      const by = me[9];
      const bz = me[10]; // camera looks down -z, so forward = -back
      const invFx = 1 / fx;
      const invFy = 1 / fy;
      for (let ty = 0; ty < gridH; ty++) {
        const ndcY = (((ty + 0.5) * tileSize) / height) * 2 - 1;
        const vy = ndcY * invFy;
        for (let tx = 0; tx < gridW; tx++) {
          const ndcX = (((tx + 0.5) * tileSize) / width) * 2 - 1;
          const vx = ndcX * invFx;
          let dx = rx * vx + ux * vy - bx;
          let dy = ry * vx + uy * vy - by;
          let dz = rz * vx + uz * vy - bz;
          const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
          dx *= inv;
          dy *= inv;
          dz *= inv;
          const t3 = (ty * gridW + tx) * 3;
          tileDirs[t3] = dx;
          tileDirs[t3 + 1] = dy;
          tileDirs[t3 + 2] = dz;
        }
      }
    }

    // Estimated per-tile contribution of light `li`. The closest-approach
    // distance h is d*sin(angle between the tile ray and the light
    // direction), clamped to d for lights behind the ray. Only evaluated for
    // tiles at capacity — cheap inserts stay index-writes.
    const hMinPerDist = (tileSize * 0.5) / (fx * halfW);
    const orthoWorldPerPx = 1 / (fx * halfW);
    const estFor = (
      li: number,
      tileIdx: number,
      tx: number,
      ty: number,
    ): number => {
      let h: number;
      if (isPerspective) {
        const d = distArr[li];
        const l3 = li * 3;
        const t3 = tileIdx * 3;
        const cosA =
          ldir[l3] * tileDirs[t3] +
          ldir[l3 + 1] * tileDirs[t3 + 1] +
          ldir[l3 + 2] * tileDirs[t3 + 2];
        h = cosA > 0 ? d * Math.sqrt(Math.max(1 - cosA * cosA, 0)) : d;
        const hMin = Math.max(hMinPerDist * d, 1e-3);
        if (h < hMin) h = hMin;
      } else {
        // Orthographic rays are parallel: the screen offset in world units
        // IS the perpendicular ray-light distance.
        const dx = (tx + 0.5) * tileSize - pxX[li];
        const dy = (ty + 0.5) * tileSize - pxY[li];
        h = Math.sqrt(dx * dx + dy * dy) * orthoWorldPerPx;
        const hMin = Math.max(tileSize * orthoWorldPerPx * 0.5, 1e-3);
        if (h < hMin) h = hMin;
      }
      return tileContributionEstimate(
        h,
        reffArr[li],
        buf0[li * 4 + 3],
        haloFalloff,
      );
    };

    // Each full tile keeps its kept-light estimates as a binary min-heap over
    // (slotVals, indexBuf) so replace-weakest is O(log cap) with no rescans.
    // The GPU reads the slots as an unordered set, so heap order is fine.
    const siftDown = (slotBase: number, startScalar: number, start: number) => {
      let s = start;
      for (;;) {
        const l = 2 * s + 1;
        if (l >= cap) break;
        const r = l + 1;
        let m = slotVals[slotBase + l] < slotVals[slotBase + s] ? l : s;
        if (r < cap && slotVals[slotBase + r] < slotVals[slotBase + m]) m = r;
        if (m === s) break;
        const tv = slotVals[slotBase + m];
        slotVals[slotBase + m] = slotVals[slotBase + s];
        slotVals[slotBase + s] = tv;
        const ti = indexBuf[startScalar + m];
        indexBuf[startScalar + m] = indexBuf[startScalar + s];
        indexBuf[startScalar + s] = ti;
        s = m;
      }
    };

    // Pass 2: cull and register each light on the tiles it can reach.
    for (const i of order) {
      const base = i * 4;
      const wx = buf1[base + 0];
      const wy = buf1[base + 1];
      const wz = buf1[base + 2];
      const reff = reffArr[i];
      // World-space influence radius, padded by extentScale for tiling
      // safety. Must stay >= the shader's range or fog cuts at tile edges.
      const rWorld = reff * extentScale;

      // Frustum culling in world space using a bounding sphere
      sphere.center.set(wx, wy, wz);
      sphere.radius = rWorld;
      if (!frustum.intersectsSphere(sphere)) continue;

      // Camera-space position for the projected bounds
      view.set(wx, wy, wz).applyMatrix4(viewM);

      let minTx: number;
      let maxTx: number;
      let minTy: number;
      let maxTy: number;
      if (camera instanceof PerspectiveCamera) {
        if (-view.z - rWorld <= camera.near) {
          // The influence sphere reaches the near plane (camera inside it, or
          // the light sits beside/behind the camera while its sphere still
          // covers near rays). The perspective projection of the center is
          // unbounded or flipped, so no screen-space AABB is valid —
          // conservatively register the light on the whole grid.
          minTx = 0;
          maxTx = gridW - 1;
          minTy = 0;
          maxTy = gridH - 1;
        } else {
          // Exact for a sphere fully in front of the near plane, which the
          // branch above guarantees.
          if (
            !projectSphereBoundsNdc(
              view.x,
              view.y,
              -view.z,
              rWorld,
              fx,
              fy,
              bounds,
            )
          ) {
            continue;
          }
          const px0 = (bounds[0] * 0.5 + 0.5) * width;
          const px1 = (bounds[1] * 0.5 + 0.5) * width;
          const py0 = (bounds[2] * 0.5 + 0.5) * height;
          const py1 = (bounds[3] * 0.5 + 0.5) * height;

          // ceil(...)-1 keeps coverage inclusive when the bounds touch a
          // tile boundary.
          minTx = Math.floor(px0 / tileSize);
          maxTx = Math.ceil(px1 / tileSize) - 1;
          minTy = Math.floor(py0 / tileSize);
          maxTy = Math.ceil(py1 / tileSize) - 1;
        }
      } else {
        // Orthographic: project the center and pad by the linear radius.
        ndc.set(wx, wy, wz).applyMatrix4(vpM);
        const px = (ndc.x * 0.5 + 0.5) * width;
        const py = (ndc.y * 0.5 + 0.5) * height;
        if (!isFinite(px) || !isFinite(py)) continue;
        const rPx = Math.max(
          Math.abs(rWorld * fx) * halfW,
          Math.abs(rWorld * fy) * halfH,
        );
        minTx = Math.floor((px - rPx) / tileSize);
        maxTx = Math.ceil((px + rPx) / tileSize) - 1;
        minTy = Math.floor((py - rPx) / tileSize);
        maxTy = Math.ceil((py + rPx) / tileSize) - 1;

        pxX[i] = px;
        pxY[i] = py;
      }

      if (isPerspective) {
        // Unit camera-to-light direction for the per-tile estimates (valid
        // for every light, including near-plane splats)
        const d = distArr[i];
        const i3 = i * 3;
        if (d > 1e-6) {
          const cp = camera.position;
          ldir[i3] = (wx - cp.x) / d;
          ldir[i3 + 1] = (wy - cp.y) / d;
          ldir[i3 + 2] = (wz - cp.z) / d;
        } else {
          ldir[i3] = 0;
          ldir[i3 + 1] = 0;
          ldir[i3 + 2] = 0;
        }
      }

      // If the AABB is completely outside the grid, skip early
      if (maxTx < 0 || minTx >= gridW || maxTy < 0 || minTy >= gridH) continue;

      // Clamp to the valid tile range
      const x0 = Math.max(0, Math.min(gridW - 1, minTx));
      const x1 = Math.max(0, Math.min(gridW - 1, maxTx));
      const y0 = Math.max(0, Math.min(gridH - 1, minTy));
      const y1 = Math.max(0, Math.min(gridH - 1, maxTy));

      for (let ty = y0; ty <= y1; ty++) {
        const baseTile = ty * gridW;
        for (let tx = x0; tx <= x1; tx++) {
          const tileIdx = baseTile + tx;
          const cnt = tileCounts[tileIdx];
          const startScalar = tileIdx * strideScalars; // component 0 start for this tile
          if (cnt < cap) {
            // Room left: a plain index write. Per-tile estimates are only
            // computed lazily once the tile actually overflows.
            indexBuf[startScalar + cnt] = i;
            tileCounts[tileIdx] = cnt + 1;
            continue;
          }

          // Tile is at capacity: keep the strongest per-tile contributors by
          // replacing the current weakest when this light beats it. Whichever
          // light loses is folded into the residual haze so overload dims
          // gracefully instead of stepping at tile borders.
          const slotBase = tileIdx * cap;
          if (heapReady[tileIdx] === 0) {
            // First overflow: backfill the slot estimates and heapify
            for (let s = 0; s < cap; s++) {
              slotVals[slotBase + s] = estFor(
                indexBuf[startScalar + s],
                tileIdx,
                tx,
                ty,
              );
            }
            for (let s = (cap >> 1) - 1; s >= 0; s--) {
              siftDown(slotBase, startScalar, s);
            }
            heapReady[tileIdx] = 1;
          }

          const est = estFor(i, tileIdx, tx, ty);
          let droppedEst = est;
          let droppedIdx = i;
          if (est > slotVals[slotBase]) {
            droppedEst = slotVals[slotBase];
            droppedIdx = indexBuf[startScalar];
            slotVals[slotBase] = est;
            indexBuf[startScalar] = i;
            siftDown(slotBase, startScalar, 0);
          }
          if (droppedEst > 0) {
            const db = droppedIdx * 4;
            // est already contains the intensity factor; add color and fog
            const premul = fogDensity * droppedEst;
            const er = buf0[db + 0] * premul;
            const eg = buf0[db + 1] * premul;
            const eb = buf0[db + 2] * premul;
            const k4 = tileIdx * 4;
            residualBuf[k4 + 0] += er;
            residualBuf[k4 + 1] += eg;
            residualBuf[k4 + 2] += eb;
            const energy = er + eg + eb;
            residualBuf[k4 + 3] += energy * distArr[droppedIdx];
            residualEnergy[tileIdx] += energy;
          }
        }
      }
    }

    // Write per-tile metadata using fixed stride (aligned texel offset), and
    // finalize the residual's alpha as the energy-weighted mean light distance
    const gridBuf = this.gridBuf;
    for (let t = 0; t < gridW * gridH; t++) {
      const k = t * 2;
      gridBuf[k + 0] = t * strideTexels;
      gridBuf[k + 1] = tileCounts[t];
      if (residualEnergy[t] > 0) {
        residualBuf[t * 4 + 3] /= residualEnergy[t];
      }
    }

    // Upload
    this.gridTex.needsUpdate = true;
    this.indexTex.needsUpdate = true;
    this.residualTex.needsUpdate = true;

    return bakedRangeChanged;
  }
}
