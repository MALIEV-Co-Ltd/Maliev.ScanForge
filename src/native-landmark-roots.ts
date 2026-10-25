import { datumEntityDependencies } from "./datum-dependencies";
import { isReferenceEntity } from "./reference-entity";
import type { Entity } from "./types";

export interface NativeLandmarkRoot {
  id: string;
  visible: boolean;
  excluded: boolean;
  supported: boolean;
  excludedInterface: boolean;
  /** Child policy 822300 result, including true after a null type query. */
  exempt: boolean;
  level: number;
  ready: boolean;
  consumers: readonly (string | null)[];
  consumes: readonly string[];
}

/** Original 84be50 predicate: missing/unready children retain the candidate. */
export function collectNativeLandmarkRoots(
  roots: readonly (string | null)[],
  objects: readonly NativeLandmarkRoot[],
  visibleOnly = true,
): string[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return roots.filter((id): id is string => {
    const root = id === null ? undefined : byId.get(id);
    if (
      !root ||
      !root.supported ||
      root.excluded ||
      root.excludedInterface ||
      (visibleOnly && !root.visible)
    )
      return false;
    let higher = false,
      consuming = false;
    for (const consumerId of root.consumers) {
      const child = consumerId === null ? undefined : byId.get(consumerId);
      if (!child || !child.ready || child.excluded) return true;
      higher ||= !child.exempt && child.level > root.level;
      consuming ||= child.consumes.includes(root.id);
    }
    return !(higher && consuming);
  });
}

/** Published geometry is evaluated before entering the workspace. Update levels
 * come from the authoring DAG; browser order and visibility do not set them.
 */
export function publishedLandmarkRoots(entities: readonly Entity[]): string[] {
  const graph = datumEntityDependencies(entities);
  const consumers = new Map(
    entities.map((entity) => [entity.id, [] as string[]]),
  );
  const inputs = new Map<string, Set<string>>();
  for (const node of graph) {
    const known = new Set(
      node.references.filter((id) => id !== node.id && consumers.has(id)),
    );
    inputs.set(node.id, known);
    for (const id of known) consumers.get(id)!.push(node.id);
  }
  const levels = new Map(entities.map((entity) => [entity.id, 0]));
  const remaining = new Map([...inputs].map(([id, refs]) => [id, refs.size]));
  const pending = entities.filter((e) => !remaining.get(e.id)).map((e) => e.id);
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    for (const child of consumers.get(id)!) {
      levels.set(child, Math.max(levels.get(child)!, levels.get(id)! + 1));
      remaining.set(child, remaining.get(child)! - 1);
      if (!remaining.get(child)) pending.push(child);
    }
  }
  if (pending.length !== entities.length)
    throw new Error("Alignment target authoring dependencies contain a cycle.");
  return collectNativeLandmarkRoots(
    entities.map((entity) => entity.id),
    entities.map((entity) => ({
      id: entity.id,
      visible: entity.visible,
      excluded: false,
      supported: true,
      excludedInterface:
        !entity.kernelId && ["mesh", "pointcloud"].includes(entity.kind),
      exempt:
        isReferenceEntity(entity) ||
        ["plane", "cylinder", "cone", "sphere"].includes(entity.kind),
      level: levels.get(entity.id)!,
      ready: true,
      consumers: consumers.get(entity.id)!,
      consumes: [...inputs.get(entity.id)!],
    })),
  );
}
