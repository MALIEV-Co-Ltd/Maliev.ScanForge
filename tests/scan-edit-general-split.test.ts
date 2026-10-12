import { describe, expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";
import type { Positions } from "../src/types";
const area = (positions: Positions) =>
  positions.length
    ? runScanEdit({
        kind: "scanEdit",
        action: "inventory",
        positions,
      }).inventory!.components.reduce((n, c) => n + c.area, 0)
    : 0;
function concaveL(): number[] {
  const cells = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    occupied = new Set(cells.map((c) => c.join(","))),
    result: number[] = [];
  const v = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const sides = [
    { d: [0, 0, -1], ids: [0, 2, 1, 0, 3, 2] },
    { d: [0, 0, 1], ids: [4, 5, 6, 4, 6, 7] },
    { d: [0, -1, 0], ids: [0, 1, 5, 0, 5, 4] },
    { d: [1, 0, 0], ids: [1, 2, 6, 1, 6, 5] },
    { d: [0, 1, 0], ids: [2, 3, 7, 2, 7, 6] },
    { d: [-1, 0, 0], ids: [3, 0, 4, 3, 4, 7] },
  ];
  for (const cell of cells)
    for (const side of sides)
      if (!occupied.has(cell.map((c, a) => c + side.d[a]).join(",")))
        for (const id of side.ids)
          result.push(...v[id].map((c, a) => c + cell[a]));
  return result;
}
describe("general mesh cutters", () => {
  it("partitions an L-shaped closed concave mesh by exact crossing fragments and conserves area", () => {
    const target = concaveL();
    expect(analyzeMesh(target).boundaryEdges).toBe(0);
    expect(analyzeMesh(target).inconsistentEdges).toBe(0);
    const positions = [
      -1, -1, 0.5, 3, -1, 0.5, 3, 3, 0.5, -1, -1, 0.5, 3, 3, 0.5, -1, 3, 0.5,
    ];
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions,
      target,
    });
    expect(result.diagnostics.cutter).toBe("closed mesh ray parity");
    expect(result.diagnostics.splitTriangles).toBe(2);
    expect(area(result.segments![0])).toBeCloseTo(3, 5);
    expect(area(result.segments![1])).toBeCloseTo(13, 5);
    expect(
      [...result.segments![0]]
        .filter((_, i) => i % 3 === 2)
        .every((z) => z === 0.5),
    ).toBe(true);
    for (let i = 0; i < result.segments![0].length; i += 9) {
      const x =
          (result.segments![0][i] +
            result.segments![0][i + 3] +
            result.segments![0][i + 6]) /
          3,
        y =
          (result.segments![0][i + 1] +
            result.segments![0][i + 4] +
            result.segments![0][i + 7]) /
          3;
      expect(x >= 0 && y >= 0 && x <= 2 && y <= 2 && (x <= 1 || y <= 1)).toBe(
        true,
      );
    }
  });
  it("splits an open folded surface where its triangles intersect the source", () => {
    const target = [
      0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 1,
      1, -1, 1, 1, 1, 0, 1, -1, 1, 1, 1, 0, 1, 1,
    ];
    const positions = [
      -0.5, -0.5, 0, 1.5, -0.5, 0, 1.5, 1.5, 0, -0.5, -0.5, 0, 1.5, 1.5, 0,
      -0.5, 1.5, 0,
    ];
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions,
      target,
    });
    expect(result.diagnostics.cutter).toBe(
      "open surface signed nearest grouping",
    );
    expect(result.diagnostics.splitTriangles).toBeGreaterThan(0);
    expect(area(result.segments![0]) + area(result.segments![1])).toBeCloseTo(
      4,
      5,
    );
    const points = result.segments!.flatMap((p) =>
      Array.from({ length: p.length / 3 }, (_, i) => [
        p[i * 3],
        p[i * 3 + 1],
        p[i * 3 + 2],
      ]),
    );
    expect(
      points.some((p) => Math.abs(p[0]) < 1e-6 && Math.abs(p[1] - 1) < 1e-6),
    ).toBe(true);
  });
  it("does not split by the infinite extension of a finite planar mesh", () => {
    const positions = [-1, 4, 0, 1, 4, 0, 0, 5, 0];
    const target = [0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1];
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions,
      target,
    });
    expect(result.diagnostics.splitTriangles).toBe(0);
    expect(result.segments!.filter((p) => p.length > 0)).toHaveLength(1);
    expect(result.segments!.find((p) => p.length > 0)).toEqual(
      new Float32Array(positions),
    );
  });
});
