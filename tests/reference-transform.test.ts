import { expect, it } from "vitest";
import {
  referenceTransformEligibility,
  referenceTransformMatrix,
  transformNumericReference,
} from "../src/reference-transform";
import { encodeReferenceEntityData } from "../src/reference-entity";
import { referenceLineEnd } from "../src/reference-construction-values";
import type { Entity, Vec3 } from "../src/types";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function point(position: Vec3 = [1, 2, 3]): Entity {
  return {
    id: "point",
    name: "Precise point",
    kind: "referencePoint",
    constructionOrderKey: "01".repeat(16),
    positions: [],
    color: "#123456",
    opacity: 0.7,
    visible: true,
    selectable: true,
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "point",
        mode: "coordinates",
        position,
        sources: [],
      },
      geometry: { kind: "point", position },
      evaluation: { completionWord: 0x100 },
    },
  };
}
function line(
  start: Vec3 = [2, 4, 6],
  direction: Vec3 = [2, -3, 0.5],
  length = 8,
): Entity {
  const geometry = { kind: "line" as const, start, direction, length };
  return {
    ...point(),
    id: "line",
    kind: "referenceLine",
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start,
        end: referenceLineEnd(geometry),
        records: [],
        sources: [],
      },
      geometry,
      evaluation: { completionWord: 0x100 },
    },
  };
}
function bits(values: readonly number[]) {
  const buffer = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => buffer.writeDoubleLE(value, index * 8));
  return buffer.toString("hex");
}

it("uses original binary64 coordinates for every row and the recovered grouped payload sum", () => {
  const source = point([1, 1, 1]);
  const matrix = [1e16, -1e16, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0];
  const before = encodeReferenceEntityData(source.reference!);
  const moved = transformNumericReference(source, matrix);
  expect(moved.reference!.geometry).toEqual({
    kind: "point",
    position: [2, 1, 1],
  });
  // Reassociation loses the first row's unit; in-place rows corrupt the second.
  expect(
    moved.reference!.geometry.kind === "point" &&
      bits(moved.reference!.geometry.position),
  ).toBe(bits([2, 1, 1]));
  expect(matrix).toEqual([1e16, -1e16, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0]);
  expect(encodeReferenceEntityData(source.reference!)).toEqual(before);
});

it("keeps binary64 detail without Float32, fixed-six or G15 conversion", () => {
  const source = point([1 + 2 ** -40, -3, 2 ** -100]);
  const moved = transformNumericReference(
    source,
    [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0],
  );
  const geometry = moved.reference!.geometry;
  if (geometry.kind !== "point") throw Error("Wrong geometry");
  expect(bits(geometry.position)).toBe(bits([2 + 2 ** -39, -6, 2 ** -99]));
});

it("preserves the payload arithmetic's signed zeros without a JSON roundtrip", () => {
  const moved = transformNumericReference(
    point([-0, -0, -0]),
    [1, 0, 0, -0, 0, 1, 0, -0, 0, 0, 1, -0],
  );
  const geometry = moved.reference!.geometry;
  if (geometry.kind !== "point") throw Error("Wrong geometry");
  expect(bits(geometry.position)).toBe(bits([-0, -0, -0]));
});

it("transforms raw line direction without translation or normalization and preserves length bits", () => {
  const source = line(),
    before = encodeReferenceEntityData(source.reference!);
  const moved = transformNumericReference(
    source,
    [2, 0, 0, 10, 0, 2, 0, -5, 0, 0, 2, 2],
  );
  const geometry = moved.reference!.geometry,
    definition = moved.reference!.definition;
  if (
    geometry.kind !== "line" ||
    definition.kind !== "line" ||
    definition.mode !== "endpoints"
  )
    throw Error("Wrong line");
  expect(
    bits([...geometry.start, ...geometry.direction, geometry.length]),
  ).toBe(bits([14, 3, 14, 4, -6, 1, 8]));
  expect(bits(definition.start)).toBe(bits(geometry.start));
  expect(bits(definition.end)).toBe(bits(referenceLineEnd(geometry)));
  expect(moved.reference!.evaluation.completionWord).toBe(0x100);
  expect(encodeReferenceEntityData(source.reference!)).toEqual(before);
});

it("synchronizes the numeric end from the transformed raw payload, not separately transformed authoring end", () => {
  const source = line();
  const definition = source.reference!.definition;
  if (definition.kind !== "line" || definition.mode !== "endpoints")
    throw Error("Wrong definition");
  source.reference!.definition = { ...definition, end: [99, 99, 99] };
  const moved = transformNumericReference(source, identity),
    result = moved.reference!;
  if (
    result.definition.kind !== "line" ||
    result.definition.mode !== "endpoints" ||
    result.geometry.kind !== "line"
  )
    throw Error("Wrong result");
  expect(result.definition.end).toEqual([18, -20, 10]);
  expect(result.definition.end).toEqual(referenceLineEnd(result.geometry));
});

it("allows finite direction components above world-coordinate bounds when endpoints are bounded", () => {
  const moved = transformNumericReference(
    line([0, 0, 0], [2e9, 0, 0], 1e-12),
    [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0],
  );
  const geometry = moved.reference!.geometry;
  if (geometry.kind !== "line") throw Error("Wrong geometry");
  expect(geometry.direction[0]).toBe(4e9);
  expect(bits([geometry.length])).toBe(bits([1e-12]));
  expect(referenceLineEnd(geometry)).toEqual([0.004, 0, 0]);
});

