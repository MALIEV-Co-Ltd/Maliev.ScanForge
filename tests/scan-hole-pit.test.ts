import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";

/** A shallow panel with a narrow, steep scan lip at the missing patch. */
function steepLipFixture(uneven = false, rotated = false) {
  const count = 32,
    positions: number[] = [];
  const point = (i: number, r: number, z: number) => {
    const angle = ((i % count) * 2 * Math.PI) / count;
    const x = r * Math.cos(angle),
      y = r * Math.sin(angle);
    z += uneven ? 0.04 * Math.sin(3 * angle) : 0;
    return rotated ? [10 + z, 20 + x, 30 + y] : [x, y, z];
  };
  for (const [a, b, za, zb] of [
    [4, 4.15, 0, 0.5],
    [4.15, 5.5, 0.5, 0.5],
  ])
    for (let i = 0; i < count; i++) {
      const p = point(i, a, za),
        q = point(i, b, zb),
        r = point(i + 1, b, zb),
        s = point(i + 1, a, za);
      positions.push(...p, ...q, ...r, ...p, ...r, ...s);
    }
  const source = new Float32Array(positions),
    topology = analyzeMesh(source);
  const hole = topology.boundaryLoops.findIndex((ids) =>
    ids.every((id) => {
      const p = topology.vertices.subarray(id * 3, id * 3 + 3);
      return (
        (rotated ? Math.hypot(p[1] - 20, p[2] - 30) : Math.hypot(p[0], p[1])) <
        4.1
      );
    }),
  );
  return { positions: source, hole, rotated };
}

it("exposes bounded surrounding-surface recovery as an explicit algorithm", () => {
  const fixture = steepLipFixture();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions: fixture.positions,
    indices: [fixture.hole],
    algorithm: "surfaceRecovery",
  });
  expect(result.diagnostics.filledHoles).toBe(1);
  expect(result.diagnostics.boundedFallbackHoles).toBe(1);
  expect(result.diagnostics.surfaceFallbackReasons).toContain("sharp edge");
  for (
    let i = fixture.positions.length + 2;
    i < result.positions!.length;
    i += 3
  )
    expect(Math.abs(result.positions![i])).toBeLessThan(1e-6);
  expect(() =>
    runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions: fixture.positions,
      indices: [fixture.hole],
      algorithm: "surfaceRecovery",
      mode: "partial",
    }),
  ).toThrow("entire closed hole");
});

it.each([
  [false, false],
  [true, false],
  [true, true],
])(
  "surface recovery does not dig a pit at a steep scan lip (uneven %s, rotated %s)",
  (uneven, rotated) => {
    const fixture = steepLipFixture(uneven, rotated);
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions: fixture.positions,
      indices: [fixture.hole],
      algorithm: "surfaceRecovery",
    });
    expect(result.diagnostics.filledHoles).toBe(1);
    expect(result.diagnostics.boundedFallbackHoles).toBe(1);
    expect(result.diagnostics.surfaceFitHoles).toBe(0);
    expect(result.diagnostics.surfaceFallbackReasons).toContain("sharp edge");
    const patch = result.positions!.subarray(fixture.positions.length);
    expect(patch.length).toBeGreaterThan(0);
    for (let i = 0; i < patch.length; i += 3) {
      const height = rotated ? patch[i] - 10 : patch[i + 2];
      expect(height).toBeGreaterThanOrEqual(-0.041);
      expect(height).toBeLessThanOrEqual(0.041);
    }
    expect(result.positions!.subarray(0, fixture.positions.length)).toEqual(
      fixture.positions,
    );
    const topology = analyzeMesh(result.positions!);
    expect(topology.boundaryLoops).toHaveLength(1);
    expect(
      topology.nonManifoldEdges +
        topology.inconsistentEdges +
        topology.degenerateTriangles +
        topology.duplicateTriangles,
    ).toBe(0);
  },
);
