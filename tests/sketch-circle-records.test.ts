import { expect, it } from "vitest";
import {
  prepareNativeSketchCircleRebuild as rebuild,
  prepareNativeSketchCircleLocalReplacement as replace,
  prepareNativeSketchCircleCollectionRebuild as collection,
} from "../src/sketch-circle-rebuild";
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
const initial = () => rebuild(points, frame);
const incoming = () => [...points.map((p) => [...p]), [5, 6, 7]];
it("translates all three coordinates from fourth local record without fitting", () => {
  const prior = initial();
  const result = replace(incoming(), prior);
  expect(result.route).toBe("translate");
  expect(result.preparation.backendRequest).toEqual({
    kind: "circle",
    center: [5, 6, 7],
    radius: 1,
  });
  expect(result.preparation.sourceRecords).toEqual([
    [6, 6, 7],
    [5, 7, 7],
    [4, 6, 7],
    [5, 6, 7],
  ]);
  expect(result.preparation.fitSucceeded).toBeUndefined();
  expect(result.preparation.frame).toEqual(frame);
  expect(prior).toEqual(initial());
});
it("refits exactly three records and collection rebuild always refits", () => {
  expect(replace(points, initial()).route).toBe("refit");
  const records = incoming();
  records[1][1] += 0.001;
  expect(replace(records, initial()).route).toBe("translate");
  expect(collection(records, initial())).toEqual(
    rebuild(records.slice(0, 3), frame),
  );
  expect(collection(records, initial()).backendRequest.center).not.toEqual(
    records[3],
  );
});
it.each([0, 1, 2])(
  "compares record %s independently before flattening Z",
  (index) => {
    const records = incoming();
    records[index][2] = 0.004;
    const result = replace(records, initial());
    expect(result.route).toBe("refit");
    expect(result.preparation.sourceRecords[index][2]).toBe(0);
  },
);
it("uses strict distance comparison at equality", () => {
  const records = incoming();
  records[1][0] = 0.001;
  records[1][2] = 0.003;
  expect(0.001 ** 2 + 0.003 ** 2).toBe(1e-5);
  expect(replace(records, initial()).route).toBe("refit");
  records[1][2] = 0.0029999999999999996;
  expect(replace(records, initial()).route).toBe("translate");
});
it("preserves failed-fit radius on translation and rebuild resets it", () => {
  const p = [
    [0, 0, 0],
    [1, 0, 0],
    [3, 0, 0],
  ];
  const prior = rebuild(p, frame);
  const result = replace([...p, [7, 8, 9]], prior);
  expect(result.preparation.backendRequest.radius).toBe(-Number.MAX_VALUE);
  expect(result.preparation.sourceRecords[0]).toEqual([6, 8, 9]);
  expect(collection(points, result.preparation).backendRequest.radius).toBe(1);
});
it("adds computed center delta rather than assigning target", () => {
  const prior = initial();
  const center = [1e16, 0, 0] as const;
  const staged = {
    ...prior,
    backendRequest: { ...prior.backendRequest, center },
  };
  const records = incoming();
  records[3] = [1, 0, 0];
  expect(replace(records, staged).preparation.backendRequest.center[0]).toBe(0);
});
it("does not consume fifth record for geometry", () => {
  expect(replace([...incoming(), [100, 200, 300]], initial())).toEqual(
    replace(incoming(), initial()),
  );
  expect(collection([...incoming(), [100, 200, 300]], initial())).toEqual(
    collection(incoming(), initial()),
  );
});
it("rejects malformed, short, nonfinite and overflowing input without mutation", () => {
  const prior = initial();
  for (const records of [
    [],
    points.slice(0, 2),
    null,
    [...points, [0, 0, NaN]],
    [...points, [5, 6, 7], [Infinity, 0, 0]],
    Array(4),
  ]) {
    expect(() => replace(records, prior)).toThrow();
    expect(() => collection(records, prior)).toThrow();
  }
  expect(() =>
    replace([[Number.MAX_VALUE, 0, 0], ...incoming().slice(1)], prior),
  ).toThrow();
  expect(prior).toEqual(initial());
});
