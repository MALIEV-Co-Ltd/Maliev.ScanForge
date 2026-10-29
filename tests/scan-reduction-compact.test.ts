import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  nativeCompactReductionMesh,
  rejectCompactReductionCollapse,
  updateCompactReductionFaces,
  compactReductionResult,
} from "../src/scan-reduction-compact";
import frozen from "./fixtures/reduction-compact-differential.json";
import {
  compactReductionBytes,
  CompactReductionState,
} from "../src/scan-reduction-storage";
import { weldMeshPositions } from "../src/mesh-weld";
import { reductionGrid } from "./helpers/reduction-grid";
import validity from "./fixtures/reduction-validity.json";
import updates from "./fixtures/reduction-update.json";
import type { Vec3 } from "../src/types";
import whole from "./fixtures/reduction-whole.json";
import { reductionDifferentialCases } from "./helpers/reduction-differential";
import globalFixture from "./fixtures/reduction-global-routing.json";
const hash = (data: ArrayBufferView) =>
  createHash("sha256")
    .update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    .digest("hex");
const hex = (data: Float64Array) =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("hex");
it.each(whole.cases)(
  "compact loop matches retained complete native bytes $label target $target",
  (capture) => {
    const points = Float64Array.from(capture.points),
      triangles = Uint32Array.from(capture.triangles);
    const before = [hash(points), hash(triangles)],
      progress: number[] = [];
    const actual = nativeCompactReductionMesh(
      points,
      triangles,
      capture.target,
      { onProgress: (f) => progress.push(f) },
    );
    expect(hex(actual.vertices)).toBe(capture.outputHex);
    expect(Array.from(actual.triangles)).toEqual(capture.outputTriangles);
    expect(actual.triangles.length / 3).toBe(capture.outputCount);
    expect([hash(points), hash(triangles)]).toEqual(before);
    expect(progress.at(-1)).toBe(1);
    expect(
      progress.every(
        (f, i) => f >= 0 && f <= 1 && (!i || f >= progress[i - 1]),
      ),
    ).toBe(true);
  },
);
const grid = weldMeshPositions(reductionGrid(12, 11), 1e-6);
const cases = reductionDifferentialCases();
it.each(cases)("matches the original global record loop: $label", (input) => {
  const source = [hash(input.vertices), hash(input.triangles)];
  const old = frozen.cases.find((row) => row.label === input.label)!;
  expect(old).toBeDefined();
  expect(source).toEqual([old.inputVerticesSha256, old.inputTrianglesSha256]);
  let reports = 0;
  const actual = nativeCompactReductionMesh(
    input.vertices,
    input.triangles,
    input.target,
    {
      onProgress: (_, s) => {
        if (s === "Collapsing native mesh edges") reports++;
      },
    },
  );
  expect(hash(actual.vertices)).toBe(old.outputVerticesSha256);
  expect(hash(actual.triangles)).toBe(old.outputTrianglesSha256);
  expect(actual.triangles.length / 3).toBe(old.outputFaces);
  expect(reports).toBe(old.reports);
  if (input.label.includes("multiple rebuilds"))
    expect(reports).toBeGreaterThan(40);
  const again = nativeCompactReductionMesh(
    input.vertices,
    input.triangles,
    input.target,
  );
  expect(hash(again.vertices)).toBe(hash(actual.vertices));
  expect(hash(again.triangles)).toBe(hash(actual.triangles));
  expect([hash(input.vertices), hash(input.triangles)]).toEqual(source);
});
it("matches the frozen whole-input 40960-facet loop before routing integration", () => {
  const input = weldMeshPositions(
    reductionGrid(globalFixture.nx, globalFixture.ny),
    1e-6,
  );
  const result = nativeCompactReductionMesh(
    input.vertices,
    input.triangles,
    globalFixture.target,
  );
  expect(hash(result.vertices)).toBe(globalFixture.globalFloat64Sha256);
  expect(hash(result.triangles)).toBe(globalFixture.globalTriangleSha256);
});
it.each([
  "Preparing native reduction",
  "Collapsing native mesh edges",
  "Compacting reduced mesh",
])(
  "cancels compact reduction during %s without mutating its input",
  (cancelAt) => {
    const source = [hash(grid.vertices), hash(grid.triangles)],
      controller = new AbortController(),
      stages: string[] = [];
    expect(() =>
      nativeCompactReductionMesh(grid.vertices, grid.triangles, 132, {
        signal: controller.signal,
        onProgress: (_, stage) => {
          stages.push(stage);
          if (stage === cancelAt) controller.abort();
        },
      }),
    ).toThrow("cancelled");
    expect(stages).not.toContain("Polygon reduction completed");
    expect([hash(grid.vertices), hash(grid.triangles)]).toEqual(source);
  },
);
it("unwinds a dynamic incidence budget failure instead of modifying its source", () => {
  const source = [hash(grid.vertices), hash(grid.triangles)],
    stages: string[] = [];
  const limit = compactReductionBytes(
    grid.vertices.length / 3,
    grid.triangles.length / 3,
  );
  expect(() =>
    nativeCompactReductionMesh(
      grid.vertices,
      grid.triangles,
      132,
      { onProgress: (_, s) => stages.push(s) },
      limit,
    ),
  ).toThrow(/working-memory/);
  expect(stages).toContain("Collapsing native mesh edges");
  expect([hash(grid.vertices), hash(grid.triangles)]).toEqual(source);
});
it("preserves invalid-input validation and empty native export behavior", () => {
  expect(() => nativeCompactReductionMesh([0], [], 0)).toThrow("complete");
  expect(() => nativeCompactReductionMesh([0, 0, NaN], [], 0)).toThrow(
    "finite",
  );
  expect(() => nativeCompactReductionMesh([0, 0, 0], [0, 1, 0], 0)).toThrow(
    "index",
  );
  expect(() => nativeCompactReductionMesh([], [], 1)).toThrow("target");
  expect(nativeCompactReductionMesh([], [], 0)).toEqual({
    vertices: new Float64Array(),
    triangles: new Uint32Array(),
  });
});

