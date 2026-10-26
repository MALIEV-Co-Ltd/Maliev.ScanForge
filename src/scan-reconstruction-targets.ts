import type { Entity, Positions } from "./types";
import {
  admitReconstructionInputs,
  admitReconstructionRecords,
  type ReconstructionInput,
} from "./scan-reconstruction-input";

export type ReconstructionMethod = "native" | "voxel";

export function nativeReconstructionReferences(
  source: Entity,
  entities: Entity[],
) {
  return entities.filter(
    (e) =>
      e.id !== source.id &&
      e.visible &&
      e.kind === "mesh" &&
      !e.kernelId &&
      !e.parametric &&
      e.positions.length >= 9,
  );
}

/** Keep implicit mesh/cloud behavior identical at the GUI and agent boundary. */
export function reconstructionMethod(
  source: Entity,
  targets: Entity[],
  requested?: ReconstructionMethod,
): ReconstructionMethod {
  if (
    requested !== undefined &&
    requested !== "native" &&
    requested !== "voxel"
  )
    throw Error("Unknown reconstruction method.");
  const points = [source, ...targets].some((e) => e.kind === "pointcloud");
  if (requested === "native" && points)
    throw Error(
      "Native reconstruction requires triangle meshes; use voxel for point clouds.",
    );
  return requested ?? (points ? "voxel" : "native");
}

/** The native command enumerates eligible visible meshes in document order. */
export function bindNativeReconstruction(
  source: Entity,
  targetIds: string[] | undefined,
  entities: Entity[],
) {
  if (!source.visible)
    throw Error("Native reconstruction requires a visible source mesh.");
  const references =
    targetIds === undefined
      ? nativeReconstructionReferences(source, entities)
      : targetIds.map((id) => {
          const entity = entities.find((e) => e.id === id);
          if (!entity)
            throw Error("Reconstruction reference no longer exists.");
          return entity;
        });
  reconstructionTargets(source, references);
  const ids = new Set([source.id, ...references.map((e) => e.id)]);
  const inputs = entities.filter((e) => ids.has(e.id));
  if (!inputs.length || inputs.length !== ids.size)
    throw Error("Reconstruction source no longer exists.");
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

/** Bind explicit record kinds from workspace geometry for reconstruction only. */
export function reconstructionScanInputs(
  source: Entity,
  targets: Entity[],
): ReconstructionInput[] {
  const entities = [source, ...targets];
  if (
    targets.length > 32 ||
    new Set(entities.map((e) => e.id)).size !== entities.length ||
    entities.some(
      (e) =>
        !["mesh", "pointcloud"].includes(e.kind) || e.kernelId || e.parametric,
    )
  )
    throw Error(
      "Reconstruction requires raw scans and up to 32 distinct additional scans.",
    );
  const records: ReconstructionInput[] = entities.map((e) => ({
    kind: e.kind === "pointcloud" ? "points" : "triangles",
    positions: e.positions,
  }));
  admitReconstructionRecords(records);
  return records.slice(1);
}
