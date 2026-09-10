/// <reference lib="webworker" />

import init, {
  type FontAtlas,
  FontCache,
  composite_key,
  type ShapeTextResult as WasmShapeTextResult,
  type WasmShapedGlyph,
  type WasmGlyphMetrics,
} from "@navaramap/engine-font-worker";

let fontCache: FontCache;
/** WASM linear memory, kept from init() for heap-size reporting. */
let wasmMemory: WebAssembly.Memory | undefined;

async function ensureWasm(): Promise<void> {
  if (!fontCache) {
    const output = await init();
    wasmMemory = output.memory;
    fontCache = new FontCache();
  }
}

function convertGlyphs(glyphs: WasmShapedGlyph[]) {
  return glyphs.map((g) => {
    const out = {
      glyphId: g.glyph_id,
      fontIndex: g.font_index,
      compositeKey: composite_key(g.font_index, g.glyph_id),
      xAdvance: g.x_advance,
      yAdvance: g.y_advance,
      xOffset: g.x_offset,
      yOffset: g.y_offset,
      charClass: g.char_class,
    };
    g.free();
    return out;
  });
}

function convertMetrics(metrics: WasmGlyphMetrics[]) {
  return metrics.map((m) => {
    const out = {
      glyphId: m.glyph_id,
      fontIndex: m.font_index,
      compositeKey: composite_key(m.font_index, m.glyph_id),
      atlasX: m.atlas_x,
      atlasY: m.atlas_y,
      atlasW: m.atlas_w,
      atlasH: m.atlas_h,
      bearingX: m.bearing_x,
      bearingY: m.bearing_y,
      isColor: m.is_color,
    };
    m.free();
    return out;
  });
}

function convertShapeResult(sr: WasmShapeTextResult | undefined) {
  if (!sr) return null;
  const result = {
    glyphs: convertGlyphs(sr.glyphs),
    metrics: convertMetrics(sr.metrics),
    unitsPerEm: sr.units_per_em,
    ascender: sr.ascender,
    descender: sr.descender,
    lineGap: sr.line_gap,
  };
  sr.free();
  return result;
}

/** Take a transferable snapshot of `atlas` and free the WASM-owned object. */
function snapshot(atlas: FontAtlas | undefined) {
  if (!atlas) return null;
  const out = {
    data: atlas.data.buffer,
    width: atlas.width,
    height: atlas.height,
    channels: atlas.channels,
  };
  atlas.free();
  return out;
}

type FontWorkerMessageType =
  | "init"
  | "loadFont"
  | "unloadFont"
  | "prepareTextBatch"
  | "retainGlyphs"
  | "releaseGlyphs"
  | "getMemoryStats";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  const id: number = msg.id;
  const msgType: FontWorkerMessageType = msg.type;

  try {
    await ensureWasm();

    switch (msgType) {
      case "init": {
        // Used to await worker readiness; optionally delivers the memory
        // budget (font data + atlas pixels; caps further atlas growth).
        const fontBudgetBytes = (
          msg.payload as { fontBudgetBytes?: number } | undefined
        )?.fontBudgetBytes;
        fontCache.setBudget(fontBudgetBytes);
        ctx.postMessage({ id, type: "result", payload: null });
        break;
      }

      case "getMemoryStats": {
        const stats = fontCache.memoryStats();
        const payload = {
          heapBytes: wasmMemory?.buffer.byteLength ?? 0,
          fontCount: stats.fontCount,
          atlasCount: stats.atlasCount,
          glyphCount: stats.glyphCount,
          fontBytes: stats.fontBytes,
          atlasBytes: stats.atlasBytes,
          colorAtlasBytes: stats.colorAtlasBytes,
          budgetBytes: stats.budgetBytes === 0 ? undefined : stats.budgetBytes,
        };
        stats.free();
        ctx.postMessage({ id, type: "result", payload });
        break;
      }

      case "loadFont": {
        const { url, data, atlasKey, highQuality } = msg.payload as {
          url: string;
          data: ArrayBuffer;
          atlasKey?: string;
          highQuality: boolean;
        };
        const bytes = new Uint8Array(data);
        // Map TS quality → WASM mode string. `false` is treated as the SDF
        // path by the Rust side (see `wasm_load_font`).
        const mode = highQuality ? "msdf" : "sdf";
        // On success the worker returns the font's cmap coverage as
        // flattened [from, to, ...] ranges so the FontManager can correct a
        // face's declared unicode ranges once per file.
        const wasmRanges =
          fontCache.loadFont(
            url,
            bytes.length,
            (buf: Uint8Array) => {
              buf.set(bytes);
            },
            atlasKey,
            mode,
          ) ?? null;
        // Copy before transferring: if the returned array is a view into
        // WASM memory, transferring its buffer would detach the whole heap.
        const cmapRanges = wasmRanges ? new Uint32Array(wasmRanges) : null;
        ctx.postMessage(
          {
            id,
            type: "result",
            payload: { ok: cmapRanges !== null, cmapRanges },
          },
          cmapRanges ? [cmapRanges.buffer] : [],
        );
        break;
      }

      case "unloadFont": {
        const { url } = msg.payload as { url: string };
        const ok = fontCache.unloadFont(url);
        ctx.postMessage({ id, type: "result", payload: { ok } });
        break;
      }

      case "prepareTextBatch": {
        const { fontUrl, texts } = msg.payload as {
          fontUrl: string;
          texts: string[];
        };

        let sdfAtlasChanged = false;
        let colorAtlasChanged = false;
        let evicted = false;
        const results = texts.map((text) => {
          const sr = fontCache.shapeText(fontUrl, text);
          if (sr?.atlas_changed) {
            if (sr.is_color) colorAtlasChanged = true;
            else sdfAtlasChanged = true;
          }
          // Read `evicted` before convertShapeResult frees the WASM result.
          if (sr?.evicted) evicted = true;
          return { text, shapeResult: convertShapeResult(sr) };
        });

        // Snapshot atlases by atlas key (family name or URL) so shared atlases
        // are returned correctly for font-family faces.
        const atlasKey = fontCache.getAtlasKey(fontUrl) ?? fontUrl;
        const atlas = sdfAtlasChanged
          ? snapshot(fontCache.getFontAtlas(atlasKey))
          : null;
        const colorAtlas = colorAtlasChanged
          ? snapshot(fontCache.getColorAtlas(atlasKey))
          : null;

        const transfers: Transferable[] = [];
        if (atlas) transfers.push(atlas.data);
        if (colorAtlas) transfers.push(colorAtlas.data);
        ctx.postMessage(
          {
            id,
            type: "result",
            payload: { results, atlas, colorAtlas, atlasKey, evicted },
          },
          transfers,
        );
        break;
      }

      case "retainGlyphs":
      case "releaseGlyphs": {
        const { atlasKey, keys } = msg.payload as {
          atlasKey: string;
          keys: BigUint64Array;
        };
        if (msgType === "retainGlyphs") {
          fontCache.retainGlyphs(atlasKey, keys);
        } else {
          fontCache.releaseGlyphs(atlasKey, keys);
        }
        ctx.postMessage({ id, type: "result", payload: null });
        break;
      }

      default: {
        ctx.postMessage({
          id,
          type: "error",
          payload: { message: `Unknown message type: ${msgType}` },
        });
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({
      id,
      type: "error",
      payload: { message: String(err) },
    });
  }
};
