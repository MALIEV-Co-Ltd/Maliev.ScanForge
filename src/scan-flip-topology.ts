import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { reverseMeshEdges } from "./mesh-edge-index";

/** Reverse directed incidence while retaining welded vertices and undirected connectivity. */
export function flippedTopology(
  source: MeshTopology,
  options: MeshProcessingOptions = {},
): MeshTopology {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  check();
  const triangles = source.triangles.slice();
  for (let face = 0; face < triangles.length; face += 3) {
    if (face % 12288 === 0) {
      check();
      options.onProgress?.(face / triangles.length, "Updating mesh winding");
    }
    const second = triangles[face + 1];
    triangles[face + 1] = triangles[face + 2];
    triangles[face + 2] = second;
  }
  const edges = reverseMeshEdges(source.edges, options.signal);
  check();
  return { ...source, triangles, edges };
}
