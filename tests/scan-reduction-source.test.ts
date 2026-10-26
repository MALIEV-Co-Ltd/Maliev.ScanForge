import { expect, it } from "vitest";
import { analyzeIndexedMesh, analyzeMesh } from "../src/mesh-processing";
import { validateReductionSource } from "../src/scan-reduction-source";
import { reductionGrid } from "./helpers/reduction-grid";
import { prepareReductionSource } from "../src/scan-reduction-adapter";
import { reduceScanMesh } from "../src/scan-tools-reduction";
import { weldMeshPositions } from "../src/mesh-weld";

const vertices = Float64Array.from([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, -1, 0, 0, 0, 0, 1,
]);
const cases = {
  validOpen: [0, 1, 2, 1, 4, 2],
  duplicate: [0, 1, 2, 2, 0, 1],
  degenerate: [0, 1, 1],
  winding: [0, 1, 2, 0, 1, 3],
  edge: [0, 1, 2, 1, 0, 3, 0, 1, 6],
  disconnectedFan: [0, 1, 2, 0, 3, 5],
};
it.each(Object.entries(cases))(
  "matches full topology rejection for %s",
  (_, faces) => {
    const triangles = Uint32Array.from(faces);
    const t = analyzeIndexedMesh(vertices, triangles);
    const invalid = !!(
      t.degenerateTriangles ||
      t.duplicateTriangles ||
      t.nonManifoldEdges ||
      t.nonManifoldVertices ||
      t.inconsistentEdges
    );
    if (invalid)
      expect(() => validateReductionSource(vertices, triangles)).toThrow(
        "Repair invalid",
      );
    else
      expect(() => validateReductionSource(vertices, triangles)).not.toThrow();
  },
);
it("rejects an undersized validation budget before analysis and observes cancellation", () => {
  const { vertices, triangles } = analyzeMesh(reductionGrid(8, 8));
  expect(() =>
    validateReductionSource(vertices, triangles, undefined, 1),
  ).toThrow("working-memory");
  const stop = new Error("cancelled");
  expect(() =>
    validateReductionSource(vertices, triangles, () => {
      throw stop;
    }),
  ).toThrow(stop);
});

it("matches full diagnostics over deterministic indexed triangle combinations", () => {
  let seed = 734891;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let sample = 0; sample < 1200; sample++) {
    const triangles = Uint32Array.from(
      { length: (1 + (random() % 7)) * 3 },
      () => random() % 7,
    );
    const t = analyzeIndexedMesh(vertices, triangles);
    const invalid = !!(
      t.degenerateTriangles ||
      t.duplicateTriangles ||
      t.nonManifoldEdges ||
      t.nonManifoldVertices ||
      t.inconsistentEdges
    );
    let rejected = false;
    try {
      validateReductionSource(vertices, triangles);
    } catch {
      rejected = true;
    }
    expect(rejected, `sample ${sample}: ${Array.from(triangles)}`).toBe(
      invalid,
    );
  }
});

it.each([8, 160])(
  "retains all invalid-source gates and source bytes at grid width %s",
  (size) => {
    const grid = reductionGrid(size, 128);
    for (const [name, faces] of Object.entries(cases)) {
      if (name === "validOpen") continue;
      const extra = Float32Array.from(
        faces.flatMap((id) => [
          vertices[id * 3] - 20,
          vertices[id * 3 + 1] - 20,
          vertices[id * 3 + 2],
        ]),
      );
      const source = new Float32Array(grid.length + extra.length);
      source.set(grid);
      source.set(extra, grid.length);
      const before = source.slice(),
        stages: string[] = [];
      expect(
        () =>
          reduceScanMesh(source, {
            mode: "percentage",
            percentage: 50,
            onProgress: (_, stage) => stages.push(stage),
          }),
        name,
      ).toThrow("Repair invalid");
      expect(source).toEqual(before);
      expect(stages).not.toContain("Reducing spatial patches");
    }
  },
);

it("preserves weld order, effective tolerance, cached indexed identity and cancellation", () => {
  const source = reductionGrid(8, 8),
    expected = weldMeshPositions(source, 1e-6);
  const prepared = prepareReductionSource(source, { tolerance: 1 });
  expect(prepared).toEqual(expected);
  const topology = analyzeIndexedMesh(expected.vertices, expected.triangles);
  expect(
    prepareReductionSource(source, {
      topologyCache: { positions: source, tolerance: 1e-6, topology },
    }),
  ).toBe(topology);
  for (const stopStage of ["Welding vertices", "Checking reduction topology"]) {
    const controller = new AbortController();
    expect(() =>
      prepareReductionSource(source, {
        signal: controller.signal,
        onProgress: (_, stage) => {
          if (stage === stopStage) controller.abort();
        },
      }),
    ).toThrow("cancelled");
  }
});
