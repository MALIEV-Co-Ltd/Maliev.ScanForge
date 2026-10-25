import { describe, expect, it } from "vitest";
import { checkNativeSketchFreshLineGeometry } from "../src/sketch-line-geometry";
import {
  evaluateNativeSketchLinePoint,
  prepareNativeSketchLineConversion,
} from "../src/sketch-line-conversion";

const settings = () => ({
  linearResolution: 1e-8,
  coordinateDeltaZeroThreshold: 1e-18,
  endpointTolerance: 1e-8,
  coordinateEnvelope: 1000,
  relativeComparisonTolerance: 0,
});
const line = (first = 0, last = 2) => ({
  conversion: {
    origin: [0, 0, 0],
    direction: [1, 0, 0],
    interval: [first, last],
  },
  start: [first, 0, 0],
  end: [last, 0, 0],
});

describe("fresh single-line geometry checks", () => {
  it("composes explicit settings and all recovered scalar results", () => {
    const result = checkNativeSketchFreshLineGeometry(line(), settings());
    expect(result.passed).toBe(true);
    expect(result.failureStage).toBeUndefined();
    expect(result.vertexTolerance).toBe(5e-9);
    expect(result.results.edgeVertices?.overlap).toBe(false);
    expect(result.results.startProjection?.parameter).toBe(0);
    expect(result.results.endProjection?.parameter).toBe(2);
    expect(result.results.parameterOrder?.ordered).toBe(true);
    expect(result.results.wireVertices?.overlap).toBe(false);
    expect(result.results.envelope?.inside).toBe(true);
  });

  it("rejects resolution equality before projection or bounds failures", () => {
    const result = checkNativeSketchFreshLineGeometry(line(0, 1e-8), {
      ...settings(),
      endpointTolerance: 0,
      coordinateEnvelope: 1e-10,
    });
    expect(result.passed).toBe(false);
    expect(result.failureStage).toBe("edge-vertices");
    expect(result.results.startProjection).toBeUndefined();
    expect(result.results.envelope).toBeUndefined();
  });

  it("does not add the high-level kernel maker's larger minimum interval", () => {
    expect(
      checkNativeSketchFreshLineGeometry(line(0, 5e-8), settings()).passed,
    ).toBe(true);
  });

  it("uses coordinate-delta zeroing in the earlier distinct-edge check", () => {
    const result = checkNativeSketchFreshLineGeometry(line(0, 1.5), {
      ...settings(),
      linearResolution: 1,
      coordinateDeltaZeroThreshold: 2,
    });
    expect(result.failureStage).toBe("edge-vertices");
    expect(result.results.edgeVertices?.distanceSquared).toBe(0);
  });

  it("keeps endpoint tolerance independent from positive linear resolution", () => {
    for (const endpointTolerance of [0, -1]) {
      const result = checkNativeSketchFreshLineGeometry(line(), {
        ...settings(),
        endpointTolerance,
      });
      expect(result.failureStage).toBe("start-projection");
      expect(result.results.edgeVertices?.overlap).toBe(false);
      expect(result.results.endProjection).toBeUndefined();
    }
  });

  it("rejects an end projection at an explicitly tighter numerical tolerance", () => {
    const conversion = prepareNativeSketchLineConversion(
      [0, 0, 0],
      [0.1, 0.2, 0.3],
      1,
    )!;
    const prepared = {
      conversion,
      start: evaluateNativeSketchLinePoint(
        conversion.origin,
        conversion.direction,
        conversion.interval[0],
      ),
      end: evaluateNativeSketchLinePoint(
        conversion.origin,
        conversion.direction,
        conversion.interval[1],
      ),
    };
    const result = checkNativeSketchFreshLineGeometry(prepared, {
      ...settings(),
      endpointTolerance: 1e-30,
      coordinateDeltaZeroThreshold: 0,
    });
    expect(result.failureStage).toBe("end-projection");
    expect(result.results.startProjection).toBeDefined();
  });

  it("rejects reversed parameters after successful point projections", () => {
    const result = checkNativeSketchFreshLineGeometry(line(2, 0), settings());
    expect(result.failureStage).toBe("parameter-order");
    expect(result.results.parameterOrder?.orientedSpan).toBe(-2);
  });

  it("performs final vertex checking before the envelope failure", () => {
    const result = checkNativeSketchFreshLineGeometry(line(0, 3), {
      ...settings(),
      coordinateEnvelope: 2,
    });
    expect(result.failureStage).toBe("envelope");
    expect(result.results.wireVertices?.overlap).toBe(false);
    expect(result.results.envelope).toMatchObject({
      inside: false,
      failure: { axis: "x", side: "maximum", coordinate: 3 },
    });
  });

  it("preserves native end-first box ties rather than using projected points", () => {
    const prepared = {
      conversion: {
        origin: [0, -0, -0],
        direction: [1, -0, -0],
        interval: [-0, 0.005],
      },
      start: [0, 0, 0],
      end: [0.005, -0, -0],
    };
    const result = checkNativeSketchFreshLineGeometry(prepared, settings());
    expect(result.passed).toBe(true);
    expect(Object.is(result.results.bounds!.minimum[1], -0)).toBe(true);
    expect(Object.is(result.results.bounds!.maximum[1], -0)).toBe(true);
    expect(Object.is(prepared.start[1], 0)).toBe(true);
  });

  it("does not mutate or retain aliases to prepared data or settings", () => {
    const prepared = line(),
      values = settings();
    const result = checkNativeSketchFreshLineGeometry(prepared, values);
    Object.assign(result.prepared.start, { 0: 99 });
    result.settings.linearResolution = 88;
    Object.assign(result.results.bounds!.maximum, { 0: 77 });
    expect(prepared).toEqual(line());
    expect(values).toEqual(settings());
    expect(result.prepared.end).toEqual([2, 0, 0]);
  });

  it("requires every setting explicitly and rejects malformed settings", () => {
    const base = settings();
    for (const key of Object.keys(base)) {
      for (const invalid of [undefined, null, "1", NaN, Infinity]) {
        expect(() =>
          checkNativeSketchFreshLineGeometry(line(), {
            ...base,
            [key]: invalid,
          }),
        ).toThrow(/geometry setting/);
      }
    }
    for (const value of [
      undefined,
      null,
      [],
      {},
      { ...base, extra: 1 },
      { ...base, linearResolution: 0 },
      { ...base, coordinateEnvelope: 0 },
      { ...base, relativeComparisonTolerance: -1 },
      { ...base, coordinateDeltaZeroThreshold: -1 },
    ]) {
      expect(() => checkNativeSketchFreshLineGeometry(line(), value)).toThrow(
        /geometry setting/,
      );
    }
  });

  it("rejects mismatched prepared data and never substitutes a resolution default", () => {
    expect(() =>
      checkNativeSketchFreshLineGeometry(
        { ...line(), end: [3, 0, 0] },
        settings(),
      ),
    ).toThrow(/match prepared evaluation/);
    expect(
      checkNativeSketchFreshLineGeometry(line(0, 1e-8), {
        ...settings(),
        linearResolution: 1e-10,
      }).passed,
    ).toBe(true);
    expect(
      checkNativeSketchFreshLineGeometry(line(0, 1e-8), settings()).passed,
    ).toBe(false);
  });
});

