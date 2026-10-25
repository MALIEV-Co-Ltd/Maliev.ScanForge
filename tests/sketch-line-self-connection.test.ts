import { describe, expect, it } from "vitest";
import { checkNativeSketchLineSelfConnection as check } from "../src/sketch-line-self-connection";
import { evaluateNativeSketchLinePoint } from "../src/sketch-line-conversion";

function prepared(
  origin: number[],
  direction: number[],
  interval: [number, number],
) {
  return {
    conversion: { origin, direction, interval },
    start: [...evaluateNativeSketchLinePoint(origin, direction, interval[0])],
    end: [...evaluateNativeSketchLinePoint(origin, direction, interval[1])],
  };
}

describe("prepared native straight-line self-connection witness", () => {
  it("evaluates the averaged parameter of a nearby short line", () => {
    const input = prepared([0, 0, 0], [1, 0, 0], [0, 5e-8]);
    const result = check(input, 1e-12);
    expect(result.candidate).toBe(false);
    expect(result.witnessParameter).toBe(2.5e-8);
    expect(result.witness).toEqual([2.5e-8, 0, 0]);
  });
  it("preserves native parameter addition before multiplication", () => {
    const first = 2 ** 52,
      last = first + 1;
    const result = check(prepared([0, 0, 0], [1, 0, 0], [first, last]), 2);
    expect(result.witnessParameter).toBe((last + first) * 0.5);
    expect(result.witness).toEqual([first, 0, 0]);
    expect(result.candidate).toBe(false);
  });
  it("evaluates the analytic line rather than averaging endpoint coordinates", () => {
    const input = prepared([1e16, 2, 3], [1, 0, 0], [1, 2]);
    const result = check(input, 100);
    expect(result.witness).toEqual([1e16 + 2, 2, 3]);
    expect(result.witnessParameter).toBe(1.5);
    expect(result.witness?.[0]).not.toBe((input.start[0] + input.end[0]) * 0.5);
  });
  it("does not evaluate an unused overflowing average for distant endpoints", () => {
    const input = prepared([0, 0, 0], [1e-308, 0, 0], [1e308, 1.5e308]);
    expect(check(input, 0.01).witness).toBeUndefined();
    expect(() => check(input, 1)).toThrow(/finite/);
  });
  it("preserves signed zero in the selected parameter", () => {
    const result = check(prepared([-0, 0, 0], [1, 0, 0], [-0, -0]), 1);
    expect(Object.is(result.witnessParameter, -0)).toBe(true);
    expect(Object.is(result.witness?.[0], -0)).toBe(true);
    expect(result.candidate).toBe(false);
  });
  it("rejects malformed or noncanonical prepared endpoints", () => {
    expect(() => check({}, 1)).toThrow();
    const input = prepared([0, 0, 0], [1, 0, 0], [0, 1]);
    expect(() => check({ ...input, end: [2, 0, 0] }, 1)).toThrow(/match/);
    expect(() => check(input, undefined)).toThrow(/threshold/);
  });
  it("rejects native unset endpoint coordinates only if sampling is needed", () => {
    const input = prepared([-31415800000000, 0, 0], [1, 0, 0], [0, 1]);
    expect(check(input, 0.5).witness).toBeUndefined();
    expect(() => check(input, 2)).toThrow(/unset/);
  });
  it("returns detached geometry and never infers body admission", () => {
    const input = prepared([0, 0, 0], [1, 0, 0], [0, 5e-8]);
    const result = check(input, 1e-12);
    input.start[0] = 100;
    input.conversion.origin[0] = 200;
    expect(result.endpoints.start).toEqual([0, 0, 0]);
    expect(result.witness).toEqual([2.5e-8, 0, 0]);
    expect(result).not.toHaveProperty("accepted");
    expect(result).not.toHaveProperty("builderSucceeded");
  });
});