it("preserves representable zero direction/length instead of inventing an authoring minimum", () => {
  const moved = transformNumericReference(
    line([0, 0, 0], [-0, -0, -0], -0),
    identity,
  );
  const geometry = moved.reference!.geometry;
  if (geometry.kind !== "line") throw Error("Wrong geometry");
  expect(bits([...geometry.direction, geometry.length])).toBe(
    bits([-0, -0, -0, -0]),
  );
});

it("preserves identity/presentation metadata and detaches every transformed semantic vector", () => {
  const source = line(),
    moved = transformNumericReference(source, identity);
  expect(moved).not.toBe(source);
  for (const key of [
    "id",
    "name",
    "color",
    "opacity",
    "visible",
    "selectable",
    "constructionOrderKey",
    "positions",
  ] as const)
    expect(moved[key]).toBe(source[key]);
  expect(moved.reference).not.toBe(source.reference);
  const geometry = moved.reference!.geometry,
    original = source.reference!.geometry;
  if (geometry.kind !== "line" || original.kind !== "line")
    throw Error("Wrong geometry");
  expect(geometry.start).not.toBe(original.start);
  expect(geometry.direction).not.toBe(original.direction);
});

it("rejects out-of-range reconstructed endpoints even when the transformed origin is valid", () => {
  const source = line([0, 0, 0], [1, 0, 0], 750e6),
    before = encodeReferenceEntityData(source.reference!);
  expect(() =>
    transformNumericReference(source, [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0]),
  ).toThrow(/bound|range/i);
  expect(encodeReferenceEntityData(source.reference!)).toEqual(before);
});

it.each([
  { source: point(), matrix: [1, 0, 0, 1e9, 0, 1, 0, 0, 0, 0, 1, 0] },
  {
    source: line([0, 0, 0], [Number.MAX_VALUE, 0, 0], 0),
    matrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  },
  { source: point(), matrix: [1, 0, 0, Infinity, 0, 1, 0, 0, 0, 0, 1, 0] },
  { source: point(), matrix: identity.slice(0, 11) },
])(
  "rejects malformed/overflowing finite-matrix output atomically",
  ({ source, matrix }) => {
    const before = encodeReferenceEntityData(source.reference!);
    expect(() => transformNumericReference(source, matrix)).toThrow();
    expect(encodeReferenceEntityData(source.reference!)).toEqual(before);
  },
);

it("builds the existing positive-scale X/Y/Z-degree application matrix without native Euler equivalence claims", () => {
  const cosine = Math.cos(Math.PI / 2);
  expect(referenceTransformMatrix([4, 5, 6], [90, 0, 0], 2)).toEqual([
    2,
    0,
    0,
    4,
    0,
    2 * cosine,
    -2,
    5,
    0,
    2,
    2 * cosine,
    6,
  ]);
  const moved = transformNumericReference(
    point([1, 0, 0]),
    referenceTransformMatrix([0, 3, 2], [0, 0, 90], 1),
  );
  const geometry = moved.reference!.geometry;
  if (geometry.kind !== "point") throw Error("Wrong geometry");
  expect(bits(geometry.position)).toBe(bits([Math.cos(Math.PI / 2), 4, 2]));
});

it.each([0, -1, NaN, Infinity])(
  "rejects unsupported public scale %s before constructing a matrix",
  (scale) => {
    expect(() =>
      referenceTransformMatrix([0, 0, 0], [0, 0, 0], scale),
    ).toThrow();
  },
);

it("rejects nonfinite translation or application trigonometric coefficients", () => {
  expect(() =>
    referenceTransformMatrix([0, 0, Infinity], [0, 0, 0], 1),
  ).toThrow();
  expect(() =>
    referenceTransformMatrix([0, 0, 0], [Number.MAX_VALUE, 0, 0], 1),
  ).toThrow();
});

it("rejects locked/kind/inactive-source records before copying large or hostile payloads in UI eligibility", () => {
  const source = line();
  let reads = 0;
  const record = {
    entityId: "old",
    storage: "native-pick-record-f32" as const,
    get coordinates(): Vec3 {
      reads++;
      throw Error("Must not inspect inactive record");
    },
  };
  const definition = source.reference!.definition;
  if (definition.kind !== "line" || definition.mode !== "endpoints")
    throw Error("Wrong definition");
  source.reference!.definition = { ...definition, records: [record] };
  expect(referenceTransformEligibility(source)).toMatchObject({
    eligible: false,
  });
  expect(reads).toBe(0);
  expect(
    referenceTransformEligibility({ ...point(), locked: true }),
  ).toMatchObject({ eligible: false });
  expect(referenceTransformEligibility(undefined)).toMatchObject({
    eligible: false,
  });
  expect(
    referenceTransformEligibility({ ...point(), kind: "referenceFrame" }),
  ).toMatchObject({ eligible: false });
});

it("uses one shared numeric-only eligibility rule and reports malformed numeric data", () => {
  expect(referenceTransformEligibility(point())).toEqual({ eligible: true });
  expect(referenceTransformEligibility(line())).toEqual({ eligible: true });
  const derived = point();
  derived.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [{ id: "source", constructionOrderKey: "02".repeat(16) }],
  };
  expect(referenceTransformEligibility(derived)).toMatchObject({
    eligible: false,
  });
  expect(
    referenceTransformEligibility({
      ...point(),
      constructionOrderKey: undefined,
    }),
  ).toMatchObject({ eligible: false, reason: expect.any(String) });
});
