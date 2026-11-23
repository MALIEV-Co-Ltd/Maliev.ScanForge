import { expect, it } from "vitest";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";

it("rejects a non-manifold source edge touched close to its corner", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]);
  const cutter = new Float32Array([0.0004, 0, 0, 0.4, 0.3, 0, 0.2, 0.15, 1]);
  expect(() =>
    refineFiniteCutterMesh(vertices, triangles, cutter, {
      preciseCoordinates: true,
    }),
  ).toThrow(/non.manifold/i);
});

it("keeps both sides of a through-plane cut near a shared source corner", () => {
  const source = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0,
  ]);
  const cutter = new Float32Array([
    0.0004, -2, -2, 0.0004, 4, -2, 0.0004, -2, 4,
  ]);
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segments).toHaveLength(2);
  const x = Math.fround(0.0004);
  const ranges = result.segments.map((part) => {
    const coords = Array.from(part).filter((_, i) => i % 3 === 0);
    return [Math.min(...coords), Math.max(...coords)];
  });
  expect(ranges.every(([min, max]) => max <= x + 1e-8 || min >= x - 1e-8)).toBe(
    true,
  );
  expect(ranges.some(([, max]) => max <= x + 1e-8)).toBe(true);
  expect(ranges.some(([min]) => min >= x - 1e-8)).toBe(true);
});
