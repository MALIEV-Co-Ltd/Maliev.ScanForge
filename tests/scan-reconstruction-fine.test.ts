import { BoxGeometry } from "three";
import { expect, it } from "vitest";
import { repolygonizeScanMesh } from "../src/scan-tools-remesh";
function cube(offset: number) {
  const a = new BoxGeometry(2, 2, 2),
    b = a.toNonIndexed();
  const p = Float32Array.from(
    b.getAttribute("position").array,
    (v) => v + offset,
  );
  a.dispose();
  b.dispose();
  return p;
}
it("keeps fine sampling across a mostly empty bounding volume without a million-point limit", () => {
  const result = repolygonizeScanMesh(cube(0), {
    resolution: 1,
    targets: [cube(120)],
  });
  expect(result.topology.watertight).toBe(true);
  expect(result.topology.components).toBe(2);
  expect(result.diagnostics.gridPoints).toBeGreaterThan(1_000_000);
  expect(result.diagnostics.distanceTests).toBeLessThan(100_000);
  expect(result.diagnostics.resolution).toBe(1);
});

it("preserves a small gap that coarse reconstruction merges", () => {
  const a = cube(0),
    b = cube(0);
  for (let i = 0; i < b.length; i += 3) b[i] += 4;
  const fine = repolygonizeScanMesh(a, { resolution: 1, targets: [b] });
  const coarse = repolygonizeScanMesh(a, { resolution: 5, targets: [b] });
  expect(fine.topology.components).toBe(2);
  expect(coarse.topology.components).toBe(1);
});
