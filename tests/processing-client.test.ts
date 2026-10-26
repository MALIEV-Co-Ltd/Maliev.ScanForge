import {
  backgroundMeshPreparation,
  prepareMeshInBackground,
  stopBackgroundMeshPreparation,
} from "../src/scan-background-preparation";
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
import { getWorkingJobStatus } from "../src/working-job-status";
import { SCAN_DEFAULT_BUDGET_BYTES } from "../src/scan-geometry-source";
import nativeHoleCups from "./fixtures/hole-fill-observed-cups.json";
import { nativeStlTopology } from "../src/scan-native-stl-topology";

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

it("keeps explicit large diagnostics available after optional warmup admission declines", async () => {
  const triangles = SCAN_DEFAULT_BUDGET_BYTES / 512 + 1;
  const source = new Float32Array(triangles * 9);
  source.set(positions);
  source[source.length - 1] = 13;
  prepareMeshInBackground(source);
  await vi.advanceTimersByTimeAsync(500);
  expect(ProcessingWorkerDouble.creates).toBe(0);
  const leave = observeScanDiagnostics(source, () => {});
  const worker = ProcessingWorkerDouble.latest;
  expect(ProcessingWorkerDouble.creates).toBe(1);
  expect(worker.sent).toMatchObject({ kind: "report", tolerance: 0.001 });
  expect(worker.sent?.positions.length).toBe(source.length);
  expect(worker.sent?.positions.slice(0, 9)).toEqual(positions);
  expect(worker.sent?.positions[source.length - 1]).toBe(13);
  worker.reply({
    result: { kind: "report", topology: { triangles }, diagnostics: {} },
  });
  await Promise.resolve();
  await Promise.resolve();
  leave();
});

it("borrows immutable shared positions only for speculative retained reports", async () => {
  const source = new Float32Array(new SharedArrayBuffer(positions.byteLength));
  source.set(positions);
  prepareMeshInBackground(source);
  try {
    await vi.advanceTimersByTimeAsync(500);
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent?.positions).toBe(source);
    expect(worker.sent).toMatchObject({
      kind: "report",
      borrowedReportSource: true,
    });
    expect(worker.transfers).toEqual([]);
    const clone = structuredClone(worker.sent!);
    expect(clone.positions).toEqual(source);
    expect(clone.positions).not.toBe(source);
    expect(
      clone.positions instanceof Float32Array &&
        clone.positions.buffer instanceof SharedArrayBuffer,
    ).toBe(true);
  } finally {
    stopBackgroundMeshPreparation();
    await Promise.resolve();
    await Promise.resolve();
  }
});

it.each(["shared", "ordinary", "array"])(
  "keeps default report ownership private for %s positions",
  async (backing) => {
    const source =
      backing === "array"
        ? Array.from(positions)
        : backing === "shared"
          ? new Float32Array(new SharedArrayBuffer(positions.byteLength))
          : positions.slice();
    if (source instanceof Float32Array) source.set(positions);
    const pending = processMesh(
      { ...request, positions: source },
      { reuseTopology: true },
    );
    await Promise.resolve();
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent?.positions).not.toBe(source);
    expect(worker.sent?.positions).toEqual(source);
    expect(worker.sent).not.toHaveProperty("borrowedReportSource");
    if (worker.sent?.positions instanceof Float32Array)
      expect(worker.sent.positions.buffer).toBeInstanceOf(ArrayBuffer);
    worker.reply({ result: { kind: "report", diagnostics: {} } });
    await pending;
  },
);

