import { describe, expect, it } from "vitest";
import { prepareNativeSketchCircleRebuild } from "../src/sketch-circle-rebuild";
import { nativeReferenceCircleInputPoints } from "../src/reference-geometry-numerics";
import {
  decodeSketchSourceRecordStore,
  encodeSketchSourceRecordStore,
  spliceSketchSourceChildren,
} from "../src/sketch-source-records";
import { resolveSketchConstructionPick } from "../src/reference-construction-resolver";

const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
] as const;
const points = [
  [1, 0, 7],
  [0, 1, 8],
  [-1, 0, 9],
] as const;

describe("native sketch circle rebuild preparation", () => {
  it("flattens the three local inputs and retains them before the fitted center", () => {
    const result = prepareNativeSketchCircleRebuild(points, frame);
    expect(result).toEqual({
      frame,
      sourceRecords: [
        [1, 0, 0],
        [0, 1, 0],
        [-1, 0, 0],
        [0, 0, 0],
      ],
      fitSucceeded: true,
      backendRequest: { kind: "circle", center: [0, 0, 0], radius: 1 },
    });
  });

  it("does not apply owner placement to stored local points or the backend request", () => {
    const result = prepareNativeSketchCircleRebuild(
      [
        [4, 5, 100],
        [3, 6, -100],
        [2, 5, 42],
      ],
      frame,
    );
    expect(result.backendRequest).toEqual({
      kind: "circle",
      center: [3, 5, 0],
      radius: 1,
    });
    expect(result.sourceRecords[3]).toEqual([3, 5, 0]);
    expect(result.frame).toEqual(frame);
  });

  it.each([
    [
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ],
    [
      [1, 2, 3],
      [1, 2, 4],
      [1, 2, 5],
    ],
    [
      [0, 0, 1],
      [0, 0, 2],
      [2, 0, 3],
    ],
  ] as const)(
    "retains middle-point center and the negative radius sentinel on a failed fit: %j",
    (a, b, c) => {
      const result = prepareNativeSketchCircleRebuild([a, b, c], frame);
      expect(result.fitSucceeded).toBe(false);
      expect(result.backendRequest).toEqual({
        kind: "circle",
        center: [b[0], b[1], 0],
        radius: -Number.MAX_VALUE,
      });
      expect(result.sourceRecords).toEqual([
        [a[0], a[1], 0],
        [b[0], b[1], 0],
        [c[0], c[1], 0],
        [b[0], b[1], 0],
      ]);
    },
  );

  it("does not replace the failed-fit center with the generic helper's centroid", () => {
    const result = prepareNativeSketchCircleRebuild(
      [
        [0, 0, 0],
        [1, 0, 0],
        [8, 0, 0],
      ],
      frame,
    );
    expect(result.sourceRecords[3]).toEqual([1, 0, 0]);
    expect(result.backendRequest.center[0]).not.toBe(3);
  });

  it("accepts a determinant exactly at the recovered inclusive threshold", () => {
    const h = 2 ** -13;
    const result = prepareNativeSketchCircleRebuild(
      [
        [0, 0, 0],
        [h, 0, 0],
        [0, h, 0],
      ],
      frame,
    );
    expect(result.fitSucceeded).toBe(true);
    expect(result.backendRequest.center).toEqual([h / 2, h / 2, 0]);
    expect(result.backendRequest.radius).toBe(Math.sqrt(2 * (h / 2) ** 2));
  });

  it("retains a failed child state below the determinant threshold", () => {
    const h = 2 ** -14;
    const result = prepareNativeSketchCircleRebuild(
      [
        [0, 0, 0],
        [h, 0, 0],
        [0, h, 0],
      ],
      frame,
    );
    expect(result.fitSucceeded).toBe(false);
    expect(result.sourceRecords[3]).toEqual([h, 0, 0]);
    expect(result.backendRequest.radius).toBe(-Number.MAX_VALUE);
  });

  it("keeps center/radius input admission separate from successful fitting", () => {
    const generated = nativeReferenceCircleInputPoints([0, 0, 99], 2 ** -23)!;
    expect(generated).toHaveLength(3);
    const result = prepareNativeSketchCircleRebuild(generated, frame);
    expect(result.fitSucceeded).toBe(false);
    expect(result.sourceRecords[1]).toEqual([0, 2 ** -23, 0]);
    expect(result.backendRequest).toEqual({
      kind: "circle",
      center: [0, 2 ** -23, 0],
      radius: -Number.MAX_VALUE,
    });
  });

  it("preserves signed XY zero while writing positive local Z zero", () => {
    const result = prepareNativeSketchCircleRebuild(
      [
        [-0, -0, -0],
        [-0, -0, -0],
        [0, 0, -0],
      ],
      frame,
    );
    expect(Object.is(result.sourceRecords[1][0], -0)).toBe(true);
    expect(Object.is(result.sourceRecords[3][1], -0)).toBe(true);
    for (const point of result.sourceRecords)
      expect(Object.is(point[2], 0)).toBe(true);
  });

  it("detaches all source inputs and owner placement", () => {
    const inputs: number[][] = points.map((point) => [...point]);
    const placement: number[][] = frame.map((row) => [...row]);
    const result = prepareNativeSketchCircleRebuild(inputs, placement);
    inputs[0][0] = 99;
    placement[0][3] = 99;
    expect(result.sourceRecords[0]).toEqual([1, 0, 0]);
    expect(result.frame[0][3]).toBe(10);
    expect(points[0]).toEqual([1, 0, 7]);
    (result.backendRequest.center as unknown as number[])[0] = 555;
    expect(result.sourceRecords[3]).toEqual([0, 0, 0]);
  });

  it("uses the third-point radius when floating-point distances disagree", () => {
    const result = prepareNativeSketchCircleRebuild(
      [
        [1.3, 0.7, 0],
        [3.5, 1.2, 0],
        [2.1, 4.9, 0],
      ],
      frame,
    );
    expect(result.backendRequest.center).toEqual([
      1.9921945701357466, 2.744343891402715, 0,
    ]);
    expect(result.backendRequest.radius).toBe(2.158350126657167);
    // Distances from the same computed center to A and B round differently.
    expect(result.backendRequest.radius).not.toBe(2.158350126657166);
    expect(result.backendRequest.radius).not.toBe(2.1583501266571665);
  });

  it("replaces and saves a whole circle record collection for the shared resolver", () => {
    const prior = {
      version: 1 as const,
      id: "sketch",
      frame,
      children: [
        {
          id: "circle",
          kind: "circle" as const,
          records: [[999, 999, 999] as const],
        },
      ],
    };
    const rebuilt = prepareNativeSketchCircleRebuild(points, frame);
    const replaced = spliceSketchSourceChildren(prior, 0, 1, [
      { id: "circle", kind: "circle", records: rebuilt.sourceRecords },
    ]);
    const restored = decodeSketchSourceRecordStore(
      JSON.parse(JSON.stringify(encodeSketchSourceRecordStore(replaced))),
    );
    expect(restored.children[0].records).toEqual(rebuilt.sourceRecords);
    expect(
      resolveSketchConstructionPick(restored, {
        sourceId: "sketch",
        childId: "circle",
        recordIndex: 3,
      }).primitive,
    ).toEqual({ kind: "point", position: [10, 20, 30], objectResolved: true });
    expect(prior.children[0].records).toEqual([[999, 999, 999]]);
  });

  it("preserves failure-state records through storage without reporting backend success", () => {
    const result = prepareNativeSketchCircleRebuild(
      [
        [0, 0, 0],
        [2, 0, 0],
        [7, 0, 0],
      ],
      frame,
    );
    const restored = decodeSketchSourceRecordStore(
      encodeSketchSourceRecordStore({
        version: 1,
        id: "sketch",
        frame,
        children: [
          { id: "circle", kind: "circle", records: result.sourceRecords },
        ],
      }),
    );
    expect(restored.children[0].records).toHaveLength(4);
    expect(result.fitSucceeded).toBe(false);
    expect(result).not.toHaveProperty("backendAccepted");
  });

  it.each(
    [
      [],
      [[1, 2, 3]],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      [...points, [9, 9, 9]],
      [[1, 2], points[1], points[2]],
      [[NaN, 0, 0], points[1], points[2]],
      [[0, 0, Infinity], points[1], points[2]],
    ].map((input) => [input]),
  )("rejects malformed input records: %j", (input) => {
    expect(() => prepareNativeSketchCircleRebuild(input, frame)).toThrow();
  });

  it("rejects invalid placement and arithmetic overflow", () => {
    expect(() =>
      prepareNativeSketchCircleRebuild(points, [[1, 0, 0, 0]]),
    ).toThrow();
    expect(() =>
      prepareNativeSketchCircleRebuild(
        [
          [1e308, 0, 0],
          [0, 1e308, 0],
          [-1e308, 0, 0],
        ],
        frame,
      ),
    ).toThrow(/finite|overflow/i);
  });
});
