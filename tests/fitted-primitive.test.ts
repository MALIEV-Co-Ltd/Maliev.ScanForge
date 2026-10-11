import { describe, expect, it } from "vitest";
import { fittedPrimitive } from "../src/fitted-primitive";
describe("fitting to exact CAD convention", () => {
  it("maps a cone base center to the midpoint required by the CAD worker", () => {
    const result = fittedPrimitive({
      kind: "cone",
      center: [3, 4, 5],
      axis: [0, 1, 0],
      radius: 10,
      topRadius: 2,
      height: 20,
      rms: 0,
      maxError: 0,
    });
    expect(result).toEqual({
      kind: "cone",
      center: [3, 14, 5],
      axis: [0, 1, 0],
      radius: 10,
      topRadius: 2,
      height: 20,
    });
  });
  it("keeps cylinder midpoint and sphere center and excludes reference planes", () => {
    const fit = {
      center: [1, 2, 3] as [number, number, number],
      axis: [0, 0, 1] as [number, number, number],
      radius: 4,
      height: 8,
      rms: 0,
      maxError: 0,
    };
    expect(fittedPrimitive({ ...fit, kind: "cylinder" }).center).toEqual(
      fit.center,
    );
    expect(fittedPrimitive({ ...fit, kind: "sphere" }).center).toEqual(
      fit.center,
    );
    expect(() => fittedPrimitive({ ...fit, kind: "plane" })).toThrow(
      "reference",
    );
  });
});
