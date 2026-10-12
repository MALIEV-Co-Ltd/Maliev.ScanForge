import type { Entity } from "./types";
/** A deliberate tessellated copy leaves the source BRep and native handle intact. */
export function scanMeshCopy(source: Entity, id: string): Entity {
  return {
    id,
    name: `${source.name} — mesh copy`,
    kind: "mesh",
    positions: source.positions.slice(),
    color: source.color,
    visible: true,
    opacity: source.opacity,
    source: source.source,
  };
}
