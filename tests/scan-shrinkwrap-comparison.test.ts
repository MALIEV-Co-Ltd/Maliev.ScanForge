import { expect, it, vi } from "vitest";
import { compareShrinkwrapSurface } from "../src/scan-shrinkwrap-comparison";
import { ScanPreviewSession } from "../src/scan-preview";
import * as tools from "../src/scan-tools";
import * as mesh from "../src/mesh-processing";
const plane = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
it("compares every original triangle corner with unsigned exact surface distances", () => {
  const source = new Float32Array([...plane, ...plane]);
  for (let i = 2; i < source.length; i += 3) source[i] = 0.25;
  const result = compareShrinkwrapSurface(source, plane, 0.2, 0.2);
  expect(result.noiseComparison.statistics).toMatchObject({
    total: 6,
    matched: 6,
    within: 0,
    unmatched: 0,
    minimum: 0.25,
    maximum: 0.25,
    rms: 0.25,
    originalTriangles: 2,
    reducedTriangles: 1,
  });
  expect(result.noiseComparison.rgb).toHaveLength(source.length);
  expect(result.summary).toMatch(/unsigned/i);
  expect(result.summary).toMatch(/corners/i);
  expect(result.summary).toMatch(/not certified/i);
});
it("does not hide distant samples behind a palette search radius", () => {
  const source = plane.slice();
  for (let i = 2; i < source.length; i += 3) source[i] = 100;
  expect(
    compareShrinkwrapSurface(source, plane, 0.1, 0.1).noiseComparison
      .statistics,
  ).toMatchObject({ matched: 3, maximum: 100, within: 0 });
});
it("validates thresholds and preserves cancellation", () => {
  expect(() => compareShrinkwrapSurface(plane, plane, 0)).toThrow(/positive/i);
  expect(() =>
    compareShrinkwrapSurface(plane, plane, 0.1, 0.1, {
      signal: AbortSignal.abort(),
    }),
  ).toThrow(/cancel/i);
});
it("creates ShrinkWrap previews without analyzing or welding the source", async () => {
  const analyze = vi.spyOn(mesh, "analyzeMesh");
  const run = vi
    .spyOn(tools, "runScanTool")
    .mockReturnValueOnce({ positions: plane.slice(), summary: "wrapped" });
  try {
    const preview = await ScanPreviewSession.create({
      kind: "scanPreview",
      phase: "create",
      previewId: "borrowed",
      positions: plane,
      operation: { kind: "shrinkwrap" },
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(preview.original).toBeUndefined();
    expect(preview.compare(0.1).noiseComparison.statistics).toMatchObject({
      total: 3,
      within: 3,
    });
    expect(plane).toEqual(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]));
  } finally {
    analyze.mockRestore();
    run.mockRestore();
  }
});
