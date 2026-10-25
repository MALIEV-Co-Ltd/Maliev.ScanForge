import type { Entity } from "./types";
import { assertSampledGeometry } from "./reference-entity";
/** Leave native CAD intact. Supplied immutable output is adopted by reference;
 * omitting it preserves independent-copy semantics. */
export function scanMeshCopy(
  source: Entity,
  id: string,
  positions?: Entity["positions"],
): Entity {
  assertSampledGeometry(source);
  return {
    id,
    name: `${source.name} — mesh copy`,
    kind: "mesh",
    positions: positions ?? source.positions.slice(),
    color: source.color,
    visible: true,
    opacity: source.opacity,
    source: source.source,
  };
}
