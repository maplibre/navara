import { afterEach, describe, expect, it, vi } from "vitest";

import { embedTilesetSchema } from "./embedTilesetSchema";

const encode = (json: unknown) =>
  new TextEncoder().encode(JSON.stringify(json));
const decode = (bytes: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(bytes)) as unknown;

describe("embedTilesetSchema", () => {
  const schema = { classes: { tileset: {} } };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("inlines the schema of a 1.1 tileset", async () => {
    const fetch = vi.fn(async () => Response.json(schema));
    vi.stubGlobal("fetch", fetch);

    const json = await embedTilesetSchema(
      encode({ asset: { version: "1.1" }, schemaUri: "schema.json" }),
      "https://example.com/t/tileset.json?key=1",
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/t/schema.json?key=1",
      undefined,
    );
    expect(decode(json)).toEqual({ asset: { version: "1.1" }, schema });
  });

  it("inlines the schema of the 1.0 3DTILES_metadata extension", async () => {
    vi.stubGlobal("fetch", async () => Response.json(schema));

    const json = await embedTilesetSchema(
      encode({
        extensions: { "3DTILES_metadata": { schemaUri: "schema.json" } },
      }),
      "https://example.com/tileset.json",
    );

    expect(decode(json)).toEqual({
      extensions: { "3DTILES_metadata": { schema } },
    });
  });

  it("returns a tileset without schemaUri as is", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tileset = encode({ asset: { version: "1.1" } });

    expect(
      await embedTilesetSchema(tileset, "https://example.com/tileset.json"),
    ).toBe(tileset);
    expect(fetch).not.toHaveBeenCalled();
  });
});
