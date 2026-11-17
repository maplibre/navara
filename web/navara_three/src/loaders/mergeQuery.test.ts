import { describe, expect, it } from "vitest";

import { mergeQuery } from "./mergeQuery";

describe("mergeQuery", () => {
  const modify = mergeQuery("key=base&session=s");

  it("keeps parameters the URL already has", () => {
    expect(modify("https://example.com/a/tex.png?key=own")).toBe(
      "https://example.com/a/tex.png?key=own&session=s",
    );
  });

  it("keeps the existing query as written", () => {
    expect(modify("https://example.com/a/tex.png?sig=a/b%20c")).toBe(
      "https://example.com/a/tex.png?sig=a/b%20c&key=base&session=s",
    );
  });

  it("leaves blob: and data: URLs untouched", () => {
    expect(modify("blob:https://example.com/0f8c")).toBe(
      "blob:https://example.com/0f8c",
    );
    expect(modify("data:image/png;base64,AA==")).toBe(
      "data:image/png;base64,AA==",
    );
  });
});