it.each(["nonreport", "unretained", "ordinary", "array", "unavailable"])(
  "does not borrow an opted-in source for %s work",
  async (mode) => {
    const shared = new Float32Array(
      new SharedArrayBuffer(positions.byteLength),
    );
    shared.set(positions);
    const source =
      mode === "array"
        ? Array.from(positions)
        : mode === "ordinary"
          ? positions.slice()
          : shared;
    if (mode === "unavailable") vi.stubGlobal("SharedArrayBuffer", undefined);
    const submitted: ProcessingRequest =
      mode === "nonreport"
        ? { kind: "scanEdit", action: "inventory", positions: source }
        : { ...request, positions: source };
    const pending = processMesh(submitted, {
      reuseTopology: mode !== "unretained",
      borrowReadonlyReportSource: true,
    });
    await Promise.resolve();
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent?.positions).not.toBe(source);
    expect(worker.sent?.positions).toEqual(source);
    expect(worker.sent).not.toHaveProperty("borrowedReportSource");
    worker.reply({ result: { kind: submitted.kind, diagnostics: {} } });
    await pending;
  },
);
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", ProcessingWorkerDouble);
  ProcessingWorkerDouble.creates = 0;
});
afterEach(() => {
  stopBackgroundMeshPreparation();
  releaseProcessingSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("processing worker resource ownership", () => {
  it.each(["complete", "error", "cancel"])(
    "publishes shared job progress and clears it on %s",
    async (end) => {
      const controller = new AbortController(),
        onProgress = vi.fn();
      const pending = processMesh(
        { kind: "scanEdit", action: "defeature", positions },
        { signal: controller.signal, onProgress },
      );
      const owned = ProcessingWorkerDouble.latest;
      expect(getWorkingJobStatus()).toBe("Defeature…");
      owned.reply({ progress: 0.65, stage: "Reconstructing surface" });
      expect(getWorkingJobStatus()).toBe("Reconstructing surface · 65%");
      expect(onProgress).toHaveBeenCalledWith(0.65, "Reconstructing surface");
      if (end === "complete") {
        owned.reply({ result: { kind: "scanEdit", diagnostics: {} } });
        await pending;
      } else if (end === "error") {
        owned.reply({ error: "test failure" });
        await expect(pending).rejects.toThrow("test failure");
      } else {
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      }
      expect(getWorkingJobStatus()).toBe("");
    },
  );
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
  it("copies trusted scan indices once per retained source and never transfers authored buffers", async () => {
    const sourceIndexed = nativeStlTopology(positions);
    const input = {
      kind: "scanEdit",
      action: "inventory",
      positions,
      sourceIndexed,
    } as const;
    const first = processMesh(input, { reuseTopology: true });
    const worker = ProcessingWorkerDouble.latest;
    expect(worker.sent).toMatchObject({ kind: "scanEdit", sourceIndexed });
    if (worker.sent?.kind !== "scanEdit") throw new Error("Expected scan edit");
    expect(worker.sent.sourceIndexed!.vertices).not.toBe(
      sourceIndexed.vertices,
    );
    expect(worker.sent.sourceIndexed!.triangles).not.toBe(
      sourceIndexed.triangles,
    );
    expect(worker.transfers).not.toContain(
      (sourceIndexed.vertices as Float32Array).buffer,
    );
    expect(worker.transfers).not.toContain(
      (sourceIndexed.triangles as Uint32Array).buffer,
    );
    worker.reply({
      result: {
        kind: "scanEdit",
        diagnostics: {},
        scanEdit: { diagnostics: {} },
      },
    });
    await first;
    const next = processMesh(input, { reuseTopology: true });
    expect(ProcessingWorkerDouble.latest).toBe(worker);
    expect(worker.sent).not.toHaveProperty("sourceIndexed");
    worker.reply({
      result: {
        kind: "scanEdit",
        diagnostics: {},
        scanEdit: { diagnostics: {} },
      },
    });
    await next;
    expect(sourceIndexed.vertices.length).toBe(9);
    expect(sourceIndexed.triangles.length).toBe(3);
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
    await scope.onmessage?.({
      data: {
        kind: "report",
        positions: positions.slice(),
        tolerance: 0.001,
        geometryKey: 1,
      },
    });
    replies.length = 0;
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: positions.slice(),
        geometryKey: 7,
      },
    });
    expect(replies.at(-1).result.scanEdit.inventory.components[0].area).toBe(2);
    replies.length = 0;
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
  it("preserves imported native vertex identities when filling a hole after a generic inventory warmup", async () => {
    const sample = nativeHoleCups.cases.find((row) => row.rimEdges === 40)!;
    const source = new Float32Array(
      sample.faces.flatMap((face) => face.flatMap((id) => sample.vertices[id])),
    );
    const replies: any[] = [];
    const scope = {
      onmessage: null as ((event: { data: any }) => void) | null,
      postMessage: (message: any, transfers: Transferable[] = []) =>
        replies.push(structuredClone(message, { transfer: transfers })),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    await scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: source.slice(),
        geometryKey: 72,
      },
    });
    replies.length = 0;
    await scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "fillHoles",
        positions: new Float32Array(0),
        sourceIndexed: nativeStlTopology(source),
        indices: [0],
        algorithm: "tangent",
        geometryKey: 72,
      },
    });
    expect(replies.at(-1).error).toBeUndefined();
    expect(replies.at(-1).result.scanEdit.positions).toEqual(
      new Float32Array(sample.output.flat(2)),
    );
    expect(source.length / 9).toBe(120);
  });
  it("keeps the canonical source after an empty hole fill without publishing a duplicate buffer", async () => {
    const replies: any[] = [];
    const scope = {
      onmessage: null as ((event: { data: any }) => void) | null,
      postMessage: (message: any, transfers: Transferable[] = []) =>
        replies.push(structuredClone(message, { transfer: transfers })),
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/processing-worker");
    await scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: positions.slice(),
        geometryKey: 71,
      },
    });
    const inventory = replies.at(-1).result.scanEdit.inventory;
    replies.length = 0;
    await scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "fillHoles",
        indices: [],
        algorithm: "flat",
        positions: new Float32Array(0),
        geometryKey: 71,
      },
    });
    expect(replies.at(-1).result.scanEdit.diagnostics.changed).toBe(false);
    expect(replies.at(-1).result.scanEdit.positions).toBeUndefined();
    replies.length = 0;
    await scope.onmessage?.({
      data: {
        kind: "scanEdit",
        action: "inventory",
        positions: new Float32Array(0),
        geometryKey: 71,
      },
    });
    expect(replies.at(-1).result.scanEdit.inventory).toEqual(inventory);
    expect(replies.some((row) => row.stage === "Welding vertices")).toBe(false);
  });
  it("clones Scan Data reference surfaces and selection masks and releases its worker", async () => {
    const selection = new Uint8Array([1]);
    for (const operation of [
      {
        kind: "averageMesh" as const,
        targets: [positions],
        tolerance: 10,
        targetTopology: [
          { vertices: positions, triangles: new Uint32Array([0, 1, 2]) },
        ],
        sourceTopology: {
          vertices: positions,
          triangles: new Uint32Array([0, 1, 2]),
        },
      },
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
        expect(worker.sent.operation.targetTopology?.[0]?.vertices).not.toBe(
          positions,
        );
        if (operation.kind !== "averageMesh")
          throw new Error("Expected average");
        expect(worker.sent.operation.targetTopology?.[0]?.triangles).not.toBe(
          operation.targetTopology[0].triangles,
        );
        expect(worker.sent.operation.sourceTopology?.vertices).not.toBe(
          positions,
        );
        expect(worker.sent.operation.sourceTopology?.triangles).not.toBe(
          operation.sourceTopology.triangles,
        );
        expect(worker.transfers).toHaveLength(6);
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
  it("clones reconstruction indices without detaching canonical topology", async () => {
    const topology = {
      vertices: positions,
      triangles: new Uint32Array([0, 1, 2]),
    };
    const pending = processMesh({
      kind: "scanTools",
      positions,
      operation: { kind: "repolygonize", sourceTopology: topology },
    });
    const worker = ProcessingWorkerDouble.latest;
    const sent = worker.sent;
    worker.reply({
      result: {
        kind: "scanTools",
        positions: positions.slice(),
        diagnostics: { summary: "Done" },
      },
    });
    await pending;
    if (sent?.kind !== "scanTools" || sent.operation.kind !== "repolygonize")
      throw Error("Expected reconstruction");
    expect(sent.operation.sourceTopology?.vertices).not.toBe(positions);
    expect(sent.operation.sourceTopology?.triangles).not.toBe(
      topology.triangles,
    );
    expect(topology.triangles).toEqual(new Uint32Array([0, 1, 2]));
    expect(worker.terminated).toBe(true);
  });
  it("rejects oversized Average carriers before constructing or copying to a worker", async () => {
    const before = ProcessingWorkerDouble.creates;
    await expect(
      processMesh({
        kind: "scanTools",
        positions: { length: 27_000_000 } as Float32Array,
        operation: { kind: "averageMesh", targets: [positions] },
      }),
    ).rejects.toThrow(/limit/);
    await expect(
      processMesh({
        kind: "scanTools",
        positions,
        operation: {
          kind: "averageMesh",
          targets: [positions],
          sourceTopology: {
            vertices: { length: 27_000_001 } as Float32Array,
            triangles: [0, 1, 2],
          },
        },
      }),
    ).rejects.toThrow(/Indexed reference/);
    expect(ProcessingWorkerDouble.creates).toBe(before);
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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
    await scope.onmessage?.({
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

it("retains source topology through read-only bridge previews and adopts it only on commit", async () => {
  const replies: any[] = [];
  const scope = {
    onmessage: null as any,
    postMessage: (message: unknown) => replies.push(message),
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("../src/processing-worker");
  // A square annulus with one inner and one outer boundary.
  const p = (i: number, r: number) => [
    Math.cos((i * Math.PI) / 2) * r,
    Math.sin((i * Math.PI) / 2) * r,
    0,
  ];
  const coordinates: number[] = [];
  for (let i = 0; i < 4; i++)
    coordinates.push(
      ...p(i, 1),
      ...p(i, 2),
      ...p(i + 1, 2),
      ...p(i, 1),
      ...p(i + 1, 2),
      ...p(i + 1, 1),
    );
  const source = Float32Array.from(coordinates),
    base = {
      kind: "scanEdit",
      positions: source,
      geometryKey: 9123,
      tolerance: 0.001,
    };
  await scope.onmessage({ data: { ...base, action: "inventory" } });
  const before = replies.at(-1).result.scanEdit.inventory;
  const bridge = {
    ...base,
    action: "fillHoles",
    mode: "bridge",
    indices: [0],
    start: 0,
    end: 2,
    algorithm: "flat",
  };
  // Pick the smaller inner rim regardless of inventory ordering.
  bridge.indices = [before.boundaries.findIndex((b: any) => b.diameter < 3)];
  replies.length = 0;
  await scope.onmessage({ data: { ...bridge, previewOnly: true } });
  expect(replies.at(-1).result?.scanEdit.diagnostics.filledHoles).toBe(1);
  replies.length = 0;
  await scope.onmessage({ data: { ...base, action: "inventory" } });
  expect(replies.at(-1).result.scanEdit.inventory).toEqual(before);
  expect(
    replies.some(
      (r) => r.stage === "Welding vertices" || r.stage === "Building topology",
    ),
  ).toBe(false);
  replies.length = 0;
  await scope.onmessage({ data: bridge });
  const committed = replies.at(-1).result.scanEdit.positions;
  expect(committed.length).toBeGreaterThan(source.length);
  replies.length = 0;
  await scope.onmessage({
    data: { ...base, action: "inventory", positions: committed },
  });
  expect(replies.at(-1).result.scanEdit.inventory.boundaries).toHaveLength(
    before.boundaries.length - 1,
  );
  expect(
    replies.some(
      (r) => r.stage === "Welding vertices" || r.stage === "Building topology",
    ),
  ).toBe(false);
});

it("hands background preparation to a selected-facet edit without restarting the worker", async () => {
  const source = positions.slice();
  prepareMeshInBackground(source);
  await vi.advanceTimersByTimeAsync(500);
  const owned = ProcessingWorkerDouble.latest;
  expect(owned.sent?.kind).toBe("report");
  const editing = processMesh(
    {
      kind: "scanEdit",
      action: "defeature",
      positions: source,
      selection: new Uint8Array([1]),
      tolerance: 0.001,
    },
    { reuseTopology: true },
  );
  expect(ProcessingWorkerDouble.creates).toBe(1);
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
  await Promise.resolve();
  expect(ProcessingWorkerDouble.latest).toBe(owned);
  expect(owned.sent?.kind).toBe("scanEdit");
  expect(owned.sent?.positions.length).toBe(0);
  owned.reply({
    result: {
      kind: "scanEdit",
      diagnostics: {},
      scanEdit: { diagnostics: {} },
    },
  });
  await editing;
});

describe("foreground mesh readiness", () => {
  it.each([true, false])(
    "releases speculative topology before a topology-free tool (reuseTopology=%s)",
    async (reuseTopology) => {
      const source = positions.slice();
      prepareMeshInBackground(source);
      await vi.advanceTimersByTimeAsync(500);
      const background = ProcessingWorkerDouble.latest;
      expect(background.sent?.kind).toBe("report");
      const editing = processMesh(
        {
          kind: "scanTools",
          positions: source,
          operation: { kind: "scaleMesh", factor: 2 },
        },
        { reuseTopology },
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(background.terminated).toBe(true);
      expect(backgroundMeshPreparation(source).phase).toBe("inactive");
      const foreground = ProcessingWorkerDouble.latest;
      expect(foreground).not.toBe(background);
      expect(foreground.sent?.kind).toBe("scanTools");
      expect(foreground.sent?.positions).toEqual(source);
      expect(ProcessingWorkerDouble.creates).toBe(2);
      foreground.reply({ result: { kind: "scanTools", diagnostics: {} } });
      await editing;
    },
  );

  it("keeps requested diagnostics when a topology-free tool follows", async () => {
    const source = positions.slice();
    prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const background = ProcessingWorkerDouble.latest;
    const leave = observeScanDiagnostics(source, () => {});
    const editing = processMesh(
      {
        kind: "scanTools",
        positions: source,
        operation: { kind: "scaleMesh", factor: 2 },
      },
      { reuseTopology: true },
    );
    await Promise.resolve();
    expect(background.terminated).toBe(false);
    expect(background.sent?.kind).toBe("report");
    background.reply({ result: { kind: "report", diagnostics: {} } });
    await Promise.resolve();
    await Promise.resolve();
    expect(background.sent?.kind).toBe("scanTools");
    background.reply({ result: { kind: "scanTools", diagnostics: {} } });
    await editing;
    leave();
  });

  it("never interrupts a speculative source to run an already cancelled tool", async () => {
    const source = positions.slice();
    prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const background = ProcessingWorkerDouble.latest;
    const controller = new AbortController();
    controller.abort();
    await expect(
      processMesh(
        {
          kind: "scanTools",
          positions: source,
          operation: { kind: "scaleMesh", factor: 2 },
        },
        { reuseTopology: true, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(background.terminated).toBe(false);
    stopBackgroundMeshPreparation();
    await Promise.resolve();
    await Promise.resolve();
    expect(background.terminated).toBe(true);
  });

  it("preserves preparation promised to an already queued topology consumer", async () => {
    const source = positions.slice();
    prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const background = ProcessingWorkerDouble.latest;
    const inventory = processMesh(
      { kind: "scanEdit", action: "inventory", positions: source },
      { reuseTopology: true },
    );
    const editing = processMesh(
      {
        kind: "scanTools",
        positions: source,
        operation: { kind: "scaleMesh", factor: 2 },
      },
      { reuseTopology: true },
    );
    await Promise.resolve();
    expect(background.terminated).toBe(false);
    background.reply({ result: { kind: "report", diagnostics: {} } });
    await Promise.resolve();
    await Promise.resolve();
    expect(background.sent?.kind).toBe("scanEdit");
    background.reply({ result: { kind: "scanEdit", diagnostics: {} } });
    await inventory;
    expect(background.sent?.kind).toBe("scanTools");
    background.reply({ result: { kind: "scanTools", diagnostics: {} } });
    await editing;
    expect(ProcessingWorkerDouble.creates).toBe(1);
  });
});

it.each([false, true])(
  "retains only immutable shared paired connectivity (shared=%s)",
  async (shared) => {
    const triangles = shared
      ? new Uint32Array(new SharedArrayBuffer(12))
      : new Uint32Array(3);
    triangles.set([0, 1, 2]);
    const pending = processMesh({
      kind: "paired",
      positions,
      sourceIndexed: { vertices: positions, triangles },
      sourceLandmarks: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      targetLandmarks: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    });
    const worker = ProcessingWorkerDouble.latest;
    const sent = worker.sent as Extract<ProcessingRequest, { kind: "paired" }>;
    expect(sent.sourceIndexed!.triangles === triangles).toBe(shared);
    if (shared) expect(worker.transfers).not.toContain(triangles.buffer);
    else
      expect(worker.transfers).toContain(
        (sent.sourceIndexed!.triangles as Uint32Array).buffer,
      );
    expect(triangles).toEqual(new Uint32Array([0, 1, 2]));
    worker.reply({
      result: { kind: "paired", positions: positions.slice(), diagnostics: {} },
    });
    await pending;
  },
);
