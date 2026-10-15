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

const meshSource = () => ({
  positions: new Float32Array([
    0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0, 3, 3, 0, 999, 999, 999,
  ]),
  mesh: {
    triangles: new Uint32Array([0, 1, 2, 2, 3, 4]),
    selection: new Uint8Array([1, 0]),
    hidden: new Uint32Array([1]),
  },
});
it("derives native face visibility once, adds missing normals in the same pool, and never retransfers positions", async () => {
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  const source = meshSource(),
    pool = new InteractiveBoundsPool(new Map([["scan", source]]), {
      threshold: 0,
    });
  const frame = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  try {
    expect(Array.from((await pool.measure("scan", frame)).values)).toEqual([
      0, 0, 0, 2, 2, 0,
    ]);
    const prepared = await pool.preparedSource("scan", { normals: true });
    expect(Array.from(prepared.flags!)).toEqual([2, 2, 2, 8, 8, 8]);
    expect(Array.from(prepared.normals!)).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0,
    ]);
    const mirror = await pool.mirror("scan", {
      direction: [0, 0, 1],
      stride: 0,
      baseColor: [0.8, 0.8, 0],
      selectedColor: [0.3, 0.4, 0.5],
      allowanceMilliseconds: 1000000,
      elapsedMilliseconds: 0,
    });
    expect(Array.from(mirror.indices)).toEqual([0, 1, 2]);
    await pool.measure("scan", frame);
    await pool.preparedSource("scan", { normals: true });
    const messages = FakeWorker.created.flatMap((w) => w.messages);
    expect(FakeWorker.created).toHaveLength(2);
    expect(messages.filter((m) => m.action === "deriveMesh")).toHaveLength(2);
    expect(messages.filter((m) => m.action === "prepare")).toHaveLength(2);
    expect(messages.filter((m) => m.action === "normals")).toHaveLength(2);
    expect(source.positions.byteLength).toBe(72);
    expect(source.mesh.triangles.byteLength).toBe(24);
  } finally {
    pool.close();
    vi.unstubAllGlobals();
  }
});
it("shares one mesh-state derivation when bounds and mirror preparation begin concurrently", async () => {
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  const source = {
    ...meshSource(),
    normals: Float32Array.from({ length: 18 }, (_, i) => (i % 3 === 2 ? 1 : 0)),
  };
  const pool = new InteractiveBoundsPool(new Map([["scan", source]]), {
    threshold: 0,
  });
  try {
    const [bounds, mirror] = await Promise.all([
      pool.measure("scan", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
      pool.mirror("scan", {
        direction: [0, 0, 1],
        stride: 0,
        baseColor: [0.8, 0.8, 0],
        selectedColor: [0.3, 0.4, 0.5],
        allowanceMilliseconds: 1000000,
        elapsedMilliseconds: 0,
      }),
    ]);
    expect(bounds.values[3]).toBe(2);
    expect(Array.from(mirror.indices)).toEqual([0, 1, 2]);
    expect(
      FakeWorker.created
        .flatMap((w) => w.messages)
        .filter((m) => m.action === "deriveMesh"),
    ).toHaveLength(1);
  } finally {
    pool.close();
    vi.unstubAllGlobals();
  }
});
it("cannot start workers after a close wins the asynchronous source-preparation boundary", async () => {
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  try {
    for (const operation of ["bounds", "mirror"]) {
      const pool = new InteractiveBoundsPool(
        new Map([
          [
            "scan",
            { positions: new Float32Array(96), normals: new Float32Array(96) },
          ],
        ]),
        { threshold: 0 },
      );
      const pending =
        operation === "bounds"
          ? pool.measure("scan", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])
          : pool.mirror("scan", {
              direction: [0, 0, 1],
              stride: 0,
              baseColor: [0.8, 0.8, 0],
              selectedColor: [0.3, 0.4, 0.5],
              allowanceMilliseconds: 1000000,
              elapsedMilliseconds: 0,
            });
      pool.close();
      await expect(pending).rejects.toThrow();
      expect(FakeWorker.created).toHaveLength(0);
    }
  } finally {
    for (const worker of FakeWorker.created) worker.terminate();
    vi.unstubAllGlobals();
  }
});
it("preserves native source preparation in the cooperative small-scan fallback", async () => {
  const source = meshSource(),
    pool = new InteractiveBoundsPool(new Map([["scan", source]]), {
      parallel: false,
    });
  try {
    const prepared = await pool.preparedSource("scan", { normals: true });
    expect(Array.from(prepared.flags!)).toEqual([2, 2, 2, 8, 8, 8]);
    expect(Array.from(prepared.normals!)).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0,
    ]);
    expect((await pool.preparedSource("scan", { normals: true })).flags).toBe(
      prepared.flags,
    );
  } finally {
    pool.close();
  }
});
it("keeps large fallback bounds usable while refusing synchronous whole-scan normal processing", async () => {
  const source = { positions: new Float32Array(100002 * 3), mesh: {} };
  const pool = new InteractiveBoundsPool(new Map([["scan", source]]), {
    parallel: false,
  });
  try {
    const prepared = await pool.preparedSource("scan");
    expect(pool.sourceSummary("scan")).toMatchObject({
      ready: true,
      visibleFaces: 33334,
      normalsAvailable: false,
    });
    await expect(
      pool.preparedSource("scan", { normals: true }),
    ).rejects.toThrow("background worker");
    expect((await pool.preparedSource("scan")).flags).toBe(prepared.flags);
    expect(
      (await pool.measure("scan", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])).valid,
    ).toBe(true);
  } finally {
    pool.close();
  }
});
it("cancels cooperative mesh preparation without publishing partial flags", async () => {
  const pool = new InteractiveBoundsPool(
    new Map([["scan", { positions: new Float32Array(100002 * 3), mesh: {} }]]),
    { parallel: false },
  );
  const pending = pool.preparedSource("scan");
  pool.close();
  await expect(pending).rejects.toThrow();
  expect(pool.sourceSummary("scan")).toMatchObject({ unavailable: true });
});
it("rejects misaligned source normals before advertising a ready mirror source", async () => {
  const pool = new InteractiveBoundsPool(
    new Map([
      [
        "scan",
        { positions: new Float32Array(9), normals: new Float32Array(0) },
      ],
    ]),
  );
  try {
    await expect(
      pool.preparedSource("scan", { normals: true }),
    ).rejects.toThrow("normals");
    expect(pool.sourceSummary("scan")).toMatchObject({
      normalsAvailable: false,
    });
  } finally {
    pool.close();
  }
});
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
