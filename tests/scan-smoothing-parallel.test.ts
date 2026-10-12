import { afterEach, expect, it, vi } from "vitest";
import { analyzeMesh, type MeshTopology } from "../src/mesh-processing";
import { smoothSelectedVertices } from "../src/scan-selected-smooth";
import {
  SelectedSmoothingPool,
  smoothingWorkerCount,
} from "../src/scan-smoothing-client";
import {
  smoothingRings,
  smoothingSelection,
  smoothingTargets,
  publishSmoothingTargets,
} from "../src/scan-smoothing-kernel";
import annular from "./fixtures/defeature-annular.json";
import nativeAnnular from "./fixtures/smooth-annular.json";
import fans from "./fixtures/smooth-disconnected-fans.json";
import type { SmoothingWorkerRequest } from "../src/scan-smoothing-worker";
const pools: SelectedSmoothingPool[] = [];
function sameBytes(left: Float64Array, right: Float64Array) {
  const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function pool() {
  const value = new SelectedSmoothingPool();
  pools.push(value);
  return value;
}
afterEach(() => {
  pools.forEach((value) => value.dispose());
  pools.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  WorkerDouble.instances = [];
  WorkerDouble.auto = true;
});

for (const [name, input, native, tolerance] of [
  ["annular", annular, nativeAnnular.nativeOutput, 1e-6],
  ["disconnected fans", fans, fans.nativeOutput, 0],
] as const) {
  it(`preserves native ${name} results across uneven vertex partitions and iteration barriers`, () => {
    const topology = analyzeMesh(new Float32Array(input.positions), {
      tolerance: 0.001,
    });
    const selection = new Uint8Array(input.selection),
      rings = smoothingRings(topology),
      movable = smoothingSelection(topology.triangles, selection);
    const serial = smoothSelectedVertices(topology, selection, 2, 0.5, {});
    for (const count of [1, 2, 3, 7]) {
      let vertices = Float64Array.from(topology.vertices, Math.fround);
      for (let step = 0; step < 2; step++) {
        const targets = new Float64Array(movable.length * 3);
        // Reverse completion order proves results are attached to IDs rather than completion order.
        for (let part = count - 1; part >= 0; part--) {
          const start = Math.floor((part * movable.length) / count),
            end = Math.floor(((part + 1) * movable.length) / count);
          targets.set(
            smoothingTargets(
              vertices,
              topology.triangles,
              rings,
              movable.slice(start, end),
              0.5,
            ),
            start * 3,
          );
        }
        vertices = publishSmoothingTargets(vertices, movable, targets);
      }
      expect(new Uint8Array(vertices.buffer)).toEqual(
        new Uint8Array(serial.buffer),
      );
      const output = Float32Array.from(
        Array.from(topology.triangles).flatMap((id) =>
          Array.from(vertices.subarray(id * 3, id * 3 + 3)),
        ),
      );
      const error = Math.max(
        ...Array.from(output, (v, i) => Math.abs(v - native[i])),
      );
      if (tolerance) expect(error).toBeLessThan(tolerance);
      else expect(error).toBe(0);
    }
    expect(smoothingRings({ ...topology, vertices: serial })).toBe(rings);
    expect(
      smoothingRings({ ...topology, edges: new Map(topology.edges) }),
    ).not.toBe(rings);
  });
}

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  static auto = true;
  state?: Extract<
    SmoothingWorkerRequest,
    { initialize: unknown }
  >["initialize"];
  sent: SmoothingWorkerRequest[] = [];
  terminated = false;
  onmessage?: (event: any) => void;
  onerror?: (event: any) => void;
  onmessageerror?: () => void;
  constructor() {
    WorkerDouble.instances.push(this);
  }
  postMessage(message: SmoothingWorkerRequest) {
    this.sent.push(message);
    if ("initialize" in message) this.state = message.initialize;
    else if ("selection" in message) this.state!.movable = message.selection;
    else if (WorkerDouble.auto) queueMicrotask(() => this.complete(message));
  }
  complete(message = this.sent.at(-1)!) {
    if (!("iteration" in message)) throw new Error("Expected iteration.");
    const state = this.state!;
    this.onmessage?.({
      data: {
        iteration: message.iteration,
        targets: smoothingTargets(
          message.vertices,
          state.triangles,
          state.rings,
          state.movable,
          message.strength,
        ),
      },
    });
  }
  terminate() {
    this.terminated = true;
  }
}
function large() {
  const vertices = new Float64Array(300_003 * 3),
    triangles = Uint32Array.from({ length: 300_003 }, (_, i) => i);
  for (let i = 0; i < vertices.length; i++) vertices[i] = i % 7;
  const topology: MeshTopology = {
    vertices,
    triangles,
    edges: new Map(),
    neighbors: [],
    components: [],
    boundaryLoops: [],
    boundaryChains: [],
    nonManifoldEdges: 0,
    nonManifoldVertices: 0,
    inconsistentEdges: 0,
    degenerateTriangles: 0,
    duplicateTriangles: 0,
    boundaryEdges: 0,
  };
  return { topology, selection: new Uint8Array(triangles.length / 3).fill(1) };
}
function setup() {
  vi.stubGlobal("Worker", WorkerDouble);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
}
it("admits two cores only within CPU, selected size and copied-buffer limits", () => {
  setup();
  expect(smoothingWorkerCount(300_000, 300_000, 600_000, 1_800_000)).toBe(2);
  expect(smoothingWorkerCount(300_000, 299_999, 600_000, 600_000)).toBe(1);
  expect(
    smoothingWorkerCount(2_000_000, 2_000_000, 4_000_000, 12_000_000),
  ).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 2, deviceMemory: 8 });
  expect(smoothingWorkerCount(300_000, 300_000, 600_000, 600_000)).toBe(1);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 4 });
  expect(smoothingWorkerCount(300_000, 300_000, 600_000, 600_000)).toBe(1);
});
it("waits for both out-of-order shards then reuses workers and expires idle resources", async () => {
  setup();
  vi.useFakeTimers();
  WorkerDouble.auto = false;
  const { topology, selection } = large(),
    owned = pool();
  const job = owned.smooth(topology, selection, 2, 0.5);
  const [a, b] = WorkerDouble.instances;
  let done = false;
  void job.then(() => {
    done = true;
  });
  b.complete();
  await Promise.resolve();
  expect(done).toBe(false);
  expect(a.sent).toHaveLength(2);
  a.complete();
  await Promise.resolve();
  expect(a.sent).toHaveLength(3);
  a.complete();
  b.complete();
  const result = await job;
  const serial = smoothSelectedVertices(topology, selection, 2, 0.5, {});
  expect(sameBytes(result, serial)).toBe(true);
  WorkerDouble.auto = true;
  await owned.smooth(topology, selection, 2, 0.5);
  expect(WorkerDouble.instances).toHaveLength(2);
  expect(a.sent.filter((m) => "initialize" in m)).toHaveLength(1);
  vi.advanceTimersByTime(30_000);
  expect(a.terminated && b.terminated).toBe(true);
});
it("cancels and disposes every worker without publishing partial targets", async () => {
  setup();
  WorkerDouble.auto = false;
  const { topology, selection } = large(),
    owned = pool(),
    controller = new AbortController();
  const job = owned.smooth(topology, selection, 2, 0.5, {
    signal: controller.signal,
  });
  const rejected = expect(job).rejects.toThrow("cancelled");
  controller.abort();
  await rejected;
  expect(WorkerDouble.instances.every((w) => w.terminated)).toBe(true);
  owned.dispose();
  await expect(owned.smooth(topology, selection, 2, 0.5)).rejects.toThrow(
    "closed",
  );
});
it("bounds hung worker jobs and rejects superseded jobs without stopping their replacement", async () => {
  setup();
  vi.useFakeTimers();
  WorkerDouble.auto = false;
  const { topology, selection } = large(),
    owned = pool();
  const first = owned.smooth(topology, selection, 2, 0.5),
    rejected = expect(first).rejects.toThrow("cancelled");
  const second = owned.smooth(topology, selection, 2, 0.5);
  await rejected;
  expect(WorkerDouble.instances.slice(2).every((w) => !w.terminated)).toBe(
    true,
  );
  const timeout = expect(second).rejects.toThrow("cancelled");
  vi.advanceTimersByTime(120_000);
  await timeout;
  expect(WorkerDouble.instances.every((w) => w.terminated)).toBe(true);
});
it("falls back to the same kernel on transport failure and validates before starting workers", async () => {
  setup();
  WorkerDouble.auto = false;
  const { topology, selection } = large(),
    owned = pool();
  for (const [iterations, strength] of [
    [0, 0.5],
    [2, 0],
    [101, 0.5],
  ])
    await expect(
      owned.smooth(topology, selection, iterations, strength),
    ).rejects.toThrow("Smoothing needs");
  await expect(
    owned.smooth(topology, new Uint8Array(1), 2, 0.5),
  ).rejects.toThrow("matching");
  expect(WorkerDouble.instances).toHaveLength(0);
  const job = owned.smooth(topology, selection, 2, 0.5);
  WorkerDouble.instances[0].onerror?.({ message: "Transport failed" });
  const result = await job;
  const serial = smoothSelectedVertices(topology, selection, 2, 0.5, {});
  expect(sameBytes(result, serial)).toBe(true);
  expect(WorkerDouble.instances.every((w) => w.terminated)).toBe(true);
});