describe("conditional native failure paths", () => {
  const conversion = prepareNativeSketchLineConversion(
    [0, 0, 0],
    [0.1, 0.2, 0.3],
    1,
  )!;
  const endProjection = {
    conversion,
    start: evaluateNativeSketchLinePoint(
      conversion.origin,
      conversion.direction,
      conversion.interval[0],
    ),
    end: evaluateNativeSketchLinePoint(
      conversion.origin,
      conversion.direction,
      conversion.interval[1],
    ),
  };
  it.each([
    [
      line(0, 1e-8),
      settings(),
      "edge-vertices",
      { edgeStatus: 2, generalStatus: 3, wireStatus: 4 },
    ],
    [
      line(),
      { ...settings(), endpointTolerance: 0 },
      "start-projection",
      { edgeStatus: 3, generalStatus: 12, wireStatus: 4 },
    ],
    [
      endProjection,
      {
        ...settings(),
        endpointTolerance: 1e-30,
        coordinateDeltaZeroThreshold: 0,
      },
      "end-projection",
      { edgeStatus: 3, generalStatus: 12, wireStatus: 4 },
    ],
    [
      line(2, 0),
      settings(),
      "parameter-order",
      { edgeStatus: 4, generalStatus: 12, wireStatus: 4 },
    ],
    [
      line(0, 3),
      { ...settings(), coordinateEnvelope: 2 },
      "envelope",
      { generalStatus: 1, wireStatus: 4 },
    ],
  ])(
    "records the selected %s check's conditional propagation",
    (prepared, values, stage, path) => {
      const result = checkNativeSketchFreshLineGeometry(prepared, values);
      expect(result.failureStage).toBe(stage);
      expect(result.nativeFailurePath).toEqual(path);
    },
  );
  it("does not infer native acceptance or a whole-run status from passed scalar checks", () => {
    const result = checkNativeSketchFreshLineGeometry(line(), settings());
    expect(result.passed).toBe(true);
    expect(result.nativeFailurePath).toBeUndefined();
    expect("nativeAccepted" in result).toBe(false);
    expect("nativeStatus" in result).toBe(false);
  });
});
