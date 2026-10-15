import { expect, it, vi } from "vitest";
import native from "./fixtures/interactive-mirror-point-selection-native.json";
import { InteractiveBoundsPool } from "../src/interactive-bounds-pool";
import { executeInteractiveBoundsTask } from "../src/interactive-bounds-worker";
import { nativeInteractiveMirrorPoints } from "../src/interactive-mirror-selection";
class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: any;
  onerror: any;
  cache = new Map();
  messages: any[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.created.push(this);
  }
  postMessage(message: any) {
    this.messages.push(message);
    const data = executeInteractiveBoundsTask(message, this.cache);
    queueMicrotask(() => this.onmessage?.({ data }));
  }
}
const settings = (c: (typeof native.cases)[number]) => ({
  direction: c.direction,
  stride: c.stride,
  onlySelected: c.onlySelected,
  backfaces: c.backfaces,
  baseColor: [0.8, 0.8, 0],
  selectedColor: [0.3, 0.4, 0.5],
  allowanceMilliseconds: c.allowanceMilliseconds,
  elapsedMilliseconds: c.elapsedMilliseconds,
});
const selectedColors = (colors: Float32Array, indices: Uint32Array) =>
  Float32Array.from(
    Array.from(indices).flatMap((i) =>
      Array.from(colors.subarray(i * 3, i * 3 + 3)),
    ),
  );
it("shares two cached workers with bounds and preserves every captured native point/color submission", async () => {
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  const sources = new Map(
    [0, 16, 32].map((count) => [
      String(count),
      {
        positions: new Float32Array(count * 3),
        normals: Float32Array.from(native.normals.slice(0, count).flat()),
        flags: Uint32Array.from(native.flags.slice(0, count)),
      },
    ]),
  );
  const pool = new InteractiveBoundsPool(sources, { threshold: 0 });
  try {
    await pool.measure("32", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    for (const c of native.cases) {
      const result = await pool.mirror(String(c.count), settings(c));
      expect(Array.from(result.indices)).toEqual(c.indices);
      expect(
        Buffer.from(selectedColors(result.colors!, result.indices).buffer),
      ).toEqual(Buffer.from(new Float32Array(c.colors.flat()).buffer));
      expect(result.complete).toBe(c.complete);
      expect(result.execution.physicalWorkers).toBe(2);
    }
    expect(FakeWorker.created).toHaveLength(2);
    expect(
      FakeWorker.created
        .flatMap((w) => w.messages)
        .filter((m) => m.action === "prepare"),
    ).toHaveLength(6);
    const c = native.cases.find((c) => c.count === 32)!;
    const indicesOnly = await pool.mirror("32", settings(c), {
      includeColors: false,
    });
    expect(Array.from(indicesOnly.indices)).toEqual(c.indices);
    expect(indicesOnly.colors).toBeUndefined();
    expect(
      FakeWorker.created
        .flatMap((w) => w.messages)
        .filter((m) => m.action === "prepare"),
    ).toHaveLength(6);
    expect(sources.get("32")!.normals.byteLength).toBe(32 * 12);
  } finally {
    pool.close();
    expect(
      FakeWorker.created.every((w) => w.terminate.mock.calls.length === 1),
    ).toBe(true);
    vi.unstubAllGlobals();
  }
});
it("retains global stride and color state across cooperative serial chunks", async () => {
  const count = 70001,
    positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    flags = new Uint32Array(count).fill(2);
  flags[32769] = 0;
  for (let i = 0; i < count; i++) normals[i * 3 + 2] = 1;
  const input = {
    normals,
    flags,
    direction: [0, 0, 1],
    stride: 3,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [1, 0, 0],
    allowanceMilliseconds: 0,
    elapsedMilliseconds: 12,
  };
  const expected = nativeInteractiveMirrorPoints(input);
  const pool = new InteractiveBoundsPool(
    new Map([["scan", { positions, normals, flags }]]),
    { parallel: false },
  );
  try {
    const result = await pool.mirror("scan", input);
    expect(result.indices).toEqual(expected.indices);
    expect(selectedColors(result.colors!, result.indices)).toEqual(
      expected.colors,
    );
    expect(result.complete).toBe(false);
    expect(result.execution.physicalWorkers).toBe(0);
  } finally {
    pool.close();
  }
});
it("closes a pending serial preparation permanently and publishes no late result", async () => {
  const pool = new InteractiveBoundsPool(
    new Map([
      [
        "scan",
        {
          positions: new Float32Array(210000),
          normals: new Float32Array(210000),
        },
      ],
    ]),
    { parallel: false },
  );
  const input = {
    direction: [0, 0, 0],
    stride: 1,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [1, 0, 0],
    allowanceMilliseconds: 1000000,
    elapsedMilliseconds: 0,
  };
  const pending = pool.mirror("scan", input);
  pool.close();
  await expect(pending).rejects.toThrow();
  await expect(pool.mirror("scan", input)).rejects.toThrow();
});
it("deduplicates source transfers when bounds and mirror preparation start together", async () => {
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  const pool = new InteractiveBoundsPool(
    new Map([
      [
        "scan",
        { positions: new Float32Array(96), normals: new Float32Array(96) },
      ],
    ]),
    { threshold: 0 },
  );
  const input = {
    direction: [0, 0, 0],
    stride: 1,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [1, 0, 0],
    allowanceMilliseconds: 1000000,
    elapsedMilliseconds: 0,
  };
  try {
    await Promise.all([
      pool.measure("scan", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
      pool.mirror("scan", input),
    ]);
    expect(FakeWorker.created).toHaveLength(2);
    expect(
      FakeWorker.created
        .flatMap((w) => w.messages)
        .filter((m) => m.action === "prepare"),
    ).toHaveLength(2);
  } finally {
    pool.close();
    vi.unstubAllGlobals();
  }
});

it("ignores a late error from an old worker generation after successful recovery", async () => {
  class FailOnceWorker extends FakeWorker {
    postMessage(message: any) {
      if (FakeWorker.created.indexOf(this) < 2) {
        queueMicrotask(() => this.onerror?.({ message: "worker unavailable" }));
        return;
      }
      super.postMessage(message);
    }
  }
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FailOnceWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  const pool = new InteractiveBoundsPool(
    new Map([
      [
        "scan",
        { positions: new Float32Array(96), normals: new Float32Array(96) },
      ],
    ]),
    { threshold: 0 },
  );
  const input = {
    direction: [0, 0, 0],
    stride: 1,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [1, 0, 0],
    allowanceMilliseconds: 1000000,
    elapsedMilliseconds: 0,
  };
  try {
    const recovered = await pool.mirror("scan", input);
    expect(recovered.execution.physicalWorkers).toBe(0);
    await pool.mirror("scan", input);
    expect(FakeWorker.created).toHaveLength(4);
    const healthy = FakeWorker.created.slice(2);
    FakeWorker.created[0].onerror({ message: "late obsolete error" });
    expect(healthy.every((w) => w.terminate.mock.calls.length === 0)).toBe(
      true,
    );
    expect((await pool.mirror("scan", input)).execution.physicalWorkers).toBe(
      2,
    );
    expect(FakeWorker.created).toHaveLength(4);
  } finally {
    pool.close();
    vi.unstubAllGlobals();
  }
});
