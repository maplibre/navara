import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
} from "three";

/**
 * Manages a 2D texture atlas for multiple elevation heatmap colorMaps.
 * Each colorMap occupies one row of the texture, allowing multiple layers
 * to use different color mappings.
 */
export class ColorMapAtlas {
  private colorMaps = new Map<string, Float32Array>();
  private texture: DataTexture | null = null;
  private needsRebuild = true;

  /**
   * Register a colorMap for a specific layer.
   * @param layerId - Unique identifier for the layer
   * @param colorMapData - Flattened RGB array [r0,g0,b0, r1,g1,b1, ...]
   */
  setColorMap(layerId: string, colorMapData: Float32Array | undefined): void {
    if (!colorMapData || colorMapData.length === 0) {
      this.colorMaps.delete(layerId);
    } else {
      this.colorMaps.set(layerId, colorMapData);
    }
    this.needsRebuild = true;
  }

  /**
   * Remove a layer's colorMap from the atlas.
   * @param layerId - Layer identifier to remove
   */
  removeColorMap(layerId: string): void {
    if (this.colorMaps.delete(layerId)) {
      this.needsRebuild = true;
    }
  }

  /**
   * Get the normalized row index (0-1) for a specific layer.
   * Returns the center Y coordinate of the layer's row.
   * Uses insertion order (Map preserves insertion order in JavaScript).
   * @param layerId - Layer identifier
   * @returns Normalized Y coordinate, or undefined if layer not found
   */
  getRowIndex(layerId: string): number | undefined {
    if (this.colorMaps.size === 0) return undefined;

    // Use insertion order, not sorted order
    const layerIds = Array.from(this.colorMaps.keys());
    const rowIndex = layerIds.indexOf(layerId);
    if (rowIndex === -1) return undefined;

    // Return center of the row: (rowIndex + 0.5) / totalRows
    return (rowIndex + 0.5) / this.colorMaps.size;
  }

  /**
   * Build or rebuild the 2D texture atlas.
   * @returns The DataTexture, or null if no colorMaps are registered
   */
  getTexture(): DataTexture | null {
    if (!this.needsRebuild && this.texture) {
      return this.texture;
    }

    if (this.colorMaps.size === 0) {
      this.texture?.dispose();
      this.texture = null;
      this.needsRebuild = false;
      return null;
    }

    // Use insertion order for row assignment (Map preserves insertion order)
    const layerIds = Array.from(this.colorMaps.keys());

    // Find maximum width (all colorMaps may have different lengths)
    let maxWidth = 0;
    for (const colorMap of this.colorMaps.values()) {
      const width = colorMap.length / 3; // RGB components
      if (width > maxWidth) maxWidth = width;
    }

    const height = this.colorMaps.size;

    // Build 2D texture data with RGBA format (alpha = 1.0 for all pixels)
    const data = new Float32Array(maxWidth * height * 4);

    layerIds.forEach((layerId, rowIndex) => {
      const colorMap = this.colorMaps.get(layerId);
      if (!colorMap) return; // Skip if colorMap not found (shouldn't happen)
      const rowOffset = rowIndex * maxWidth * 4;

      // Copy colorMap data to this row (RGB -> RGBA)
      const numPixels = colorMap.length / 3;

      // Fill the entire row width by repeating the last color for any remaining pixels
      for (let i = 0; i < maxWidth; i++) {
        // If beyond the colorMap length, clamp to the last color
        const srcIndex = Math.min(i, numPixels - 1);
        data[rowOffset + i * 4 + 0] = colorMap[srcIndex * 3 + 0]; // R
        data[rowOffset + i * 4 + 1] = colorMap[srcIndex * 3 + 1]; // G
        data[rowOffset + i * 4 + 2] = colorMap[srcIndex * 3 + 2]; // B
        data[rowOffset + i * 4 + 3] = 1.0; // A
      }
    });

    // Dispose old texture
    this.texture?.dispose();

    // Create new DataTexture with RGBA format for WebGL compatibility
    this.texture = new DataTexture(
      data,
      maxWidth,
      height,
      RGBAFormat,
      FloatType,
    );
    this.texture.colorSpace = LinearSRGBColorSpace; // Linear color space for float textures
    this.texture.wrapS = ClampToEdgeWrapping; // Prevent wrapping in X (elevation axis)
    this.texture.wrapT = ClampToEdgeWrapping; // Prevent wrapping in Y (layer axis)
    this.texture.minFilter = LinearFilter; // Smooth interpolation between colors
    this.texture.magFilter = LinearFilter;
    this.texture.needsUpdate = true;

    this.needsRebuild = false;
    return this.texture;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.colorMaps.clear();
  }
}
