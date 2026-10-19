import { afterEach, expect, it, vi } from "vitest";
import {
  nativeGlobalRefineOuter,
  type GlobalOuterState,
} from "../src/scan-native-global-outer";
import { NativeGlobalRandom } from "../src/scan-native-global-sampling";
import {
  CONTROL_BYTES,
  acknowledgeController,
  cancelController,
  createControllerBridge,
  assertControllerResult,
  assertChildCleanup,
  sharedControllerPacket,
  type Rpc,
} from "../src/scan-global-controller-protocol";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const frame = () => [1, -0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const scans = () =>
  ["a", "b", "c", "d"].map((id) => ({
    id,
    pointCount: 1,
    matrix: frame(),
    mean: NaN,
    std: Infinity,
  }));
const local = async (state: GlobalOuterState) => ({
  ...state,
  matrix: [...state.matrix],
  status: 0 as const,
  converged: true,
  stable: true,
  records: [],
});
function bits(value: unknown): unknown {
  if (typeof value === "number") {
    const v = new DataView(new ArrayBuffer(8));
    v.setFloat64(0, value);
    return v.getBigUint64(0).toString(16);
  }
  if (Array.isArray(value)) return value.map(bits);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, bits(v)]),
    );
  return value;
}

it("keeps the native outer seed/pass/shuffle bits and synchronously ACKs before continuation", async () => {
  const direct = await nativeGlobalRefineOuter(scans(), local, {
    clock: () => 424242,
  });
  const control = new SharedArrayBuffer(CONTROL_BYTES),
    pending: Rpc[] = [],
    trace: string[] = [];
  let clocks = 0;
  const originalScaled = NativeGlobalRandom.prototype.scaled;
  vi.spyOn(NativeGlobalRandom.prototype, "scaled").mockImplementation(function (
    this: NativeGlobalRandom,
    maximum,
  ) {
    trace.push("shuffle");
    return originalScaled.call(this, maximum);
  });
  vi.spyOn(Atomics, "wait").mockImplementation(() => {
    const request = pending.shift()!;
    trace.push("parent:" + request.action);
    acknowledgeController(
      control,
      request.requestId,
      request.action === "clock" ? (clocks++, 424242) : 0,
    );
    trace.push("ack:" + request.action + ":" + String(request.pass ?? ""));
    return "ok";
  });
  const rpc = createControllerBridge(control, 1, (request) => {
    trace.push("post:" + request.action);
    pending.push(request);
  });
  const actual = await nativeGlobalRefineOuter(
    scans(),
    async (state) => {
      trace.push("local:" + state.id);
      return local(state);
    },
    {
      clock: () => rpc({ action: "clock" }),
      onProgress: (pass, _total, ordered) => {
        rpc({ action: "pass", pass, ordered });
        trace.push("native-after-pass:" + pass);
      },
    },
  );
  expect(bits(actual)).toEqual(bits(direct));
  expect(clocks).toBe(1);
  expect(trace.indexOf("ack:clock:")).toBeLessThan(trace.indexOf("post:pass"));
  expect(trace.indexOf("ack:pass:0")).toBeLessThan(
    trace.findIndex((v) => v.startsWith("local:")),
  );
  expect(trace.indexOf("ack:pass:1")).toBeLessThan(trace.indexOf("shuffle"));
  expect(trace.indexOf("ack:pass:1")).toBeLessThan(
    trace.indexOf("native-after-pass:1"),
  );
});

it.each([-0, NaN, Infinity, 0xffffffff])(
  "publishes exact F64 clock value %s before original native validation",
  async (seed) => {
    const control = new SharedArrayBuffer(CONTROL_BYTES);
    const rpc = createControllerBridge(control, 2, (request) =>
      acknowledgeController(control, request.requestId, seed),
    );
    const received = rpc({ action: "clock" });
    expect(Object.is(received, seed)).toBe(true);
    if (Number.isNaN(seed) || seed === Infinity) {
      await expect(
        nativeGlobalRefineOuter(scans(), local, { clock: () => received }),
      ).rejects.toThrow("Invalid global outer tolerance or clock seed");
    } else {
      const result = await nativeGlobalRefineOuter(scans(), local, {
        clock: () => received,
      });
      expect(Object.is(result.seed, seed)).toBe(true);
    }
  },
);

