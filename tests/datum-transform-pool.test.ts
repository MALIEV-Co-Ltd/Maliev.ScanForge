import { afterEach, expect, it, vi } from "vitest";
import native from "./fixtures/alignment-datum-mesh-transform-native.json";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import {
  executeDatumTransform,
  type DatumTransformRequest,
} from "../src/datum-transform-worker";
import { transformDatumCoordinates } from "../src/datum-alignment";
import { transformDatumCoordinateStages } from "../src/datum-transform-kernel";
class TestWorker {
  static instances: TestWorker[] = [];
  static fail = false;
  static inputs: ArrayBuffer[] = [];
  terminated = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(input: DatumTransformRequest, transfer: Transferable[]) {
    TestWorker.inputs.push(input.input.buffer as ArrayBuffer);
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
  TestWorker.inputs = [];
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
it.each([
  { sharedOutput: false, isolated: true, available: true, shared: false },
  { sharedOutput: true, isolated: false, available: true, shared: false },
  { sharedOutput: true, isolated: undefined, available: true, shared: false },
  { sharedOutput: true, isolated: true, available: false, shared: false },
  { sharedOutput: true, isolated: true, available: true, shared: true },
])(
  "gates final shared output without changing stage bytes: %j",
  async (mode) => {
    const Shared = globalThis.SharedArrayBuffer;
    vi.stubGlobal("crossOriginIsolated", mode.isolated);
    if (!mode.available) vi.stubGlobal("SharedArrayBuffer", undefined);
    const input = new Float32Array([1e8, -0, 1 / 3, -2, 3, 4]);
    const before = Buffer.from(input.buffer).toString("hex");
    const first = [...identity],
      second = [...identity];
    first[3] = second[3] = 3;
    const expected = transformDatumCoordinateStages(input, [first, second]);
    const pool = createDatumTransformExecutor({
      parallel: false,
      sharedOutput: mode.sharedOutput,
    });
    try {
      const result = await pool.transformStages(input, [first, second]);
      expect(result.output.buffer instanceof Shared).toBe(mode.shared);
      expect(Buffer.from(result.output.buffer).toString("hex")).toBe(
        Buffer.from(expected.buffer).toString("hex"),
      );
      expect(result.output[0]).toBe(1e8); // A composed +6 would round differently.
      expect(Buffer.from(input.buffer).toString("hex")).toBe(before);
      expect(result.output.buffer).not.toBe(input.buffer);
      expect(result.bounds).toEqual({
        min: [0, 1, 2].map((axis) =>
          Math.min(expected[axis], expected[axis + 3]),
        ),
        max: [0, 1, 2].map((axis) =>
          Math.max(expected[axis], expected[axis + 3]),
        ),
      });
    } finally {
      pool.close();
    }
  },
);
it("defaults to ordinary final output even in an isolated context", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const pool = createDatumTransformExecutor({ parallel: false });
  try {
    expect(
      (await pool.transform([1, 2, 3], identity)).output.buffer,
    ).toBeInstanceOf(ArrayBuffer);
  } finally {
    pool.close();
  }
});
it("cancels shared-output work without detaching authored input or leaving workers", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const controller = new AbortController(),
    input = new Float32Array(400002);
  input[0] = 7;
  const pool = createDatumTransformExecutor({
    threshold: 0,
    sharedOutput: true,
    signal: controller.signal,
  });
  try {
    const pending = pool.transformStages(input, [identity, identity]);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(input.byteLength).toBe(400002 * 4);
    expect(input[0]).toBe(7);
  } finally {
    pool.close();
  }
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
it("keeps shared final streams separate while transferring only disposable chunk copies", async () => {
  install();
  vi.stubGlobal("crossOriginIsolated", true);
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const vertices = positions.slice(),
    indexedNormals = normals.slice(),
    triangles = Uint32Array.of(0, 1, 2);
  const source = {
    id: "shared",
    name: "Shared",
    kind: "mesh" as const,
    positions,
    normals,
    indexedMesh: { vertices, triangles, normals: indexedNormals },
    visible: true,
    opacity: 1,
    color: "#aaa",
  };
  const inputs = [positions, normals, vertices, indexedNormals, triangles];
  const bytes = inputs.map((v) => Buffer.from(v.buffer).toString("hex"));
  const pool = createDatumTransformExecutor({
    threshold: 0,
    sharedOutput: true,
    typedNormals: true,
  });
  try {
    const output = (
      await pool.transformScanStages(source, [identity, identity])
    ).entity;
    const streams = [
      output.positions,
      output.normals!,
      output.indexedMesh!.vertices,
      output.indexedMesh!.normals!,
    ];
    expect(
      streams.every(
        (v) =>
          v instanceof Float32Array && v.buffer instanceof SharedArrayBuffer,
      ),
    ).toBe(true);
    expect(new Set(streams.map((v) => (v as Float32Array).buffer)).size).toBe(
      4,
    );
    expect(output.indexedMesh!.triangles).toBe(triangles);
    streams.forEach((v, i) =>
      expect(Buffer.from((v as Float32Array).buffer).toString("hex")).toBe(
        bytes[i],
      ),
    );
    expect(inputs.map((v) => Buffer.from(v.buffer).toString("hex"))).toEqual(
      bytes,
    );
    expect(TestWorker.inputs.length).toBeGreaterThan(0);
    expect(
      TestWorker.inputs.every(
        (buffer) => buffer instanceof ArrayBuffer && buffer.byteLength === 0,
      ),
    ).toBe(true);
  } finally {
    pool.close();
  }
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
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
it("keeps native stage rounding and snapshots frames across batches and a partial tail", async () => {
  install();
  const pool = createDatumTransformExecutor({ threshold: 0 });
  const input = new Float32Array(2 * 262144 * 3 + 3);
  for (let i = 0; i < input.length; i += 3) {
    input[i] = 1e8;
    input[i + 1] = 1;
    input[i + 2] = -2;
  }
  const before = input.slice(),
    frames = [[...identity], [...identity]];
  frames[0][3] = 3;
  frames[1][3] = 3;
  const expected = transformDatumCoordinateStages(before, frames);
  try {
    const pending = pool.transformStages(input, frames);
    frames[0][3] = 999;
    frames[1][3] = 999;
    const result = await pending;
    expect(
      Buffer.compare(
        Buffer.from(result.output.buffer),
        Buffer.from(expected.buffer),
      ),
    ).toBe(0);
    expect(result.output.at(-3)).toBe(1e8);
    expect(result.execution.physicalWorkers).toBe(2);
    expect(
      Buffer.compare(Buffer.from(input.buffer), Buffer.from(before.buffer)),
    ).toBe(0);
  } finally {
    pool.close();
  }
  expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
});
it("collects final-stage bounds and never translates normal streams", async () => {
  install();
  const pool = createDatumTransformExecutor({ threshold: 0 });
  const a = [...identity],
    b = [...identity];
  a[3] = 10;
  b[3] = -10;
  try {
    const result = await pool.transformStages(new Float32Array([1, 2, 3]), [
      a,
      b,
    ]);
    expect(result.output).toEqual(new Float32Array([1, 2, 3]));
    expect(result.bounds).toEqual({ min: [1, 2, 3], max: [1, 2, 3] });
    const normals = await pool.transformStages(
      new Float32Array([2, 0, 0]),
      [a, a],
      true,
    );
    expect(normals.output).toEqual(new Float32Array([2, 0, 0]));
  } finally {
    pool.close();
  }
});
it("rejects invalid stage sequences before creating workers", async () => {
  install();
  const pool = createDatumTransformExecutor({ threshold: 0 });
  try {
    await expect(pool.transformStages([0, 0, 0], [])).rejects.toThrow();
    await expect(
      pool.transformStages([0, 0, 0], Array(17).fill(identity)),
    ).rejects.toThrow();
    await expect(
      pool.transformStages([0, 0, 0], [identity, [NaN]]),
    ).rejects.toThrow();
    expect(TestWorker.instances).toHaveLength(0);
  } finally {
    pool.close();
  }
});
