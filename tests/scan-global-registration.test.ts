import { afterEach, expect, it, vi } from "vitest";
import type { Entity } from "../src/types";
import type { GlobalSceneInput } from "../src/scan-global-scene-core";
const mock = vi.hoisted(() => ({
  events: [] as string[],
  applicationThreshold: -1,
  routedInputs: [] as GlobalSceneInput["scans"][],
  close: vi.fn(),
  failQuery: false,
  failApply: false,
  abort: undefined as AbortController | undefined,
}));
vi.mock("../src/scan-global-scene-client", () => ({
  createPreparedGlobalQueryPool: vi.fn(async (input: GlobalSceneInput) => {
    mock.routedInputs.push([...input.scans]);
    return {
      scanIds: input.scans.map((scan) => scan.id),
      physicalWorkers: 2,
      close() {
        mock.events.push("query-close");
        mock.close();
      },
      async execute(job: any) {
        mock.events.push("query:" + job.sourceId);
        if (mock.failQuery) throw Error("query failed");
        mock.abort?.abort();
        return { count: 3, pairs: [] };
      },
    };
  }),
}));
vi.mock("../src/scan-native-global-local", () => ({
  nativeGlobalRefineLocal: vi.fn(async (source, query) => {
    await query(source.matrix);
    return {
      ...source,
      status: 0,
      iterations: 1,
      records: [],
      converged: true,
      stable: true,
    };
  }),
}));
vi.mock("../src/scan-native-global-outer", () => ({
  nativeGlobalRefineOuter: vi.fn(async (scans, refine, options) => {
    options.onProgress(0, 19, scans);
    for (const s of scans) await refine(s, scans, 0);
    options.onProgress(1, 19, scans);
    const frame = [1, 0, 0, 3, 0, 1, 0, 0, 0, 0, 1, 0];
    return {
      passes: 1,
      order: scans.map((s: any) => s.id),
      states: scans,
      gaugeId: scans[0].id,
      applications: [
        ...scans.map((s: any) => ({ id: s.id, matrix: frame })),
        ...scans.map((s: any) => ({ id: s.id, matrix: frame })),
      ],
    };
  }),
}));
vi.mock("../src/datum-transform-pool", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/datum-transform-pool")>();
  return {
    ...original,
    createDatumTransformExecutor: (options: any) => {
      mock.applicationThreshold = options.threshold;
      mock.events.push("application-start");
      const executor = original.createDatumTransformExecutor(options);
      return {
        ...executor,
        async transformScanStages(
          ...args: Parameters<typeof executor.transformScanStages>
        ) {
          if (mock.failApply) throw Error("application failed");
          return executor.transformScanStages(...args);
        },
        close() {
          mock.events.push("application-close");
          executor.close();
        },
      };
    },
  };
});
import { refineGlobalScanSet } from "../src/scan-global-registration";
import { createPreparedGlobalQueryPool } from "../src/scan-global-scene-client";
import { nativeGlobalRefineOuter } from "../src/scan-native-global-outer";
const sources = () =>
  ["a", "b"].map(
    (id) =>
      ({
        id,
        name: id,
        kind: "mesh",
        positions: new Float32Array([1e8, 0, 0, 1e8, 1, 0, 1e8, 0, 1]),
        visible: true,
        color: "#aaa",
        opacity: 1,
      }) as Entity,
  );
