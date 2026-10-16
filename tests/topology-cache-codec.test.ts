import { describe, expect, it } from "vitest";
import {
  analyzeIndexedMesh,
  analyzeMesh,
  type MeshTopology,
} from "../src/mesh-processing";
import {
  packTopology,
  unpackTopology,
  packedTopologyBytes,
  estimatedPackedTopologyBytes,
} from "../src/topology-cache-codec";

const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
function roundtrip(topology: MeshTopology) {
  const packed = packTopology(topology);
  expect(packed.format).toBe(1);
  expect(packed.buffers).toHaveLength(14);
  expect(packed.buffers.every((buffer) => buffer instanceof ArrayBuffer)).toBe(
    true,
  );
  expect(packedTopologyBytes(packed)).toBe(
    packed.buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
  );
  expect(estimatedPackedTopologyBytes(topology)).toBe(
    packedTopologyBytes(packed),
  );
  const restored = unpackTopology(
    structuredClone(packed),
    topology.triangles.length * 3,
  );
  expect(restored).toEqual(topology);
  expect([...restored!.edges]).toEqual([...topology.edges]);
  expect(restored!.vertices).not.toBe(topology.vertices);
  expect(restored!.triangles).not.toBe(topology.triangles);
  return packed;
}

describe("packed full topology cache", () => {
  it("estimates an oversized snapshot from lengths without touching element data or allocating packed arrays", () => {
    const lengthOnly = <T>(length: number): T =>
      new Proxy(
        {},
        {
          get(_target, key) {
            if (key === "length") return length;
            throw new Error(
              "Estimator read element data or attempted allocation/copy",
            );
          },
        },
      ) as T;
    const topology = analyzeMesh(square);
    topology.vertices = lengthOnly<Float64Array>(30_000_000);
    topology.triangles = lengthOnly<Uint32Array>(15_000_000);
    topology.edges = new Map([["0:1", lengthOnly(12_000_000)]]);
    topology.neighbors = [lengthOnly(5_000_000)];
    topology.components = [lengthOnly(5_000_000)];
    topology.boundaryLoops = [lengthOnly(1_000_000)];
    topology.boundaryChains = [lengthOnly(2_000_000)];
    const bytes = estimatedPackedTopologyBytes(topology);
    expect(bytes).toBe(
      30_000_000 * 8 +
        15_000_000 * 4 +
        2 * 4 +
        2 * 4 +
        12_000_000 * 3 * 4 +
        4 * 2 * 4 +
        13_000_000 * 4 +
        6 * 8,
    );
    expect(bytes).toBeGreaterThan(128 * 1024 * 1024);
  });

  it("roundtrips manifold topology, facet order, winding and edge insertion/use order", () => {
    roundtrip(analyzeMesh(square));
  });

  it("preserves disconnected components and each ordered hole boundary", () => {
    const topology = analyzeMesh([
      ...square,
      ...square.map((value, i) => (i % 3 === 0 ? value + 4 : value)),
    ]);
    expect(topology.components).toHaveLength(2);
    expect(topology.boundaryLoops).toHaveLength(2);
    roundtrip(topology);
  });

  it("preserves open chains and all nonmanifold, duplicate and degenerate diagnostics", () => {
    const topology = analyzeMesh([
      ...square,
      ...square.slice(0, 9),
      4,
      0,
      0,
      4,
      0,
      0,
      4,
      0,
      0,
    ]);
    expect(topology.nonManifoldEdges).toBeGreaterThan(0);
    expect(topology.boundaryChains.length).toBeGreaterThan(0);
    expect(topology.duplicateTriangles).toBe(1);
    expect(topology.degenerateTriangles).toBe(1);
    roundtrip(topology);
  });

  it("retains distinct vertex identities moved inside weld tolerance and unused vertices", () => {
    const topology = analyzeIndexedMesh(
      new Float64Array([0, 0, 0, 1e-8, 0, 0, 0, 1, 0, 99, 99, 99]),
      new Uint32Array([0, 1, 2]),
      { tolerance: 1e-12 },
    );
    const packed = roundtrip(topology);
    expect(unpackTopology(packed, 9)!.vertices.length).toBe(12);
    topology.vertices[0] = 123;
    expect(unpackTopology(packed, 9)!.vertices[0]).toBe(0);
  });

  it("rejects incorrect schema and mismatching original coordinate count", () => {
    const packed = packTopology(analyzeMesh(square));
    for (const malformed of [
      null,
      {},
      { ...packed, format: 2 },
      { ...packed, buffers: packed.buffers.slice(1) },
      {
        ...packed,
        buffers: packed.buffers.map((buffer) => new Uint8Array(buffer)),
      },
    ])
      expect(unpackTopology(malformed, square.length)).toBeUndefined();
    for (const count of [0, 9, 17, NaN, Infinity, -18])
      expect(unpackTopology(packed, count)).toBeUndefined();
  });

  it("rejects malformed CSR and edge offsets, indices, nonfinite coordinates and invalid diagnostics", () => {
    const packed = packTopology(analyzeMesh(square));
    const corrupt = (buffer: number, mutate: (buffer: ArrayBuffer) => void) => {
      const copy = structuredClone(packed);
      mutate(copy.buffers[buffer]);
      expect(unpackTopology(copy, square.length)).toBeUndefined();
    };
    corrupt(0, (buffer) => {
      new Float64Array(buffer)[0] = Infinity;
    });
    corrupt(1, (buffer) => {
      new Uint32Array(buffer)[0] = 999;
    });
    corrupt(2, (buffer) => {
      new Uint32Array(buffer)[0] = 999;
    });
    corrupt(3, (buffer) => {
      new Uint32Array(buffer)[0] = 1;
    });
    corrupt(4, (buffer) => {
      new Uint32Array(buffer)[0] = 999;
    });
    corrupt(5, (buffer) => {
      new Uint32Array(buffer)[1] = 999;
    });
    corrupt(6, (buffer) => {
      new Uint32Array(buffer)[0] = 999;
    });
    corrupt(7, (buffer) => {
      new Uint32Array(buffer)[0] = 1;
    });
    corrupt(8, (buffer) => {
      new Uint32Array(buffer)[0] = 999;
    });
    corrupt(9, (buffer) => {
      new Uint32Array(buffer)[1] = 999;
    });
    corrupt(10, (buffer) => {
      new Uint32Array(buffer)[0] = 999;
    });
    corrupt(13, (buffer) => {
      new Float64Array(buffer)[0] = NaN;
    });
    const copy = structuredClone(packed);
    copy.buffers[0] = new ArrayBuffer(7);
    expect(unpackTopology(copy, square.length)).toBeUndefined();
  });
});
