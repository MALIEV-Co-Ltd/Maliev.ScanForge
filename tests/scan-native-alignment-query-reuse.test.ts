import { expect, it, vi } from "vitest";
import * as leaf from "../src/scan-noise-deviation";
import { createNativeAlignmentSurfaceQuery } from "../src/scan-native-alignment-mesh-query";
import { packAlignmentTree } from "../src/scan-alignment-packed-tree";
import type { NoiseQueryNode } from "../src/scan-noise-octree-query";

it.each([false, true])(
  "evaluates repeated triangle memberships once per point while preserving native ties (packed=%s)",
  (packed) => {
    const root: NoiseQueryNode = {
      bounds: [-3, -3, -3, 3, 3, 3],
      center: [0, 0, 0],
      mode: 0,
      triangles: [0, 1, 0, 1, 0, 1],
      children: {},
    };
    const flags = new Uint8Array(2);
    const query = createNativeAlignmentSurfaceQuery({
      root: packed ? packAlignmentTree(root) : root,
      points: new Float32Array([
        0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0,
      ]),
      triangleBounds: new Float32Array([0, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0]),
      normals: new Float32Array([0, 0, -1, 0, 0, 1]),
      neighbors: new Uint8Array(6),
      triangleFlags: flags,
      filterHidden: true,
    });
    const evaluate = vi.spyOn(leaf, "noiseTriangleDistance");
    try {
      expect(query([0.5, 0.5, 0.125], Infinity)).toEqual({
        distance: -0.125,
        closest: [0.5, 0.5, 0],
        normal: [0, 0, -1],
        openBoundary: false,
      });
      expect(evaluate).toHaveBeenCalledTimes(2);
      evaluate.mockClear();
      expect(query([-0.125, 0.5, 0.125], 10)).toEqual({
        distance: -Math.sqrt(0.03125),
        closest: [0, 0.5, 0],
        normal: [0, 0, -1],
        openBoundary: true,
      });
      expect(evaluate).toHaveBeenCalledTimes(2);
      flags[0] = 1;
      evaluate.mockClear();
      expect(query([0.5, 0.5, 0.125], 10)).toEqual({
        distance: 0.125,
        closest: [0.5, 0.5, 0],
        normal: [0, 0, 1],
        openBoundary: false,
      });
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(query([0.5, 0.5, 0.125], 0.125)).toBeUndefined();
    } finally {
      evaluate.mockRestore();
    }
  },
);

it("clears per-face visit epochs before Uint16 rollover can hide an old face", () => {
  const query = createNativeAlignmentSurfaceQuery({
    root: {
      bounds: [-3, -3, -3, 3, 3, 3],
      center: [0, 0, 0],
      mode: 0,
      triangles: [0, 0],
      children: {},
    },
    points: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    triangleBounds: new Float32Array([0, 0, 0, 2, 2, 0]),
    normals: new Float32Array([0, 0, 1]),
    neighbors: new Uint8Array(3),
  });
  expect(query([0.5, 0.5, 0.125], 10)?.distance).toBe(0.125);
  // Leave this face stamped with the first epoch while unrelated misses advance it.
  for (let i = 1; i < 0xffff; i++) query([100, 100, 100], 10);
  expect(query([0.5, 0.5, 0.25], 10)).toEqual({
    distance: 0.25,
    closest: [0.5, 0.5, 0],
    normal: [0, 0, 1],
    openBoundary: false,
  });
});
