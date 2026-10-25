import { describe, expect, it } from "vitest";
import { copyReferenceConstruction } from "../src/reference-construction";
import {
  applyReferenceConstructionNumericInputs,
  evaluateReferenceConstruction,
} from "../src/reference-construction-evaluation";

const a = { id: "a", constructionOrderKey: "01".repeat(16) };
const b = { id: "b", constructionOrderKey: "02".repeat(16) };
const pointState = () => ({
  geometry: { kind: "point" as const, position: [7, 8, 9] as const },
  state: { completionWord: 0x324 },
});
const lineState = () => ({
  geometry: {
    kind: "line" as const,
    start: [1, 2, 3] as const,
    direction: [2, 0, 0] as const,
    length: 4,
  },
  state: { completionWord: 0x324 },
});
const point = (position: number[]) => ({
  kind: "point" as const,
  position: position as [number, number, number],
});
const axis = (start: number[], end: number[]) => ({
  kind: "axis" as const,
  start: start as [number, number, number],
  end: end as [number, number, number],
});
const pick = (entityId: string, x = 0) => ({
  entityId,
  storage: "native-pick-record-f32",
  coordinates: [x, 0, 0],
});
const pointDefinition = (mode = "pair", sources = [a, b]) =>
  copyReferenceConstruction({ version: 1, kind: "point", mode, sources });
const lineDefinition = (
  mode = "pair",
  sources = [a, b],
  records = [pick("b"), pick("a")],
) =>
  copyReferenceConstruction({
    version: 1,
    kind: "line",
    mode,
    sources,
    records,
  });

