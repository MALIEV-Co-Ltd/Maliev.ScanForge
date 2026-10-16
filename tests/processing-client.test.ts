import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanRenderData, prepareScanRenderData } from "../src/scan-render-data";
import { observeScanDiagnostics } from "../src/scan-diagnostics";
import {
  releaseProcessingSession,
  retainProcessingGeometry,
} from "../src/processing-session";
import {
  processMesh,
  type ProcessingRequest,
  type ProcessingResult,
} from "../src/processing-client";

class ProcessingWorkerDouble {
  static latest: ProcessingWorkerDouble;
  static creates = 0;
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent?: ProcessingRequest;
  transfers?: Transferable[];
  constructor() {
    ProcessingWorkerDouble.latest = this;
    ProcessingWorkerDouble.creates++;
  }
  postMessage(request: ProcessingRequest, transfers: Transferable[]) {
    this.sent = request;
    this.transfers = transfers;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const request: ProcessingRequest = {
  kind: "report",
  positions,
  tolerance: 0.001,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", ProcessingWorkerDouble);
  ProcessingWorkerDouble.creates = 0;
});
afterEach(() => {
  releaseProcessingSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("processing worker resource ownership", () => {
  it("stops an orphaned diagnostics handoff when the queued tool is cancelled", async () => {
    const source = positions.slice(),
      controller = new AbortController();
    const leave = observeScanDiagnostics(source, () => {});
    const owned = ProcessingWorkerDouble.latest;
    leave();
    const inventory = processMesh(
      { kind: "scanEdit", action: "inventory", positions: source },
      { reuseTopology: true, signal: controller.signal },
    );
    await Promise.resolve();
    expect(owned.terminated).toBe(false);
    controller.abort();
    await expect(inventory).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(owned.terminated).toBe(true);
  });
  it("hands a pending diagnostics worker to a tool mounted in the same panel transition", async () => {
    const source = positions.slice();
    const leaveDiagnostics = observeScanDiagnostics(source, () => {});
    const owned = ProcessingWorkerDouble.latest;
    leaveDiagnostics();
    const inventory = processMesh(
      {
        kind: "scanEdit",
        action: "inventory",
        positions: source,
        tolerance: 0.001,
      },
      { reuseTopology: true },
    );
    await Promise.resolve();
    expect(ProcessingWorkerDouble.creates).toBe(1);
    expect(owned.terminated).toBe(false);
    owned.reply({
      result: {
        kind: "report",
        diagnostics: {},
        topology: {
          vertices: 3,
          triangles: 1,
          components: 1,
          boundaryLoops: 1,
          boundaryChains: 0,
          boundaryEdges: 3,
          nonManifoldEdges: 0,
          nonManifoldVertices: 0,
          inconsistentEdges: 0,
          degenerateTriangles: 0,
          duplicateTriangles: 0,
        },
      },
    });
    await Promise.resolve();
    expect(owned.sent!.kind).toBe("scanEdit");
    owned.reply({ result: { kind: "scanEdit", diagnostics: {} } });
    await inventory;
    expect(ProcessingWorkerDouble.creates).toBe(1);
  });
  it("publishes prepared aligned display buffers before the GUI or agent consumes the result", async () => {
    const output = positions.slice(),
      renderData = prepareScanRenderData(output);
    const pending = processMesh({
      kind: "paired",
      positions,
      sourceLandmarks: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      targetLandmarks: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    });
    ProcessingWorkerDouble.latest.reply({
      result: {
        kind: "paired",
        positions: output,
        renderData,
        diagnostics: {},
      },
    });
    const result = await pending;
    expect(scanRenderData(result.positions!)).toBe(renderData);
    expect(scanRenderData(positions)).toBeUndefined();
    expect(result.positions).toBe(output);
  });
  it("retains the original source after a disposable preview result", async () => {
    const preview = processMesh(
      {
        kind: "scanPreview",
        phase: "create",
        previewId: "preview",
        positions,
        operation: { kind: "reduceNoise", iterations: 3 },
      },
      { reuseTopology: true },
    );
    const worker = ProcessingWorkerDouble.latest;
    worker.reply({
      result: {
        kind: "scanPreview",
        positions: positions.slice(),
        diagnostics: {},
      },
    });
    await preview;
    const comparison = processMesh(
      {
        kind: "scanPreview",
        phase: "compare",
        previewId: "preview",
        positions,
        deviation: 0.05,
      },
      { reuseTopology: true },
    );
    expect(ProcessingWorkerDouble.latest).toBe(worker);
    expect(worker.sent!.positions).toHaveLength(0);
    expect(worker.transfers).toHaveLength(0);
    worker.reply({ result: { kind: "scanPreview", diagnostics: {} } });
    await comparison;
    expect(ProcessingWorkerDouble.creates).toBe(1);
    expect(positions).toHaveLength(9);
  });
  it("queues requests for the same geometry and cancels without duplicating topology workers", async () => {
    const controller = new AbortController();
    const first = processMesh(request, {
      reuseTopology: true,
      signal: controller.signal,
    });
    const owned = ProcessingWorkerDouble.latest;
    const second = processMesh(request, { reuseTopology: true });
    expect(ProcessingWorkerDouble.creates).toBe(1);
    controller.abort();
    await expect(first).rejects.toThrow("cancelled");
    expect(owned.terminated).toBe(true);
    const successor = ProcessingWorkerDouble.latest;
    expect(successor).not.toBe(owned);
    successor.reply({ result: { kind: "report", diagnostics: {} } });
    await second;
    retainProcessingGeometry(undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reuses the prepared source for a queued inventory without transferring or welding it again", async () => {
    const first = processMesh(request, { reuseTopology: true });
    const owned = ProcessingWorkerDouble.latest;
    const second = processMesh(
      { kind: "scanEdit", action: "inventory", positions },
      { reuseTopology: true },
    );
    expect(ProcessingWorkerDouble.creates).toBe(1);
    expect(owned.sent!.kind).toBe("report");
    owned.reply({ result: { kind: "report", diagnostics: {} } });
    await first;
    expect(owned.sent!.kind).toBe("scanEdit");
    expect(owned.sent!.positions).toHaveLength(0);
    owned.reply({ result: { kind: "scanEdit", diagnostics: {} } });
    await second;
    expect(ProcessingWorkerDouble.creates).toBe(1);
  });
  it("cancels a queued request immediately without starting another worker", async () => {
    const first = processMesh(request, { reuseTopology: true });
    const owned = ProcessingWorkerDouble.latest,
      controller = new AbortController();
    const queued = processMesh(request, {
      reuseTopology: true,
      signal: controller.signal,
    });
    controller.abort();
    await expect(queued).rejects.toThrow("cancelled");
    expect(ProcessingWorkerDouble.creates).toBe(1);
    owned.reply({ result: { kind: "report", diagnostics: {} } });
    await first;
    expect(ProcessingWorkerDouble.creates).toBe(1);
  });
  it("keeps active geometry topology through idle time and domain errors, disposing changed geometry", async () => {
    const first = processMesh(request, { reuseTopology: true });
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent!.positions).toEqual(positions);
    expect(worker.transfers).toHaveLength(1);
    worker.reply({ result: { kind: "report", diagnostics: {} } });
    await first;
    expect(worker.terminated).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(worker.terminated).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const retry = processMesh(request, { reuseTopology: true });
    expect(ProcessingWorkerDouble.creates).toBe(1);
    expect(worker.sent!.positions).toHaveLength(0);
    expect(worker.transfers).toHaveLength(0);
    worker.reply({ error: "Patch rejected" });
    await expect(retry).rejects.toThrow("Patch rejected");
    expect(worker.terminated).toBe(false);
    const changed = processMesh(
      { ...request, positions: positions.slice() },
      { reuseTopology: true },
    );
    expect(worker.terminated).toBe(true);
    const replacement = ProcessingWorkerDouble.latest;
    replacement.reply({ result: { kind: "report", diagnostics: {} } });
    await changed;
    retainProcessingGeometry(undefined);
    expect(replacement.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("adopts edited geometry without discarding its worker, but releases unrelated replacements", async () => {
    const edited = positions.slice();
    const first = processMesh(request, { reuseTopology: true });
    const worker = ProcessingWorkerDouble.latest;
    worker.reply({ result: { kind: "report", diagnostics: {} } });
    await first;
    const edit = processMesh(
      { kind: "scanEdit", action: "smoothSelected", positions },
      { reuseTopology: true },
    );
    const key = (worker.sent as ProcessingRequest & { geometryKey: number })
      .geometryKey;
    worker.reply({
      result: {
        kind: "scanEdit",
        diagnostics: {},
        scanEdit: { positions: edited, diagnostics: {} },
      },
    });
    await edit;
    retainProcessingGeometry(edited);
    expect(worker.terminated).toBe(false);
    const next = processMesh(
      { ...request, positions: edited },
      { reuseTopology: true },
    );
    expect(ProcessingWorkerDouble.latest).toBe(worker);
    expect(
      (worker.sent as ProcessingRequest & { geometryKey: number }).geometryKey,
    ).toBe(key);
    worker.reply({ result: { kind: "report", diagnostics: {} } });
    await next;
    retainProcessingGeometry(positions);
    expect(worker.terminated).toBe(true);
  });
  it("disposes a geometry removed during processing when its active operation finishes", async () => {
    const pending = processMesh(request, { reuseTopology: true });
    const worker = ProcessingWorkerDouble.latest;
    retainProcessingGeometry(undefined);
    expect(worker.terminated).toBe(false);
    worker.reply({ result: { kind: "report", diagnostics: {} } });
    await pending;
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reuses actual welded topology between inventory and selection, rebuilding changed geometry", async () => {
    const replies: any[] = [];
    const scope = {
      onmessage: null as ((event: { data: any }) => void) | null,
      postMessage: (message: any) => replies.push(message),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    scope.onmessage?.({
      data: {
        kind: "report",
        positions: positions.slice(),
        tolerance: 0.001,
        geometryKey: 1,
      },
    });
    replies.length = 0;
    scope.onmessage?.({
      data: {
        kind: "selectionMorphology",
        positions: new Float32Array(0),
        selection: new Uint8Array([1]),
        operation: "grow",
        geometryKey: 1,
      },
    });
    expect(replies.some((r) => r.stage === "Reusing mesh topology")).toBe(true);
    expect(replies.some((r) => r.stage === "Welding vertices")).toBe(false);
    replies.length = 0;
    scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: positions.slice(),
        geometryKey: 2,
      },
    });
    expect(replies.some((r) => r.stage === "Welding vertices")).toBe(true);
  });
  it("retains successor buffers after transfer and isolates failed edits from cached input geometry", async () => {
    const replies: any[] = [];
    const scope = {
      onmessage: null as ((event: { data: any }) => void) | null,
      postMessage: (message: any, transfers: Transferable[] = []) =>
        replies.push(structuredClone(message, { transfer: transfers })),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    scope.onmessage?.({
      data: {
        kind: "scanTools",
        positions: positions.slice(),
        operation: { kind: "scaleMesh", factor: 2 },
        geometryKey: 7,
      },
    });
    expect(replies.at(-1).result.positions[3]).toBe(2);
    replies.length = 0;
    // Incoming geometry bytes deliberately differ: the adopted worker copy is
    // authoritative for this same geometry key and must survive real transfer.
    scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: positions.slice(),
        geometryKey: 7,
      },
    });
    expect(replies.at(-1).result.scanEdit.inventory.components[0].area).toBe(2);
    replies.length = 0;
    scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "defeature",
        positions: positions.slice(),
        selection: new Uint8Array([1]),
        geometryKey: 7,
      },
    });
    expect(replies.at(-1).error).toBeTruthy();
    replies.length = 0;
    scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: positions.slice(),
        geometryKey: 7,
      },
    });
    expect(replies.at(-1).result.scanEdit.inventory.components[0].area).toBe(2);
    expect(replies.some((r) => r.stage === "Welding vertices")).toBe(false);
  });
  it("clones Scan Data reference surfaces and selection masks and releases its worker", async () => {
    const selection = new Uint8Array([1]);
    for (const operation of [
      { kind: "averageMesh" as const, targets: [positions], tolerance: 10 },
      { kind: "reduceNoise" as const, selection, selectionOnly: true },
    ]) {
      const pending = processMesh({ kind: "scanTools", positions, operation });
      const worker = ProcessingWorkerDouble.latest;
      expect(worker.sent?.kind).toBe("scanTools");
      if (worker.sent?.kind !== "scanTools")
        throw new Error("Expected scan tool request");
      expect(worker.sent.positions).not.toBe(positions);
      if (worker.sent.operation.kind === "averageMesh") {
        expect(worker.sent.operation.targets[0]).not.toBe(positions);
        expect(worker.transfers).toHaveLength(2);
      } else if (worker.sent.operation.kind === "reduceNoise") {
        expect(worker.sent.operation.selection).not.toBe(selection);
        expect(worker.transfers).toHaveLength(2);
      }
      worker.reply({
        result: {
          kind: "scanTools",
          positions: positions.slice(),
          diagnostics: { summary: "Done" },
        },
      });
      await pending;
      expect(worker.terminated).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(selection[0]).toBe(1);
    }
  });
  it("dispatches Scan Data geometry through the real worker and transfers its result", async () => {
    const replies: { message: any; transfers?: Transferable[] }[] = [];
    const scope = {
      onmessage: null as ((event: { data: ProcessingRequest }) => void) | null,
      postMessage: (message: any, transfers?: Transferable[]) =>
        replies.push({ message, transfers }),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    scope.onmessage?.({
      data: {
        kind: "scanTools",
        positions,
        operation: { kind: "scaleMesh", factor: 2 },
      },
    });
    const reply = replies.find((r) => r.message.result);
    expect(reply?.message.result.kind).toBe("scanTools");
    expect(reply?.message.result.positions[3]).toBe(2);
    expect(reply?.transfers).toEqual([reply?.message.result.positions.buffer]);
  });
  it("owns cloned scan inputs, selection and cutters without detaching geometry/history", async () => {
    const target = positions.slice(),
      selection = new Uint8Array([1]);
    const pending = processMesh({
      kind: "scanEdit",
      action: "split",
      positions,
      target,
      selection,
    });
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent?.kind).toBe("scanEdit");
    if (worker.sent?.kind !== "scanEdit")
      throw new Error("Expected scan edit request");
    expect(worker.sent.positions).not.toBe(positions);
    expect(worker.sent.target).not.toBe(target);
    expect(worker.sent.selection).not.toBe(selection);
    expect(worker.transfers).toHaveLength(3);
    const result: ProcessingResult = {
      kind: "scanEdit",
      diagnostics: {},
      scanEdit: { segments: [positions.slice()], diagnostics: {} },
    };
    worker.reply({ result });
    expect(await pending).toBe(result);
    expect(worker.terminated).toBe(true);
    expect(positions.length).toBe(9);
    expect(selection[0]).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("transfers nested scan edit outputs and supports real morphology worker dispatch", async () => {
    const replies: { message: unknown; transfers?: Transferable[] }[] = [];
    const scope = {
      onmessage: null as ((event: { data: ProcessingRequest }) => void) | null,
      postMessage: (message: unknown, transfers?: Transferable[]) =>
        replies.push({ message, transfers }),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "componentExtract",
        positions,
        indices: [0],
      },
    });
    const final = replies.at(-1)!;
    const result = (final.message as { result: ProcessingResult }).result;
    expect(result.scanEdit?.segments?.[0]).toEqual(positions);
    expect(final.transfers).toEqual([result.scanEdit!.segments![0].buffer]);
    scope.onmessage?.({
      data: {
        kind: "selectionMorphology",
        positions,
        selection: new Uint8Array([0]),
        operation: "boundary",
      },
    });
    expect(
      (replies.at(-1)!.message as { result: ProcessingResult }).result
        .selection,
    ).toEqual(new Uint8Array([1]));
  });
  it("clones selection seeds and transfers the actual worker result mask", async () => {
    const seeds = new Uint8Array([1]);
    const pending = processMesh({
      kind: "connectedSelection",
      positions,
      seeds,
      tolerance: 0.001,
      angleDegrees: 30,
    });
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.transfers).toHaveLength(2);
    expect((worker.sent as { seeds: Uint8Array }).seeds).not.toBe(seeds);
    worker.reply({
      result: {
        kind: "connectedSelection",
        selection: new Uint8Array([1]),
        diagnostics: { selectedTriangles: 1 },
      },
    });
    expect((await pending).selection).toEqual(seeds);
    expect(worker.terminated).toBe(true);
    const replies: { message: unknown; transfers?: Transferable[] }[] = [];
    const scope = {
      onmessage: null as ((event: { data: ProcessingRequest }) => void) | null,
      postMessage: (message: unknown, transfers?: Transferable[]) =>
        replies.push({ message, transfers }),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    scope.onmessage?.({
      data: {
        kind: "connectedSelection",
        positions,
        seeds,
        tolerance: 0.001,
        angleDegrees: 30,
      },
    });
    const final = replies.at(-1)!;
    const result = (final.message as { result: ProcessingResult }).result;
    expect(result.selection).toEqual(seeds);
    expect(final.transfers).toEqual([result.selection!.buffer]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("transfers cloned input while preserving the scene buffer and releases the successful worker", async () => {
    const pending = processMesh(request);
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent?.positions).not.toBe(positions);
    expect(Array.from(worker.sent!.positions)).toEqual(Array.from(positions));
    expect(worker.transfers).toEqual([
      (worker.sent!.positions as Float32Array).buffer,
    ]);
    const result: ProcessingResult = { kind: "report", diagnostics: {} };
    worker.reply({ result });
    expect(await pending).toBe(result);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(positions.byteLength).toBe(36);
  });
  it("clones both ICP buffers and releases on cancellation", async () => {
    const controller = new AbortController();
    const sourceTriangleMask = new Uint8Array([1]);
    const pending = processMesh(
      {
        kind: "icp",
        sourceTriangleMask,
        positions,
        target: positions,
        maxDistance: 1,
        maxIterations: 10,
        sampleSize: 3,
        targetSampleSize: 3,
        tolerance: 1e-5,
        trimFraction: 1,
      },
      { signal: controller.signal },
    );
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.transfers).toHaveLength(3);
    expect(
      (worker.sent as { sourceTriangleMask: Uint8Array }).sourceTriangleMask,
    ).not.toBe(sourceTriangleMask);
    expect([...sourceTriangleMask]).toEqual([1]);
    expect((worker.sent as { target: Float32Array }).target).not.toBe(
      positions,
    );
    controller.abort();
    await check;
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not create a worker when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      processMesh(request, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(ProcessingWorkerDouble.creates).toBe(0);
  });
  it("clones and transfers both global-registration inputs", async () => {
    const pending = processMesh({
      kind: "global",
      positions,
      target: positions,
      maxDistance: 10,
      maxIterations: 40,
      sampleSize: 100,
      targetSampleSize: 100,
      tolerance: 1e-5,
      trimFraction: 1,
    });
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.transfers).toHaveLength(2);
    expect((worker.sent as { target: Float32Array }).target.buffer).not.toBe(
      positions.buffer,
    );
    const result: ProcessingResult = {
      kind: "global",
      diagnostics: { globalCandidates: 24 },
    };
    worker.reply({ result });
    expect(await pending).toBe(result);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("renews inactivity on progress but always enforces the hard lease", async () => {
    const progress = vi.fn();
    const pending = processMesh(request, { onProgress: progress });
    const check = expect(pending).rejects.toThrow(/fifteen-minute/);
    const worker = ProcessingWorkerDouble.latest;
    for (let i = 0; i < 14; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      worker.reply({ progress: i / 15, stage: "Processing" });
    }
    await vi.advanceTimersByTimeAsync(60_000);
    await check;
    expect(progress).toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases a stalled worker and parse/decode/error paths", async () => {
    const stalled = processMesh(request);
    const check = expect(stalled).rejects.toThrow(/without progress/);
    await vi.advanceTimersByTimeAsync(120_000);
    await check;
    expect(ProcessingWorkerDouble.latest.terminated).toBe(true);
    const failed = processMesh(request);
    const failure = expect(failed).rejects.toThrow("Invalid topology");
    ProcessingWorkerDouble.latest.reply({ error: "Invalid topology" });
    await failure;
    const decode = processMesh(request);
    const decoded = expect(decode).rejects.toThrow(/decode/);
    ProcessingWorkerDouble.latest.onmessageerror?.();
    await decoded;
    const error = processMesh(request);
    const errored = expect(error).rejects.toThrow("Worker failed");
    ProcessingWorkerDouble.latest.onerror?.({ message: "Worker failed" });
    await errored;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases the worker on pagehide and removes its listener", async () => {
    const listeners = new Map<string, () => void>();
    const add = vi.fn((event: string, callback: () => void) =>
      listeners.set(event, callback),
    );
    const remove = vi.fn((event: string) => listeners.delete(event));
    vi.stubGlobal("addEventListener", add);
    vi.stubGlobal("removeEventListener", remove);
    const pending = processMesh(request);
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    listeners.get("pagehide")?.();
    await check;
    expect(remove).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(ProcessingWorkerDouble.latest.terminated).toBe(true);
    expect(listeners.size).toBe(0);
  });
  it("releases the worker on dispatch and callback failures or malformed replies", async () => {
    const throwing = new Float32Array(positions);
    throwing.slice = () => {
      throw new Error("Copy allocation failed");
    };
    await expect(
      processMesh({ ...request, positions: throwing }),
    ).rejects.toThrow("Copy allocation failed");
    expect(ProcessingWorkerDouble.latest.terminated).toBe(true);
    const callback = processMesh(request, {
      onProgress: () => {
        throw new Error("Progress failed");
      },
    });
    const callbackCheck = expect(callback).rejects.toThrow("Progress failed");
    ProcessingWorkerDouble.latest.reply({ progress: 0.5, stage: "test" });
    await callbackCheck;
    const malformed = processMesh(request);
    const malformedCheck = expect(malformed).rejects.toThrow(/Unexpected/);
    ProcessingWorkerDouble.latest.reply(null);
    await malformedCheck;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("runs actual worker segmentation and registration, transferring geometry without topology Maps", async () => {
    const replies: { message: unknown; transfers?: Transferable[] }[] = [];
    const scope = {
      onmessage: null as ((event: { data: ProcessingRequest }) => void) | null,
      postMessage: (message: unknown, transfers?: Transferable[]) =>
        replies.push({ message, transfers }),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    const triangles = new Float32Array([
      ...positions,
      5,
      0,
      0,
      6,
      0,
      0,
      5,
      1,
      0,
    ]);
    scope.onmessage?.({
      data: {
        kind: "segment",
        positions: triangles,
        tolerance: 0.001,
        angleDegrees: 25,
      },
    });
    const final = replies.at(-1)!;
    const result = (final.message as { result: ProcessingResult }).result;
    expect(result.segments).toHaveLength(2);
    expect(result.segments?.map((segment) => segment.length)).toEqual([9, 9]);
    expect(final.transfers).toHaveLength(2);
    expect(result.topology).toBeUndefined();
    replies.length = 0;
    scope.onmessage?.({
      data: {
        kind: "paired",
        positions,
        // Native registration requires landmarks spread at least 1 mm RMS from their fitted line.
        sourceLandmarks: [0, 0, 0, 10, 0, 0, 0, 10, 0],
        targetLandmarks: [2, 0, 0, 12, 0, 0, 2, 10, 0],
      },
    });
    const aligned = (replies.at(-1)!.message as { result: ProcessingResult })
      .result;
    expect(aligned.positions?.[0]).toBeCloseTo(2);
    expect(aligned.registration?.rms).toBeLessThan(1e-10);
    expect(replies.at(-1)!.transfers).toHaveLength(1);
    replies.length = 0;
    scope.onmessage?.({
      data: {
        kind: "global",
        positions,
        target: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
        maxDistance: 10,
        maxIterations: 10,
        sampleSize: 10,
        targetSampleSize: 10,
        tolerance: 1e-5,
        trimFraction: 1,
      },
    });
    const global = (replies.at(-1)!.message as { result: ProcessingResult })
      .result;
    expect(global.registration?.globalCandidates).toBe(24);
    expect(global.registration?.rms).toBeLessThan(1e-8);
    expect(global.positions).toHaveLength(9);
    replies.length = 0;
    const junction = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0,
      0, 0, 1,
    ]);
    scope.onmessage?.({
      data: {
        kind: "repair",
        positions: junction,
        tolerance: 0.000001,
        splitNonManifold: true,
        fillHoles: false,
        planarityTolerance: 0.01,
        maxPerimeter: 100,
      },
    });
    const repaired = (replies.at(-1)!.message as { result: ProcessingResult })
      .result;
    expect(repaired.segments).toHaveLength(3);
    expect(repaired.positions).toBeUndefined();
    expect(repaired.diagnostics.nonManifoldEdgesAfter).toBe(0);
    expect(repaired.diagnostics.nonManifoldVerticesAfter).toBe(0);
    expect(repaired.repairSheets).toHaveLength(3);
    expect(replies.at(-1)!.transfers).toHaveLength(3);
  });
});

it("copies and transfers indexed normals without detaching source or history buffers", async () => {
  const normals = new Float32Array([2, 0, 0, 0, 3, 0, 0, 0, 4]);
  const sourceIndexed = {
    vertices: positions,
    triangles: new Uint32Array([0, 1, 2]),
    normals,
  };
  const promise = processMesh({
    kind: "nativeRefine",
    positions,
    target: positions,
    sourceIndexed,
    targetIndexed: sourceIndexed,
    sampleBudget: 3,
    initialRadius: 3,
  });
  const worker = ProcessingWorkerDouble.latest;
  const sent = worker.sent as Extract<
    ProcessingRequest,
    { kind: "nativeRefine" }
  >;
  expect(sent.sourceIndexed.normals).toEqual(normals);
  expect(sent.sourceIndexed.normals).not.toBe(normals);
  expect(worker.transfers).toContain(
    (sent.sourceIndexed.normals as Float32Array).buffer,
  );
  expect(normals.byteLength).toBe(36);
  worker.reply({
    result: {
      kind: "nativeRefine",
      positions: positions.slice(),
      diagnostics: {},
    },
  });
  await promise;
});
