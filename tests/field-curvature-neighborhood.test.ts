import { describe, expect, it } from "vitest";
import { aggregateCurvatureNeighborhoods } from "../src/field-curvature-neighborhood";
import { buildCurvatureEdgeData } from "../src/field-edge-curvature";
import { decomposeCurvatureTensor } from "../src/field-curvature-eigen";

const f = Math.fround;
const scale = (r: number) => f(1 / f(f(f(r) * f(r)) * f(Math.PI)));
function graph() {
  const positions = new Float32Array([0, 0, 0, 0.5, 0, 0, 2, 0, 0]);
  const edges = buildCurvatureEdgeData(
    positions,
    new Uint32Array([0, 1, 2]),
    new Float32Array([0, 0, 1]),
  );
  edges.angles.fill(1);
  for (let edge = 0; edge < 3; edge++)
    for (let lane = 0; lane < 6; lane++)
      edges.tensors[edge * 6 + lane] = 10 ** edge * (lane + 1);
  return { positions, edges };
}

describe("curvature radius neighborhoods", () => {
  it("deduplicates edges and weights crossing edges by radial distances", () => {
    const { positions, edges } = graph();
    expect(Array.from(edges.adjacency.edgeVertices)).toEqual([
      0, 1, 0, 2, 1, 2,
    ]);
    const result = aggregateCurvatureNeighborhoods(positions, edges, 1);
    expect(result.neighborCounts[0]).toBe(1);
    for (let lane = 0; lane < 6; lane++) {
      const sum =
        lane + 1 + 0.5 * 10 * (lane + 1) + f(1 / 3) * 100 * (lane + 1);
      expect(result.tensors[lane]).toBe(sum * scale(1));
    }
  });
  it("excludes equality from neighbor counting while retaining full boundary edge weight", () => {
    const { positions, edges } = graph();
    const result = aggregateCurvatureNeighborhoods(positions, edges, 0.5);
    expect(result.neighborCounts[0]).toBe(0);
    expect(result.tensors[0]).toBe((1 + 10 * 0.25) * scale(0.5));
  });
  it("traverses flat edges without adding their tensors", () => {
    const { positions, edges } = graph();
    edges.angles[0] = 0;
    const result = aggregateCurvatureNeighborhoods(positions, edges, 1);
    expect(result.neighborCounts[0]).toBe(1);
    expect(result.tensors[0]).toBe((5 + f(1 / 3) * 100) * scale(1));
  });
  it("counts sharp neighbors but stops traversal and preserves skipped seed output", () => {
    const { positions, edges } = graph();
    const previousTensors = new Float64Array(18).fill(9);
    const previousNeighborCounts = new Uint32Array([2, 3, 4]);
    const sharpVertices = new Uint8Array([2]);
    const result = aggregateCurvatureNeighborhoods(positions, edges, 1, {
      sharpVertices,
      previousTensors,
      previousNeighborCounts,
    });
    expect(result.neighborCounts[0]).toBe(3);
    expect(result.tensors[0]).toBe(6 * scale(1));
    expect(Array.from(result.tensors.slice(6, 12))).toEqual([9, 9, 9, 9, 9, 9]);
    expect(result.neighborCounts[1]).toBe(3);
    expect(Array.from(previousNeighborCounts)).toEqual([2, 3, 4]);
    expect(previousTensors.every((v) => v === 9)).toBe(true);
    expect(sharpVertices[0]).toBe(2);
  });
  it("uses symmetry exclusions only for seeds, allowing traversal through excluded vertices", () => {
    const { positions, edges } = graph();
    const result = aggregateCurvatureNeighborhoods(positions, edges, 1, {
      excludedSeeds: new Uint8Array([2]),
    });
    expect(result.neighborCounts[0]).toBe(1);
    expect(result.tensors[0]).toBe((6 + f(1 / 3) * 100) * scale(1));
    expect(Array.from(result.tensors.slice(6, 12))).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("does not cross zero-length edges", () => {
    const { positions, edges } = graph();
    edges.lengths[0] = 0;
    const result = aggregateCurvatureNeighborhoods(positions, edges, 1);
    expect(result.neighborCounts[0]).toBe(0);
    expect(result.tensors[0]).toBe(5 * scale(1));
  });
  it("keeps edge accumulation order through a cyclic neighborhood", () => {
    const { positions, edges } = graph();
    edges.tensors.fill(0);
    edges.tensors[0] = 1e16;
    edges.tensors[6] = -1e16;
    edges.tensors[12] = 1;
    const result = aggregateCurvatureNeighborhoods(positions, edges, 3);
    expect(result.neighborCounts[0]).toBe(2);
    expect(result.tensors[0]).toBe(scale(3));
  });
  it("connects folded geometry edge tensors to numerical eigenpairs", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const edges = buildCurvatureEdgeData(
      positions,
      new Uint32Array([0, 1, 2, 1, 0, 3]),
      new Float32Array([0, 0, 1, 0, 1, 0]),
    );
    const result = aggregateCurvatureNeighborhoods(positions, edges, 10);
    expect(Array.from(result.neighborCounts)).toEqual([3, 3, 3, 3]);
    for (let vertex = 0; vertex < 4; vertex++) {
      expect(
        Array.from(result.tensors.slice(vertex * 6, vertex * 6 + 6)),
      ).toEqual(Array.from(result.tensors.slice(0, 6)));
      const pairs = decomposeCurvatureTensor(
        result.tensors.slice(vertex * 6, vertex * 6 + 6),
      );
      expect(pairs[8]).toBe(1);
      expect(pairs[11]).not.toBe(0);
    }
  });
  it.each([0, -1])(
    "preserves prior owned state for nonpositive radius %s",
    (radius) => {
      const { positions, edges } = graph();
      const previousTensors = new Float64Array(18).fill(4);
      const result = aggregateCurvatureNeighborhoods(positions, edges, radius, {
        previousTensors,
      });
      expect(result.tensors).toEqual(previousTensors);
      expect(result.tensors).not.toBe(previousTensors);
    },
  );
  it("handles empty input and rejects malformed or overflowing arithmetic", () => {
    const empty = buildCurvatureEdgeData(
      new Float32Array(),
      new Uint32Array(),
      new Float32Array(),
    );
    expect(
      aggregateCurvatureNeighborhoods(new Float32Array(), empty, 1).tensors
        .length,
    ).toBe(0);
    const { positions, edges } = graph();
    for (const radius of [NaN, Infinity, 1e-30, 1e30])
      expect(() =>
        aggregateCurvatureNeighborhoods(positions, edges, radius),
      ).toThrow();
    expect(() =>
      aggregateCurvatureNeighborhoods(new Float32Array([0]), edges, 1),
    ).toThrow();
    expect(() =>
      aggregateCurvatureNeighborhoods(positions, edges, 1, {
        previousTensors: new Float64Array(1),
      }),
    ).toThrow();
    edges.tensors[0] = Infinity;
    expect(() =>
      aggregateCurvatureNeighborhoods(positions, edges, 1),
    ).toThrow();
  });
});
