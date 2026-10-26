import type { BillboardMesh as NavaraBillboardMesh } from "@navaramap/engine";

import { InstancedSpriteMesh } from "../../mesh";
import { FEATURE_RENDER_ORDER } from "../../renderOrder";
import type { EventContext } from "../context";

export async function renderBillboard(
  ctx: EventContext,
  m: NavaraBillboardMesh,
  pairGroup?: number,
) {
  // No `url` check: a billboard layer may carry no material-level image and
  // get every image per-feature from a FeatureEvaluator (`{ image }`). The
  // mesh starts with empty atlas rects, which the shader culls, so instances
  // stay invisible until an image is packed for them.
  const mesh = new InstancedSpriteMesh({
    renderOrder: FEATURE_RENDER_ORDER,
    ctx,
    geometryType: "billboard",
    pairGroup,
  });
  await mesh._init(m);
  mesh.setActive(m.active);

  return mesh;
}

export async function processBillboardChanged(
  obj: InstancedSpriteMesh,
  m: NavaraBillboardMesh,
  active: boolean,
) {
  await obj._update(m);
  obj.setActive(active);
}
