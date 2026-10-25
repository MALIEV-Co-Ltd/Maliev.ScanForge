import { expect, it, vi } from "vitest";
import type {
  ProcessingRequest,
  ProcessingResponse,
} from "../src/processing-client";

it("copies a borrowed report source before inventory while reusing exact prepared topology", async () => {
  vi.resetModules();
  const mesh = await import("../src/mesh-processing");
  const edit = await import("../src/scan-edit");
  const weld = await import("../src/mesh-weld");
  const analyze = vi.spyOn(mesh, "analyzeMesh");
  const welding = vi.spyOn(weld, "weldMeshPositions");
  const source = new Float32Array(new SharedArrayBuffer(36));
  source.set([0, -0, 0, 2, 0, 0, 0, 2, 0]);
  const originalBytes = new Uint8Array(source.buffer).slice();
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (message: ProcessingResponse) => replies.push(message),
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const send = (
      data: ProcessingRequest & {
        geometryKey: number;
        borrowedReportSource?: true;
      },
    ) => scope.onmessage!({ data });
    await send({
      kind: "report",
      positions: source,
      tolerance: 0.001,
      geometryKey: 42,
      borrowedReportSource: true,
    });
    const topology = analyze.mock.results[0].value;
    await send({
      kind: "report",
      positions: new Float32Array(0),
      tolerance: 0.001,
      geometryKey: 42,
    });
    expect(analyze.mock.calls[1][0]).toBe(source);
    let privatePositions: unknown;
    const originalEdit = edit.runScanEdit;
    vi.spyOn(edit, "runScanEdit").mockImplementation((request, options) => {
      expect(request.positions).not.toBe(source);
      expect(
        request.positions instanceof Float32Array &&
          request.positions.buffer instanceof ArrayBuffer,
      ).toBe(true);
      privatePositions ??= request.positions;
      expect(request.positions).toBe(privatePositions);
      expect(options?.topologyCache?.positions).toBe(privatePositions);
      expect(options?.topologyCache?.topology).toBe(topology);
      return originalEdit(request, options);
    });
    for (let i = 0; i < 2; i++)
      await send({
        kind: "scanEdit",
        action: "inventory",
        positions: new Float32Array(0),
        tolerance: 0.001,
        geometryKey: 42,
      });
    expect(replies.at(-1)).toMatchObject({ result: { kind: "scanEdit" } });
    expect(welding).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(source.buffer)).toEqual(originalBytes);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("keeps borrowed bytes immutable across a rejected edit and a private mutable successor", async () => {
  vi.resetModules();
  const scan = await import("../src/scan-tools");
  const mesh = await import("../src/mesh-processing");
  const weld = await import("../src/mesh-weld");
  const analyze = vi.spyOn(mesh, "analyzeMesh");
  const welding = vi.spyOn(weld, "weldMeshPositions");
  const source = new Float32Array(new SharedArrayBuffer(36));
  source.set([0, -0, 0, 2, 0, 0, 0, 2, 0]);
  const bytes = new Uint8Array(source.buffer).slice();
  const replies: ProcessingResponse[] = [];
  const transfers: Transferable[][] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (message: ProcessingResponse, moved: Transferable[] = []) => {
      replies.push(message);
      transfers.push(moved);
    },
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const send = (
      data: ProcessingRequest & {
        geometryKey: number;
        borrowedReportSource?: true;
      },
    ) => scope.onmessage!({ data });
    await send({
      kind: "report",
      positions: source,
      tolerance: 0.001,
      geometryKey: 42,
      borrowedReportSource: true,
    });
    const topology = analyze.mock.results[0].value;
    let privateSource: unknown;
    const tool = vi
      .spyOn(scan, "runScanTool")
      .mockImplementationOnce((request, options) => {
        expect(
          request.positions instanceof Float32Array &&
            request.positions.buffer instanceof ArrayBuffer,
        ).toBe(true);
        privateSource = request.positions;
        expect(options?.topologyCache?.topology).toBe(topology);
        options!.topologyCache!.positions = new Float32Array(9);
        throw Error("Rejected temporary edit");
      });
    await send({
      kind: "scanTools",
      positions: new Float32Array(0),
      operation: { kind: "scaleMesh", factor: 2 },
      geometryKey: 42,
    });
    expect(replies.at(-1)).toEqual({ error: "Rejected temporary edit" });
    await send({
      kind: "report",
      positions: new Float32Array(0),
      tolerance: 0.001,
      geometryKey: 42,
    });
    expect(analyze.mock.calls.at(-1)![0]).toBe(privateSource);
    expect(analyze.mock.results.at(-1)!.value).toBe(topology);
    expect(welding).toHaveBeenCalledTimes(1);
    tool.mockImplementationOnce((request) => {
      const positions = request.positions;
      positions[0] = 7;
      return {
        positions: new Float32Array(positions),
        summary: "private edit",
        diagnostics: {},
      };
    });
    await send({
      kind: "scanTools",
      positions: new Float32Array(0),
      operation: { kind: "scaleMesh", factor: 2 },
      geometryKey: 42,
    });
    const result = replies.at(-1);
    expect(result).toMatchObject({ result: { kind: "scanTools" } });
    if (!result || !("result" in result)) throw Error("Missing edit result");
    expect(result.result.positions?.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.result.positions?.[0]).toBe(7);
    expect(
      transfers.at(-1)?.every((buffer) => buffer instanceof ArrayBuffer),
    ).toBe(true);
    expect(new Uint8Array(source.buffer)).toEqual(bytes);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("copies before a rejected preview command and resets borrowing for a different geometry", async () => {
  vi.resetModules();
  const mesh = await import("../src/mesh-processing");
  const analyze = vi.spyOn(mesh, "analyzeMesh");
  const replies: ProcessingResponse[] = [];
  const scope = {
    onmessage: null as
      null | ((event: { data: ProcessingRequest }) => Promise<void>),
    postMessage: (message: ProcessingResponse) => replies.push(message),
  };
  vi.stubGlobal("self", scope);
  try {
    await import("../src/processing-worker");
    const source = new Float32Array(new SharedArrayBuffer(36));
    source.set([0, 0, 0, 2, 0, 0, 0, 2, 0]);
    const send = (
      data: ProcessingRequest & {
        geometryKey: number;
        borrowedReportSource?: true;
      },
    ) => scope.onmessage!({ data });
    await send({
      kind: "report",
      positions: source,
      tolerance: 0.001,
      geometryKey: 42,
      borrowedReportSource: true,
    });
    await send({
      kind: "scanPreview",
      phase: "compare",
      previewId: "missing",
      deviation: 1,
      positions: new Float32Array(0),
      geometryKey: 42,
    });
    expect(replies.at(-1)).toMatchObject({
      error: expect.stringMatching(/expired/),
    });
    await send({
      kind: "report",
      positions: new Float32Array(0),
      tolerance: 0.001,
      geometryKey: 42,
    });
    expect(analyze.mock.calls.at(-1)![0]).not.toBe(source);
    const next = new Float32Array([0, 0, 0, 3, 0, 0, 0, 3, 0]);
    await send({
      kind: "report",
      positions: next,
      tolerance: 0.001,
      geometryKey: 43,
    });
    await send({
      kind: "scanEdit",
      action: "inventory",
      positions: new Float32Array(0),
      tolerance: 0.001,
      geometryKey: 43,
    });
    expect(analyze.mock.calls.at(-1)![0]).toBe(next);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