it.each(validity.cases)(
  "compact validity preserves native rejection and partial mask writes %#",
  (capture) => {
    const points = Float64Array.from(capture.vertices),
      triangles = Uint32Array.from(
        capture.faces.flatMap((face) => face.vertices),
      );
    const state = new CompactReductionState(points, triangles);
    try {
      capture.faces.forEach((face, index) => {
        state.normals.set(face.normal, index * 3);
        state.flags[index] = Number(face.deleted);
      });
      const refs = Uint32Array.from(
          capture.references,
          (r) => r.face * 3 + r.corner,
        ),
        mask = Uint32Array.from(capture.initialMask);
      expect(
        rejectCompactReductionCollapse(
          state,
          capture.point as Vec3,
          capture.other,
          refs,
          mask,
        ),
      ).toBe(capture.rejected);
      expect(Array.from(mask)).toEqual(capture.mask);
      expect(hash(state.points)).toBe(hash(points));
    } finally {
      state.dispose();
    }
  },
);
it.each(updates.cases)(
  "compact update preserves native face bytes and fixed reference visits %#",
  (capture) => {
    const points = Float64Array.from(
      capture.vertices.flatMap((vertex) => vertex.point),
    );
    const triangles = Uint32Array.from(
      capture.faces.flatMap((face) => face.vertices),
    );
    const state = new CompactReductionState(points, triangles);
    try {
      capture.vertices.forEach((vertex, index) => {
        state.quadrics.set(vertex.quadric, index * 10);
        state.boundary[index] = Number(vertex.boundary);
      });
      capture.faces.forEach((face, index) => {
        state.normals.set(face.normal, index * 3);
        state.errors.set(face.errors, index * 3);
        state.best[index] = face.bestEdge;
        state.flags[index] = Number(face.deleted) | (Number(face.dirty) << 1);
      });
      const refs = Uint32Array.from(
          capture.references,
          (r) => r.face * 3 + r.corner,
        ),
        appended = new Uint32Array(refs.length);
      const result = updateCompactReductionFaces(
        state,
        capture.retained,
        refs,
        Uint32Array.from(capture.mask),
        appended,
        0,
        capture.initialDeleted,
      );
      expect(result.deleted).toBe(capture.deletedCount);
      expect(
        Array.from(appended.subarray(0, result.cursor), (value) => ({
          face: Math.floor(value / 3),
          corner: value % 3,
        })),
      ).toEqual(capture.appended);
      capture.output.forEach((face, index) => {
        expect(
          Array.from(state.triangles.subarray(index * 3, index * 3 + 3)),
        ).toEqual(face.vertices);
        expect(hex(state.errors.subarray(index * 3, index * 3 + 3))).toBe(
          face.errorsHex,
        );
        expect(state.best[index]).toBe(face.bestEdge);
        expect(Boolean(state.flags[index] & 1)).toBe(face.deleted);
        expect(Boolean(state.flags[index] & 2)).toBe(face.dirty);
        expect(
          Array.from(state.normals.subarray(index * 3, index * 3 + 3)),
        ).toEqual(face.normal);
      });
      const final = compactReductionResult(state);
      expect(hex(final.vertices)).toBe(capture.finalHex);
      expect(Array.from(final.triangles)).toEqual(capture.finalTriangles);
      expect(hash(state.points)).toBe(hash(points));
    } finally {
      state.dispose();
    }
  },
);
