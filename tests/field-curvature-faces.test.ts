import { describe, expect, it } from "vitest";
import {
  deriveCurvatureFaceEigenData,
  qualifyCurvatureFaces,
} from "../src/field-curvature-faces";
import native from "./fixtures/field-native-eigen.json";

describe("curvature face averaging and eigen extraction", () => {
  it.each(
    native.cases
      .filter((entry) => entry.iterations === 70 && entry.sort)
      .map((entry, id) => ({ ...entry, id })),
  )(
    "extracts float eigen outputs from native numerical case $id with masked neighbors",
    ({ tensor, pairs }) => {
      const tensors = new Float64Array([
        ...tensor,
        ...tensor.map((v) => v * 2),
        ...tensor.map((v) => v * 3),
      ]);
      const result = deriveCurvatureFaceEigenData(
        new Uint32Array([0, 1, 2]),
        tensors,
        { sharpVertices: new Uint8Array([6]) },
      );
      expect(Array.from(result.averages)).toEqual(tensor);
      expect(Array.from(result.directions)).toEqual(
        pairs.slice(8, 11).map(Math.fround),
      );
      expect(result.middleValues[0]).toBe(Math.fround(pairs[7]));
      expect(result.largestValues[0]).toBe(Math.fround(pairs[11]));
    },
  );
  it("counts repeated corners, using ordered double sums and reciprocal multiplication", () => {
    const tensors = new Float64Array([3, 0, 0, 6, 0, 9, 12, 0, 0, 15, 0, 18]);
    const result = deriveCurvatureFaceEigenData(
      new Uint32Array([0, 0, 1]),
      tensors,
    );
    expect(Array.from(result.averages)).toEqual([6, 0, 0, 9, 0, 12]);
    expect(Array.from(result.directions)).toEqual([0, 0, 1]);
    expect(result.middleValues[0]).toBe(9);
    expect(result.largestValues[0]).toBe(12);
  });
  it("retains corner order through cancellation", () => {
    const tensors = new Float64Array([
      1e16, 0, 0, 2, 0, 3, -1e16, 0, 0, 2, 0, 3, 1, 0, 0, 2, 0, 3,
    ]);
    const result = deriveCurvatureFaceEigenData(
      new Uint32Array([0, 1, 2, 0, 2, 1]),
      tensors,
    );
    expect(result.averages[0]).toBe(1 / 3);
    expect(result.averages[6]).toBe(0);
  });
  it("uses zero average but the enabled solver's identity eigenvectors when all corners are sharp", () => {
    const result = deriveCurvatureFaceEigenData(
      new Uint32Array([0, 0, 0]),
      new Float64Array([3, 0, 0, 6, 0, 9]),
      { sharpVertices: new Uint8Array([1]) },
    );
    expect(Array.from(result.averages)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(result.directions)).toEqual([0, 0, 1]);
    expect(result.largestValues[0]).toBe(0);
  });
  it("writes zero eigen outputs for a batch with solving disabled", () => {
    const result = deriveCurvatureFaceEigenData(
      new Uint32Array([0, 0, 0]),
      new Float64Array([3, 0, 0, 6, 0, 9]),
      { eigenEnabled: false },
    );
    expect(Array.from(result.averages)).toEqual([3, 0, 0, 6, 0, 9]);
    expect(Array.from(result.directions)).toEqual([0, 0, 0]);
    expect(result.middleValues[0]).toBe(0);
    expect(result.largestValues[0]).toBe(0);
  });
  it("preserves masked face state and owns every output", () => {
    const tensors = new Float64Array([3, 0, 0, 6, 0, 9]);
    const triangles = new Uint32Array([0, 0, 0]);
    const previous = deriveCurvatureFaceEigenData(triangles, tensors);
    const result = deriveCurvatureFaceEigenData(
      triangles,
      new Float64Array(6),
      { skippedFaces: new Uint8Array([1]), previous },
    );
    expect(result).toEqual(previous);
    for (const key of [
      "averages",
      "directions",
      "middleValues",
      "largestValues",
    ] as const) {
      expect(result[key]).not.toBe(previous[key]);
      result[key].fill(0);
    }
    expect(previous.largestValues[0]).toBe(9);
    expect(Array.from(tensors)).toEqual([3, 0, 0, 6, 0, 9]);
  });
  it("preserves a lone included tensor's signed zero", () => {
    const result = deriveCurvatureFaceEigenData(
      new Uint32Array([0, 1, 1]),
      new Float64Array([-0, 0, 0, 2, 0, 3, 0, 0, 0, 0, 0, 0]),
      { sharpVertices: new Uint8Array([2]) },
    );
    expect(Object.is(result.averages[0], -0)).toBe(true);
  });
  it("handles empty input and rejects invalid references and overflowing sums", () => {
    expect(
      deriveCurvatureFaceEigenData(new Uint32Array(), new Float64Array())
        .averages.length,
    ).toBe(0);
    expect(() =>
      deriveCurvatureFaceEigenData(
        new Uint32Array([1, 1, 1]),
        new Float64Array(6),
      ),
    ).toThrow();
    expect(() =>
      deriveCurvatureFaceEigenData(new Uint32Array([0]), new Float64Array(6)),
    ).toThrow();
    expect(() =>
      deriveCurvatureFaceEigenData(
        new Uint32Array([0, 0, 0]),
        new Float64Array([NaN, 0, 0, 0, 0, 0]),
      ),
    ).toThrow();
    expect(() =>
      deriveCurvatureFaceEigenData(
        new Uint32Array([0, 0, 0]),
        new Float64Array([Number.MAX_VALUE, 0, 0, 0, 0, 0]),
      ),
    ).toThrow();
  });
});