it("observes cancellation while waiting without a worker message event", () => {
  const control = new SharedArrayBuffer(CONTROL_BYTES);
  const next = vi.fn();
  vi.spyOn(Atomics, "wait").mockImplementation(() => {
    cancelController(control);
    return "ok";
  });
  const rpc = createControllerBridge(control, 3, () => {});
  expect(() => {
    rpc({ action: "check" });
    next();
  }).toThrow("cancelled");
  expect(next).not.toHaveBeenCalled();
});
it("does not lose cancellation between flag check and native waiter registration", () => {
  const control = new SharedArrayBuffer(CONTROL_BYTES);
  const nativeWait = Atomics.wait;
  const statuses: string[] = [];
  const next = vi.fn();
  vi.spyOn(Atomics, "wait").mockImplementation((words, index, expected) => {
    cancelController(control);
    const status = nativeWait(words, index, expected, 100);
    statuses.push(status);
    return status;
  });
  const rpc = createControllerBridge(control, 30, () => {});
  expect(() => {
    rpc({ action: "check" });
    next();
  }).toThrow("cancelled");
  expect(statuses).toEqual(["not-equal"]);
  expect(next).not.toHaveBeenCalled();
});
it("cancellation after ACK still prevents the next native instruction", () => {
  const control = new SharedArrayBuffer(CONTROL_BYTES);
  const next = vi.fn();
  const rpc = createControllerBridge(control, 31, (request) => {
    acknowledgeController(control, request.requestId, -0);
    cancelController(control);
  });
  expect(() => {
    rpc({ action: "clock" });
    next();
  }).toThrow("cancelled");
  expect(next).not.toHaveBeenCalled();
});
it("bounds a missing ACK and cannot execute the next native instruction", () => {
  const control = new SharedArrayBuffer(CONTROL_BYTES);
  const next = vi.fn();
  vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
  const rpc = createControllerBridge(control, 4, () => {});
  expect(() => {
    rpc({ action: "check" });
    next();
  }).toThrow("acknowledgment timed out");
  expect(next).not.toHaveBeenCalled();
});
it("a failed callback ACK unwinds the synchronous hook", () => {
  const control = new SharedArrayBuffer(CONTROL_BYTES);
  const rpc = createControllerBridge(control, 5, (request) =>
    acknowledgeController(control, request.requestId, 0, true),
  );
  expect(() => rpc({ action: "pass", pass: 0, ordered: [] })).toThrow(
    "parent callback failed",
  );
});

const result = () => {
  const states = scans()
    .slice(0, 2)
    .map((s) => ({ ...s, converged: true, stable: true }));
  return {
    mode: "target-average",
    queries: 0,
    queryWorkers: 1,
    localResults: [],
    outer: {
      passes: 1,
      order: ["a", "b"],
      states,
      gaugeId: "a",
      seed: -0,
      applications: ["a", "b", "a", "b"].map((id) => ({ id, matrix: frame() })),
    },
  };
};
it("accepts native nonfinite diagnostics and signed zero, rejecting geometry/invalid bounded fields", () => {
  const ids = new Map([
    ["a", 1],
    ["b", 1],
  ]);
  const valid = structuredClone(result());
  expect(() => assertControllerResult(valid, ids)).not.toThrow();
  expect(Object.is(valid.outer.seed, -0)).toBe(true);
  expect(Number.isNaN(valid.outer.states[0].mean)).toBe(true);
  for (const geometry of [
    new SharedArrayBuffer(32),
    new Float32Array(2),
    { points: [] },
  ])
    expect(() =>
      assertControllerResult({ ...result(), geometry }, ids),
    ).toThrow();
  const bad = result();
  bad.outer.applications[0].matrix[0] = Infinity;
  expect(() => assertControllerResult(bad, ids)).toThrow();
  expect(() =>
    assertControllerResult(
      { ...result(), localResults: Array(609).fill({}) },
      ids,
    ),
  ).toThrow();
  expect(() =>
    assertControllerResult(
      { ...result(), outer: { ...result().outer, seed: NaN } },
      ids,
    ),
  ).toThrow();
});
it("does not accept an ordinary nonempty geometry buffer as an already-shared packet", () => {
  const points = new Float32Array(9),
    normals = new Float32Array(9);
  const input = {
    scans: ["a", "b"].map((id) => ({ id, geometry: { points, normals } })),
  };
  expect(sharedControllerPacket(input)).toBeUndefined();
  expect(sharedControllerPacket(input, false)).toBe(input);
  vi.stubGlobal("SharedArrayBuffer", undefined);
  expect(sharedControllerPacket(input, false)).toBeUndefined();
});
it("requires exactly the eligible state set, rejecting dropped or excluded scan results", () => {
  const valid = result();
  expect(() =>
    assertControllerResult(
      valid,
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ]),
    ),
  ).toThrow();
  expect(() =>
    assertControllerResult(
      valid,
      new Map([
        ["a", 1],
        ["eligible", 1],
      ]),
    ),
  ).toThrow();
});
it("keeps child cleanup bounded and distinguishes unconfirmed ownership from a stop request", () => {
  const child = {
    owner: "query:1:0",
    runId: 1,
    target: "scan-global-query-worker.ts:0",
    createdUnixMs: 1,
    expiresUnixMs: 900001,
    attempts: 3,
    status: "termination-unconfirmed",
    retained: true,
    errors: ["stop failed"],
  };
  expect(() => assertChildCleanup([])).not.toThrow();
  expect(() => assertChildCleanup([child])).not.toThrow();
  expect(() => assertChildCleanup([{ ...child, retained: false }])).toThrow();
  expect(() =>
    assertChildCleanup([{ ...child, errors: Array(4).fill("failure") }]),
  ).toThrow();
  expect(() =>
    assertChildCleanup([{ ...child, geometry: new SharedArrayBuffer(32) }]),
  ).toThrow();
  expect(() => assertChildCleanup([child, child])).toThrow();
});
