import type { Entity, Positions } from "./types";
import { admitReconstructionInputs } from "./scan-reconstruction-input";
/** Resolve additional read-only scans identically for GUI and MCP. */
export function reconstructionTargets(
  source: Entity,
  targets: Entity[],
  coordinateLimit?: number,
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
  const inputs = [source, ...targets].map((e) => e.positions);
  // ShrinkWrap retains its existing pre-worker face limit.
  if (
    coordinateLimit !== undefined &&
    inputs.reduce((n, p) => n + p.length, 0) > coordinateLimit
  )
    throw new Error(
      "Combined reconstruction input exceeds the three-million-triangle processing limit.",
    );
  admitReconstructionInputs(inputs);
  return targets.map((e) => e.positions);
}
