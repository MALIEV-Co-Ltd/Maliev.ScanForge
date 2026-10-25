import { describe, expect, it } from "vitest";
import { prepareNativeSketchArcRebuild } from "../src/sketch-arc-rebuild";
import {
  decodeSketchSourceRecordStore,
  encodeSketchSourceRecordStore,
} from "../src/sketch-source-records";
import { resolveSketchConstructionPick } from "../src/reference-construction-resolver";

const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
] as const;
const inputs = [
  [1, 0, 7],
  [0, 1, 8],
  [-1, 0, 9],
] as const;
const empty = { radius: 17, closed: false, sourceRecords: [] };
const prior = {
  radius: 17,
  closed: false,
  sourceRecords: [
    [8, 8, 0],
    [9, 9, 0],
    [10, 10, 0],
    [77, 88, 0],
  ],
};

describe("native stateful arc rebuild preparation", () => {
  it("preserves an explicitly unknown prior radius until a builder branch writes it", () => {
    const unknown = { ...empty, radius: undefined };
    const failed = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      unknown,
      false,
    );
    expect(failed.radius).toBeUndefined();
    expect(failed.fitSucceeded).toBe(false);
    expect(failed.backendRequest).toBeUndefined();
    const fallback = prepareNativeSketchArcRebuild(
      [
        [3, 4, 0],
        [3, 4, 0],
        [3, 4, 0],
      ],
      frame,
      unknown,
      false,
    );
    expect(fallback.radius).toBe(0);
    const fitted = prepareNativeSketchArcRebuild(inputs, frame, unknown, false);
    expect(fitted.radius).toBe(1);
    expect(fitted.fitSucceeded).toBe(true);
  });

  it("requires the prior radius field even when its value is explicitly unknown", () => {
    expect(() =>
      prepareNativeSketchArcRebuild(
        inputs,
        frame,
        { closed: false, sourceRecords: [] },
        false,
      ),
    ).toThrow();
  });
  it("fits local geometry and replaces all four source records on success", () => {
    const result = prepareNativeSketchArcRebuild(inputs, frame, prior, false);
    expect(result).toEqual({
      frame,
      points: [
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
      ],
      center: [0, 0, 0],
      radius: 1,
      closed: false,
      sourceRecords: [
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
        [0, 0, 0],
      ],
      fitSucceeded: true,
      backendRequest: {
        kind: "arc",
        points: [
          [1, 0, 0],
          [0, 1, 0],
          [-1, 0, 0],
        ],
        center: [0, 0, 0],
      },
    });
  });

  it("retains the previous radius and fourth source point on an early failed edit", () => {
    const result = prepareNativeSketchArcRebuild(
      [
        [0, 0, 9],
        [1, 0, 9],
        [3, 0, 9],
      ],
      frame,
      prior,
      false,
    );
    expect(result.fitSucceeded).toBe(false);
    expect(result.backendRequest).toBeUndefined();
    expect(result.radius).toBe(17);
    expect(result.center).toEqual([1, 0, 0]);
    expect(result.sourceRecords).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
      [77, 88, 0],
    ]);
  });

  it("initializes an empty collection with the middle point even when fitting fails", () => {
    const result = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      empty,
      false,
    );
    expect(result.sourceRecords[3]).toEqual([1, 0, 0]);
    expect(result.radius).toBe(17);
    expect(result.backendRequest).toBeUndefined();
  });

  it.each([
    [
      [0, 0, 3],
      [0, 0, 4],
      [2, 0, 5],
    ],
    [
      [0, 0, 3],
      [2, 0, 4],
      [2, 0, 5],
    ],
  ])(
    "repairs either near-coincident adjacent pair before retaining source records: %j",
    (a, b, c) => {
      const result = prepareNativeSketchArcRebuild(
        [a, b, c],
        frame,
        empty,
        false,
      );
      expect(result.points).toEqual([
        [0, 0, 0],
        [1, -1, 0],
        [2, 0, 0],
      ]);
      expect(result.center).toEqual([1, 0, 0]);
      expect(result.radius).toBe(1);
      expect(result.fitSucceeded).toBe(true);
    },
  );

  it("keeps the fallback radius write even when all points coincide and fitting fails", () => {
    const result = prepareNativeSketchArcRebuild(
      [
        [3, 4, 5],
        [3, 4, 6],
        [3, 4, 7],
      ],
      frame,
      { ...prior, closed: true },
      false,
    );
    expect(result.radius).toBe(0);
    expect(result.center).toEqual([3, 4, 0]);
    expect(result.sourceRecords[3]).toEqual([77, 88, 0]);
    expect(result.closed).toBe(true);
    expect(result.backendRequest).toBeUndefined();
  });

  it("does not repair an adjacent squared distance exactly equal to 1e-4", () => {
    const result = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [0.01, 0, 0],
        [1, 1, 0],
      ],
      frame,
      empty,
      false,
    );
    expect(result.points[1]).toEqual([0.01, 0, 0]);
    const below = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [0.009999, 0, 0],
        [1, 1, 0],
      ],
      frame,
      empty,
      false,
    );
    expect(below.points[1][0]).toBeCloseTo(1, 14);
    expect(below.points[1][1]).toBeCloseTo(0, 14);
  });

  it("keeps source A while explicit closure copies C into the backend endpoint", () => {
    const result = prepareNativeSketchArcRebuild(inputs, frame, empty, true);
    expect(result.closed).toBe(true);
    expect(result.fitSucceeded).toBe(true);
    expect(result.radius).toBe(1);
    expect(result.sourceRecords[0]).toEqual([1, 0, 0]);
    expect(result.points[0]).toEqual([-1, 0, 0]);
    expect(result.backendRequest?.points).toEqual([
      [-1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
    ]);
    expect(result.backendRequest?.kind).toBe("arc");
    expect(result).not.toHaveProperty("backendAccepted");
  });

  it("closes only below the endpoint squared-distance threshold", () => {
    const below = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 1, 0],
        [0.00005, 0, 0],
      ],
      frame,
      empty,
      false,
    );
    expect(below.fitSucceeded).toBe(true);
    expect(below.closed).toBe(true);
    expect(below.points[0]).toEqual([0.00005, 0, 0]);
    expect(below.sourceRecords[0]).toEqual([0, 0, 0]);
    const equal = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 1, 0],
        [0.0001, 0, 0],
      ],
      frame,
      empty,
      false,
    );
    expect(equal.closed).toBe(false);
    expect(equal.points[0]).toEqual([0, 0, 0]);
  });

  it("does not silently clear a previous closed flag when the caller has not reset it", () => {
    const result = prepareNativeSketchArcRebuild(
      inputs,
      frame,
      { ...empty, closed: true },
      false,
    );
    expect(result.closed).toBe(true);
    expect(result.points[0]).toEqual([1, 0, 0]);
  });

  it("does not apply requested closure after an early fit failure", () => {
    const result = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      empty,
      true,
    );
    expect(result.closed).toBe(false);
    expect(result.points[0]).toEqual([0, 0, 0]);
  });

  it("retains the third-point radius and center rounding", () => {
    const result = prepareNativeSketchArcRebuild(
      [
        [1.3, 0.7, 0],
        [3.5, 1.2, 0],
        [2.1, 4.9, 0],
      ],
      frame,
      empty,
      false,
    );
    expect(result.center).toEqual([1.9921945701357466, 2.744343891402715, 0]);
    expect(result.radius).toBe(2.158350126657167);
  });

  it("detaches prior state, inputs, backend arguments and retained sources", () => {
    const previous = structuredClone(prior);
    const points: number[][] = inputs.map((p) => [...p]);
    const placement: number[][] = frame.map((p) => [...p]);
    const result = prepareNativeSketchArcRebuild(
      points,
      placement,
      previous,
      true,
    );
    points[0][0] = 99;
    placement[0][3] = 99;
    previous.sourceRecords[3][0] = 99;
    (result.backendRequest!.points[0] as unknown as number[])[0] = 555;
    (result.backendRequest!.center as unknown as number[])[0] = 555;
    expect(result.sourceRecords[0]).toEqual([1, 0, 0]);
    expect(result.points[0]).toEqual([-1, 0, 0]);
    expect(result.center).toEqual([0, 0, 0]);
    expect(result.frame[0][3]).toBe(10);
    expect(prior.sourceRecords[3]).toEqual([77, 88, 0]);
  });

  it("preserves the stale fourth source record through codec and reference picking after failure", () => {
    const result = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      frame,
      prior,
      false,
    );
    const restored = decodeSketchSourceRecordStore(
      encodeSketchSourceRecordStore({
        version: 1,
        id: "sketch",
        frame,
        children: [{ id: "arc", kind: "arc", records: result.sourceRecords }],
      }),
    );
    expect(
      resolveSketchConstructionPick(restored, {
        sourceId: "sketch",
        childId: "arc",
        recordIndex: 3,
      }).primitive,
    ).toEqual({ kind: "point", position: [87, 108, 30], objectResolved: true });
    expect(result.center).toEqual([1, 0, 0]);
  });

  it.each([
    null,
    {},
    { ...prior, radius: Infinity },
    { ...prior, closed: 1 },
    { ...prior, sourceRecords: [[1, 2, 3]] },
    { ...prior, sourceRecords: undefined },
    { ...prior, unexpected: true },
  ])("rejects malformed prior state: %j", (previous) => {
    expect(() =>
      prepareNativeSketchArcRebuild(inputs, frame, previous, false),
    ).toThrow();
  });

  it("rejects malformed requests and overflow without mutating prior state", () => {
    const before = structuredClone(prior);
    for (const points of [
      [],
      [[NaN, 0, 0], inputs[1], inputs[2]],
      [
        [1e308, 0, 0],
        [0, 1e308, 0],
        [-1e308, 0, 0],
      ],
    ])
      expect(() =>
        prepareNativeSketchArcRebuild(points, frame, prior, false),
      ).toThrow();
    expect(() =>
      prepareNativeSketchArcRebuild(inputs, [], prior, false),
    ).toThrow();
    expect(() =>
      prepareNativeSketchArcRebuild(inputs, frame, prior, 1),
    ).toThrow();
    expect(prior).toEqual(before);
  });
});
