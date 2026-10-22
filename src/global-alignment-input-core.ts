import { nativeStlTopology } from "./scan-native-stl-topology";
import { noiseNormals } from "./scan-native-noise";
import { nativeBuildAlignmentNeighbourMasks } from "./scan-native-alignment-adjacency";
import {
  createNativeTargetStorageBudget,
  nativeTargetStorage,
  withNativeTargetStorageBudget,
} from "./scan-native-target-storage";

export interface GlobalAlignmentPreparationPacket {
  positions?: Float32Array;
  vertices?: Float32Array;
  triangles?: Uint32Array;
  storage?: { limit: number; reserved: number };
}
export interface GlobalAlignmentPreparedMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
  normals: Float32Array;
  flags: Uint32Array;
}
/** Disposable worker job: retain the verified STL vertex order and normal arithmetic. */
export function executeGlobalAlignmentInputPreparation(
  packet: GlobalAlignmentPreparationPacket,
): GlobalAlignmentPreparedMesh {
  const mesh = packet.positions
    ? nativeStlTopology(packet.positions)
    : { vertices: packet.vertices!, triangles: packet.triangles! };
  if (
    !(mesh.vertices instanceof Float32Array) ||
    !mesh.vertices.length ||
    mesh.vertices.length % 3 ||
    !(mesh.triangles instanceof Uint32Array) ||
    !mesh.triangles.length ||
    mesh.triangles.length % 3 ||
    !mesh.vertices.every(Number.isFinite) ||
    mesh.triangles.some((id) => id >= mesh.vertices.length / 3)
  )
    throw Error("Global alignment requires finite indexed mesh geometry.");
  const normals = noiseNormals(mesh);
  if (!normals.every(Number.isFinite))
    throw Error(
      "Global alignment normal preparation produced nonfinite values.",
    );
  const budget = createNativeTargetStorageBudget(
    packet.storage?.limit ?? 512 * 1048576,
    packet.storage?.reserved ??
      mesh.vertices.byteLength +
        mesh.triangles.byteLength +
        normals.byteLength +
        1048576,
  );
  const flags = withNativeTargetStorageBudget(budget, () => {
    const flags = new Uint32Array(
      nativeTargetStorage(mesh.vertices, (mesh.vertices.length / 3) * 4),
    );
    const neighbors = nativeBuildAlignmentNeighbourMasks(
      mesh.vertices,
      mesh.triangles,
    );
    // Native command mask 1 excludes endpoints of unlinked directed facet edges.
    for (let face = 0; face < neighbors.length; face++)
      for (let edge = 0; edge < 3; edge++) {
        if (neighbors[face] & (1 << edge)) continue;
        flags[mesh.triangles[face * 3 + edge]] = 1;
        flags[mesh.triangles[face * 3 + ((edge + 1) % 3)]] = 1;
      }
    return flags;
  });
  return { ...mesh, normals, flags };
}
export type GlobalAlignmentPreparationResponse =
  { result: GlobalAlignmentPreparedMesh } | { error: string };
