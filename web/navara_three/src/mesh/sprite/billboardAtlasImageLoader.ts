import { TEXTURE_LOADER } from "../../event/loaders";
import { getImageDataFromImageBitmap } from "../../tasks/getImageDataFromImageBitmap";

import type { LoadAtlasImage } from "./billboardAtlas";
import type { LoadSpriteSheet } from "./spriteCache";

/**
 * Browser decode pipeline for `BillboardAtlas`: fetch via the shared texture
 * loader, rasterize to RGBA off the main thread. Lives outside billboardAtlas
 * so the atlas itself stays importable in worker-free environments (tests).
 *
 * flipY at decode matches the previous DataArrayTexture path: row 0 of the
 * pixel data is the bottom of the image, i.e. v = 0 in the atlas texture.
 */
export const loadAtlasImageFromUrl: LoadAtlasImage = async (url) => {
  const texture = await TEXTURE_LOADER.loadAsync(url);
  try {
    const img = texture.image as HTMLImageElement | ImageBitmap;
    const width = img.width;
    const height = img.height;

    const data = await getImageDataFromImageBitmap(
      await createImageBitmap(img, { imageOrientation: "flipY" }),
      new OffscreenCanvas(width, height),
    );
    return { width, height, data: new Uint8Array(data) };
  } finally {
    texture.dispose();
  }
};

/** Browser loader for `SpriteCache`: the sheet's JSON index and its image. */
export const loadSpriteSheetFromUrl: LoadSpriteSheet = async (urls) => {
  const [index, image] = await Promise.all([
    fetch(urls.json).then((response) => {
      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${urls.json}: ${response.status} ${response.statusText}`,
        );
      }
      return response.json() as Promise<unknown>;
    }),
    loadAtlasImageFromUrl(urls.image),
  ]);
  return { index, image };
};
