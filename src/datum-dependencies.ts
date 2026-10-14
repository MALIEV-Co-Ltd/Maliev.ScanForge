import type { Entity } from "./types";
import { featureDependencies } from "./parametric";

export interface DatumDependencyCandidate {
  id: string;
  references: readonly string[];
  eligible: boolean;
  excluded: boolean;
}

/** Original collector ordering and transitive relation; iteration bounds cycles. */
export function nativeDatumDependentCandidates(
  candidates: readonly DatumDependencyCandidate[],
  seeds: readonly string[],
): string[] {
  const known = new Set(candidates.map((candidate) => candidate.id));
  const reverse = new Map<string, Set<string>>();
  for (const candidate of candidates)
    for (const reference of candidate.references) {
      if (reference === candidate.id || !known.has(reference)) continue;
      const dependents = reverse.get(reference) ?? new Set<string>();
      dependents.add(candidate.id);
      reverse.set(reference, dependents);
    }
  const related = new Set<string>(),
    visited = new Set<string>();
  const pending = [...seeds];
  while (pending.length) {
    const reference = pending.pop()!;
    if (visited.has(reference)) continue;
    visited.add(reference);
    for (const dependent of reverse.get(reference) ?? []) {
      related.add(dependent);
      pending.push(dependent);
    }
  }
  return candidates
    .filter(
      (candidate) =>
        candidate.eligible && !candidate.excluded && related.has(candidate.id),
    )
    .map((candidate) => candidate.id);
}

export function datumEntityDependencies(
  entities: readonly Entity[],
): DatumDependencyCandidate[] {
  const outputs = new Map<string, string[]>();
  const key = (featureId: string, output: number) =>
    JSON.stringify([featureId, output]);
  for (const entity of entities) {
    if (!entity.parametric) continue;
    const identity = key(
      entity.parametric.feature.id,
      entity.parametric.output,
    );
    const ids = outputs.get(identity) ?? [];
    ids.push(entity.id);
    outputs.set(identity, ids);
  }
  return entities.map((entity) => ({
    id: entity.id,
    references: [
      ...(entity.surfaceScanId ? [entity.surfaceScanId] : []),
      ...(entity.parametric
        ? featureDependencies(entity.parametric.feature.recipe).flatMap(
            (reference) =>
              outputs.get(key(reference.featureId, reference.output ?? 0)) ??
              [],
          )
        : []),
    ],
    eligible:
      !!entity.kernelId || !["mesh", "pointcloud"].includes(entity.kind),
    excluded: !entity.kernelId && ["mesh", "pointcloud"].includes(entity.kind),
  }));
}
