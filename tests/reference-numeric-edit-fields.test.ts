// Parent activated this shared contract and captured RED before implementation.
import { expect, it } from "vitest";
import { referenceNumericEditFields } from "../src/reference-numeric-edit-fields";
import { encodeReferenceGeometry } from "../src/reference-construction-values";
import type { Entity, Vec3 } from "../src/types";

function point(position: Vec3): Entity {
  return {
    id: "point",
    name: "Point",
    kind: "referencePoint",
    positions: [],
    visible: true,
    color: "#ffffff",
    opacity: 1,
    constructionOrderKey: "01".repeat(16),
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
      evaluation: { completionWord: 256 },
    },
  };
}
function line(start: Vec3, direction: Vec3 = [1, 0, 0], length = 1): Entity {
  const end = start.map((value, i) => value + direction[i] * length) as Vec3;
  return {
    ...point(start),
    id: "line",
    name: "Line",
    kind: "referenceLine",
    reference: {
      version: 1,
      definition: {
        version: 1,
        kind: "line",
        mode: "endpoints",
        start,
        end,
        sources: [],
        records: [],
      },
      geometry: { kind: "line", start, direction, length },
      evaluation: { completionWord: 256 },
    },
  };
}

it("prepares point edit values with N7 pre-round then fixed6 even ties, not the original accepted coordinates", () => {
  // 0.00781254 pre-rounds to the exactly representable 0.0078125; fixed6
  // then chooses the even lower 7812. Direct fixed6 would instead be 7813.
  const source = point([0.00781254, 0.0078125, 1000.000244140625]);
  expect(referenceNumericEditFields(source)).toEqual({
    kind: "point",
    units: "mm",
    coordinateSpace: "world",
    position: [0.007812, 0.007812, 1000.000244],
    positionEncoding: encodeReferenceGeometry({
      kind: "point",
      position: [0.007812, 0.007812, 1000.000244],
    }),
  });
});

it("formats line endpoints directly with fixed6, independently of the point N7 pre-round", () => {
  expect(
    referenceNumericEditFields(
      line([0.00781254, 0.0078125, 1000.000244140625]),
    ),
  ).toEqual({
    kind: "line",
    units: "mm",
    coordinateSpace: "world",
    start: [0.007813, 0.007812, 1000.000244],
    end: [1.007813, 0.007812, 1000.000244],
    startEncoding: encodeReferenceGeometry({
      kind: "point",
      position: [0.007813, 0.007812, 1000.000244],
    }),
    endEncoding: encodeReferenceGeometry({
      kind: "point",
      position: [1.007813, 0.007812, 1000.000244],
    }),
  });
});

it("retains the known fixed6 upper-even result for a second exact binary halfway value", () => {
  // 0.0234375*1e6 = 23437.5, so the even result is the upper 23438.
  const result = referenceNumericEditFields(point([0.0234375, 0, 0]));
  expect(result.kind).toBe("point");
  if (result.kind !== "point") throw Error("Expected point fields");
  expect(result.position).toEqual([0.023438, 0, 0]);
});

it("rounds the exact binary64 value rather than an already rounded scaled product", () => {
  // 2.5e-6 is slightly above its exact decimal spelling in binary64, while
  // multiplication by 1e6 rounds it to exactly2.5. Python Decimal.from_float
  // independently gives fixed6=0.000003, not scaled-product even0.000002.
  const result = referenceNumericEditFields(line([0.0000025, 0, 0]));
  if (result.kind !== "line") throw Error("Expected line fields");
  expect(result.start).toEqual([0.000003, 0, 0]);
});

it("handles a finite subnormal using the same bounded fixed precision", () => {
  const result = referenceNumericEditFields(line([Number.MIN_VALUE, 0, 0]));
  if (result.kind !== "line") throw Error("Expected line fields");
  expect(result.start).toEqual([0, 0, 0]);
  expect(result.end).toEqual([1, 0, 0]);
});

