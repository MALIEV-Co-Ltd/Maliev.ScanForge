import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  prepareGlobalScene,
  createPreparedGlobalQueryPool,
  globalSceneAdmission,
} from "../src/scan-global-scene-client";
import {
  executeGlobalScenePreparation,
  type GlobalSceneInput,
} from "../src/scan-global-scene-worker";
import {
  createGlobalQueryWorkerState,
  type GlobalQueryRequest,
} from "../src/scan-global-query-worker";
import { nativeGlobalQuery } from "../src/scan-native-global-query";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/global-fine-scene-native.json", import.meta.url),
    "utf8",
  ),
).cases[0];
const input = (): GlobalSceneInput => ({
  scans: fixture.scans.map(
    (s: { points: number[][]; normals: number[][] }, i: number) => ({
      id: String(i),
      geometry: {
        points: Float32Array.from(s.points.flat()),
        normals: Float32Array.from(s.normals.flat()),
      },
    }),
  ),
  clocks: fixture.results.map((r: { clockInputs: number[] }) => r.clockInputs),
});
class FakeWorker {
  static instances: FakeWorker[] = [];
  static hold = false;
  static failAt = -1;
  terminated = false;
  scene: boolean;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  state?: ReturnType<typeof createGlobalQueryWorkerState>;
  constructor(url: URL) {
    this.scene = String(url).includes("scene-worker");
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
    this.state = undefined;
  }
  postMessage(raw: GlobalSceneInput | GlobalQueryRequest) {
    const data = structuredClone(raw);
    queueMicrotask(() => {
      if (this.terminated || FakeWorker.hold) return;
      if (FakeWorker.instances.indexOf(this) === FakeWorker.failAt) {
        this.onerror?.({ message: "injected failure" });
        return;
      }
      try {
        if ("scans" in data)
          this.onmessage?.({
            data: { result: executeGlobalScenePreparation(data) },
          });
        else if ("initialize" in data) {
          this.state = createGlobalQueryWorkerState(data.initialize);
          this.onmessage?.({
            data: { id: data.id, ready: true, indexes: this.state.indexes },
          });
        } else
          this.onmessage?.({
            data: { id: data.id, result: this.state!.execute(data.job) },
          });
      } catch (error) {
        this.onmessage?.({
          data: {
            error: String(error),
            ...("id" in data ? { id: data.id } : {}),
          },
        });
      }
    });
  }
}
afterEach(() => {
  FakeWorker.instances = [];
  FakeWorker.hold = false;
  FakeWorker.failAt = -1;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const install = () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
};
it("rejects browser execution without workers and an already-aborted request", async () => {
  vi.stubGlobal("Worker", undefined);
  vi.stubGlobal("document", {});
  await expect(prepareGlobalScene(input())).rejects.toThrow(
    /requires browser workers/,
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareGlobalScene(input(), controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
it("prepares native labels/samples without detaching or mutating authored data", async () => {
  install();
  const data = input();
  const before = data.scans.map((s) => s.geometry.points.slice());
  const result = await prepareGlobalScene(data);
  expect(result.sources.map((s) => Array.from(s.labels))).toEqual(
    fixture.results.map((r: { labels: number[] }) => r.labels),
  );
  result.sources.forEach((s, i) =>
    expect(s.selected).toEqual(
      fixture.results[i].sourceCells.map((c: { selected: number[] }) =>
        c.selected.map((id) => id - i * 500),
      ),
    ),
  );
  expect(data.scans.map((s) => s.geometry.points)).toEqual(before);
  expect(FakeWorker.instances).toHaveLength(1);
  expect(FakeWorker.instances[0].terminated).toBe(true);
});
it.each([true, false])(
  "retains prepared labels and samples across changed poses (parallel %s)",
  async (parallel) => {
    install();
    const data = input(),
      prepared = executeGlobalScenePreparation(data),
      pool = await createPreparedGlobalQueryPool(data, { parallel });
    expect(pool.physicalWorkers).toBe(parallel ? 2 : 1);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    for (const offset of [0, 0.5]) {
      const poses = data.scans.map((s, i) => ({
        id: s.id,
        matrix: [1, 0, 0, i ? offset : 0, 0, 1, 0, 0, 0, 0, 1, 0],
      }));
      const job = {
        sourceId: "0",
        poses,
        radius: 5,
        mode: "target-average" as const,
      };
      const placed = data.scans.map((s, i) => ({
        ...s,
        ...poses[i],
        geometry: { ...s.geometry, labels: prepared.sources[i].labels },
      }));
      expect(await pool.execute(job)).toEqual(
        nativeGlobalQuery({
          ...job,
          source: placed[0],
          targets: placed,
          cells: prepared.sources[0].selected,
        }),
      );
    }
    expect(FakeWorker.instances).toHaveLength(parallel ? 3 : 2);
    pool.close();
    pool.close();
    expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
    await expect(
      pool.execute({ sourceId: "0", poses: [], radius: 5 }),
    ).rejects.toThrow(/closed/);
  },
);
it("cancels preparation and admits a later request", async () => {
  install();
  FakeWorker.hold = true;
  const controller = new AbortController();
  const promise = prepareGlobalScene(input(), controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.instances[0].terminated).toBe(true);
  FakeWorker.hold = false;
  await expect(prepareGlobalScene(input())).resolves.toHaveProperty("sources");
});
it("rejects simultaneous preparation without spawning a duplicate worker", async () => {
  install();
  FakeWorker.hold = true;
  const controller = new AbortController();
  const promise = prepareGlobalScene(input(), controller.signal);
  await expect(prepareGlobalScene(input())).rejects.toThrow(/already running/);
  expect(FakeWorker.instances).toHaveLength(1);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
it("times out a blocked preparation worker", async () => {
  install();
  vi.useFakeTimers();
  FakeWorker.hold = true;
  const promise = prepareGlobalScene(input());
  const assertion = expect(promise).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(120_000);
  await assertion;
  expect(FakeWorker.instances[0].terminated).toBe(true);
});
it("releases preparation and query workers on initialization failure", async () => {
  install();
  FakeWorker.failAt = 1;
  await expect(createPreparedGlobalQueryPool(input())).rejects.toThrow(
    /injected failure/,
  );
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
});
it("releases a worker with a malformed response", async () => {
  install();
  FakeWorker.hold = true;
  const pending = prepareGlobalScene(input());
  FakeWorker.instances[0].onmessage?.({ data: null });
  await expect(pending).rejects.toThrow(/Invalid global scene worker response/);
  expect(FakeWorker.instances[0].terminated).toBe(true);
});
it("uses the preparation mask by default for correspondence queries", async () => {
  install();
  const data = input();
  data.mask = 2;
  data.scans[1].geometry.flags = Uint32Array.from({ length: 500 }, (_, i) =>
    i % 2 ? 2 : 0,
  );
  const prepared = executeGlobalScenePreparation(data),
    pool = await createPreparedGlobalQueryPool(data);
  const readMask = vi.fn(() => {
    throw new Error("Prepared query reread its input mask.");
  });
  Object.defineProperty(data, "mask", { get: readMask });
  try {
    const poses = data.scans.map((s) => ({
      id: s.id,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    }));
    const placed = data.scans.map((s, i) => ({
      ...s,
      ...poses[i],
      geometry: { ...s.geometry, labels: prepared.sources[i].labels },
    }));
    const job = {
      sourceId: "0",
      poses,
      radius: 5,
      mode: "target-average" as const,
    };
    const expected = nativeGlobalQuery({
      ...job,
      mask: 2,
      cells: prepared.sources[0].selected,
      source: placed[0],
      targets: placed,
    });
    expect(expected.count).toBeGreaterThan(0);
    expect(expected.count).toBeLessThan(500);
    expect(await pool.execute(job)).toEqual(expected);
    expect(readMask).not.toHaveBeenCalled();
  } finally {
    pool.close();
  }
});
it("releases the prepared session on abort", async () => {
  install();
  const controller = new AbortController();
  const pool = await createPreparedGlobalQueryPool(input(), {
    signal: controller.signal,
  });
  controller.abort();
  expect(FakeWorker.instances.every((w) => w.terminated)).toBe(true);
  await expect(
    pool.execute({ sourceId: "0", poses: [], radius: 5 }),
  ).rejects.toThrow(/closed/);
});
it("rejects replay clock mismatches and malformed IDs before worker admission", async () => {
  install();
  const data = input();
  data.scans[1].id = data.scans[0].id;
  await expect(prepareGlobalScene(data)).rejects.toThrow(/unique/);
  expect(FakeWorker.instances).toHaveLength(0);
  expect(() =>
    executeGlobalScenePreparation({ ...input(), clocks: [[1]] }),
  ).toThrow(/scan count/);
  expect(() =>
    executeGlobalScenePreparation({ ...input(), clocks: [[1], []] }),
  ).toThrow(/complete replay/);
  const size = new Float32Array(4_000_000 * 3);
  expect(() =>
    globalSceneAdmission({
      scans: [{ id: "big", geometry: { points: size, normals: size } }],
    }),
  ).toThrow(/admission/);
});

it.each(["complete", "error", "abort"] as const)(
  "detaches all preparation handlers after %s",
  async (outcome) => {
    install();
    FakeWorker.hold = outcome === "abort";
    FakeWorker.failAt = outcome === "error" ? 0 : -1;
    const controller = new AbortController();
    const pending = prepareGlobalScene(input(), controller.signal);
    try {
      if (outcome === "abort") {
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      } else if (outcome === "error")
        await expect(pending).rejects.toThrow("injected failure");
      else await pending;
      expect(FakeWorker.instances).toHaveLength(1);
      const worker = FakeWorker.instances[0];
      expect(worker.terminated).toBe(true);
      expect(worker.onmessage).toBeNull();
      expect(worker.onerror).toBeNull();
      expect(worker.onmessageerror).toBeNull();
    } finally {
      controller.abort();
    }
  },
);

it("rejects cancelled preparation before reading the input", async () => {
  install();
  const readInput = vi.fn();
  const unreadableInput = new Proxy(input(), {
    get() {
      readInput();
      throw new Error("Cancelled preparation accessed its input.");
    },
  });
  await expect(
    prepareGlobalScene(unreadableInput, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(readInput).not.toHaveBeenCalled();
  expect(FakeWorker.instances).toHaveLength(0);
});

it.each([
  {
    name: "explicit zero overrides the prepared mask",
    preparedMask: 2,
    queryMask: 0,
  },
  {
    name: "omitted masks retain native default zero",
    preparedMask: undefined,
    queryMask: undefined,
  },
])("preserves exact prepared-query mask semantics: $name", async (sample) => {
  install();
  const data = input();
  if (sample.preparedMask !== undefined) data.mask = sample.preparedMask;
  data.scans[1].geometry.flags = Uint32Array.from({ length: 500 }, (_, i) =>
    i % 2 ? 2 : 0,
  );
  const prepared = executeGlobalScenePreparation(data),
    pool = await createPreparedGlobalQueryPool(data);
  try {
    const poses = data.scans.map((s) => ({
      id: s.id,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    }));
    const placed = data.scans.map((s, i) => ({
      ...s,
      ...poses[i],
      geometry: { ...s.geometry, labels: prepared.sources[i].labels },
    }));
    const job = {
      sourceId: "0",
      poses,
      radius: 5,
      mode: "target-average" as const,
      ...(sample.queryMask === undefined ? {} : { mask: sample.queryMask }),
    };
    const oracle = {
      ...job,
      cells: prepared.sources[0].selected,
      source: placed[0],
      targets: placed,
    };
    const expected = nativeGlobalQuery({ ...oracle, mask: 0 });
    const masked = nativeGlobalQuery({ ...oracle, mask: 2 });
    expect(expected.count).toBeGreaterThan(masked.count);
    expect(await pool.execute(job)).toEqual(expected);
  } finally {
    pool.close();
  }
});
