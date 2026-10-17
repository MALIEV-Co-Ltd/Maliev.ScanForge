import type { MeshTopology } from "./mesh-processing";
import { MeshEdgeIndex } from "./mesh-edge-index";

/** Versioned binary topology snapshot. Buffer positions are part of the format. */
export interface PackedTopology {
  format: 2;
  buffers: ArrayBuffer[];
}

const diagnosticKeys = [
  "nonManifoldEdges",
  "nonManifoldVertices",
  "inconsistentEdges",
  "degenerateTriangles",
  "duplicateTriangles",
  "boundaryEdges",
] as const;

function packRows(rows: number[][]): [ArrayBuffer, ArrayBuffer] {
  let length = 0;
  for (const row of rows) length += row.length;
  if (length > 0xffffffff)
    throw new RangeError("Topology cache exceeds uint32 capacity.");
  const offsets = new Uint32Array(rows.length + 1);
  const data = new Uint32Array(length);
  let cursor = 0;
  for (let i = 0; i < rows.length; i++) {
    offsets[i] = cursor;
    data.set(rows[i], cursor);
    cursor += rows[i].length;
  }
  offsets[rows.length] = cursor;
  return [offsets.buffer, data.buffer];
}

/** Copy a complete topology without welding, changing identity, or recomputing diagnostics. */
export function packTopology(topology: MeshTopology): PackedTopology {
  let offsets: Uint32Array<ArrayBuffer>, useData: Uint32Array<ArrayBuffer>;
  if (topology.edges instanceof MeshEdgeIndex) {
    const packed = topology.edges.packCorners();
    offsets = packed.offsets;
    useData = packed.corners;
  } else {
    let useCount = 0;
    for (const uses of topology.edges.values()) useCount += uses.length;
    if (useCount > 0xffffffff)
      throw new RangeError("Topology cache exceeds uint32 capacity.");
    offsets = new Uint32Array(topology.edges.size + 1);
    useData = new Uint32Array(useCount);
    let edge = 0,
      cursor = 0;
    for (const [key, uses] of topology.edges) {
      offsets[edge++] = cursor;
      for (const use of uses) {
        const base = use.face * 3;
        let reference = -1;
        for (let corner = 0; corner < 3; corner++)
          if (
            topology.triangles[base + corner] === use.from &&
            topology.triangles[base + ((corner + 1) % 3)] === use.to
          ) {
            reference = base + corner;
            break;
          }
        const expectedKey =
          use.from < use.to ? `${use.from}:${use.to}` : `${use.to}:${use.from}`;
        if (reference < 0 || reference > 0xffffffff || expectedKey !== key)
          throw new RangeError("Invalid topology edge incidence.");
        useData[cursor++] = reference;
      }
    }
    offsets[edge] = cursor;
  }
  return {
    format: 2,
    buffers: [
      topology.vertices.slice().buffer,
      topology.triangles.slice().buffer,
      new ArrayBuffer(0),
      offsets.buffer,
      useData.buffer,
      ...packRows(topology.neighbors),
      ...packRows(topology.components),
      ...packRows(topology.boundaryLoops),
      ...packRows(topology.boundaryChains),
      new Float64Array(diagnosticKeys.map((key) => topology[key])).buffer,
    ],
  };
}

export function packedTopologyBytes(payload: PackedTopology): number {
  let bytes = 0;
  for (const buffer of payload.buffers) bytes += buffer.byteLength;
  return bytes;
}

/** Exact packed size, reading lengths only so admission can precede allocation. */
export function estimatedPackedTopologyBytes(topology: MeshTopology): number {
  let bytes =
    topology.vertices.length * 8 +
    topology.triangles.length * 4 +
    (topology.edges.size + 1) * 4 +
    diagnosticKeys.length * 8;
  if (topology.edges instanceof MeshEdgeIndex)
    bytes += topology.edges.useCount * 4;
  else for (const uses of topology.edges.values()) bytes += uses.length * 4;
  for (const rows of [
    topology.neighbors,
    topology.components,
    topology.boundaryLoops,
    topology.boundaryChains,
  ]) {
    bytes += (rows.length + 1) * 4;
    for (const row of rows) bytes += row.length * 4;
  }
  return bytes;
}

function validOffsets(
  offsets: Uint32Array,
  length: number,
  nonempty = false,
): boolean {
  if (
    !offsets.length ||
    offsets[0] !== 0 ||
    offsets[offsets.length - 1] !== length
  )
    return false;
  for (let i = 1; i < offsets.length; i++)
    if (
      offsets[i] < offsets[i - 1] ||
      offsets[i] > length ||
      (nonempty && offsets[i] === offsets[i - 1])
    )
      return false;
  return true;
}

function validIndices(data: Uint32Array, limit: number): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] >= limit) return false;
  return true;
}

function unpackRows(offsets: Uint32Array, data: Uint32Array): number[][] {
  const rows = new Array<number[]>(offsets.length - 1);
  for (let i = 0; i < rows.length; i++) {
    const row = new Array<number>(offsets[i + 1] - offsets[i]);
    for (let j = 0; j < row.length; j++) row[j] = data[offsets[i] + j];
    rows[i] = row;
  }
  return rows;
}

