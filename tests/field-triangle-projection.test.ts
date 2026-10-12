import { describe, expect, it } from "vitest";
import { projectGuideTriangle } from "../src/field-triangle-projection";
import { mapCurvatureGuidePoints } from "../src/field-guide-mapping";
import native from "./fixtures/field-native-triangle-projection.json";

describe("recovered complete triangle projection", () => {
  const a = new Float32Array([0, 0, 0]);
  const b = new Float32Array([2, 0, 0]);
  const c = new Float32Array([0, 2, 0]);
  const normal = new Float32Array([0, 0, 1]);
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches original triangle projection $id",
    (entry) => {
      const inputs = [entry.point, ...entry.vertices, entry.normal].map(
        (values) => new Float32Array(values),
      );
      const output = new Float32Array([11, 22, 33]);
      const distance = projectGuideTriangle(
        inputs[0],
        inputs[1],
        inputs[2],
        inputs[3],
        inputs[4],
        output,
      );
      expect([...output]).toEqual(entry.projected);
      expect(distance).toBe(entry.distance);
      expect(inputs.map((v) => [...v])).toEqual([
        entry.point,
        ...entry.vertices,
        entry.normal,
      ]);
    },
  );
  it("preserves supplied output when the triangle has zero oriented area", () => {
    const output = new Float32Array([4, 5, 6]);
    expect(projectGuideTriangle(a, a, a, a, normal, output)).toBe(
      Math.fround(3.4028234663852886e38),
    );
    expect([...output]).toEqual([4, 5, 6]);
  });
  it("projects interior and exterior points onto the triangle", () => {
    const output = new Float32Array(3);
    expect(
      projectGuideTriangle(
        new Float32Array([0.5, 0.5, 3]),
        a,
        b,
        c,
        normal,
        output,
      ),
    ).toBe(3);
    expect([...output]).toEqual([0.5, 0.5, 0]);
    expect(
      projectGuideTriangle(
        new Float32Array([-1, -1, 0]),
        a,
        b,
        c,
        normal,
        output,
      ),
    ).toBe(Math.fround(Math.sqrt(2)));
    expect([...output]).toEqual([0, 0, 0]);
  });
  it("feeds projected points into recovered guide mapping storage", () => {
    const positions = new Float32Array([...a, ...b, ...c]);
    const points = new Float32Array([0.5, 0.5, 1, 0.75, 0.5, 1]);
    const cache = mapCurvatureGuidePoints(
      points,
      new Int32Array([10, 20]),
      positions,
      new Uint32Array([0, 1, 2]),
      (point) => {
        const output = new Float32Array(3);
        const distance = projectGuideTriangle(point, a, b, c, normal, output);
        return { face: distance < 2 ? 0 : -1, point: output };
      },
    );
    expect([...cache.points]).toEqual([0.5, 0.5, 0, 0.75, 0.5, 0]);
    expect([...cache.surfaceFaces]).toEqual([0, 0]);
    expect([...cache.metadata]).toEqual([10, 20]);
  });
  it("rejects malformed or aliased browser storage", () => {
    expect(() => projectGuideTriangle(a, a, b, c, normal, a)).toThrow(
      "independent",
    );
    expect(() =>
      projectGuideTriangle(
        new Float32Array([NaN, 0, 0]),
        a,
        b,
        c,
        normal,
        new Float32Array(3),
      ),
    ).toThrow("finite");
  });
});
