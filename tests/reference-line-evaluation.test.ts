import { describe, expect, it } from "vitest";
import {
  evaluateNativeReferenceLine,
  setNativeReferenceLineEndpoints,
  type NativeReferenceLineState,
  type NativeReferenceLineRecord,
} from "../src/reference-line-evaluation";
import type { ReferenceLineGeometry } from "../src/reference-construction-values";
import type { ResolvedReferencePrimitive } from "../src/reference-point-evaluation";

const initial: ReferenceLineGeometry = {
  kind: "line",
  start: [0, 0, 0],
  direction: [0, 0, 0],
  length: 0,
};
const prior: NativeReferenceLineState = {
  geometry: {
    kind: "line",
    start: [10, 5, -0],
    direction: [1, 0, 0],
    length: 4,
  },
  completionWord: 0x27,
};
const zero: NativeReferenceLineState = {
  geometry: initial,
  completionWord: 0x17,
};
const context = { evaluationAllowed: true, commonInputCount: 1 };
const axis = (
  start: [number, number, number],
  end: [number, number, number],
): ResolvedReferencePrimitive => ({ kind: "axis", start, end });
const xAxis = axis([-1, 0, 0], [1, 0, 0]);

// Analytic static-contract cases; original-code numerical comparison remains required.
describe("native line endpoint setters", () => {
  it("copies signed-zero start coordinates on an accepted line", () => {
    expect(
      setNativeReferenceLineEndpoints(initial, [-0, -0, -0], [1, -0, -0])
        .geometry.start,
    ).toEqual([-0, -0, -0]);
  });
  it.each(["setter", "typed"] as const)(
    "stores start, unit direction and length for the %s path",
    (order) => {
      expect(
        setNativeReferenceLineEndpoints(initial, [1, 2, 3], [4, 6, 3], order),
      ).toEqual({
        geometry: {
          kind: "line",
          start: [1, 2, 3],
          direction: [0.6000000000000001, 0.8, 0],
          length: 5,
        },
        written: true,
      });
    },
  );
  it.each([0, Number.EPSILON / 2, Number.EPSILON])(
    "retains every stored field at or below the strict length threshold (%s)",
    (length) => {
      expect(
        setNativeReferenceLineEndpoints(
          prior.geometry,
          [0, 0, 0],
          [length, 0, 0],
        ),
      ).toEqual({ geometry: prior.geometry, written: false });
    },
  );
  it("admits the next representable length above epsilon", () => {
    const length = Number.EPSILON + Number.EPSILON ** 2;
    expect(
      setNativeReferenceLineEndpoints(initial, [0, 0, 0], [length, 0, 0]),
    ).toMatchObject({ written: true, geometry: { length } });
  });
  it("detaches accepted and rejected geometry without mutating endpoint arrays", () => {
    const start: [number, number, number] = [1, 2, 3],
      end: [number, number, number] = [4, 6, 3];
    const accepted = setNativeReferenceLineEndpoints(initial, start, end);
    start[0] = 99;
    end[1] = 99;
    expect(accepted.geometry.start).toEqual([1, 2, 3]);
    const rejected = setNativeReferenceLineEndpoints(
      prior.geometry,
      [0, 0, 0],
      [0, 0, 0],
    );
    expect(rejected.geometry).not.toBe(prior.geometry);
    expect(rejected.geometry.start).not.toBe(prior.geometry.start);
  });
});

