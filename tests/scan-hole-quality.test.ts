import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";

function annulus(curved = false, noisy = false, concave = false) {
  const count = 48,
    output: number[] = [];
  const point = (i: number, radius: number) => {
    const theta = ((i % count) * 2 * Math.PI) / count;
    if (concave && radius === 4) radius += 0.6 * Math.cos(5 * theta);
    const x = radius * Math.cos(theta),
      y = radius * Math.sin(theta);
    return [
      x,
      y,
      curved
        ? 0.025 * (x * x + y * y) + (noisy ? 0.005 * Math.sin(7 * theta) : 0)
        : 0,
    ];
  };
  for (let i = 0; i < count; i++) {
    const a = point(i, 4),
      b = point(i, 5),
      c = point(i + 1, 5),
      d = point(i + 1, 4);
    output.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return new Float32Array(output);
}

it.each(["automatic", "flat", "tangent", "curvature"] as const)(
  "fills a dense planar rim with a welded %s patch",
  (algorithm) => {
    const positions = annulus(),
      before = analyzeMesh(positions);
    const hole = before.boundaryLoops.findIndex(
      (loop) =>
        Math.hypot(
          before.vertices[loop[0] * 3],
          before.vertices[loop[0] * 3 + 1],
        ) < 4.5,
    );
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [hole],
      algorithm,
    });
    const after = analyzeMesh(result.positions!);
    expect(result.diagnostics.filledHoles).toBe(1);
    if (algorithm === "flat") {
      expect(result.diagnostics.addedTriangles).toBe(46);
      expect(after.vertices.length).toBe(before.vertices.length);
    } else expect(result.diagnostics.addedTriangles).toBeGreaterThan(250);
    expect(after.boundaryLoops).toHaveLength(1);
    expect(after.nonManifoldEdges).toBe(0);
    expect(after.inconsistentEdges).toBe(0);
    expect(after.degenerateTriangles).toBe(0);
    expect(after.duplicateTriangles).toBe(0);
    expect(result.positions!.slice(0, positions.length)).toEqual(positions);
    // Every former boundary edge now has two oppositely oriented facets.
    for (let i = 0; i < before.boundaryLoops[hole].length; i++) {
      const loop = before.boundaryLoops[hole],
        a = loop[i],
        b = loop[(i + 1) % loop.length];
      const pa = before.vertices.slice(a * 3, a * 3 + 3),
        pb = before.vertices.slice(b * 3, b * 3 + 3);
      const lookup = (p: Float64Array) => {
        for (let j = 0; j < after.vertices.length; j += 3)
          if (p.every((v, k) => Math.abs(v - after.vertices[j + k]) < 1e-6))
            return j / 3;
        return -1;
      };
      const ia = lookup(pa),
        ib = lookup(pb);
      expect(
        after.edges.get(ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`),
      ).toHaveLength(2);
    }
    let maximum = 0;
    const patch = result.positions!.slice(positions.length);
    for (let i = 0; i < patch.length; i += 9)
      for (let k = 0; k < 3; k++) {
        const a = i + k * 3,
          b = i + ((k + 1) % 3) * 3;
        maximum = Math.max(
          maximum,
          Math.hypot(
            patch[a] - patch[b],
            patch[a + 1] - patch[b + 1],
            patch[a + 2] - patch[b + 2],
          ),
        );
      }
    // Native Flat clips the rim without density subdivision; long cap
    // diagonals are expected. Other algorithms retain their density contract.
    expect(maximum).toBeLessThan(algorithm === "flat" ? 8.000001 : 1.4);
  },
);

it.each([false, true])(
  "blends a curved rim without flattening the cap (noisy: %s)",
  (noisy) => {
    const positions = annulus(true, noisy),
      before = analyzeMesh(positions);
    const hole = before.boundaryLoops.findIndex(
      (loop) =>
        Math.hypot(
          before.vertices[loop[0] * 3],
          before.vertices[loop[0] * 3 + 1],
        ) < 4.5,
    );
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [hole],
      algorithm: "curvature",
    });
    expect(result.diagnostics.filledHoles).toBe(1);
    const patch = result.positions!.slice(positions.length);
    let center = false,
      error = 0;
    for (let i = 0; i < patch.length; i += 3) {
      const radius = Math.hypot(patch[i], patch[i + 1]);
      if (radius < 1) center = true;
      error = Math.max(error, Math.abs(patch[i + 2] - 0.025 * radius * radius));
    }
    expect(center).toBe(true);
    expect(error).toBeLessThan(0.07);
    const after = analyzeMesh(result.positions!);
    expect(after.boundaryLoops).toHaveLength(1);
    expect(
      after.inconsistentEdges +
        after.nonManifoldEdges +
        after.degenerateTriangles,
    ).toBe(0);
    const normal = (face: number) => {
      const ids = Array.from(after.triangles.slice(face * 3, face * 3 + 3));
      const [a, b, c] = ids.map((id) =>
        Array.from(after.vertices.slice(id * 3, id * 3 + 3)),
      );
      const u = b.map((x, i) => x - a[i]),
        v = c.map((x, i) => x - a[i]);
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const length = Math.hypot(...n);
      return n.map((x) => x / length);
    };
    let largestSeamAngle = 0;
    for (const pair of after.edges.values()) {
      if (
        pair.length !== 2 ||
        pair[0].face < positions.length / 9 ===
          pair[1].face < positions.length / 9
      )
        continue;
      const a = normal(pair[0].face),
        b = normal(pair[1].face);
      largestSeamAngle = Math.max(
        largestSeamAngle,
        (Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              a.reduce((s, x, i) => s + x * b[i], 0),
            ),
          ),
        ) *
          180) /
          Math.PI,
      );
    }
    expect(largestSeamAngle).toBeLessThan(15);
  },
);

it("refines a concave hole without changing its perimeter or adding overlapping facets", () => {
  const positions = annulus(false, false, true),
    before = analyzeMesh(positions);
  const hole = before.boundaryLoops.findIndex(
    (loop) =>
      Math.hypot(
        before.vertices[loop[0] * 3],
        before.vertices[loop[0] * 3 + 1],
      ) < 4.8,
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [hole],
  });
  const after = analyzeMesh(result.positions!);
  expect(result.diagnostics.filledHoles).toBe(1);
  expect(after.boundaryLoops).toHaveLength(1);
  expect(
    after.nonManifoldEdges +
      after.inconsistentEdges +
      after.degenerateTriangles +
      after.duplicateTriangles,
  ).toBe(0);
});

it("cancels refinement without mutating the source", () => {
  const positions = annulus(),
    original = positions.slice(),
    controller = new AbortController();
  expect(() =>
    runScanEdit(
      { kind: "scanEdit", action: "fillHoles", positions, indices: [1] },
      {
        signal: controller.signal,
        onProgress: (_, stage) => {
          if (stage === "Refining hole mesh density") controller.abort();
        },
      },
    ),
  ).toThrow("cancelled");
  expect(positions).toEqual(original);
});

it("surface recovery follows curved tangents even when the rim itself is planar", () => {
  const positions = annulus(true),
    topology = analyzeMesh(positions);
  const hole = topology.boundaryLoops.findIndex(
    (loop) =>
      Math.hypot(
        topology.vertices[loop[0] * 3],
        topology.vertices[loop[0] * 3 + 1],
      ) < 4.5,
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    algorithm: "surfaceRecovery",
    positions,
    indices: [hole],
  });
  expect(result.diagnostics.method).toBe("tangent");
  expect(result.diagnostics.filledHoles).toBe(1);
  expect(result.diagnostics.surfaceFitHoles).toBe(1);
  expect(result.diagnostics.boundedFallbackHoles).toBe(0);
  expect(result.diagnostics.surfaceFitMaxRms).toBeLessThan(1e-6);
  const patch = result.positions!.slice(positions.length);
  for (let i = 0; i < patch.length; i += 3)
    expect(
      Math.abs(patch[i + 2] - 0.025 * (patch[i] ** 2 + patch[i + 1] ** 2)),
    ).toBeLessThan(0.001);
  expect(
    Math.min(...Array.from(patch).filter((_, i) => i % 3 === 2)),
  ).toBeLessThan(0.1);
});

it("retains successor topology so the next mesh operation does not reweld the cap", () => {
  const positions = annulus(),
    topology = analyzeMesh(positions);
  const hole = topology.boundaryLoops.findIndex(
    (loop) =>
      Math.hypot(
        topology.vertices[loop[0] * 3],
        topology.vertices[loop[0] * 3 + 1],
      ) < 4.5,
  );
  const cache = {};
  const result = runScanEdit(
    { kind: "scanEdit", action: "fillHoles", positions, indices: [hole] },
    { topologyCache: cache },
  );
  const stages: string[] = [];
  const cached = analyzeMesh(result.positions!, {
    topologyCache: cache,
    onProgress: (_, stage) => stages.push(stage),
  });
  const fresh = analyzeMesh(result.positions!);
  expect(stages).toEqual(["Reusing mesh topology"]);
  expect(cached.boundaryLoops.length).toBe(fresh.boundaryLoops.length);
  expect(cached.triangles.length).toBe(fresh.triangles.length);
  expect(cached.nonManifoldEdges + cached.inconsistentEdges).toBe(0);
});
