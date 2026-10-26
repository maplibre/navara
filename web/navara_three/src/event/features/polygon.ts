import type { PolygonMesh as NavaraPolygonMesh } from "@navaramap/engine";

import { PolygonMesh } from "../../mesh";
import type { EventContext } from "../context";

export async function renderPolygon(
  ctx: EventContext,
  mesh: NavaraPolygonMesh,
  layerId: string,
) {
  return new PolygonMesh(ctx, layerId).init(mesh);
}

export function processPolygonChanged(
  obj: PolygonMesh,
  m: NavaraPolygonMesh,
  active: boolean,
) {
  obj._update(m.material, active, m.should_be_texturized);
}
