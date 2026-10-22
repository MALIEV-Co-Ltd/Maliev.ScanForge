import { describe, expect, it } from "vitest";
import {
  assemblePatchShell,
  createGridPatch,
  tessellatePatch,
  validatePatch,
} from "../src/surfaces";
import { separatedPatch } from "./fixtures/discontinuous-patch";

function assertSeparated(mesh: Float32Array, splitU: boolean, splitV: boolean) {
  expect(mesh.length).toBeGreaterThan(0);
  expect(mesh.length % 9).toBe(0);
  const frontiers = [new Set<number>(), new Set<number>()];
  let area = 0;
  for (let at = 0; at < mesh.length; at += 9) {
    for (const axis of [0, 1]) {
      const values = [
        mesh[at + axis],
        mesh[at + 3 + axis],
        mesh[at + 6 + axis],
      ];
      values.forEach((value) => {
        expect(Number.isFinite(value)).toBe(true);
        frontiers[axis].add(value);
      });
      if (axis === 0 ? splitU : splitV) {
        // Every triangle must belong to one analytic strip, never bridge the empty gap.
        expect(
          values.every((value) => value >= 0 && value <= 1) ||
            values.every((value) => value >= 10 && value <= 11),
        ).toBe(true);
      }
    }
    const ax = mesh[at + 3] - mesh[at],
      ay = mesh[at + 4] - mesh[at + 1];
    const bx = mesh[at + 6] - mesh[at],
      by = mesh[at + 7] - mesh[at + 1];
    const signedArea = (ax * by - ay * bx) / 2;
    expect(signedArea).toBeGreaterThan(0);
    area += signedArea;
  }
  for (const axis of [0, 1])
    if (axis === 0 ? splitU : splitV) {
      // The left-hand limit must not disappear when exact-knot evaluation chooses right.
      for (const value of [0, 1, 10, 11])
        expect(frontiers[axis].has(value)).toBe(true);
    }
  expect(area).toBeCloseTo((splitU ? 2 : 1) * (splitV ? 2 : 1), 5);
}

describe("discontinuous rational patch tessellation", () => {
  for (const [name, splitU, splitV] of [
    ["U", true, false],
    ["V", false, true],
    ["U and V", true, true],
  ] as const) {
    for (const segments of [1, 2, 3, 32])
      it(`preserves both sides of ${name} breaks at ${segments} segments without connecting them`, () => {
        const patch = separatedPatch(splitU, splitV);
        const before = JSON.stringify(patch);
        expect(() => validatePatch(patch)).not.toThrow();
        // Rejection is not an acceptable GREEN: a valid patch must produce geometry.
        const mesh = tessellatePatch(patch, segments, segments);
        assertSeparated(mesh, splitU, splitV);
        expect(JSON.stringify(patch)).toBe(before);
      });
  }
  it("uses exact one-sided quadratic limits at a nonuniform break in a nonunit domain", () => {
    const patch = separatedPatch(true, true, 2, 0.25);
    patch.knotsU = patch.knotsU.map((knot) => 2 + 8 * knot);
    patch.knotsV = patch.knotsV.map((knot) => -4 + 2 * knot);
    assertSeparated(tessellatePatch(patch, 3, 3), true, true);
  });
  it("retains authored nonunit rational weights without crossing disconnected strips", () => {
    const patch = separatedPatch();
    patch.weights = [1, 2, 3, 4, 1, 2, 3, 4];
    const before = JSON.stringify(patch);
    assertSeparated(tessellatePatch(patch, 3, 3), true, false);
    expect(JSON.stringify(patch)).toBe(before);
  });
  it("keeps ordinary single-span sampling and triangle order byte-for-byte", () => {
    const mesh = tessellatePatch(createGridPatch(2, 2, 2, 1, 1), 2, 1);
    expect(mesh).toEqual(
      new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0,
        1, 1, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0,
      ]),
    );
  });
  it("does not split or reject a valid C0 interior crease of multiplicity degree", () => {
    const patch = createGridPatch(3, 2, 2, 1, 1);
    patch.points[1][2] = 1;
    patch.points[4][2] = 1;
    const mesh = tessellatePatch(patch, 2, 1);
    expect(mesh).toEqual(
      new Float32Array([
        0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 2, 0, 0,
        1, 1, 1, 2, 0, 0, 2, 1, 0, 1, 1, 1,
      ]),
    );
  });
});
it("samples exact rational weighted interior coordinates on both disconnected strips", () => {
  const patch = separatedPatch();
  patch.weights = [1, 2, 3, 4, 1, 2, 3, 4];
  const mesh = tessellatePatch(patch, 3, 1);
  assertSeparated(mesh, true, false);
  // Global U=1/3 means local t=2/3 on the left: 2t/(1+t)=4/5.
  // Global U=2/3 means local t=1/3 on the right: (30+14t)/(3+t)=52/5.
  // These are closed-form rational degree-one coordinates, not evaluator echoes.
  const expectedX = [0, 4 / 5, 1, 10, 52 / 5, 11].map(Math.fround);
  const actualX = new Set<number>();
  for (let at = 0; at < mesh.length; at += 3) {
    expect(Number.isFinite(mesh[at + 2])).toBe(true);
    expect(mesh[at + 2]).toBe(0);
    actualX.add(mesh[at]);
  }
  expect([...actualX].sort((a, b) => a - b)).toEqual(expectedX);
});

