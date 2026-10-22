import { expect, it } from "vitest";
import { runScanTool } from "../src/scan-tools";

it("smooths every facet above the former 500000-triangle input cap", () => {
  const nx = 501,
    ny = 500;
  const positions = new Float32Array(nx * ny * 18);
  let at = 0;
  const emit = (x: number, y: number) => {
    positions[at++] = x;
    positions[at++] = y;
    positions[at++] = x === 250 && y === 250 ? 0.2 : 0;
  };
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      emit(x, y);
      emit(x + 1, y);
      emit(x + 1, y + 1);
      emit(x, y);
      emit(x + 1, y + 1);
      emit(x, y + 1);
    }
  const result = runScanTool({
    kind: "scanTools",
    positions,
    operation: {
      kind: "reduceNoise",
      iterations: 1,
      applyBoundaryEdges: false,
    },
  });
  expect(result.positions.length).toBe(4_509_000);
  expect(result.positions.every(Number.isFinite)).toBe(true);
  // The central spike moves, while a protected outer corner stays fixed.
  const spike = (249 * nx + 249) * 18 + 8;
  expect(result.positions[spike]).toBeLessThan(0.2);
  expect(result.positions.slice(0, 3)).toEqual(new Float32Array([0, 0, 0]));
  expect(positions[spike]).toBeCloseTo(0.2);
}, 120000);
