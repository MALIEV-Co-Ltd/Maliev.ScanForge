import { describe, expect, it } from "vitest";
import {
  prepareNativeSketchArcRebuild,
  prepareNativeSketchArcLocalReplacement,
} from "../src/sketch-arc-rebuild";

const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const points = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
];
const initial = () =>
  prepareNativeSketchArcRebuild(
    points,
    frame,
    { radius: undefined, closed: false, sourceRecords: [] },
    false,
  );
const incoming = () => [...structuredClone(points), [91, 92, 93]];

describe("native arc local record replacement", () => {
  it("retains internal geometry for four near records but rebuilds source and backend state", () => {
    const prior = initial(),
      records = incoming();
    records[1][0] = 0.001;
    const result = prepareNativeSketchArcLocalReplacement(records, prior);
    expect(result.route).toBe("retain");
    expect(result.preparation.points).toEqual(points);
    expect(result.preparation.sourceRecords).toEqual([...points, [0, 0, 0]]);
    expect(result.preparation.radius).toBe(prior.radius);
    expect(result.preparation.fitSucceeded).toBeUndefined();
    expect(result.preparation.backendRequest?.points).toEqual(points);
    expect(result.preparation.frame).toEqual(frame);
    records[0][0] = 99;
    expect(result.preparation.points[0][0]).toBe(1);
    expect(prior).toEqual(initial());
  });

  it("refits exactly three records even when all are within the retention tolerance", () => {
    const records = structuredClone(points);
    records[1][0] = 0.001;
    const result = prepareNativeSketchArcLocalReplacement(records, initial());
    expect(result.route).toBe("refit");
    expect(result.preparation.points[1][0]).toBe(0.001);
    expect(result.preparation.center).not.toEqual([0, 0, 0]);
    expect(result.preparation.fitSucceeded).toBe(true);
  });

  it.each([0, 1, 2])("compares defining record %i independently", (index) => {
    const records = incoming();
    records[index][0] += 0.004;
    expect(
      prepareNativeSketchArcLocalReplacement(records, initial()).route,
    ).toBe("refit");
  });

  it("compares Z before refitting flattens it", () => {
    const records = incoming();
    records[0][2] = 0.004;
    const result = prepareNativeSketchArcLocalReplacement(records, initial());
    expect(result.route).toBe("refit");
    expect(result.preparation.points[0][2]).toBe(0);
  });

  it("uses the strict squared-distance threshold, including equality", () => {
    // No X subtraction rounding: the middle point has X=0 and Z=0.
    const records = incoming();
    records[1][0] = 0.001;
    records[1][2] = 0.003;
    expect(0.001 * 0.001 + 0.003 * 0.003).toBe(1e-5);
    expect(
      prepareNativeSketchArcLocalReplacement(records, initial()).route,
    ).toBe("refit");
    records[1][2] = 0.0029999999999999996;
    expect(
      prepareNativeSketchArcLocalReplacement(records, initial()).route,
    ).toBe("retain");
  });

  it("clears closure before either route and applies the retained branch's positive-zero additions", () => {
    const prior = initial();
    const closed = {
      ...prior,
      closed: true,
      center: [-0, -0, -0] as const,
      points: [
        [1, -0, -0],
        [-0, 1, -0],
        [-1, -0, -0],
      ] as const,
    };
    const result = prepareNativeSketchArcLocalReplacement(incoming(), closed);
    expect(result.route).toBe("retain");
    expect(result.preparation.closed).toBe(false);
    expect(result.preparation.center).toEqual([0, 0, 0]);
    expect(Object.is(result.preparation.points[0][1], -0)).toBe(false);
    expect(Object.is(closed.points[0][1], -0)).toBe(true);
    const refitted = prepareNativeSketchArcLocalReplacement(points, closed);
    expect(refitted.route).toBe("refit");
    expect(refitted.preparation.closed).toBe(false);
  });

  it("compares internal endpoints rather than the old source records after closure", () => {
    const closed = prepareNativeSketchArcRebuild(
      points,
      frame,
      { radius: 1, closed: false, sourceRecords: [] },
      true,
    );
    expect(
      prepareNativeSketchArcLocalReplacement(incoming(), closed).route,
    ).toBe("refit");
    const retained = prepareNativeSketchArcLocalReplacement(
      [...closed.points, [9, 9, 9]],
      closed,
    );
    expect(retained.route).toBe("retain");
    expect(retained.preparation.closed).toBe(false);
    expect(retained.preparation.sourceRecords[0]).toEqual([-1, 0, 0]);
    expect(retained.preparation.backendRequest?.points[0]).toEqual([-1, 0, 0]);
  });

  it("regenerates the fourth source record from internal center after an earlier failed fit", () => {
    const prior = initial();
    const failed = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      {
        radius: prior.radius,
        closed: prior.closed,
        sourceRecords: prior.sourceRecords,
      },
      false,
    );
    expect(failed.sourceRecords[3]).toEqual([0, 0, 0]);
    const result = prepareNativeSketchArcLocalReplacement(
      [...failed.points, [99, 99, 99]],
      failed,
    );
    expect(result.route).toBe("retain");
    expect(result.preparation.sourceRecords[3]).toEqual([1, 0, 0]);
    expect(result.preparation.radius).toBe(1);
    expect(result.preparation.backendRequest).toBeDefined();
    expect(result.preparation.fitSucceeded).toBeUndefined();
  });

  it("does not invent a radius when retaining an initially failed arc", () => {
    const failed = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      { radius: undefined, closed: true, sourceRecords: [] },
      false,
    );
    const result = prepareNativeSketchArcLocalReplacement(
      [...failed.points, [0, 0, 0]],
      failed,
    );
    expect(result.preparation.radius).toBeUndefined();
    expect(result.preparation.closed).toBe(false);
    expect(result.preparation.backendRequest).toBeDefined();
  });

  it("rejects malformed, nonfinite, sparse and excessive records without mutating prior state", () => {
    const prior = initial(),
      before = structuredClone(prior);
    for (const bad of [
      null,
      [],
      points.slice(0, 2),
      [...points, [NaN, 0, 0]],
      new Array(4),
      new Array(32769).fill([0, 0, 0]),
    ])
      expect(() =>
        prepareNativeSketchArcLocalReplacement(bad, prior),
      ).toThrow();
    expect(prior).toEqual(before);
  });
});
