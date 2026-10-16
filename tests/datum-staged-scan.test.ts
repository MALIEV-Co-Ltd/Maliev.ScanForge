import { afterEach, expect, it, vi } from "vitest";
import { createDatumTransformExecutor } from "../src/datum-transform-pool";
import { transformDatumScan } from "../src/datum-alignment";
import {
  cloudSelectionSource,
  cloudPlacement,
} from "../src/point-cloud-placement";
import {
  executeDatumTransform,
  type DatumTransformRequest,
} from "../src/datum-transform-worker";
import type { Entity } from "../src/types";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const frames = [[...identity], [...identity]];
frames[0][3] = 3;
frames[1][3] = 3;
const bytes = (v: ArrayLike<number>) =>
  Buffer.from(Float32Array.from(v).buffer).toString("hex");
const source = (kind: Entity["kind"] = "mesh"): Entity => ({
  id: "scan",
  name: "scan",
  kind,
  positions: new Float32Array([1e8, 0, 0, 1e8, 1, 0, 1e8, 0, 1]),
  normals: [0, 0, 2, 0, 0, 2, 0, 0, 2],
  visible: true,
  color: "#aaa",
  opacity: 1,
  meshSelection: {
    hidden: [0],
    saved: [{ id: "s", name: "saved", triangles: [0] }],
  },
});
class TestWorker {
  static instances: TestWorker[] = [];
  terminated = false;
  onmessage?: ({ data }: { data: unknown }) => void;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(input: DatumTransformRequest, transfer: Transferable[]) {
    const data = structuredClone(input, { transfer });
    queueMicrotask(() => {
      if (!this.terminated)
        this.onmessage?.({ data: executeDatumTransform(data) });
    });
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  TestWorker.instances = [];
});
it("applies both mesh setter stages once per stream and retains indexed normals, identity and saved selections", async () => {
  vi.stubGlobal("Worker", TestWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  const entity = source();
  entity.indexedMesh = {
    vertices: entity.positions,
    triangles: new Uint32Array([0, 1, 2]),
    normals: new Float32Array(entity.normals!),
  };
  entity.fit = {
    kind: "sphere",
    center: [2, 3, 4],
    axis: [0, 0, 1],
    radius: 2,
    rms: 0,
    maxError: 0,
  };
  const original = bytes(entity.positions),
    expected = frames.reduce((e, m) => transformDatumScan(e, m), entity),
    executor = createDatumTransformExecutor({ threshold: 0 });
  try {
    const result = await executor.transformScanStages(entity, frames);
    expect(bytes(result.entity.positions)).toBe(bytes(expected.positions));
    expect(bytes(result.entity.indexedMesh!.vertices)).toBe(
      bytes(expected.indexedMesh!.vertices),
    );
    expect(bytes(result.entity.indexedMesh!.normals!)).toBe(
      bytes(expected.indexedMesh!.normals!),
    );
    expect(result.entity.normals).toEqual(expected.normals);
    expect(result.entity.fit).toEqual(expected.fit);
    expect(result.entity.meshSelection).toBe(entity.meshSelection);
    expect(result.entity.indexedMesh!.triangles).toBe(
      entity.indexedMesh.triangles,
    );
    expect(bytes(entity.positions)).toBe(original);
    expect(result.execution.physicalWorkers).toBe(2);
  } finally {
    executor.close();
  }
  expect(TestWorker.instances.every((w) => w.terminated)).toBe(true);
});
it("composes each cloud stage over its prior Double pose and keeps original buffers and selection identity", async () => {
  const raw = source("pointcloud"),
    entity = transformDatumScan(
      raw,
      [1, 0, 0, 0.1, 0, 1, 0, 0.2, 0, 0, 1, 0.3],
    ),
    before = cloudPlacement(entity)!,
    expected = frames.reduce((e, m) => transformDatumScan(e, m), entity),
    executor = createDatumTransformExecutor({ parallel: false });
  try {
    const result = await executor.transformScanStages(entity, frames),
      placement = cloudPlacement(result.entity)!;
    expect(placement.matrixBits).toBe(cloudPlacement(expected)!.matrixBits);
    expect(placement.sourcePositions).toBe(before.sourcePositions);
    expect(placement.sourceNormals).toBe(before.sourceNormals);
    expect(cloudSelectionSource(result.entity)).toBe(raw.positions);
    expect(bytes(result.entity.positions)).toBe(bytes(expected.positions));
    expect(result.entity.meshSelection).toBe(raw.meshSelection);
    expect(result.entity.positions[0]).toBe(100000008);
  } finally {
    executor.close();
  }
});
it("discards invalid indexed topology and preserves single-matrix scan compatibility", async () => {
  const entity = source();
  entity.indexedMesh = {
    vertices: new Float32Array([0, 0, 0]),
    triangles: [0, 0, 0],
  };
  const executor = createDatumTransformExecutor({ parallel: false });
  try {
    const a = await executor.transformScanStages(entity, [frames[0]]),
      b = await executor.transformScan(entity, frames[0]);
    expect(a.entity.indexedMesh).toBeUndefined();
    expect(bytes(a.entity.positions)).toBe(bytes(b.entity.positions));
    expect(a.entity.normals).toEqual(b.entity.normals);
  } finally {
    executor.close();
  }
});
it("cancels during chunked validation without changing authored geometry or allocating workers", async () => {
  vi.stubGlobal("Worker", TestWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
  const entity = source();
  entity.positions = new Float32Array(262144 * 9);
  entity.indexedMesh = {
    vertices: entity.positions,
    triangles: new Uint32Array(262144 * 3),
  };
  const controller = new AbortController(),
    executor = createDatumTransformExecutor({
      threshold: 0,
      signal: controller.signal,
    });
  try {
    const pending = executor.transformScanStages(entity, frames);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(TestWorker.instances).toHaveLength(0);
    expect(entity.positions.length).toBe(262144 * 9);
  } finally {
    executor.close();
  }
});
it("rejects locked, empty and exact CAD targets and invalid stages before publication", async () => {
  const executor = createDatumTransformExecutor();
  try {
    for (const entity of [
      { ...source(), locked: true },
      { ...source(), positions: [] },
      { ...source(), kernelId: "cad" },
    ])
      await expect(
        executor.transformScanStages(entity, frames),
      ).rejects.toThrow();
    for (const stages of [
      [],
      [identity.slice(1)],
      [[...identity.slice(0, 11), NaN]],
    ])
      await expect(
        executor.transformScanStages(source(), stages),
      ).rejects.toThrow();
  } finally {
    executor.close();
  }
});

it.each([
  [
    "nonfinite vertex",
    (e: Entity) => {
      e.indexedMesh!.vertices[0] = Infinity;
    },
  ],
  [
    "negative vertex id",
    (e: Entity) => {
      e.indexedMesh!.triangles = [-1, 1, 2];
    },
  ],
  [
    "fractional vertex id",
    (e: Entity) => {
      e.indexedMesh!.triangles = [0, 1.5, 2];
    },
  ],
  [
    "out of range vertex id",
    (e: Entity) => {
      e.indexedMesh!.triangles = [0, 1, 3];
    },
  ],
  [
    "nonfinite scanner normal",
    (e: Entity) => {
      e.indexedMesh!.normals![0] = NaN;
    },
  ],
  [
    "incorrect scanner normal count",
    (e: Entity) => {
      e.indexedMesh!.normals = [0, 0, 1];
    },
  ],
  [
    "render mismatch",
    (e: Entity) => {
      e.indexedMesh!.vertices[0] = 4;
    },
  ],
] as const)(
  "retains existing invalid-topology handling for %s",
  async (_name, mutate) => {
    const entity = source();
    entity.indexedMesh = {
      vertices: new Float32Array(entity.positions),
      triangles: [0, 1, 2],
      normals: new Float32Array(entity.normals!),
    };
    mutate(entity);
    const expected = transformDatumScan(entity, identity),
      executor = createDatumTransformExecutor({ parallel: false });
    try {
      const actual = (await executor.transformScanStages(entity, [identity]))
        .entity;
      expect(actual.indexedMesh).toBe(expected.indexedMesh);
      expect(bytes(actual.positions)).toBe(bytes(expected.positions));
    } finally {
      executor.close();
    }
  },
);
it("snapshots mesh frames before asynchronous indexed validation", async () => {
  const entity = source(),
    positions = new Float32Array(65538);
  positions.fill(1e8);
  entity.positions = positions;
  entity.normals = undefined;
  entity.indexedMesh = {
    vertices: positions,
    triangles: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i),
  };
  const stages = frames.map((m) => [...m]),
    executor = createDatumTransformExecutor({ parallel: false });
  try {
    const pending = executor.transformScanStages(entity, stages);
    stages[0][3] = 100;
    stages[1][3] = 100;
    const result = await pending;
    expect(result.entity.positions[0]).toBe(100000000);
    expect(result.entity.indexedMesh!.vertices[0]).toBe(100000000);
  } finally {
    executor.close();
  }
});
