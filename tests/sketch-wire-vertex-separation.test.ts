import { describe, expect, it } from "vitest";
import { checkNativeSketchWireVertexSeparation as check } from "../src/sketch-wire-vertex-separation";
import { checkNativeSketchDistinctEdgeVertexSeparation as checkEdge } from "../src/sketch-wire-vertex-separation";

describe("native wire vertex separation", () => {
  it("rejects separation equal to the sum of the two vertex tolerances", () => {
    expect(
      check(
        { point: [0, 0, 0], tolerance: 2 },
        { point: [3, 4, 0], tolerance: 3 },
        100,
      ),
    ).toEqual({
      tolerances: [2, 3],
      distanceSquared: 25,
      toleranceSquared: 25,
      overlap: true,
    });
    expect(
      check(
        { point: [0, 0, 0], tolerance: 2 },
        { point: [3, 4, 1e-7], tolerance: 3 },
        100,
      ).overlap,
    ).toBe(false);
  });

  it("uses half the supplied resolution separately for each missing tolerance", () => {
    expect(
      check({ point: [0, 0, 0] }, { point: [0, 0, 5] }, 5).tolerances,
    ).toEqual([2.5, 2.5]);
    expect(
      check({ point: [0, 0, 0], tolerance: 0.25 }, { point: [0, 0, 0.75] }, 1),
    ).toEqual({
      tolerances: [0.25, 0.5],
      distanceSquared: 0.5625,
      toleranceSquared: 0.5625,
      overlap: true,
    });
    expect(
      check({ point: [0, 0, 0] }, { point: [0, 0, 0.75], tolerance: 0.25 }, 1)
        .overlap,
    ).toBe(true);
  });

  it("preserves explicit zero tolerances and does not substitute a default", () => {
    expect(
      check(
        { point: [0, 0, 0], tolerance: 0 },
        { point: [1, 0, 0], tolerance: 0 },
        100,
      ),
    ).toEqual({
      tolerances: [0, 0],
      distanceSquared: 1,
      toleranceSquared: 0,
      overlap: false,
    });
    expect(
      check(
        { point: [-0, 0, 0], tolerance: 0 },
        { point: [0, 0, 0], tolerance: 0 },
        1,
      ).overlap,
    ).toBe(true);
  });

  it("uses squared Y-X-Z arithmetic including binary64 underflow", () => {
    expect(
      check({ point: [0, 0, 0] }, { point: [0.1, 0.2, 0.3] }, 1)
        .distanceSquared,
    ).toBe(0.14);
    // The recovered comparison squares first; replacing it with hypot changes
    // this result. This analytic fixture is not an original-native replay.
    expect(
      check({ point: [0, 0, 0] }, { point: [1e-200, 0, 0] }, Number.MIN_VALUE),
    ).toEqual({
      tolerances: [0, 0],
      distanceSquared: 0,
      toleranceSquared: 0,
      overlap: true,
    });
  });

  it("uses supplied provider coordinates without a hidden unit conversion", () => {
    const a = { point: [100, -200, 300] },
      b = { point: [103, -196, 300] };
    expect(check(a, b, 5).overlap).toBe(true);
    expect(check(a, b, 0.005).overlap).toBe(false);
    expect(check(b, a, 5).distanceSquared).toBe(25);
  });

  it("does not mutate input records or share result storage", () => {
    const a = Object.freeze({
      point: Object.freeze([1, 2, 3]),
      tolerance: 0.5,
    });
    const b = Object.freeze({
      point: Object.freeze([1, 2, 4]),
      tolerance: 0.5,
    });
    const first = check(a, b, 1);
    Object.assign(first.tolerances, [99, 99]);
    expect(check(a, b, 1).tolerances).toEqual([0.5, 0.5]);
  });

  it("requires an explicit positive finite resolution", () => {
    for (const resolution of [undefined, null, "1", 0, -1, NaN, Infinity]) {
      expect(() =>
        check({ point: [0, 0, 0] }, { point: [1, 0, 0] }, resolution),
      ).toThrow(/resolution/i);
    }
  });

  it("rejects malformed vertex records and coordinates", () => {
    for (const vertex of [
      null,
      [],
      {},
      { point: [0, 0] },
      { point: new Array(3) },
      { point: [0, "0", 0] },
      { point: [0, 0, NaN] },
      { point: [0, 0, 0], extra: true },
    ]) {
      expect(() => check(vertex, { point: [1, 0, 0] }, 1)).toThrow();
      expect(() => check({ point: [1, 0, 0] }, vertex, 1)).toThrow();
    }
  });

  it("rejects negative, nonnumeric or nonfinite explicit tolerances", () => {
    for (const tolerance of [null, "1", -1, NaN, Infinity]) {
      expect(() =>
        check({ point: [0, 0, 0], tolerance }, { point: [1, 0, 0] }, 1),
      ).toThrow(/tolerance/i);
      expect(() =>
        check({ point: [0, 0, 0] }, { point: [1, 0, 0], tolerance }, 1),
      ).toThrow(/tolerance/i);
    }
  });

  it("rejects arithmetic overflow instead of reporting body acceptance", () => {
    expect(() =>
      check({ point: [-1e308, 0, 0] }, { point: [1e308, 0, 0] }, 1),
    ).toThrow(/overflow/i);
    expect(() =>
      check({ point: [0, 0, 0] }, { point: [1e200, 0, 0] }, 1),
    ).toThrow(/overflow/i);
    expect(() =>
      check({ point: [0, 0, 0] }, { point: [1, 0, 0] }, 1e200),
    ).toThrow(/overflow/i);
    expect(() =>
      check(
        { point: [0, 0, 0], tolerance: 1e308 },
        { point: [1, 0, 0], tolerance: 1e308 },
        1,
      ),
    ).toThrow(/overflow/i);
  });
});

