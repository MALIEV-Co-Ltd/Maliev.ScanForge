import { afterEach, expect, it, vi } from "vitest";
import captured from "./fixtures/alignment-native-dispatch.json";
import {
  createAlignmentWorkerState,
  type AlignmentWorkerRequest,
} from "../src/scan-alignment-worker";
import { nativeRefineAlignmentSurfaceAsync } from "../src/scan-native-alignment-surface-search";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";
import { nativeAlignmentSixTransform } from "../src/scan-native-alignment-transform";
import {
  createAlignmentPool,
  alignmentCanInitializeTogether,
  alignmentPoolAdmission,
} from "../src/scan-alignment-pool";
import { nativeRefinementSimplexAsync } from "../src/scan-native-refinement-simplex";

class TestWorker {
  static instances: TestWorker[] = [];
  static fail = false;
  terminated = false;
  initializations = 0;
  state?: ReturnType<typeof createAlignmentWorkerState>;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(input: AlignmentWorkerRequest) {
    const data = structuredClone(input);
    const reply = () => {
      if (this.terminated) return;
      if (TestWorker.fail) {
        this.onerror?.({ message: "test worker failed" });
        return;
      }
      if ("initialize" in data) {
        this.initializations++;
        this.state = createAlignmentWorkerState(data.initialize);
        this.onmessage?.({ data: { id: data.id, ready: true } });
      } else
        this.onmessage?.({ data: { id: data.id, ...this.state!(data.job) } });
    };
    // Reply from the second lane first; reduction must ignore arrival order.
    if (TestWorker.instances.indexOf(this) === 0)
      queueMicrotask(() => queueMicrotask(reply));
    else queueMicrotask(reply);
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  TestWorker.instances = [];
  TestWorker.fail = false;
});
function install() {
  vi.stubGlobal("Worker", TestWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
}
function input(sample: (typeof captured.samples)[number]) {
  const surfaces = sample.targetPlanes.map(([height, normal]) => {
    const target = prepareNativeAlignmentSurface(
      new Float32Array([0, 0, height, 2, 0, height, 0, 2, height]),
      new Uint32Array([0, 1, 2]),
    )!;
    target.surface.normals[2] = normal;
    return target.surface;
  });
  const lanes = sample.lanes.map((heights, lane) =>
    heights.map((height) => ({
      point: [0.5, 0.5, Math.fround(height)],
      normal: [0, 0, sample.normals[lane]],
      flags: 4,
    })),
  );
  return { surfaces, lanes };
}
it.each(captured.samples)(
  "preserves native concurrent dispatch output and flags: $name",
  async (sample) => {
    install();
    const { surfaces, lanes } = input(sample);
    const result = await nativeRefineAlignmentSurfaceAsync(
      sample.search.initial,
      lanes,
      surfaces,
      { step: sample.search.step, budget: 1000, initialRadius: 1e30 },
    );
    expect(result.initialError).toBe(sample.search.initialError);
    expect(result.best).toBe(sample.search.best);
    expect(result.parameters).toEqual(sample.search.parameters);
    expect(result.flags).toEqual(sample.search.flags);
    expect(result.converged).toBe(sample.search.accepted);
    expect(nativeAlignmentSixTransform(result.parameters)).toEqual(
      sample.search.matrix,
    );
    expect(result.physicalWorkers).toBe(sample.lanes.length > 1 ? 2 : 1);
    for (const worker of TestWorker.instances) {
      expect(worker.initializations).toBe(1);
      expect(worker.terminated).toBe(true);
    }
  },
);
it("terminates both workers on initialization failure", async () => {
  install();
  TestWorker.fail = true;
  const { surfaces, lanes } = input(
    captured.samples.find((sample) => sample.lanes.length > 1)!,
  );
  await expect(createAlignmentPool(lanes, surfaces)).rejects.toThrow(
    "test worker failed",
  );
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
it("aborting a ready pool releases both workers and rejects further evaluations", async () => {
  install();
  const { surfaces, lanes } = input(
    captured.samples.find((sample) => sample.lanes.length > 1)!,
  );
  const abort = new AbortController();
  const pool = await createAlignmentPool(lanes, surfaces, {
    signal: abort.signal,
  });
  abort.abort();
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
  await expect(
    pool.execute({
      kind: "orientation",
      lanes,
      options: { transform: [], rotation: [] },
    }),
  ).rejects.toThrow("cancelled");
});
it("memory admission uses the same logical lanes serially", async () => {
  install();
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 2 });
  const { surfaces, lanes } = input(
    captured.samples.find((sample) => sample.lanes.length > 1)!,
  );
  const pool = await createAlignmentPool(lanes, surfaces);
  expect(pool.physicalWorkers).toBe(1);
  expect(pool.fallbackReason).toBe("device memory admission");
  expect(TestWorker.instances).toHaveLength(0);
  pool.close();
});
it("shares owned immutable target copies on isolated origins", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const { surfaces, lanes } = input(
    captured.samples.find((sample) => sample.lanes.length > 1)!,
  );
  const before = Array.from(surfaces[0].points);
  const pool = await createAlignmentPool(lanes, surfaces);
  expect(pool.physicalWorkers).toBe(2);
  expect(Array.from(surfaces[0].points)).toEqual(before);
  pool.close();
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
it("rejects nonfinite asynchronous objectives", async () => {
  await expect(
    nativeRefinementSimplexAsync([0, 0, 0, 0, 0, 0], async () => NaN),
  ).rejects.toThrow();
});
it("checks cancellation after an asynchronous objective before another evaluation", async () => {
  const abort = new AbortController();
  let calls = 0;
  await expect(
    nativeRefinementSimplexAsync(
      [0, 0, 0, 0, 0, 0],
      async () => {
        calls++;
        abort.abort();
        return 0;
      },
      { signal: abort.signal },
    ),
  ).rejects.toThrow("cancelled");
  expect(calls).toBe(1);
});

it("initializes both isolated workers before waiting for either target acknowledgement", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const held: (() => void)[] = [];
  class BarrierWorker extends TestWorker {
    postMessage(message: AlignmentWorkerRequest) {
      if (!("initialize" in message)) return super.postMessage(message);
      this.initializations++;
      this.state = createAlignmentWorkerState(
        structuredClone(message.initialize),
      );
      held.push(() =>
        this.onmessage?.({ data: { id: message.id, ready: true } }),
      );
    }
  }
  vi.stubGlobal("Worker", BarrierWorker);
  const { surfaces, lanes } = input(
    captured.samples.find((sample) => sample.lanes.length > 1)!,
  );
  const abort = new AbortController();
  const pending = createAlignmentPool(lanes, surfaces, {
    signal: abort.signal,
  });
  const settled = pending.catch(() => undefined);
  try {
    expect(TestWorker.instances).toHaveLength(2);
    expect(
      TestWorker.instances.map((worker) => worker.initializations),
    ).toEqual([1, 1]);
    for (const ready of held) ready();
    const pool = await pending;
    pool.close();
    expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(
      true,
    );
  } finally {
    abort.abort();
    await settled;
  }
});
it("retains sequential initialization when overlapping tree copies exceed the unchanged memory cap", () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const { surfaces, lanes } = input(
    captured.samples.find((sample) => sample.lanes.length > 1)!,
  );
  const tree = { ...surfaces[0].root, triangles: new Array<number>(3_400_000) };
  const large = [{ ...surfaces[0], root: tree }];
  expect(alignmentPoolAdmission(lanes, large)).toBeUndefined();
  expect(alignmentCanInitializeTogether(lanes, large)).toBe(false);
  expect(alignmentCanInitializeTogether(lanes, surfaces)).toBe(true);
  vi.stubGlobal("crossOriginIsolated", false);
  expect(alignmentCanInitializeTogether(lanes, surfaces)).toBe(false);
});
