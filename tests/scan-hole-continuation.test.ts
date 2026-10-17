import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";

// A broad, smooth moulded rib is not a quadratic surface. The missing rectangle
// cuts across it, so a rim-only height average flattens its cross section.
const height = (x: number) => 0.8 * Math.exp(-((x / 1.2) ** 2));
function panel() {
  const p: number[] = [];
  for (let ix = -20; ix < 20; ix++)
    for (let iy = -16; iy < 16; iy++) {
      if (ix >= -12 && ix < 12 && iy >= -4 && iy < 4) continue;
      const point = (x: number, y: number) => [x / 4, y / 4, height(x / 4)];
      const a = point(ix, iy),
        b = point(ix + 1, iy),
        c = point(ix + 1, iy + 1),
        d = point(ix, iy + 1);
      p.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return new Float32Array(p);
}
it("continues a smooth non-quadratic rib instead of averaging away its section", () => {
  const positions = panel(),
    t = analyzeMesh(positions);
  const hole = t.boundaryLoops.findIndex((ids) =>
    ids.every(
      (id) =>
        Math.abs(t.vertices[id * 3]) <= 3.001 &&
        Math.abs(t.vertices[id * 3 + 1]) <= 1.001,
    ),
  );
  expect(hole).toBeGreaterThanOrEqual(0);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [hole],
    algorithm: "automatic",
  });
  expect(result.diagnostics.filledHoles).toBe(1);
  const patch = result.positions!.subarray(positions.length);
  let squared = 0,
    n = 0;
  for (let i = 0; i < patch.length; i += 3) {
    squared += (patch[i + 2] - height(patch[i])) ** 2;
    n++;
  }
  expect(Math.sqrt(squared / n)).toBeLessThan(0.06);
  expect(result.diagnostics.interpolatedSurfaceHoles).toBe(1);
  expect(result.positions!.subarray(0, positions.length)).toEqual(positions);
  const after = analyzeMesh(result.positions!);
  expect(after.boundaryLoops).toHaveLength(1);
  expect(
    after.nonManifoldEdges +
      after.inconsistentEdges +
      after.degenerateTriangles +
      after.duplicateTriangles,
  ).toBe(0);
});
