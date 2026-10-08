import type { createDecoderModule } from "draco3d";

/** The decoder-only entry of `draco3d`; its main entry also bundles the encoder. */
declare const createDracoDecoderModule: typeof createDecoderModule;
export default createDracoDecoderModule;
