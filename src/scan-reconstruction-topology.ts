import type { MeshSheetDiagnostics } from "./mesh-processing";
import type { GridProgress } from "./scan-reconstruction-grid";
const STRIDE = 33_554_432,
  PAIRED = 0x80000000,
  AMBIGUOUS = 0x40000000,
  INDEX = 0x3fffffff;
function capacity(n: number) {
  let c = 16;
  while (c < n) c *= 2;
  return c;
}
function hash(a: number, b = 0) {
  return (
    (Math.imul(a ^ (a >>> 16), 0x85ebca6b) ^
      Math.imul(b ^ (b >>> 16), 0xc2b2ae35)) >>>
    0
  );
}
function find(p: Uint32Array, a: number) {
  let root = a;
  while (p[root] !== root) root = p[root];
  while (p[a] !== a) {
    const next = p[a];
    p[a] = root;
    a = next;
  }
  return root;
}
function unite(p: Uint32Array, a: number, b: number) {
  a = find(p, a);
  b = find(p, b);
  if (a === b) return false;
  p[Math.max(a, b)] = Math.min(a, b);
  return true;
}
const nextCorner = (c: number) => c - (c % 3) + ((c + 1) % 3);
/** Verify emitted half-grid Float32 geometry with typed hash tables, edge pairings,
 * connected vertex fans and face components. No per-edge JS objects or adjacency lists.
 * Only the reconstruction lattice is admitted; this is not a general mesh analyzer.
 */
