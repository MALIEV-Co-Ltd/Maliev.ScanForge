import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { InteractiveBoundsPool } from "../src/interactive-bounds-pool";
import { executeInteractiveBoundsTask } from "../src/interactive-bounds-worker";
const native = JSON.parse(
  readFileSync(
    new URL("./fixtures/interactive-world-bounds-native.json", import.meta.url),
    "utf8",
  ),
);
class FakeWorker {
  static created: FakeWorker[] = [];
  onmessage: any;
  onerror: any;
  cache = new Map();
  terminate = vi.fn();
  constructor() {
    FakeWorker.created.push(this);
  }
  postMessage(message: any) {
    const data = executeInteractiveBoundsTask(message, this.cache);
    queueMicrotask(() => this.onmessage?.({ data }));
  }
}
it("keeps native logical range order across two physical workers without retransferring cached points", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  const pool = new InteractiveBoundsPool(
    new Map(
      native.cases.map((c: any, i: number) => [
        String(i),
        {
          positions: Float32Array.from(c.points.flat()),
          flags: Uint32Array.from(c.flags),
        },
      ]),
    ),
    { threshold: 0 },
  );
  try {
    for (let i = 0; i < native.cases.length; i++) {
      const c = native.cases[i];
      const result = await pool.measure(
        String(i),
        native.transforms[c.transform],
      );
      expect(Buffer.from(result.values.buffer).toString("hex")).toBe(
        c.boundsBits,
      );
      expect(result.valid).toBe(!!c.valid);
      expect(result.execution.physicalWorkers).toBe(2);
    }
    const first = FakeWorker.created.at(-2)!;
    const cached = first.cache.size;
    await pool.measure("0", native.transforms[0]);
    expect(first.cache.size).toBe(cached);
  } finally {
    pool.close();
    expect(
      FakeWorker.created
        .slice(-2)
        .every((w) => w.terminate.mock.calls.length === 1),
    ).toBe(true);
    vi.unstubAllGlobals();
  }
});
it("uses the same native reducer without workers and observes cancellation", async () => {
  const c = native.cases[0];
  const pool = new InteractiveBoundsPool(
    new Map([["scan", { positions: Float32Array.from(c.points.flat()) }]]),
    { parallel: false },
  );
  try {
    const result = await pool.measure("scan", native.transforms[0]);
    expect(Buffer.from(result.values.buffer).toString("hex")).toBe(
      c.boundsBits,
    );
    expect(result.execution.physicalWorkers).toBe(0);
    const abort = new AbortController();
    abort.abort();
    await expect(
      pool.measure("scan", native.transforms[0], abort.signal),
    ).rejects.toThrow();
  } finally {
    pool.close();
  }
});
it("permanently cancels a closed session instead of silently completing a serial fallback", async () => {
  const c = native.cases[0];
  const pool = new InteractiveBoundsPool(
    new Map([["scan", { positions: Float32Array.from(c.points.flat()) }]]),
    { parallel: false },
  );
  const pending = pool.measure("scan", native.transforms[0]);
  pool.close();
  await expect(pending).rejects.toThrow();
  await expect(pool.measure("scan", native.transforms[0])).rejects.toThrow();
});
