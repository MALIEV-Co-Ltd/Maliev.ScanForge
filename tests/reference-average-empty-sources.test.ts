import { describe, expect, it } from "vitest";
import { copyReferenceConstruction } from "../src/reference-construction";
import { evaluateReferenceConstruction } from "../src/reference-construction-evaluation";

const source = { id: "source", constructionOrderKey: "01".repeat(16) };
function definition(mode = "average", sources: (typeof source)[] = []) {
  const value = copyReferenceConstruction({
    version: 1,
    kind: "line",
    mode,
    sources,
    records: [
      {
        entityId: "retained-a",
        storage: "native-pick-record-f32",
        coordinates: [-0, 0, 0],
      },
      {
        entityId: "retained-b",
        storage: "native-pick-record-f32",
        coordinates: [0, 2, 0],
      },
    ],
  });
  if (value.kind !== "line") throw new Error("Expected line definition");
  return value;
}
const prior = () => ({
  geometry: {
    kind: "line" as const,
    start: [1, 2, 3] as const,
    direction: [2, 0, 0] as const,
    length: 4,
  },
  state: { completionWord: 0x324 },
});

describe("shared average-line common-source guard", () => {
  it.each([undefined, null])(
    "re-finalizes prior endpoints without a resolved bundle (%s)",
    (resolved) => {
      expect(
        evaluateReferenceConstruction(definition(), resolved, prior()),
      ).toEqual({
        geometry: {
          kind: "line",
          start: [1, 2, 3],
          direction: [1, 0, 0],
          length: 8,
        },
        state: { completionWord: 0x100 },
        outcome: "fallback",
        diagnostics: {
          reason: "previous-endpoints",
          sourceCount: 0,
          recordCount: 2,
          contributingRecords: 0,
        },
      });
    },
  );

  it("does not inspect inactive resolved records", () => {
    const resolved = Object.defineProperty({}, "kind", {
      get() {
        throw new Error("Inactive resolver input was accessed");
      },
    });
    expect(
      evaluateReferenceConstruction(definition(), resolved, prior()),
    ).toMatchObject({
      outcome: "fallback",
      state: { completionWord: 0x100 },
      diagnostics: { contributingRecords: 0, recordCount: 2 },
    });
  });

  it("preserves degenerate prior geometry while writing the completion word", () => {
    const state = prior();
    state.geometry.length = 0;
    expect(
      evaluateReferenceConstruction(definition(), undefined, state),
    ).toMatchObject({
      geometry: state.geometry,
      outcome: "unchanged",
      state: { completionWord: 0x100 },
      diagnostics: { reason: "degenerate-endpoints" },
    });
    expect(state.state.completionWord).toBe(0x324);
  });

  it("still resolves pair records when their common source set is empty", () => {
    const value = definition("pair");
    expect(() =>
      evaluateReferenceConstruction(value, undefined, prior()),
    ).toThrow(/resolved reference construction inputs/i);
    const resolved = {
      kind: "line",
      records: value.records.map((record, index) => ({
        record,
        primitive: { kind: "point", position: [0, index * 3, 0] },
      })),
    };
    expect(
      evaluateReferenceConstruction(value, resolved, prior()),
    ).toMatchObject({
      geometry: { start: [0, 0, 0], direction: [0, 1, 0], length: 3 },
      diagnostics: { sourceCount: 0, recordCount: 2, contributingRecords: 2 },
    });
  });

  it("requires record bindings for an active average source set", () => {
    expect(() =>
      evaluateReferenceConstruction(
        definition("average", [source]),
        undefined,
        prior(),
      ),
    ).toThrow(/resolved reference construction inputs/i);
  });

  it("still rejects malformed retained definitions before the guard", () => {
    const value = definition();
    const malformed = {
      ...value,
      records: [
        { ...value.records[0], coordinates: [1 + 2 ** -40, 0, 0] as const },
        value.records[1],
      ],
    };
    expect(() =>
      evaluateReferenceConstruction(malformed, undefined, prior()),
    ).toThrow(/Float32/);
  });
});
