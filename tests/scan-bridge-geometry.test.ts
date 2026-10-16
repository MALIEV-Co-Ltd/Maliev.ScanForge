import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";

function rim(curved: boolean, asymmetric = false) {
  const positions: number[] = [];
  const point = (i: number, radius: number) => {
    const angle = (i * Math.PI) / 16;
    const x = radius * Math.cos(angle),
      y = radius * Math.sin(angle);
    return [
      x,
      y,
      curved
        ? 0.025 * (x * x + y * y) + (asymmetric ? 0.002 * x * x * x : 0)
        : 0,
    ];
  };
  for (let i = 0; i < 32; i++) {
    const a = point(i, 4),
      b = point(i, 5),
      c = point(i + 1, 5),
      d = point(i + 1, 4);
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const topology = analyzeMesh(positions);
  const hole = topology.boundaryLoops.findIndex(
    (loop) =>
      Math.hypot(
        topology.vertices[loop[0] * 3],
        topology.vertices[loop[0] * 3 + 1],
      ) < 4.5,
  );
  return { positions, topology, hole };
}

it("automatically shapes a bridge from adjacent curved facets while preserving the attachment edges", () => {
  const { positions, topology, hole } = rim(true);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [hole],
    mode: "bridge",
    start: 0,
    end: 16,
    algorithm: "automatic",
  });
  expect(result.diagnostics.method).toBe("tangent");
  expect(result.diagnostics.filledHoles).toBe(1);
  expect(result.diagnostics.addedTriangles).toBeGreaterThan(2);
  expect(result.positions!.slice(0, positions.length)).toEqual(
    new Float32Array(positions),
  );
  const patch = result.positions!.slice(positions.length);
  const interiorHeights: number[] = [];
  for (let i = 0; i < patch.length; i += 3)
    if (Math.hypot(patch[i], patch[i + 1]) < 1)
      interiorHeights.push(patch[i + 2]);
  expect(interiorHeights.length).toBeGreaterThan(0);
  expect(Math.max(...interiorHeights)).toBeLessThan(0.15);
  const after = analyzeMesh(result.positions!);
  expect(
    after.nonManifoldEdges +
      after.inconsistentEdges +
      after.degenerateTriangles +
      after.duplicateTriangles,
  ).toBe(0);
  expect(after.boundaryLoops).toHaveLength(3); // outer loop plus two remaining openings
  const loop = topology.boundaryLoops[hole];
  for (const edge of [0, 16]) {
    const a = loop[edge],
      b = loop[(edge + 1) % loop.length];
    expect(after.edges.get(a < b ? `${a}:${b}` : `${b}:${a}`)).toHaveLength(2);
  }
});

it("uses a second-order curvature fit instead of silently reusing tangent interpolation", () => {
  const { positions, hole } = rim(true, true);
  const bridge = (algorithm: "tangent" | "curvature") =>
    runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [hole],
      mode: "bridge",
      start: 0,
      end: 16,
      algorithm,
    });
  const tangent = bridge("tangent"),
    curvature = bridge("curvature");
  expect(curvature.diagnostics.method).toBe("curvature");
  expect(curvature.positions).not.toEqual(tangent.positions);
  const after = analyzeMesh(curvature.positions!);
  expect(
    after.nonManifoldEdges +
      after.inconsistentEdges +
      after.degenerateTriangles,
  ).toBe(0);
  expect(after.boundaryLoops).toHaveLength(3);
  const patch = curvature.positions!.slice(positions.length);
  const heights: number[] = [];
  for (let i = 0; i < patch.length; i += 3)
    if (Math.hypot(patch[i], patch[i + 1]) < 1) heights.push(patch[i + 2]);
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.max(...heights)).toBeLessThan(0.2);
});

it("automatically keeps coplanar adjacent facets flat and honors the manual flat override", () => {
  for (const [curved, algorithm] of [
    [false, "automatic"],
    [true, "flat"],
  ] as const) {
    const { positions, hole } = rim(curved);
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [hole],
      mode: "bridge",
      start: 0,
      end: 16,
      algorithm,
    });
    expect(result.diagnostics.method).toBe("flat");
    expect(result.diagnostics.addedTriangles).toBe(2);
    const after = analyzeMesh(result.positions!);
    expect(after.nonManifoldEdges + after.inconsistentEdges).toBe(0);
  }
});

it("rejects adjacent bridge edges and respects cancellation before producing geometry", () => {
  const { positions, hole } = rim(false);
  const request = {
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [hole],
    mode: "bridge",
    start: 0,
    end: 1,
  } as const;
  expect(() => runScanEdit({ ...request, indices: [hole] })).toThrow(
    /separate/,
  );
  expect(() =>
    runScanEdit(
      { ...request, indices: [hole], end: 16 },
      { signal: AbortSignal.abort() },
    ),
  ).toThrow(/cancel/i);
});

it("rejects strips that cross a concave boundary instead of covering retained mesh", async () => {
  const { bridgeInsideBoundary } = await import("../src/scan-bridge-geometry");
  const { Vector2 } = await import("three");
  const boundary = [
    [0, 0],
    [4, 0],
    [4, 4],
    [3, 4],
    [3, 1],
    [1, 1],
    [1, 4],
    [0, 4],
  ].map(([x, y]) => new Vector2(x, y));
  expect(bridgeInsideBoundary(boundary, [1, 2, 7, 0])).toBe(false);
  expect(
    bridgeInsideBoundary(
      [
        new Vector2(0, 0),
        new Vector2(4, 0),
        new Vector2(4, 4),
        new Vector2(0, 4),
      ],
      [0, 1, 2, 3],
    ),
  ).toBe(true);
});

it("keeps every retained edge welded when a tangent bridge spans a four-edge opening", () => {
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const positions = faces.flatMap((face) => face.flatMap((id) => vertices[id]));
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    mode: "bridge",
    start: 0,
    end: 2,
    algorithm: "tangent",
  });
  const after = analyzeMesh(result.positions!);
  expect(after.boundaryEdges).toBe(0);
  expect(
    after.nonManifoldEdges +
      after.inconsistentEdges +
      after.degenerateTriangles,
  ).toBe(0);
});
