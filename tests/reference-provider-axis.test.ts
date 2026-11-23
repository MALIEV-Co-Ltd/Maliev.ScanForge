import { describe, expect, it } from "vitest";
import { extractAlternateReferenceAxis } from "../src/reference-source-primitives";

describe("alternate provider construction axis extraction", () => {
  it("scales cylinder location and normalizes direction without inventing an extent", () => {
    const result = extractAlternateReferenceAxis({
      kind: "cylinder",
      location: [0.001, -0.002, 0.003],
      axis: [0, 0, 4],
      unitScale: 1000,
    });
    expect(result).toEqual({
      origin: [1, -2, 3],
      direction: [0, 0, 1],
      extentWritten: false,
    });
    expect(result).not.toHaveProperty("length");
    expect(result).not.toHaveProperty("end");
  });

  it("uses the supplied provider scale instead of hard-coding observed millimeter conversion", () => {
    expect(
      extractAlternateReferenceAxis({
        kind: "cylinder",
        location: [1, 2, 3],
        axis: [2, 0, 0],
        unitScale: 2.5,
      }),
    ).toEqual({
      origin: [2.5, 5, 7.5],
      direction: [1, 0, 0],
      extentWritten: false,
    });
  });

  it("moves the cone origin using the normalized axis and complementary-angle tangent", () => {
    const result = extractAlternateReferenceAxis({
      kind: "cone",
      location: [4, 6, 10],
      axis: [0, 0, 2],
      radius: 2,
      semiAngle: Math.PI / 4,
      unitScale: 1,
    });
    expect(result).toEqual({
      origin: [4, 6, 8],
      direction: [0, 0, 1],
      extentWritten: false,
    });
  });

  it("retains the native tangent-complement multiplication order", () => {
    const angle = Math.PI / 4;
    const result = extractAlternateReferenceAxis({
      kind: "cone",
      location: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 1,
      semiAngle: angle,
      unitScale: 1,
    });
    expect(result.origin[2]).toBe(-0.9999999999999999);
    expect(result.origin[2]).not.toBe(-1 / Math.tan(angle));
  });

  it("normalizes a cone direction again after constructing the origin", () => {
    const result = extractAlternateReferenceAxis({
      kind: "cone",
      location: [0, 0, 0],
      axis: [1, 2, 5],
      radius: 1,
      semiAngle: Math.PI / 4,
      unitScale: 1,
    });
    const first = [0.18257418583505536, 0.3651483716701107, 0.9128709291752768];
    expect(result.direction).toEqual([
      0.18257418583505539, 0.36514837167011077, 0.912870929175277,
    ]);
    expect(result.origin).toEqual(
      first.map((value) => 0 - value * 0.9999999999999999),
    );
    expect(result.direction).not.toEqual(first);
  });

  it.each(["cylinder", "cone"] as const)(
    "preserves tiny and signed-zero %s axes below the normalization threshold",
    (kind) => {
      const result = extractAlternateReferenceAxis({
        kind,
        location: [-0, Number.MIN_VALUE, 1 + 2 ** -40],
        axis: [-0, 2 ** -53, 0],
        radius: 0,
        semiAngle: Math.PI / 4,
        unitScale: 1,
      });
      expect(result.direction).toEqual([-0, 2 ** -53, 0]);
      expect(result.origin[2]).toBe(1 + 2 ** -40);
    },
  );

  it("normalizes exactly at the inclusive threshold", () => {
    expect(
      extractAlternateReferenceAxis({
        kind: "cylinder",
        location: [0, 0, 0],
        axis: [Number.EPSILON, 0, 0],
        unitScale: 1,
      }).direction,
    ).toEqual([1, 0, 0]);
  });

  it("detaches input snapshots", () => {
    const location: [number, number, number] = [1, 2, 3],
      axis: [number, number, number] = [0, 1, 0];
    const result = extractAlternateReferenceAxis({
      kind: "cylinder",
      location,
      axis,
      unitScale: 1,
    });
    location[0] = 9;
    axis[1] = 9;
    expect(result.origin).toEqual([1, 2, 3]);
    expect(result.direction).toEqual([0, 1, 0]);
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects nonfinite provider scales (%s)",
    (unitScale) => {
      expect(() =>
        extractAlternateReferenceAxis({
          kind: "cylinder",
          location: [1, 2, 3],
          axis: [0, 1, 0],
          unitScale,
        }),
      ).toThrow(/finite/i);
    },
  );

  it("rejects nonfinite derived geometry before it can become a reference", () => {
    expect(() =>
      extractAlternateReferenceAxis({
        kind: "cylinder",
        location: [Number.MAX_VALUE, 0, 0],
        axis: [0, 1, 0],
        unitScale: 2,
      }),
    ).toThrow(/finite/i);
  });
});