describe("native distinct edge endpoint separation", () => {
  it("zeros each sub-threshold difference only in the earlier edge check", () => {
    const a = { point: [0, 0, 0], tolerance: 0 };
    const b = { point: [0.5, -0.5, 0.5], tolerance: 0 };
    expect(checkEdge(a, b, 1, 1)).toEqual({
      tolerances: [0, 0],
      distanceSquared: 0,
      toleranceSquared: 0,
      overlap: true,
    });
    expect(check(a, b, 1).overlap).toBe(false);
  });

  it("retains differences exactly equal to the zero threshold on every axis", () => {
    for (const point of [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ]) {
      expect(
        checkEdge(
          { point: [0, 0, 0], tolerance: 0 },
          { point, tolerance: 0 },
          1,
          1,
        ).distanceSquared,
      ).toBe(1);
      expect(
        checkEdge(
          { point: [0, 0, 0], tolerance: 0 },
          { point, tolerance: 0 },
          1,
          1,
        ).overlap,
      ).toBe(false);
    }
  });

  it("clamps independently before the inclusive squared tolerance comparison", () => {
    const a = { point: [0, 0, 0], tolerance: 1 };
    const b = { point: [0.5, 2, -0.5], tolerance: 1 };
    expect(checkEdge(a, b, 1, 1)).toEqual({
      tolerances: [1, 1],
      distanceSquared: 4,
      toleranceSquared: 4,
      overlap: true,
    });
    expect(check(a, b, 1).overlap).toBe(false);
    expect(checkEdge(b, a, 1, 1).distanceSquared).toBe(4);
  });

  it("takes observed-session scales explicitly without installing native defaults", () => {
    // Analytic fixtures using read-only captured settings, not native geometry
    // execution or a claim that these settings apply to every native session.
    const resolution = 1e-8,
      zeroThreshold = 1e-18;
    const a = { point: [0, 0, 0] };
    expect(
      checkEdge(a, { point: [1e-8, 0, 0] }, resolution, zeroThreshold).overlap,
    ).toBe(true);
    expect(
      checkEdge(a, { point: [1.1e-8, 0, 0] }, resolution, zeroThreshold)
        .overlap,
    ).toBe(false);
    expect(
      checkEdge(
        { ...a, tolerance: 0 },
        { point: [1e-18, 0, 0], tolerance: 0 },
        resolution,
        zeroThreshold,
      ).overlap,
    ).toBe(false);
    expect(
      checkEdge(
        { ...a, tolerance: 0 },
        { point: [0.5e-18, 0, 0], tolerance: 0 },
        resolution,
        zeroThreshold,
      ).overlap,
    ).toBe(true);
  });

  it("requires an explicit finite nonnegative zero threshold", () => {
    for (const threshold of [undefined, null, "1", -1, NaN, Infinity]) {
      expect(() =>
        checkEdge({ point: [0, 0, 0] }, { point: [1, 0, 0] }, 1, threshold),
      ).toThrow(/threshold/i);
    }
    expect(checkEdge({ point: [0, 0, 0] }, { point: [1, 0, 0] }, 1, 0)).toEqual(
      check({ point: [0, 0, 0] }, { point: [1, 0, 0] }, 1),
    );
  });

  it("retains canonical point, tolerance, resolution and overflow rejection", () => {
    expect(() =>
      checkEdge({ point: [0, 0] }, { point: [1, 0, 0] }, 1, 1),
    ).toThrow();
    expect(() =>
      checkEdge(
        { point: [0, 0, 0], tolerance: -1 },
        { point: [1, 0, 0] },
        1,
        1,
      ),
    ).toThrow(/tolerance/i);
    expect(() =>
      checkEdge({ point: [0, 0, 0] }, { point: [1, 0, 0] }, 0, 1),
    ).toThrow(/resolution/i);
    expect(() =>
      checkEdge({ point: [-1e308, 0, 0] }, { point: [1e308, 0, 0] }, 1, 1),
    ).toThrow(/overflow/i);
  });

  it("preserves inputs and returns independent diagnostics", () => {
    const a = Object.freeze({ point: Object.freeze([1, 2, 3]) });
    const b = Object.freeze({ point: Object.freeze([1.5, 2, 3]) });
    const result = checkEdge(a, b, 2, 1);
    Object.assign(result.tolerances, [7, 8]);
    expect(checkEdge(a, b, 2, 1).tolerances).toEqual([1, 1]);
  });
});
