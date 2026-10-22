import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import {
  residentSourceFanQuery,
  normalizeCutFans,
} from "../src/scan-edge-directory";
import { prepareReductionMesh } from "../src/scan-reduction-preparation";

const source = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, -1, 0, 0, 0,
  -1, 0, 0, 0, 0, 0, -1, 0, 1, 0, 0,
]);

it("proves complete source stars before separating locally disconnected fans", () => {
  const local = new Float32Array([
    ...source.subarray(0, 9),
    ...source.subarray(18, 27),
  ]);
  const before = analyzeMesh(local);
  expect(before.nonManifoldVertices).toBe(1);
  const normalized = normalizeCutFans(
    before,
    residentSourceFanQuery(source, {}),
    {},
  );
  expect(normalized?.nonManifoldVertices).toBe(0);
  expect(normalized?.triangles.length).toBe(6);
  const exported = Array.from(normalized!.triangles).flatMap((id) => [
    ...normalized!.vertices.subarray(id * 3, id * 3 + 3),
  ]);
  expect(exported).toEqual([...local]);
  const working = prepareReductionMesh(
    normalized!.vertices,
    normalized!.triangles,
  );
  expect(
    working.vertices
      .filter((v) => v.point.every((value) => value === 0))
      .every((v) => v.boundary),
  ).toBe(true);
  expect(
    normalizeCutFans(before, residentSourceFanQuery(local, {}), {}),
  ).toBeUndefined();
});

it("does not normalize duplicate faces, reversed winding or nonmanifold source edges", () => {
  expect(residentSourceFanQuery(source, {})([0, 0, 0])).toBe(true);
  const duplicate = new Float32Array([...source, ...source.subarray(0, 9)]);
  expect(residentSourceFanQuery(duplicate, {})([0, 0, 0])).toBe(false);
  const reversed = source.slice();
  reversed.set(
    [
      ...source.subarray(0, 3),
      ...source.subarray(6, 9),
      ...source.subarray(3, 6),
    ],
    0,
  );
  expect(residentSourceFanQuery(reversed, {})([0, 0, 0])).toBe(false);
});

it("honors cancellation before constructing the resident source index", () => {
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    residentSourceFanQuery(source, { signal: abort.signal })([0, 0, 0]),
  ).toThrow(/cancelled/);
});
