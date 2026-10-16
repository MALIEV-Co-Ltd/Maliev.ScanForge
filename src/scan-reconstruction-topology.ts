import type { MeshSheetDiagnostics } from "./mesh-processing";
const MAX_FACES = 16_000_000,
  STRIDE = 67_108_864;
class UnionFind {
  private chunks: Uint32Array[] = [];
  length = 0;
  add() {
    const id = this.length++;
    if ((id & 65535) === 0) this.chunks.push(new Uint32Array(65536));
    this.set(id, id);
    return id;
  }
  private get(i: number) {
    return this.chunks[i >>> 16][i & 65535];
  }
  private set(i: number, v: number) {
    this.chunks[i >>> 16][i & 65535] = v;
  }
  find(i: number) {
    let root = i;
    while (this.get(root) !== root) root = this.get(root);
    while (this.get(i) !== i) {
      const n = this.get(i);
      this.set(i, root);
      i = n;
    }
    return root;
  }
  union(a: number, b: number) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return false;
    this.set(Math.max(a, b), Math.min(a, b));
    return true;
  }
}
type Vertex = {
  id: number;
  expires: number;
  corners: number[];
  edges: Set<number>;
};
type Edge = {
  from: number;
  to: number;
  third: number;
  corner: number;
  face: number;
  uses: number;
};
/** Ordered extraction retires topology after each vertex's last possible incident cell.
 * Chunked disjoint sets retain compact connectivity; maps retain only the frontier.
 */
