import { describe, expect, it } from "vitest";
import { resolveSketchConstructionPick } from "../src/reference-construction-resolver";

const frame = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
] as const;
const snapshot = () => ({
  id: "sketch",
  frame,
  children: [
    { id: "empty", records: undefined },
    {
      id: "curve",
      records: [
        [1, 2, 3],
        [4, 5, 6],
      ] as [number, number, number][],
    },
  ],
});
const selection = () => ({
  sourceId: "sketch",
  childId: "curve",
  recordIndex: 1,
});

describe("shared selected-sketch construction resolver", () => {
  it("binds an exact child and record to the retained object pick", () => {
    const result = resolveSketchConstructionPick(snapshot(), selection());
    expect(result).toEqual({
      selection: selection(),
      record: {
        entityId: "sketch",
        storage: "native-pick-record-f32",
        coordinates: [4, 5, 6],
      },
      primitive: { kind: "point", position: [4, 5, 6], objectResolved: true },
    });
  });

  it("uses owner placement and preserves source precision in the evaluated point", () => {
    const source = snapshot();
    source.children[1].records![1] = [1 + 2 ** -40, 0, 0];
    const result = resolveSketchConstructionPick(
      {
        ...source,
        frame: [
          [0, -1, 0, 10],
          [1, 0, 0, 0],
          [0, 0, 1, 0],
        ],
      },
      selection(),
    );
    expect(result.record.coordinates).toEqual([10, 1, 0]);
    expect(result.primitive).toEqual({
      kind: "point",
      position: [10, 1 + 2 ** -40, 0],
      objectResolved: true,
    });
  });

  it("resolves the rounded pick against all children rather than forcing the selected record", () => {
    const source = {
      id: "sketch",
      frame: [[1, 0, 0, -16777216], frame[1], frame[2]] as const,
      children: [
        { id: "curve", records: [[16777217, 0, 0]] as const },
        { id: "other", records: [[16777216, 0, 0]] as const },
      ],
    };
    const result = resolveSketchConstructionPick(source, {
      ...selection(),
      recordIndex: 0,
    });
    expect(result.selection.childId).toBe("curve");
    expect(result.record.coordinates).toEqual([0, 0, 0]);
    expect(result.primitive).toEqual({
      kind: "point",
      position: [0, 0, 0],
      objectResolved: true,
    });
  });

  it("does not sort child identities or deduplicate equal-distance records", () => {
    const source = {
      id: "sketch",
      frame,
      children: [
        { id: "z", records: [[1 - 2 ** -26, 0, 0]] as const },
        { id: "a", records: [[1 + 2 ** -26, 0, 0]] as const },
      ],
    };
    const result = resolveSketchConstructionPick(source, {
      ...selection(),
      childId: "a",
      recordIndex: 0,
    });
    expect(result.primitive).toEqual({
      kind: "point",
      position: [1 - 2 ** -26, 0, 0],
      objectResolved: true,
    });
  });

  it("detaches results and preserves exact arbitrary identities", () => {
    const source = snapshot();
    source.id = "legacy\ud800";
    source.children[1].id = "";
    const selected = { sourceId: source.id, childId: "", recordIndex: 0 };
    const result = resolveSketchConstructionPick(source, selected);
    selected.childId = "changed";
    source.children[1].records![0][0] = 999;
    expect(result.selection.childId).toBe("");
    expect(result.record.entityId).toBe("legacy\ud800");
    expect(result.record.coordinates).toEqual([1, 2, 3]);
    expect(result.primitive).toEqual({
      kind: "point",
      position: [1, 2, 3],
      objectResolved: true,
    });
  });

  it("rejects a stale owner or missing child without selecting another record", () => {
    expect(() =>
      resolveSketchConstructionPick(snapshot(), {
        ...selection(),
        sourceId: "other",
      }),
    ).toThrow(/source/i);
    expect(() =>
      resolveSketchConstructionPick(snapshot(), {
        ...selection(),
        childId: "absent",
      }),
    ).toThrow(/child/i);
  });

  it("rejects ambiguous child identities even outside the selected child", () => {
    const source = snapshot();
    source.children.push({ id: "empty", records: [] });
    expect(() => resolveSketchConstructionPick(source, selection())).toThrow(
      /identity/i,
    );
  });

  it.each([-1, 0.5, 2, Number.MAX_SAFE_INTEGER])(
    "rejects an invalid record index %s",
    (recordIndex) => {
      expect(() =>
        resolveSketchConstructionPick(snapshot(), {
          ...selection(),
          recordIndex,
        }),
      ).toThrow(/record/i);
    },
  );

  it("rejects a missing record collection and validates unselected records", () => {
    expect(() =>
      resolveSketchConstructionPick(snapshot(), {
        ...selection(),
        childId: "empty",
      }),
    ).toThrow(/record/i);
    const source = snapshot();
    source.children[1].records![0] = [NaN, 0, 0];
    expect(() => resolveSketchConstructionPick(source, selection())).toThrow(
      /finite/i,
    );
  });
});