describe("stored line and finalization state", () => {
  it("skips both geometry and completion stores when evaluation is disabled", () => {
    expect(
      evaluateNativeReferenceLine("average", [xAxis], prior, {
        ...context,
        evaluationAllowed: false,
      }),
    ).toMatchObject({
      ...prior,
      outcome: "unchanged",
      reason: "evaluation-disabled",
    });
  });
  it("retains stored-mode geometry and performs the ordinary completion store", () => {
    expect(
      evaluateNativeReferenceLine("stored", [], prior, context),
    ).toMatchObject({
      geometry: prior.geometry,
      completionWord: 0x100,
      outcome: "unchanged",
      reason: "stored-coordinates",
    });
  });
  it("reconstructs and re-normalizes old endpoints when no records are available", () => {
    const nonunit: NativeReferenceLineState = {
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [2, 0, 0],
        length: 3,
      },
      completionWord: 7,
    };
    expect(
      evaluateNativeReferenceLine("average", [], nonunit, context),
    ).toMatchObject({
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [1, 0, 0],
        length: 6,
      },
      completionWord: 0x100,
      outcome: "fallback",
      reason: "previous-endpoints",
    });
  });
  it("honors the common-source guard independently of retained records", () => {
    expect(
      evaluateNativeReferenceLine("average", [xAxis], zero, {
        ...context,
        commonInputCount: 0,
      }),
    ).toMatchObject({
      geometry: initial,
      completionWord: 0x100,
      outcome: "unchanged",
      reason: "degenerate-endpoints",
      contributingRecords: 0,
    });
  });
  it("retains degenerate prior geometry but still stores the completion word", () => {
    expect(
      evaluateNativeReferenceLine("average", [], zero, context),
    ).toMatchObject({
      geometry: initial,
      completionWord: 0x100,
      outcome: "unchanged",
      reason: "degenerate-endpoints",
    });
  });
});

describe("ordered average lines", () => {
  it("replaces a tiny accumulated direction before orienting the next axis", () => {
    const records = [
      axis([0, 0, 0], [Number.EPSILON / 2, 0, 0]),
      axis([2, 0, 0], [0, 0, 0]),
    ];
    expect(
      evaluateNativeReferenceLine("average", records, zero, context),
    ).toMatchObject({
      geometry: {
        kind: "line",
        start: [1.5, 0, 0],
        direction: [-1, 0, 0],
        length: 2,
      },
      contributingRecords: 2,
    });
  });
  it("uses mean midpoint and maximum half-length for a new line", () => {
    expect(
      evaluateNativeReferenceLine(
        "average",
        [xAxis, axis([-3, 2, 0], [3, 2, 0])],
        zero,
        context,
      ),
    ).toMatchObject({
      geometry: {
        kind: "line",
        start: [-3, 1, 0],
        direction: [1, 0, 0],
        length: 6,
      },
      outcome: "updated",
      reason: "average-new-extent",
      contributingRecords: 2,
    });
  });
  it("preserves repeated-record weighting independently of one dependency", () => {
    expect(
      evaluateNativeReferenceLine(
        "average",
        [xAxis, xAxis, axis([-1, 6, 0], [1, 6, 0])],
        zero,
        context,
      ),
    ).toMatchObject({
      geometry: { start: [-1, 2, 0], length: 2 },
      contributingRecords: 3,
    });
  });
  it("counts successfully extracted zero-length axes in the midpoint mean", () => {
    expect(
      evaluateNativeReferenceLine(
        "average",
        [axis([-2, 0, 0], [2, 0, 0]), axis([10, 0, 0], [10, 0, 0])],
        zero,
        context,
      ),
    ).toMatchObject({
      geometry: { start: [3, 0, 0], direction: [1, 0, 0], length: 4 },
      contributingRecords: 2,
    });
  });
  it("skips failed extraction without counting point or plane records as axes", () => {
    const records: ResolvedReferencePrimitive[] = [
      { kind: "unavailable" },
      { kind: "point", position: [999, 0, 0] },
      xAxis,
    ];
    expect(
      evaluateNativeReferenceLine("average", records, zero, context),
    ).toMatchObject({
      geometry: { start: [-1, 0, 0], length: 2 },
      contributingRecords: 1,
    });
  });
  it("adjusts direction signs in retained record order", () => {
    const a = axis([0, 0, 0], [2, 0, 0]),
      b = axis([2, 2, 0], [0, 2, 0]);
    expect(
      evaluateNativeReferenceLine("average", [a, b], zero, context).geometry,
    ).toEqual({
      kind: "line",
      start: [0, 1, 0],
      direction: [1, 0, 0],
      length: 2,
    });
    expect(
      evaluateNativeReferenceLine("average", [b, a], zero, context).geometry,
    ).toEqual({
      kind: "line",
      start: [2, 1, 0],
      direction: [-1, 0, 0],
      length: 2,
    });
  });
  it("projects old endpoints when prior length is greater than 2^-23", () => {
    expect(
      evaluateNativeReferenceLine("average", [xAxis], prior, context),
    ).toMatchObject({
      geometry: {
        kind: "line",
        start: [10, 0, 0],
        direction: [1, 0, 0],
        length: 4,
      },
      outcome: "updated",
      reason: "average-prior-extent",
    });
  });
  it.each([
    { length: 2 ** -23, reason: "average-new-extent", startX: -1 },
    {
      length: 2 ** -23 + Number.EPSILON,
      reason: "average-prior-extent",
      startX: 10,
    },
  ])(
    "preserves the prior-length strict boundary ($length)",
    ({ length, reason, startX }) => {
      const result = evaluateNativeReferenceLine(
        "average",
        [xAxis],
        { ...prior, geometry: { ...prior.geometry, length } },
        context,
      );
      expect(result.reason).toBe(reason);
      expect(result.geometry.start[0]).toBe(startX);
    },
  );
  it("retains old geometry when projection collapses the candidate line", () => {
    const perpendicular: NativeReferenceLineState = {
      geometry: {
        kind: "line",
        start: [3, 1, 0],
        direction: [0, 1, 0],
        length: 4,
      },
      completionWord: 0x17,
    };
    expect(
      evaluateNativeReferenceLine("average", [xAxis], perpendicular, context),
    ).toMatchObject({
      geometry: perpendicular.geometry,
      completionWord: 0x100,
      outcome: "unchanged",
      reason: "degenerate-endpoints",
    });
  });
  it("re-finalizes prior endpoints if every extracted axis is degenerate", () => {
    const result = evaluateNativeReferenceLine(
      "average",
      [axis([1, 2, 3], [1, 2, 3])],
      prior,
      context,
    );
    expect(result).toMatchObject({
      completionWord: 0x100,
      outcome: "fallback",
      reason: "previous-endpoints",
      contributingRecords: 1,
    });
    expect(result.geometry.length).toBe(4);
  });
  it("does not mutate source records or prior state", () => {
    const records = [xAxis, axis([-3, 2, 0], [3, 2, 0])];
    const before = structuredClone({ records, prior });
    evaluateNativeReferenceLine("average", records, prior, context);
    expect({ records, prior }).toEqual(before);
  });
});