describe("curvature face qualification", () => {
  const data = () =>
    deriveCurvatureFaceEigenData(
      new Uint32Array([0, 0, 0]),
      new Float64Array([1, 0, 0, 2, 0, 10]),
    );
  const normals = new Float32Array([1, 0, 0]);
  const options = {
    ratioMinimum: Math.fround(0.8),
    magnitudeMinimum: 10,
    radiusMinimum: 10,
    normalDotMaximum: 0,
  };
  it("accepts exact float threshold equality and rejects each stricter threshold", () => {
    expect(qualifyCurvatureFaces(data(), normals, options)[0]).toBe(1);
    for (const override of [
      { ratioMinimum: 0.81 },
      { magnitudeMinimum: 10.01 },
      { radiusMinimum: 10.01 },
      { normalDotMaximum: -0.01 },
    ])
      expect(
        qualifyCurvatureFaces(data(), normals, { ...options, ...override })[0],
      ).toBe(0);
  });
  it.each([
    [0.49, 1],
    [0.5, 0],
    [1, 0],
    [1.49, 1],
    [1.5, 1],
  ])(
    "preserves the helper interval and anisotropy interpolation at proximity %s",
    (proximity, expected) => {
      expect(
        qualifyCurvatureFaces(data(), normals, {
          ratioMinimum: 0.7,
          normalDotMaximum: 0,
          helperProximity: new Float32Array([proximity]),
        })[0],
      ).toBe(expected);
    },
  );
  it("interpolates magnitude from three times its base, independently of radius minimum", () => {
    const result = data();
    result.middleValues[0] = 0;
    const base = { ratioMinimum: 0, magnitudeMinimum: 4, normalDotMaximum: 0 };
    expect(
      qualifyCurvatureFaces(result, normals, {
        ...base,
        helperProximity: new Float32Array([0.5]),
      })[0],
    ).toBe(0);
    expect(
      qualifyCurvatureFaces(result, normals, {
        ...base,
        helperProximity: new Float32Array([1]),
      })[0],
    ).toBe(1);
    expect(
      qualifyCurvatureFaces(result, normals, {
        ...base,
        radiusMinimum: 11,
        helperProximity: new Float32Array([1]),
      })[0],
    ).toBe(0);
  });
  it("uses absolute signed eigenvalues and zero ratio for zero maximum", () => {
    const result = data();
    result.middleValues[0] = -2;
    result.largestValues[0] = -10;
    expect(qualifyCurvatureFaces(result, normals, options)[0]).toBe(1);
    result.middleValues[0] = 0;
    result.largestValues[0] = 0;
    expect(
      qualifyCurvatureFaces(result, normals, {
        ratioMinimum: 0,
        normalDotMaximum: 0,
      })[0],
    ).toBe(1);
    expect(
      qualifyCurvatureFaces(result, normals, {
        ratioMinimum: 0.001,
        normalDotMaximum: 0,
      })[0],
    ).toBe(0);
  });
  it("uses the supplied normal without renormalizing, with inclusive absolute dot cutoff", () => {
    const result = data();
    expect(
      qualifyCurvatureFaces(result, new Float32Array([0, 0, -0.5]), {
        ...options,
        normalDotMaximum: 0.5,
      })[0],
    ).toBe(1);
    expect(
      qualifyCurvatureFaces(result, new Float32Array([0, 0, -2]), {
        ...options,
        normalDotMaximum: 1,
      })[0],
    ).toBe(0);
  });
  it("preserves previous bits on failure and masked faces without mutating inputs", () => {
    const previousQualified = new Uint8Array([1]);
    expect(
      qualifyCurvatureFaces(data(), normals, {
        ...options,
        ratioMinimum: 1,
        previousQualified,
      })[0],
    ).toBe(1);
    expect(
      qualifyCurvatureFaces(data(), normals, {
        ...options,
        skippedFaces: new Uint8Array([1]),
      })[0],
    ).toBe(0);
    const result = qualifyCurvatureFaces(data(), normals, {
      ...options,
      previousQualified,
    });
    result[0] = 0;
    expect(previousQualified[0]).toBe(1);
  });
  it("adds bits across byte boundaries", () => {
    const triangles = new Uint32Array(27);
    const result = deriveCurvatureFaceEigenData(
      triangles,
      new Float64Array([1, 0, 0, 2, 0, 10]),
    );
    const manyNormals = new Float32Array(27);
    for (let face = 0; face < 9; face++) manyNormals[face * 3] = 1;
    expect(
      Array.from(qualifyCurvatureFaces(result, manyNormals, options)),
    ).toEqual([255, 1]);
  });
  it("accepts empty helpers and rejects malformed or nonfinite cache inputs", () => {
    expect(
      qualifyCurvatureFaces(data(), normals, {
        ...options,
        helperProximity: new Float32Array(),
      })[0],
    ).toBe(1);
    expect(() =>
      qualifyCurvatureFaces(data(), new Float32Array(2), options),
    ).toThrow();
    expect(() =>
      qualifyCurvatureFaces(data(), normals, {
        ...options,
        helperProximity: new Float32Array(2),
      }),
    ).toThrow();
    expect(() =>
      qualifyCurvatureFaces(data(), normals, {
        ...options,
        ratioMinimum: Infinity,
      }),
    ).toThrow();
  });
  it("rejects float threshold and normal arithmetic overflow", () => {
    expect(() =>
      qualifyCurvatureFaces(data(), normals, {
        ratioMinimum: 0,
        normalDotMaximum: 0,
        magnitudeMinimum: 2e38,
        helperProximity: new Float32Array([1]),
      }),
    ).toThrow();
    const result = data();
    result.directions.fill(3e38);
    expect(() =>
      qualifyCurvatureFaces(result, new Float32Array([3e38, 3e38, 3e38]), {
        ratioMinimum: 0,
        normalDotMaximum: 1,
      }),
    ).toThrow();
  });
});
