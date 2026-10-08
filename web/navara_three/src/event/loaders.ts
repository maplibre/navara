import { ImageLoader, TextureLoader } from "three";

import { AbortableTextureLoader } from "../loaders/AbortableTextureLoader";

export const TEXTURE_LOADER = new TextureLoader();
export const ABORTABLE_TEXTURE_LOADER = new AbortableTextureLoader();
export const IMAGE_LOADER = new ImageLoader();
