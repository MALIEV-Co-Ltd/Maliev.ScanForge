import { afterEach, expect, it, vi } from "vitest";
import {
  globalQueryExternalInputBytes,
  globalQueryInputBytes,
  shareGlobalQueryInput,
} from "../src/scan-global-query-storage";
import {
  createGlobalQueryPool,
  globalCoordinatorQueryAdmission,
  globalQueryPoolAdmission,
} from "../src/scan-global-query-pool";
import {
  CONTROL_BYTES,
  COORDINATOR_RESERVE_BYTES,
  preparedMetadataReserve,
} from "../src/scan-global-controller-protocol";
import {
  ownedWorkerCleanupPending,
  retryOwnedWorkerStops,
} from "../src/scan-global-worker-cleanup";
import type {
  GlobalQueryRequest,
  GlobalQueryResponse,
} from "../src/scan-global-query-core";

class QueryWorker {
  static instances: QueryWorker[] = [];
  onmessage?: (event: { data: GlobalQueryResponse }) => void;
  onerror?: unknown;
  onmessageerror?: unknown;
  initialization?: Extract<
    GlobalQueryRequest,
    { initialize: unknown }
  >["initialize"];
  terminate = vi.fn();
  constructor() {
    QueryWorker.instances.push(this);
  }
  postMessage(request: GlobalQueryRequest) {
    if (!("initialize" in request)) throw Error("Initialization only fixture");
    this.initialization = request.initialize;
    const reserved = request.initialize.storageBudget?.reserved ?? 0;
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          id: request.id,
          ready: true,
          indexes: request.initialize.scans.length,
          storage: {
            limit: 512 * 1048576,
            reserved,
            live: reserved,
            peak: reserved,
          },
        },
      }),
    );
  }
}
function install() {
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
  vi.stubGlobal("Worker", QueryWorker);
}
afterEach(() => {
  for (const worker of QueryWorker.instances) worker.terminate.mockReset();
  retryOwnedWorkerStops();
  QueryWorker.instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function scene() {
  const buffer = new ArrayBuffer(128);
  const points = new Float32Array(buffer, 0, 9),
    normals = new Float32Array(buffer, 36, 9);
  const triangles = new Uint32Array(buffer, 80, 3);
  return {
    scans: ["a", "b"].map((id) => ({
      id,
      geometry: {
        points,
        normals,
        rawTargetIds: new Uint32Array(),
        targetMeshes: [{ vertices: points, triangles }],
      },
    })),
  };
}
it("charges one full ordinary backing across overlapping views/scans and preserves aliases without detaching", () => {
  const ordinary = scene();
  const before = new Uint8Array(
    ordinary.scans[0].geometry.points.buffer,
  ).slice();
  const external = globalQueryExternalInputBytes(ordinary);
  expect(external).toBe(128);
  const shared = shareGlobalQueryInput(ordinary),
    a = shared.scans[0].geometry,
    b = shared.scans[1].geometry;
  expect(a.points).toBe(a.targetMeshes![0].vertices);
  expect(b.points).toBe(a.points);
  expect(a.points.buffer).toBe(a.normals.buffer);
  expect(a.points.byteOffset).toBe(0);
  expect(a.normals.byteOffset).toBe(36);
  expect(a.targetMeshes![0].triangles.byteOffset).toBe(80);
  expect(globalQueryExternalInputBytes(shared)).toBe(0);
  expect(globalQueryInputBytes(ordinary, 1, true)).toBe(
    globalQueryInputBytes(shared, 1, true) + external,
  );
  expect(new Uint8Array(ordinary.scans[0].geometry.points.buffer)).toEqual(
    before,
  );
});
it("charges coordinator-created labels normally while preserving parent original reserve", () => {
  const original = scene(),
    shared = shareGlobalQueryInput(original),
    external = globalQueryExternalInputBytes(original);
  const labels = shared.scans.map((s) => ({
    id: s.id,
    geometry: {
      ...s.geometry,
      labels: new Uint32Array(s.geometry.points.length / 3),
    },
  }));
  const labelCopies = 2 * 2 * 3 * 4;
  expect(globalQueryInputBytes({ scans: labels }, 1, true) + external).toBe(
    globalQueryInputBytes(original, 1, true) + labelCopies,
  );
  expect(CONTROL_BYTES).toBe(32);
  expect(COORDINATOR_RESERVE_BYTES).toBe(16 * 1048576 + 32);
});
it("default query reserve is unchanged and explicit coordinator/parent reserves remain in512MiB", async () => {
  install();
  const ordinary = scene();
  let pool: Awaited<ReturnType<typeof createGlobalQueryPool>> | undefined;
  try {
    pool = await createGlobalQueryPool(ordinary, { parallel: false });
    const baseline =
      QueryWorker.instances[0].initialization!.storageBudget!.reserved;
    expect(baseline).toBe(
      globalQueryInputBytes(ordinary, 1, true) + 2 * 16 * 1048576,
    );
    pool.close();
    pool = undefined;
    QueryWorker.instances.length = 0;
    const shared = shareGlobalQueryInput(ordinary);
    pool = await createGlobalQueryPool(shared, {
      parallel: false,
      externalReservedBytes: globalQueryExternalInputBytes(ordinary),
      runtimeReserveBytes: COORDINATOR_RESERVE_BYTES,
      expectedWorkers: 1,
    });
    expect(
      QueryWorker.instances[0].initialization!.storageBudget!.reserved,
    ).toBe(baseline + COORDINATOR_RESERVE_BYTES);
    expect(pool.physicalWorkers).toBe(1);
  } finally {
    pool?.close();
  }
});
it("preserves parent selected worker count and rejects cap overflow without allocating a huge fixture", () => {
  install();
  const input = scene();
  expect(globalCoordinatorQueryAdmission(input, true, 0)).toBe(
    globalQueryPoolAdmission(input, true),
  );
  expect(() =>
    globalCoordinatorQueryAdmission(
      input,
      true,
      COORDINATOR_RESERVE_BYTES,
      0,
      1,
    ),
  ).toThrow("worker count");
  expect(() =>
    globalCoordinatorQueryAdmission(
      input,
      false,
      COORDINATOR_RESERVE_BYTES,
      512 * 1048576,
    ),
  ).toThrow();
});
it("charges both retained selected-array copies without assuming the sample budget is an output cap", () => {
  const sources = ["a", "b"].map((id) => ({
    id,
    eligible: true,
    labels: new Uint32Array(1200),
    selected: [Array.from({ length: 1100 }, (_, index) => index)],
    sampled: 1100,
  }));
  const reserved = preparedMetadataReserve({ sources });
  expect(reserved).toBe(2 * (64 + 2 * (256 + 2 + 64 + 64 + 1100 * 32)));
  expect(sources[0].selected[0]).toHaveLength(1100);
  expect(() =>
    preparedMetadataReserve({
      sources: sources.map((source) => ({
        ...source,
        selected: [Array(16385).fill(0)],
      })),
    }),
  ).toThrow();
  expect(() =>
    preparedMetadataReserve({
      sources,
      grid: new Uint32Array(1),
    } as unknown as { sources: typeof sources }),
  ).toThrow();
  expect(() =>
    preparedMetadataReserve({
      sources: sources.map((source) => ({
        ...source,
        spatialFlags: new Uint32Array(1),
      })),
    }),
  ).toThrow();
});
it("attempts every exact query worker when an earlier termination request throws", async () => {
  install();
  const outcomes: unknown[] = [];
  const raw = {
    scans: scene().scans.map(({ id, geometry }) => ({
      id,
      geometry: { points: geometry.points, normals: geometry.normals },
    })),
  };
  const pool = await createGlobalQueryPool(raw, {
    onQueryPoolCleanup: (value) => outcomes.push(value),
  });
  expect(QueryWorker.instances).toHaveLength(2);
  QueryWorker.instances[0].terminate.mockImplementation(() => {
    throw Error("owned stop failed");
  });
  expect(pool.close()).toBe(false);
  expect(QueryWorker.instances[0].terminate).toHaveBeenCalledTimes(3);
  expect(QueryWorker.instances[1].terminate).toHaveBeenCalledTimes(1);
  expect(ownedWorkerCleanupPending()).toHaveLength(1);
  expect(outcomes).toHaveLength(1);
  QueryWorker.instances[0].terminate.mockReset();
  expect(pool.close()).toBe(true);
  expect(ownedWorkerCleanupPending()).toEqual([]);
});
