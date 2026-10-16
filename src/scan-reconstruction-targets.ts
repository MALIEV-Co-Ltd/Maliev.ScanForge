import type { Entity, Positions } from "./types";
export const RECONSTRUCTION_MAX_COORDINATES = 27_000_000;
/** Resolve additional read-only scans identically for GUI and MCP. */
export function reconstructionTargets(
  source: Entity,
  targets: Entity[],
): Positions[] {
  if (
    targets.length > 32 ||
    new Set([source.id, ...targets.map((e) => e.id)]).size !==
      targets.length + 1 ||
    [source, ...targets].some(
      (e) =>
        e.kind !== "mesh" ||
        e.kernelId ||
        e.parametric ||
        !e.positions.length ||
        e.positions.length % 9,
    )
  )
    throw new Error(
      "Reconstruction requires a raw source mesh and up to 32 distinct additional raw meshes.",
    );
  if (
    [source, ...targets].reduce((n, e) => n + e.positions.length, 0) >
    RECONSTRUCTION_MAX_COORDINATES
  )
    throw new Error(
      "Combined reconstruction input exceeds the three-million-triangle processing limit.",
    );
  return targets.map((e) => e.positions);
}
