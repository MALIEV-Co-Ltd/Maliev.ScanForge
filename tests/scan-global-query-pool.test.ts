import { afterEach, expect, it, vi } from "vitest";
import {
  createGlobalQueryPool,
  globalQueryPoolAdmission,
} from "../src/scan-global-query-pool";
import {
  createGlobalQueryWorkerState,
  type GlobalQueryRequest,
  type GlobalQueryResponse,
} from "../src/scan-global-query-worker";
import fixture from "./fixtures/global-fine-correspondence-native.json";
import { nativeGlobalQuery } from "../src/scan-native-global-query";
import meshFixture from "./fixtures/global-fine-mesh-correspondence-native.json";
import { meshCorrespondenceFixture } from "./helpers/global-mesh-correspondence-fixture";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function boundedScene() {
  return {
    scans: [0, 1].map((i) => {
      const points = Float32Array.of(
        0,
        0,
        i * 0.1,
        1,
        0,
        i * 0.1,
        0,
        1,
        i * 0.1,
      );
      return {
        id: String(i),
        geometry: {
          points,
          normals: Float32Array.of(0, 0, -1, 0, 0, -1, 0, 0, -1),
          rawTargetIds: new Uint32Array(),
          targetMeshes: [
            { vertices: points, triangles: Uint32Array.of(0, 1, 2) },
          ],
        },
      };
    }),
  };
}
it("enforces one scene budget across packed preparation and the shared secondary worker", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const input = boundedScene(),
    pool = await createGlobalQueryPool(input);
  try {
    expect(pool.physicalWorkers).toBe(2);
    expect(pool.storage).toHaveLength(2);
    expect(pool.storage![0]!.peak).toBeGreaterThan(pool.storage![0]!.reserved);
    expect(pool.storage![1]!.reserved).toBe(pool.storage![0]!.live);
    expect(pool.storage!.every((s) => s!.peak <= 512 * 1048576)).toBe(true);
    const prepared = FakeWorker.instances[1].transport!.preparedMeshes!;
    expect(
      prepared.every((p) =>
        p.targets.every(
          (t) =>
            !t.root &&
            t.surface.deriveBounds &&
            t.packedIndex?.values.buffer instanceof SharedArrayBuffer,
        ),
      ),
    ).toBe(true);
    const job = {
      sourceId: "0",
      poses: input.scans.map((s) => ({ id: s.id, matrix: identity })),
      cells: [[0, 1, 2]],
      radius: 1,
      mode: "target-average" as const,
    };
    const scans = input.scans.map((s) => ({ ...s, matrix: identity }));
    expect(await pool.execute(job)).toEqual(
      nativeGlobalQuery({ ...job, source: scans[0], targets: scans }),
    );
    expect(input.scans[0].geometry.targetMeshes[0]).not.toHaveProperty(
      "packedNodes",
    );
  } finally {
    pool.close();
  }
});
it("closes bounded workers before accepting an oversized sample batch", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const input = boundedScene(),
    pool = await createGlobalQueryPool(input);
  await expect(
    pool.execute({
      sourceId: "0",
      poses: input.scans.map((s) => ({ id: s.id, matrix: identity })),
      cells: [Array(16385).fill(0)],
      radius: 1,
    }),
  ).rejects.toThrow(/16384/);
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
});
it("terminates the entire bounded pool when preparation exhausts its live allocation budget", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  FakeWorker.exhaustBudget = true;
  await expect(createGlobalQueryPool(boundedScene())).rejects.toThrow(
    /whole-scene/,
  );
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
});
it.each([NaN, Infinity, -1, 513 * 1048576])(
  "rejects an invalid bounded worker peak report %s and releases both workers",
  async (peak) => {
    install();
    vi.stubGlobal("crossOriginIsolated", true);
    FakeWorker.badPeak = peak;
    await expect(createGlobalQueryPool(boundedScene())).rejects.toThrow(
      /storage report/,
    );
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  },
);
it("shares mesh carriers and preserves aliases while preparing each worker once", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const { scans } = meshCorrespondenceFixture(
    meshFixture.cases.find((c) => c.name === "hidden-raw-False")!,
  );
  const geometry = scans[1].geometry;
  if (!geometry.targetMeshes) throw Error("Missing mesh fixture");
  const mesh = geometry.targetMeshes[0];
  geometry.points = mesh.vertices;
  geometry.normals = new Float32Array(mesh.vertices.length);
  geometry.labels = new Uint32Array(mesh.vertices.length / 3);
  geometry.rawTargetIds = new Uint32Array();
  const pool = await createGlobalQueryPool({ scans });
  try {
    expect(pool.physicalWorkers).toBe(2);
    for (const worker of FakeWorker.instances) {
      const g = worker.transport!.scans[1].geometry;
      expect(g.targetMeshes![0].vertices.buffer).toBeInstanceOf(
        SharedArrayBuffer,
      );
      expect(g.targetMeshes![0].flags!.buffer).toBeInstanceOf(
        SharedArrayBuffer,
      );
      expect(g.targetMeshes![0].vertices).toBe(g.points);
      expect(g.rawTargetIds?.length).toBe(0);
      expect(g.rawTargetIds?.buffer).toBeInstanceOf(SharedArrayBuffer);
      expect(worker.initialized).toBe(1);
    }
    expect(mesh.vertices.buffer).toBeInstanceOf(ArrayBuffer);
  } finally {
    pool.close();
  }
});
it("accounts for admitted raw target IDs without changing the pool memory ceiling", () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const points = new Float32Array(20000000);
  const geometry = {
    points,
    normals: points,
    rawTargetIds: undefined as Uint32Array | undefined,
  };
  const input = { scans: [{ id: "source", geometry }] };
  expect(globalQueryPoolAdmission(input)).toBe(1);
  geometry.rawTargetIds = new Uint32Array();
  expect(globalQueryPoolAdmission(input)).toBe(2);
  geometry.rawTargetIds = [] as unknown as Uint32Array;
  expect(() => globalQueryPoolAdmission(input)).toThrow(/raw target/i);
});
it("releases pool ownership instead of caching shared copies for a later pool", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const { scans, job } = setup(fixture.cases[1]);
  const first = await createGlobalQueryPool({ scans });
  const backing =
    FakeWorker.instances[0].transport!.scans[0].geometry.points.buffer;
  const expected = await first.execute(job);
  first.close();
  expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
  expect(
    FakeWorker.instances.every((worker) => worker.onmessage === null),
  ).toBe(true);
  const second = await createGlobalQueryPool({ scans });
  try {
    expect(
      FakeWorker.instances[2].transport!.scans[0].geometry.points.buffer,
    ).not.toBe(backing);
    expect(await second.execute(job)).toEqual(expected);
  } finally {
    second.close();
  }
});
it("includes mesh preparation in the existing worker memory admission", () => {
  install();
  const geometry = {
    points: new Float32Array(),
    normals: new Float32Array(),
    targetMeshes: [
      {
        vertices: Float32Array.of(0, 0, 0),
        triangles: new Uint32Array(3000000),
      },
    ],
  };
  expect(globalQueryPoolAdmission({ scans: [{ id: "mesh", geometry }] })).toBe(
    1,
  );
  geometry.targetMeshes[0].triangles = new Uint32Array(6000000);
  expect(() =>
    globalQueryPoolAdmission({ scans: [{ id: "mesh", geometry }] }),
  ).toThrow(/memory admission/);
});
it("closes both workers if the producer omits prepared targets", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  FakeWorker.omitPrepared = true;
  const { scans } = meshCorrespondenceFixture(meshFixture.cases[0]);
  await expect(createGlobalQueryPool({ scans })).rejects.toThrow(
    /Missing shared prepared targets/,
  );
  expect(FakeWorker.instances).toHaveLength(2);
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
});
class FakeWorker {
  static instances: FakeWorker[] = [];
  static hold = false;
  static fail = false;
  static omitPrepared = false;
  static exhaustBudget = false;
  static badPeak: number | undefined;
  onmessage?: (e: { data: GlobalQueryResponse }) => void;
  onerror?: (e: { message: string }) => void;
  onmessageerror?: () => void;
  terminated = false;
  initialized = 0;
  transport?: Extract<
    GlobalQueryRequest,
    { initialize: unknown }
  >["initialize"];
  state?: ReturnType<typeof createGlobalQueryWorkerState>;
  constructor() {
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
    this.state = undefined;
  }
  postMessage(request: GlobalQueryRequest) {
    if ("initialize" in request) this.transport = request.initialize;
    const data = structuredClone(request);
    queueMicrotask(() => {
      if (this.terminated || FakeWorker.hold) return;
      if (FakeWorker.fail) {
        this.onerror?.({ message: "injected worker failure" });
        return;
      }
      try {
        if ("initialize" in data) {
          if (FakeWorker.exhaustBudget && data.initialize.storageBudget)
            data.initialize.storageBudget.reserved =
              data.initialize.storageBudget.limit - 1;
          this.state = createGlobalQueryWorkerState(data.initialize);
          this.initialized++;
          this.onmessage?.({
            data: {
              id: data.id,
              ready: true,
              indexes: this.state.indexes,
              storage: this.state.storage && {
                ...this.state.storage,
                peak: FakeWorker.badPeak ?? this.state.storage.peak,
              },
              prepared: FakeWorker.omitPrepared
                ? undefined
                : this.state.prepared,
            },
          });
        } else {
          if (!this.state) throw Error("not initialized");
          this.onmessage?.({
            data: { id: data.id, result: this.state.execute(data.job) },
          });
        }
      } catch (error) {
        this.onmessage?.({ data: { id: data.id, error: String(error) } });
      }
    });
  }
}
function install() {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
}
afterEach(() => {
  FakeWorker.instances = [];
  FakeWorker.hold = FakeWorker.fail = false;
  FakeWorker.omitPrepared = false;
  FakeWorker.exhaustBudget = false;
  FakeWorker.badPeak = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup(raw: (typeof fixture.cases)[number]) {
  const c = raw as typeof raw & {
    normals?: number[][];
    targetNormals?: number[][][];
    flags?: number[];
    targetFlags?: number[][];
    sourcePose?: number[];
    targetPoses?: number[][];
    cells?: number[][];
    mask?: number;
    gateCount?: number;
    includeSelf?: boolean;
  };
  const geometry = (
    points: number[][],
    normals: number[][] | undefined,
    labels: number[],
    flags?: number[],
  ) => ({
    points: Float32Array.from(points.flat()),
    normals: Float32Array.from((normals ?? points.map(() => [0, 0, 1])).flat()),
    labels: Uint32Array.from(labels),
    flags: flags && Uint32Array.from(flags),
  });
  const scans = [
    {
      id: "source",
      geometry: geometry(c.source, c.normals, c.sourceLabelWords, c.flags),
    },
    ...c.targets.map((points, i) => ({
      id: `target-${i}`,
      geometry: geometry(
        points,
        c.targetNormals?.[i],
        c.targetLabelWords[i],
        c.targetFlags?.[i],
      ),
    })),
  ];
  // Native target order is preserved. Including self has no numeric effect.
  const job = {
    sourceId: "source",
    poses: [
      { id: "source", matrix: c.sourcePose ?? identity },
      ...c.targets.map((_, i) => ({
        id: `target-${i}`,
        matrix: c.targetPoses?.[i] ?? identity,
      })),
    ],
    cells: c.cells ?? [c.source.map((_, i) => i)],
    radius: c.radius,
    mode: c.mode as "pooled-plane" | "target-average",
    mask: c.mask,
    gateCount: c.gateCount,
  };
  return { scans, job };
}
it.each(fixture.cases)(
  "joins original numeric output across two workers: $name / $mode",
  async (c) => {
    install();
    const { scans, job } = setup(c),
      pool = await createGlobalQueryPool({ scans });
    try {
      expect(pool.physicalWorkers).toBe(2);
      const result = await pool.execute(job);
      expect(result.count).toBe(c.count);
      expect(
        result.pairs.map((p) => ({
          id: p.id,
          active: p.active,
          numericBits: Buffer.from(
            Float64Array.from([...p.source, ...p.target, p.distance]).buffer,
          ).toString("hex"),
        })),
      ).toEqual(
        c.results.map((p) => ({
          id: p.id,
          active: p.active,
          numericBits: p.numericBits,
        })),
      );
    } finally {
      pool.close();
    }
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  },
);
it("initializes once, reuses indexes and preserves mode with one physical worker", async () => {
  install();
  const { scans, job } = setup(fixture.cases[1]);
  const pool = await createGlobalQueryPool({ scans }, { parallel: false });
  try {
    expect(pool.physicalWorkers).toBe(1);
    const first = await pool.execute(job),
      again = await pool.execute(job);
    expect(again).toEqual(first);
    expect(FakeWorker.instances[0].initialized).toBe(1);
    expect(pool.indexesPerWorker).toEqual([scans.length]);
  } finally {
    pool.close();
  }
});
it("shares immutable geometry without detaching the authored buffers", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const { scans, job } = setup(fixture.cases[1]);
  const original = scans[0].geometry.points.slice();
  const pool = await createGlobalQueryPool({ scans });
  try {
    await pool.execute(job);
    const a = FakeWorker.instances[0].transport!.scans[0].geometry.points;
    const b = FakeWorker.instances[1].transport!.scans[0].geometry.points;
    expect(a.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(a.buffer).toBe(b.buffer);
    expect(scans[0].geometry.points).toEqual(original);
    expect(scans[0].geometry.points.buffer).toBeInstanceOf(ArrayBuffer);
  } finally {
    pool.close();
  }
});
it("cancels initialization and releases both exact worker handles", async () => {
  install();
  FakeWorker.hold = true;
  const { scans } = setup(fixture.cases[0]),
    controller = new AbortController();
  const pending = createGlobalQueryPool(
    { scans },
    { signal: controller.signal },
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances).toHaveLength(2);
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
});
it("releases both workers when a query fails", async () => {
  install();
  const { scans, job } = setup(fixture.cases[0]),
    pool = await createGlobalQueryPool({ scans });
  FakeWorker.fail = true;
  await expect(pool.execute(job)).rejects.toThrow("injected worker failure");
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
});
it("enforces the idle lease and refuses further pose evaluation", async () => {
  vi.useFakeTimers();
  install();
  const { scans, job } = setup(fixture.cases[0]);
  const creating = createGlobalQueryPool({ scans });
  await vi.advanceTimersByTimeAsync(0);
  const pool = await creating;
  await vi.advanceTimersByTimeAsync(30_001);
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  await expect(pool.execute(job)).rejects.toThrow();
});
it("keeps the numeric mode when browser workers are unavailable", async () => {
  vi.stubGlobal("Worker", undefined);
  const { scans, job } = setup(fixture.cases[1]),
    pool = await createGlobalQueryPool({ scans });
  expect(pool.physicalWorkers).toBe(0);
  expect((await pool.execute(job)).count).toBe(fixture.cases[1].count);
  pool.close();
  await expect(pool.execute(job)).rejects.toMatchObject({ name: "AbortError" });
});
it("times out an initializing worker and terminates both handles", async () => {
  vi.useFakeTimers();
  install();
  FakeWorker.hold = true;
  const { scans } = setup(fixture.cases[0]);
  const creating = createGlobalQueryPool({ scans });
  const rejected = expect(creating).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
it("starts the idle lease after a completed long query", async () => {
  vi.useFakeTimers();
  install();
  const { scans, job } = setup(fixture.cases[0]);
  const creating = createGlobalQueryPool({ scans });
  await vi.advanceTimersByTimeAsync(0);
  const pool = await creating;
  try {
    FakeWorker.hold = true;
    const pending = pool.execute(job);
    await vi.advanceTimersByTimeAsync(29_000);
    for (const worker of FakeWorker.instances)
      worker.onmessage?.({ data: { id: 2, result: { count: 0, pairs: [] } } });
    await pending;
    FakeWorker.hold = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWorker.instances.some((worker) => worker.terminated)).toBe(
      false,
    );
    const next = pool.execute(job);
    await vi.advanceTimersByTimeAsync(0);
    expect((await next).count).toBe(fixture.cases[0].count);
  } finally {
    pool.close();
  }
});

it("rejects cancelled query initialization before reading its input", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const { scans } = setup(fixture.cases[0]);
  const readInput = vi.fn();
  const unreadableInput = new Proxy(
    { scans },
    {
      get() {
        readInput();
        throw new Error("Cancelled query initialization accessed its input.");
      },
    },
  );
  await expect(
    createGlobalQueryPool(unreadableInput, { signal: AbortSignal.abort() }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(readInput).not.toHaveBeenCalled();
  expect(FakeWorker.instances).toHaveLength(0);
});

it.each(["close", "abort"] as const)(
  "rejects query work before reading the job after %s",
  async (outcome) => {
    install();
    const { scans, job } = setup(fixture.cases[0]);
    const controller = new AbortController();
    const pool = await createGlobalQueryPool(
      { scans },
      {
        signal: controller.signal,
      },
    );
    const readJob = vi.fn();
    const unreadableJob = new Proxy(job, {
      get() {
        readJob();
        throw new Error("Closed query pool accessed its job.");
      },
    });
    try {
      if (outcome === "close") pool.close();
      else controller.abort();
      await expect(pool.execute(unreadableJob)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(readJob).not.toHaveBeenCalled();
      expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(
        true,
      );
    } finally {
      controller.abort();
      pool.close();
    }
  },
);
