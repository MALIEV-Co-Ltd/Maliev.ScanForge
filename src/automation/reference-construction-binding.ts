import type { WorkspaceHost, WorkspaceSnapshot } from "./api";
import {
  encodeReferenceEntityData,
  validateReferenceEntity,
} from "../reference-entity";

export interface ReferenceConstructionWorkspaceBinding {
  readonly token: object;
  currentToken(): object;
  dispose(): void;
}

function metadata(value: unknown): string | undefined {
  // Valid model numeric fields cannot contain this string in place of a number.
  return JSON.stringify(value, (_key, item) =>
    Object.is(item, -0) ? "reference-negative-zero" : item,
  );
}

function capture(snapshot: WorkspaceSnapshot): unknown[] {
  const stamp: unknown[] = [
    snapshot.projectId,
    snapshot.name,
    snapshot.entities.length,
  ];
  for (const entity of snapshot.entities) {
    const reference = validateReferenceEntity(entity);
    stamp.push(
      entity,
      entity.positions,
      entity.positions.length,
      entity.normals,
      entity.normals?.length,
      entity.indexedMesh,
      entity.indexedMesh?.vertices,
      entity.indexedMesh?.vertices.length,
      entity.indexedMesh?.triangles,
      entity.indexedMesh?.triangles.length,
      entity.indexedMesh?.normals,
      entity.indexedMesh?.geometryNormals,
      entity.indexedMesh?.facetNormals,
      entity.pointCloudPlacement,
      entity.pointCloudPlacement?.sourcePositions,
      entity.pointCloudPlacement?.sourceNormals,
      entity.parametric,
      entity.surfacePatch,
      entity.fit,
      entity.planeFrame,
      entity.meshSelection,
      entity.meshSelection?.hidden,
      entity.authoringLinks,
      entity.scanSource,
      entity.brep,
      metadata({
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        key: entity.constructionOrderKey,
        kernelId: entity.kernelId,
        visible: entity.visible,
        locked: entity.locked,
        selectable: entity.selectable,
        pose: entity.pointCloudPlacement?.matrixBits,
        fit: entity.fit,
        planeFrame: entity.planeFrame,
        sourceScan: entity.surfaceScanId,
        links: entity.authoringLinks,
        hiddenTriangles: entity.meshSelection?.hidden.length,
        scanSource: entity.scanSource,
        reference: reference ? encodeReferenceEntityData(reference) : undefined,
      }),
    );
  }
  for (const revisions of [snapshot.history, snapshot.future]) {
    stamp.push(revisions.length);
    for (const revision of revisions)
      stamp.push(revision, revision.entities, revision.label);
  }
  const sketches = snapshot.authoring.sketches;
  stamp.push(sketches?.length ?? -1);
  if (sketches?.length) {
    for (const sketch of sketches)
      stamp.push(
        sketch.id,
        sketch.name,
        sketch.sketch,
        metadata(sketch.sketch),
      );
  } else
    stamp.push(snapshot.authoring.sketch, metadata(snapshot.authoring.sketch));
  return stamp;
}

/**
 * Private host binding for cached construction previews. Geometry carriers follow
 * the application's immutable publication contract; their bytes are neither copied
 * nor hashed here. Precise reference recipes use the existing lossless codec.
 * Selection/camera settings and the active named-sketch mirror are not model edits.
 * This does not admit sources, validate native providers or replace API/lock checks.
 */
export function bindReferenceConstructionWorkspace(
  host: Pick<WorkspaceHost, "snapshot">,
): ReferenceConstructionWorkspaceBinding {
  const token = {},
    retired = {};
  let read: (() => WorkspaceSnapshot) | undefined = host.snapshot.bind(host);
  let saved: unknown[] | undefined = capture(read());
  const dispose = () => {
    saved = undefined;
    read = undefined;
  };
  return {
    token,
    currentToken() {
      if (!read || !saved) return retired;
      try {
        const next = capture(read());
        if (
          next.length === saved.length &&
          next.every((value, index) => Object.is(value, saved![index]))
        )
          return token;
      } catch {
        // Invalid model metadata also forbids applying an earlier cached result.
      }
      dispose();
      return retired;
    },
    dispose,
  };
}
