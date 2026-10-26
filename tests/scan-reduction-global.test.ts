import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as adapter from "../src/scan-reduction-adapter";
import {
  ReductionBudgetError,
  CompactReductionState,
  compactReductionBytes,
} from "../src/scan-reduction-storage";
import { nativeCompactReductionMesh } from "../src/scan-reduction-compact";
import { reduceScanMesh } from "../src/scan-tools-reduction";
import { reductionGrid } from "./helpers/reduction-grid";
import fixture from "./fixtures/reduction-global-routing.json";
afterEach(() => vi.restoreAllMocks());
const hash = (data: Float32Array) =>
  createHash("sha256")
    .update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    .digest("hex");
it.each(["triangles", "percentage"] as const)(
  "preserves the recovered whole-input sequence above the old object budget in %s mode",
  (mode) => {
    const input = reductionGrid(fixture.nx, fixture.ny);
    expect(hash(input)).toBe(fixture.sourceSha256);
    const stages: string[] = [];
    const result = reduceScanMesh(input, {
      mode,
      targetTriangles: fixture.target,
      percentage: 50,
      onProgress: (_, stage) => stages.push(stage),
    });
    expect(result.positions.length / 9).toBe(fixture.globalFaces);
    expect(hash(result.positions)).toBe(fixture.globalFloat32Sha256);
    expect(stages).not.toContain("Reducing spatial patches");
    expect(hash(input)).toBe(fixture.sourceSha256);
  },
);

it("uses explicit spatial fallback only for compact working-budget exhaustion", () => {
  const source = reductionGrid(fixture.nx, fixture.ny),
    stages: string[] = [];
  vi.spyOn(adapter, "reduceIndexedScanMesh").mockImplementationOnce(() => {
    throw new ReductionBudgetError();
  });
  const result = reduceScanMesh(source, {
    mode: "percentage",
    percentage: 50,
    onProgress: (_, stage) => stages.push(stage),
  });
  expect(result.summary).toContain("Spatial patch borders preserved");
  expect(stages).toContain("Reducing spatial patches");
  expect(hash(source)).toBe(fixture.sourceSha256);
});
it("releases real compact-kernel incidence leases before entering spatial fallback", () => {
  const source = reductionGrid(fixture.nx, fixture.ny),
    disposed: CompactReductionState[] = [];
  const dispose = CompactReductionState.prototype.dispose;
  vi.spyOn(CompactReductionState.prototype, "dispose").mockImplementation(
    function (this: CompactReductionState) {
      dispose.call(this);
      disposed.push(this);
    },
  );
  vi.spyOn(adapter, "reduceIndexedScanMesh").mockImplementationOnce(
    (topology, target, options) => {
      const result = nativeCompactReductionMesh(
        Float64Array.from(topology.vertices, Math.fround),
        topology.triangles,
        target,
        options,
        compactReductionBytes(
          topology.vertices.length / 3,
          topology.triangles.length / 3,
        ),
      );
      throw new Error(
        `Expected actual dynamic incidence-budget failure, got ${result.triangles.length}`,
      );
    },
  );
  let checked = false;
  const result = reduceScanMesh(source, {
    mode: "percentage",
    percentage: 50,
    onProgress: (_, stage) => {
      if (stage === "Reducing spatial patches" && !checked) {
        expect(disposed).toHaveLength(1);
        expect(disposed[0].memory.usedBytes).toBe(0);
        expect(disposed[0].references.length).toBe(0);
        expect(disposed[0].points.length + disposed[0].triangles.length).toBe(
          0,
        );
        checked = true;
      }
    },
  });
  expect(checked).toBe(true);
  expect(result.summary).toContain("Spatial patch borders preserved");
  expect(hash(source)).toBe(fixture.sourceSha256);
});
it.each([
  new DOMException("cancelled", "AbortError"),
  new Error("invalid topology"),
  new RangeError("allocation failed"),
])("propagates %s without spatial retry", (error) => {
  const source = reductionGrid(fixture.nx, fixture.ny),
    stages: string[] = [];
  vi.spyOn(adapter, "reduceIndexedScanMesh").mockImplementationOnce(() => {
    throw error;
  });
  expect(() =>
    reduceScanMesh(source, {
      mode: "percentage",
      percentage: 50,
      onProgress: (_, stage) => stages.push(stage),
    }),
  ).toThrow(error);
  expect(stages).not.toContain("Reducing spatial patches");
  expect(hash(source)).toBe(fixture.sourceSha256);
});
