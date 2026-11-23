import { describe, expect, it } from "vitest";
import {
  resolvePickedSketchReferencePoint,
  type PickedSketchReferenceSource,
} from "../src/reference-source-primitives";
import type { ReferenceVector } from "../src/reference-construction-values";

const identity = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
] as const;
const source = (
  children: PickedSketchReferenceSource["children"],
  frame: PickedSketchReferenceSource["frame"] = identity,
): PickedSketchReferenceSource => ({ children, frame });
const point = (position: ReferenceVector) => ({
  kind: "point",
  position,
  objectResolved: true,
});

describe("picked sketch reference point from resolved stored records", () => {
  it("distinguishes a missing source from an existing source with no candidate", () => {
    expect(resolvePickedSketchReferencePoint(undefined, [0, 0, 0])).toEqual({
      kind: "unavailable",
      objectResolved: false,
    });
    expect(resolvePickedSketchReferencePoint(source([]), [0, 0, 0])).toEqual({
      kind: "unavailable",
      objectResolved: true,
    });
  });

  it("selects after the owner transform, including raw scale and shear", () => {
    const frame = [
      [2, 3, 0, 10],
      [0, 4, 0, -2],
      [0, 0, 5, 1],
    ] as const;
    expect(
      resolvePickedSketchReferencePoint(
        source(
          [
            [
              [0, 0, 0],
              [1, 2, 3],
            ],
          ],
          frame,
        ),
        [18, 6, 16],
      ),
    ).toEqual(point([18, 6, 16]));
  });

  it("retains the first equal-distance record across and within children", () => {
    const children = [
      undefined,
      [],
      [
        [-1, 0, 0],
        [1, 0, 0],
      ],
      [[0, -1, 0]],
    ] as const;
    expect(
      resolvePickedSketchReferencePoint(source(children), [0, 0, 0]),
    ).toEqual(point([-1, 0, 0]));
    expect(
      resolvePickedSketchReferencePoint(
        source([children[3], children[2]]),
        [0, 0, 0],
      ),
    ).toEqual(point([0, -1, 0]));
  });

  it("replaces the previous winner only for a strictly closer later record", () => {
    expect(
      resolvePickedSketchReferencePoint(
        source([
          [[3, 0, 0]],
          undefined,
          [
            [2, 0, 0],
            [1, 0, 0],
          ],
        ]),
        [0, 0, 0],
      ),
    ).toEqual(point([1, 0, 0]));
  });

  it("compares against Float32 pick coordinates while retaining Float64 records", () => {
    const upper = 1 + 2 ** -24;
    const pick = 1 + 3 * 2 ** -26;
    expect(Math.abs(upper - pick)).toBeLessThan(Math.abs(1 - pick));
    expect(
      resolvePickedSketchReferencePoint(
        source([
          [
            [upper, 0, 0],
            [1, 0, 0],
          ],
        ]),
        [pick, 0, 0],
      ),
    ).toEqual(point([1, 0, 0]));
    const precise = 1 + 2 ** -40;
    expect(
      resolvePickedSketchReferencePoint(source([[[precise, 0, 0]]]), [1, 0, 0]),
    ).toEqual(point([precise, 0, 0]));
  });

  it("preserves sequential transform additions before translation", () => {
    const frame = [
      [1e16, 1, -1e16, 4],
      [1e16, 1, -1e16, 5],
      [1e16, 1, -1e16, 6],
    ] as const;
    expect(
      resolvePickedSketchReferencePoint(
        source([[[1, 1, 1]]], frame),
        [4, 5, 6],
      ),
    ).toEqual(point([4, 5, 6]));
  });

  it("sums squared distance as X then Y then Z without regrouping", () => {
    expect(
      resolvePickedSketchReferencePoint(
        source([
          [
            [1, 1e-8, 1e-8],
            [1, 0, 0],
          ],
        ]),
        [0, 0, 0],
      ),
    ).toEqual(point([1, 1e-8, 1e-8]));
  });

  it("rejects equality at the promoted FLT_MAX squared-distance threshold", () => {
    const boundary = 1.844674352395373e19;
    expect(boundary * boundary).toBe(3.4028234663852886e38);
    expect(
      resolvePickedSketchReferencePoint(
        source([[[boundary, 0, 0]]]),
        [0, 0, 0],
      ),
    ).toEqual({ kind: "unavailable", objectResolved: true });
    const inside = 1.8446743523953727e19;
    expect(
      resolvePickedSketchReferencePoint(source([[[inside, 0, 0]]]), [0, 0, 0]),
    ).toEqual(point([inside, 0, 0]));
  });

  it("skips distance overflow without discarding a later valid record", () => {
    expect(
      resolvePickedSketchReferencePoint(
        source([
          [
            [1e200, 0, 0],
            [2, 0, 0],
          ],
        ]),
        [0, 0, 0],
      ),
    ).toEqual(point([2, 0, 0]));
  });

  it("skips transformed Infinity and NaN produced from finite inputs", () => {
    const frame = [
      [2, -2, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ] as const;
    expect(
      resolvePickedSketchReferencePoint(
        source(
          [
            [
              [1e308, 0, 0],
              [1e308, 1e308, 0],
              [1, 0, 0],
            ],
          ],
          frame,
        ),
        [0, 0, 0],
      ),
    ).toEqual(point([2, 0, 0]));
  });

  it("retains signed zero produced by the transform and detaches the result", () => {
    const record: [number, number, number] = [-0, -0, -0];
    const frame = [
      [1, 0, 0, -0],
      [0, 1, 0, -0],
      [0, 0, 1, -0],
    ] as const;
    const result = resolvePickedSketchReferencePoint(
      source([[record]], frame),
      [0, 0, 0],
    );
    expect(result).toEqual(point([-0, -0, -0]));
    record[0] = 12;
    expect(result).toEqual(point([-0, -0, -0]));
  });

  it.each([NaN, Infinity, -Infinity, 1e40])(
    "rejects a pick not representable as finite Float32: %s",
    (bad) => {
      expect(() =>
        resolvePickedSketchReferencePoint(source([[[0, 0, 0]]]), [bad, 0, 0]),
      ).toThrow();
    },
  );

  it("validates the finite canonical snapshot even after finding a zero-distance winner", () => {
    expect(() =>
      resolvePickedSketchReferencePoint(
        source([
          [
            [0, 0, 0],
            [NaN, 0, 0],
          ],
        ]),
        [0, 0, 0],
      ),
    ).toThrow();
    expect(() =>
      resolvePickedSketchReferencePoint(
        source([], [[Infinity, 0, 0, 0], identity[1], identity[2]]),
        [0, 0, 0],
      ),
    ).toThrow();
  });

  it("rejects malformed frame, child container and point shapes", () => {
    for (const bad of [
      { frame: [], children: [] },
      { frame: [[1, 0, 0], identity[1], identity[2]], children: [] },
      { frame: identity, children: null },
      { frame: identity, children: [null] },
      { frame: identity, children: [[[1, 2]]] },
    ]) {
      expect(() =>
        resolvePickedSketchReferencePoint(
          bad as unknown as PickedSketchReferenceSource,
          [0, 0, 0],
        ),
      ).toThrow();
    }
  });
});
