import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as string[],
  failAdjacency: false,
  failEvaluator: false,
  failEvaluatorAt: 0,
  evaluatorCalls: 0,
}));

vi.mock("../src/scan-native-alignment-adjacency", async (original) => {
  const actual =
    await original<typeof import("../src/scan-native-alignment-adjacency")>();
  return {
    ...actual,
    nativeBuildAlignmentNeighbourMasks(
      ...args: Parameters<typeof actual.nativeBuildAlignmentNeighbourMasks>
    ) {
      state.events.push("adjacency-start");
      if (state.failAdjacency) throw Error("Adjacency failed");
      const result = actual.nativeBuildAlignmentNeighbourMasks(...args);
      state.events.push("adjacency-released");
      return result;
    },
  };
});
vi.mock("../src/scan-native-global-surface", async (original) => {
  const actual =
    await original<typeof import("../src/scan-native-global-surface")>();
  return {
    ...actual,
    prepareNativeGlobalMeshEvaluator(
      ...args: Parameters<typeof actual.prepareNativeGlobalMeshEvaluator>
    ) {
      state.events.push("evaluator-start");
      state.evaluatorCalls++;
      if (state.failEvaluator || state.evaluatorCalls === state.failEvaluatorAt)
        throw Error("Evaluator failed");
      return actual.prepareNativeGlobalMeshEvaluator(...args);
    },
  };
});

import { createGlobalQueryWorkerState } from "../src/scan-global-query-worker";
import {
  prepareNativeGlobalMeshTarget,
  prepareNativeGlobalMeshTargets,
} from "../src/scan-native-global-mesh-target";

const mesh = () => ({
  vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  triangles: Uint32Array.of(0, 1, 2),
});
beforeEach(() => {
  state.events.length = 0;
  state.failAdjacency = state.failEvaluator = false;
  state.failEvaluatorAt = state.evaluatorCalls = 0;
});

it("releases adjacency scratch before building the evaluator and reuses both", () => {
  const input = mesh();
  const target = prepareNativeGlobalMeshTarget(input);
  expect(state.events).toEqual([
    "adjacency-start",
    "adjacency-released",
    "evaluator-start",
  ]);
  expect(target.query([0.2, 0.2, 0.1], 1).found).toBe(true);
  state.events.length = 0;
  expect(prepareNativeGlobalMeshTarget(input)).toBe(target);
  expect(state.events).toEqual([]);
});

it("does not allocate an evaluator after adjacency fails or cache partial state", () => {
  const input = mesh();
  state.failAdjacency = true;
  expect(() => prepareNativeGlobalMeshTarget(input)).toThrow(
    "Adjacency failed",
  );
  expect(state.events).toEqual(["adjacency-start"]);
  state.failAdjacency = false;
  state.events.length = 0;
  expect(prepareNativeGlobalMeshTarget(input).neighbours).toEqual(
    Uint8Array.of(0),
  );
  expect(state.events).toEqual([
    "adjacency-start",
    "adjacency-released",
    "evaluator-start",
  ]);
});

it("retries the complete preparation after evaluator failure", () => {
  const input = mesh();
  state.failEvaluator = true;
  expect(() => prepareNativeGlobalMeshTarget(input)).toThrow(
    "Evaluator failed",
  );
  state.failEvaluator = false;
  state.events.length = 0;
  expect(
    prepareNativeGlobalMeshTarget(input).query([0.2, 0.2, 0.1], 1).found,
  ).toBe(true);
  expect(state.events).toEqual([
    "adjacency-start",
    "adjacency-released",
    "evaluator-start",
  ]);
});

it("prepares all missing adjacency before evaluators and deduplicates identities", () => {
  const a = mesh(),
    b = mesh();
  const targets = prepareNativeGlobalMeshTargets([a, b, a]);
  expect(state.events).toEqual([
    "adjacency-start",
    "adjacency-released",
    "adjacency-start",
    "adjacency-released",
    "evaluator-start",
    "evaluator-start",
  ]);
  expect(targets[0]).toBe(targets[2]);
  const reference = prepareNativeGlobalMeshTarget(mesh());
  expect(targets[0].query([0.2, 0.2, 0.1], 1)).toEqual(
    reference.query([0.2, 0.2, 0.1], 1),
  );
  state.events.length = 0;
  expect(prepareNativeGlobalMeshTargets([b, a])).toEqual([
    targets[1],
    targets[0],
  ]);
  expect(state.events).toEqual([]);
});

it("preserves cached targets across an adjacency failure and retries missing targets", () => {
  const a = mesh(),
    b = mesh(),
    c = mesh();
  const old = prepareNativeGlobalMeshTarget(a);
  state.events.length = 0;
  state.failAdjacency = true;
  expect(() => prepareNativeGlobalMeshTargets([a, b, c])).toThrow(
    "Adjacency failed",
  );
  expect(state.events).toEqual(["adjacency-start"]);
  expect(prepareNativeGlobalMeshTarget(a)).toBe(old);
  state.failAdjacency = false;
  state.events.length = 0;
  prepareNativeGlobalMeshTargets([a, b, c]);
  expect(state.events).toEqual([
    "adjacency-start",
    "adjacency-released",
    "adjacency-start",
    "adjacency-released",
    "evaluator-start",
    "evaluator-start",
  ]);
});

it("does not publish incomplete batch targets on evaluator failure", () => {
  const a = mesh(),
    b = mesh();
  state.failEvaluatorAt = 2;
  expect(() => prepareNativeGlobalMeshTargets([a, b])).toThrow(
    "Evaluator failed",
  );
  state.failEvaluatorAt = state.evaluatorCalls = 0;
  state.events.length = 0;
  prepareNativeGlobalMeshTargets([a, b]);
  expect(state.events).toEqual([
    "adjacency-start",
    "adjacency-released",
    "adjacency-start",
    "adjacency-released",
    "evaluator-start",
    "evaluator-start",
  ]);
});

it("checks cancellation even when every batch target is cached", () => {
  const input = mesh();
  prepareNativeGlobalMeshTarget(input);
  state.events.length = 0;
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareNativeGlobalMeshTargets([input], { signal: controller.signal }),
  ).toThrow("cancelled");
  expect(state.events).toEqual([]);
});
it("uses two-phase preparation through the bounded worker entry and exports complete targets", () => {
  const inputs = [mesh(), mesh()];
  const stateResult = createGlobalQueryWorkerState({
    scans: inputs.map((target, i) => ({
      id: String(i),
      geometry: {
        points: target.vertices,
        normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
        rawTargetIds: new Uint32Array(),
        targetMeshes: [{ ...target, packedNodes: true, compactBounds: true }],
      },
    })),
    exportPreparedMeshes: true,
    storageBudget: { limit: 512 * 1048576, reserved: 0 },
  });
  expect(state.events).toEqual([
    "adjacency-start",
    "adjacency-released",
    "adjacency-start",
    "adjacency-released",
    "evaluator-start",
    "evaluator-start",
  ]);
  expect(stateResult.indexes).toBe(2);
  expect(
    stateResult.prepared!.preparedMeshes!.map((item) => item.targets.length),
  ).toEqual([1, 1]);
});