it("applies the proved point sign-threshold stage to accepted negative zero without mutating the source", () => {
  const source = point([-0, -1e-8, 0]);
  const result = referenceNumericEditFields(source);
  if (result.kind !== "point") throw Error("Expected point fields");
  expect(Object.is(result.position[0], 0)).toBe(true);
  expect(Object.is(result.position[1], 0)).toBe(true);
  expect(result.positionEncoding.bits).toBe("0".repeat(48));
  if (source.reference!.geometry.kind !== "point")
    throw Error("Expected point");
  expect(Object.is(source.reference!.geometry.position[0], -0)).toBe(true);
  expect(source.reference!.geometry.position[1]).toBe(-1e-8);
});

it("reconstructs endpoints from raw stored direction and extent without normalizing the source", () => {
  const source = line([1.0000004, 2, 3], [2, 0, 0], 5);
  const result = referenceNumericEditFields(source);
  if (result.kind !== "line") throw Error("Expected line fields");
  expect(result.start).toEqual([1, 2, 3]);
  expect(result.end).toEqual([11, 2, 3]);
  expect(source.reference!.geometry).toEqual({
    kind: "line",
    start: [1.0000004, 2, 3],
    direction: [2, 0, 0],
    length: 5,
  });
});

it("returns detached edit fields and leaves accepted recipe, geometry, identity and state unchanged", () => {
  const source = point([0.00781254, 2, 3]),
    before = structuredClone(source);
  const first = referenceNumericEditFields(source);
  if (first.kind !== "point") throw Error("Expected point fields");
  (first.position as unknown as number[])[0] = 99;
  expect(source).toEqual(before);
  const second = referenceNumericEditFields(source);
  if (second.kind !== "point") throw Error("Expected point fields");
  expect(second.position[0]).toBe(0.007812);
  expect(second.positionEncoding).toEqual(
    encodeReferenceGeometry({ kind: "point", position: [0.007812, 2, 3] }),
  );
});

it("exposes prepared numeric fields for a derived point without detaching its source recipe", () => {
  const source = point([0.00781254, 2, 3]);
  source.reference!.definition = {
    version: 1,
    kind: "point",
    mode: "center",
    sources: [{ id: "parent", constructionOrderKey: "02".repeat(16) }],
  };
  const recipe = source.reference!.definition;
  const result = referenceNumericEditFields(source);
  if (result.kind !== "point") throw Error("Expected point fields");
  expect(result.position).toEqual([0.007812, 2, 3]);
  expect(source.reference!.definition).toBe(recipe);
});

it("reports collapsed prepared line inputs for inspection instead of silently enlarging the original line", () => {
  const source = line([1e-8, 0, 0], [1, 0, 0], 1e-8);
  const result = referenceNumericEditFields(source);
  if (result.kind !== "line") throw Error("Expected line fields");
  expect(result.start).toEqual([0, 0, 0]);
  expect(result.end).toEqual([0, 0, 0]);
  expect(source.reference!.geometry).toEqual({
    kind: "line",
    start: [1e-8, 0, 0],
    direction: [1, 0, 0],
    length: 1e-8,
  });
});

it("keeps admitted exact world bounds finite and unchanged", () => {
  const result = referenceNumericEditFields(point([1e9, -1e9, 0]));
  if (result.kind !== "point") throw Error("Expected point fields");
  expect(result.position).toEqual([1e9, -1e9, 0]);
});

it("rejects non-semantic inputs rather than treating empty sample geometry as editable coordinates", () => {
  const source: Entity = {
    id: "mesh",
    name: "Mesh",
    kind: "mesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    visible: true,
    color: "#ffffff",
    opacity: 1,
  };
  expect(() => referenceNumericEditFields(source)).toThrow(
    /reference|semantic/i,
  );
});

it("retains strict semantic identity validation instead of inventing a migration during read-only preparation", () => {
  const source = point([1, 2, 3]);
  delete source.constructionOrderKey;
  expect(() => referenceNumericEditFields(source)).toThrow(
    /construction order key/i,
  );
});

// Original line -0 is deliberately not an asserted fixture: the separate
// 404310 fixed-format signed-zero policy is not established by point sign logic.
// Negative G15/fixed6 ties and other units/precision need their own evidence.
