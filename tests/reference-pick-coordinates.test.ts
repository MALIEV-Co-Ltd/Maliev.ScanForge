import { expect, it } from "vitest";
import {
  bakeNativeMillimetreFloatPick,
  resolveReferenceCoordinatePoint,
} from "../src/reference-pick-coordinates";
import {
  cloudPoseBits,
  cloudPoseMatrix,
  placedCloud,
} from "../src/point-cloud-placement";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";
import type { Entity, Vec3 } from "../src/types";

function float32Bits(value: number): string {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true).toString(16).padStart(8, "0");
}

// Independent analytic goldens, not original-code execution outputs. Generated
// with Python standard-library struct and Fraction: first decode input f32,
// floor(abs(Fraction(v))*1_000_000 + 1/2), divide by 1_000_000, apply the
// inclusive -2^-23 sign rule, then encode the final f32. For these bounded
// vectors, multiplying an f32 significand by 1_000_000 is exact in binary64.
// Scope: recovered 4044e0 startup millimetres/N6; the precise double route and
// alternate units are separate contracts and are not covered by this adapter.
it.each([
  ["positive zero", 0, "00000000"],
  ["negative input zero becomes positive", -0, "00000000"],
  [
    "Float32 input rounding precedes decimal quantization",
    1.0000005,
    "3f800000",
  ],
  ["negative Float32 input rounding", -1.0000005, "bf800000"],
  ["binary64 product stays below the decimal half", 0.0100005, "3c23d70a"],
  [
    "nonrepresentable decimal result rounds back to Float32",
    1.2345675,
    "3f9e0653",
  ],
  [
    "negative magnitude above sign threshold rounds to negative zero",
    -3e-7,
    "80000000",
  ],
  [
    "negative magnitude below sign threshold rounds to positive zero",
    -1e-7,
    "00000000",
  ],
  ["inclusive negative sign threshold", -(2 ** -23), "80000000"],
  ["adjacent Float32 toward zero", -(2 ** -23) + 2 ** -47, "00000000"],
  ["adjacent Float32 away from zero", -(2 ** -23) - 2 ** -46, "80000000"],
  ["positive Float32 subnormal", 2 ** -149, "00000000"],
  ["negative Float32 subnormal uses positive sign", -(2 ** -149), "00000000"],
  ["exact representable positive decimal half", 0.0078125, "3c000219"],
  ["exact representable negative decimal half", -0.0078125, "bc000219"],
  ["Float32 immediately below positive half", 0.0078125 - 2 ** -31, "3bfffbce"],
  ["Float32 immediately above positive half", 0.0078125 + 2 ** -30, "3c000219"],
  ["positive world bound", 1e9, "4e6e6b28"],
  ["negative world bound", -1e9, "ce6e6b28"],
  ["large input rounds to the inclusive world bound", 999999999, "4e6e6b28"],
  ["large scaled integer remains safe", 123456.789, "47f12065"],
] as const)(
  "bakes %s with the recovered Float32/binary64 boundaries",
  (_, input, bits) => {
    const result = bakeNativeMillimetreFloatPick([input, input, input]);
    expect(result.map(float32Bits)).toEqual([bits, bits, bits]);
    // The return value is the promoted final f32, not an unrounded decimal double.
    for (const value of result)
      expect(Object.is(value, Math.fround(value))).toBe(true);
  },
);

it("chooses the sign after initial Float32 conversion, including inputs that round onto the threshold", () => {
  const world: Vec3 = [-(2 ** -23) + 2 ** -50, -3e-7, -1e-7];
  const result = bakeNativeMillimetreFloatPick(world);
  expect(result.map(float32Bits)).toEqual(["80000000", "80000000", "00000000"]);
  expect(Object.is(result[0], -0)).toBe(true);
  expect(Object.is(result[1], -0)).toBe(true);
  expect(Object.is(result[2], 0)).toBe(true);
});

