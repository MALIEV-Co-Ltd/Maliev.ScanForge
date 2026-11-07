import { expect, it } from "vitest";
import { splitGeneralCutter } from "../src/scan-edit-general-split";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { collectFiniteCutterHits } from "../src/scan-edit-general-split";
import { buildSparseFiniteEdgeContactsIndexed } from "../src/scan-split-finite-edges";
import { exactSegmentTriangleCrossing } from "../src/scan-split-exact-crossing";
import type { Vec3 } from "../src/types";

it("records exact versus parameter-reconstructed contacts on original ply-3 face 740560", () => {
  const v = new Float32Array([
    19.383258819580078, -2.58443284034729, -294.58905029296875,
    19.313072204589844, -2.56186842918396, -294.6346130371094,
    19.350889205932617, -2.6314306259155273, -294.58935546875,
  ]);
  const cut = new Float32Array([
    19.332477569580078, -148.97125244140625, -441.24853515625,
    19.332477569580078, -148.97125244140625, 70.76020050048828,
    19.332477569580078, 405.84637451171875, -441.24853515625,
  ]);
  const ids = new Uint32Array([0, 1, 2]);
  const collected = collectFiniteCutterHits(v, ids, cut, {
    preciseCoordinates: true,
  });
  const registry = buildSparseFiniteEdgeContactsIndexed(
    v,
    ids,
    collected.contacts.map(({ exactCutter: _ignored, ...contact }) => contact),
    { preciseCoordinates: true },
  );
  const cutterTriangle = [0, 1, 2].map(
    (i) => Array.from(cut.slice(i * 3, i * 3 + 3)) as Vec3,
  ) as [Vec3, Vec3, Vec3];
  const points = [0, 1, 2].map(
    (i) => Array.from(v.slice(i * 3, i * 3 + 3)) as Vec3,
  );
  const comparisons = registry.get(0)!.flatMap((record) =>
    record.contacts.map((contact) => {
      const exact = exactSegmentTriangleCrossing(
        points[record.edge[0]],
        points[record.edge[1]],
        cutterTriangle,
        { exactPoint: true },
      );
      return { registered: contact.point, exact: exact?.roundedPoint };
    }),
  );
  expect(comparisons.length).toBeGreaterThan(0);
  expect(
    comparisons.some(
      ({ registered, exact }) =>
        exact && registered.some((n, i) => n !== exact[i]),
    ),
  ).toBe(true);
  const exactRegistry = buildSparseFiniteEdgeContactsIndexed(
    v,
    ids,
    collected.contacts.map((contact) => ({
      ...contact,
      exactCutter: cutterTriangle,
    })),
    { preciseCoordinates: true },
  );
  for (const record of exactRegistry.get(0)!) {
    const exact = exactSegmentTriangleCrossing(
      points[record.edge[0]],
      points[record.edge[1]],
      cutterTriangle,
      { exactPoint: true },
    );
    expect(record.contacts[0].point).toEqual(exact!.roundedPoint);
  }
  const refined = refineFiniteCutterMesh(v, ids, cut, {
    preciseCoordinates: true,
  });
  expect(refined.triangles.length / 3).toBeGreaterThan(1);
  expect(new Set(refined.groups).size).toBe(2);
});

// ply-1 face 7207, exact Float32 source and cutter coordinates from the retained local receipt.
const source = new Float32Array([
  19.898012161254883, 47.31754684448242, -315.9837341308594, 20.04651641845703,
  47.50707244873047, -315.9645080566406, 20.04990005493164, 47.18638610839844,
  -315.8510437011719,
]);
const cutter = new Float32Array([
  19.9250431060791, -149.8528594970703, -442.96917724609375, 19.9250431060791,
  -149.8528594970703, 72.22071838378906, 19.9250431060791, 406.9168701171875,
  -442.96917724609375,
]);

it("production Split retains the first original-scan crossing at Float32 precision", () => {
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    {},
  );
  expect(result.segments!.filter((part) => part.length)).toHaveLength(2);
  const cross = (p: ArrayLike<number>, i: number) => {
    const u = [0, 1, 2].map((k) => p[i + 3 + k] - p[i + k]);
    const v = [0, 1, 2].map((k) => p[i + 6 + k] - p[i + k]);
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  };
  const normal = cross(source, 0);
  const squared = normal.reduce((sum, value) => sum + value * value, 0);
  let covered = 0;
  for (const part of result.segments!)
    for (let i = 0; i < part.length; i += 9) {
      const n = cross(part, i);
      const projected = n.reduce(
        (sum, value, axis) => sum + value * normal[axis],
        0,
      );
      expect(projected).toBeGreaterThan(0);
      covered += projected;
    }
  expect(Math.abs(covered / squared - 1)).toBeLessThan(0.001);
});

it("the experimental finite refinement retains both sides of the same original facet", () => {
  const before = new Uint8Array(source.buffer).slice();
  const result = refineFiniteCutterMesh(
    source,
    new Uint32Array([0, 1, 2]),
    cutter,
  );
  expect(result.triangles.length / 3).toBeGreaterThan(1);
  expect(new Set(result.groups).size).toBe(2);
  expect(result.cutIncidence).toHaveLength(1);
  expect(result.cutIncidence[0].kind).toBe("separating");
  expect(new Uint8Array(source.buffer)).toEqual(before);
});
