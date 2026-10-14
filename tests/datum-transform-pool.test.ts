import { afterEach, expect, it, vi } from "vitest";
import native from "./fixtures/alignment-datum-mesh-transform-native.json";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import {
  executeDatumTransform,
  type DatumTransformRequest,
} from "../src/datum-transform-worker";
import { transformDatumCoordinates } from "../src/datum-alignment";
class TestWorker {
  static instances: TestWorker[] = [];
  static fail = false;
  terminated = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(input: DatumTransformRequest, transfer: Transferable[]) {
    const data = structuredClone(input, { transfer });
    queueMicrotask(() => {
      if (this.terminated) return;
      if (TestWorker.fail) {
        this.onerror?.({ message: "worker failure" });
        return;
      }
      try {
        this.onmessage?.({ data: executeDatumTransform(data) });
      } catch (error) {
        this.onmessage?.({ data: { id: data.id, error: String(error) } });
      }
    });
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
function floats(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
it.each(native.cases)(
  "preserves original worker bytes through transferable CPU tasks: $name",
  async (sample) => {
    install();
    const pool = createDatumTransformExecutor({ threshold: 0 });
    try {
      const b = Buffer.from(sample.matrixBits, "hex"),
        matrix = Array.from({ length: 12 }, (_, i) => b.readDoubleLE(i * 8));
      const input = floats(sample.positionsBits),
        before = Buffer.from(input.buffer).toString("hex");
      const points = await pool.transform(input, matrix),
        normals = await pool.transform(
          floats(sample.normalsBits),
          matrix,
          true,
        );
      expect(points.execution.physicalWorkers).toBe(2);
      expect(Buffer.from(points.output.buffer).toString("hex")).toBe(
        sample.nativePositionsBits,
      );
      expect(Buffer.from(normals.output.buffer).toString("hex")).toBe(
        sample.nativeNormalsBits,
      );
      expect(Buffer.from(input.buffer).toString("hex")).toBe(before);
    } finally {
      pool.close();
    }
    expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(
      true,
    );
  },
);
it("joins multiple chunks including a partial tail without changing source precision", async () => {
  install();
  const pool = createDatumTransformExecutor({ threshold: 0 });
  const input = Float32Array.from({ length: 262_144 * 6 + 3 }, (_, i) =>
    i % 3 === 0 ? 1 / 3 : -i / 10000,
  );
  const before = input.slice(),
    matrix = [...identity];
  matrix[3] = 1.2345;
  try {
    const result = await pool.transform(input, matrix);
    expect(
      Buffer.compare(
        Buffer.from(result.output.buffer),
        Buffer.from(transformDatumCoordinates(input, matrix).buffer),
      ),
    ).toBe(0);
    expect(
      Buffer.compare(Buffer.from(input.buffer), Buffer.from(before.buffer)),
    ).toBe(0);
    const authored = [1 / 3, -Math.PI, Math.SQRT2];
    const precise = await pool.transform(authored, matrix);
    expect(precise.output).toEqual(transformDatumCoordinates(authored, matrix));
  } finally {
    pool.close();
  }
  expect(TestWorker.instances).toHaveLength(2);
});
it("uses identical cancellable serial output on memory admission and explicit serial request", async () => {
  install();
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 2 });
  for (const parallel of [true, false]) {
    const pool = createDatumTransformExecutor({ parallel, threshold: 0 });
    try {
      const result = await pool.transform([1, 2, 3], identity);
      expect(result.output).toEqual(new Float32Array([1, 2, 3]));
      expect(result.execution.physicalWorkers).toBe(0);
    } finally {
      pool.close();
    }
  }
  expect(TestWorker.instances).toHaveLength(0);
});
it("cancels pending CPU tasks and terminates every worker", async () => {
  install();
  const controller = new AbortController(),
    pool = createDatumTransformExecutor({
      signal: controller.signal,
      threshold: 0,
    });
  const pending = pool.transform(new Float32Array(400002), identity);
  controller.abort();
  await expect(pending).rejects.toThrow();
  pool.close();
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
it("fails closed on worker errors and releases the pool", async () => {
  install();
  TestWorker.fail = true;
  const pool = createDatumTransformExecutor({ threshold: 0 });
  try {
    await expect(
      pool.transform(new Float32Array(400002), identity),
    ).rejects.toThrow("worker failure");
  } finally {
    pool.close();
  }
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