export class ReconstructionTopology {
  private vertices = new Map<number, Vertex>();
  private edges = new Map<number, Edge>();
  private heap: { key: number; expires: number }[] = [];
  private fans = new UnionFind();
  private faces = new UnionFind();
  private vertexCount = 0;
  private components = 0;
  private cell = -1;
  private nonManifoldVertices = 0;
  private nonManifoldEdges = 0;
  private boundaryEdges = 0;
  private inconsistentEdges = 0;
  private duplicateTriangles = 0;
  private degenerateTriangles = 0;
  peakFrontierEdges = 0;
  private schedule(key: number, expires: number) {
    const entry = { key, expires };
    let i = this.heap.length;
    this.heap.push(entry);
    while (i) {
      const p = (i - 1) >>> 1;
      if (this.heap[p].expires <= expires) break;
      this.heap[i] = this.heap[p];
      i = p;
    }
    this.heap[i] = entry;
  }
  private pop() {
    const first = this.heap[0],
      last = this.heap.pop()!;
    if (this.heap.length) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let c = i * 2 + 1;
        if (
          c + 1 < this.heap.length &&
          this.heap[c + 1].expires < this.heap[c].expires
        )
          c++;
        if (this.heap[c].expires >= last.expires) break;
        this.heap[i] = this.heap[c];
        i = c;
      }
      this.heap[i] = last;
    }
    return first;
  }
  advance(cell: number) {
    if (cell < this.cell)
      throw Error("Reconstruction cells must be verified in extraction order.");
    this.cell = cell;
    while (this.heap.length && this.heap[0].expires < cell) {
      const { key } = this.pop(),
        vertex = this.vertices.get(key)!;
      let root = -1;
      for (const c of vertex.corners) {
        const next = this.fans.find(c);
        if (root < 0) root = next;
        else if (root !== next) {
          this.nonManifoldVertices++;
          break;
        }
      }
      for (const edgeKey of vertex.edges) {
        const edge = this.edges.get(edgeKey);
        if (!edge) continue;
        if (edge.uses === 1) this.boundaryEdges++;
        this.edges.delete(edgeKey);
        // The other endpoint may outlive this vertex. Its edge set keeps a
        // retired key until then; the missing-map-entry check above handles it.
      }
      this.vertices.delete(key);
    }
  }
  addTriangle(
    keys: ArrayLike<number>,
    expires: ArrayLike<number>,
    p: ArrayLike<number>,
  ) {
    if (this.faces.length === MAX_FACES)
      throw Error(
        "Reconstruction exceeds the sixteen-million-triangle processing limit; increase point resolution.",
      );
    const f = this.faces.add();
    this.components++;
    const base = this.fans.length;
    const ids: number[] = [];
    for (let j = 0; j < 3; j++) {
      const c = this.fans.add(),
        key = keys[j];
      if (expires[j] < this.cell)
        throw Error(
          "Reconstruction vertex arrived after its final incident cell.",
        );
      let v = this.vertices.get(key);
      if (!v) {
        v = {
          id: this.vertexCount++,
          expires: expires[j],
          corners: [],
          edges: new Set(),
        };
        this.vertices.set(key, v);
        this.schedule(key, v.expires);
      } else if (v.expires !== expires[j])
        throw Error("Shared reconstruction vertex has inconsistent lifetime.");
      v.corners.push(c);
      ids.push(v.id);
    }
    const ux = p[3] - p[0],
      uy = p[4] - p[1],
      uz = p[5] - p[2],
      vx = p[6] - p[0],
      vy = p[7] - p[1],
      vz = p[8] - p[2];
    if (
      Array.from(p).some((v) => !Number.isFinite(v)) ||
      (uy * vz - uz * vy) ** 2 +
        (uz * vx - ux * vz) ** 2 +
        (ux * vy - uy * vx) ** 2 ===
        0
    )
      this.degenerateTriangles++;
    for (let j = 0; j < 3; j++) {
      const from = ids[j],
        to = ids[(j + 1) % 3],
        low = Math.min(from, to),
        high = Math.max(from, to);
      if (high >= STRIDE)
        throw Error(
          "Reconstruction vertex identity exceeds exact numeric key precision.",
        );
      const key = low * STRIDE + high,
        previous = this.edges.get(key);
      if (!previous) {
        this.edges.set(key, {
          from,
          to,
          third: ids[(j + 2) % 3],
          corner: base + j,
          face: f,
          uses: 1,
        });
        this.vertices.get(keys[j])!.edges.add(key);
        this.vertices.get(keys[(j + 1) % 3])!.edges.add(key);
        continue;
      }
      previous.uses++;
      if (previous.uses > 2) {
        if (previous.uses === 3) this.nonManifoldEdges++;
        continue;
      }
      const same = previous.from === from;
      if (same) this.inconsistentEdges++;
      if (j === 0 && previous.third === ids[2]) this.duplicateTriangles++;
      if (this.faces.union(f, previous.face)) this.components--;
      const a = base + j,
        b = base + ((j + 1) % 3),
        c = previous.corner,
        d = previous.face * 3 + ((previous.corner + 1) % 3);
      this.fans.union(a, same ? c : d);
      this.fans.union(b, same ? d : c);
    }
    this.peakFrontierEdges = Math.max(this.peakFrontierEdges, this.edges.size);
    if (this.edges.size > 2_000_000)
      throw Error(
        "Reconstruction topology frontier exceeds its bounded memory limit; increase point resolution.",
      );
  }
  finish(): MeshSheetDiagnostics {
    this.advance(Infinity);
    const watertight =
      this.faces.length > 0 &&
      this.boundaryEdges === 0 &&
      this.nonManifoldEdges === 0 &&
      this.nonManifoldVertices === 0 &&
      this.inconsistentEdges === 0 &&
      this.duplicateTriangles === 0 &&
      this.degenerateTriangles === 0;
    if (!watertight)
      throw Error(
        `Reconstructed surface failed watertight topology verification (boundary=${this.boundaryEdges}, nonmanifold edges=${this.nonManifoldEdges}, vertices=${this.nonManifoldVertices}, winding=${this.inconsistentEdges}, duplicates=${this.duplicateTriangles}, degenerate=${this.degenerateTriangles}); increase point resolution.`,
      );
    return {
      vertices: this.vertexCount,
      triangles: this.faces.length,
      components: this.components,
      boundaryLoops: 0,
      boundaryChains: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      nonManifoldVertices: 0,
      inconsistentEdges: 0,
      duplicateTriangles: 0,
      degenerateTriangles: 0,
      watertight,
    };
  }
}
