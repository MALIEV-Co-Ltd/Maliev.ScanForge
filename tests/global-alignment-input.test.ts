import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  prepareGlobalAlignmentInput,
  inspectGlobalAlignmentCandidates,
  globalAlignmentInputAdmission,
  normalizeGlobalSearchTolerance,
} from "../src/global-alignment-input";
import { executeGlobalAlignmentInputPreparation } from "../src/global-alignment-input-worker";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { noiseNormals } from "../src/scan-native-noise";
import type { Entity } from "../src/types";
import nativeNormals from "./fixtures/noise-normal-kernel.json";

// Legacy indexed scans without stored computed normals use a derivation worker.
// Model transfer detachment without detaching the authored entity carriers.
beforeEach(() => {
  vi.stubGlobal(
    "Worker",
    class {
      onmessage?: (event: { data: unknown }) => void;
      onerror?: unknown;
      onmessageerror?: unknown;
      terminate = vi.fn();
      postMessage(
        packet: Parameters<typeof executeGlobalAlignmentInputPreparation>[0],
        transfer: ArrayBuffer[],
      ) {
        const copy = structuredClone(packet, { transfer });
        queueMicrotask(() => {
          try {
            this.onmessage?.({
              data: { result: executeGlobalAlignmentInputPreparation(copy) },
            });
          } catch (error) {
            this.onmessage?.({ data: { error: (error as Error).message } });
          }
        });
      }
    },
  );
});

