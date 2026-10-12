import { describe, expect, it } from "vitest";
import { createCurvatureOwnerDefaults } from "../src/field-curvature-defaults";
import { prepareCurvatureOwnerBounds } from "../src/field-curvature-owner-bounds";
import { prepareCurvatureRadii } from "../src/field-curvature-schedule";
import { prepareCurvatureNormalThresholds } from "../src/field-curvature-normal-thresholds";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";
import { buildCurvatureEdgeData } from "../src/field-edge-curvature";
import { aggregateCurvatureNeighborhoods } from "../src/field-curvature-neighborhood";
import {
  deriveCurvatureFaceEigenData,
  qualifyCurvatureFaces,
} from "../src/field-curvature-faces";
import { produceCurvatureDirections } from "../src/field-curvature-directions";
import { propagateCurvatureRadii } from "../src/field-curvature-propagation";
import native from "./fixtures/field-native-defaults.json";

describe("curvature numerical owner defaults", () => {
  it.each(native.cases)(
    "matches original reset of pattern $initialPattern",
    (entry) => {
      expect(createCurvatureOwnerDefaults()).toEqual(entry.defaults);
    },
  );
  it("returns independent settings and prior bound state", () => {
    const first = createCurvatureOwnerDefaults();
    first.previousBounds.minimum = 100;
    first.minimumControl = 1;
    const next = createCurvatureOwnerDefaults();
    expect(next.previousBounds.minimum).toBe(-1);
    expect(next.minimumControl).toBe(50);
  });
  it("uses the recovered tangent-based scale rather than its rounded approximation", () => {
    const defaults = createCurvatureOwnerDefaults();
    expect(defaults.thresholdScale).not.toBe(Math.fround(3.8));
    expect(defaults.thresholdScale).toBe(
      native.cases[0].defaults.thresholdScale,
    );
    expect(defaults.ratioMinimum).toBe(Math.fround(0.7));
  });
  it("preserves reset sentinels until geometry is supplied", () => {
    const defaults = createCurvatureOwnerDefaults();
    expect(
      prepareCurvatureOwnerBounds({
        geometryPresent: false,
        minimumControl: defaults.minimumControl,
        maximumControl: defaults.maximumControl,
        targetCount: defaults.targetCount,
        baseLength: 0,
        overrideScale: false,
        partCount: 0,
        areas: { baseArea: 0 },
        previous: defaults.previousBounds,
      }),
    ).toEqual(defaults.previousBounds);
  });
  it("connects defaults, actual triangle area, owner bounds, normal caches and all numerical direction branches", () => {
    const defaults = createCurvatureOwnerDefaults();
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
    const cache = buildTriangleNormalCache(positions, triangles);
    expect(cache.surfaceArea).toBe(1);
    const edges = buildCurvatureEdgeData(positions, triangles, cache.normals);
    const bounds = prepareCurvatureOwnerBounds({
      geometryPresent: true,
      minimumControl: defaults.minimumControl,
      maximumControl: defaults.maximumControl,
      targetCount: defaults.targetCount,
      baseLength: 10,
      overrideScale: false,
      partCount: 1,
      areas: { baseArea: cache.surfaceArea, contextArea: cache.surfaceArea },
      previous: defaults.previousBounds,
    });
    expect(bounds.count).toBe(5);
    const schedule = prepareCurvatureRadii(
      bounds.count,
      bounds.minimum,
      bounds.maximum,
      defaults.scheduleMode,
      defaults.thresholdScale,
    );
    const angles = prepareCurvatureNormalThresholds(
      defaults.qualificationAngle,
      defaults.lowerPenaltyAngle,
      defaults.upperPenaltyAngle,
    );
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
        qualified: qualifyCurvatureFaces(eigen, cache.normals, {
          ratioMinimum: defaults.ratioMinimum,
          radiusMinimum: schedule.thresholds[index],
          normalDotMaximum: angles.qualificationMaximum,
        }),
      };
    });
    expect(stages.map((stage) => Array.from(stage.qualified))).toEqual(
      Array.from({ length: 5 }, () => [0]),
    );
    const directions = produceCurvatureDirections(
      stages,
      cache.normals,
      schedule.thresholds,
      {
        backwardSpan: defaults.backwardSpan,
        forwardSpan: defaults.forwardSpan,
        ratioMinimum: defaults.ratioMinimum,
        normalThresholds: angles.directionPenaltyThresholds,
      },
    );
    expect(Array.from(directions.completed)).toEqual([1, 1]);
    expect(Array.from(directions.selectedRadius)).toEqual([4, 4]);
    expect(Array.from(directions.directions)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(Array.from(directions.flags)).toEqual([3, 3]);
    expect(
      propagateCurvatureRadii(
        edges.adjacency,
        directions.selectedRadius,
        directions.candidateMasks,
        directions.selectedRadius,
        { enabled: defaults.propagateRadii },
      ),
    ).toEqual(directions.selectedRadius);
  });
});