it("emits all three affine strips separated by two full-multiplicity U breaks", () => {
  const patch: import("../src/surfaces").NurbsPatch = {
    format: "scanforge-nurbs",
    version: 1,
    countU: 6,
    countV: 2,
    degreeU: 1,
    degreeV: 1,
    knotsU: [0, 0, 0.25, 0.25, 0.75, 0.75, 1, 1],
    knotsV: [0, 0, 1, 1],
    points: [0, 1].flatMap((y) =>
      [0, 1, 10, 11, 20, 21].map((x): [number, number, number] => [x, y, 0]),
    ),
    weights: Array(12).fill(1),
  };
  expect(() => validatePatch(patch)).not.toThrow();
  const before = JSON.stringify(patch);
  const mesh = tessellatePatch(patch, 1, 1);
  // With one requested cell, each of the three affine regions still owns two triangles.
  expect(mesh.length).toBe(3 * 2 * 9);
  const area = [0, 0, 0],
    triangles = [0, 0, 0];
  const frontiers = new Set<number>();
  for (let at = 0; at < mesh.length; at += 9) {
    const x = [mesh[at], mesh[at + 3], mesh[at + 6]];
    const strip = [0, 10, 20].findIndex((start) =>
      x.every((value) => value >= start && value <= start + 1),
    );
    expect(strip).toBeGreaterThanOrEqual(0);
    const signedArea =
      ((mesh[at + 3] - mesh[at]) * (mesh[at + 7] - mesh[at + 1]) -
        (mesh[at + 4] - mesh[at + 1]) * (mesh[at + 6] - mesh[at])) /
      2;
    expect(signedArea).toBeGreaterThan(0);
    area[strip] += signedArea;
    triangles[strip]++;
    for (let corner = 0; corner < 3; corner++) {
      frontiers.add(mesh[at + corner * 3]);
      expect([0, 1]).toContain(mesh[at + corner * 3 + 1]);
      expect(mesh[at + corner * 3 + 2]).toBe(0);
    }
  }
  expect(area).toEqual([1, 1, 1]);
  expect(triangles).toEqual([2, 2, 2]);
  expect([...frontiers].sort((a, b) => a - b)).toEqual([0, 1, 10, 11, 20, 21]);
  expect(JSON.stringify(patch)).toBe(before);
});

it("retains finite nonplanar bilinear Z samples on both sides of a full break", () => {
  const patch = separatedPatch();
  patch.points = patch.points.map(([x, y]): [number, number, number] => [
    x,
    y,
    x * y,
  ]);
  const before = JSON.stringify(patch);
  const mesh = tessellatePatch(patch, 3, 2);
  assertSeparated(mesh, true, false);
  // Unit weights and corner heights x*y give the analytic bilinear saddle z=x*y.
  // The prescribed global grids plus exact one-sided boundaries yield these samples.
  const xs = [0, 2 / 3, 1, 10, 31 / 3, 11],
    ys = [0, 1 / 2, 1];
  const expected = new Set(
    xs.flatMap((x) =>
      ys.map((y) =>
        [Math.fround(x), Math.fround(y), Math.fround(x * y)].join(","),
      ),
    ),
  );
  const actual = new Set<string>();
  for (let at = 0; at < mesh.length; at += 3) {
    const xyz = [mesh[at], mesh[at + 1], mesh[at + 2]];
    expect(xyz.every(Number.isFinite)).toBe(true);
    const key = xyz.join(",");
    expect(expected.has(key)).toBe(true);
    actual.add(key);
  }
  expect([...actual].sort()).toEqual([...expected].sort());
  expect(actual.has([1, 1, 1].join(","))).toBe(true);
  expect(actual.has([11, 1, 11].join(","))).toBe(true);
  expect(JSON.stringify(patch)).toBe(before);
});

describe("discontinuous shell triangle budget", () => {
  const options = { segments: 1, triangleBudget: 2, weldTolerance: 1e-6 };
  it("rejects four strip triangles before accepting a two-triangle budget", () => {
    expect(() => assemblePatchShell([separatedPatch()], options)).toThrow(
      "Shell tessellation exceeds the configured triangle budget.",
    );
  });
  it("accepts the exact four-triangle off-grid budget", () => {
    const result = assemblePatchShell([separatedPatch()], {
      ...options,
      triangleBudget: 4,
    });
    expect(result.positions.length / 9).toBe(4);
    expect(result.diagnostics.triangles).toBe(4);
  });
  it("does not overcount a break already on the uniform grid", () => {
    const result = assemblePatchShell([separatedPatch()], {
      ...options,
      segments: 2,
      triangleBudget: 8,
    });
    expect(result.positions.length / 9).toBe(8);
    expect(result.diagnostics.triangles).toBe(8);
  });
});
