import { describe, expect, it } from "vitest";

import { parseUtc } from "./utc";

describe("parseUtc", () => {
  it("reads a date-time without a zone as UTC", () => {
    const utc = Date.UTC(2024, 9, 20, 21);
    expect(parseUtc("2024-10-20 21:00")).toBe(utc);
    expect(parseUtc("2024-10-20T21:00:00")).toBe(utc);
    expect(parseUtc("2024/10/20 21:00")).toBe(utc);
    expect(parseUtc("2024-10-20")).toBe(Date.UTC(2024, 9, 20));
  });

  it("reads a single-digit hour", () => {
    expect(parseUtc("2023/10/2 9:00")).toBe(Date.UTC(2023, 9, 2, 9));
    expect(parseUtc("2023/10/2 9:05:30")).toBe(Date.UTC(2023, 9, 2, 9, 5, 30));
  });

  it("keeps a zone it is given", () => {
    expect(parseUtc("2024-10-21T06:00+09:00")).toBe(Date.UTC(2024, 9, 20, 21));
    expect(parseUtc("2024-10-20T21:00:00.5Z")).toBe(
      Date.UTC(2024, 9, 20, 21, 0, 0, 500),
    );
  });

  it("is NaN for what is not a date", () => {
    expect(parseUtc("soon")).toBeNaN();
  });
});
