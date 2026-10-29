import { scanMeshCopy } from "./scan-mesh-copy";
import type { Entity, IndexedMesh } from "./types";
import type { RegionClassification } from "./mesh-processing";
import type { ModelCommitPolicy } from "./object-operations";
import { DEFAULT_PART_COLOR } from "./appearance";
import { validatePositions } from "./io";
import { indexedMeshMatches } from "./indexed-mesh";

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
