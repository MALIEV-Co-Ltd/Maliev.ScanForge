import { afterEach, expect, it, vi } from "vitest";
import { runGlobalScanController } from "../src/scan-global-controller-core";
import {
  CONTROL_BYTES,
  createControllerBridge,
  acknowledgeController,
  type Rpc,
} from "../src/scan-global-controller-protocol";
const state = vi.hoisted(() => ({ trace: [] as string[] }));
vi.mock("../src/scan-global-scene-client", () => ({
  createPreparedGlobalQueryPool: async () => {
    state.trace.push("pool-ready");
    return {
      physicalWorkers: 1,
      scanIds: ["a", "b"],
      execute: async (job: { sourceId: string }) => {
        state.trace.push("query:" + job.sourceId);
        return { count: 0, pairs: [] };
      },
      close: () => {
        state.trace.push("pool-close");
      },
    };
  },
}));
vi.mock("../src/scan-native-global-local", () => ({
  nativeGlobalRefineLocal: async (
    source: { id: string; matrix: number[] },
    query: (matrix: number[]) => Promise<unknown>,
  ) => {
    state.trace.push("local:" + source.id);
    await query(source.matrix);
    return {
      ...source,
      mean: -0,
      std: NaN,
      status: 0,
      iterations: 1,
      converged: true,
      stable: true,
      records: [],
    };
  },
}));
afterEach(() => {
  state.trace = [];
  vi.restoreAllMocks();
});
const input = () => ({
  scans: ["a", "b"].map((id) => ({
    id,
    geometry: { points: new Float32Array(9), normals: new Float32Array(9) },
  })),
});
it("preserves the full check/clock/pass/progress/query/close trace, with no extra clock check", async () => {
  const source = input();
  const parent = {
    check: () => {
      state.trace.push("check");
    },
    clock: () => {
      state.trace.push("clock");
      return 424242;
    },
    onPass: (pass: number) => {
      state.trace.push("pass:" + pass);
    },
    onProgress: (fraction: number, stage: string) => {
      state.trace.push("progress:" + fraction + ":" + stage);
    },
  };
  const direct = await runGlobalScanController(
    source,
    source,
    parent,
    "target-average",
    5,
  );
  const expected = [...state.trace];
  state.trace = [];
  const control = new SharedArrayBuffer(CONTROL_BYTES);
  let pending: Rpc | undefined;
  vi.spyOn(Atomics, "wait").mockImplementation(() => {
    const request = pending!;
    pending = undefined;
    let value = 0;
    if (request.action === "check") parent.check();
    else if (request.action === "clock") value = parent.clock();
    else if (request.action === "pass") parent.onPass(request.pass!);
    else parent.onProgress(request.fraction!, request.stage!);
    acknowledgeController(control, request.requestId, value);
    return "ok";
  });
  const rpc = createControllerBridge(control, 1, (request) => {
    pending = request;
  });
  const isolated = await runGlobalScanController(
    source,
    source,
    {
      check: () => {
        rpc({ action: "check" });
      },
      clock: () => rpc({ action: "clock" }),
      onPass: (pass, ordered) => {
        rpc({ action: "pass", pass, ordered });
      },
      onProgress: (fraction, stage) => {
        rpc({ action: "progress", fraction, stage });
      },
    },
    "target-average",
    5,
  );
  expect(state.trace).toEqual(expected);
  expect(state.trace.filter((value) => value === "clock")).toHaveLength(1);
  const clockIndex = state.trace.indexOf("clock");
  expect(state.trace[clockIndex - 1]).toBe(
    "progress:0.2:Refining global scan poses",
  );
  expect(isolated).toEqual(direct);
});
it("closes the pool after a synchronous callback rejection before any subsequent controller work", async () => {
  const source = input(),
    sentinel = Error("original pass failure");
  await expect(
    runGlobalScanController(
      source,
      source,
      {
        clock: () => 1,
        onPass: () => {
          throw sentinel;
        },
      },
      "target-average",
      5,
    ),
  ).rejects.toBe(sentinel);
  expect(state.trace).toEqual(["pool-ready", "pool-close"]);
});