it("runs the actual worker kernel and closes its independent orphan lease", async () => {
  vi.useFakeTimers();
  const scope = {
    onmessage: undefined as ((event: any) => void) | undefined,
    postMessage: vi.fn(),
    close: vi.fn(),
  };
  vi.stubGlobal("self", scope);
  await import("../src/scan-smoothing-worker");
  const topology = analyzeMesh(new Float32Array(annular.positions), {
    tolerance: 0.001,
  });
  const rings = smoothingRings(topology),
    movable = smoothingSelection(
      topology.triangles,
      new Uint8Array(annular.selection),
    );
  const vertices = Float64Array.from(topology.vertices, Math.fround);
  scope.onmessage!({
    data: { initialize: { triangles: topology.triangles, rings, movable } },
  });
  scope.onmessage!({ data: { iteration: 4, vertices, strength: 0.5 } });
  const response = scope.postMessage.mock.calls.at(-1)!;
  expect(response[0].iteration).toBe(4);
  expect(response[0].targets).toEqual(
    smoothingTargets(vertices, topology.triangles, rings, movable, 0.5),
  );
  expect(response[1]).toEqual([response[0].targets.buffer]);
  vi.advanceTimersByTime(119_999);
  expect(scope.close).not.toHaveBeenCalled();
  scope.onmessage!({ data: { selection: movable.slice(0, 3) } });
  vi.advanceTimersByTime(120_000);
  expect(scope.close).toHaveBeenCalledOnce();
});
it("aborts during progress without dispatching an iteration or leaving workers", async () => {
  setup();
  const { topology, selection } = large(),
    owned = pool(),
    controller = new AbortController();
  await expect(
    owned.smooth(topology, selection, 2, 0.5, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toThrow("cancelled");
  expect(
    WorkerDouble.instances.every(
      (worker) => worker.terminated && worker.sent.length === 1,
    ),
  ).toBe(true);
});
it("releases a partially created pool and falls back after worker startup failure", async () => {
  setup();
  let attempts = 0;
  vi.stubGlobal(
    "Worker",
    class extends WorkerDouble {
      constructor() {
        if (++attempts === 2) throw new Error("Worker denied");
        super();
      }
    },
  );
  const { topology, selection } = large();
  const result = await pool().smooth(topology, selection, 2, 0.5);
  const serial = smoothSelectedVertices(topology, selection, 2, 0.5, {});
  expect(sameBytes(result, serial)).toBe(true);
  expect(WorkerDouble.instances).toHaveLength(1);
  expect(WorkerDouble.instances[0].terminated).toBe(true);
});
it("preserves sparse high-valence rings with fixed per-vertex accumulation order", () => {
  const positions: number[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i * Math.PI) / 60,
      b = ((i + 1) * Math.PI) / 60;
    positions.push(
      0,
      0,
      1,
      Math.cos(a) * 1000,
      Math.sin(a) * 1000,
      i % 3,
      Math.cos(b) * 1000,
      Math.sin(b) * 1000,
      (i + 1) % 3,
    );
  }
  const topology = analyzeMesh(new Float32Array(positions)),
    selection = new Uint8Array(120);
  selection[0] = selection[81] = 1;
  const rings = smoothingRings(topology),
    movable = smoothingSelection(topology.triangles, selection);
  let vertices = Float64Array.from(topology.vertices, Math.fround);
  for (let step = 0; step < 3; step++) {
    const all = smoothingTargets(
        vertices,
        topology.triangles,
        rings,
        movable,
        0.5,
      ),
      merged = new Float64Array(all.length);
    for (let i = 0; i < movable.length; i++)
      merged.set(
        smoothingTargets(
          vertices,
          topology.triangles,
          rings,
          movable.slice(i, i + 1),
          0.5,
        ),
        i * 3,
      );
    expect(new Uint8Array(merged.buffer)).toEqual(new Uint8Array(all.buffer));
    vertices = publishSmoothingTargets(vertices, movable, merged);
  }
  expect(vertices).toEqual(
    smoothSelectedVertices(topology, selection, 3, 0.5, {}),
  );
});
