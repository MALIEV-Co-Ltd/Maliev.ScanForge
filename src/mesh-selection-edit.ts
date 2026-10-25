import type { Entity } from "./types";
import { partitionTriangles } from "./selection";
import { scanMeshCopy } from "./scan-mesh-copy";

/** Preserve authored corner-normal slots; edited topology/display caches are invalidated. */
export function partitionMeshSelection(
  source: Entity,
  mask: Uint8Array,
  copyId: string,
) {
  const positions = partitionTriangles(source.positions, mask);
  if (source.normals && source.normals.length !== source.positions.length)
    throw new Error("Mesh normals must have one XYZ normal per corner.");
  const normals = source.normals
    ? partitionTriangles(source.normals, mask)
    : undefined;
  const remainder: Entity = {
    ...source,
    kind: "mesh",
    positions: positions.remainder,
    normals: normals?.remainder,
    indexedMesh: undefined,
    meshSelection: undefined,
    edgePositions: undefined,
    scanSource: undefined,
    kernelId: undefined,
    brep: undefined,
    parametric: undefined,
    surfacePatch: undefined,
    surfaceScanId: undefined,
    planeFrame: undefined,
    fit: undefined,
  };
  const selected: Entity = {
    ...scanMeshCopy(source, copyId, positions.selected),
    name: `${source.name} selection`,
    normals: normals?.selected,
  };
  return { selected, remainder };
}