it("detaches all three coordinates and never mutates the input", () => {
  const world = Object.freeze([1.0000005, -3e-7, 123456.789] as const);
  const result = bakeNativeMillimetreFloatPick(world);
  expect(result).not.toBe(world);
  expect(result.map(float32Bits)).toEqual(["3f800000", "80000000", "47f12065"]);
  result[0] = 42;
  expect(world).toEqual([1.0000005, -3e-7, 123456.789]);
  expect(bakeNativeMillimetreFloatPick(world)[0]).toBe(1);
});

// Exercise the runtime trust boundary independently of the compile-time tuple.
const uncheckedBake = bakeNativeMillimetreFloatPick as (world: unknown) => Vec3;
it.each([
  ["missing", undefined],
  ["null", null],
  ["not an array", { 0: 1, 1: 2, 2: 3, length: 3 }],
  ["empty", []],
  ["short", [1, 2]],
  ["extra coordinate", [1, 2, 3, 4]],
  ["sparse coordinate", [1, , 3]],
  ["string coordinate", [1, "2", 3]],
  ["NaN", [1, Number.NaN, 3]],
  ["positive infinity", [1, 2, Number.POSITIVE_INFINITY]],
  ["negative infinity", [Number.NEGATIVE_INFINITY, 2, 3]],
  ["positive bound exceeded before Float32 conversion", [1e9 + 1, 0, 0]],
  ["negative bound exceeded before Float32 conversion", [0, -1e9 - 1, 0]],
] as const)("rejects %s before returning a baked coordinate", (_, world) => {
  expect(() => uncheckedBake(world)).toThrowError(
    new Error(
      "Picked coordinates require three finite values within +/-1e9 mm.",
    ),
  );
});

function pointCloud(
  positions: Entity["positions"] = [1, 2, 3, 4, 5, 6],
): Entity {
  return {
    id: "cloud",
    name: "Measured points",
    kind: "pointcloud",
    positions,
    visible: true,
    color: "#abcdef",
    opacity: 1,
  };
}

it("resolves the requested measured vertex as detached pre-bake world coordinates", () => {
  const source = pointCloud([1, 2, 3, 1.0000005, -3e-7, -1e-7]);
  const result = resolveReferenceCoordinatePoint(
    Object.freeze([source]),
    source.id,
    1,
  );
  expect(result).toEqual([1.0000005, -3e-7, -1e-7]);
  expect(bakeNativeMillimetreFloatPick(result).map(float32Bits)).toEqual([
    "3f800000",
    "80000000",
    "00000000",
  ]);
  result[0] = 42;
  expect(source.positions).toEqual([1, 2, 3, 1.0000005, -3e-7, -1e-7]);
});

it("resolves a native placed cloud from one local XYZ without materializing its lazy world positions or normals", () => {
  const positions = new Float32Array([99, 98, 97, 1.25, -2.5, 3.75]);
  const placement = {
    sourcePositions: positions,
    matrixBits: cloudPoseBits([0, -1, 0, 10, 1, 0, 0, -20, 0, 0, 1, 30]),
  };
  const source = placedCloud(pointCloud(positions), placement);
  Object.defineProperties(source, {
    positions: {
      configurable: true,
      enumerable: true,
      get: () => {
        throw Error("Full world positions must not be materialized");
      },
    },
    normals: {
      configurable: true,
      enumerable: true,
      get: () => {
        throw Error("World normals must not be materialized");
      },
    },
  });
  const priorBits = placement.matrixBits;
  expect(resolveReferenceCoordinatePoint([source], source.id, 1)).toEqual([
    12.5, -18.75, 33.75,
  ]);
  expect(placement.matrixBits).toBe(priorBits);
  expect(placement.sourcePositions).toBe(positions);
  expect(Array.from(positions)).toEqual([99, 98, 97, 1.25, -2.5, 3.75]);
});

