import * as THREE from "three";

function releaseScratch(array: Uint32Array) {
  const buffer = array.buffer as ArrayBuffer & {
    transfer?: (size: number) => ArrayBuffer;
  };
  try {
    buffer.transfer?.(0);
  } catch {
    // Collection remains the fallback.
  }
}

function boundaryFaces(
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  tolerance: number,
): Uint8Array {
  // Keep the original scale-dependent quantization without allocating one
  // string per corner and one map entry per edge on large selections.
  const count = positions.count;
  const ids = new Uint32Array(count);
  let first = new Uint32Array(Math.min(count, 1024));
  let table = new Uint32Array(2048),
    unique = 0;
  const hash = (x: number, y: number, z: number) => {
    const h =
      Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
    return (h ^ (h >>> 16)) >>> 0;
  };
  for (let corner = 0; corner < count; corner++) {
    const x = Math.round(positions.getX(corner) / tolerance),
      y = Math.round(positions.getY(corner) / tolerance),
      z = Math.round(positions.getZ(corner) / tolerance);
    let slot = hash(x, y, z) & (table.length - 1);
    while (table[slot]) {
      const i = first[table[slot] - 1],
        a = Math.round(positions.getX(i) / tolerance),
        b = Math.round(positions.getY(i) / tolerance),
        c = Math.round(positions.getZ(i) / tolerance);
      if (x === a && y === b && z === c) break;
      slot = (slot + 1) & (table.length - 1);
    }
    if (!table[slot]) {
      if ((unique + 1) * 3 > table.length * 2) {
        const grown = new Uint32Array(table.length * 2);
        for (let id = 0; id < unique; id++) {
          const i = first[id],
            a = Math.round(positions.getX(i) / tolerance),
            b = Math.round(positions.getY(i) / tolerance),
            c = Math.round(positions.getZ(i) / tolerance);
          let next = hash(a, b, c) & (grown.length - 1);
          while (grown[next]) next = (next + 1) & (grown.length - 1);
          grown[next] = id + 1;
        }
        releaseScratch(table);
        table = grown;
        slot = hash(x, y, z) & (table.length - 1);
        while (table[slot]) slot = (slot + 1) & (table.length - 1);
      }
      if (unique === first.length) {
        const grown = new Uint32Array(
          Math.min(count, Math.max(1, first.length * 2)),
        );
        grown.set(first);
        releaseScratch(first);
        first = grown;
      }
      first[unique] = corner;
      table[slot] = ++unique;
    }
    ids[corner] = table[slot] - 1;
  }
  releaseScratch(first);
  releaseScratch(table);
  first = new Uint32Array(0);
  table = new Uint32Array(0);
  const exposedFaces = new Uint8Array(count / 3);
  // Only the first use of an edge can be exposed. A second use clears its
  // flag, so neither incidence lists nor per-edge counters are needed.
  let edgeSlots = new Uint32Array(2048),
    edges = 0;
  const edgeHash = (a: number, b: number) => {
    const h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663);
    return (h ^ (h >>> 16)) >>> 0;
  };
  for (let corner = 0; corner < count; corner++) {
    const base = corner - (corner % 3),
      from = ids[corner],
      to = ids[base + ((corner + 1) % 3)],
      a = Math.min(from, to),
      b = Math.max(from, to);
    let slot = edgeHash(a, b) & (edgeSlots.length - 1);
    while (edgeSlots[slot]) {
      const i = edgeSlots[slot] - 1,
        j = i - (i % 3),
        from = ids[i],
        to = ids[j + ((i + 1) % 3)],
        u = Math.min(from, to),
        v = Math.max(from, to);
      if (a === u && b === v) break;
      slot = (slot + 1) & (edgeSlots.length - 1);
    }
    if (edgeSlots[slot]) {
      const firstCorner = edgeSlots[slot] - 1;
      exposedFaces[Math.floor(firstCorner / 3)] &= ~(
        1 <<
        ((firstCorner + 2) % 3)
      );
    } else {
      if ((edges + 1) * 3 > edgeSlots.length * 2) {
        const grown = new Uint32Array(edgeSlots.length * 2);
        for (let slot = 0; slot < edgeSlots.length; slot++) {
          const encoded = edgeSlots[slot];
          if (!encoded) continue;
          const i = encoded - 1,
            j = i - (i % 3),
            from = ids[i],
            to = ids[j + ((i + 1) % 3)],
            u = Math.min(from, to),
            v = Math.max(from, to);
          let next = edgeHash(u, v) & (grown.length - 1);
          while (grown[next]) next = (next + 1) & (grown.length - 1);
          grown[next] = encoded;
        }
        releaseScratch(edgeSlots);
        edgeSlots = grown;
        slot = edgeHash(a, b) & (edgeSlots.length - 1);
        while (edgeSlots[slot]) slot = (slot + 1) & (edgeSlots.length - 1);
      }
      edgeSlots[slot] = corner + 1;
      edges++;
      exposedFaces[Math.floor(corner / 3)] |= 1 << ((corner + 2) % 3);
    }
  }
  releaseScratch(ids);
  releaseScratch(edgeSlots);
  return exposedFaces;
}

/** Mark only exposed selection edges, excluding shared internal triangulation. */
export function installSelectionBoundaryAttributes(
  geometry: THREE.BufferGeometry,
) {
  const positions = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const size = bounds.getSize(new THREE.Vector3());
  const tolerance = Math.max(size.x, size.y, size.z, 1) * 1e-6;
  // The edge directory is temporary and can be collected before allocating
  // the shader attributes and outline geometry.
  const exposedFaces = boundaryFaces(positions, tolerance);
  // Each expanded triangle corner is 0, 1 or 2; the vertex shader decodes it.
  const barycentric = new Uint8Array(positions.count);
  let edgeCount = 0;
  for (let i = 0; i < exposedFaces.length; i++) {
    const flags = exposedFaces[i];
    edgeCount += (flags & 1) + ((flags >> 1) & 1) + ((flags >> 2) & 1);
  }
  const segments = new Float32Array(edgeCount * 6);
  let segmentOffset = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const exposed = exposedFaces[i / 3];
    for (let edge = 0; edge < 3; edge++) {
      if (!(exposed & (1 << edge))) continue;
      for (let offset = 1; offset <= 2; offset++) {
        const vertex = i + ((edge + offset) % 3);
        segments[segmentOffset++] = positions.getX(vertex);
        segments[segmentOffset++] = positions.getY(vertex);
        segments[segmentOffset++] = positions.getZ(vertex);
      }
    }
    for (let vertex = 0; vertex < 3; vertex++) {
      barycentric[i + vertex] = vertex;
    }
  }
  geometry.setAttribute(
    "processingBarycentric",
    new THREE.BufferAttribute(barycentric, 1),
  );
  return segments;
}
