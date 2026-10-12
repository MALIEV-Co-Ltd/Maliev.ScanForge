import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { nativeReductionMesh } from "./scan-native-reduction";

/** Working-record admission, including growing incidence references and output scratch. */
export function admitReductionRecords(vertices: number, faces: number) {
  if (!canAdmitReductionRecords(vertices, faces))
    throw new Error(
      "Polygon reduction exceeds the current working-memory budget; original mesh retained.",
    );
}
export function canAdmitReductionRecords(vertices: number, faces: number) {
  return vertices * 1024 + faces * 4096 <= 256 * 1024 * 1024;
}

/** Native caller widens source Float32 points and narrows compacted points before facet export. */
export function reduceIndexedScanMesh(
  topology: Pick<MeshTopology, "vertices" | "triangles">,
  target: number,
  options: MeshProcessingOptions = {},
) {
  admitReductionRecords(
    topology.vertices.length / 3,
    topology.triangles.length / 3,
  );
  const result = nativeReductionMesh(
    Float64Array.from(topology.vertices, Math.fround),
    topology.triangles,
    target,
    {
      ...options,
      onProgress: (fraction, stage) =>
        options.onProgress?.(
          fraction * 0.95,
          fraction === 1 ? "Exporting reduced mesh" : stage,
        ),
    },
  );
  const positions = new Float32Array(result.triangles.length * 3);
  for (let corner = 0; corner < result.triangles.length; corner++) {
    if (corner % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const id = result.triangles[corner];
    for (let axis = 0; axis < 3; axis++) {
      const value = Math.fround(result.vertices[id * 3 + axis]);
      if (!Number.isFinite(value))
        throw new Error(
          "Reduced mesh exceeds coordinate precision; original mesh retained.",
        );
      positions[corner * 3 + axis] = value;
    }
  }
  options.onProgress?.(1, "Polygon reduction completed");
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  return positions;
}
