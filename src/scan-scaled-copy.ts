import type { Entity } from "./types";

/** Transfer a prepared Scale preview into a distinct mesh; retain the source. */
export function scaledMeshCopy(
  source: Entity,
  positions: Float32Array,
  id: string,
): Entity & { positions: Float32Array } {
  if (source.kind !== "mesh" || source.kernelId || source.parametric)
    throw new Error("Scale copies require a mesh source.");
  if (!id || id === source.id)
    throw new Error("A scaled mesh copy needs a distinct object ID.");
  if (
    positions.length !== source.positions.length ||
    !positions.length ||
    positions.length % 9 ||
    positions.some((value) => !Number.isFinite(value))
  )
    throw new Error("Scale preview does not match the source mesh.");
  return {
    id,
    name: `${source.name} (scaled)`,
    kind: "mesh",
    positions,
    color: source.color,
    opacity: source.opacity,
    visible: true,
    source: source.source,
  };
}
