import type { Entity, IndexedMesh, Positions } from "./types";

export const AVERAGE_MAX_COORDINATES = 27_000_000;

/** Admit all coordinate carriers before worker transport allocates their copies. */
export function admitAverageInputs(
  source: Positions,
  targets: readonly Positions[],
  sourceTopology?: IndexedMesh,
  targetTopology?: readonly (IndexedMesh | undefined)[],
) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 32)
    throw new Error("Choose between 1 and 32 reference meshes.");
  if (targetTopology && targetTopology.length !== targets.length)
    throw new Error(
      "Average topology must correspond to every reference mesh.",
    );
  if (
    targets.reduce(
      (count, positions) => count + positions.length,
      source.length,
    ) > AVERAGE_MAX_COORDINATES
  )
    throw new Error(
      "Combined meshes exceed the 3 million triangle processing limit.",
    );
  if (
    (sourceTopology?.vertices.length ?? 0) +
      (targetTopology?.reduce(
        (count, mesh) => count + (mesh?.vertices.length ?? 0),
        0,
      ) ?? 0) >
    AVERAGE_MAX_COORDINATES
  )
    throw new Error(
      "Indexed reference vertices exceed the Average processing limit.",
    );
}

/** Native Average copies the first selected mesh with the greatest facet count. */
export function bindAverageMeshes(
  selected: Entity,
  targetIds: readonly string[],
  entities: readonly Entity[],
) {
  if (
    !Array.isArray(targetIds) ||
    !targetIds.length ||
    targetIds.length > 32 ||
    targetIds.some((id) => typeof id !== "string" || id === selected.id) ||
    new Set(targetIds).size !== targetIds.length
  )
    throw new Error(
      "Choose one to 32 distinct reference meshes, excluding the selected mesh.",
    );
  const ids = new Set([selected.id, ...targetIds]);
  const inputs = entities.filter((entity) => ids.has(entity.id));
  if (
    inputs.length !== ids.size ||
    inputs.some(
      (entity) =>
        entity.kind !== "mesh" ||
        entity.kernelId ||
        entity.parametric ||
        !entity.positions.length ||
        entity.positions.length % 9,
    )
  )
    throw new Error("Choose valid raw reference meshes to average.");
  const source = inputs.reduce((largest, entity) =>
    entity.positions.length > largest.positions.length ? entity : largest,
  );
  const references = inputs.filter((entity) => entity !== source);
  admitAverageInputs(
    source.positions,
    references.map((entity) => entity.positions),
    source.indexedMesh,
    references.map((entity) => entity.indexedMesh),
  );
  return { source, references };
}
