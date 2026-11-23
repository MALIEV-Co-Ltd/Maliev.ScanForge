import { expect, it } from "vitest";
import {
  prepareNativeSketchEllipseCollectionRebuild as rebuild,
  prepareNativeSketchEllipsePointEdit as edit,
  prepareNativeSketchEllipsePlacedReplacement as placed,
} from "../src/sketch-ellipse-rebuild";
const frame = [
  [1, 0, 0, 10],
  [0, 1, 0, 20],
  [0, 0, 1, 30],
];
const initial = () =>
  rebuild(
    [
      [-2, 0, 0],
      [2, 0, 0],
      [0, 1, 0],
    ],
    frame,
  );
it.each([0, 1])(
  "edits first radius/axis from endpoint %s with fixed center and second radius",
  (index) => {
    const p = initial(),
      target = index === 0 ? [0, -3, 0] : [0, 3, 0];
    const result = edit(index, target, p);
    expect(result.changed).toBe(true);
    expect(result.preparation.geometry).toEqual({
      center: [0, 0, 0],
      axis: [0, 1, 0],
      radius1: 3,
      radius2: 1,
    });
    expect(result.preparation.sourceRecords).toEqual([
      [0, -3, 0],
      [0, 3, 0],
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, 0],
    ]);
    expect(result.preparation.fitSucceeded).toBeUndefined();
    expect(p).toEqual(initial());
  },
);
it.each([2, 3])(
  "edits second radius/axis from endpoint %s, preserving first radius",
  (index) => {
    const result = edit(index, index === 2 ? [0, 4, 0] : [0, -4, 0], initial());
    expect(result.changed).toBe(true);
    expect(result.preparation.geometry?.radius1).toBe(2);
    expect(result.preparation.geometry?.radius2).toBe(4);
    expect(result.preparation.geometry?.axis[0]).toBe(1);
    expect(result.preparation.backendRequest?.axis[1]).toBe(-1);
    expect(result.preparation.sourceRecords[index]).toEqual(
      index === 2 ? [0, 4, 0] : [0, -4, 0],
    );
  },
);
it("assigns center XYZ exactly and regenerates all five sources without fitting", () => {
  const result = edit(4, [-0, 7, 9], initial());
  expect(result.changed).toBe(true);
  expect(result.preparation.geometry?.center).toEqual([-0, 7, 9]);
  expect(result.preparation.sourceRecords).toEqual([
    [-2, 7, 9],
    [2, 7, 9],
    [-0, 8, 9],
    [0, 6, 9],
    [-0, 7, 9],
  ]);
  expect(result.preparation.frame).toEqual(frame);
});
it.each([0, 1, 2, 3, 4])(
  "requires strict movement beyond 2^-23 for source %s",
  (index) => {
    const p = initial(),
      old = p.sourceRecords[index];
    for (const movement of [0, 2 ** -24, 2 ** -23]) {
      const target = [old[0], old[1], movement];
      const result = edit(index, target, p);
      expect(result.changed).toBe(false);
      expect(result.preparation).toEqual(p);
      expect(result.preparation).not.toBe(p);
    }
    expect(edit(index, [old[0], old[1], 2 ** -22], p).changed).toBe(true);
  },
);
it("admits radial equality at 0.0001, refuses shorter radii and uses direct division", () => {
  const p = initial();
  expect(edit(1, [0.0001 - 2 ** -66, 0, 0], p).changed).toBe(false);
  expect(edit(1, [0.0001, 0, 0], p).preparation.geometry?.radius1).toBe(0.0001);
  const r = edit(1, [3, 7, 11], p).preparation.geometry!;
  const radius = Math.sqrt(7 * 7 + 3 * 3 + 11 * 11);
  expect(r.radius1).toBe(radius);
  expect(r.axis).toEqual([3 / radius, 7 / radius, 11 / radius]);
});
it("uses retained XYZ for radial edits without flattening their axis", () => {
  const result = edit(2, [0, 3, 4], initial()).preparation;
  expect(result.geometry?.radius2).toBe(5);
  expect(result.geometry?.axis).toEqual([0.6, 0, -0.8]);
  expect(result.sourceRecords[2]).toEqual([0, 3, -4]);
});
it("rejects unavailable geometry, missing selected records, malformed indices/points", () => {
  const p = initial();
  for (const i of [-1, 5, 0.5, NaN])
    expect(() => edit(i, [1, 2, 3], p)).toThrow();
  expect(() => edit(0, [NaN, 0, 0], p)).toThrow();
  expect(() => edit(0, [1, 2, 3], rebuild([], frame))).toThrow();
  expect(() =>
    edit(4, [1, 2, 3], rebuild([[0, 0, 0]], frame, p.geometry)),
  ).toThrow();
  expect(() => edit(0, [1e308, 1e308, 1e308], p)).toThrow(/overflow/);
});
it("placed fitting inverse-transforms first three points, adopts supplied frame and ignores extras", () => {
  const newFrame = [
    [0, -1, 0, 5],
    [1, 0, 0, 6],
    [0, 0, 1, 7],
  ];
  const inputs = [
    [5, 4, 100],
    [5, 8, 200],
    [4, 6, 300],
    [500, 600, 700],
  ];
  const result = placed(inputs, newFrame, initial());
  expect(result).toEqual(
    rebuild(
      [
        [-2, 0, 0],
        [2, 0, 0],
        [0, 1, 0],
      ],
      newFrame,
    ),
  );
});
it("placed incomplete records retain inverse XYZ and old placement/geometry", () => {
  const supplied = [
    [0, -1, 0, 5],
    [1, 0, 0, 6],
    [0, 0, 1, 7],
  ];
  const p = initial(),
    result = placed([[4, 8, 10]], supplied, p);
  expect(result.sourceRecords).toEqual([[2, 1, 3]]);
  expect(result.frame).toEqual(frame);
  expect(result.geometry).toEqual(p.geometry);
  expect(result.backendRequest).toBeUndefined();
  expect(result.fitSucceeded).toBe(false);
});
it("placed early diameter failure clears sources but preserves old geometry and frame", () => {
  const p = initial(),
    supplied = [
      [1, 0, 0, 100],
      [0, 1, 0, 200],
      [0, 0, 1, 300],
    ];
  const result = placed(
    [
      [1, 2, 3],
      [1, 2, 4],
      [3, 4, 5],
    ],
    supplied,
    p,
  );
  expect(result.sourceRecords).toEqual([]);
  expect(result.frame).toEqual(frame);
  expect(result.geometry).toEqual(p.geometry);
  expect(result.backendRequest).toBeUndefined();
});
it("placed replacement preserves raw transpose arithmetic rather than a general inverse", () => {
  const supplied = [
    [2, 0, 0, 0],
    [0, 3, 0, 0],
    [0, 0, 4, 0],
  ];
  expect(placed([[1, 2, 3]], supplied, initial()).sourceRecords).toEqual([
    [2, 6, 12],
  ]);
  expect(() => placed([[NaN, 0, 0]], supplied, initial())).toThrow();
  expect(() =>
    placed([], [[Infinity, 0, 0, 0], supplied[1], supplied[2]], initial()),
  ).toThrow();
});
