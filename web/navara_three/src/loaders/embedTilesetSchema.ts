import { mergeQuery } from "./mergeQuery";

type SchemaOwner = { schema?: unknown; schemaUri?: unknown };

type TilesetJson = SchemaOwner & {
  extensions?: { "3DTILES_metadata"?: SchemaOwner };
};

/**
 * Inlines the schema a tileset JSON references by `schemaUri` as `schema`,
 * since the engine reads an inline schema only. Covers 3D Tiles 1.1 and the
 * 1.0 `3DTILES_metadata` extension. Other JSON is returned as is.
 */
export async function embedTilesetSchema(
  json: Uint8Array<ArrayBuffer>,
  url: string,
  init?: RequestInit,
): Promise<Uint8Array<ArrayBuffer>> {
  const text = new TextDecoder().decode(json);
  // Most tilesets have no `schemaUri`: skip parsing them.
  if (!text.includes('"schemaUri"')) return json;
  const tileset = JSON.parse(text) as TilesetJson;
  const owner = [tileset, tileset.extensions?.["3DTILES_metadata"]].find(
    (o) => typeof o?.schemaUri === "string" && o.schema === undefined,
  );
  if (!owner) return json;

  const schemaUrl = mergeQuery(new URL(url).search)(
    new URL(owner.schemaUri as string, url).href,
  );
  const res = await fetch(schemaUrl, init);
  if (!res.ok) {
    throw new Error(`Request failed with ${res.status} ${res.statusText}`);
  }
  owner.schema = await res.json();
  delete owner.schemaUri;
  return new TextEncoder().encode(JSON.stringify(tileset));
}
