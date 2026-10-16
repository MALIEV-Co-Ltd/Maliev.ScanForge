import { expect, it } from "vitest";
import { shrinkwrapScanMesh } from "../src/scan-shrinkwrap";
const a = [0, 0, 0, 2, 0, 0, 0, 2, 0],
  b = [0.5, 0.5, -1, 0.5, 0.5, 1, 1.5, 0.5, 0];
it("whole ShrinkWrap reports exhaustive intersection verification for its exact output", () => {
  const result = shrinkwrapScanMesh(new Float32Array(a), { maxDeviation: 0.2 });
  expect(result.diagnostics?.selfIntersectionsChecked).toBe(true);
  expect(result.diagnostics?.selfIntersectionPairs).toBe(0);
  expect(result.diagnostics?.selfIntersectionTriangles).toBe(
    result.positions.length / 9,
  );
});
it("local ShrinkWrap refuses selected geometry intersecting the unchanged parent", () => {
  const p = new Float32Array([...a, ...b]),
    before = p.slice();
  expect(() =>
    shrinkwrapScanMesh(p, {
      scope: "selected",
      selection: new Uint8Array([1, 0]),
    }),
  ).toThrow(/intersect/i);
  expect(p).toEqual(before);
});
it("local verification does not claim to check unrelated outside-only intersections", () => {
  const p = new Float32Array([...a, ...b, 20, 0, 0, 21, 0, 0, 20, 1, 0]);
  const result = shrinkwrapScanMesh(p, {
    scope: "selected",
    selection: new Uint8Array([0, 0, 1]),
  });
  expect(result.positions.slice(0, 18)).toEqual(p.slice(0, 18));
  expect(result.diagnostics?.changedRegionSelfIntersectionsChecked).toBe(true);
  expect(result.diagnostics?.selfIntersectionsChecked).toBe(false);
  expect(result.diagnostics?.selfIntersectionPairs).toBe(0);
  expect(result.diagnostics?.selfIntersectionScope).toBe(
    "changed facets against whole parent",
  );
});
