import type { Entity, IndexedMesh } from "./types";
import type { ProjectSession } from "./project-file-codec";
import { cacheScanRenderData, scanRenderData } from "./scan-render-data";
import { executeRenderPreparation } from "./scan-render-preparation";
/** Runs inside the decoder worker, or the non-browser test/CLI path. */
export function prepareRestoredScanDisplays(
  entities: readonly Entity[],
  signal?: AbortSignal,
): Entity[] {
  const preparedMeshes = new Map<IndexedMesh, IndexedMesh>();
  const preparedEntities = new Map<Entity, Entity>();
  return entities.map((original) => {
    signal?.throwIfAborted();
    const existing = preparedEntities.get(original);
    if (existing) return existing;
    const oldMesh = original.indexedMesh;
    const preparedMesh = oldMesh && preparedMeshes.get(oldMesh);
    let entity = preparedMesh
      ? { ...original, indexedMesh: preparedMesh }
      : original;
    if (
      entity.kind === "mesh" &&
      !entity.kernelId &&
      entity.positions.length &&
      (!scanRenderData(entity.positions) ||
        scanRenderData(entity.positions)?.indexedMesh !== entity.indexedMesh ||
        (entity.indexedMesh &&
          !(entity.indexedMesh.facetNormals instanceof Float32Array)))
    ) {
      const data = executeRenderPreparation(entity, signal);
      cacheScanRenderData(entity.positions, data);
      if (data.indexedMesh && data.indexedMesh !== entity.indexedMesh)
        entity = { ...entity, indexedMesh: data.indexedMesh };
    }
    if (oldMesh && entity.indexedMesh && oldMesh !== entity.indexedMesh)
      preparedMeshes.set(oldMesh, entity.indexedMesh);
    preparedEntities.set(original, entity);
    return entity;
  });
}

/** Initialize current geometry only, preserving exact aliases in the decoded
 * timeline. History-only meshes remain lazy and no source descriptor is mutated. */
export function prepareRestoredProjectDisplays(
  session: ProjectSession,
  signal?: AbortSignal,
): ProjectSession {
  const current = prepareRestoredScanDisplays(session.project.entities, signal);
  const meshes = new Map<IndexedMesh, IndexedMesh>();
  const entities = new Map<Entity, Entity>();
  session.project.entities.forEach((source, index) => {
    const prepared = current[index];
    entities.set(source, prepared);
    if (
      source.indexedMesh &&
      prepared.indexedMesh &&
      source.indexedMesh !== prepared.indexedMesh
    )
      meshes.set(source.indexedMesh, prepared.indexedMesh);
  });
  const entity = (source: Entity): Entity => {
    signal?.throwIfAborted();
    const existing = entities.get(source);
    if (existing) return existing;
    const mesh = source.indexedMesh && meshes.get(source.indexedMesh);
    const prepared = mesh ? { ...source, indexedMesh: mesh } : source;
    entities.set(source, prepared);
    return prepared;
  };
  const revisions = (items: ProjectSession["history"]) =>
    items.map((revision) => ({
      ...revision,
      entities: revision.entities.map(entity),
    }));
  signal?.throwIfAborted();
  return {
    ...session,
    project: { ...session.project, entities: current },
    history: revisions(session.history),
    future: revisions(session.future),
  };
}
