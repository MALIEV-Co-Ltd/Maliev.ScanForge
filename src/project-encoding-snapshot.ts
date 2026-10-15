import type { Entity } from "./types";
import type { ProjectSession } from "./project-file";
import { cloudPlacement, placedCloud } from "./point-cloud-placement";

export interface ProjectEncodingSnapshot {
  session: ProjectSession;
  localClouds: Entity[];
}

/** Preserve local cloud buffers without invoking their lazy world-coordinate getters. */
export function projectEncodingSnapshot(
  session: ProjectSession,
): ProjectEncodingSnapshot {
  const cache = new Map<Entity, Entity>();
  const localClouds: Entity[] = [];
  const entity = (source: Entity) => {
    if (cache.has(source)) return cache.get(source)!;
    const placement = cloudPlacement(source);
    let result = source;
    if (placement) {
      const metadata = Object.fromEntries(
        Object.keys(source)
          .filter((key) => key !== "positions" && key !== "normals")
          .map((key) => [key, source[key as keyof Entity]]),
      );
      result = {
        ...metadata,
        positions: placement.sourcePositions,
        normals: placement.sourceNormals,
      } as Entity;
      localClouds.push(result);
    }
    cache.set(source, result);
    return result;
  };
  return {
    localClouds,
    session: {
      ...session,
      project: {
        ...session.project,
        entities: session.project.entities.map(entity),
      },
      history: session.history.map((r) => ({
        ...r,
        entities: r.entities.map(entity),
      })),
      future: session.future.map((r) => ({
        ...r,
        entities: r.entities.map(entity),
      })),
    },
  };
}

/** Restore validated placement identity lost at the structured-clone boundary. */
export function restoreEncodingSnapshot(
  snapshot: ProjectEncodingSnapshot,
): ProjectSession {
  const { session } = snapshot;
  const localClouds = new Set(snapshot.localClouds);
  const cache = new Map<Entity, Entity>();
  const entity = (source: Entity) => {
    if (!cache.has(source))
      cache.set(
        source,
        localClouds.has(source) && source.pointCloudPlacement
          ? placedCloud(source, source.pointCloudPlacement)
          : source,
      );
    return cache.get(source)!;
  };
  return {
    ...session,
    project: {
      ...session.project,
      entities: session.project.entities.map(entity),
    },
    history: session.history.map((r) => ({
      ...r,
      entities: r.entities.map(entity),
    })),
    future: session.future.map((r) => ({
      ...r,
      entities: r.entities.map(entity),
    })),
  };
}
