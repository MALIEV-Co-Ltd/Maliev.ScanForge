import type { Entity, Positions } from "./types";
import { admitReconstructionInputs } from "./scan-reconstruction-input";
/** Native command consumes visible raw meshes in scene order; explicit IDs narrow that set. */
export function bindNativeReconstruction(
  source: Entity,
  targetIds: string[] | undefined,
  entities: Entity[],
) {
  if (!source.visible)
    throw Error("Native reconstruction requires a visible source mesh.");
  const references =
    targetIds === undefined
      ? entities.filter(
          (e) =>
            e.id !== source.id &&
            e.visible &&
            e.kind === "mesh" &&
            !e.kernelId &&
            !e.parametric &&
            e.positions.length >= 9,
        )
      : targetIds.map((id) => {
          const entity = entities.find((e) => e.id === id);
          if (!entity)
            throw Error("Reconstruction reference no longer exists.");
          return entity;
        });
  reconstructionTargets(source, references);
  const ids = new Set([source.id, ...references.map((e) => e.id)]);
  const inputs = entities.filter((e) => ids.has(e.id));
  return { source: inputs[0], references: inputs.slice(1), inputs };
}
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
