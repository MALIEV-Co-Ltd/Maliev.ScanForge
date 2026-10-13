import { expect, it } from "vitest";
import {
  nativeAlignmentObjective,
  nativeAlignmentRotation,
} from "../src/scan-native-alignment";
import type { Vec3 } from "../src/types";
import fixture from "./fixtures/alignment-kernels-native.json";

function bits(values: number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(fixture.quaternionCases)(
  "reproduces native quaternion conversion $quaternion",
  (capture) => {
    const rotation = nativeAlignmentRotation(
      capture.quaternion as [number, number, number, number],
    );
    const matrix = [
      ...rotation.slice(0, 3),
      7,
      ...rotation.slice(3, 6),
      -3,
      ...rotation.slice(6, 9),
      11,
    ];
    expect(bits(matrix)).toBe(capture.nativeBits);
  },
);
it.each(fixture.objectiveCases)(
  "reproduces native ordered Float32 absolute-error objective $value",
  (capture) => {
    const before = JSON.stringify(capture);
    expect(
      bits([
        nativeAlignmentObjective(
          capture.matrix,
          capture.source as Vec3[],
          capture.target as Vec3[],
        ),
      ]),
    ).toBe(capture.nativeBits);
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it("rejects mismatched matrix and point counts", () => {
  expect(() => nativeAlignmentObjective([], [], [])).toThrow("3x4");
  expect(() =>
    nativeAlignmentObjective(new Array(12).fill(0), [[0, 0, 0]], []),
  ).toThrow("paired");
});