const points = () => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
function mesh(id: string): Entity {
  const vertices = new Float32Array([...points(), 10, 10, 10]);
  return {
    id,
    name: id,
    kind: "mesh",
    visible: true,
    positions: points(),
    color: "#fff",
    opacity: 1,
    indexedMesh: {
      vertices,
      triangles: new Uint32Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0]),
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("normalizes the native absolute Float32 millimetre search entry", () => {
  expect(normalizeGlobalSearchTolerance()).toBe(0.5);
  expect(normalizeGlobalSearchTolerance(0.123456789)).toBe(
    Math.fround(0.123456789),
  );
  expect(normalizeGlobalSearchTolerance(-0.123456789)).toBe(
    Math.fround(0.123456789),
  );
  expect(normalizeGlobalSearchTolerance(0)).toBe(0);
  expect(() => normalizeGlobalSearchTolerance(1e40)).toThrow();
  expect(() => normalizeGlobalSearchTolerance(NaN)).toThrow();
  expect(() =>
    normalizeGlobalSearchTolerance("1" as unknown as number),
  ).toThrow();
});
it("rejects collectively oversized soups before constructing any worker or reading geometry", async () => {
  const construct = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        construct();
      }
    },
  );
  const candidates = Array.from({ length: 32 }, (_, i) => ({
    ...mesh(String(i)),
    indexedMesh: undefined,
    positions: new Proxy(points(), {
      get(_target, key) {
        if (key === "length") return 900000;
        throw Error("coordinate traversal before admission");
      },
    }),
  }));
  expect(() => globalAlignmentInputAdmission([candidates[0]])).not.toThrow();
  await expect(prepareGlobalAlignmentInput(candidates)).rejects.toThrow(
    /collective.*512 MiB/i,
  );
  expect(construct).not.toHaveBeenCalled();
});
it("counts reused backing carriers once and admits the full indexed three-scan dimensions", () => {
  const a = mesh("a"),
    b = { ...a, id: "b" };
  const shared = globalAlignmentInputAdmission([a, b]);
  expect(shared.retainedBytes).toBe(
    (a.indexedMesh!.vertices as Float32Array).byteLength +
      (a.indexedMesh!.triangles as Uint32Array).byteLength +
      (a.indexedMesh!.normals as Float32Array).byteLength +
      2 * a.indexedMesh!.vertices.length * (4 + 4 / 3),
  );
  const indexed = (id: string, vertices: number, triangles: number) =>
    ({
      ...mesh(id),
      indexedMesh: {
        vertices: { length: vertices * 3 },
        triangles: { length: triangles * 3 },
      },
    }) as unknown as Entity;
  const result = globalAlignmentInputAdmission([
    indexed("1", 139338, 273139),
    indexed("2", 1299033, 2547403),
    indexed("3", 1683605, 3326910),
  ]);
  expect(result.estimatedPeakBytes).toBeLessThan(result.limitBytes);
});
it("reports candidate metadata without reading coordinate values", () => {
  const a = mesh("a"),
    b = mesh("b");
  a.positions = new Proxy(a.positions, {
    get(target, key) {
      if (key === "0") throw Error("coordinates read");
      return Reflect.get(target, key, target);
    },
  });
  expect(inspectGlobalAlignmentCandidates([a, b])).toEqual({
    entityIds: ["a", "b"],
    blocked: [],
    excluded: [],
    canPreview: true,
  });
  const state = inspectGlobalAlignmentCandidates([
    a,
    { ...b, locked: true },
    { ...mesh("cloud"), kind: "pointcloud" },
  ]);
  expect(state.canPreview).toBe(false);
  expect(state.blocked[0].id).toBe("b");
  expect(state.excluded[0]).toMatchObject({ id: "cloud" });
});
it("uses scene order, visible mesh wrappers, command defaults and original unused vertices", async () => {
  const a = mesh("a"),
    b = mesh("b");
  const result = await prepareGlobalAlignmentInput(
    [
      a,
      { ...mesh("hidden"), visible: false },
      { ...mesh("cad"), kind: "cad", kernelId: "exact" },
      b,
    ],
    { entityIds: ["b", "a"] },
  );
  expect(result.entities.map((e) => e.id)).toEqual([a.id, b.id]);
  expect(result.entities[0].positions).toBe(a.positions);
  expect(result.entities[1].positions).toBe(b.positions);
  expect(result.entities[0].indexedMesh!.geometryNormals).toBe(
    result.input.scans[0].geometry.normals,
  );
  expect(a.indexedMesh!.geometryNormals).toBeUndefined();
  expect(result.input).toMatchObject({
    radius: 0.5,
    spacing: 12,
    budget: 1000,
    mask: 0,
  });
  expect(result.input.scans[0].geometry.points).toBe(a.indexedMesh!.vertices);
  expect(result.input.scans[0].geometry.normals).not.toBe(
    a.indexedMesh!.normals,
  );
  expect(result.input.scans[0].geometry.normals).toEqual(
    noiseNormals(a.indexedMesh!),
  );
  expect(result.input.scans[0].geometry.flags).toEqual(
    Uint32Array.of(0, 0, 0, 0),
  );
  expect(result.summary.mask).toBe(0);
  expect(result.summary.preparation.physicalWorkers).toBe(2);
  expect(result.input.scans[0].geometry.targetMeshes![0].triangles).toBe(
    a.indexedMesh!.triangles,
  );
  expect(result.summary.vertices).toBe(8);
});
it("refuses indexed carriers whose display is not the application's expanded facet view", async () => {
  const a = mesh("a");
  a.positions = a.indexedMesh!.vertices;
  expect(a.positions.length % 9).not.toBe(0);
  await expect(prepareGlobalAlignmentInput([a, mesh("b")])).rejects.toThrow(
    /facets/i,
  );
});
it.each([
  { entityIds: ["a", "a"] },
  { entityIds: ["a", "missing"] },
  { searchTolerance: 1e40 },
  { searchTolerance: NaN },
])("rejects invalid command options %j", async (options) => {
  await expect(
    prepareGlobalAlignmentInput([mesh("a"), mesh("b")], options),
  ).rejects.toThrow();
});
it("refuses locked, hidden, exact CAD, cloud and partial hidden inputs without changing geometry", async () => {
  for (const change of [
    { locked: true },
    { visible: false },
    { kernelId: "exact" },
    { kind: "pointcloud" as const },
    { meshSelection: { hidden: [0], saved: [] } },
  ]) {
    const a = { ...mesh("a"), ...change };
    await expect(
      prepareGlobalAlignmentInput([a, mesh("b")], { entityIds: ["a", "b"] }),
    ).rejects.toThrow();
    expect(a.positions).toEqual(points());
  }
});
it("requires two and at most 32 raw meshes and rejects duplicate scene IDs", async () => {
  await expect(prepareGlobalAlignmentInput([mesh("a")])).rejects.toThrow();
  await expect(
    prepareGlobalAlignmentInput(
      Array.from({ length: 33 }, (_, i) => mesh(String(i))),
    ),
  ).rejects.toThrow();
  await expect(
    prepareGlobalAlignmentInput([mesh("a"), mesh("a")]),
  ).rejects.toThrow();
});
it("rejects stale indexed topology rather than rebuilding original identity", async () => {
  const a = mesh("a");
  a.positions[0] = 3;
  await expect(prepareGlobalAlignmentInput([a, mesh("b")])).rejects.toThrow(
    /topology/i,
  );
});
it("honors cancellation and stale-input checks before preparation", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    prepareGlobalAlignmentInput([mesh("a"), mesh("b")], {
      signal: abort.signal,
    }),
  ).rejects.toThrow();
  await expect(
    prepareGlobalAlignmentInput([mesh("a"), mesh("b")], {
      check: () => {
        throw Error("stale");
      },
    }),
  ).rejects.toThrow("stale");
});
it("ignores nonfinite authored normals and prevents triangle-index wrapping", async () => {
  const a = mesh("a");
  a.indexedMesh!.normals![0] = Infinity;
  const result = await prepareGlobalAlignmentInput([a, mesh("b")]);
  expect(result.input.scans[0].geometry.normals.every(Number.isFinite)).toBe(
    true,
  );
  expect(a.indexedMesh!.normals![0]).toBe(Infinity);
  a.indexedMesh!.triangles = [0, 1, 2 ** 32];
  await expect(prepareGlobalAlignmentInput([a, mesh("b")])).rejects.toThrow(
    /vertex/i,
  );
});
it("requires physical workers for topology and normal derivation", async () => {
  vi.stubGlobal("Worker", undefined);
  const a = mesh("a");
  a.indexedMesh = undefined;
  await expect(prepareGlobalAlignmentInput([a, mesh("b")])).rejects.toThrow(
    /workers/i,
  );
});
it("reconstructs unindexed triangle soup with the verified native topology and normals", () => {
  const positions = new Float32Array([...points(), 0, 1, 0, 1, 0, 0, 1, 1, 0]);
  const expected = nativeStlTopology(positions);
  const result = executeGlobalAlignmentInputPreparation({ positions });
  expect(result.vertices).toEqual(expected.vertices);
  expect(result.triangles).toEqual(expected.triangles);
  expect(result.normals).toEqual(noiseNormals(expected));
  expect(positions).toEqual(
    new Float32Array([...points(), 0, 1, 0, 1, 0, 0, 1, 1, 0]),
  );
});
it("terminates its disposable worker on success and abort", async () => {
  let last: FakeWorker;
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: unknown;
    onmessageerror?: unknown;
    terminate = vi.fn();
    constructor() {
      last = this;
    }
    postMessage(
      data: Parameters<typeof executeGlobalAlignmentInputPreparation>[0],
    ) {
      queueMicrotask(() =>
        this.onmessage?.({
          data: { result: executeGlobalAlignmentInputPreparation(data) },
        }),
      );
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const a = mesh("a");
  a.indexedMesh!.normals = undefined;
  const result = await prepareGlobalAlignmentInput([a, mesh("b")]);
  expect(last!.terminate).toHaveBeenCalledTimes(1);
  expect(result.summary.preparation.physicalWorkers).toBe(2);
  const controller = new AbortController();
  FakeWorker.prototype.postMessage = function () {
    controller.abort();
  };
  await expect(
    prepareGlobalAlignmentInput([a, mesh("b")], { signal: controller.signal }),
  ).rejects.toThrow();
  expect(last!.terminate).toHaveBeenCalledTimes(1);
});

/** Simulates transfer detachment as well as independent worker completion. */
async function pendingPreparation(
  options: {
    signal?: AbortSignal;
    check?: () => void;
  } = {},
) {
  vi.useFakeTimers();
  let worker!: PendingWorker;
  let posted!: () => void;
  const started = new Promise<void>((resolve) => {
    posted = resolve;
  });
  class PendingWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: (event: { message: string }) => void;
    onmessageerror?: () => void;
    packet?: Parameters<typeof executeGlobalAlignmentInputPreparation>[0];
    terminate = vi.fn();
    constructor() {
      worker ??= this;
    }
    postMessage(
      packet: Parameters<typeof executeGlobalAlignmentInputPreparation>[0],
      transfer: ArrayBuffer[],
    ) {
      this.packet = structuredClone(packet, { transfer });
      if (this === worker) posted();
      else queueMicrotask(() => this.complete());
    }
    complete() {
      this.onmessage?.({
        data: { result: executeGlobalAlignmentInputPreparation(this.packet!) },
      });
    }
  }
  vi.stubGlobal("Worker", PendingWorker);
  const a = mesh("a");
  a.indexedMesh!.normals = undefined;
  const originals = [
    a.positions,
    a.indexedMesh!.vertices,
    a.indexedMesh!.triangles,
  ] as (Float32Array | Uint32Array)[];
  const before = originals.map((values) =>
    new Uint8Array(values.buffer).slice(),
  );
  const outcome = prepareGlobalAlignmentInput([a, mesh("b")], options).then(
    (result) => ({ result, error: undefined }),
    (error: Error) => ({ result: undefined, error }),
  );
  await started;
  expect(vi.getTimerCount()).toBe(2);
  expect(worker.packet!.vertices!.buffer).not.toBe(
    a.indexedMesh!.vertices instanceof Float32Array
      ? a.indexedMesh!.vertices.buffer
      : undefined,
  );
  const verifyCleanup = () => {
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect([
      a.positions,
      a.indexedMesh!.vertices,
      a.indexedMesh!.triangles,
    ]).toEqual(originals);
    expect(a.positions).toBe(originals[0]);
    expect(a.indexedMesh!.vertices).toBe(originals[1]);
    expect(a.indexedMesh!.triangles).toBe(originals[2]);
    originals.forEach((values, i) =>
      expect(new Uint8Array(values.buffer)).toEqual(before[i]),
    );
    // Late events after settlement cannot retain timers or terminate twice.
    worker.onerror?.({ message: "late worker error" });
    worker.onmessageerror?.();
    worker.complete();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  };
  return { worker, outcome, verifyCleanup };
}

