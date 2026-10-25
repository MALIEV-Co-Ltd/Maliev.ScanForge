import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importScan } from "../src/import-client";
import { scanRenderData } from "../src/scan-render-data";
import {
  backgroundMeshPreparation,
  prepareMeshInBackground,
  stopBackgroundMeshPreparation,
} from "../src/scan-background-preparation";
import { observeScanDiagnostics } from "../src/scan-diagnostics";
import { releaseProcessingSession } from "../src/processing-session";
import { processMesh } from "../src/processing-client";

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
afterEach(async () => {
  stopBackgroundMeshPreparation();
  await Promise.resolve();
  await Promise.resolve();
  releaseProcessingSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("imports yield speculative mesh preparation", () => {
  it.each(["failure", "cancel"] as const)(
    "releases active warmup before importing and resumes the same source after %s",
    async (outcome) => {
      const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      prepareMeshInBackground(source);
      await vi.advanceTimersByTimeAsync(500);
      const background = ImportWorkerDouble.latest;
      const controller = new AbortController();
      const pending = importScan(file, { signal: controller.signal });
      const check = expect(pending).rejects.toThrow();
      const importing = ImportWorkerDouble.latest;
      const releasedBeforeImport = background.terminated;
      await vi.advanceTimersByTimeAsync(500);
      const phaseWhileImporting = backgroundMeshPreparation(source).phase;
      if (outcome === "cancel") controller.abort();
      else importing.reply({ error: "Invalid geometry" });
      await check;
      await vi.advanceTimersByTimeAsync(500);
      expect(releasedBeforeImport).toBe(true);
      expect(phaseWhileImporting).toBe("scheduled");
      expect(backgroundMeshPreparation(source).phase).toBe("pending");
      expect(ImportWorkerDouble.latest).not.toBe(background);
      expect(ImportWorkerDouble.latest).not.toBe(importing);
      expect(ImportWorkerDouble.latest.request).toMatchObject({
        kind: "report",
        positions: source,
      });
    },
  );

  it("defers warmup until both parallel imports have finished", async () => {
    const source = new Float32Array(9);
    const first = importScan(file);
    const firstWorker = ImportWorkerDouble.latest;
    const second = importScan(file);
    const secondWorker = ImportWorkerDouble.latest;
    prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const initialPhase = backgroundMeshPreparation(source).phase;
    firstWorker.reply({ positions: new Float32Array(9) });
    await first;
    await vi.advanceTimersByTimeAsync(500);
    const remainingPhase = backgroundMeshPreparation(source).phase;
    secondWorker.reply({ positions: new Float32Array(9) });
    await second;
    await vi.advanceTimersByTimeAsync(500);
    expect(initialPhase).toBe("scheduled");
    expect(remainingPhase).toBe("scheduled");
    expect(backgroundMeshPreparation(source).phase).toBe("pending");
    expect(ImportWorkerDouble.latest.request).toMatchObject({ kind: "report" });
  });

  it("releases import admission when Worker construction throws", async () => {
    const source = new Float32Array(9);
    prepareMeshInBackground(source);
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("Worker unavailable");
        }
      },
    );
    await expect(importScan(file)).rejects.toThrow("Worker unavailable");
    vi.stubGlobal("Worker", ImportWorkerDouble);
    await vi.advanceTimersByTimeAsync(500);
    expect(backgroundMeshPreparation(source).phase).toBe("pending");
    expect(ImportWorkerDouble.latest.request).toMatchObject({ kind: "report" });
  });

  it("preserves preparation promoted to a foreground diagnostics observer", async () => {
    const source = new Float32Array(9);
    prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const background = ImportWorkerDouble.latest;
    const leave = observeScanDiagnostics(source, () => {});
    const pending = importScan(file);
    const preserved = !background.terminated;
    ImportWorkerDouble.latest.reply({ positions: new Float32Array(9) });
    await pending;
    expect(preserved).toBe(true);
    expect(backgroundMeshPreparation(source).phase).toBe("pending");
    leave();
  });

  it("preserves warmup promised to a queued topology consumer", async () => {
    const source = new Float32Array(9);
    prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const background = ImportWorkerDouble.latest;
    const inventory = processMesh(
      { kind: "scanEdit", action: "inventory", positions: source },
      { reuseTopology: true },
    );
    const pending = importScan(file);
    const preserved = !background.terminated;
    ImportWorkerDouble.latest.reply({ positions: new Float32Array(9) });
    await pending;
    background.reply({ result: { kind: "report", diagnostics: {} } });
    await vi.advanceTimersByTimeAsync(0);
    background.reply({ result: { kind: "scanEdit", diagnostics: {} } });
    await inventory;
    expect(preserved).toBe(true);
  });

  it("does not resume a disposed source when an import ends", async () => {
    const source = new Float32Array(9);
    const stop = prepareMeshInBackground(source);
    await vi.advanceTimersByTimeAsync(500);
    const background = ImportWorkerDouble.latest;
    const pending = importScan(file);
    const importing = ImportWorkerDouble.latest;
    stop();
    importing.reply({ positions: new Float32Array(9) });
    await pending;
    await vi.advanceTimersByTimeAsync(500);
    expect(background.terminated).toBe(true);
    expect(backgroundMeshPreparation(source).phase).toBe("inactive");
    expect(ImportWorkerDouble.latest).toBe(importing);
    expect(vi.getTimerCount()).toBe(0);
  });
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

it.each([
  "onSource",
  "onIndexedMesh",
  "onMeshNormals",
  "onPointCloud",
] as const)(
  "rejects a throwing %s callback and resumes deferred preparation",
  async (callback) => {
    const source = new Float32Array(9);
    prepareMeshInBackground(source);
    const pending = importScan(file, {
      [callback]: () => {
        throw new Error("Import callback failed");
      },
    });
    let outcome = "pending";
    void pending.then(
      () => {
        outcome = "resolved";
      },
      (error: Error) => {
        outcome = error.message;
      },
    );
    const importing = ImportWorkerDouble.latest;
    let escaped: unknown;
    try {
      importing.reply({
        positions: new Float32Array(9),
        ...(callback === "onIndexedMesh"
          ? {
              indexedMesh: {
                vertices: new Float32Array(9),
                triangles: new Uint32Array([0, 1, 2]),
              },
            }
          : {}),
        ...(callback === "onMeshNormals"
          ? { meshNormals: new Float32Array(9) }
          : {}),
        ...(callback === "onPointCloud"
          ? { pointCloud: { normals: new Float32Array(9) } }
          : {}),
      });
    } catch (error) {
      escaped = error;
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(outcome).toBe("Import callback failed");
    expect(escaped).toBeUndefined();
    expect(importing.terminated).toBe(true);
    expect(backgroundMeshPreparation(source).phase).toBe("pending");
    expect(ImportWorkerDouble.latest.request).toMatchObject({ kind: "report" });
  },
);
