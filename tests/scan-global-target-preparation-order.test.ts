import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as string[],
  failAdjacency: false,
  failEvaluator: false,
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
      if (state.failEvaluator) throw Error("Evaluator failed");
      return actual.prepareNativeGlobalMeshEvaluator(...args);
    },
  };
});

import { prepareNativeGlobalMeshTarget } from "../src/scan-native-global-mesh-target";

const mesh = () => ({
  vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  triangles: Uint32Array.of(0, 1, 2),
});
beforeEach(() => {
  state.events.length = 0;
  state.failAdjacency = state.failEvaluator = false;
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