it("terminates timed-out input workers once and clears their timeout and stale checks", async () => {
  const pending = await pendingPreparation();
  await vi.advanceTimersByTimeAsync(120000);
  expect((await pending.outcome).error?.message).toMatch(/timed out/i);
  pending.verifyCleanup();
});
it.each(["error", "messageerror"] as const)(
  "cleans input workers after worker %s without detaching authored carriers",
  async (failure) => {
    const pending = await pendingPreparation();
    if (failure === "error")
      pending.worker.onerror?.({ message: "input worker failed" });
    else pending.worker.onmessageerror?.();
    expect((await pending.outcome).error?.message).toMatch(
      failure === "error" ? /input worker failed/ : /could not be decoded/,
    );
    pending.verifyCleanup();
  },
);
it("terminates an in-flight input worker when the source revision becomes stale", async () => {
  let stale = false;
  const pending = await pendingPreparation({
    check: () => {
      if (stale) throw Error("source revision changed");
    },
  });
  stale = true;
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending.outcome).error?.message).toBe(
    "source revision changed",
  );
  pending.verifyCleanup();
});
it("aborts an already-running input worker and releases both timers", async () => {
  const controller = new AbortController();
  const pending = await pendingPreparation({ signal: controller.signal });
  controller.abort();
  expect((await pending.outcome).error?.name).toBe("AbortError");
  pending.verifyCleanup();
});
it("cleans successful input preparation after transferring only disposable copies", async () => {
  const pending = await pendingPreparation();
  pending.worker.complete();
  const outcome = await pending.outcome;
  expect(outcome.error).toBeUndefined();
  expect(outcome.result?.summary.preparation.physicalWorkers).toBe(2);
  pending.verifyCleanup();
});

