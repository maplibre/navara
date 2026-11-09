import {
  Mesh,
  PerspectiveCamera,
  Scene,
  type Vector3,
  type WebGLRenderer,
} from "three";
import { describe, expect, it, vi } from "vitest";

import type { Scenes } from "../scene";

import { SkyEnvMapPass } from "./SkyEnvMapPass";

// The projection comes from WASM, whose math the Rust unit tests cover. The
// camera stays near the equator, where a sphere of the semi-major axis is the
// ellipsoid.
vi.mock("@navaramap/three-api", () => ({
  scaleToGeodeticSurface: (position: Vector3) =>
    position.clone().setLength(6378137),
}));

/** 1 km above the equator. */
const START = { x: 6378137 + 1000, y: 0, z: 0 };

function setup() {
  const skyEnvMap = new Scene();
  skyEnvMap.add(new Mesh());
  const camera = new PerspectiveCamera();
  camera.position.set(START.x, START.y, START.z);
  const pass = new SkyEnvMapPass({ skyEnvMap } as unknown as Scenes, camera);
  const internals = pass as unknown as {
    cubeCamera: { update: () => void };
    renderFace: () => void;
  };
  const fullUpdate = vi
    .spyOn(internals.cubeCamera, "update")
    .mockImplementation(() => {});
  const renderFace = vi
    .spyOn(internals, "renderFace")
    .mockImplementation(() => {});
  const render = () => pass.render({} as unknown as WebGLRenderer, null, null);
  return { pass, camera, render, fullUpdate, renderFace };
}

describe("SkyEnvMapPass", () => {
  it("renders the whole cube first, then one face per frame", () => {
    const { render, fullUpdate, renderFace } = setup();

    render();
    render();
    render();

    expect(fullUpdate).toHaveBeenCalledTimes(1);
    expect(renderFace).toHaveBeenCalledTimes(2);
  });

  it("keeps refreshing one face per frame while the camera moves a little", () => {
    const { camera, render, fullUpdate, renderFace } = setup();
    render();

    // 20 m at 1 km height.
    camera.position.y += 20;
    render();

    expect(fullUpdate).toHaveBeenCalledTimes(1);
    expect(renderFace).toHaveBeenCalledTimes(1);
  });

  it("renders the whole cube again once the camera travels far for its height", () => {
    const { camera, render, fullUpdate } = setup();
    render();

    // 200 m at 1 km height.
    camera.position.y += 200;
    render();

    expect(fullUpdate).toHaveBeenCalledTimes(2);
  });

  it("renders the whole cube again once invalidated", () => {
    const { pass, render, fullUpdate, renderFace } = setup();
    render();
    render();

    pass.invalidate();
    render();

    expect(fullUpdate).toHaveBeenCalledTimes(2);
    expect(renderFace).toHaveBeenCalledTimes(1);
  });
});
