import { afterEach, expect, it, vi } from "vitest";
import { copyGlobalSceneForTransfer } from "../src/scan-global-scene-transport";
afterEach(() => vi.unstubAllGlobals());
it("transfers copied geometry exactly without detaching author buffers or duplicating shared sidecars", async () => {
  const points = Float32Array.from({ length: 300003 }, (_, i) =>
      i === 0 ? -0 : i / 3,
    ),
    normals = points,
    flags = new Uint32Array(points.length / 3).fill(0x80000008),
    input = {
      scans: [{ id: "a", geometry: { points, normals, flags, labels: flags } }],
    };
  const packed = await copyGlobalSceneForTransfer(input, () => {});
  expect(packed.transfer).toHaveLength(2);
  const received = structuredClone(packed.input, { transfer: packed.transfer });
  expect(points.byteLength).toBe(1200012);
  expect(flags.byteLength).toBe(400004);
  expect(received.scans[0].geometry.points).toBe(
    received.scans[0].geometry.normals,
  );
  expect(received.scans[0].geometry.flags).toBe(
    received.scans[0].geometry.labels,
  );
  expect(
    Buffer.from(received.scans[0].geometry.points.buffer).equals(
      Buffer.from(points.buffer),
    ),
  ).toBe(true);
  expect(
    Buffer.from(received.scans[0].geometry.flags!.buffer).equals(
      Buffer.from(flags.buffer),
    ),
  ).toBe(true);
});
it("checks cancellation between copy chunks before sending a scene", async () => {
  const c = new AbortController(),
    points = new Float32Array(1200003);
  vi.stubGlobal("scheduler", { yield: async () => c.abort() });
  await expect(
    copyGlobalSceneForTransfer(
      { scans: [{ id: "a", geometry: { points, normals: points } }] },
      () => c.signal.throwIfAborted(),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(points.byteLength).toBe(4800012);
});
