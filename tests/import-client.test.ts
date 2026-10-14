import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importScan } from "../src/import-client";
import { scanRenderData } from "../src/scan-render-data";

class ImportWorkerDouble {
  static latest: ImportWorkerDouble;
  terminated = false;
  request: unknown;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  constructor() {
    ImportWorkerDouble.latest = this;
  }
  postMessage(request: unknown) {
    this.request = request;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", ImportWorkerDouble);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const file = { name: "scan.stl" } as File;

describe("scan worker ownership", () => {
  it("forwards transferred PLY normals and topology without copying", async () => {
    const onMeshNormals = vi.fn(),
      onIndexedMesh = vi.fn();
    const pending = importScan({ name: "scan.ply" } as File, {
      onMeshNormals,
      onIndexedMesh,
    });
    const positions = new Float32Array(9),
      meshNormals = new Float32Array(9);
    const indexedMesh = {
      vertices: new Float32Array(9),
      triangles: new Uint32Array([0, 1, 2]),
    };
    ImportWorkerDouble.latest.reply({ positions, meshNormals, indexedMesh });
    expect(await pending).toBe(positions);
    expect(onMeshNormals.mock.calls[0][0]).toBe(meshNormals);
    expect(onIndexedMesh.mock.calls[0][0]).toBe(indexedMesh);
    expect(ImportWorkerDouble.latest.terminated).toBe(true);
  });
  it("retains transferred render data without geometry or normal copies", async () => {
    const pending = importScan(file);
    const positions = new Float32Array(9);
    const renderData = {
      normals: new Float32Array(9),
      bounds: [0, 0, 0, 1, 1, 0] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      radius: 1,
    };
    ImportWorkerDouble.latest.reply({ positions, renderData });
    expect(await pending).toBe(positions);
    expect(scanRenderData(positions)).toBe(renderData);
  });
  it("passes the selected file unit into the import worker", async () => {
    const pending = importScan(file, { unit: "in" });
    expect(ImportWorkerDouble.latest.request).toMatchObject({
      unit: "in",
      file,
    });
    ImportWorkerDouble.latest.reply({ positions: new Float32Array(9) });
    await pending;
  });
  it("transfers the result without copying it and releases worker and lease", async () => {
    const pending = importScan(file);
    const positions = new Float32Array(9);
    ImportWorkerDouble.latest.reply({ positions });
    expect(await pending).toBe(positions);
    expect(ImportWorkerDouble.latest.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases a cancelled worker immediately", async () => {
    const controller = new AbortController();
    const pending = importScan(file, { signal: controller.signal });
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await check;
    expect(ImportWorkerDouble.latest.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("extends the inactivity lease on progress and releases a stalled worker", async () => {
    const progress = vi.fn();
    const pending = importScan(file, { onProgress: progress });
    const check = expect(pending).rejects.toThrow("without progress");
    await vi.advanceTimersByTimeAsync(500_000);
    ImportWorkerDouble.latest.reply({ progress: 0.5 });
    await vi.advanceTimersByTimeAsync(500_000);
    expect(progress).toHaveBeenCalledWith(0.5);
    expect(ImportWorkerDouble.latest.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(100_000);
    await check;
    expect(ImportWorkerDouble.latest.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases a worker after parse failure", async () => {
    const pending = importScan(file);
    const check = expect(pending).rejects.toThrow("Invalid geometry");
    ImportWorkerDouble.latest.reply({ error: "Invalid geometry" });
    await check;
    expect(ImportWorkerDouble.latest.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