describe("ordered primitive-pair lines", () => {
  it.each([
    { cosine: 0.9998476951563913 - Number.EPSILON, reason: "pair" },
    { cosine: 0.9998476951563913, reason: "pair" },
    {
      cosine: 0.9998476951563913 + Number.EPSILON,
      reason: "axis-projection-fallback",
    },
  ])(
    "preserves the axis-pair cosine boundary ($cosine)",
    ({ cosine, reason }) => {
      const sine = Math.sqrt(1 - cosine * cosine);
      expect(Math.sqrt(cosine * cosine + sine * sine)).toBe(1);
      expect(
        evaluateNativeReferenceLine(
          "pair",
          [axis([0, 0, 0], [1, 0, 0]), axis([0, 0, 2], [cosine, sine, 2])],
          prior,
          context,
        ).reason,
      ).toBe(reason);
    },
  );
  it("uses projection fallback when closest-axis determinant is too small", () => {
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [axis([-1e-4, 0, 0], [1e-4, 0, 0]), axis([0, -1e-4, 2], [0, 1e-4, 2])],
        prior,
        context,
      ),
    ).toMatchObject({
      geometry: { start: [0, 0, 0], direction: [0, 0, 1], length: 2 },
      outcome: "fallback",
      reason: "axis-projection-fallback",
    });
  });
  const point = (
    position: [number, number, number],
  ): NativeReferenceLineRecord => ({ kind: "point", position });
  const plane: NativeReferenceLineRecord = {
    kind: "plane",
    origin: [0, 0, 2],
    normal: [0, 0, 1],
    offset: -2,
  };
  it("uses the first two point records in vector order and ignores later records", () => {
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [point([1, 2, 3]), point([4, 2, 3]), point([999, 0, 0])],
        prior,
        context,
      ).geometry,
    ).toEqual({
      kind: "line",
      start: [1, 2, 3],
      direction: [1, 0, 0],
      length: 3,
    });
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [point([4, 2, 3]), point([1, 2, 3])],
        prior,
        context,
      ).geometry,
    ).toEqual({
      kind: "line",
      start: [4, 2, 3],
      direction: [-1, 0, 0],
      length: 3,
    });
  });
  it.each([false, true])(
    "starts at the point for point/axis in either order (%s)",
    (reverse) => {
      const records = [point([4, 3, 0]), xAxis];
      expect(
        evaluateNativeReferenceLine(
          "pair",
          reverse ? records.reverse() : records,
          prior,
          context,
        ).geometry,
      ).toEqual({
        kind: "line",
        start: [4, 3, 0],
        direction: [0, -1, 0],
        length: 3,
      });
    },
  );
  it.each([false, true])(
    "starts at the point for point/plane in either order (%s)",
    (reverse) => {
      const records = [point([1, 2, 5]), plane];
      expect(
        evaluateNativeReferenceLine(
          "pair",
          reverse ? records.reverse() : records,
          prior,
          context,
        ).geometry,
      ).toEqual({
        kind: "line",
        start: [1, 2, 5],
        direction: [0, 0, -1],
        length: 3,
      });
    },
  );
  it.each([false, true])(
    "projects both axis endpoints for axis/plane (%s)",
    (reverse) => {
      const records = [axis([1, 2, 5], [4, 2, 8]), plane];
      expect(
        evaluateNativeReferenceLine(
          "pair",
          reverse ? records.reverse() : records,
          prior,
          context,
        ).geometry,
      ).toEqual({
        kind: "line",
        start: [1, 2, 2],
        direction: [1, 0, 0],
        length: 3,
      });
    },
  );
  it("joins closest points of skew axes", () => {
    const records = [axis([0, 0, 0], [2, 0, 0]), axis([1, 3, 2], [1, 5, 2])];
    expect(
      evaluateNativeReferenceLine("pair", records, prior, context),
    ).toMatchObject({
      geometry: {
        kind: "line",
        start: [1, 0, 0],
        direction: [0, 0, 1],
        length: 2,
      },
      outcome: "updated",
      reason: "pair",
    });
  });
  it("projects the shared midpoint onto each parallel axis for fallback", () => {
    const records = [axis([0, 0, 0], [2, 0, 0]), axis([10, 4, 0], [14, 4, 0])];
    expect(
      evaluateNativeReferenceLine("pair", records, prior, context),
    ).toMatchObject({
      geometry: {
        kind: "line",
        start: [6.5, 0, 0],
        direction: [0, 1, 0],
        length: 4,
      },
      outcome: "fallback",
      reason: "axis-projection-fallback",
    });
  });
  it("retains prior geometry for coincident candidate endpoints but completes", () => {
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [point([1, 2, 3]), point([1, 2, 3])],
        prior,
        context,
      ),
    ).toMatchObject({
      geometry: prior.geometry,
      completionWord: 0x100,
      outcome: "unchanged",
      reason: "degenerate-endpoints",
    });
  });
  it("distinguishes a missing object from a failed extractor", () => {
    const nonunit: NativeReferenceLineState = {
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [2, 0, 0],
        length: 3,
      },
      completionWord: 7,
    };
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [{ kind: "unavailable", objectResolved: false }, xAxis],
        nonunit,
        context,
      ),
    ).toMatchObject({
      geometry: { direction: [1, 0, 0], length: 6 },
      outcome: "fallback",
      reason: "previous-endpoints",
    });
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [{ kind: "unavailable" }, xAxis],
        nonunit,
        context,
      ),
    ).toMatchObject({
      geometry: nonunit.geometry,
      completionWord: 0x100,
      outcome: "unchanged",
      reason: "degenerate-endpoints",
    });
  });
  it("re-finalizes prior endpoints for fewer than two pick records", () => {
    const nonunit: NativeReferenceLineState = {
      geometry: {
        kind: "line",
        start: [0, 0, 0],
        direction: [2, 0, 0],
        length: 3,
      },
      completionWord: 7,
    };
    expect(
      evaluateNativeReferenceLine("pair", [xAxis], nonunit, context),
    ).toMatchObject({
      geometry: { direction: [1, 0, 0], length: 6 },
      outcome: "fallback",
    });
  });
  it("does not apply the average-mode common-source guard to pair records", () => {
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [point([0, 0, 0]), point([2, 0, 0])],
        zero,
        { ...context, commonInputCount: 0 },
      ).geometry.length,
    ).toBe(2);
  });
});

