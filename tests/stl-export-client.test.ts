import { afterEach, expect, it, vi } from "vitest";
import { exportStlInBackground } from "../src/stl-export-client";
import type { Entity } from "../src/types";

const positions = () => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const entity = (): Entity => ({
  id: "mesh",
  name: "mesh",
  kind: "mesh",
  positions: positions(),
  visible: true,
  opacity: 1,
  color: "#ffffff",
});

class ExportWorker {
  static instances: ExportWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  sent?: unknown;
  terminated = false;
  constructor() {
    ExportWorker.instances.push(this);
  }
  postMessage(data: unknown) {
    this.sent = structuredClone(data);
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  ExportWorker.instances = [];
});

it("cancels an active export and terminates its worker without detaching the source", async () => {
  vi.stubGlobal("Worker", ExportWorker);
  const source = entity();
  const controller = new AbortController();
  const pending = exportStlInBackground([source], controller.signal);
  const worker = ExportWorker.instances[0];
  expect(worker.sent).toBeDefined();
  worker.onmessage?.({ data: { started: true } });
  expect(worker.terminated).toBe(false);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(worker.terminated).toBe(true);
  expect(source.positions).toHaveLength(9);
  expect(Array.from(source.positions)).toEqual(Array.from(positions()));
});

it("returns an owned STL result and retires the worker", async () => {
  vi.stubGlobal("Worker", ExportWorker);
  const pending = exportStlInBackground([entity()]);
  const worker = ExportWorker.instances[0];
  const bytes = new Uint8Array(84);
  bytes[0] = 7;
  worker.onmessage?.({ data: { buffer: bytes.buffer } });
  const output = await pending;
  expect(output.byteLength).toBe(84);
  expect(output.getUint8(0)).toBe(7);
  expect(worker.terminated).toBe(true);
});

it("rejects malformed worker responses and terminates the worker", async () => {
  vi.stubGlobal("Worker", ExportWorker);
  const pending = exportStlInBackground([entity()]);
  const worker = ExportWorker.instances[0];
  worker.onmessage?.({ data: { buffer: "invalid" } });
  await expect(pending).rejects.toThrow();
  expect(worker.terminated).toBe(true);
});

it("terminates the worker and reports its failure", async () => {
  vi.stubGlobal("Worker", ExportWorker);
  const pending = exportStlInBackground([entity()]);
  const worker = ExportWorker.instances[0];
  worker.onerror?.({ message: "encoder failed" });
  await expect(pending).rejects.toThrow("encoder failed");
  expect(worker.terminated).toBe(true);
});

it("rejects a pre-cancelled request without creating a worker", async () => {
  vi.stubGlobal("Worker", ExportWorker);
  const controller = new AbortController();
  controller.abort();
  await expect(
    exportStlInBackground([entity()], controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(ExportWorker.instances).toHaveLength(0);
});

it("does not read or clone geometry for objects that STL export skips", async () => {
  vi.stubGlobal("Worker", ExportWorker);
  const ignored = ["pointcloud", "referenceFrame"].map((kind) => {
    const value = { ...entity(), kind } as Entity;
    Object.defineProperty(value, "positions", {
      get() {
        throw new Error("Ignored geometry was read");
      },
    });
    return value;
  });
  const pending = exportStlInBackground([entity(), ...ignored]);
  const worker = ExportWorker.instances[0];
  if (worker)
    worker.onmessage?.({ data: { buffer: new Uint8Array(84).buffer } });
  await pending;
  expect((worker.sent as { entities: Entity[] }).entities).toHaveLength(1);
  expect(worker.terminated).toBe(true);
});
