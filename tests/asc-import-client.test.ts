import { expect, it, vi } from "vitest";
import { importScan } from "../src/import-client";

it("transfers ASC positions and normals separately without inventing triangle counts, and releases the worker", async () => {
  let worker: any;
  class WorkerDouble {
    onmessage: any;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      worker = this;
    }
  }
  vi.stubGlobal("Worker", WorkerDouble);
  try {
    const onSource = vi.fn(),
      onPointCloud = vi.fn();
    const pending = importScan({ name: "scan.asc", size: 123 } as File, {
      onSource,
      onPointCloud,
    });
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ extension: "asc" }),
    );
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]),
      normals = new Float32Array([0, 0, 1, 0, 1, 0]);
    worker.onmessage({ data: { positions, pointCloud: { normals } } });
    expect(await pending).toBe(positions);
    expect(onPointCloud).toHaveBeenCalledWith({ normals });
    expect(onSource).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
