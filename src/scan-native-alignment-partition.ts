import type { AlignmentQueryVertex } from "./scan-native-alignment-query";

/** Native construction order: selected visible vertices, round-robin across all meshes. */
export function partitionNativeAlignmentVertices(
  groups: readonly (readonly AlignmentQueryVertex[])[],
  workerCount: number,
) {
  if (!Number.isSafeInteger(workerCount) || workerCount < 1)
    throw new Error("Alignment requires a positive integer worker count.");
  const lanes = Array.from({ length: workerCount }, () => ({
    vertices: [] as AlignmentQueryVertex[],
    indices: [] as number[],
  }));
  let lane = 0;
  let index = 0;
  for (const group of groups) {
    for (const vertex of group) {
      if ((vertex.flags & 5) === 4) {
        lanes[lane].vertices.push(vertex);
        lanes[lane].indices.push(index);
        lane = (lane + 1) % workerCount;
      }
      index++;
    }
  }
  return lanes;
}
