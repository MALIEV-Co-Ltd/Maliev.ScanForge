import { afterEach, expect, it, vi } from "vitest";
import type { Entity, IndexedMesh } from "../src/types";
import { expandPlyTopology } from "../src/ply-topology";
import { noiseNormals } from "../src/scan-native-noise";
import { prepareScanRenderData, scanRenderData } from "../src/scan-render-data";
import { prepareRestoredScanDisplays } from "../src/restored-scan-display";
import {
  decodeProjectFile,
  encodeProjectFileLocally,
} from "../src/project-file";
import { decodeProjectInBackground } from "../src/project-decoding-client";
import type { ProjectSession } from "../src/project-file";
import { scanDisplayBuffers } from "../src/scan-display-buffers";

function mesh(): IndexedMesh {
  return {
    vertices: new Float32Array([
      0, 0, 0, 10, 0, 0, 0, 1, 0, 0, 0, 0.1, 9, 8, 7,
    ]),
    triangles: new Uint32Array([0, 1, 2, 0, 3, 1]),
    normals: new Float32Array(15).fill(2),
  };
}
function entity(indexedMesh = mesh()): Entity {
  return {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    visible: true,
    opacity: 1,
    color: "#888888",
    indexedMesh,
    positions: expandPlyTopology(indexedMesh),
  };
}
function session(e: Entity): ProjectSession {
  return {
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: "Stored normals",
      entities: [e],
    },
    history: [{ label: "Before", entities: [e] }],
    future: [],
  };
}
const bytes = (v: Float32Array) =>
  new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
afterEach(() => vi.unstubAllGlobals());

it.each([true, false])(
  "retains computed display vectors for JSON triangle arrays (cached=%s)",
  (cached) => {
    const e = entity();
    e.indexedMesh!.triangles = Array.from(e.indexedMesh!.triangles);
    e.indexedMesh!.geometryNormals = new Float32Array(15).fill(0.25);
    const sourceIndices = e.indexedMesh!.triangles;
    const data = cached
      ? prepareScanRenderData(e.positions, e.indexedMesh)
      : undefined;
    const output = scanDisplayBuffers(e.positions, e.indexedMesh, data);
    expect(output.indexed).toBe(true);
    expect(output.normals).toBe(e.indexedMesh!.geometryNormals);
    expect(output.index).toEqual(new Uint32Array(sourceIndices));
    expect(e.indexedMesh!.triangles).toBe(sourceIndices);
  },
);

it("uses native angle weights instead of facet area or scanner vectors", () => {
  const m = mesh(),
    data = prepareScanRenderData(expandPlyTopology(m), m);
  const expected = noiseNormals(m);
  expect(bytes(data.normals!)).toEqual(bytes(expected));
  expect(data.normals![1]).toBeCloseTo(Math.SQRT1_2);
  expect(data.normals![2]).toBeCloseTo(Math.SQRT1_2);
  expect(m.geometryNormals).toBeUndefined(); // Preparation alone never mutates published geometry.
  expect(Array.from(m.normals!)).toEqual(new Array(15).fill(2));
});

it("borrows stored Float32 normal state without regeneration or normalization", () => {
  const m = mesh();
  m.geometryNormals = new Float32Array([
    0.125, -0, 0.5, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0, 0, 0, -2, 3, 4,
  ]);
  const before = bytes(m.geometryNormals).slice();
  const data = prepareScanRenderData(expandPlyTopology(m), m);
  expect(data.normals).toBe(m.geometryNormals);
  expect(bytes(data.normals!)).toEqual(before);
  expect(data.indexedMesh).toBe(m);
});

it("prepares old indexed projects with a new descriptor and compact native normals", () => {
  const e = entity();
  const restored = prepareRestoredScanDisplays([e]);
  const output = restored[0],
    cached = scanRenderData(output.positions)!;
  expect(output).not.toBe(e);
  expect(e.indexedMesh!.geometryNormals).toBeUndefined();
  expect(output.positions).toBe(e.positions);
  expect(output.indexedMesh!.vertices).toBe(e.indexedMesh!.vertices);
  expect(output.indexedMesh!.normals).toBe(e.indexedMesh!.normals);
  expect(cached.indexedMesh).toBe(output.indexedMesh);
  expect(cached.normals).toBe(output.indexedMesh!.geometryNormals);
  expect(bytes(cached.normals!)).toEqual(bytes(noiseNormals(e.indexedMesh!)));
  expect(Array.from(cached.normals!.subarray(-3))).toEqual([0, 0, 0]);
});

it("retains stored normals and compact topology through actual project decoding", async () => {
  const e = entity();
  e.indexedMesh!.geometryNormals = new Float32Array(15).fill(0.125);
  const restored = await decodeProjectFile(
    await encodeProjectFileLocally(session(e)),
  );
  const result = restored.project.entities[0],
    cached = scanRenderData(result.positions)!;
  expect(cached.indexedMesh).toBe(result.indexedMesh);
  expect(cached.normals).toBe(result.indexedMesh!.geometryNormals);
  expect(cached.normals!.length).toBe(15);
  expect(cached.normals![0]).toBe(0.125);
  expect(restored.history[0].entities[0].indexedMesh).toBe(result.indexedMesh);
});

