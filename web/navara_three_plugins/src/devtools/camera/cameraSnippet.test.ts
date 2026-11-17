import { describe, expect, it } from "vitest";

import { formatCameraSnippet, parseCameraSnippet } from "./cameraSnippet";

const CAMERA = {
  lng: 139.745412345678,
  lat: 35.658612345678,
  height: 150.123456,
  heading: 12.34567,
  pitch: -10.5,
  roll: 0,
  fov: 45,
};

describe("formatCameraSnippet", () => {
  it("rounds each key and parses back", () => {
    const text = formatCameraSnippet(CAMERA);
    expect(text).toBe(
      [
        "{",
        "  lng: 139.7454123,",
        "  lat: 35.6586123,",
        "  height: 150.12,",
        "  heading: 12.346,",
        "  pitch: -10.5,",
        "  roll: 0,",
        "  fov: 45,",
        "}",
      ].join("\n"),
    );
    expect(parseCameraSnippet(text)).toEqual({
      camera: {
        lng: 139.7454123,
        lat: 35.6586123,
        height: 150.12,
        heading: 12.346,
        pitch: -10.5,
        roll: 0,
        fov: 45,
      },
    });
  });
});

describe("parseCameraSnippet", () => {
  it("reads JSON and setCamera calls, leaving absent keys out", () => {
    expect(
      parseCameraSnippet('{"lng": 2.29, "lat": 48.8, "height": 1e3}'),
    ).toEqual({ camera: { lng: 2.29, lat: 48.8, height: 1000 } });
    expect(
      parseCameraSnippet(
        "view.setCamera({ lng: -74, lat: 40.6, height: 50, pitch: -.5 })",
      ),
    ).toEqual({ camera: { lng: -74, lat: 40.6, height: 50, pitch: -0.5 } });
    expect(parseCameraSnippet("lng: 1, lat: 2, height: +3")).toEqual({
      camera: { lng: 1, lat: 2, height: 3 },
    });
  });

  it("needs lng, lat and height", () => {
    expect(parseCameraSnippet("{ lng: 1, lat: 2 }")).toEqual({
      error: "Needs lng, lat and height",
    });
  });

  it("does not read a key inside a longer name", () => {
    expect(
      parseCameraSnippet("{ startHeight: 9, lng: 1, lat: 2, height: 3 }"),
    ).toEqual({ camera: { lng: 1, lat: 2, height: 3 } });
    expect(parseCameraSnippet("{ xlng: 1, lat: 2, height: 3 }")).toEqual({
      error: "Needs lng, lat and height",
    });
  });

  it("reads the outermost object, not nested ones", () => {
    expect(
      parseCameraSnippet(
        "{ target: { lng: 0, lat: 0, height: 0 }, lng: 139.7, lat: 35.6, height: 500 }",
      ),
    ).toEqual({ camera: { lng: 139.7, lat: 35.6, height: 500 } });
    // Keys of a nested object are not mixed into the outer one.
    expect(
      parseCameraSnippet("{ lng: 1, lat: 2, end: { height: 3, fov: 9 } }"),
    ).toEqual({ error: "Needs lng, lat and height" });
  });

  it("skips comments and string values", () => {
    expect(
      parseCameraSnippet(`{
        // lng: 0,
        /* lat: 0, height: 0 */
        name: "lng: 5",
        lng: 1, lat: 2, height: 3,
      }`),
    ).toEqual({ camera: { lng: 1, lat: 2, height: 3 } });
  });

  it("rejects values out of range", () => {
    expect(parseCameraSnippet("{ lng: 1, lat: 95, height: 3 }")).toEqual({
      error: "lat out of range",
    });
    expect(parseCameraSnippet("{ lng: 1, lat: 2, height: -1e9 }")).toEqual({
      error: "height out of range",
    });
    expect(
      parseCameraSnippet("{ lng: 1, lat: 2, height: 3, pitch: 1e999 }"),
    ).toEqual({ error: "pitch out of range" });
    expect(parseCameraSnippet("{ lng: 1, lat: 2, height: 3, fov: 0 }")).toEqual(
      { error: "fov out of range" },
    );
  });
});