describe("plane-pair extent and fallback", () => {
  it.each([
    { cosine: 0.9998476951563913 - Number.EPSILON, outcome: "updated" },
    { cosine: 0.9998476951563913, outcome: "updated" },
    { cosine: 0.9998476951563913 + Number.EPSILON, outcome: "unchanged" },
  ])(
    "uses the inclusive raw-normal cosine boundary ($cosine)",
    ({ cosine, outcome }) => {
      const a: NativeReferenceLineRecord = {
        kind: "plane",
        origin: [0, 0, 0],
        normal: [0, 0, 2],
        offset: 0,
        directPlaneHalfSizes: [1, 2],
      };
      const b: NativeReferenceLineRecord = {
        kind: "plane",
        origin: [0, 0, 0],
        normal: [2, 0, cosine / 2],
        offset: 0,
        directPlaneHalfSizes: [3, 4],
      };
      expect(
        evaluateNativeReferenceLine("pair", [a, b], prior, context).outcome,
      ).toBe(outcome);
    },
  );
  const planeY: NativeReferenceLineRecord = {
    kind: "plane",
    origin: [0, 0, 0],
    normal: [0, 1, 0],
    offset: 0,
    directPlaneHalfSizes: [2, 3],
  };
  const planeZ: NativeReferenceLineRecord = {
    kind: "plane",
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    offset: 0,
    directPlaneHalfSizes: [4, 1],
  };
  it("uses maximum direct-plane half-size independently of prior length", () => {
    expect(
      evaluateNativeReferenceLine(
        "pair",
        [planeY, planeZ],
        { ...prior, geometry: { ...prior.geometry, length: 1000 } },
        context,
      ).geometry,
    ).toEqual({
      kind: "line",
      start: [-4, 0, 0],
      direction: [1, 0, 0],
      length: 8,
    });
  });
  it("uses raw normals for the angular fallback and projects the origin midpoint", () => {
    const a: NativeReferenceLineRecord = {
      kind: "plane",
      origin: [0, 0, 0],
      normal: [0, 0, 2],
      offset: 0,
    };
    const b: NativeReferenceLineRecord = {
      kind: "plane",
      origin: [0, 4, 3],
      normal: [0, 0.5, 2],
      offset: -8,
    };
    const result = evaluateNativeReferenceLine("pair", [a, b], prior, context);
    expect(result).toMatchObject({
      geometry: { start: [0, 2, -4.5], length: Math.sqrt(200) },
      outcome: "fallback",
      reason: "plane-projection-fallback",
    });
  });
  it("falls back when the plane intersection helper rejects a small cross product", () => {
    const a: NativeReferenceLineRecord = {
      kind: "plane",
      origin: [1, 0, 0],
      normal: [0.01, 0, 0],
      offset: -0.01,
    };
    const b: NativeReferenceLineRecord = {
      kind: "plane",
      origin: [0, 1, 0],
      normal: [0, 0.01, 0],
      offset: -0.01,
    };
    expect(
      evaluateNativeReferenceLine("pair", [a, b], prior, context),
    ).toMatchObject({
      geometry: { start: [0.50005, 0.5, 0] },
      outcome: "fallback",
      reason: "plane-projection-fallback",
    });
  });
  it("requires resolved bounds when either plane is CAD-derived", () => {
    expect(() =>
      evaluateNativeReferenceLine(
        "pair",
        [
          planeY,
          { kind: "plane", origin: [0, 0, 0], normal: [0, 0, 1], offset: 0 },
        ],
        prior,
        context,
      ),
    ).toThrow(/bounds/i);
  });
  it("uses merged maximum span and first-object center for CAD-derived planes", () => {
    const a: NativeReferenceLineRecord = {
      ...planeY,
      directPlaneHalfSizes: undefined,
      bounds: [0, -1, -1, 2, 1, 1],
    };
    const b: NativeReferenceLineRecord = {
      ...planeZ,
      bounds: [100, -2, -2, 104, 2, 2],
    };
    expect(
      evaluateNativeReferenceLine("pair", [a, b], zero, context).geometry,
    ).toEqual({
      kind: "line",
      start: [-51, 0, 0],
      direction: [1, 0, 0],
      length: 104,
    });
    expect(
      evaluateNativeReferenceLine("pair", [b, a], zero, context).geometry,
    ).toEqual({
      kind: "line",
      // Reversed planes produce a negative-zero anchor; projection preserves it.
      start: [154, -0, -0],
      direction: [-1, 0, 0],
      length: 104,
    });
  });
  it("preserves native float32 midpoint rounding before projection", () => {
    const a: NativeReferenceLineRecord = {
      ...planeY,
      directPlaneHalfSizes: undefined,
      bounds: [16777216, 0, 0, 16777218, 0, 0],
    };
    const b: NativeReferenceLineRecord = {
      ...planeZ,
      bounds: [16777216, 0, 0, 16777218, 0, 0],
    };
    expect(
      evaluateNativeReferenceLine("pair", [a, b], zero, context).geometry,
    ).toEqual({
      kind: "line",
      start: [16777215, 0, 0],
      direction: [1, 0, 0],
      length: 2,
    });
  });
  it("rounds the merged span subtraction through float32", () => {
    const a: NativeReferenceLineRecord = {
      ...planeY,
      directPlaneHalfSizes: undefined,
      bounds: [-1, 0, 0, 16777216, 0, 0],
    };
    const b: NativeReferenceLineRecord = {
      ...planeZ,
      bounds: [-1, 0, 0, 16777216, 0, 0],
    };
    expect(
      evaluateNativeReferenceLine("pair", [a, b], zero, context).geometry,
    ).toEqual({
      kind: "line",
      start: [-0.5, 0, 0],
      direction: [1, 0, 0],
      length: 16777216,
    });
  });
  it("merges a valid second box into an initially inverted first box", () => {
    const a: NativeReferenceLineRecord = {
      ...planeY,
      directPlaneHalfSizes: undefined,
      bounds: [2, 0, 0, 0, 0, 0],
    };
    const b: NativeReferenceLineRecord = {
      ...planeZ,
      bounds: [0, 0, 0, 4, 0, 0],
    };
    expect(
      evaluateNativeReferenceLine("pair", [a, b], zero, context).geometry,
    ).toEqual({
      kind: "line",
      start: [-1, 0, 0],
      direction: [1, 0, 0],
      length: 4,
    });
  });
  it.each([
    { second: [10, 0, 0, -10, 0, 0] },
    { second: [-3.4028234663852886e38, 0, 0, 10, 0, 0] },
  ])("does not merge an invalid or sentinel second box %#", ({ second }) => {
    const a: NativeReferenceLineRecord = {
      ...planeY,
      directPlaneHalfSizes: undefined,
      bounds: [0, 0, 0, 2, 0, 0],
    };
    const b: NativeReferenceLineRecord = {
      ...planeZ,
      bounds: second as [number, number, number, number, number, number],
    };
    expect(
      evaluateNativeReferenceLine("pair", [a, b], zero, context).geometry,
    ).toEqual({
      kind: "line",
      start: [0, 0, 0],
      direction: [1, 0, 0],
      length: 2,
    });
  });
});
