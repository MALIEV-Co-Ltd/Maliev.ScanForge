import { describe, expect, it } from "vitest";
import {
  resolveDirectReferencePrimitive,
  resolveCadReferenceAxis,
} from "../src/reference-source-primitives";
import { evaluateReferenceConstruction } from "../src/reference-construction-evaluation";
import { copyReferenceConstruction } from "../src/reference-construction";
import historicalAxes from "./fixtures/alignment-datum-cad-axis-native.json";

describe("construction source primitive extraction", () => {
  it.each(["sphere", "referencePoint"] as const)(
    "copies stored %s coordinates without quantization",
    (kind) => {
      const origin = [-0, 1 + 2 ** -40, Number.MIN_VALUE] as const;
      const result = resolveDirectReferencePrimitive({ kind, origin });
      expect(result).toEqual({
        kind: "point",
        position: origin,
        objectResolved: true,
      });
      if (result.kind !== "point") throw new Error("Expected point");
      expect(result.position).not.toBe(origin);
    },
  );

  it.each(["cylinder", "referenceLine"] as const)(
    "uses the stored %s direction and extent without normalization",
    (kind) => {
      const result = resolveDirectReferencePrimitive({
        kind,
        origin: [1, 2, 3],
        direction: [2, 0, 0],
        length: 4,
      });
      expect(result).toEqual({
        kind: "axis",
        start: [1, 2, 3],
        end: [9, 2, 3],
        objectResolved: true,
      });
    },
  );

  it.each([0, -4])("preserves a stored direct extent of %s", (length) => {
    expect(
      resolveDirectReferencePrimitive({
        kind: "referenceLine",
        origin: [1, 2, 3],
        direction: [2, 0, 0],
        length,
      }),
    ).toMatchObject({ start: [1, 2, 3], end: [length === 0 ? 1 : -7, 2, 3] });
  });

  it("uses separate cone offset and length to construct both endpoints", () => {
    expect(
      resolveDirectReferencePrimitive({
        kind: "cone",
        origin: [10, 20, 30],
        direction: [2, -1, 0],
        offset: -3,
        length: 8,
      }),
    ).toEqual({
      kind: "axis",
      start: [4, 23, 30],
      end: [20, 15, 30],
      objectResolved: true,
    });
  });

  it("adds cone length to offset before multiplication instead of extending rounded start", () => {
    const result = resolveDirectReferencePrimitive({
      kind: "cone",
      origin: [1e16, 0, 0],
      direction: [1, 0, 0],
      offset: -1e16,
      length: 1,
    });
    expect(result).toMatchObject({ start: [0, 0, 0], end: [0, 0, 0] });
  });

  it("retains plane equation, origin and direct extents independently", () => {
    const source = {
      kind: "plane" as const,
      origin: [2, 3, 4] as const,
      normal: [0, 0, 2] as const,
      offset: -9,
      halfSizes: [3, 7] as const,
    };
    const result = resolveDirectReferencePrimitive(source);
    expect(result).toEqual({
      kind: "plane",
      origin: [2, 3, 4],
      normal: [0, 0, 2],
      offset: -9,
      directPlaneHalfSizes: [3, 7],
      objectResolved: true,
    });
    if (result.kind !== "plane") throw new Error("Expected plane");
    expect(result.origin).not.toBe(source.origin);
    expect(result.normal).not.toBe(source.normal);
    expect(result.directPlaneHalfSizes).not.toBe(source.halfSizes);
  });

  it("distinguishes a missing object from an object with no supported direct primitive", () => {
    expect(resolveDirectReferencePrimitive(undefined)).toEqual({
      kind: "unavailable",
      objectResolved: false,
    });
    expect(resolveDirectReferencePrimitive({ kind: "unsupported" })).toEqual({
      kind: "unavailable",
      objectResolved: true,
    });
  });

  it("feeds source extraction into the definition evaluator without changing source bindings", () => {
    const source = { id: "cone", constructionOrderKey: "01".repeat(16) };
    const definition = copyReferenceConstruction({
      version: 1,
      kind: "point",
      mode: "center",
      sources: [source],
    });
    const primitive = resolveDirectReferencePrimitive({
      kind: "cone",
      origin: [10, 20, 30],
      direction: [2, -1, 0],
      offset: -3,
      length: 8,
    });
    const result = evaluateReferenceConstruction(
      definition,
      { kind: "point", sources: [{ source, primitive }] },
      {
        geometry: { kind: "point", position: [99, 99, 99] },
        state: { completionWord: 0 },
      },
    );
    expect(result.geometry).toEqual({ kind: "point", position: [12, 19, 30] });
    expect(result.state.completionWord).toBe(0x100);
  });

  it.each([
    { kind: "sphere", origin: [Infinity, 0, 0] },
    { kind: "referencePoint", origin: [0, 0] },
    { kind: new String("sphere"), origin: [0, 0, 0] },
    { kind: "cylinder", origin: [0, 0, 0], direction: [1, 0, 0], length: NaN },
    {
      kind: "cone",
      origin: [0, 0, 0],
      direction: [1, 0, 0],
      offset: Infinity,
      length: 1,
    },
    {
      kind: "plane",
      origin: [0, 0, 0],
      normal: [0, 0, 1],
      offset: 0,
      halfSizes: [1, Infinity],
    },
  ])("rejects malformed source snapshots %#", (value) => {
    expect(() => resolveDirectReferencePrimitive(value as never)).toThrow();
  });

  it("rejects nonfinite endpoint arithmetic", () => {
    expect(() =>
      resolveDirectReferencePrimitive({
        kind: "referenceLine",
        origin: [0, 0, 0],
        direction: [Number.MAX_VALUE, 0, 0],
        length: 2,
      }),
    ).toThrow(/finite|overflow/i);
  });
});

