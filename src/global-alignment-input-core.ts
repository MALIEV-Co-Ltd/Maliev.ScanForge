import { nativeStlTopology } from "./scan-native-stl-topology";
import { noiseNormals } from "./scan-native-noise";
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
  // Native temporary groups return no direct mesh interface in preparation,
  // skipping boundary marking. Mask zero keeps every source vertex eligible.
  // Retain the worker's admitted, separate flag carrier and response contract.
  const flags = withNativeTargetStorageBudget(
    budget,
    () =>
      new Uint32Array(
        nativeTargetStorage(mesh.vertices, (mesh.vertices.length / 3) * 4),
      ),
  );
  return { ...mesh, normals, flags };
}
export type GlobalAlignmentPreparationResponse =
  { result: GlobalAlignmentPreparedMesh } | { error: string };
