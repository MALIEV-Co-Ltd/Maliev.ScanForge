import {
  analyzeIndexedMesh,
  type MeshProcessingOptions,
  type MeshTopology,
  type EdgeUse,
} from "./mesh-processing";

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Remove facets from indexed adjacency; surviving vertices are never spatially rewelded. */
export function retainFacets(
  topology: MeshTopology,
  retained: Uint8Array,
  options: MeshProcessingOptions,
): { topology: MeshTopology; oldFaces: number[] } {
  const indices: number[] = [],
    oldFaces: number[] = [];
  const remap = new Int32Array(retained.length).fill(-1);
  for (let f = 0; f < retained.length; f++)
    if (retained[f]) {
      remap[f] = oldFaces.length;
      oldFaces.push(f);
      indices.push(
        topology.triangles[f * 3],
        topology.triangles[f * 3 + 1],
        topology.triangles[f * 3 + 2],
      );
    }
  const edges = new Map<string, EdgeUse[]>();
  for (const [id, uses] of topology.edges) {
    const remaining = uses
      .filter((use) => remap[use.face] >= 0)
      .map((use) => ({ ...use, face: remap[use.face] }));
    if (remaining.length) edges.set(id, remaining);
  }
  return {
    topology: analyzeIndexedMesh(
      topology.vertices,
      new Uint32Array(indices),
      options,
      edges,
    ),
    oldFaces,
  };
}

/** Link only appended triangles into existing edge uses, then refresh derived component/boundary data. */
export function appendFacets(
  topology: MeshTopology,
  vertices: Float64Array,
  added: Uint32Array,
  options: MeshProcessingOptions,
): MeshTopology {
  const indices = new Uint32Array(topology.triangles.length + added.length);
  indices.set(topology.triangles);
  indices.set(added, topology.triangles.length);
  const edges = new Map(topology.edges);
  const base = topology.triangles.length / 3;
  for (let f = 0; f < added.length / 3; f++)
    for (let c = 0; c < 3; c++) {
      const from = added[f * 3 + c],
        to = added[f * 3 + ((c + 1) % 3)];
      const id = key(from, to);
      edges.set(id, [...(edges.get(id) ?? []), { face: base + f, from, to }]);
    }
  return analyzeIndexedMesh(vertices, indices, options, edges);
}

/** Compact unused vertex slots without merging coincident points or rebuilding edge adjacency. */
export function compactIndexedTopology(
  topology: MeshTopology,
  options: MeshProcessingOptions,
): MeshTopology {
  const remap = new Int32Array(topology.vertices.length / 3).fill(-1);
  const vertices: number[] = [];
  const triangles = Uint32Array.from(topology.triangles, (id) => {
    if (remap[id] < 0) {
      remap[id] = vertices.length / 3;
      vertices.push(
        Math.fround(topology.vertices[id * 3]),
        Math.fround(topology.vertices[id * 3 + 1]),
        Math.fround(topology.vertices[id * 3 + 2]),
      );
    }
    return remap[id];
  });
  const edges = new Map<string, EdgeUse[]>();
  for (const uses of topology.edges.values()) {
    const mapped = uses.map((use) => ({
      ...use,
      from: remap[use.from],
      to: remap[use.to],
    }));
    edges.set(key(mapped[0].from, mapped[0].to), mapped);
  }
  return analyzeIndexedMesh(
    new Float64Array(vertices),
    triangles,
    options,
    edges,
  );
}
