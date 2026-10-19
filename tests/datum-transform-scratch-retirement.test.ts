import { afterEach, expect, it, vi } from "vitest";
import {
  transformDatumCoordinates,
  transformDatumCoordinateStages,
} from "../src/datum-transform-kernel";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import {
  executeDatumTransform,
  type DatumTransformRequest,
  type DatumTransformResponse,
} from "../src/datum-transform-worker";
const task = vi.hoisted(() => ({
  yields: 0,
  onYield: undefined as undefined | (() => void | Promise<void>),
}));
vi.mock("../src/scan-task", () => ({
  yieldScanTask: async () => {
    task.yields++;
    await task.onYield?.();
  },
}));
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const transferDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "transfer",
);
const hasTransfer = typeof transferDescriptor?.value === "function";
const prototype = ArrayBuffer.prototype as unknown as {
  transfer: (length?: number) => ArrayBuffer;
};
/** Native zero-copy byte equality avoids allocating matcher graphs for MiB buffers. */
function exactBytes(actual: Float32Array, expected: Float32Array) {
  expect(actual.byteLength).toBe(expected.byteLength);
  const a = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
  const b = Buffer.from(
    expected.buffer,
    expected.byteOffset,
    expected.byteLength,
  );
  expect(Buffer.compare(a, b)).toBe(0);
}
function observeTransfers() {
  const original = prototype.transfer,
    retired: ArrayBuffer[] = [];
  vi.spyOn(prototype, "transfer").mockImplementation(function (
    this: ArrayBuffer,
    length,
  ) {
    retired.push(this);
    return original.call(this, length);
  });
  return retired;
}
class CapturingWorker {
  static results: DatumTransformResponse[] = [];
  static instances: CapturingWorker[] = [];
  static dispatch:
    | undefined
    | ((
        worker: CapturingWorker,
        input: DatumTransformRequest,
        lane: number,
      ) => void);
  static throwFirstPost = false;
  onmessage?: ((event: { data: DatumTransformResponse }) => void) | null;
  onerror?: ((event: { message: string }) => void) | null;
  terminated = false;
  readonly lane: number;
  constructor() {
    this.lane = CapturingWorker.instances.length;
    CapturingWorker.instances.push(this);
  }
  emit(input: DatumTransformRequest) {
    const output = executeDatumTransform(input);
    CapturingWorker.results.push(output);
    this.onmessage?.({ data: output });
    return output;
  }
  postMessage(input: DatumTransformRequest, transfer: Transferable[]) {
    if (CapturingWorker.throwFirstPost && this.lane === 0)
      throw Error("First lane send failed");
    const copy = structuredClone(input, { transfer });
    if (CapturingWorker.dispatch)
      CapturingWorker.dispatch(this, copy, this.lane);
    else
      queueMicrotask(() => {
        if (!this.terminated) this.emit(copy);
      });
  }
  terminate() {
    this.terminated = true;
  }
}
function install() {
  vi.stubGlobal("Worker", CapturingWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
}
function chunkOutputs() {
  return CapturingWorker.results.flatMap((result) =>
    "output" in result ? [result.output] : [],
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  if (transferDescriptor)
    Object.defineProperty(
      ArrayBuffer.prototype,
      "transfer",
      transferDescriptor,
    );
  else Reflect.deleteProperty(ArrayBuffer.prototype, "transfer");
  vi.unstubAllGlobals();
  task.yields = 0;
  task.onYield = undefined;
  CapturingWorker.results.length = CapturingWorker.instances.length = 0;
  CapturingWorker.dispatch = undefined;
  CapturingWorker.throwFirstPost = false;
});

it.skipIf(!hasTransfer)(
  "retires only prior private Float32 stages while preserving native stage rounding",
  () => {
    const input = Float32Array.of(1e8, -0, 3),
      before = input.slice();
    const a = [...identity],
      b = [...identity];
    a[3] = b[3] = 3;
    const expected = transformDatumCoordinates(
      transformDatumCoordinates(input, a),
      b,
    );
    const retired = observeTransfers();
    const output = transformDatumCoordinateStages(input, [a, b]);
    exactBytes(output, expected);
    exactBytes(input, before);
    expect(retired).toHaveLength(1);
    expect(retired[0].byteLength).toBe(0);
    expect(retired).not.toContain(input.buffer);
    expect(retired).not.toContain(output.buffer);
  },
);

it.skipIf(!hasTransfer)(
  "retires consumed chunks at the actual scheduled yield before batch two and after a partial tail",
  async () => {
    install();
    const input = Float32Array.from({ length: 2 * 262144 * 3 + 3 }, (_, i) =>
      i % 3 === 0 ? 1e8 : i % 3 === 1 ? -0 : 1e-30,
    );
    const before = input.slice(),
      a = [...identity],
      b = [...identity];
    a[3] = b[3] = 3;
    const expected = transformDatumCoordinates(
      transformDatumCoordinates(input, a),
      b,
    );
    const observations: number[] = [];
    task.onYield = () => {
      observations.push(chunkOutputs().length);
      expect(chunkOutputs().every((output) => output.byteLength === 0)).toBe(
        true,
      );
      if (observations.length === 1) expect(chunkOutputs()).toHaveLength(2);
      exactBytes(input, before);
    };
    const executor = createDatumTransformExecutor({ threshold: 0 });
    try {
      const result = await executor.transformStages(input, [a, b]);
      exactBytes(result.output, expected);
      expect(observations).toEqual([2, 3]);
      expect(result.execution.chunkVertices).toBe(262144);
    } finally {
      executor.close();
    }
    expect(
      CapturingWorker.instances.every(
        (worker) => worker.terminated && !worker.onmessage && !worker.onerror,
      ),
    ).toBe(true);
  },
);

it.each(["unavailable", "throws"] as const)(
  "preserves exact output and authored storage when transfer is %s",
  async (mode) => {
    if (mode === "unavailable")
      Object.defineProperty(ArrayBuffer.prototype, "transfer", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    else if (hasTransfer)
      vi.spyOn(prototype, "transfer").mockImplementation(() => {
        throw Error("retirement unavailable");
      });
    const input = Float32Array.of(1e8, -0, 1e-30),
      before = input.slice();
    const a = [...identity],
      b = [...identity];
    a[3] = b[3] = 3;
    const expected = transformDatumCoordinates(
      transformDatumCoordinates(input, a),
      b,
    );
    const executor = createDatumTransformExecutor({ parallel: false });
    try {
      const result = await executor.transformStages(input, [a, b]);
      exactBytes(result.output, expected);
      exactBytes(input, before);
      expect(result.output.byteLength).toBe(expected.byteLength);
      if (mode === "throws" && hasTransfer)
        expect(prototype.transfer).toHaveBeenCalled();
    } finally {
      executor.close();
    }
  },
);

it.skipIf(!hasTransfer)(
  "retires the previous owned stage when a later stage fails without detaching authored input",
  () => {
    const input = Float32Array.of(1, -0, 3),
      before = input.slice();
    const retired = observeTransfers(),
      invalid = [...identity];
    invalid[0] = NaN;
    expect(() =>
      transformDatumCoordinateStages(input, [identity, invalid]),
    ).toThrow("finite");
    expect(retired).toHaveLength(1);
    expect(retired[0].byteLength).toBe(0);
    exactBytes(input, before);
    expect(retired).not.toContain(input.buffer);
  },
);

it.skipIf(!hasTransfer)(
  "retires a completed private lane when another lane is pending during cancellation",
  async () => {
    install();
    CapturingWorker.dispatch = (worker, input, lane) => {
      if (lane === 0) worker.emit(input);
    };
    const input = new Float32Array(2 * 262144 * 3),
      before = input.slice(),
      controller = new AbortController();
    const executor = createDatumTransformExecutor({
      threshold: 0,
      signal: controller.signal,
    });
    const pending = executor.transformStages(input, [identity, identity]);
    await Promise.resolve();
    await Promise.resolve();
    expect(chunkOutputs()).toHaveLength(1);
    controller.abort();
    try {
      await expect(pending).rejects.toThrow();
      expect(chunkOutputs()[0].byteLength).toBe(0);
      exactBytes(input, before);
    } finally {
      executor.close();
    }
    expect(CapturingWorker.instances.every((worker) => worker.terminated)).toBe(
      true,
    );
  },
);

it.skipIf(!hasTransfer)(
  "retires the other lane's late success after one lane send has already failed",
  async () => {
    install();
    CapturingWorker.throwFirstPost = true;
    let late: undefined | (() => DatumTransformResponse);
    CapturingWorker.dispatch = (worker, input) => {
      late = () => worker.emit(input);
    };
    const input = new Float32Array(2 * 262144 * 3),
      before = input.slice();
    const executor = createDatumTransformExecutor({ threshold: 0 });
    try {
      await expect(
        executor.transformStages(input, [identity, identity]),
      ).rejects.toThrow("First lane send failed");
      expect(late).toBeTypeOf("function");
      const result = late!();
      await Promise.resolve();
      await Promise.resolve();
      expect("output" in result).toBe(true);
      if ("output" in result) expect(result.output.byteLength).toBe(0);
      exactBytes(input, before);
    } finally {
      executor.close();
    }
  },
);
