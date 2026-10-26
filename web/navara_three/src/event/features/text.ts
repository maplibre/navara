import { type TextMesh as NavaraTextMesh } from "@navaramap/engine";

import { BatchedSdfTextMesh } from "../../mesh";
import { FEATURE_RENDER_ORDER } from "../../renderOrder";
import type { EventContext } from "../context";

export async function renderText(
  ctx: EventContext,
  m: NavaraTextMesh,
  layerId: string,
  pairGroup?: number,
) {
  const { fontManager } = ctx;
  const fontUrl = m.material.font;
  if (!fontUrl || fontUrl === "") {
    console.warn(
      "material.font is required for text rendering but was not set.",
    );
    return;
  }

  // Use SDF pipeline when a font URL is specified and FontManager is available
  if (fontManager) {
    try {
      // Load font(s) then shape the text so the cache is populated before mesh construction.
      // For font families, only the face URLs needed for `text` are loaded (lazy).
      // For raw URLs, the single font file is loaded directly.
      const text = m.material.text ?? "";
      const highQuality = m.material.highQuality ?? false;
      const loadedFaceUrls = new Set<string>();
      if (fontManager.isFamily(fontUrl)) {
        if (text)
          await fontManager.prepareText(
            fontUrl,
            text,
            highQuality,
            loadedFaceUrls,
          );
      } else {
        await fontManager.loadFont(fontUrl, highQuality);
        if (text) await fontManager.prepareText(fontUrl, text, highQuality);
      }

      const textGroup = new BatchedSdfTextMesh(
        ctx,
        m,
        fontUrl,
        {
          renderOrder: FEATURE_RENDER_ORDER,
          layerId,
          pairGroup,
        },
        loadedFaceUrls,
      );
      textGroup.setActive(m.active);

      return textGroup;
    } catch (e) {
      console.warn(`Failed to load or prepare font "${fontUrl}". Error:`, e);
    }
  }
}

export async function processTextChanged(
  obj: BatchedSdfTextMesh,
  m: NavaraTextMesh,
  active: boolean,
) {
  await obj._update(m, () => {
    obj.ctx.renderFlag.forceUpdate = true;
  });
  obj.setActive(active);
}