const input = (entities: Entity[]) => ({
  scans: entities.map((e) => ({
    id: e.id,
    geometry: {
      points: e.positions as Float32Array,
      normals: new Float32Array(e.positions.length),
    },
  })),
});
afterEach(() => {
  mock.events = [];
  mock.routedInputs = [];
  mock.close.mockClear();
  mock.failQuery = false;
  mock.failApply = false;
  mock.abort = undefined;
  vi.clearAllMocks();
});
it("connects one query initialization to ordered staged mesh setters without publishing or mutating authored buffers", async () => {
  const entities = sources(),
    before = entities.map((e) => Array.from(e.positions));
  const result = await refineGlobalScanSet(input(entities), entities, {
    parallel: false,
    clock: () => 17,
  });
  expect(createPreparedGlobalQueryPool).toHaveBeenCalledTimes(1);
  expect(mock.events).toEqual([
    "query:a",
    "query:b",
    "query-close",
    "application-start",
    "application-close",
  ]);
  expect(result.entities.map((e) => e.id)).toEqual(["a", "b"]);
  expect(result.entities[0].positions[0]).toBe(1e8); // Two native Float32 stores; a composed +6 would produce 100000008.
  expect(entities.map((e) => Array.from(e.positions))).toEqual(before);
  expect(result.entities[0]).not.toBe(entities[0]);
  expect(mock.applicationThreshold).toBe(0);
  expect(result.diagnostics.queries).toBe(2);
  expect(result.diagnostics.queryWorkers).toBe(2);
  expect(result.diagnostics.mode).toBe("target-average");
  expect(vi.mocked(nativeGlobalRefineOuter).mock.calls[0][2]?.clock?.()).toBe(
    17,
  );
});
it("closes the query pool and never creates application workers after a query failure", async () => {
  mock.failQuery = true;
  const entities = sources();
  await expect(refineGlobalScanSet(input(entities), entities)).rejects.toThrow(
    "query failed",
  );
  expect(mock.events).toEqual(["query:a", "query-close"]);
});
it("routes ordinary mesh evaluator children without indexing their source samples as raw targets", async () => {
  const entities = sources();
  const scene = input(entities);
  for (const scan of scene.scans)
    Object.assign(scan.geometry, {
      targetMeshes: [
        { vertices: scan.geometry.points, triangles: Uint32Array.of(0, 1, 2) },
      ],
    });
  await refineGlobalScanSet(scene, entities, { clock: () => 17 });
  const passed = mock.routedInputs[0];
  expect(passed).toHaveLength(scene.scans.length);
  for (let index = 0; index < passed.length; index++) {
    const geometry = passed[index].geometry;
    expect(geometry.rawTargetIds).toEqual(new Uint32Array());
    expect(geometry.points).toBe(scene.scans[index].geometry.points);
    expect(geometry.normals).toBe(scene.scans[index].geometry.normals);
    expect("rawTargetIds" in scene.scans[index].geometry).toBe(false);
  }
});
it("releases application resources if object assembly fails", async () => {
  mock.failApply = true;
  const entities = sources();
  await expect(
    refineGlobalScanSet(input(entities), entities, { parallel: false }),
  ).rejects.toThrow("application failed");
  expect(mock.events.at(-1)).toBe("application-close");
  expect(mock.close).toHaveBeenCalledTimes(1);
});
it("preserves explicit mixed-child raw IDs and leaves raw cloud routing unchanged", async () => {
  const entities = sources();
  entities[1].kind = "pointcloud";
  const scene = input(entities),
    ids = Uint32Array.of(0, 2);
  Object.assign(scene.scans[0].geometry, {
    rawTargetIds: ids,
    targetMeshes: [
      {
        vertices: scene.scans[0].geometry.points,
        triangles: Uint32Array.of(0, 1, 2),
      },
    ],
  });
  await refineGlobalScanSet(scene, entities, { clock: () => 17 });
  const passed = mock.routedInputs[0];
  expect(passed).toHaveLength(scene.scans.length);
  expect(passed[0].geometry.rawTargetIds).toBe(ids);
  expect(passed[1].geometry.rawTargetIds).toBeUndefined();
  expect(passed[1].geometry.points).toBe(scene.scans[1].geometry.points);
});
it("cancels between a query and geometry application", async () => {
  mock.abort = new AbortController();
  const entities = sources();
  await expect(
    refineGlobalScanSet(input(entities), entities, {
      signal: mock.abort.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(mock.events).toEqual(["query:a", "query-close"]);
});
it("does not silently switch numeric branches when using one physical CPU lane", async () => {
  const entities = sources();
  const value = await refineGlobalScanSet(input(entities), entities, {
    parallel: false,
    mode: "pooled-plane",
  });
  expect(value.diagnostics.mode).toBe("pooled-plane");
});
it("checks admission before worker allocation", async () => {
  const entities = sources();
  await expect(
    refineGlobalScanSet(input(entities), [entities[0], entities[0]]),
  ).rejects.toThrow(/unique/);
  await expect(
    refineGlobalScanSet(input(entities), [
      { ...entities[0], kind: "cad" },
      entities[1],
    ]),
  ).rejects.toThrow(/raw/);
  expect(createPreparedGlobalQueryPool).not.toHaveBeenCalled();
});
it("releases all preparation resources when the observer rejects a completed solver pass", async () => {
  const entities = sources();
  await expect(
    refineGlobalScanSet(input(entities), entities, {
      onPass: (pass) => {
        if (pass) throw Error("stale revision");
      },
    }),
  ).rejects.toThrow("stale revision");
  expect(mock.events.at(-1)).toBe("query-close");
  expect(mock.events).not.toContain("application-start");
});
