import { describe, expect, it } from "vitest";
import {
  prepareNativeSketchArcRebuild,
  prepareNativeSketchArcPlacedReplacement,
} from "../src/sketch-arc-rebuild";

const frame = [
  [0, 0, 1, 10],
  [1, 0, 0, 20],
  [0, 1, 0, 30],
];
const identity = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];
const points = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
];
const world = [
  [10, 21, 30],
  [10, 20, 31],
  [10, 19, 30],
];
const initial = (placement = frame) =>
  prepareNativeSketchArcRebuild(
    points,
    placement,
    { radius: undefined, closed: false, sourceRecords: [] },
    false,
  );

describe("native placed arc record replacement", () => {
  it("translates local geometry from the fourth world record without flattening its new Z", () => {
    const prior = initial(),
      input = [...structuredClone(world), [17, 25, 36]];
    const result = prepareNativeSketchArcPlacedReplacement(input, frame, prior);
    expect(result.route).toBe("translate");
    expect(result.preparation.points).toEqual([
      [6, 6, 7],
      [5, 7, 7],
      [4, 6, 7],
    ]);
    expect(result.preparation.center).toEqual([5, 6, 7]);
    expect(result.preparation.radius).toBe(1);
    expect(result.preparation.sourceRecords).toEqual([
      [6, 6, 7],
      [5, 7, 7],
      [4, 6, 7],
      [5, 6, 7],
    ]);
    expect(result.preparation.fitSucceeded).toBeUndefined();
    expect(result.preparation.backendRequest?.points).toEqual(
      result.preparation.points,
    );
    input[0][0] = 99;
    expect(prior).toEqual(initial());
    expect(result.preparation.frame).not.toBe(prior.frame);
    expect(result.preparation.backendRequest?.points).not.toBe(
      result.preparation.points,
    );
  });

  it("uses the supplied comparison frame but preserves stored placement on the translation branch", () => {
    const prior = initial(identity);
    const result = prepareNativeSketchArcPlacedReplacement(
      [...world, [17, 25, 36]],
      frame,
      prior,
    );
    expect(result.route).toBe("translate");
    expect(result.preparation.frame).toEqual(identity);
    expect(result.preparation.center).toEqual([5, 6, 7]);
  });

  it("converts exactly three world records with the transpose and refits using the supplied frame", () => {
    const result = prepareNativeSketchArcPlacedReplacement(
      [
        [109, 22, 30],
        [109, 20, 32],
        [109, 18, 30],
      ],
      frame,
      initial(identity),
    );
    expect(result.route).toBe("refit");
    expect(result.preparation.points).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [-2, 0, 0],
    ]);
    expect(result.preparation.frame).toEqual(frame);
    expect(result.preparation.radius).toBe(2);
    expect(result.preparation.fitSucceeded).toBe(true);
  });

  it.each([0, 1, 2])(
    "refits when world comparison %i fails, ignoring the fourth point",
    (index) => {
      const input = [...structuredClone(world), [999, 999, 999]];
      input[index][0] += 0.01;
      const result = prepareNativeSketchArcPlacedReplacement(
        input,
        frame,
        initial(),
      );
      expect(result.route).toBe("refit");
      expect(result.preparation.points).toEqual(points);
      expect(result.preparation.center).toEqual([0, 0, 0]);
    },
  );

  it("uses strict world squared-distance comparison at equality and below", () => {
    const input = [...structuredClone(points), [0, 0, 0]];
    input[1][0] = 0.001;
    input[1][2] = 0.003;
    expect(
      prepareNativeSketchArcPlacedReplacement(
        input,
        identity,
        initial(identity),
      ).route,
    ).toBe("refit");
    input[1][2] = 0.0029999999999999996;
    expect(
      prepareNativeSketchArcPlacedReplacement(
        input,
        identity,
        initial(identity),
      ).route,
    ).toBe("translate");
  });

  it("applies center delta rather than directly assigning the inverse-transformed center", () => {
    const prior = {
      ...initial(identity),
      radius: 2,
      center: [1e16, 0, 0] as const,
      points: [
        [1e16 + 2, 0, 0],
        [1e16, 2, 0],
        [1e16 - 2, 0, 0],
      ] as const,
    };
    const result = prepareNativeSketchArcPlacedReplacement(
      [...prior.points, [1, 0, 0]],
      identity,
      prior,
    );
    expect(result.route).toBe("translate");
    expect(result.preparation.center).toEqual([0, 0, 0]);
    expect(result.preparation.points).toEqual([
      [2, 0, 0],
      [0, 2, 0],
      [-2, 0, 0],
    ]);
    expect(result.preparation.radius).toBe(2);
  });

  it("preserves the inverse multiplication/addition order under cancellation", () => {
    const rotation = [
      [2 / 3, -1 / 3, 2 / 3, 0],
      [2 / 3, 2 / 3, -1 / 3, 0],
      [-1 / 3, 2 / 3, 2 / 3, 0],
    ];
    const first = [
      [2 / 3, 2 / 3, -1 / 3],
      [-1 / 3, 2 / 3, 2 / 3],
      [-2 / 3, -2 / 3, 1 / 3],
    ];
    const result = prepareNativeSketchArcPlacedReplacement(
      [...first, [1e16, 1, -1e16]],
      rotation,
      initial(rotation),
    );
    expect(result.route).toBe("translate");
    expect(result.preparation.center[2]).toBe(0);
    // Regrouping the cancelling large products first would instead yield -1/3.
    expect(1e16 * (2 / 3) + -1e16 * (2 / 3) + 1 * (-1 / 3)).toBe(-1 / 3);
  });

  it("compares closed internal endpoints and clears closure for translation and refit", () => {
    const prior = prepareNativeSketchArcRebuild(
      points,
      frame,
      { radius: 1, closed: false, sourceRecords: [] },
      true,
    );
    const refit = prepareNativeSketchArcPlacedReplacement(
      [...world, [10, 20, 30]],
      frame,
      prior,
    );
    expect(refit.route).toBe("refit");
    expect(refit.preparation.closed).toBe(false);
    const moved = prepareNativeSketchArcPlacedReplacement(
      [world[2], world[1], world[2], [17, 25, 36]],
      frame,
      prior,
    );
    expect(moved.route).toBe("translate");
    expect(moved.preparation.closed).toBe(false);
    expect(moved.preparation.sourceRecords[0]).toEqual([4, 6, 7]);
  });

  it("preserves unknown radius through translation after an initial failed fit", () => {
    const prior = prepareNativeSketchArcRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
      ],
      identity,
      { radius: undefined, closed: false, sourceRecords: [] },
      false,
    );
    const result = prepareNativeSketchArcPlacedReplacement(
      [...prior.points, [2, 3, 4]],
      identity,
      prior,
    );
    expect(result.route).toBe("translate");
    expect(result.preparation.radius).toBeUndefined();
    expect(result.preparation.sourceRecords[3]).toEqual([2, 3, 4]);
    expect(result.preparation.backendRequest).toBeDefined();
  });

  it("rejects malformed records, invalid frames and arithmetic overflow without changing prior state", () => {
    const prior = initial(),
      before = structuredClone(prior);
    for (const input of [
      [],
      world.slice(0, 2),
      [...world, [NaN, 0, 0]],
      new Array(4),
      new Array(32769).fill([0, 0, 0]),
    ])
      expect(() =>
        prepareNativeSketchArcPlacedReplacement(input, frame, prior),
      ).toThrow();
    expect(() =>
      prepareNativeSketchArcPlacedReplacement(world, [[1, 0]], prior),
    ).toThrow();
    expect(() =>
      prepareNativeSketchArcPlacedReplacement(
        [...world, [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]],
        [
          [Number.MAX_VALUE, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
        ],
        prior,
      ),
    ).toThrow();
    expect(prior).toEqual(before);
  });
});
