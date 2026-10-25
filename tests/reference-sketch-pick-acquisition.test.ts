import { describe, expect, it } from "vitest";
import {
  acquireSketchReferencePick,
  resolvePickedSketchReferencePoint,
  type PickedSketchReferenceSource,
} from "../src/reference-source-primitives";

const identity = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
] as const;

describe("reference pick acquisition from a selected sketch record", () => {
  it("rounds the local record before applying owner placement", () => {
    const frame = [
      [1, 0, 0, -16777216],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ] as const;
    // Transforming the unrounded local coordinate would incorrectly produce 1.
    expect(acquireSketchReferencePick(frame, [16777217, 0, 0])).toEqual([
      0, 0, 0,
    ]);
  });

  it("rounds the transformed result again for the retained world pick", () => {
    const frame = [
      [1, 0, 0, 1 + 2 ** -24],
      [0, 1, 0, 1 + 3 * 2 ** -24],
      [0, 0, 1, -(1 + 2 ** -24)],
    ] as const;
    expect(acquireSketchReferencePick(frame, [0, 0, 0])).toEqual([
      1,
      1 + 2 ** -22,
      -1,
    ]);
  });

  it("uses all three placed components in row order", () => {
    const frame = [
      [0, -1, 0, 10],
      [1, 0, 0, 20],
      [0, 0, 1, 30],
    ] as const;
    expect(acquireSketchReferencePick(frame, [1, 2, 3])).toEqual([8, 21, 33]);
  });

  it("keeps double precision transform arithmetic between Float32 conversions", () => {
    const frame = [
      [1e16, 1, -1e16, 4],
      [1e16, 1, -1e16, 5],
      [1e16, 1, -1e16, 6],
    ] as const;
    expect(acquireSketchReferencePick(frame, [1, 1, 1])).toEqual([4, 5, 6]);
  });

  it("does not replace later full-precision nearest-record resolution", () => {
    const frame = [
      [1, 0, 0, -16777216],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ] as const;
    const selected = [16777217, 0, 0] as const;
    const pick = acquireSketchReferencePick(frame, selected);
    expect(
      resolvePickedSketchReferencePoint(
        { frame, children: [[selected, [16777216, 0, 0]]] },
        pick,
      ),
    ).toEqual({ kind: "point", position: [0, 0, 0], objectResolved: true });
  });

  it("preserves signed zero and does not retain or mutate input storage", () => {
    const record: [number, number, number] = [-0, -0, -0];
    const frame: [
      [number, number, number, number],
      [number, number, number, number],
      [number, number, number, number],
    ] = [
      [1, 0, 0, -0],
      [0, 1, 0, -0],
      [0, 0, 1, -0],
    ];
    const pick = acquireSketchReferencePick(frame, record);
    expect(pick).toEqual([-0, -0, -0]);
    expect(record).toEqual([-0, -0, -0]);
    record[0] = 5;
    frame[0][3] = 10;
    expect(pick).toEqual([-0, -0, -0]);
  });

  it.each([NaN, Infinity, -Infinity, 1e40])(
    "rejects a local coordinate outside the finite Float32 carrier: %s",
    (bad) => {
      expect(() => acquireSketchReferencePick(identity, [bad, 0, 0])).toThrow();
    },
  );

  it("rejects overflow when quantizing the placed result", () => {
    const frame = [[1, 0, 0, 1e40], identity[1], identity[2]] as const;
    expect(() => acquireSketchReferencePick(frame, [0, 0, 0])).toThrow();
  });

  it("rejects malformed and nonfinite placement rather than inventing a frame", () => {
    for (const frame of [
      undefined,
      [],
      [[1, 0, 0]],
      [[1, 0, 0, NaN], identity[1], identity[2]],
    ]) {
      expect(() =>
        acquireSketchReferencePick(
          frame as unknown as PickedSketchReferenceSource["frame"],
          [0, 0, 0],
        ),
      ).toThrow();
    }
  });
});