it("recomputes polygon normals from native-captured topology without changing authored normals or IDs", async () => {
  const captured = nativeNormals.cases.find(
    (sample) => sample.label === "fan-5-scale-1",
  )!;
  const vertices = Float32Array.from(captured.vertices);
  const triangles = Uint32Array.from(captured.triangles);
  const supplied = new Float32Array(vertices.length).fill(7);
  const positions = Float32Array.from(
    [...triangles].flatMap((id) => [...vertices.subarray(id * 3, id * 3 + 3)]),
  );
  const a: Entity = {
    ...mesh("a"),
    positions,
    indexedMesh: { vertices, triangles, normals: supplied },
  };
  const b: Entity = {
    ...mesh("b"),
    positions,
    indexedMesh: { vertices, triangles },
  };
  const before = supplied.slice();
  const result = await prepareGlobalAlignmentInput([a, b]);
  for (const scan of result.input.scans) {
    expect(scan.geometry.points).toBe(vertices);
    expect(scan.geometry.targetMeshes![0].triangles).toBe(triangles);
    expect(Buffer.from(scan.geometry.normals.buffer).toString("hex")).toBe(
      captured.nativeNormalBits,
    );
  }
  expect(result.input.scans[0].geometry.normals).not.toBe(
    result.input.scans[1].geometry.normals,
  );
  expect(a.indexedMesh!.normals).toBe(supplied);
  expect(supplied).toEqual(before);
  expect(result.summary.preparation.physicalWorkers).toBe(2);
});

