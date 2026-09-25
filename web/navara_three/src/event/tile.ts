import { generate_id_from_entity } from "@navaramap/core";
import {
  type MeshAdded,
  MeshChanged,
  type MeshGeometryReplaced,
} from "@navaramap/engine";

import { TileMesh } from "../mesh";

import type { EventContext } from "./context";

export async function processMeshAdded(ctx: EventContext, mesh: MeshAdded) {
  const m = new TileMesh(ctx, mesh);
  await m._init(mesh);
}

export function processMeshChanged(ctx: EventContext, mesh: MeshChanged) {
  const id = generate_id_from_entity(mesh);
  const m = ctx.meshes.get(id);
  if (!m || !(m instanceof TileMesh)) return;

  m._update(mesh);
}

export function processMeshGeometryReplaced(
  ctx: EventContext,
  ev: MeshGeometryReplaced,
) {
  const id = generate_id_from_entity(ev);
  const m = ctx.meshes.get(id);
  if (!m || !(m instanceof TileMesh)) return;

  m.replaceGeometry(ev.mesh);
}
