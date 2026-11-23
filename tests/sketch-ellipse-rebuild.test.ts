import { expect, it } from "vitest";
import { prepareNativeSketchEllipseCollectionRebuild as prepare } from "../src/sketch-ellipse-rebuild";
const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
it("retains authoring diameter order and five local records independently of placement", () => {
  const p = prepare(
    [
      [-3, 2, 7],
      [5, 2, -9],
      [15, 4, 8],
    ],
    frame,
  );
  expect(p.fitSucceeded).toBe(true);
  expect(p.geometry).toEqual({
    center: [1, 2, 0],
    axis: [1, 0, 0],
    radius1: 4,
    radius2: 2,
  });
  expect(p.sourceRecords).toEqual([
    [-3, 2, 0],
    [5, 2, 0],
    [1, 4, 0],
    [1, 0, 0],
    [1, 2, 0],
  ]);
  expect(p.frame).toEqual(frame);
  expect(p.backendRequest).toEqual({
    kind: "ellipse",
    center: [1, 2, 0],
    axis: [1, 0, 0],
    majorRadius: 4,
    minorRadius: 2,
  });
});
it("uses the infinite diameter line and ignores further records during a fit", () => {
  const points = [
    [-2, 0, 99],
    [2, 0, 99],
    [100, 3, 99],
  ];
  const a = prepare(points, frame),
    b = prepare([...points, [800, 900, 1000]], frame);
  expect(a).toEqual(b);
  expect(a.geometry?.radius2).toBe(3);
  expect(a.sourceRecords.slice(0, 2)).toEqual([
    [-2, 0, 0],
    [2, 0, 0],
  ]);
});
it("swaps backend radii with clockwise axis rotation but leaves child source order", () => {
  const p = prepare(
    [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 3, 0],
    ],
    frame,
  );
  expect(p.sourceRecords).toEqual([
    [-1, 0, 0],
    [1, 0, 0],
    [0, 3, 0],
    [0, -3, 0],
    [0, 0, 0],
  ]);
  expect(p.backendRequest).toEqual({
    kind: "ellipse",
    center: [0, 0, 0],
    axis: [0, -1, 0],
    majorRadius: 3,
    minorRadius: 1,
  });
  const equal = prepare(
    [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    frame,
  );
  expect(equal.backendRequest?.axis).toEqual([1, 0, 0]);
});
it("preserves incomplete XYZ records and previous geometry without a backend request", () => {
  const previous = prepare(
    [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 2, 0],
    ],
    frame,
  ).geometry;
  for (const records of [
    [],
    [[-0, 2, 9]],
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
  ]) {
    const p = prepare(records, frame, previous);
    expect(p.sourceRecords).toEqual(records);
    expect(p.geometry).toEqual(previous);
    expect(p.geometry).not.toBe(previous);
    expect(p.backendRequest).toBeUndefined();
    expect(p.fitSucceeded).toBe(false);
  }
});
it("admits diameter equality at 0.0001 and clears sources on early geometric failure", () => {
  const previous = prepare(
    [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 2, 0],
    ],
    frame,
  ).geometry;
  for (const diameter of [0, 0.0001 - 2 ** -66]) {
    const p = prepare(
      [
        [0, 0, 0],
        [diameter, 0, 0],
        [0, 1, 0],
      ],
      frame,
      previous,
    );
    expect(p.geometry).toEqual(previous);
    expect(p.sourceRecords).toEqual([]);
    expect(p.backendRequest).toBeUndefined();
    expect(p.fitSucceeded).toBe(false);
  }
  const boundary = prepare(
    [
      [0, 0, 0],
      [0.0001, 0, 0],
      [0, 1, 0],
    ],
    frame,
  );
  expect(boundary.fitSucceeded).toBe(true);
  expect(boundary.geometry?.radius1).toBe(0.00005);
});
it("passes a zero minor radius to the backend instead of inventing a fit rejection", () => {
  const p = prepare(
    [
      [-2, 0, 0],
      [2, 0, 0],
      [5, 0, 0],
    ],
    frame,
  );
  expect(p.fitSucceeded).toBe(true);
  expect(p.backendRequest?.minorRadius).toBe(0);
  expect(p.sourceRecords.slice(2)).toEqual([
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
});
it("handles rotated and reversed diameters without changing source order", () => {
  const p = prepare(
    [
      [1, -3, 0],
      [1, 5, 0],
      [-2, 9, 0],
    ],
    frame,
  );
  expect(p.geometry).toEqual({
    center: [1, 1, 0],
    axis: [0, 1, 0],
    radius1: 4,
    radius2: 3,
  });
  expect(p.sourceRecords).toEqual([
    [1, -3, 0],
    [1, 5, 0],
    [-2, 1, 0],
    [4, 1, 0],
    [1, 1, 0],
  ]);
  const reversed = prepare(
    [
      [1, 5, 0],
      [1, -3, 0],
      [-2, 9, 0],
    ],
    frame,
  );
  expect(reversed.sourceRecords).toEqual([
    [1, 5, 0],
    [1, -3, 0],
    [4, 1, 0],
    [-2, 1, 0],
    [1, 1, 0],
  ]);
});
it("copies inputs and rejects malformed, oversized and overflowing arithmetic", () => {
  const points = [
    [-1, 0, 7],
    [1, 0, 8],
    [0, 2, 9],
  ];
  const p = prepare(points, frame);
  points[0][0] = 500;
  expect(p.sourceRecords[0][0]).toBe(-1);
  for (const records of [
    null,
    [[NaN, 0, 0]],
    [[1, 2]],
    Array(3),
    [
      [1e308, 0, 0],
      [-1e308, 0, 0],
      [0, 1, 0],
    ],
    Array.from({ length: 32769 }, () => [0, 0, 0]),
  ])
    expect(() => prepare(records, frame)).toThrow();
  expect(() =>
    prepare([], [[1, 0, 0, Infinity], frame[1], frame[2]]),
  ).toThrow();
});