describe("shared internal construction evaluation", () => {
  it("separates numeric point writes from enabled/disabled evaluation state", () => {
    const definition = copyReferenceConstruction({
      version: 1,
      kind: "point",
      mode: "coordinates",
      sources: [a],
      position: [-0, 1 + 2 ** -40, 3],
    });
    const prior = pointState();
    const edit = applyReferenceConstructionNumericInputs(definition, prior);
    expect(edit.geometry).toEqual(point([-0, 1 + 2 ** -40, 3]));
    expect(edit.state.completionWord).toBe(0x324);
    expect(edit.written).toBe(true);
    expect(edit.reason).toBe("point-coordinates");
    const disabled = evaluateReferenceConstruction(
      definition,
      undefined,
      edit,
      false,
    );
    expect(disabled.geometry).toEqual(edit.geometry);
    expect(disabled.state.completionWord).toBe(0x324);
    expect(disabled.outcome).toBe("unchanged");
    expect(disabled.diagnostics.reason).toBe("evaluation-disabled");
    const enabled = evaluateReferenceConstruction(definition, undefined, edit);
    expect(enabled.geometry).toEqual(edit.geometry);
    expect(enabled.state.completionWord).toBe(0x100);
    expect(enabled.outcome).toBe("unchanged");
    expect(prior).toEqual(pointState());
  });

  it("stored evaluation does not silently reapply typed recipe parameters", () => {
    const definition = copyReferenceConstruction({
      version: 1,
      kind: "point",
      mode: "coordinates",
      sources: [],
      position: [90, 80, 70],
    });
    expect(
      evaluateReferenceConstruction(definition, undefined, pointState())
        .geometry,
    ).toEqual(pointState().geometry);
  });

  it("applies typed line endpoints without normalizing previous geometry first or changing completion", () => {
    const definition = copyReferenceConstruction({
      version: 1,
      kind: "line",
      mode: "endpoints",
      sources: [a],
      records: [pick("a")],
      start: [-0, 2, 3],
      end: [3, 6, 3],
    });
    const edit = applyReferenceConstructionNumericInputs(
      definition,
      lineState(),
    );
    expect(edit.geometry).toEqual({
      kind: "line",
      start: [-0, 2, 3],
      direction: [3 * (1 / 5), 4 * (1 / 5), 0],
      length: 5,
    });
    expect(edit.written).toBe(true);
    expect(edit.state.completionWord).toBe(0x324);
    const evaluated = evaluateReferenceConstruction(
      definition,
      undefined,
      edit,
    );
    expect(evaluated.geometry).toEqual(edit.geometry);
    expect(evaluated.state.completionWord).toBe(0x100);
  });

  it.each([0, Number.EPSILON])(
    "retains previous line and state when typed length %s is rejected",
    (length) => {
      const definition = copyReferenceConstruction({
        version: 1,
        kind: "line",
        mode: "endpoints",
        sources: [],
        records: [],
        start: [0, 0, 0],
        end: [length, 0, 0],
      });
      const edit = applyReferenceConstructionNumericInputs(
        definition,
        lineState(),
      );
      expect(edit.geometry).toEqual(lineState().geometry);
      expect(edit.state.completionWord).toBe(0x324);
      expect(edit.written).toBe(false);
      expect(edit.reason).toBe("degenerate-endpoints");
    },
  );

  it("does not run derived geometry as a numeric edit", () => {
    const edit = applyReferenceConstructionNumericInputs(
      pointDefinition(),
      pointState(),
    );
    expect(edit.geometry).toEqual(pointState().geometry);
    expect(edit.state).toEqual(pointState().state);
    expect(edit.reason).toBe("derived-mode");
  });

  it("uses canonical point source order and retains axis-plane unchanged state", () => {
    const definition = pointDefinition();
    const result = evaluateReferenceConstruction(
      definition,
      {
        kind: "point",
        sources: [
          { source: a, primitive: axis([0, 0, 0], [2, 0, 0]) },
          {
            source: b,
            primitive: {
              kind: "plane",
              origin: [0, 0, 1],
              normal: [0, 0, 1],
              offset: -1,
            },
          },
        ],
      },
      pointState(),
    );
    expect(result.geometry).toEqual(pointState().geometry);
    expect(result.state).toEqual(pointState().state);
    expect(result.diagnostics.reason).toBe("axis-plane-nearly-parallel");
    expect(result.diagnostics.sourceCount).toBe(2);
    expect(result.outcome).toBe("unchanged");
  });

  it("distinguishes a failed extraction from a mismatched resolver binding", () => {
    const definition = pointDefinition();
    const result = evaluateReferenceConstruction(
      definition,
      {
        kind: "point",
        sources: [
          { source: a, primitive: point([1, 2, 3]) },
          { source: b, primitive: { kind: "unavailable" } },
        ],
      },
      pointState(),
    );
    expect(result.geometry).toEqual(point([0, 0, 0]));
    expect(result.state.completionWord).toBe(0x100);
    expect(result.outcome).toBe("origin");
  });

  it("uses the first canonical point source for center mode", () => {
    const result = evaluateReferenceConstruction(
      pointDefinition("center"),
      {
        kind: "point",
        sources: [
          { source: a, primitive: axis([0, 0, 0], [2, 4, 6]) },
          { source: b, primitive: point([80, 90, 100]) },
        ],
      },
      pointState(),
    );
    expect(result.geometry).toEqual(point([1, 2, 3]));
    expect(result.outcome).toBe("updated");
  });

  it("preserves exact-three-plane admission and origin result for other retained cardinality", () => {
    const result = evaluateReferenceConstruction(
      pointDefinition("threePlanes"),
      {
        kind: "point",
        sources: [
          {
            source: a,
            primitive: {
              kind: "plane",
              origin: [1, 0, 0],
              normal: [1, 0, 0],
              offset: -1,
            },
          },
          {
            source: b,
            primitive: {
              kind: "plane",
              origin: [0, 2, 0],
              normal: [0, 1, 0],
              offset: -2,
            },
          },
        ],
      },
      pointState(),
    );
    expect(result.geometry).toEqual(point([0, 0, 0]));
    expect(result.state.completionWord).toBe(0x100);
    expect(result.outcome).toBe("origin");
  });

  it("uses retained line order rather than sorting records by common source keys", () => {
    const definition = lineDefinition();
    if (definition.kind !== "line") throw new Error("Expected line");
    const result = evaluateReferenceConstruction(
      definition,
      {
        kind: "line",
        records: [
          { record: definition.records[0], primitive: point([6, 0, 0]) },
          { record: definition.records[1], primitive: point([2, 0, 0]) },
        ],
      },
      lineState(),
    );
    expect(result.geometry).toEqual({
      kind: "line",
      start: [6, 0, 0],
      direction: [-1, 0, 0],
      length: 4,
    });
    expect(result.diagnostics.contributingRecords).toBe(2);
    expect(result.diagnostics.recordCount).toBe(2);
  });

  it("preserves repeated-record average weighting independently of dependencies", () => {
    const definition = lineDefinition(
      "average",
      [a, b],
      [pick("a"), pick("a"), pick("b")],
    );
    if (definition.kind !== "line") throw new Error("Expected line");
    const result = evaluateReferenceConstruction(
      definition,
      {
        kind: "line",
        records: definition.records.map((record, index) => ({
          record,
          primitive:
            index < 2 ? axis([0, 0, 0], [2, 0, 0]) : axis([0, 6, 0], [2, 6, 0]),
        })),
      },
      {
        geometry: {
          kind: "line",
          start: [0, 0, 0],
          direction: [0, 0, 0],
          length: 0,
        },
        state: { completionWord: 9 },
      },
    );
    expect(result.geometry).toEqual({
      kind: "line",
      start: [0, 2, 0],
      direction: [1, 0, 0],
      length: 2,
    });
    expect(result.diagnostics.contributingRecords).toBe(3);
    expect(result.diagnostics.sourceCount).toBe(2);
  });

  it("does not infer a nonempty common source set from retained records", () => {
    const definition = lineDefinition("average", []);
    if (definition.kind !== "line") throw new Error("Expected line");
    const result = evaluateReferenceConstruction(
      definition,
      {
        kind: "line",
        records: definition.records.map((record) => ({
          record,
          primitive: axis([0, 8, 0], [2, 8, 0]),
        })),
      },
      lineState(),
    );
    expect(result.geometry).toEqual({
      kind: "line",
      start: [1, 2, 3],
      direction: [1, 0, 0],
      length: 8,
    });
    expect(result.outcome).toBe("fallback");
    expect(result.diagnostics.contributingRecords).toBe(0);
  });

  it("distinguishes missing line objects from unsuccessful primitive extraction", () => {
    const definition = lineDefinition();
    if (definition.kind !== "line") throw new Error("Expected line");
    const evaluate = (missing: boolean) =>
      evaluateReferenceConstruction(
        definition,
        {
          kind: "line",
          records: [
            { record: definition.records[0], primitive: point([1, 0, 0]) },
            {
              record: definition.records[1],
              primitive: { kind: "unavailable", objectResolved: !missing },
            },
          ],
        },
        lineState(),
      );
    expect(evaluate(true).geometry).toEqual({
      kind: "line",
      start: [1, 2, 3],
      direction: [1, 0, 0],
      length: 8,
    });
    expect(evaluate(false).geometry).toEqual(lineState().geometry);
    expect(evaluate(true).outcome).toBe("fallback");
    expect(evaluate(false).outcome).toBe("unchanged");
  });

  it("short-circuits disabled evaluation without requiring a resolved bundle", () => {
    for (const [definition, prior] of [
      [pointDefinition(), pointState()],
      [lineDefinition(), lineState()],
    ] as const) {
      const result = evaluateReferenceConstruction(
        definition,
        undefined,
        prior,
        false,
      );
      expect(result.geometry).toEqual(prior.geometry);
      expect(result.geometry).not.toBe(prior.geometry);
      expect(result.state).toEqual(prior.state);
      expect(result.state).not.toBe(prior.state);
    }
  });

  it.each([new String("axis"), { toString: () => "axis" }])(
    "rejects coerced primitive kinds %#",
    (kind) => {
      const definition = lineDefinition("average");
      if (definition.kind !== "line") throw new Error("Expected line");
      const inputs = {
        kind: "line",
        records: definition.records.map((record) => ({
          record,
          primitive: { kind, start: [0, 0, 0], end: [2, 0, 0] },
        })),
      };
      expect(() =>
        evaluateReferenceConstruction(definition, inputs, lineState()),
      ).toThrow(/resolved reference construction/i);
    },
  );

  it.each([
    undefined,
    { kind: "line", records: [] },
    { kind: "point", sources: [] },
    { kind: "point", sources: new Array(2) },
    {
      kind: "point",
      sources: [
        { source: b, primitive: point([0, 0, 0]) },
        { source: a, primitive: point([0, 0, 0]) },
      ],
    },
    {
      kind: "point",
      sources: [
        {
          source: { ...a, constructionOrderKey: "03".repeat(16) },
          primitive: point([0, 0, 0]),
        },
        { source: b, primitive: point([0, 0, 0]) },
      ],
    },
  ])("rejects incomplete or stale point bindings %#", (input) => {
    expect(() =>
      evaluateReferenceConstruction(pointDefinition(), input, pointState()),
    ).toThrow(/resolved reference construction/i);
  });

  it.each(["id", "pick", "signedZero", "storage", "count"])(
    "rejects changed line record binding: %s",
    (change) => {
      const definition = lineDefinition(
        "pair",
        [a, b],
        [pick("b", -0), pick("a")],
      );
      if (definition.kind !== "line") throw new Error("Expected line");
      const records = definition.records.map((record) => ({
        record: structuredClone(record),
        primitive: point([1, 2, 3]),
      }));
      const changed =
        change === "count"
          ? records.slice(0, 1)
          : [
              {
                ...records[0],
                record: {
                  ...records[0].record,
                  ...(change === "id" ? { entityId: "other" } : {}),
                  ...(change === "storage" ? { storage: "world" } : {}),
                  ...(change === "pick" ? { coordinates: [1, 0, 0] } : {}),
                  ...(change === "signedZero"
                    ? { coordinates: [0, 0, 0] }
                    : {}),
                },
              },
              records[1],
            ];
      expect(() =>
        evaluateReferenceConstruction(
          definition,
          { kind: "line", records: changed },
          lineState(),
        ),
      ).toThrow(/resolved reference construction/i);
    },
  );

  it.each([-1, 65536, 0.5, NaN])(
    "rejects invalid internal completion word %s",
    (completionWord) => {
      const prior = { ...pointState(), state: { completionWord } };
      expect(() =>
        evaluateReferenceConstruction(
          pointDefinition(),
          undefined,
          prior,
          false,
        ),
      ).toThrow(/reference construction state/i);
      expect(() =>
        applyReferenceConstructionNumericInputs(pointDefinition(), prior),
      ).toThrow(/reference construction state/i);
    },
  );

  it("rejects kind disagreement and invalid evaluation guard", () => {
    expect(() =>
      evaluateReferenceConstruction(
        pointDefinition(),
        undefined,
        lineState(),
        false,
      ),
    ).toThrow(/reference construction state/i);
    expect(() =>
      evaluateReferenceConstruction(
        pointDefinition(),
        undefined,
        pointState(),
        0 as unknown as boolean,
      ),
    ).toThrow(/reference construction guard/i);
  });
});
