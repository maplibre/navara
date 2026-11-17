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
      lng: 139.7454123,
      lat: 35.6586123,
      height: 150.12,
      heading: 12.346,
      pitch: -10.5,
      roll: 0,
      fov: 45,
    });
  });
});

describe("parseCameraSnippet", () => {
  it("reads JSON and setCamera calls, leaving absent keys out", () => {
    expect(
      parseCameraSnippet('{"lng": 2.29, "lat": 48.8, "height": 1e3}'),
    ).toEqual({ lng: 2.29, lat: 48.8, height: 1000 });
    expect(
      parseCameraSnippet(
        "view.setCamera({ lng: -74, lat: 40.6, height: 50, pitch: -.5 })",
      ),
    ).toEqual({ lng: -74, lat: 40.6, height: 50, pitch: -0.5 });
  });

  it("needs lng, lat and height", () => {
    expect(parseCameraSnippet("{ lng: 1, lat: 2 }")).toBeNull();
  });

  it("does not read a key inside a longer name", () => {
    expect(
      parseCameraSnippet("{ startHeight: 9, lng: 1, lat: 2, height: 3 }"),
    ).toEqual({ lng: 1, lat: 2, height: 3 });
    expect(parseCameraSnippet("{ xlng: 1, lat: 2, height: 3 }")).toBeNull();
  });
});
