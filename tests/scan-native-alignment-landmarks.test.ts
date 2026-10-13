import { expect, it } from "vitest";
import type { Vec3 } from "../src/types";
import {
  nativeAlignmentOriginalVertexIndices,
  nativeAlignmentLandmarkCandidate,
  type NativeAlignmentLandmark,
} from "../src/scan-native-alignment-landmarks";
import fixture from "./fixtures/alignment-landmark-map-native.json";
import candidates from "./fixtures/alignment-landmark-candidate-native.json";
import points from "./fixtures/alignment-npoints-native.json";

function bits(values: number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

it.each(candidates.cases)(
  "matches original $name candidate publication, retained=$retained",
  async (capture) => {
    const input = points.cases.find((row) => row.name === capture.name)!;
    for (const side of ["source", "target"] as const) {
      const packed = new Float32Array(input[side].flat());
      const digest = await crypto.subtle.digest("SHA-256", packed.buffer);
      expect(
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      ).toBe(capture[`${side}Sha256`]);
    }
    const records: NativeAlignmentLandmark[] = [
      ...input.source.map((point) => ({ point: point as Vec3, fixed: true })),
      ...input.target.map((point) => ({ point: point as Vec3, fixed: false })),
    ];
    const before = JSON.stringify(records);
    const matrix = nativeAlignmentLandmarkCandidate(records);
    if (capture.accepted) expect(bits(matrix!)).toBe(capture.matrixBits);
    else expect(matrix).toBeUndefined();
    expect(JSON.stringify(records)).toBe(before);
  },
);

it("guards mismatched candidate sides and cancelled candidate creation", () => {
  expect(() =>
    nativeAlignmentLandmarkCandidate([{ point: [0, 0, 0], fixed: true }]),
  ).toThrow("equal moving and fixed");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeAlignmentLandmarkCandidate([], { signal: controller.signal }),
  ).toThrow("cancelled");
});

it.each(fixture.cases)(
  "matches original landmark-to-vertex mapping: $name",
  (capture) => {
    const vertices = new Float32Array(capture.vertices.flat());
    const before = vertices.slice();
    const landmarks = capture.landmarks.map(({ point, fixed }) => ({
      point: point as Vec3,
      fixed,
    }));
    const original = JSON.stringify(landmarks);
    expect(
      Array.from(nativeAlignmentOriginalVertexIndices(vertices, landmarks)),
    ).toEqual(capture.indices);
    expect(vertices).toEqual(before);
    expect(JSON.stringify(landmarks)).toBe(original);
  },
);

it("checks cancellation and malformed storage", () => {
  const marks: NativeAlignmentLandmark[] = [{ point: [0, 0, 0], fixed: false }];
  expect(() =>
    nativeAlignmentOriginalVertexIndices(new Float32Array(1), marks),
  ).toThrow("XYZ");
  expect(() =>
    nativeAlignmentOriginalVertexIndices(new Float32Array([NaN, 0, 0]), marks),
  ).toThrow("finite XYZ");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeAlignmentOriginalVertexIndices(new Float32Array(), marks, {
      signal: controller.signal,
    }),
  ).toThrow("cancelled");
});
