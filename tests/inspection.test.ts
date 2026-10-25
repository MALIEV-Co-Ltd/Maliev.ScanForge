import { describe, expect, it } from "vitest";
import {
  measureGeometry,
  inspectDeviation,
  inspectSection,
  inspectDeviationAsync,
} from "../src/inspection";
import type { Entity, FitResult } from "../src/types";
const plane: FitResult = {
  kind: "plane",
  center: [0, 0, 0],
  axis: [0, 0, 2],
  rms: 0,
  maxError: 0,
};
const entity = (
  kind: Entity["kind"],
  positions: number[],
  hidden: number[] = [],
): Entity => ({
  id: "scan",
  name: "scan",
  kind,
  positions: new Float32Array(positions),
  visible: true,
  color: "#fff",
  opacity: 1,
  meshSelection: { hidden, saved: [] },
});
describe("shared inspection", () => {
  it("measures distance, included angle and a three-point circle in world units", () => {
    expect(
      measureGeometry({ first: [0, 0, 0], second: [3, 4, 0] }),
    ).toMatchObject({ distance: 5, units: "mm" });
    expect(
      measureGeometry({
        kind: "angle",
        first: [1, 0, 0],
        second: [0, 0, 0],
        third: [0, 1, 0],
      }),
    ).toMatchObject({ angle: 90, units: "deg" });
    expect(
      measureGeometry({
        kind: "radius",
        first: [1, 0, 0],
        second: [0, 1, 0],
        third: [-1, 0, 0],
      }),
    ).toMatchObject({ radius: 1, diameter: 2, units: "mm" });
    expect(
      measureGeometry({
        kind: "radius",
        first: [1, 0, 0],
        second: [0, 1, 0],
        third: [-1, 0, 0],
      }).center![1],
    ).toBeCloseTo(0, 12);
    expect(
      measureGeometry({
        kind: "diameter",
        first: [1, 0, 0],
        second: [0, 1, 0],
        third: [-1, 0, 0],
      }),
    ).toMatchObject({ value: 2 });
  });
  it("rejects degenerate picks and nonfinite results", () => {
    expect(() =>
      measureGeometry({
        kind: "angle",
        first: [0, 0, 0],
        second: [0, 0, 0],
        third: [1, 0, 0],
      }),
    ).toThrow();
    expect(() =>
      measureGeometry({
        kind: "radius",
        first: [0, 0, 0],
        second: [1, 0, 0],
        third: [2, 0, 0],
      }),
    ).toThrow();
    expect(() =>
      measureGeometry({ first: [Infinity, 0, 0], second: [0, 0, 0] }),
    ).toThrow();
  });
  it("retains point mapping, hides points individually and reports signed statistics", () => {
    const cloud = entity(
      "pointcloud",
      [0, 0, -2, 1, 0, 0, 0, 1, 2, 1, 1, 100],
      [3],
    );
    const before = cloud.positions.slice();
    const report = inspectDeviation(cloud, plane, 1);
    expect(report.distances.slice(0, 3)).toEqual([-2, 0, 2]);
    expect(report.distances[3]).toBeNull();
    expect(report).toMatchObject({
      units: "mm",
      samples: 3,
      excluded: 1,
      minimum: -2,
      maximum: 2,
      mean: 0,
      maxError: 2,
      withinTolerance: 1,
      tolerance: 1,
      semantics: "oriented-analytic-surface",
    });
    expect(report.rms).toBeCloseTo(Math.sqrt(8 / 3));
    expect(cloud.positions).toEqual(before);
  });
  it("excludes complete hidden triangles and preserves original corner indices", () => {
    const mesh = entity(
      "mesh",
      [0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 2, 4, 0, 2, 0, 3, 2],
      [0],
    );
    expect(inspectDeviation(mesh, plane, 1)).toMatchObject({
      distances: [null, null, null, 2, 2, 2],
      samples: 3,
      excluded: 3,
      rms: 2,
    });
    expect(inspectSection(mesh, "x", 2)).toMatchObject({
      length: 1.5,
      segments: [2, 0, 2, 2, 1.5, 2],
    });
  });
  it("rejects point-cloud sections, invalid fits and empty visible samples", () => {
    const cloud = entity("pointcloud", [0, 0, 1]);
    expect(() => inspectSection(cloud, "z", 0)).toThrow(/point cloud/i);
    expect(() =>
      inspectDeviation(
        cloud,
        { ...plane, kind: "other" } as unknown as FitResult,
        1,
      ),
    ).toThrow();
    expect(() => inspectDeviation(cloud, plane, 0)).toThrow();
    expect(() =>
      inspectDeviation(
        { ...cloud, meshSelection: { hidden: [0], saved: [] } },
        plane,
        1,
      ),
    ).toThrow(/visible/i);
  });
});

it("cancels a bounded deviation traversal between chunks without touching source buffers", async () => {
  const positions = new Float32Array(30_000).fill(1);
  const cloud = { ...entity("pointcloud", [0, 0, 1]), positions };
  const controller = new AbortController();
  let checkpoints = 0;
  await expect(
    inspectDeviationAsync(cloud, plane, 1, {
      check: () => {
        if (++checkpoints === 3) controller.abort();
        controller.signal.throwIfAborted();
      },
    }),
  ).rejects.toThrow();
  expect(checkpoints).toBe(3);
  expect(positions.every((v) => v === 1)).toBe(true);
  expect(
    await inspectDeviationAsync(
      entity("pointcloud", [0, 0, -1, 0, 0, 1]),
      plane,
      1,
    ),
  ).toEqual(
    inspectDeviation(entity("pointcloud", [0, 0, -1, 0, 0, 1]), plane, 1),
  );
});