export function verifyReconstructionTopology(
  positions: Float32Array,
  start: number[],
  dimensions: number[],
  resolution: number,
  progress: GridProgress,
): MeshSheetDiagnostics {
  const faces = positions.length / 9,
    corners = faces * 3;
  if (!faces || !Number.isInteger(faces) || faces > 8_000_000)
    throw Error(
      "Reconstruction verification exceeds its eight-million-triangle limit.",
    );
  const vertexCapacity = capacity(faces * 2),
    vertexKeys = new Uint32Array(vertexCapacity),
    vertexIds = new Uint32Array(vertexCapacity),
    triangles = new Uint32Array(corners);
  const fanParents = new Uint32Array(corners),
    faceParents = new Uint32Array(faces);
  const edgeCapacity = capacity(faces * 3),
    edgeKeys = new Float64Array(edgeCapacity),
    edgeCorners = new Uint32Array(edgeCapacity);
  const dims = dimensions.map((n) => 2 * n + 1);
  let vertices = 0,
    components = faces,
    boundaryEdges = 0,
    nonManifoldEdges = 0,
    inconsistentEdges = 0,
    duplicateTriangles = 0,
    degenerateTriangles = 0;
  for (let c = 0; c < corners; c++) {
    if (c % 32768 === 0)
      progress((0.35 * c) / corners, "Verifying reconstructed topology");
    let key = 0,
      multiplier = 1;
    for (let k = 0; k < 3; k++) {
      const q = ((positions[c * 3 + k] - start[k]) * 2) / resolution,
        r = Math.round(q);
      if (
        !Number.isFinite(q) ||
        r < 0 ||
        r >= dims[k] ||
        Math.abs(q - r) > 0.125
      )
        throw Error(
          "Reconstructed coordinates no longer resolve the half-grid lattice.",
        );
      key += r * multiplier;
      multiplier *= dims[k];
    }
    key++;
    if (key > 0xffffffff)
      throw Error("Reconstruction lattice exceeds topology key precision.");
    let slot = hash(key) & (vertexCapacity - 1);
    while (vertexKeys[slot] && vertexKeys[slot] !== key)
      slot = (slot + 1) & (vertexCapacity - 1);
    if (!vertexKeys[slot]) {
      if (vertices >= vertexCapacity * 0.75)
        throw Error(
          "Reconstruction has too many unmatched lattice vertices for closed topology verification.",
        );
      vertexKeys[slot] = key;
      vertexIds[slot] = vertices++;
    }
    triangles[c] = vertexIds[slot];
    fanParents[c] = c;
  }
  for (let f = 0; f < faces; f++) faceParents[f] = f;
  for (let f = 0; f < faces; f++) {
    if (f % 8192 === 0)
      progress(0.35 + (0.5 * f) / faces, "Verifying reconstructed topology");
    const base = f * 3,
      a = triangles[base],
      b = triangles[base + 1],
      c = triangles[base + 2];
    const p = f * 9,
      ux = positions[p + 3] - positions[p],
      uy = positions[p + 4] - positions[p + 1],
      uz = positions[p + 5] - positions[p + 2],
      vx = positions[p + 6] - positions[p],
      vy = positions[p + 7] - positions[p + 1],
      vz = positions[p + 8] - positions[p + 2];
    if (
      a === b ||
      a === c ||
      b === c ||
      (uy * vz - uz * vy) ** 2 +
        (uz * vx - ux * vz) ** 2 +
        (ux * vy - uy * vx) ** 2 ===
        0
    )
      degenerateTriangles++;
    for (let j = 0; j < 3; j++) {
      const corner = base + j,
        other = nextCorner(corner),
        from = triangles[corner],
        to = triangles[other],
        low = Math.min(from, to),
        high = Math.max(from, to),
        key = low * STRIDE + high + 1;
      let slot = hash(low, high) & (edgeCapacity - 1);
      while (edgeKeys[slot] && edgeKeys[slot] !== key)
        slot = (slot + 1) & (edgeCapacity - 1);
      if (!edgeKeys[slot]) {
        edgeKeys[slot] = key;
        edgeCorners[slot] = corner + 1;
        boundaryEdges++;
        continue;
      }
      const value = edgeCorners[slot];
      if (value & PAIRED) {
        if (!(value & AMBIGUOUS)) {
          nonManifoldEdges++;
          edgeCorners[slot] = value | AMBIGUOUS;
        }
        continue;
      }
      const previous = (value & INDEX) - 1,
        previousOther = nextCorner(previous),
        previousFace = Math.floor(previous / 3),
        same = triangles[previous] === from;
      if (same) inconsistentEdges++;
      boundaryEdges--;
      edgeCorners[slot] = value | PAIRED;
      if (unite(faceParents, f, previousFace)) components--;
      unite(fanParents, corner, same ? previous : previousOther);
      unite(fanParents, other, same ? previousOther : previous);
      if (j === 0) {
        const third = triangles[nextCorner(previousOther)];
        if (third === c) duplicateTriangles++;
      }
    }
  }
  const fanRoots = new Uint32Array(vertices);
  let nonManifoldVertices = 0;
  for (let c = 0; c < corners; c++) {
    if (c % 32768 === 0)
      progress(0.85 + (0.15 * c) / corners, "Verifying reconstructed topology");
    const vertex = triangles[c],
      root = find(fanParents, c) + 1,
      previous = fanRoots[vertex];
    if (!previous) fanRoots[vertex] = root;
    else if (!(previous & PAIRED) && previous !== root) {
      nonManifoldVertices++;
      fanRoots[vertex] = previous | PAIRED;
    }
  }
  const watertight =
    boundaryEdges === 0 &&
    nonManifoldEdges === 0 &&
    nonManifoldVertices === 0 &&
    inconsistentEdges === 0 &&
    duplicateTriangles === 0 &&
    degenerateTriangles === 0;
  // Boundary walks are not retained: only verified closed outputs may be published.
  if (!watertight)
    throw Error(
      `Reconstructed surface failed watertight topology verification (boundary=${boundaryEdges}, nonmanifold edges=${nonManifoldEdges}, vertices=${nonManifoldVertices}, winding=${inconsistentEdges}, duplicates=${duplicateTriangles}, degenerate=${degenerateTriangles}); increase point resolution or move the mesh nearer the origin.`,
    );
  return {
    vertices,
    triangles: faces,
    components,
    boundaryLoops: 0,
    boundaryChains: 0,
    boundaryEdges,
    nonManifoldEdges,
    nonManifoldVertices,
    inconsistentEdges,
    duplicateTriangles,
    degenerateTriangles,
    watertight,
  };
}