it("matches established Float32 world-transform arithmetic using the exact stored double pose", () => {
  const positions = new Float32Array([1, 2, 3, 123.456, -789.012, 3.000001]);
  const matrix = [
    0.8660254037844386, 0.5, 0, 123.4, -0.5, 0.8660254037844386, 0, -56.7, 0, 0,
    1, 8.9,
  ];
  const placement = {
    sourcePositions: positions,
    matrixBits: cloudPoseBits(matrix),
  };
  const source = placedCloud(pointCloud(positions), placement);
  const expected = transformDatumCoordinates(
    positions,
    cloudPoseMatrix(placement.matrixBits),
  ).slice(3, 6);
  const result = resolveReferenceCoordinatePoint([source], source.id, 1);
  expect(result.map(float32Bits)).toEqual(Array.from(expected, float32Bits));
  expect(cloudPoseMatrix(placement.matrixBits)).toEqual(matrix);
});

it("reads source geometry independently of operation-owned visibility and pickability authorization", () => {
  const source = {
    ...pointCloud(),
    visible: false,
    locked: true,
    selectable: false,
  };
  expect(resolveReferenceCoordinatePoint([source], source.id, 0)).toEqual([
    1, 2, 3,
  ]);
});

it.each([
  -1,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  2,
])("rejects invalid or out-of-range point index %s", (index) => {
  expect(() =>
    resolveReferenceCoordinatePoint([pointCloud()], "cloud", index),
  ).toThrowError(
    new Error(
      "Point-cloud point index must be a safe integer within the source range.",
    ),
  );
});

it("rejects missing or ambiguous object identities and non-cloud source families", () => {
  const source = pointCloud();
  expect(() => resolveReferenceCoordinatePoint([source], "missing", 0)).toThrow(
    new Error("Point-cloud source is missing."),
  );
  expect(() =>
    resolveReferenceCoordinatePoint([source, { ...source }], source.id, 0),
  ).toThrowError(new Error("Duplicate point-cloud source identity."));
  expect(() =>
    resolveReferenceCoordinatePoint(
      [{ ...source, kind: "mesh" }],
      source.id,
      0,
    ),
  ).toThrowError(new Error("Picked coordinate source must be a point cloud."));
});

it.each([
  [[], "Point-cloud coordinates require complete XYZ triples."],
  [[1, 2], "Point-cloud coordinates require complete XYZ triples."],
  [[1, Number.NaN, 3], "Selected point-cloud coordinates must be finite."],
  [
    [1, Number.POSITIVE_INFINITY, 3],
    "Selected point-cloud coordinates must be finite.",
  ],
  [[1e9 + 1, 2, 3], "Picked world coordinates exceed +/-1e9 mm."],
] as const)(
  "rejects malformed or unsupported selected cloud coordinates: %s",
  (positions, message) => {
    const source = pointCloud([...positions]);
    expect(() =>
      resolveReferenceCoordinatePoint([source], source.id, 0),
    ).toThrowError(new Error(message));
  },
);

it("validates the currently retained placed-cloud pose before resolving a vertex", () => {
  const positions = new Float32Array([1, 2, 3]);
  const placement = {
    sourcePositions: positions,
    matrixBits: cloudPoseBits([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
  };
  const source = placedCloud(pointCloud(positions), placement);
  placement.matrixBits = "not-a-cloud-pose";
  expect(() => resolveReferenceCoordinatePoint([source], source.id, 0)).toThrow(
    new Error("Invalid cloud pose encoding."),
  );
});

it("does not reapply inherited stale placement after a source geometry edit", () => {
  const source = {
    ...pointCloud([9, 8, 7]),
    pointCloudPlacement: {
      sourcePositions: new Float32Array([1, 2, 3]),
      matrixBits: cloudPoseBits([1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30]),
    },
  };
  expect(resolveReferenceCoordinatePoint([source], source.id, 0)).toEqual([
    9, 8, 7,
  ]);
});
