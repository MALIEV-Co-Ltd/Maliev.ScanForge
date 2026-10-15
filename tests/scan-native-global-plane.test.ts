import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-plane-native.json";
import {
  nativeGlobalPlane,
  nativeGlobalPlaneDirection,
  nativeGlobalLinearNormal,
} from "../src/scan-native-global-plane";
import { nativeAlignmentEigen3 } from "../src/scan-native-alignment-eigen";
import { nativeJacobiEigen3 } from "../src/scan-native-jacobi-eigen";
const bits = (a: readonly number[]) =>
  Buffer.from(Float64Array.from(a).buffer).toString("hex");
it.each(fixture.cases)("matches original complete plane fit: $name", (c) => {
  const result = nativeGlobalPlane(c.points, {
    active: c.active,
    normals: c.normals,
    initialNormal: [123, 456, 789],
    initialCoefficient: 987,
  });
  expect(result.accepted).toBe(c.accepted);
  expect(bits(result.normal)).toBe(c.normalBits);
  expect(bits([result.coefficient])).toBe(c.coefficientBits);
});
const matrices = fixture.cases.flatMap((c) =>
  c.matrices.map((m) => ({ name: c.name, ...m })),
);
it.each(matrices)(
  "matches original plane algebra: $name / centered=$centered",
  (m) => {
    const result = m.centered
      ? nativeGlobalPlaneDirection(m.matrix, [123, 456, 789])
      : nativeGlobalLinearNormal(m.matrix, m.rhs, [123, 456, 789]);
    expect(result.accepted).toBe(m.accepted);
    expect(bits(result.normal)).toBe(m.outputBits);
  },
);
const eigens = matrices.flatMap((m) =>
  m.eigens.map((e) => ({
    name: m.name,
    centered: m.centered,
    matrix: m.matrix,
    ...e,
  })),
);
it.each(eigens)(
  "matches original $algorithm eigen: $name / centered=$centered / sorted=$sorted",
  (e) => {
    if (e.algorithm === "ql") {
      const result = nativeAlignmentEigen3(e.matrix, e.sorted);
      expect(result.accepted).toBe(e.accepted);
      expect(bits(result.values)).toBe(e.valueBits);
      expect(bits(result.vectors)).toBe(e.vectorBits);
    } else {
      const result = nativeJacobiEigen3(e.matrix, e.sorted);
      expect(bits(result.values)).toBe(e.valueBits);
      expect(bits(result.vectors)).toBe(e.vectorBits);
    }
  },
);
it("rejects invalid plane carriers and active/normal sidecars", () => {
  expect(() => nativeGlobalPlane([[NaN, 0, 0]])).toThrow();
  expect(() => nativeGlobalPlane([[0, 0, 0]], { active: [1, 0] })).toThrow();
  expect(() =>
    nativeGlobalPlane([[0, 0, 0]], { normals: [[1, 0, NaN]] }),
  ).toThrow();
});
