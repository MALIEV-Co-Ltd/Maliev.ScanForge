import { describe, expect, it } from "vitest";
import { deriveFieldConnectionPool } from "../src/field-connection-pool";
import { deriveTriangleFieldCenters } from "../src/field-face-centers";

function graph(count: number, incident: number[][]) {
  const corners = new Uint8Array(count);
  const faceEdges = new Uint32Array(count * 3);
  const groups = incident.map((faces, edge) =>
    faces.map((face) => {
      const halfedge = face * 3 + corners[face]++;
      faceEdges[halfedge] = edge;
      return halfedge;
    }),
  );
  for (let face = 0; face < count; face++)
    while (corners[face] < 3) {
      const halfedge = face * 3 + corners[face]++;
      faceEdges[halfedge] = groups.length;
      groups.push([halfedge]);
    }
  const offsets = [0];
  for (const group of groups) offsets.push(offsets.at(-1)! + group.length);
  return {
    faceEdges,
    edgeOffsets: Uint32Array.from(offsets),
    halfedges: Uint32Array.from(groups.flat()),
  };
}
function mask(ids: number[], bitCount: number) {
  const bits = new Uint8Array(Math.ceil(bitCount / 8));
  for (const id of ids) bits[id >> 3] |= 1 << (id & 7);
  return { bits, bitCount };
}
function run(
  centers: number[],
  incident: number[][],
  fixed: number[] = [],
  excluded: number[] = [],
) {
  const count = centers.length / 3;
  const g = graph(count, incident);
  return deriveFieldConnectionPool(
    Float32Array.from(centers),
    g.faceEdges,
    g.edgeOffsets,
    g.halfedges,
    mask(fixed, count),
    mask(excluded, count),
  );
}

describe("recovered field connection pool", () => {
  it("removes predecessor edges from a cycle and uses node zero when no seed qualifies", () => {
    const result = run(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
    );
    expect([...result.distances]).toEqual([0, 1, 1]);
    expect([...result.predecessorEdges]).toEqual([-1, 0, 1]);
    expect([...result.edgeIds]).toEqual([2]);
  });
  it("requeues popped faces after a later improvement and propagates that improvement onward", () => {
    const result = run(
      [0, 0, 0, 100, 0, 0, 0, 1, 0, 0, 3, 0, 0, 2, 0, 0, 4, 0],
      [
        [0, 1],
        [0, 2],
        [1, 3],
        [2, 4],
        [4, 3],
        [3, 5],
      ],
    );
    expect([...result.distances]).toEqual([0, 100, 1, 3, 2, 4]);
    expect([...result.predecessorEdges]).toEqual([-1, 0, 1, 4, 3, 5]);
    expect([...result.edgeIds]).toEqual([2]);
  });
  it("retains first equal-cost predecessors with ascending seeds and filters fixed-to-fixed edges", () => {
    const result = run(
      new Array(9).fill(0),
      [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
      [0, 2],
    );
    expect([...result.predecessorEdges]).toEqual([-1, 0, -1]);
    expect([...result.edgeIds]).toEqual([2]);
    const allFixed = run(
      new Array(9).fill(0),
      [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
      [0, 1, 2],
    );
    expect(allFixed.edgeIds.length).toBe(0);
  });
  it("excludes designated seeds while honoring bounded bit counts", () => {
    const g = graph(3, [
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
    const result = deriveFieldConnectionPool(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      g.faceEdges,
      g.edgeOffsets,
      g.halfedges,
      { bits: new Uint8Array([7]), bitCount: 2 },
      { bits: new Uint8Array([1]), bitCount: 1 },
    );
    expect([...result.distances]).toEqual([1, 0, Math.fround(Math.sqrt(2))]);
    expect([...result.predecessorEdges]).toEqual([0, -1, 2]);
    expect([...result.edgeIds]).toEqual([1]);
  });
  it("does not traverse nonmanifold edges and keeps unreachable distances at float max", () => {
    const result = run(new Array(9).fill(0), [[0, 1, 2]]);
    expect(result.edgeIds.length).toBe(0);
    expect([...result.predecessorEdges]).toEqual([-1, -1, -1]);
    expect(result.distances[1]).toBe(3.4028234663852886e38);
  });
  it("consumes geometry-derived centers and returns independent diagnostics", () => {
    const centers = deriveTriangleFieldCenters(
      new Float32Array([0, 0, 0, 3, 0, 0, 0, 3, 0]),
      new Uint32Array([0, 1, 2, 1, 2, 0]),
    );
    const g = graph(2, [[0, 1]]);
    const original = [...centers];
    const result = deriveFieldConnectionPool(
      centers,
      g.faceEdges,
      g.edgeOffsets,
      g.halfedges,
      mask([], 2),
    );
    expect([...result.distances]).toEqual([0, 0]);
    result.distances.fill(8);
    expect([...centers]).toEqual(original);
    expect(
      deriveFieldConnectionPool(
        new Float32Array(),
        new Uint32Array(),
        new Uint32Array([0]),
        new Uint32Array(),
        mask([], 0),
      ).edgeIds.length,
    ).toBe(0);
  });
  it("rejects malformed incidence, masks and nonfinite centers", () => {
    const g = graph(2, [[0, 1]]);
    const execute = (
      centers = new Float32Array(6),
      offsets = g.edgeOffsets,
      halfedges = g.halfedges,
      fixed = mask([], 2),
    ) =>
      deriveFieldConnectionPool(
        centers,
        g.faceEdges,
        offsets,
        halfedges,
        fixed,
      );
    expect(() => execute(new Float32Array([NaN, 0, 0, 0, 0, 0]))).toThrow(
      /finite/,
    );
    expect(() => execute(new Float32Array(3))).toThrow(/dimensions/);
    expect(() =>
      execute(
        undefined,
        undefined,
        Uint32Array.from(g.halfedges, () => 0),
      ),
    ).toThrow(/incidence/);
    expect(() =>
      execute(undefined, undefined, undefined, {
        bits: new Uint8Array(1),
        bitCount: 9,
      }),
    ).toThrow(/mask/);
    const invalidOffsets = new Uint32Array(g.edgeOffsets);
    invalidOffsets[1] = 0xffffffff;
    expect(() => execute(undefined, invalidOffsets)).toThrow(/bounded/);
  });
});
