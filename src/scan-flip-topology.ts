import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";

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
  const edges = new Map<string, import("./mesh-processing").EdgeUse[]>();
  let index = 0;
  for (const [key, uses] of source.edges) {
    if (index++ % 4096 === 0) check();
    edges.set(
      key,
      uses.map(({ face, from, to }) => ({ face, from: to, to: from })),
    );
  }
  check();
  return { ...source, triangles, edges };
}
