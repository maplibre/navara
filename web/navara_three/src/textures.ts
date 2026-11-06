// TODO: Provide an API to specify these settings for each material.
export type TextureOptions = {
  maxAnisotropy: number;
  minFilter: number;
  magFilter: number;
  useMipmaps: boolean;
  maxTextures: number;
  // Automatically tracked - which additional textures are in use
  additionalTexturesInUse?: {
    colorMapTexture?: boolean;
  };
};
