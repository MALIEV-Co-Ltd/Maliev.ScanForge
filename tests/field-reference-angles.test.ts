import { describe, expect, it } from "vitest";
import { deriveFieldReferenceAngles } from "../src/field-angle-transport";

describe("recovered face reference angles", () => {
  it("projects directions into the face before measuring oriented reference angles", () => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1]);
    const tangents = new Float32Array([1, 0, 0, 1, 0, 0]);
    const directions = new Float32Array([0, 7, 200, 0, -3, -80]);
    const result = deriveFieldReferenceAngles(normals, tangents, directions);
    expect(result).toBeInstanceOf(Float64Array);
    expect(result[0]).toBe(Math.fround(Math.PI / 2));
    expect(result[1]).toBe(
      Math.fround((3 * Math.PI) / 2) - Math.fround(2 * Math.PI),
    );
    expect([...directions]).toEqual([0, 7, 200, 0, -3, -80]);
  });
  it("handles projected-zero directions and empty arrays without introducing an angle", () => {
    expect([
      ...deriveFieldReferenceAngles(
        new Float32Array([0, 0, 1]),
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 0, 2]),
      ),
    ]).toEqual([0]);
    expect(
      deriveFieldReferenceAngles(
        new Float32Array(),
        new Float32Array(),
        new Float32Array(),
      ).length,
    ).toBe(0);
  });
  it("rejects invalid dimensions, nonfinite directions and projection overflow", () => {
    const normal = new Float32Array([0, 0, 1]);
    const tangent = new Float32Array([1, 0, 0]);
    expect(() =>
      deriveFieldReferenceAngles(normal, tangent, new Float32Array()),
    ).toThrow(/dimensions/);
    expect(() =>
      deriveFieldReferenceAngles(
        normal,
        tangent,
        new Float32Array([NaN, 0, 1]),
      ),
    ).toThrow(/finite/);
    expect(() =>
      deriveFieldReferenceAngles(
        new Float32Array([1e38, 0, 0]),
        tangent,
        new Float32Array([1e38, 0, 0]),
      ),
    ).toThrow(/overflow/);
  });
});
