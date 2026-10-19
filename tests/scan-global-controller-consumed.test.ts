import { afterEach, expect, it, vi } from "vitest";
import type { Entity } from "../src/types";
import type { GlobalControllerResult } from "../src/scan-global-controller-core";
import { refineGlobalScanSet } from "../src/scan-global-registration";
const mock = vi.hoisted(() => ({
  isolated: false,
  trace: [] as string[],
  run: undefined as
    undefined | ((input: unknown, routed: unknown) => Promise<unknown>),
}));
vi.mock("../src/scan-global-controller-client", () => ({
  runSharedGlobalController: async (input: unknown, routed: unknown) =>
    mock.isolated ? mock.run!(input, routed) : undefined,
}));
vi.mock("../src/scan-global-controller-core", () => ({
  runGlobalScanController: async (input: unknown, routed: unknown) =>
    mock.run!(input, routed),
}));
vi.mock("../src/datum-transform-pool", () => ({
  createDatumTransformExecutor: () => {
    mock.trace.push("executor");
    return {
      async transformScanStages(entity: Entity) {
        mock.trace.push("transform:" + entity.id);
        return {
          entity,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          execution: {},
        };
      },
      close() {
        mock.trace.push("close");
      },
    };
  },
}));
const frame = () => [1, -0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function fixture() {
  const entities = ["a", "b"].map(
    (id) =>
      ({
        id,
        kind: "mesh",
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      }) as Entity,
  );
  const input = {
    scans: entities.map((entity) => ({
      id: entity.id,
      geometry: {
        points: entity.positions as Float32Array,
        normals: new Float32Array(9),
      },
    })),
  };
  const result = {
    mode: "target-average",
    queries: 0,
    queryWorkers: 1,
    localResults: [],
    outer: {
      passes: 1,
      seed: -0,
      order: ["a", "b"],
      gaugeId: "a",
      states: [],
      applications: ["a", "b", "a", "b"].map((id) => ({ id, matrix: frame() })),
    },
  } as GlobalControllerResult;
  return { entities, input, result };
}
afterEach(() => {
  mock.trace.length = 0;
  mock.run = undefined;
  mock.isolated = false;
});
it.each([false, true])(
  "consumes descriptors after controller resolves and before first frame allocation (isolated=%s)",
  async (isolated) => {
    mock.isolated = isolated;
    const { entities, input, result } = fixture();
    const sourceScans = input.scans;
    const authored = entities.map((entity) => Array.from(entity.positions));
    let release!: () => void, routed!: typeof input;
    mock.run = async (_input, route) => {
      routed = route as typeof input;
      mock.trace.push("controller");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      mock.trace.push("resolved");
      return result;
    };
    const consumed = vi.fn(() => {
      expect(routed.scans).toEqual([]);
      expect(input.scans).toBe(sourceScans);
      mock.trace.push("consumed");
    });
    const pending = refineGlobalScanSet(input, entities, {
      onInputConsumed: consumed,
    });
    await Promise.resolve();
    expect(consumed).not.toHaveBeenCalled();
    expect(mock.trace).toEqual(["controller"]);
    release();
    await pending;
    expect(mock.trace).toEqual([
      "controller",
      "resolved",
      "consumed",
      "executor",
      "transform:a",
      "transform:b",
      "close",
    ]);
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(input.scans).toBe(sourceScans);
    expect(entities.map((entity) => Array.from(entity.positions))).toEqual(
      authored,
    );
  },
);
it.each([false, true])(
  "controller failure/cancellation cannot consume or Apply (isolated=%s)",
  async (isolated) => {
    mock.isolated = isolated;
    const { entities, input } = fixture();
    const consumed = vi.fn();
    for (const failure of [
      Error("controller failed"),
      new DOMException("cancelled", "AbortError"),
    ]) {
      mock.run = async () => {
        throw failure;
      };
      await expect(
        refineGlobalScanSet(input, entities, { onInputConsumed: consumed }),
      ).rejects.toBe(failure);
    }
    expect(consumed).not.toHaveBeenCalled();
    expect(mock.trace).toEqual([]);
    expect(input.scans).toHaveLength(2);
  },
);
it("a consuming callback exception preserves identity and prevents Apply", async () => {
  const { entities, input, result } = fixture();
  const failure = Error("consume failed");
  mock.run = async () => result;
  await expect(
    refineGlobalScanSet(input, entities, {
      onInputConsumed() {
        throw failure;
      },
    }),
  ).rejects.toBe(failure);
  expect(mock.trace).toEqual([]);
});
