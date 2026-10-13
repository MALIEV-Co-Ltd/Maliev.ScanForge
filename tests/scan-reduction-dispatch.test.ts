import { afterEach, expect, it, vi } from "vitest";
import { runScanTool } from "../src/scan-tools";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";
import fixture from "./fixtures/reduction-adapter.json";

const expand = (points: number[], indices: number[]) =>
  Float32Array.from(indices.flatMap((id) => points.slice(id * 3, id * 3 + 3)));
afterEach(() => vi.unstubAllGlobals());

it.each(fixture.cases)(
  "comparison preserves recovered reduction geometry $label target $target",
  (capture) => {
    const source = expand(capture.points, capture.triangles);
    const before = source.slice();
    const stages: number[] = [];
    const labels: string[] = [];
    const topologyCache = {};
    const result = runScanTool(
      {
        kind: "scanTools",
        positions: source,
        operation: {
          kind: "reducePolygons",
          mode: "triangles",
          targetTriangles: capture.target,
          measureDeviation: true,
          deviation: 0.1,
          paletteThreshold: 0.05,
        },
      },
      {
        topologyCache,
        onProgress: (fraction, stage) => {
          stages.push(fraction);
          labels.push(stage);
        },
      },
    );
    const bytes = Uint8Array.from(capture.outputHex.match(/../g)!, (pair) =>
      parseInt(pair, 16),
    );
    const nativeVertices = new Float64Array(bytes.buffer);
    const expected = Float32Array.from(
      capture.outputTriangles.flatMap((id) =>
        Array.from(nativeVertices.subarray(id * 3, id * 3 + 3)),
      ),
    );
    expect(new Uint8Array(result.positions.buffer)).toEqual(
      new Uint8Array(expected.buffer),
    );
    expect(result.noiseComparison?.rgb).toHaveLength(source.length);
    expect(result.noiseComparison?.threshold).toBe(Math.fround(0.05));
    expect(result.summary).toContain("Original-to-surface comparison");
    expect(
      stages.every((fraction, id) => !id || fraction >= stages[id - 1]),
    ).toBe(true);
    expect(source).toEqual(before);
    const completed = labels.findIndex((stage) =>
      /^Polygon reduction complet/.test(stage),
    );
    expect(completed).toBeGreaterThanOrEqual(0);
    // A no-op target bypasses reduction topology entirely; comparison still
    // needs its first source index. Actual reductions already cache that index.
    if (capture.target < source.length / 9)
      expect(
        labels
          .slice(completed + 1)
          .some((stage) => /Welding vertices|Building topology/.test(stage)),
      ).toBe(false);
  },
);

it("worker transfers original-surface colors separately from reduced geometry", async () => {
  const capture = fixture.cases[0];
  const positions = expand(capture.points, capture.triangles);
  const replies: { message: ProcessingResponse; transfers?: Transferable[] }[] =
    [];
  const scope = {
    onmessage: null as
      ((event: { data: ProcessingRequest }) => Promise<void>) | null,
    postMessage: (message: ProcessingResponse, transfers?: Transferable[]) =>
      replies.push({ message, transfers }),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  await scope.onmessage!({
    data: {
      kind: "scanTools",
      positions,
      operation: {
        kind: "reducePolygons",
        mode: "triangles",
        targetTriangles: capture.target,
        measureDeviation: true,
      },
    },
  });
  const final = replies.at(-1)!;
  if (!("result" in final.message))
    throw new Error("Expected reduction result");
  const result = final.message.result;
  expect(result.noiseComparison?.statistics).toMatchObject({
    originalTriangles: positions.length / 9,
    reducedTriangles: result.positions!.length / 9,
  });
  expect(result.noiseComparison?.rgb).toHaveLength(positions.length);
  expect(final.transfers).toEqual([
    result.positions!.buffer,
    result.noiseComparison!.rgb.buffer,
  ]);
  expect(result.diagnostics.summary).toContain(
    "Original-to-surface comparison",
  );
});

it("invalid thresholds and pre-aborted comparisons retain the source", () => {
  const capture = fixture.cases[0];
  const source = expand(capture.points, capture.triangles);
  const before = source.slice();
  const operation = {
    kind: "reducePolygons" as const,
    mode: "triangles" as const,
    targetTriangles: capture.target,
    measureDeviation: true,
    deviation: 0,
  };
  expect(() =>
    runScanTool({ kind: "scanTools", positions: source, operation }),
  ).toThrow("thresholds");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    runScanTool(
      {
        kind: "scanTools",
        positions: source,
        operation: { ...operation, deviation: 0.05 },
      },
      { signal: controller.signal },
    ),
  ).toThrow("cancelled");
  expect(source).toEqual(before);
});
