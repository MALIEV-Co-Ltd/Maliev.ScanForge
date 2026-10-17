import { nativeStlTopology } from "./scan-native-stl-topology";
import { noiseNormals } from "./scan-native-noise";

export interface GlobalAlignmentPreparationPacket {
  positions?: Float32Array;
  vertices?: Float32Array;
  triangles?: Uint32Array;
}
export interface GlobalAlignmentPreparedMesh {
  vertices: Float32Array;
  triangles: Uint32Array;
  normals: Float32Array;
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
  return { ...mesh, normals };
}
export type GlobalAlignmentPreparationResponse =
  { result: GlobalAlignmentPreparedMesh } | { error: string };
const scope = globalThis as unknown as {
  postMessage(
    data: GlobalAlignmentPreparationResponse,
    transfers?: Transferable[],
  ): void;
  close(): void;
  onmessage:
    ((event: MessageEvent<GlobalAlignmentPreparationPacket>) => void) | null;
};
if (
  typeof scope.postMessage === "function" &&
  typeof document === "undefined"
) {
  const lease = setTimeout(() => scope.close(), 120_000);
  scope.onmessage = ({ data }) => {
    try {
      const result = executeGlobalAlignmentInputPreparation(data);
      scope.postMessage({ result }, [
        result.vertices.buffer,
        result.triangles.buffer,
        result.normals.buffer,
      ]);
    } catch (error) {
      scope.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(lease);
      scope.close();
    }
  };
}
