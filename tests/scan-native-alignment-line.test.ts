import { expect, it } from "vitest";
import type { Vec3 } from "../src/types";
import {
  nativeAlignmentLineGate,
  nativeAlignmentLineFit,
  nativeAlignmentLineRms,
} from "../src/scan-native-alignment-line";
import points from "./fixtures/alignment-npoints-native.json";
import fixture from "./fixtures/alignment-registration-native.json";

const bits = (value: number) => {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, true);
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

it.each(fixture.cases)(
  "matches original line metric and registration gate: $name",
  async (capture) => {
    const input = points.cases.find((row) => row.name === capture.name)!;
    const packed = new Float32Array(input.source.flat());
    const digest = await crypto.subtle.digest("SHA-256", packed.buffer);
    expect(
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(capture.sourceSha256);
    const before = JSON.stringify(input.source);
    const fit = nativeAlignmentLineFit(input.source as Vec3[]);
    expect(fit.accepted).toBe(capture.gate.accepted);
    fit.center.forEach((value, id) =>
      expect(bits(value)).toBe(bits(capture.gate.center[id])),
    );
    fit.direction.forEach((value, id) =>
      expect(bits(value)).toBe(bits(capture.gate.direction[id])),
    );
    const rms = nativeAlignmentLineRms(
      input.source as Vec3[],
      fit.center,
      fit.direction,
    );
    expect(bits(rms)).toBe(capture.gate.lineRmsBits);
    expect(nativeAlignmentLineGate(capture.gate.accepted, rms)).toBe(
      capture.accepted,
    );
    expect(JSON.stringify(input.source)).toBe(before);
    if (!capture.accepted) {
      expect(capture.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
      expect(capture.rms).toBe(-1); // The native rejection leaves output unwritten.
    }
  },
);

it("preserves the threshold and unordered native comparisons", () => {
  expect(nativeAlignmentLineGate(true, 1 - Number.EPSILON)).toBe(false);
  expect(nativeAlignmentLineGate(true, 1)).toBe(true);
  expect(nativeAlignmentLineGate(true, NaN)).toBe(true);
  expect(nativeAlignmentLineGate(false, 0)).toBe(true);
});

it("excludes disabled points without normalizing the supplied direction", () => {
  const points: Vec3[] = [
    [1, 2, 3],
    [10, 20, 30],
  ];
  expect(
    nativeAlignmentLineRms(
      points,
      [0, 0, 0],
      [0, 0, 0],
      new Uint8Array([1, 0]),
    ),
  ).toBe(nativeAlignmentLineRms([points[0]], [0, 0, 0], [0, 0, 0]));
  expect(
    nativeAlignmentLineRms(points, [0, 0, 0], [0, 0, 0], new Uint8Array(2)),
  ).toBe(3.4028234663852886e38);
  expect(() =>
    nativeAlignmentLineRms(points, [0, 0, 0], [0, 0, 0], new Uint8Array(1)),
  ).toThrow("mask");
  expect(() =>
    nativeAlignmentLineRms([[Infinity, 0, 0]], [0, 0, 0], [1, 0, 0]),
  ).toThrow("finite XYZ");
  expect(() =>
    nativeAlignmentLineRms([[1e300, 0, 0]], [0, 0, 0], [1, 0, 0]),
  ).toThrow("Float32");
});
