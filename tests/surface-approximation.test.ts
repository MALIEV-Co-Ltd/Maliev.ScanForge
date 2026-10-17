import { describe, expect, it } from "vitest";
import fixture from "./fixtures/native-surface-core.json";
import {
  evaluatePatch,
  fitGridSurface,
  type SurfaceFitOptions,
} from "../src/surfaces";

const options: SurfaceFitOptions = {
  countU: 4,
  countV: 4,
  degree: 3,
  projection: "xy",
  sampleLimit: 16,
  method: "approximate",
  regularizationWeight: 0.0001,
};
const goldenCases = fixture.expandedCapture.fittingCases.filter((entry) =>
  entry.name.startsWith("adapter-"),
);
const bits = (values: readonly number[]) => {
  const bytes = new ArrayBuffer(values.length * 8);
  values.forEach((value, i) =>
    new DataView(bytes).setFloat64(i * 8, value, true),
  );
  return Array.from(new Uint8Array(bytes));
};
describe("shared approximation fitting adapter", () => {
  it.each(goldenCases)(
    "matches original XYZ controls after patch transposition: $name",
    (capture) => {
      const input = Float32Array.from(capture.points.flat());
      const before = input.slice();
      const result = fitGridSurface(input, options);
      expect(result.method).toBe("approximate");
      expect(result.regularizationWeight).toBe(0.0001);
      expect(result.samples).toBe(16);
      for (let u = 0; u < 4; u++)
        for (let v = 0; v < 4; v++) {
          const nativeIndex = u * 4 + v;
          const expected = capture.coordinates.map(
            (coordinate) => coordinate.output[nativeIndex],
          );
          expect(bits(result.patch.points[v * 4 + u])).toEqual(bits(expected));
        }
      expect(input).toEqual(before);
      expect(Number.isFinite(result.rms)).toBe(true);
      expect(result.maxError).toBeGreaterThanOrEqual(result.rms);
    },
  );
  it.each(["xz", "yz"] as const)(
    "preserves coordinate solves in %s projection",
    (projection) => {
      const capture = goldenCases[0];
      const axes = projection === "xz" ? [0, 2, 1] : [1, 2, 0];
      const points = capture.points.map((point) => {
        const moved = [0, 0, 0];
        axes.forEach((axis, i) => {
          moved[axis] = point[i];
        });
        return moved;
      });
      const result = fitGridSurface(Float32Array.from(points.flat()), {
        ...options,
        projection,
      });
      for (let u = 0; u < 4; u++)
        for (let v = 0; v < 4; v++) {
          const expected = [0, 0, 0];
          axes.forEach((axis, i) => {
            expected[axis] = capture.coordinates[i].output[u * 4 + v];
          });
          expect(bits(result.patch.points[v * 4 + u])).toEqual(bits(expected));
        }
      expect(evaluatePatch(result.patch, 0.5, 0.5).every(Number.isFinite)).toBe(
        true,
      );
    },
  );
  it("keeps projected-grid defaults and rejects invalid or over-budget approximation", () => {
    const points = Float32Array.from(goldenCases[0].points.flat());
    const {
      method: _method,
      regularizationWeight: _weight,
      ...legacy
    } = options;
    expect(fitGridSurface(points, legacy)).toEqual(
      fitGridSurface(points, { ...legacy, method: "projected-grid" }),
    );
    expect(() =>
      fitGridSurface(points, { ...legacy, regularizationWeight: 1 }),
    ).toThrow(/requires approximate/);
    for (const weight of [-1, NaN, Infinity])
      expect(() =>
        fitGridSurface(points, { ...options, regularizationWeight: weight }),
      ).toThrow(/finite and nonnegative/);
    expect(() =>
      fitGridSurface(points, { ...options, method: "missing" as never }),
    ).toThrow(/Choose projected-grid/);
    const excessive = Float32Array.from({ length: 10001 * 3 }, (_, i) =>
      i % 3 === 0 ? Math.floor(i / 3) : i % 7,
    );
    expect(() =>
      fitGridSurface(excessive, { ...options, sampleLimit: 10001 }),
    ).toThrow(/sample count/);
  });
});
