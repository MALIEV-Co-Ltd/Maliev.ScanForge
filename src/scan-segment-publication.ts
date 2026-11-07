import { scanMeshCopy } from "./scan-mesh-copy";
import type { Entity, IndexedMesh } from "./types";
import type { RegionClassification } from "./mesh-processing";
import type { ModelCommitPolicy } from "./object-operations";
import { DEFAULT_PART_COLOR } from "./appearance";
import { validatePositions } from "./io";
import { indexedMeshMatches, indexedRenderNormals } from "./indexed-mesh";

/** Atomically move connected components into new mesh owners. */
export function componentExtractionPublication(
  entities: readonly Entity[],
  sourceId: string,
  remainder: {
    positions: Entity["positions"];
    indexedMesh?: IndexedMesh;
    normals?: Entity["normals"];
  },
  parts: readonly Entity["positions"][],
  id: () => string = () => crypto.randomUUID(),
  indexedParts?: readonly (IndexedMesh | undefined)[],
  segmentNormals?: readonly Entity["positions"][],
): { entities: Entity[]; created: Entity[]; policy: ModelCommitPolicy } {
  const source = entities.find((entity) => entity.id === sourceId);
  if (!source || source.kind !== "mesh")
    throw Error("Choose the source mesh before extracting components.");
  if (source.locked) throw Error("Object is locked.");
  if (
    source.normals &&
    (!segmentNormals || (remainder.positions.length && !remainder.normals))
  )
    throw Error("Component extraction did not preserve source normals.");
  if (
    remainder.normals &&
    (!remainder.positions.length ||
      !(
        Array.isArray(remainder.normals) ||
        remainder.normals instanceof Float32Array
      ) ||
      remainder.normals.length !== remainder.positions.length ||
      remainder.normals.some((value) => !Number.isFinite(value)))
  )
    throw Error("Invalid remainder normals.");
  if (
    segmentNormals &&
    (segmentNormals.length !== parts.length ||
      segmentNormals.some(
        (normals, i) =>
          !(Array.isArray(normals) || normals instanceof Float32Array) ||
          normals.length !== parts[i].length ||
          normals.some((value) => !Number.isFinite(value)),
      ))
  )
    throw Error("Invalid component normals.");
  if (remainder.positions.length) {
    validatePositions(remainder.positions);
    if (
      remainder.indexedMesh &&
      !indexedMeshMatches(remainder.indexedMesh, remainder.positions)
    )
      throw Error("Remainder indices do not match its geometry.");
  } else if (remainder.indexedMesh)
    throw Error("Empty remainder cannot have indexed geometry.");
  if (
    remainder.positions.length +
      parts.reduce((sum, part) => sum + part.length, 0) !==
    source.positions.length
  )
    throw Error("Component extraction did not preserve all source triangles.");
  const publication = scanSegmentPublication(
    entities,
    sourceId,
    parts,
    undefined,
    id,
    indexedParts,
  );
  const updated: Entity = {
    ...source,
    positions: remainder.positions,
    indexedMesh: remainder.indexedMesh,
    normals: remainder.normals ?? indexedRenderNormals(remainder.indexedMesh),
    emptyComponentSource: remainder.positions.length ? undefined : true,
    edgePositions: undefined,
    kernelId: undefined,
    brep: undefined,
    parametric: undefined,
    fit: undefined,
    planeFrame: undefined,
    surfacePatch: undefined,
    surfaceScanId: undefined,
    meshSelection: undefined,
    scanSource: undefined,
  };
  const nonemptyNormals = segmentNormals?.filter(
    (_, index) => parts[index].length > 0,
  );
  const updatedParts = new Map(
    publication.created.map((part, index) => [
      part,
      {
        ...part,
        normals:
          nonemptyNormals?.[index] ?? indexedRenderNormals(part.indexedMesh),
      },
    ]),
  );
  return {
    entities: publication.entities.map((entity) =>
      entity.id === sourceId ? updated : (updatedParts.get(entity) ?? entity),
    ),
    created: publication.created.map((part) => updatedParts.get(part)!),
    policy: {},
  };
}

/** Publish independent parts and own only the source visibility changed by this edit. */
export function scanSegmentPublication(
  entities: readonly Entity[],
  sourceId: string,
  parts: readonly Entity["positions"][],
  classifications?: readonly RegionClassification[],
  id: () => string = () => crypto.randomUUID(),
  indexedParts?: readonly (IndexedMesh | undefined)[],
): { entities: Entity[]; created: Entity[]; policy: ModelCommitPolicy } {
  const source = entities.find((entity) => entity.id === sourceId);
  if (!source)
    throw Error("Choose the source object before publishing mesh segments.");
  if (source.locked) throw Error("Object is locked.");
  if (indexedParts && indexedParts.length !== parts.length)
    throw Error("Segment indices do not match the result count.");
  const created: Entity[] = [];
  for (const [index, positions] of parts.entries()) {
    if (!positions.length) {
      if (indexedParts?.[index])
        throw Error("Segment indices do not match empty geometry.");
      continue;
    }
    validatePositions(positions);
    const indexedMesh = indexedParts?.[index];
    if (indexedMesh && !indexedMeshMatches(indexedMesh, positions))
      throw Error("Segment indices do not match the result geometry.");
    const classification = classifications?.[index];
    created.push({
      ...scanMeshCopy(source, id(), positions),
      ...(indexedMesh ? { indexedMesh } : {}),
      name: `${source.name} segment ${index + 1}${classification ? ` · ${classification.kind === "freeform" ? "unclassified" : classification.kind}` : ""}`,
      fit: classification?.fit,
      color: DEFAULT_PART_COLOR,
      opacity: 1,
      visible: true,
    });
  }
  if (!created.length) throw Error("Segmentation produced no meshes.");
  return {
    entities: [
      ...entities.map((entity) =>
        entity.id === sourceId ? { ...entity, visible: false } : entity,
      ),
      ...created,
    ],
    created,
    policy: { modelVisibilityFor: [sourceId] },
  };
}
