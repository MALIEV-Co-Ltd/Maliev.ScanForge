import type { Entity } from "./types";

/** Transfer a prepared Scale preview into a distinct mesh; retain the source. */
export function scaledMeshCopy(
  source: Entity,
  positions: Float32Array,
  id: string,
): Entity & { positions: Float32Array } {
  return transformedMeshCopy(source, positions, id, "Scale", "scaled");
}

/** Adopt a mirrored preview without inheriting stale topology or CAD metadata. */
export function mirroredMeshCopy(
  source: Entity,
  positions: Float32Array,
  id: string,
): Entity & { positions: Float32Array } {
  return transformedMeshCopy(source, positions, id, "Mirror", "mirrored");
}

function transformedMeshCopy(
  source: Entity,
  positions: Float32Array,
  id: string,
  operation: string,
  suffix: string,
): Entity & { positions: Float32Array } {
  if (source.kind !== "mesh" || source.kernelId || source.parametric)
    throw new Error(`${operation} copies require a mesh source.`);
  if (!id || id === source.id)
    throw new Error(`A ${suffix} mesh copy needs a distinct object ID.`);
  if (
    positions.length !== source.positions.length ||
    !positions.length ||
    positions.length % 9 ||
    positions.some((value) => !Number.isFinite(value))
  )
    throw new Error(`${operation} preview does not match the source mesh.`);
  return {
    id,
    name: `${source.name} (${suffix})`,
    kind: "mesh",
    positions,
    color: source.color,
    opacity: source.opacity,
    visible: true,
    source: source.source,
  };
}
