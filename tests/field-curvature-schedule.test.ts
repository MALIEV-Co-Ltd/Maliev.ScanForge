import { describe, expect, it } from "vitest";
import { prepareCurvatureRadii } from "../src/field-curvature-schedule";
import native from "./fixtures/field-native-schedule.json";
import { buildCurvatureEdgeData } from "../src/field-edge-curvature";
import { aggregateCurvatureNeighborhoods } from "../src/field-curvature-neighborhood";
import {
  deriveCurvatureFaceEigenData,
  qualifyCurvatureFaces,
} from "../src/field-curvature-faces";
import { produceCurvatureDirections } from "../src/field-curvature-directions";
import { propagateCurvatureRadii } from "../src/field-curvature-propagation";

describe("curvature owner radius preparation", () => {
  it("feeds scheduled radii and reciprocal thresholds through folded-mesh direction production", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
    const normals = new Float32Array([0, 0, 1, 0, 1, 0]);
    const edges = buildCurvatureEdgeData(positions, triangles, normals);
    const schedule = prepareCurvatureRadii(3, 10, 30, 1, 3.8);
    const stages = Array.from(schedule.radii, (radius, index) => {
      const neighborhood = aggregateCurvatureNeighborhoods(
        positions,
        edges,
        radius,
      );
      expect(Array.from(neighborhood.neighborCounts)).toEqual([3, 3, 3, 3]);
      const eigen = deriveCurvatureFaceEigenData(
        triangles,
        neighborhood.tensors,
      );
      return {
        ...eigen,
        qualified: qualifyCurvatureFaces(eigen, normals, {
          ratioMinimum: 0.7,
          radiusMinimum: schedule.thresholds[index],
          normalDotMaximum: 0.5,
        }),
      };
    });
    expect(stages.map((stage) => Array.from(stage.qualified))).toEqual([
      [0],
      [0],
      [0],
    ]);
    const directions = produceCurvatureDirections(
      stages,
      normals,
      schedule.thresholds,
      {
        backwardSpan: 1,
        forwardSpan: 1,
        ratioMinimum: 0.7,
        normalThresholds: [0.1, 0.4, 0.8],
      },
    );
    expect(Array.from(directions.completed)).toEqual([1, 1]);
    expect(Array.from(directions.selectedRadius)).toEqual([2, 2]);
    expect(Array.from(directions.directions)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(Array.from(directions.flags)).toEqual([3, 3]);
    expect(
      Array.from(directions.strengths).every(
        (v) => Number.isFinite(v) && v > 0,
      ),
    ).toBe(true);
    expect(
      propagateCurvatureRadii(
        edges.adjacency,
        directions.selectedRadius,
        directions.candidateMasks,
        directions.selectedRadius,
      ),
    ).toEqual(directions.selectedRadius);
  });
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches native radius schedule $id with $count stages and mode $mode",
    (entry) => {
      const result = prepareCurvatureRadii(
        entry.count,
        entry.minimum,
        entry.maximum,
        entry.mode,
        entry.scale,
      );
      expect(Array.from(result.radii)).toEqual(entry.radii);
      expect(Array.from(result.thresholds)).toEqual(entry.thresholds);
    },
  );
  it("uses the maximum radius for a single stage in every mode", () => {
    for (const mode of [0, 1, 2, -5]) {
      const result = prepareCurvatureRadii(1, 2, 16, mode, 4);
      expect(Array.from(result.radii)).toEqual([16]);
      expect(Array.from(result.thresholds)).toEqual([1 / 64]);
    }
  });
  it("uses a blended linear/logarithmic schedule for every other signed mode", () => {
    const result = prepareCurvatureRadii(5, 1, 100, 2, 2);
    expect(prepareCurvatureRadii(5, 1, 100, -100, 2)).toEqual(result);
    expect(prepareCurvatureRadii(5, 1, 100, 2147483647, 2)).toEqual(result);
  });
  it("supports descending and constant schedules without clamping endpoints", () => {
    expect(Array.from(prepareCurvatureRadii(3, 16, 2, 1, 1).radii)).toEqual([
      16, 9, 2,
    ]);
    expect(Array.from(prepareCurvatureRadii(3, 2, 2, 0, 1).radii)).toEqual([
      2, 2, 2,
    ]);
  });
  it("returns independently owned empty schedules", () => {
    const result = prepareCurvatureRadii(0, 1, 2, 0, 1);
    expect(result.radii.length).toBe(0);
    expect(result.thresholds.length).toBe(0);
    expect(result.radii).not.toBe(result.thresholds);
  });
  it.each([
    [-1, 1, 2, 0, 1],
    [0.5, 1, 2, 0, 1],
    [2147483648, 1, 2, 0, 1],
    [2, 0, 2, 0, 1],
    [2, 1, -1, 0, 1],
    [2, 1, 2, 0, Infinity],
    [2, 1, 2, 0, 0],
    [2, 1, 2, 0.5, 1],
    [2, 1, 2, 2147483648, 1],
    [2, 1, 2, -2147483649, 1],
  ])("rejects invalid input %j", (count, low, high, mode, scale) => {
    expect(() => prepareCurvatureRadii(count, low, high, mode, scale)).toThrow(
      /inputs/,
    );
  });
  it.each([
    [1, 1, 3e38, 0, 3e38],
    [1, 1, 1e-38, 0, 1e-38],
    [3, 1e-38, 3e38, 0, 1],
  ])(
    "rejects arithmetic overflow or underflow %j",
    (count, low, high, mode, scale) => {
      expect(() =>
        prepareCurvatureRadii(count, low, high, mode, scale),
      ).toThrow(/overflowed|underflowed/);
    },
  );
});
