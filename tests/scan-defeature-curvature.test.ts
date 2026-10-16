import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { analyzeMesh } from "../src/mesh-processing";
import { repatchCurvatureSurface } from "../src/scan-defeature-surface";

/** A badge over a known doubly curved panel, with a clean retained collar. */
export function panelFixture(rotated = false, flat = false, step = 1) {
  const height = (x: number, y: number) =>
    flat ? 0 : 0.035 * x * x + 0.018 * y * y + 0.012 * x * y;
  const transform = (x: number, y: number, z: number) =>
    rotated ? [30 + z, -12 + x, 45 + y] : [x, y, z];
  const positions: number[] = [],
    selection: number[] = [];
  const point = (x: number, y: number) =>
    transform(
      x,
      y,
      height(x, y) +
        (Math.abs(x) < 3 && Math.abs(y) < 3 ? 2 + 0.4 * Math.cos(x * y) : 0),
    );
  for (let iy = -8 / step; iy < 8 / step; iy++)
    for (let ix = -8 / step; ix < 8 / step; ix++) {
      const x = ix * step,
        y = iy * step;
      positions.push(
        ...point(x, y),
        ...point(x + step, y),
        ...point(x + step, y + step),
        ...point(x, y),
        ...point(x + step, y + step),
        ...point(x, y + step),
      );
      const selected = x >= -3 && x < 3 && y >= -3 && y < 3;
      selection.push(+selected, +selected);
    }
  return {
    positions: new Float32Array(positions),
    selection: new Uint8Array(selection),
    height,
    rotated,
  };
}

it("fits a dense scan using a bounded collar rather than falling back at the support budget", () => {
  const fixture = panelFixture(false, false, 0.125);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "defeature",
    positions: fixture.positions,
    selection: fixture.selection,
  });
  expect(result.diagnostics.curvaturePatches).toBe(1);
  expect(result.diagnostics.insertedVertices).toBeLessThanOrEqual(4096);
  expect(analyzeMesh(result.positions!).nonManifoldEdges).toBe(0);
});

for (const [name, rotated, flat] of [
  ["curved", false, false],
  ["rotated", true, false],
  ["planar", false, true],
] as const) {
  it(`reconstructs a ${name} panel without badge residue or curvature loss`, () => {
    const fixture = panelFixture(rotated, flat);
    const result = runScanEdit({
      kind: "scanEdit",
      action: "defeature",
      positions: fixture.positions,
      selection: fixture.selection,
    });
    expect(result.diagnostics.curvaturePatches).toBe(1);
    const retained = fixture.positions.filter(
      (_, i) => !fixture.selection[Math.floor(i / 9)],
    );
    expect(Array.from(result.positions!.slice(0, retained.length))).toEqual(
      Array.from(retained),
    );
    const added = result.positions!.subarray(retained.length);
    let worst = 0,
      longest = 0;
    for (let i = 0; i < added.length; i += 3) {
      const [a, b, c] = added.subarray(i, i + 3);
      const [x, y, z] = rotated ? [b + 12, c - 45, a - 30] : [a, b, c];
      worst = Math.max(worst, Math.abs(z - fixture.height(x, y)));
    }
    for (let i = 0; i < added.length; i += 9)
      for (let k = 0; k < 3; k++) {
        const a = i + 3 * k,
          b = i + 3 * ((k + 1) % 3);
        longest = Math.max(
          longest,
          Math.hypot(
            added[a] - added[b],
            added[a + 1] - added[b + 1],
            added[a + 2] - added[b + 2],
          ),
        );
      }
    expect(worst).toBeLessThan(0.003);
    expect(longest).toBeLessThan(2);
    const topology = analyzeMesh(result.positions!);
    expect(topology.boundaryLoops).toHaveLength(1);
    expect(topology.nonManifoldEdges).toBe(0);
    expect(topology.inconsistentEdges).toBe(0);
    expect(topology.degenerateTriangles).toBe(0);
    // Compare actual facet slopes on both sides of every reconstructed seam.
    const retainedFaces = retained.length / 9;
    const normal = (f: number) => {
      const p = Array.from({ length: 3 }, (_, k) =>
        Array.from(result.positions!.slice(f * 9 + k * 3, f * 9 + k * 3 + 3)),
      );
      const a = p[1].map((v, k) => v - p[0][k]),
        b = p[2].map((v, k) => v - p[0][k]);
      const n = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ],
        l = Math.hypot(...n);
      return n.map((v) => v / l);
    };
    for (const uses of topology.edges.values())
      if (
        uses.length === 2 &&
        uses[0].face < retainedFaces !== uses[1].face < retainedFaces
      ) {
        const a = normal(uses[0].face),
          b = normal(uses[1].face);
        expect(
          Math.acos(
            Math.min(
              1,
              a.reduce((s, v, k) => s + v * b[k], 0),
            ),
          ),
        ).toBeLessThan(0.12);
      }
  });
}

it("rejects an unreliable curved collar and reports the shared spatial fallback", () => {
  const fixture = panelFixture();
  for (let i = 2; i < fixture.positions.length; i += 3)
    fixture.positions[i] +=
      0.7 *
      Math.sin(fixture.positions[i - 2] * 3 + fixture.positions[i - 1] * 2);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "defeature",
    positions: fixture.positions,
    selection: fixture.selection,
  });
  expect(result.diagnostics.curvaturePatches).toBe(0);
  expect(result.diagnostics.curvatureFallback).toMatch(
    /sharp edge|not a smooth/,
  );
  expect(analyzeMesh(result.positions!).nonManifoldEdges).toBe(0);
});

it("honors cancellation and rejects oversized rims without allocating patch geometry", () => {
  const fixture = panelFixture(),
    topology = analyzeMesh(fixture.positions);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    repatchCurvatureSurface(topology, [], { signal: controller.signal }),
  ).toThrow("cancelled");
  expect(repatchCurvatureSurface(topology, new Array(2049).fill(0))).toEqual({
    reason: "unsupported rim size",
  });
  expect(repatchCurvatureSurface(topology, [0, 1, 2])).toEqual({
    reason: "unsupported rim size",
  });
});
