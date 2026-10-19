import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runGlobalScanController } from "../src/scan-global-controller-core";
import { runSharedGlobalController } from "../src/scan-global-controller-client";
import {
  capabilities,
  type Start,
  type WorkerReply,
} from "../src/scan-global-controller-protocol";
import * as storage from "../src/scan-global-query-storage";
import {
  retryOwnedWorkerStops,
  ownedWorkerCleanupPending,
  retainNestedControllerCleanup,
} from "../src/scan-global-worker-cleanup";
import { refineGlobalScanSet } from "../src/scan-global-registration";
import type { Entity } from "../src/types";
const admission = vi.hoisted(() => ({
  reject: false,
  prepared: 0,
  reverse: false,
}));
vi.mock("../src/scan-global-controller-core", () => ({
  runGlobalScanController: vi.fn(async () => undefined),
}));
vi.mock("../src/scan-global-query-pool", () => ({
  globalQueryPoolAdmission: () => 1,
  globalCoordinatorQueryAdmission: vi.fn(() => {
    if (admission.reject) throw Error("admission");
    return 1;
  }),
}));
vi.mock("../src/datum-transform-pool", () => ({
  createDatumTransformExecutor: () => ({
    transformScanStages: async (entity: Entity) => ({
      entity,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      execution: {},
    }),
    close() {},
  }),
}));
vi.mock("../src/scan-global-scene-client", () => ({
  prepareGlobalScene: async (input: ReturnType<typeof sceneInput>) => {
    admission.prepared++;
    const sources = input.scans.map((scan) => ({
      id: scan.id,
      eligible: scan.id !== "excluded",
      labels: new Uint32Array(3),
      selected: [[0, 1, 2]],
      sampled: 3,
      spatialFlags: new Uint32Array(1),
    }));
    return {
      grid: new Uint32Array(1),
      common: { unrelated: true },
      sources: admission.reverse ? sources.reverse() : sources,
    };
  },
  preparedGlobalQueryScans: (
    input: ReturnType<typeof sceneInput>,
    scene: {
      sources: { id: string; eligible: boolean; labels: Uint32Array }[];
    },
  ) => ({
    scans: scene.sources
      .filter((source) => source.eligible)
      .map((source) => ({
        ...input.scans.find((scan) => scan.id === source.id)!,
        geometry: {
          ...input.scans.find((scan) => scan.id === source.id)!.geometry,
          labels: source.labels,
        },
      })),
  }),
}));
const trace: string[] = [];
const frame = () => [1, -0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function sceneInput() {
  const points = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0);
  const normals = new Float32Array(9);
  const triangles = Uint32Array.of(0, 1, 2);
  return {
    radius: 5,
    spacing: 12,
    budget: 1000,
    mask: 1,
    clocks: [[1], [2]],
    scans: ["a", "b"].map((id) => ({
      id,
      geometry: {
        points,
        normals,
        rawTargetIds: new Uint32Array(),
        targetMeshes: [{ vertices: points, triangles }],
      },
    })),
  };
}
class ControllerWorker {
  static instances: ControllerWorker[] = [];
  static behavior = "normal";
  onmessage: ((event: { data: WorkerReply }) => void) | null = null;
  onerror: unknown;
  onmessageerror: unknown;
  start?: Start;
  terminated = false;
  terminateCalls = 0;
  constructor() {
    ControllerWorker.instances.push(this);
    if (ControllerWorker.behavior !== "no-ready")
      queueMicrotask(() => {
        const capability = capabilities();
        if (ControllerWorker.behavior === "capability") capability.memory = 999;
        this.onmessage?.({ data: { kind: "ready", capability } });
      });
  }
  terminate() {
    this.terminateCalls++;
    this.terminated = true;
    trace.push("terminate-request");
    if (ControllerWorker.behavior === "termination-error")
      throw Error("terminate failed");
  }
  postMessage(data: Start | { kind: "abort"; runId: number }) {
    if (data.kind === "abort") {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            kind: "failed",
            runId: data.runId,
            error: "worker abort",
            childrenCloseRequested: true,
            childCleanup: [],
          },
        }),
      );
      return;
    }
    this.start = data;
    trace.push("start");
    queueMicrotask(() => this.run());
  }
  run() {
    const start = this.start!;
    let sequence = 0;
    const states = start.input.scans.map((scan) => ({
      id: scan.id,
      pointCount: 3,
      matrix: frame(),
      mean: NaN,
      std: Infinity,
      converged: true,
      stable: true,
    }));
    const rpc = (
      request: Partial<Extract<WorkerReply, { kind: "rpc" }>> & {
        action: "check" | "clock" | "pass" | "progress";
      },
    ) => {
      const id = ++sequence;
      this.onmessage?.({
        data: { kind: "rpc", runId: start.runId, requestId: id, ...request },
      });
      const words = new Int32Array(start.control);
      if (Atomics.load(words, 2))
        expect([id, -1]).toContain(Atomics.load(words, 0));
      else expect(Atomics.load(words, 0)).toBe(id);
      trace.push("ack:" + request.action);
      return Atomics.load(new Int32Array(start.control), 2) === 0;
    };
    trace.push("pool-ready");
    if (!rpc({ action: "check" })) return;
    if (
      !rpc({
        action: "progress",
        fraction: 0.2,
        stage: "Refining global scan poses",
      })
    )
      return;
    trace.push("native-clock-expression");
    if (!rpc({ action: "clock" })) return;
    const seed = new Float64Array(start.control, 16, 1)[0];
    if (!Number.isInteger(seed) || seed < -0x80000000 || seed > 0xffffffff) {
      this.onmessage?.({
        data: {
          kind: "failed",
          runId: start.runId,
          error: "Invalid global outer tolerance or clock seed.",
          childrenCloseRequested: true,
          childCleanup: [],
        },
      });
      return;
    }
    if (
      !rpc({ action: "check" }) ||
      !rpc({ action: "pass", pass: 0, ordered: states }) ||
      !rpc({ action: "check" })
    )
      return;
    if (ControllerWorker.behavior === "duplicate") {
      this.onmessage?.({
        data: {
          kind: "rpc",
          runId: start.runId,
          requestId: sequence,
          action: "check",
        },
      });
      return;
    }
    if (
      !rpc({
        action: "progress",
        fraction: 0.2,
        stage: "Refining global scan poses",
      })
    )
      return;
    trace.push("children-close-request");
    const result = {
      mode: start.mode,
      queries: 1,
      queryWorkers: 1,
      localResults: [],
      outer: {
        passes: 1,
        seed,
        order: ["a", "b"],
        states,
        gaugeId: "a",
        applications: ["a", "b", "a", "b"].map((id) => ({
          id,
          matrix: frame(),
        })),
      },
    };
    if (ControllerWorker.behavior === "stale")
      this.onmessage?.({
        data: {
          kind: "failed",
          runId: start.runId + 1,
          error: "stale",
          childrenCloseRequested: true,
          childCleanup: [],
        },
      });
    if (ControllerWorker.behavior === "geometry")
      Object.assign(result, { geometry: new SharedArrayBuffer(32) });
    this.onmessage?.({
      data: {
        kind: "result",
        runId: start.runId,
        result,
        childrenCloseRequested: true,
      },
    });
  }
}
beforeEach(() => {
  trace.length = 0;
  admission.reject = false;
  admission.prepared = 0;
  admission.reverse = false;
  ControllerWorker.behavior = "normal";
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
  vi.stubGlobal("Worker", ControllerWorker);
});
afterEach(() => {
  ControllerWorker.behavior = "normal";
  retryOwnedWorkerStops();
  ControllerWorker.instances.length = 0;
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("samples parent clock only after readiness and native boundary, preserves fields/aliases and closes before Apply", async () => {
  const source = sceneInput(),
    before = source.scans[0].geometry.points.slice();
  const clock = vi.fn(() => {
    trace.push("parent-clock");
    return -0;
  });
  vi.spyOn(Atomics, "wait").mockImplementation(() => {
    throw Error("Parent must never wait");
  });
  const result = await runSharedGlobalController(
    source,
    source,
    {
      clock,
      check: () => {
        trace.push("check");
      },
      onPass: () => {
        trace.push("pass");
      },
      onProgress: () => {
        trace.push("progress");
      },
    },
    "target-average",
    5,
  );
  trace.push("apply");
  expect(clock).toHaveBeenCalledTimes(1);
  expect(Object.is(result!.outer.seed, -0)).toBe(true);
  expect(trace.indexOf("pool-ready")).toBeLessThan(
    trace.indexOf("parent-clock"),
  );
  expect(trace.indexOf("native-clock-expression")).toBeLessThan(
    trace.indexOf("parent-clock"),
  );
  expect(trace.indexOf("children-close-request")).toBeLessThan(
    trace.indexOf("terminate-request"),
  );
  expect(trace.indexOf("terminate-request")).toBeLessThan(
    trace.indexOf("apply"),
  );
  const worker = ControllerWorker.instances[0];
  expect(worker.terminated).toBe(true);
  expect(worker.onmessage).toBeNull();
  const packet = worker.start!;
  expect(packet.input.spacing).toBe(12);
  expect(packet.input.clocks).toBeUndefined();
  expect(packet.input.mask).toBe(1);
  expect(packet.input.scans[0].geometry.points).toBe(
    packet.input.scans[1].geometry.points,
  );
  expect(packet.input.scans[0].geometry.points).toBe(
    packet.input.scans[0].geometry.targetMeshes![0].vertices,
  );
  expect(packet.externalReservedBytes).toBe(
    storage.globalQueryExternalInputBytes(source) + 2 * 3 * 4,
  );
  expect(source.scans[0].geometry.points).toEqual(before);
});
it.each(["check", "clock", "onPass", "onProgress"] as const)(
  "preserves original parent %s exception identity",
  async (which) => {
    const sentinel = Error("parent callback identity");
    const source = sceneInput();
    await expect(
      runSharedGlobalController(
        source,
        source,
        {
          [which]: () => {
            throw sentinel;
          },
        },
        "target-average",
        5,
      ),
    ).rejects.toBe(sentinel);
    expect(ControllerWorker.instances[0].terminated).toBe(true);
  },
);
it("aborts via shared flag/notify and keeps the parent's abort reason", async () => {
  const source = sceneInput(),
    abort = new AbortController(),
    reason = Error("cancel identity");
  await expect(
    runSharedGlobalController(
      source,
      source,
      {
        signal: abort.signal,
        clock: () => 1,
        onPass: () => abort.abort(reason),
      },
      "target-average",
      5,
    ),
  ).rejects.toBe(reason);
  expect(
    Atomics.load(
      new Int32Array(ControllerWorker.instances[0].start!.control),
      2,
    ),
  ).toBe(1);
});
it.each(["duplicate", "geometry", "termination-error"])(
  "rejects %s without publishing a result",
  async (behavior) => {
    ControllerWorker.behavior = behavior;
    const source = sceneInput();
    await expect(
      runSharedGlobalController(
        source,
        source,
        { clock: () => 1 },
        "target-average",
        5,
      ),
    ).rejects.toThrow();
    expect(ControllerWorker.instances[0].terminated).toBe(true);
  },
);
it("ignores stale run IDs while preserving the current result", async () => {
  ControllerWorker.behavior = "stale";
  const source = sceneInput();
  expect(
    (await runSharedGlobalController(
      source,
      source,
      { clock: () => 1 },
      "target-average",
      5,
    ))!.outer.seed,
  ).toBe(1);
});
it("capability mismatch falls back before allocating shared geometry", async () => {
  ControllerWorker.behavior = "capability";
  const copy = vi.spyOn(storage, "shareGlobalQueryInput"),
    source = sceneInput();
  expect(
    await runSharedGlobalController(source, source, {}, "target-average", 5),
  ).toBeUndefined();
  expect(copy).not.toHaveBeenCalled();
  expect(ControllerWorker.instances[0].start).toBeUndefined();
  expect(admission.prepared).toBe(1);
  expect(vi.mocked(runGlobalScanController).mock.lastCall?.[5]).toBeDefined();
});
it("shares only eligible query scans and trims every prepared geometry-independent field", async () => {
  const source = sceneInput();
  const excludedPoints = new Float32Array(18);
  source.scans.push({
    ...source.scans[0],
    id: "excluded",
    geometry: {
      ...source.scans[0].geometry,
      points: excludedPoints,
      normals: new Float32Array(18),
    },
  });
  await runSharedGlobalController(
    source,
    source,
    { clock: () => 1 },
    "target-average",
    5,
  );
  const packet = ControllerWorker.instances[0].start!;
  expect(packet.input.scans.map((scan) => scan.id)).toEqual(["a", "b"]);
  expect(Object.keys(packet.preparedScene)).toEqual(["sources"]);
  for (const prepared of packet.preparedScene.sources)
    expect(Object.keys(prepared).sort()).toEqual([
      "eligible",
      "id",
      "labels",
      "sampled",
      "selected",
    ]);
  expect(packet.externalReservedBytes).toBe(
    storage.globalQueryExternalInputBytes(source) + 24,
  );
  expect(packet.input.clocks).toBeUndefined();
  expect(packet.routedInput.clocks).toBeUndefined();
});
it("preserves distinct original outer order and prepared query order", async () => {
  admission.reverse = true;
  const source = sceneInput();
  await runSharedGlobalController(
    source,
    source,
    { clock: () => 1 },
    "target-average",
    5,
  );
  const packet = ControllerWorker.instances[0].start!;
  expect(packet.input.scans.map((scan) => scan.id)).toEqual(["a", "b"]);
  expect(packet.routedInput.scans.map((scan) => scan.id)).toEqual(["b", "a"]);
  expect(packet.preparedScene.sources.map((scan) => scan.id)).toEqual([
    "b",
    "a",
  ]);
});
it("unadmitted, nonWorker, nonisolated and explicitly direct routes create no worker or copy", async () => {
  const source = sceneInput(),
    copy = vi.spyOn(storage, "shareGlobalQueryInput");
  admission.reject = true;
  expect(
    await runSharedGlobalController(source, source, {}, "target-average", 5),
  ).toBeUndefined();
  admission.reject = false;
  expect(
    await runSharedGlobalController(
      source,
      source,
      { controllerIsolation: false },
      "target-average",
      5,
    ),
  ).toBeUndefined();
  vi.stubGlobal("crossOriginIsolated", false);
  expect(
    await runSharedGlobalController(source, source, {}, "target-average", 5),
  ).toBeUndefined();
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("Worker", undefined);
  expect(
    await runSharedGlobalController(source, source, {}, "target-average", 5),
  ).toBeUndefined();
  expect(copy).not.toHaveBeenCalled();
  expect(ControllerWorker.instances).toHaveLength(0);
});
it("startup deadline releases timers/worker without touching the running application", async () => {
  vi.useFakeTimers();
  ControllerWorker.behavior = "no-ready";
  const source = sceneInput();
  const promise = runSharedGlobalController(
    source,
    source,
    {},
    "target-average",
    5,
  )!;
  const rejected = expect(promise).rejects.toThrow("startup timed out");
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(ControllerWorker.instances[0].terminated).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
const publicEntities = (source: ReturnType<typeof sceneInput>) =>
  source.scans.map(
    (scan) =>
      ({
        id: scan.id,
        kind: "mesh",
        positions: scan.geometry.points,
      }) as Entity,
  );
it("the existing shared registration command recovers a transient parent stop failure before new preparation", async () => {
  const source = sceneInput();
  ControllerWorker.behavior = "termination-error";
  await expect(
    refineGlobalScanSet(source, publicEntities(source), { clock: () => 1 }),
  ).rejects.toThrow("termination request");
  const old = ControllerWorker.instances[0];
  expect(old.terminateCalls).toBe(3);
  expect(ownedWorkerCleanupPending()).toHaveLength(1);
  expect(admission.prepared).toBe(1);
  ControllerWorker.behavior = "normal";
  await expect(
    refineGlobalScanSet(source, publicEntities(source), { clock: () => 1 }),
  ).resolves.toHaveProperty("entities");
  expect(old.terminateCalls).toBe(4);
  expect(ownedWorkerCleanupPending()).toEqual([]);
  expect(ControllerWorker.instances).toHaveLength(2);
  expect(admission.prepared).toBe(2);
});
it("the same shared command refuses unresolved exact cleanup before any preparation or new worker", async () => {
  const source = sceneInput();
  ControllerWorker.behavior = "termination-error";
  await expect(
    refineGlobalScanSet(source, publicEntities(source), { clock: () => 1 }),
  ).rejects.toThrow("termination request");
  await expect(
    refineGlobalScanSet(source, publicEntities(source), { clock: () => 1 }),
  ).rejects.toThrow("Unresolved exact worker cleanup");
  expect(ControllerWorker.instances[0].terminateCalls).toBe(6);
  expect(ControllerWorker.instances).toHaveLength(1);
  expect(admission.prepared).toBe(1);
  expect(ownedWorkerCleanupPending()).toHaveLength(1);
});
it("nested cleanup retry remains blocked until the exact coordinator acknowledgment arrives", async () => {
  const source = sceneInput();
  const childOwner = {
    onmessage: null as null | ((event: { data: unknown }) => void),
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const now = Date.now();
  retainNestedControllerCleanup(childOwner as unknown as Worker, {
    owner: "controller:9000",
    runId: 9000,
    target: "scan-global-controller-worker.ts",
    createdUnixMs: now,
    expiresUnixMs: now + 900000,
  });
  try {
    await expect(
      refineGlobalScanSet(source, publicEntities(source), { clock: () => 1 }),
    ).rejects.toThrow("Unresolved exact worker cleanup");
    expect(childOwner.postMessage).toHaveBeenCalledTimes(2);
    expect(childOwner.terminate).not.toHaveBeenCalled();
    expect(admission.prepared).toBe(0);
    expect(ControllerWorker.instances).toHaveLength(0);
    childOwner.onmessage?.({
      data: { kind: "cleanup", runId: 9001, unresolved: 0 },
    });
    expect(ownedWorkerCleanupPending()).toHaveLength(1);
    childOwner.onmessage?.({
      data: { kind: "cleanup", runId: 9000, unresolved: 0 },
    });
    expect(childOwner.terminate).toHaveBeenCalledTimes(1);
    expect(ownedWorkerCleanupPending()).toEqual([]);
    await expect(
      refineGlobalScanSet(source, publicEntities(source), { clock: () => 1 }),
    ).resolves.toHaveProperty("entities");
  } finally {
    childOwner.onmessage?.({
      data: { kind: "cleanup", runId: 9000, unresolved: 0 },
    });
    retryOwnedWorkerStops();
  }
});
