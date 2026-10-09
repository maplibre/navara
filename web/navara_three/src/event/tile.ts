import { generate_id_from_entity } from "@navaramap/core";
import {
  type MeshAdded,
  MeshChanged,
  type MeshGeometryReplaced,
  type TerrainExaggerationUpdatedEvent,
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

/**
 * The GPU displaces terrain vertices through the shared exaggeration uniform
 * and horizon-culls against the shared shrunk ellipsoid, so a change only
 * needs those uniforms and the tiles' culling bounds updated.
 */
export function processTerrainExaggerationUpdated(
  ctx: EventContext,
  ev: TerrainExaggerationUpdatedEvent | undefined,
) {
  if (!ev) return;
  ctx.uniforms.terrainExaggeration.value = [ev.scale, ev.relative_height];
  ctx.uniforms.horizonMinHeight.value = ev.horizon_minimum_height;
  for (const tile of ctx.tileMapByHandle.values()) {
    tile.updateTerrainExaggeration();
  }
}