it("publishes a legacy project with persistent computed normals", async () => {
  const e = entity();
  const result = (
    await decodeProjectFile(await encodeProjectFileLocally(session(e)))
  ).project.entities[0];
  expect(result.indexedMesh!.geometryNormals).toEqual(
    noiseNormals(e.indexedMesh!),
  );
});

it("converts stored JSON normals once while retaining original Double coordinates", () => {
  const e = entity();
  e.indexedMesh!.vertices = Array.from(
    e.indexedMesh!.vertices,
    (x) => x + 0.0000000000001,
  );
  e.positions = Array.from(e.indexedMesh!.triangles).flatMap((id) =>
    Array.from(e.indexedMesh!.vertices).slice(id * 3, id * 3 + 3),
  );
  e.indexedMesh!.geometryNormals = new Array(15).fill(0.1);
  const [restored] = prepareRestoredScanDisplays([e]);
  expect(restored.positions).toBe(e.positions);
  expect(restored.indexedMesh!.vertices).toBe(e.indexedMesh!.vertices);
  expect(restored.indexedMesh!.geometryNormals).toBeInstanceOf(Float32Array);
  expect(restored.indexedMesh!.geometryNormals![0]).toBe(Math.fround(0.1));
  expect(scanRenderData(restored.positions)!.normals).toBe(
    restored.indexedMesh!.geometryNormals,
  );
  expect(e.indexedMesh!.geometryNormals).toBeInstanceOf(Array);
});

it("does not publish computed data when restoration is cancelled", () => {
  const e = entity(),
    controller = new AbortController();
  controller.abort();
  expect(() => prepareRestoredScanDisplays([e], controller.signal)).toThrow();
  expect(e.indexedMesh!.geometryNormals).toBeUndefined();
  expect(scanRenderData(e.positions)).toBeUndefined();
});

it.each([false, true])(
  "publishes computed import state once through valid transfer ownership (isolated=%s)",
  async (isolated) => {
    vi.stubGlobal("crossOriginIsolated", isolated);
    let result: any,
      transfers: Transferable[] = [];
    const scope = {
      onmessage: undefined as any,
      postMessage(value: any, transfer: Transferable[] = []) {
        if (value.error) throw new Error(value.error);
        if (!value.positions) return;
        transfers = transfer;
        result = structuredClone(value, { transfer });
      },
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/import-worker");
    const file = new Blob([
      "ply\nformat ascii 1.0\nelement vertex 5\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n0 0 0 2 2 2\n10 0 0 2 2 2\n0 1 0 2 2 2\n0 0 0.1 2 2 2\n9 8 7 2 2 2\n3 0 1 2\n3 0 3 1\n",
    ]);
    await scope.onmessage({ data: { file, extension: "ply", unit: "mm" } });
    expect(result.indexedMesh.geometryNormals).toBeInstanceOf(Float32Array);
    expect(result.renderData.normals).toBe(result.indexedMesh.geometryNormals);
    expect(result.renderData.indexedMesh).toBe(result.indexedMesh);
    expect(bytes(result.renderData.normals)).toEqual(
      bytes(noiseNormals(result.indexedMesh)),
    );
    expect(Array.from(result.indexedMesh.normals)).toEqual(
      new Array(15).fill(2),
    );
    expect(new Set(transfers).size).toBe(transfers.length);
    expect(transfers.every((b) => b instanceof ArrayBuffer)).toBe(true);
  },
);

it("accepts compact indexed display state across the actual decoding worker transport", async () => {
  class WorkerBridge {
    onmessage?: (event: any) => void;
    onerror?: (event: any) => void;
    terminated = false;
    async postMessage(data: unknown) {
      const scope = {
        onmessage: undefined as any,
        close() {},
        postMessage: (message: unknown, transfer: Transferable[] = []) => {
          this.onmessage?.({ data: structuredClone(message, { transfer }) });
        },
      };
      vi.stubGlobal("self", scope);
      try {
        vi.resetModules();
        await import("../src/project-decoding-worker");
        await scope.onmessage({ data });
      } catch (error) {
        this.onerror?.({ message: String(error) });
      }
    }
    terminate() {
      this.terminated = true;
    }
  }
  vi.stubGlobal("Worker", WorkerBridge);
  const e = entity();
  e.indexedMesh!.geometryNormals = new Float32Array(15).fill(0.25);
  const restored = await decodeProjectInBackground(
    await encodeProjectFileLocally(session(e)),
  );
  const output = restored.project.entities[0],
    cached = scanRenderData(output.positions)!;
  expect(cached.indexedMesh).toBe(output.indexedMesh);
  expect(cached.normals).toBe(output.indexedMesh!.geometryNormals);
  expect(cached.normals![0]).toBe(0.25);
});