/** Untrusted cache data fails closed. Hydration never invokes mesh analysis. */
export function unpackTopology(
  payload: unknown,
  sourceCoordinateCount: number,
): MeshTopology | undefined {
  try {
    if (
      !Number.isSafeInteger(sourceCoordinateCount) ||
      sourceCoordinateCount <= 0 ||
      sourceCoordinateCount % 9
    )
      return undefined;
    if (!payload || typeof payload !== "object") return undefined;
    const packed = payload as Partial<PackedTopology>;
    if (
      packed.format !== 2 ||
      !Array.isArray(packed.buffers) ||
      packed.buffers.length !== 14
    )
      return undefined;
    const buffers = packed.buffers;
    for (let i = 0; i < buffers.length; i++)
      if (
        !(buffers[i] instanceof ArrayBuffer) ||
        buffers[i].byteLength % (i === 0 || i === 13 ? 8 : 4)
      )
        return undefined;
    const vertices = new Float64Array(buffers[0]);
    const triangles = new Uint32Array(buffers[1]);
    if (
      !vertices.length ||
      vertices.length % 3 ||
      triangles.length * 3 !== sourceCoordinateCount
    )
      return undefined;
    const vertexCount = vertices.length / 3,
      faceCount = triangles.length / 3;
    for (let i = 0; i < vertices.length; i++)
      if (!Number.isFinite(vertices[i])) return undefined;
    if (!validIndices(triangles, vertexCount)) return undefined;
    const edgeOffsets = new Uint32Array(buffers[3]);
    const uses = new Uint32Array(buffers[4]);
    const edgeCount = edgeOffsets.length - 1;
    if (
      buffers[2].byteLength !== 0 ||
      !validOffsets(edgeOffsets, uses.length, true) ||
      !validIndices(uses, triangles.length)
    )
      return undefined;
    const rowViews: { offsets: Uint32Array; data: Uint32Array }[] = [];
    for (let i = 5; i <= 11; i += 2) {
      const offsets = new Uint32Array(buffers[i]),
        data = new Uint32Array(buffers[i + 1]);
      if (
        !validOffsets(offsets, data.length, i !== 5) ||
        !validIndices(data, i <= 7 ? faceCount : vertexCount)
      )
        return undefined;
      rowViews.push({ offsets, data });
    }
    if (
      rowViews[0].offsets.length !== faceCount + 1 ||
      rowViews[1].data.length !== faceCount
    )
      return undefined;
    const componentMembership = new Uint8Array(faceCount);
    for (const face of rowViews[1].data) {
      if (componentMembership[face]) return undefined;
      componentMembership[face] = 1;
    }
    const diagnostics = new Float64Array(buffers[13]);
    if (diagnostics.length !== diagnosticKeys.length) return undefined;
    const diagnosticLimits = [
      edgeCount,
      vertexCount,
      edgeCount,
      faceCount,
      faceCount,
      edgeCount,
    ];
    for (let i = 0; i < diagnostics.length; i++)
      if (
        !Number.isSafeInteger(diagnostics[i]) ||
        diagnostics[i] < 0 ||
        diagnostics[i] > diagnosticLimits[i]
      )
        return undefined;
    const edges = new MeshEdgeIndex(triangles);
    const seenCorners = new Uint8Array(Math.ceil(triangles.length / 8));
    for (let edge = 0; edge < edgeCount; edge++) {
      const first = uses[edgeOffsets[edge]],
        base = Math.floor(first / 3) * 3;
      const from = triangles[first],
        to = triangles[base + (((first % 3) + 1) % 3)];
      const a = Math.min(from, to),
        b = Math.max(from, to);
      if (a === b) return undefined;
      const key = `${a}:${b}`;
      if (edges.has(key)) return undefined;
      for (let i = edgeOffsets[edge]; i < edgeOffsets[edge + 1]; i++) {
        const corner = uses[i],
          base = Math.floor(corner / 3) * 3,
          from = triangles[corner],
          to = triangles[base + (((corner % 3) + 1) % 3)],
          byte = corner >>> 3,
          mask = 1 << (corner & 7);
        if (
          seenCorners[byte] & mask ||
          !((from === a && to === b) || (from === b && to === a))
        )
          return undefined;
        seenCorners[byte] |= mask;
        edges.addCorner(corner);
      }
    }
    return {
      vertices,
      triangles,
      edges,
      neighbors: unpackRows(rowViews[0].offsets, rowViews[0].data),
      components: unpackRows(rowViews[1].offsets, rowViews[1].data),
      boundaryLoops: unpackRows(rowViews[2].offsets, rowViews[2].data),
      boundaryChains: unpackRows(rowViews[3].offsets, rowViews[3].data),
      nonManifoldEdges: diagnostics[0],
      nonManifoldVertices: diagnostics[1],
      inconsistentEdges: diagnostics[2],
      degenerateTriangles: diagnostics[3],
      duplicateTriangles: diagnostics[4],
      boundaryEdges: diagnostics[5],
    };
  } catch {
    // Detached buffers, hostile getters and invalid typed-array views are misses.
    return undefined;
  }
}
