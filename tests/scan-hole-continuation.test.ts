import { expect, it, vi } from "vitest";
import * as blending from "../src/scan-hole-fair";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";
import { HoleRefinementError } from "../src/scan-hole-refine";

// A broad, smooth moulded rib is not a quadratic surface. The missing rectangle
// cuts across it, so a rim-only height average flattens its cross section.
const height = (x: number) => 0.8 * Math.exp(-((x / 1.2) ** 2));

function panel(surface = (x: number, _y: number) => height(x)) {
  const p: number[] = [];
  for (let ix = -20; ix < 20; ix++)
    for (let iy = -16; iy < 16; iy++) {
      if (ix >= -12 && ix < 12 && iy >= -4 && iy < 4) continue;
      const point = (x: number, y: number) => [
        x / 4,
        y / 4,
        surface(x / 4, y / 4),
      ];
      const a = point(ix, iy),
        b = point(ix + 1, iy),
        c = point(ix + 1, iy + 1),
        d = point(ix, iy + 1);
      p.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return new Float32Array(p);
}
it.each([0, Math.PI / 2, Math.PI / 5])(
  "continues a smooth rib across a long opening (angle=%s)",
  (angle) => {
    const section = (x: number, y: number) =>
      height(x * Math.cos(angle) + y * Math.sin(angle));
    const positions = panel(section),
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
      squared += (patch[i + 2] - section(patch[i], patch[i + 1])) ** 2;
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
  },
);

it("matches retained rim slopes on a varying-curvature panel", () => {
  const positions = panel(
    (x, y) => 0.6 * Math.sin(0.9 * x) + 0.1 * Math.sin(3 * x) * Math.cos(2 * y),
  );
  const before = analyzeMesh(positions);
  const hole = before.boundaryLoops.findIndex((ids) =>
    ids.every(
      (id) =>
        Math.abs(before.vertices[id * 3]) <= 3.001 &&
        Math.abs(before.vertices[id * 3 + 1]) <= 1.001,
    ),
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [hole],
    algorithm: "automatic",
  });
  expect(result.diagnostics.filledHoles).toBe(1);
  const after = analyzeMesh(result.positions!);
  const normal = (face: number) => {
    const [a, b, c] = [0, 1, 2].map((k) =>
      Array.from(
        after.vertices.subarray(
          after.triangles[face * 3 + k] * 3,
          after.triangles[face * 3 + k] * 3 + 3,
        ),
      ),
    );
    const u = b.map((v, k) => v - a[k]),
      v = c.map((v, k) => v - a[k]);
    const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      l = Math.hypot(...n);
    return n.map((v) => v / l);
  };
  const angles: number[] = [];
  for (const pair of after.edges.values()) {
    if (
      pair.length !== 2 ||
      pair[0].face < positions.length / 9 ===
        pair[1].face < positions.length / 9
    )
      continue;
    const a = normal(pair[0].face),
      b = normal(pair[1].face);
    angles.push(
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            a.reduce((s, v, k) => s + v * b[k], 0),
          ),
        ),
      ) *
        180) /
        Math.PI,
    );
  }
  angles.sort((a, b) => a - b);
  expect(angles).toHaveLength(before.boundaryLoops[hole].length);
  expect(angles[Math.floor(angles.length * 0.95)]).toBeLessThan(8);
  expect(result.positions!.subarray(0, positions.length)).toEqual(positions);
});

it("cancels whole-patch fairing without changing the input scan", () => {
  const positions = panel(),
    original = positions.slice();
  const topology = analyzeMesh(positions);
  const hole = topology.boundaryLoops.findIndex((ids) =>
    ids.every(
      (id) =>
        Math.abs(topology.vertices[id * 3]) <= 3.001 &&
        Math.abs(topology.vertices[id * 3 + 1]) <= 1.001,
    ),
  );
  const controller = new AbortController();
  let reachedFairing = false;
  expect(() =>
    runScanEdit(
      {
        kind: "scanEdit",
        action: "fillHoles",
        positions,
        indices: [hole],
        algorithm: "automatic",
      },
      {
        signal: controller.signal,
        onProgress: (_fraction, stage) => {
          if (stage === "Fairing hole surface") {
            reachedFairing = true;
            controller.abort();
          }
        },
      },
    ),
  ).toThrow(/cancelled/);
  expect(reachedFairing).toBe(true);
  expect(positions).toEqual(original);
});

it("recovers from a blending numeric failure and closes a valid hole", () => {
  const positions = panel(),
    before = analyzeMesh(positions);
  const hole = before.boundaryLoops.findIndex((ids) =>
    ids.every(
      (id) =>
        Math.abs(before.vertices[id * 3]) <= 3.001 &&
        Math.abs(before.vertices[id * 3 + 1]) <= 1.001,
    ),
  );
  const realBlend = blending.fairHolePatch;
  const unavailable = vi
    .spyOn(blending, "fairHolePatch")
    .mockImplementation((...args) => {
      args[10] = {
        ...args[10],
        onProgress: (_fraction, stage) => {
          if (stage === "Fairing hole surface")
            throw new HoleRefinementError("Injected numeric solve failure");
        },
      };
      return realBlend(...args);
    });
  try {
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [hole],
      algorithm: "automatic",
    });
    expect(unavailable).toHaveBeenCalledOnce();
    expect(result.diagnostics.filledHoles).toBe(1);
    expect(result.diagnostics.surfaceBlendFallbackHoles).toBe(1);
    expect(result.positions!.subarray(0, positions.length)).toEqual(positions);
    const after = analyzeMesh(result.positions!);
    expect(after.boundaryLoops).toHaveLength(1);
    expect(
      after.nonManifoldEdges +
        after.inconsistentEdges +
        after.degenerateTriangles +
        after.duplicateTriangles,
    ).toBe(0);
  } finally {
    unavailable.mockRestore();
  }
});
