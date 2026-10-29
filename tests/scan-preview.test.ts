import { afterEach, expect, it, vi } from "vitest";
import { ScanPreviewSession } from "../src/scan-preview";
import { reduceScanNoise, reduceScanMesh } from "../src/scan-tools-reduction";
import { runScanTool } from "../src/scan-tools";
import * as tree from "../src/scan-noise-octree";
import * as samples from "../src/scan-resident-samples";
import * as weld from "../src/mesh-weld";
import * as reductionAdapter from "../src/scan-reduction-adapter";
import { reductionGrid } from "./helpers/reduction-grid";
import selected3 from "./fixtures/noise-annular-selected-3.json";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("prepares polygon comparison once with bounded storage and reuses its indexed source for the edit", async () => {
  const source = reductionGrid(8, 8),
    before = source.slice();
  const legacy = vi.spyOn(samples, "weldScanSamples"),
    preparation = vi.spyOn(weld, "weldMeshPositions"),
    edit = vi.spyOn(reductionAdapter, "prepareReductionSource");
  const preview = await ScanPreviewSession.create({
    kind: "scanPreview",
    phase: "create",
    previewId: "bounded-original",
    positions: source,
    operation: { kind: "reducePolygons", mode: "percentage", percentage: 50 },
  });
  expect(legacy).not.toHaveBeenCalled();
  expect(preparation).toHaveBeenCalledOnce();
  expect(preparation.mock.calls[0][3]).toBeTypeOf("function");
  expect(edit).toHaveBeenCalledOnce();
  expect(edit.mock.results[0].value.vertices).toBe(preview.original!.vertices);
  expect(edit.mock.results[0].value.triangles).toBe(
    preview.original!.triangles,
  );
  expect(source).toEqual(before);
});
it.each([3, 8])(
  "preserves the polygon caller's unchanged target %s without adding topology rejection",
  async (targetTriangles) => {
    const source = new Float32Array(8 * 9);
    const preview = await ScanPreviewSession.create({
      kind: "scanPreview",
      phase: "create",
      previewId: "shortcut",
      positions: source,
      operation: { kind: "reducePolygons", mode: "triangles", targetTriangles },
    });
    expect(preview.output).toEqual(source);
  },
);
it("does not relabel a stale diagnostic cache as the current preview source", async () => {
  const source = reductionGrid(8, 8),
    stale = reductionGrid(4, 4);
  const topology = (await import("../src/mesh-processing")).analyzeMesh(stale);
  const preview = await ScanPreviewSession.create(
    {
      kind: "scanPreview",
      phase: "create",
      previewId: "stale",
      positions: source,
      operation: { kind: "reducePolygons", mode: "percentage", percentage: 50 },
    },
    { topologyCache: { positions: stale, tolerance: 1e-6, topology } },
  );
  expect(preview.output).toEqual(
    reduceScanMesh(source, { mode: "percentage", percentage: 50 }).positions,
  );
  expect(preview.original!.triangles.length).toBe(source.length / 3);
});
it.each(["reduceNoise", "reducePolygons"] as const)(
  "%s preview retains original geometry and caches comparison without repeating its edit",
  async (kind) => {
    const positions = new Float32Array(selected3.positions);
    const before = positions.slice();
    const operation =
      kind === "reduceNoise"
        ? {
            kind,
            iterations: 3,
            selectionOnly: true,
            selection: new Uint8Array(selected3.selection),
          }
        : { kind, mode: "percentage" as const, percentage: 50 };
    const session = await ScanPreviewSession.create({
      kind: "scanPreview",
      phase: "create",
      previewId: "preview",
      positions,
      operation,
    });
    const expected =
      kind === "reduceNoise"
        ? selected3.nativeOutput
        : Array.from(
            reduceScanMesh(positions, { mode: "percentage", percentage: 50 })
              .positions,
          );
    expect(Array.from(session.output)).toEqual(expected);
    expect(positions).toEqual(before);
    const build = vi.spyOn(tree, "prepareNoiseOctree");
    const initial = session.compare(0.05, 0.05);
    const changed = session.compare(0.1, 0.05);
    expect(build).toHaveBeenCalledTimes(1);
    expect(initial.noiseComparison.rgb.length).toBe(positions.length);
    expect(changed.summary).toContain("within 0.1 mm");
    const direct =
      kind === "reduceNoise"
        ? reduceScanNoise(positions, {
            ...operation,
            iterations: 3,
            selectionOnly: true,
            selection: new Uint8Array(selected3.selection),
            measureDeviation: true,
            deviation: 0.05,
          })
        : runScanTool({
            kind: "scanTools",
            positions,
            operation: {
              kind,
              mode: "percentage",
              percentage: 50,
              measureDeviation: true,
              deviation: 0.05,
              paletteThreshold: 0.05,
            },
          });
    expect(initial.noiseComparison.rgb).toEqual(direct.noiseComparison!.rgb);
    expect(Array.from(session.output)).toEqual(expected);
    const cancelled = new AbortController();
    cancelled.abort();
    expect(() =>
      session.compare(0.1, 0.05, { signal: cancelled.signal }),
    ).toThrow("cancelled");
    expect(() => session.compare(NaN)).toThrow("positive finite");
    expect(positions).toEqual(before);
  },
);

it("worker preview and comparison preserve canonical original and expire retained preview", async () => {
  vi.useFakeTimers();
  const messages: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      ((event: { data: ProcessingRequest }) => Promise<void>) | null,
    postMessage: (message: ProcessingResponse) => messages.push(message),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  const positions = new Float32Array(selected3.positions);
  const send = async (request: ProcessingRequest) => {
    messages.length = 0;
    await scope.onmessage!({
      data: { ...request, geometryKey: 42 } as unknown as ProcessingRequest,
    });
    return messages.at(-1)!;
  };
  const create = {
    kind: "scanPreview" as const,
    phase: "create" as const,
    previewId: "first",
    positions,
    operation: {
      kind: "reduceNoise" as const,
      iterations: 3,
      selectionOnly: true,
      selection: new Uint8Array(selected3.selection),
    },
  };
  const first = await send(create);
  if (!("result" in first)) throw Error("Missing preview");
  expect(Array.from(first.result.positions!)).toEqual(selected3.nativeOutput);
  const comparison = await send({
    kind: "scanPreview",
    phase: "compare",
    previewId: "first",
    positions: new Float32Array(),
    deviation: 0.1,
  });
  if (!("result" in comparison)) throw Error("Missing comparison");
  expect(comparison.result.positions).toBeUndefined();
  expect(comparison.result.noiseComparison!.rgb.length).toBe(positions.length);
  expect(
    messages.some(
      (message) =>
        "stage" in message &&
        /Welding|Building topology|Reducing mesh noise/.test(message.stage),
    ),
  ).toBe(false);
  const second = await send({
    ...create,
    positions: new Float32Array(),
    previewId: "second",
  });
  if (!("result" in second)) throw Error("Missing successor preview");
  expect(Array.from(second.result.positions!)).toEqual(selected3.nativeOutput);
  expect(
    await send({
      kind: "scanPreview",
      phase: "compare",
      previewId: "first",
      positions: new Float32Array(),
      deviation: 0.1,
    }),
  ).toEqual({ error: "This mesh preview has expired. Create a new preview." });
  vi.advanceTimersByTime(60_001);
  expect(
    await send({
      kind: "scanPreview",
      phase: "compare",
      previewId: "second",
      positions: new Float32Array(),
      deviation: 0.1,
    }),
  ).toEqual({ error: "This mesh preview has expired. Create a new preview." });
  expect(Array.from(positions)).toEqual(selected3.positions);
});
