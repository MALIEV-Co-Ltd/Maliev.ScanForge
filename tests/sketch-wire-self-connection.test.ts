import { describe, expect, it, vi } from "vitest";
import { checkNativeSketchWireSelfConnection as check } from "../src/sketch-wire-self-connection";

describe("native wire self-connection candidate comparison", () => {
  it("does not treat a short straight line as a loop", () => {
    const sample = vi.fn(() => [2.5e-8, 0, 0]);
    const result = check([0, 0, 0], [5e-8, 0, 0], 1e-12, sample);
    expect(result.candidate).toBe(false);
    expect(result.endpointDistanceSquared).toBe(2.4999999999999996e-15);
    expect(sample).toHaveBeenCalledTimes(1);
  });
  it("requires the witness strictly farther from both endpoints", () => {
    expect(check([0, 0, 0], [0, 0, 0], 1, () => [2, 0, 0]).candidate).toBe(
      true,
    );
    expect(check([0, 0, 0], [0.5, 0, 0], 1, () => [1, 0, 0]).candidate).toBe(
      false,
    );
    const result = check([0, 0, 0], [0.5, 0, 0], 1, () => [1.5, 0, 0]);
    expect(result.candidate).toBe(false);
    expect(result.endWitnessDistanceSquared).toBe(1);
  });
  it("does not sample at or beyond the endpoint threshold", () => {
    const sample = vi.fn(() => {
      throw new Error("unused");
    });
    expect(check([0, 0, 0], [1, 0, 0], 1, sample).candidate).toBe(false);
    expect(check([0, 0, 0], [2, 0, 0], 1, sample).candidate).toBe(false);
    expect(check([0, 0, 0], [0, 0, 0], 0, sample).candidate).toBe(false);
    expect(sample).not.toHaveBeenCalled();
  });
  it("keeps Y-X-Z accumulation, underflow and strict comparisons", () => {
    const sample = vi.fn();
    expect(
      check([0, 0, 0], [1, 1e8, 1], 1e16, sample).endpointDistanceSquared,
    ).toBe(1e16);
    expect(sample).not.toHaveBeenCalled();
    expect(
      check([-0, 0, 0], [Number.MIN_VALUE, 0, 0], Number.MIN_VALUE, () => [
        0, 1, 0,
      ]).candidate,
    ).toBe(true);
  });
  it("detaches endpoints before sampling and returned witness", () => {
    const start = [0, 0, 0],
      end = [0, 0, 0],
      witness = [2, 0, 0];
    const result = check(start, end, 1, () => {
      start[0] = 100;
      end[0] = 100;
      return witness;
    });
    witness[0] = 100;
    expect(result.candidate).toBe(true);
    expect(result.witness).toEqual([2, 0, 0]);
    expect(result.endpoints).toEqual({ start: [0, 0, 0], end: [0, 0, 0] });
  });
  it("rejects malformed points, thresholds and samplers before sampling", () => {
    const sample = vi.fn(() => [2, 0, 0]);
    for (const point of [
      null,
      {},
      [],
      [0, 0],
      [0, 0, 0, 0],
      [0, , 0],
      ["0", 0, 0],
      [NaN, 0, 0],
      [Infinity, 0, 0],
      new Float64Array(3),
    ]) {
      expect(() => check(point, [0, 0, 0], 1, sample)).toThrow(/finite XYZ/);
      expect(() => check([0, 0, 0], point, 1, sample)).toThrow(/finite XYZ/);
    }
    for (const threshold of [undefined, null, "1", -1, NaN, Infinity])
      expect(() => check([0, 0, 0], [0, 0, 0], threshold, sample)).toThrow(
        /threshold/,
      );
    for (const sampler of [undefined, null, {}, 1])
      expect(() => check([0, 0, 0], [1, 0, 0], 1, sampler)).toThrow(/sampler/);
    expect(sample).not.toHaveBeenCalled();
  });
  it("validates the sampled point and propagates sampler failure", () => {
    expect(() => check([0, 0, 0], [0, 0, 0], 1, () => [0, NaN, 0])).toThrow(
      /finite XYZ/,
    );
    const failure = new Error("kernel query failed");
    expect(() =>
      check([0, 0, 0], [0, 0, 0], 1, () => {
        throw failure;
      }),
    ).toThrow(failure);
  });
  it("guards reached overflow but skips the second comparison after first failure", () => {
    expect(() =>
      check([1e308, 0, 0], [-1e308, 0, 0], 1, () => [0, 0, 0]),
    ).toThrow(/overflow/);
    expect(() => check([0, 0, 0], [0, 0, 0], 1, () => [1e308, 0, 0])).toThrow(
      /overflow/,
    );
    const result = check([0, 0, 0], [-1e154, 0, 0], 1.5e308, () => [
      1e154, 0, 0,
    ]);
    expect(result.candidate).toBe(false);
    expect(result.startWitnessDistanceSquared).toBe(1e308);
    expect(result.endWitnessDistanceSquared).toBeUndefined();
  });
});
