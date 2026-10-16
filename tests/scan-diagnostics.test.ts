import { describe, expect, it, vi } from "vitest";
import {
  observeScanDiagnostics,
  type ScanDiagnostics,
} from "../src/scan-diagnostics";
import { analyzeMesh } from "../src/mesh-processing";
import type {
  ProcessingResult,
  ProcessingRequest,
  ProcessingOptions,
} from "../src/processing-client";

function report(request: ProcessingRequest): Promise<ProcessingResult> {
  const t = analyzeMesh(request.positions, { tolerance: 0.001 });
  return Promise.resolve({
    kind: "report",
    diagnostics: {},
    topology: {
      vertices: t.vertices.length / 3,
      triangles: t.triangles.length / 3,
      components: t.components.length,
      boundaryLoops: t.boundaryLoops.length,
      boundaryChains: t.boundaryChains.length,
      boundaryEdges: t.boundaryEdges,
      nonManifoldEdges: t.nonManifoldEdges,
      nonManifoldVertices: t.nonManifoldVertices,
      inconsistentEdges: t.inconsistentEdges,
      degenerateTriangles: t.degenerateTriangles,
      duplicateTriangles: t.duplicateTriangles,
    },
  });
}
const tetrahedron = () =>
  new Float32Array([
    0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
describe("current geometry diagnostics", () => {
  it("shares pending analysis and releases it only after the last observer leaves", async () => {
    const positions = tetrahedron(),
      first: ScanDiagnostics[] = [],
      second: ScanDiagnostics[] = [];
    let options!: ProcessingOptions,
      resolve!: (result: ProcessingResult) => void;
    const run = vi.fn(
      (_request: ProcessingRequest, supplied: ProcessingOptions) => {
        options = supplied;
        return new Promise<ProcessingResult>((done) => {
          resolve = done;
        });
      },
    );
    const unsubscribeFirst = observeScanDiagnostics(
      positions,
      (state) => first.push(state),
      run,
    );
    const unsubscribeSecond = observeScanDiagnostics(
      positions,
      (state) => second.push(state),
      run,
    );
    expect(run).toHaveBeenCalledTimes(1);
    options.onProgress?.(0.5, "Building topology");
    expect(second.at(-1)).toEqual(first.at(-1));
    unsubscribeFirst();
    expect(options.signal?.aborted).toBe(false);
    resolve(await report({ kind: "report", positions, tolerance: 0.001 }));
    await flush();
    expect(second.at(-1)?.phase).toBe("ready");
    expect(first.at(-1)?.phase).toBe("pending");
    unsubscribeSecond();
  });
  it("recalculates boundaries after deletion and reuses the restored geometry on undo", async () => {
    const positions = tetrahedron(),
      updates: ScanDiagnostics[] = [],
      run = vi.fn(report);
    observeScanDiagnostics(positions, (state) => updates.push(state), run);
    await flush();
    expect(updates.at(-1)).toMatchObject({
      phase: "ready",
      topology: { components: 1, boundaryLoops: 0, boundaryEdges: 0 },
    });
    const deleted = positions.slice(9);
    observeScanDiagnostics(deleted, (state) => updates.push(state), run);
    expect(updates.at(-1)?.phase).toBe("pending");
    await flush();
    expect(updates.at(-1)).toMatchObject({
      phase: "ready",
      topology: {
        components: 1,
        boundaryLoops: 1,
        boundaryEdges: 3,
        triangles: 3,
      },
    });
    observeScanDiagnostics(positions, (state) => updates.push(state), run);
    expect(updates.at(-1)).toMatchObject({
      phase: "ready",
      topology: { boundaryLoops: 0 },
    });
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("uses the actual disconnected component count", async () => {
    const updates: ScanDiagnostics[] = [];
    observeScanDiagnostics(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]),
      (state) => updates.push(state),
      report,
    );
    await flush();
    expect(updates.at(-1)).toMatchObject({
      phase: "ready",
      topology: { components: 2, boundaryLoops: 2 },
    });
  });
  it("aborts obsolete work and ignores late replies and progress", async () => {
    const positions = tetrahedron(),
      updates: ScanDiagnostics[] = [];
    let options!: ProcessingOptions,
      resolve!: (result: ProcessingResult) => void;
    const cleanup = observeScanDiagnostics(
      positions,
      (state) => updates.push(state),
      (_request, supplied) => {
        options = supplied;
        return new Promise((done) => {
          resolve = done;
        });
      },
    );
    cleanup();
    await flush();
    expect(options.signal?.aborted).toBe(true);
    options.onProgress?.(0.5, "Obsolete");
    resolve(await report({ kind: "report", positions, tolerance: 0.001 }));
    await flush();
    expect(updates).toHaveLength(1);
  });
  it("reports analysis errors instead of presenting old counts", async () => {
    const updates: ScanDiagnostics[] = [];
    observeScanDiagnostics(
      tetrahedron(),
      (state) => updates.push(state),
      async () => {
        throw new Error("Worker unavailable");
      },
    );
    await flush();
    expect(updates.at(-1)).toEqual({
      phase: "error",
      message: "Worker unavailable",
    });
  });
});
