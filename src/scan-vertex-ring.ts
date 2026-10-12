import type { MeshTopology } from "./mesh-processing";

export interface VertexRing {
  vertices: number[];
  boundary: boolean;
  face: number;
}

// Recover the ordered fan attached to the first incident facet. A vertex may
// belong to disconnected fans; their neighbor lists must not be merged.
export function vertexRings(topology: MeshTopology): VertexRing[] {
  const { triangles, edges } = topology;
  const links = new Int32Array(triangles.length).fill(-1);
  const first = new Int32Array(topology.vertices.length / 3).fill(-1);
  const edgeCorner = (face: number, from: number) => {
    for (let c = 0; c < 3; c++) if (triangles[face * 3 + c] === from) return c;
    return -1;
  };
  for (let i = 0; i < triangles.length; i++)
    if (first[triangles[i]] < 0) first[triangles[i]] = i;
  for (const uses of edges.values()) {
    // Ambiguous edge pairings need their own native adjacency evidence.
    if (uses.length !== 2 || uses[0].from !== uses[1].to) continue;
    for (let side = 0; side < 2; side++) {
      const use = uses[side];
      links[use.face * 3 + edgeCorner(use.face, use.from)] =
        uses[1 - side].face;
    }
  }
  return Array.from(first, (seed, vertex) => {
    const vertices: number[] = [];
    if (seed < 0) return { vertices, boundary: false, face: -1 };
    const start = Math.floor(seed / 3);
    let face = start,
      corner = seed % 3;
    const move = (next: number) => {
      face = next;
      if (next >= 0) corner = edgeCorner(next, vertex);
    };
    let steps = 0;
    if (links[face * 3 + corner] >= 0) {
      while (links[face * 3 + corner] !== start) {
        move(links[face * 3 + corner]);
        if (
          face < 0 ||
          corner < 0 ||
          steps++ > 99 ||
          links[face * 3 + corner] < 0
        )
          break;
      }
    }
    const boundary = face >= 0 && links[face * 3 + corner] < 0;
    steps = 0;
    while (face >= 0 && corner >= 0 && face !== start) {
      vertices.push(triangles[face * 3 + ((corner + 1) % 3)]);
      move(links[face * 3 + ((corner + 2) % 3)]);
      if (steps++ > 99 || face < 0) break;
    }
    if (face >= 0 && corner >= 0) {
      if (boundary) {
        while (face >= 0 && corner >= 0) {
          vertices.push(triangles[face * 3 + ((corner + 1) % 3)]);
          const previous = (corner + 2) % 3;
          const next = links[face * 3 + previous];
          if (next < 0) vertices.push(triangles[face * 3 + previous]);
          if (vertices.length > 29) break;
          move(next);
        }
      } else vertices.push(triangles[face * 3 + ((corner + 1) % 3)]);
    }
    return { vertices, boundary, face: start };
  });
}
