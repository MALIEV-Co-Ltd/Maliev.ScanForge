import { expect, it } from "vitest";
import { BoxGeometry } from "three";
import { repolygonizeScanMesh } from "../src/scan-tools-remesh";
it("admits a half-millimetre surface across a volume above the fine-grid cap", () => {
  const indexed = new BoxGeometry(2, 2, 2),
    g = indexed.toNonIndexed(),
    a = Float32Array.from(g.getAttribute("position").array),
    b = a.map((v) => v + 260);
  indexed.dispose();
  g.dispose();
  const result = repolygonizeScanMesh(a, { resolution: 0.5, targets: [b] });
  expect(result.diagnostics.gridPoints).toBeGreaterThan(128_000_000);
  expect(result.diagnostics.resolution).toBe(0.5);
  expect(result.topology.watertight).toBe(true);
  expect(result.topology.components).toBe(2);
}, 30000);

it("rejects world coordinates that cannot preserve distinct contour vertices at Float32 precision", () => {
  const p = [10_000_000, 0, 0, 10_000_004, 0, 0, 10_000_000, 4, 0];
  expect(() => repolygonizeScanMesh(p, { resolution: 4 })).toThrow(
    /coordinate magnitude/,
  );
});