it("admits generated normal output and copied topology even when scanner normals already exist", () => {
  const a = mesh("a");
  const admission = globalAlignmentInputAdmission([a]);
  const v = a.indexedMesh!.vertices.length * 4;
  const t = a.indexedMesh!.triangles.length * 4;
  expect(admission.retainedBytes).toBe(v + t + v + v + v / 3);
  expect(admission.peakPreparationBytes).toBe(v + t + 1048576);
});

it("reserves existing carriers and prepared outputs without charging future derived outputs", async () => {
  const packets: Parameters<
    typeof executeGlobalAlignmentInputPreparation
  >[0][] = [];
  vi.stubGlobal(
    "Worker",
    class {
      onmessage?: (event: { data: unknown }) => void;
      terminate() {}
      postMessage(
        packet: Parameters<typeof executeGlobalAlignmentInputPreparation>[0],
        transfer: ArrayBuffer[],
      ) {
        const copy = structuredClone(packet, { transfer });
        packets.push(copy);
        queueMicrotask(() =>
          this.onmessage?.({
            data: { result: executeGlobalAlignmentInputPreparation(copy) },
          }),
        );
      }
    },
  );
  const a = mesh("a"),
    b = mesh("b");
  const admission = globalAlignmentInputAdmission([a, b]);
  await prepareGlobalAlignmentInput([a, b]);
  const flags = (a.indexedMesh!.vertices.length / 3) * 4;
  const normals = a.indexedMesh!.vertices.length * 4;
  const clones = normals + a.indexedMesh!.triangles.length * 4;
  expect(packets.map((p) => p.storage?.reserved)).toEqual([
    admission.retainedBytes - normals - flags * 2 + clones + 1048576,
    admission.retainedBytes - flags + clones + 1048576,
  ]);
});

it("rejects a worker response missing the source exclusion flags", async () => {
  const terminate = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      onmessage?: (event: { data: unknown }) => void;
      terminate = terminate;
      postMessage(
        packet: Parameters<typeof executeGlobalAlignmentInputPreparation>[0],
      ) {
        const { flags: _flags, ...result } =
          executeGlobalAlignmentInputPreparation(packet);
        queueMicrotask(() => this.onmessage?.({ data: { result } }));
      }
    },
  );
  await expect(
    prepareGlobalAlignmentInput([mesh("a"), mesh("b")]),
  ).rejects.toThrow(/worker buffers/);
  expect(terminate).toHaveBeenCalledOnce();
});
