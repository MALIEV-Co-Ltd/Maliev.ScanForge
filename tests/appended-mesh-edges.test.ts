import { describe, expect, it } from "vitest";
import { appendMeshEdges, MeshEdgeIndex } from "../src/mesh-edge-index";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { packTopology, unpackTopology } from "../src/topology-cache-codec";

describe("appended edge directory", () => {
  it("preserves Map ordering and immutable snapshots across successive patches", () => {
    const triangles = new Uint32Array([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
    const base = new MeshEdgeIndex(triangles.subarray(0, 6));
    for (let i = 0; i < 6; i++) base.addCorner(i);
    const reference = new Map(base);
    const appendReference = (start: number, end: number) => {
      for (let corner = start; corner < end; corner++) {
        const from = triangles[corner],
          to = triangles[corner - (corner % 3) + ((corner + 1) % 3)];
        const key = from < to ? `${from}:${to}` : `${to}:${from}`;
        reference.set(key, [
          ...(reference.get(key) ?? []),
          { face: Math.floor(corner / 3), from, to },
        ]);
      }
    };
    const first = appendMeshEdges(base, triangles, 6, 9);
    appendReference(6, 9);
    const snapshot = [...first];
    expect(snapshot).toEqual([...reference]);
    const second = appendMeshEdges(first, triangles, 9, 12);
    appendReference(9, 12);
    expect([...second]).toEqual([...reference]);
    expect([...first]).toEqual(snapshot);
    expect(second.size).toBe(reference.size);
    expect([...second.keys()]).toEqual([...reference.keys()]);
    expect([...second.values()]).toEqual([...reference.values()]);
    for (const [key, value] of reference) {
      expect(second.has(key)).toBe(true);
      expect(second.get(key)).toEqual(value);
    }
    const calls: unknown[] = [];
    second.forEach((value, key, map) =>
      calls.push([key, value, map === second]),
    );
    expect(calls).toEqual(
      [...reference].map(([key, value]) => [key, value, true]),
    );
  });
  it("honors cancellation without changing the base directory", () => {
    const base = new Map([["0:1", [{ face: 0, from: 0, to: 1 }]]]);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      appendMeshEdges(base, [0, 1, 2], 0, 3, controller.signal),
    ).toThrowError(/cancelled/);
    expect([...base]).toEqual([["0:1", [{ face: 0, from: 0, to: 1 }]]]);
  });
  it("roundtrips a topology using the streaming codec", () => {
    const triangles = new Uint32Array([0, 1, 2, 2, 1, 3]);
    const base = new MeshEdgeIndex(triangles.subarray(0, 3));
    for (let i = 0; i < 3; i++) base.addCorner(i);
    const edges = appendMeshEdges(base, triangles, 3, 6);
    const topology = analyzeIndexedMesh(
      new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      triangles,
      {},
      edges,
    );
    const restored = unpackTopology(packTopology(topology), 18)!;
    expect(restored).toBeDefined();
    expect([...restored.edges]).toEqual([...edges]);
    expect(restored.boundaryLoops).toEqual(topology.boundaryLoops);
    expect(restored.neighbors).toEqual(topology.neighbors);
  });
});