describe("resolved OpenCascade construction axes", () => {
  it("reconstructs an oblique endpoint from historical captured axis fields", () => {
    const sample = historicalAxes.cases.find(
      (row) => row.name === "cad-axis-Cylindrical-0-False",
    )!;
    const decode = (hex: string) => {
      const bytes = Buffer.from(hex, "hex");
      return Array.from({ length: bytes.length / 8 }, (_, index) =>
        bytes.readDoubleLE(index * 8),
      );
    };
    const bits = (values: readonly number[]) => {
      const bytes = Buffer.alloc(values.length * 8);
      values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
      return bytes.toString("hex");
    };
    const primitive = decode(sample.primitiveBits),
      bounds = decode(sample.boundsBits);
    const start = decode(sample.nativePointBits),
      axis = decode(sample.nativeAxisBits),
      length = decode(sample.nativeLengthBits)[0];
    const result = resolveCadReferenceAxis({
      provider: "openCascade",
      kind: "cylinder",
      location: primitive.slice(0, 3) as [number, number, number],
      axis: primitive.slice(3, 6) as [number, number, number],
      firstV: bounds[2],
      lastV: bounds[3],
      radius: primitive[12],
      semiAngle: primitive[13],
    });
    if (result.kind !== "axis") throw new Error("Expected axis");
    expect(bits(result.start)).toBe(sample.nativePointBits);
    // The endpoint is derived from captured fields; it was not itself captured.
    expect(bits(result.end)).toBe(
      bits(start.map((value, index) => axis[index] * length + value)),
    );
  });

  const cylinder = {
    provider: "openCascade" as const,
    kind: "cylinder" as const,
    location: [10, 20, 30] as const,
    axis: [2, 0, 0] as const,
    firstV: 4,
    lastV: -2,
    radius: 3,
    semiAngle: 0,
  };

  it("reconstructs endpoint using positive extent even for decreasing trim bounds", () => {
    expect(resolveCadReferenceAxis(cylinder)).toEqual({
      kind: "axis",
      start: [14, 20, 30],
      end: [20, 20, 30],
      objectResolved: true,
    });
  });

  it("preserves zero extent at equal trim bounds", () => {
    expect(resolveCadReferenceAxis({ ...cylinder, lastV: 4 })).toMatchObject({
      start: [14, 20, 30],
      end: [14, 20, 30],
    });
  });

  it("does not normalize sub-epsilon axes or replace their resulting extent", () => {
    const tiny = Number.EPSILON / 2;
    expect(
      resolveCadReferenceAxis({
        ...cylinder,
        location: [0, 0, 0],
        axis: [tiny, 0, 0],
        firstV: 0,
        lastV: 2,
      }),
    ).toMatchObject({ start: [0, 0, 0], end: [2 * tiny * tiny, 0, 0] });
  });

  it("uses a unit extent for a resolved torus axis", () => {
    expect(
      resolveCadReferenceAxis({ ...cylinder, kind: "torus" }),
    ).toMatchObject({ start: [10, 20, 30], end: [11, 20, 30] });
  });

  it("applies the cone apex shift using its raw axis before normalization", () => {
    const radius = Math.tan(Math.PI / 4);
    expect(
      resolveCadReferenceAxis({
        ...cylinder,
        kind: "cone",
        radius,
        semiAngle: Math.PI / 4,
        firstV: 0,
        lastV: 3,
      }),
    ).toMatchObject({ start: [8, 20, 30], end: [11, 20, 30] });
  });

  it.each(["alternate", undefined])(
    "rejects an unbound provider: %s",
    (provider) => {
      expect(() =>
        resolveCadReferenceAxis({ ...cylinder, provider } as never),
      ).toThrow(/provider/i);
    },
  );

  it("rejects unsupported CAD classifications instead of treating them as cylinders", () => {
    expect(() =>
      resolveCadReferenceAxis({ ...cylinder, kind: "unknown" } as never),
    ).toThrow(/kind|unsupported/i);
  });

  it("rejects a nonfinite cone result", () => {
    expect(() =>
      resolveCadReferenceAxis({ ...cylinder, kind: "cone", semiAngle: 0 }),
    ).toThrow(/finite|overflow/i);
  });
});
