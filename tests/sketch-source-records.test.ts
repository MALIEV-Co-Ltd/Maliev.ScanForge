import { describe, expect, it } from "vitest";
import {
  copySketchSourceRecordStore,
  encodeSketchSourceRecordStore,
  decodeSketchSourceRecordStore,
  spliceSketchSourceChildren,
  SKETCH_SOURCE_LIMITS,
  type SketchSourceRecordStore,
} from "../src/sketch-source-records";
import { resolveSketchConstructionPick } from "../src/reference-construction-resolver";

const source = (): SketchSourceRecordStore => ({
  version: 1,
  id: "owner\ud800",
  frame: [
    [1, -0, 0, 10],
    [0, 1, 0, -0],
    [0, 0, 1, 0],
  ],
  children: [
    {
      id: "z",
      kind: "arc",
      records: [
        [1, 0, 0],
        [0, 1 + 2 ** -40, -0],
        [-1, 0, 0],
        [0, 0, 0],
      ],
    },
    {
      id: "a",
      kind: "circle",
      records: [
        [3, 0, 0],
        [2, 1, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    },
    { id: "", kind: "spline", records: undefined },
    { id: "empty", kind: "line", records: [] },
    {
      id: "ellipse",
      kind: "ellipse",
      records: [
        [-2, 0, 0],
        [2, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 0],
      ],
    },
  ],
});

describe("ordered sketch source records", () => {
  it("round-trips exact frame and records through JSON without changing order or signed zero", () => {
    const original = source();
    const restored = decodeSketchSourceRecordStore(
      JSON.parse(JSON.stringify(encodeSketchSourceRecordStore(original))),
    );
    expect(restored).toEqual(original);
    expect(Object.is(restored.frame[0][1], -0)).toBe(true);
    expect(Object.is(restored.children[0].records![1][2], -0)).toBe(true);
    expect(restored.children[0].records![1][1]).toBe(1 + 2 ** -40);
    expect(restored.children.map((child) => child.id)).toEqual([
      "z",
      "a",
      "",
      "empty",
      "ellipse",
    ]);
  });

  it("keeps absent source collections distinct from empty and incomplete collections", () => {
    const original = source();
    const incomplete = {
      ...original,
      children: [
        ...original.children,
        {
          id: "incomplete",
          kind: "ellipse" as const,
          records: [[1, 2, 0] as const],
        },
      ],
    };
    const restored = decodeSketchSourceRecordStore(
      encodeSketchSourceRecordStore(incomplete),
    );
    expect(restored.children[2].records).toBeUndefined();
    expect(restored.children[3].records).toEqual([]);
    expect(restored.children[5].records).toEqual([[1, 2, 0]]);
  });

  it("detaches frame, child list and every point when copying and decoding", () => {
    const original = structuredClone(source());
    const copied = copySketchSourceRecordStore(original);
    const encoded = encodeSketchSourceRecordStore(original);
    const restored = decodeSketchSourceRecordStore(encoded);
    (original.frame[0] as unknown as number[])[3] = 999;
    (original.children[0].records![1] as unknown as number[])[1] = 999;
    (original.children as unknown[]).pop();
    encoded.children[0].id = "changed";
    expect(copied).toEqual(source());
    expect(restored).toEqual(source());
  });

  it("feeds retained middle and center records to the existing shared resolver after reload", () => {
    const original = source();
    const restored = decodeSketchSourceRecordStore(
      JSON.parse(
        JSON.stringify(
          encodeSketchSourceRecordStore({
            ...original,
            children: original.children.slice(0, 2),
          }),
        ),
      ),
    );
    const middle = resolveSketchConstructionPick(restored, {
      sourceId: restored.id,
      childId: "z",
      recordIndex: 1,
    });
    expect(middle.record.coordinates).toEqual([10, 1, 0]);
    expect(middle.primitive).toEqual({
      kind: "point",
      position: [10, 1 + 2 ** -40, 0],
      objectResolved: true,
    });
    const center = resolveSketchConstructionPick(restored, {
      sourceId: restored.id,
      childId: "a",
      recordIndex: 3,
    });
    expect(center.primitive).toEqual({
      kind: "point",
      position: [12, 0, 0],
      objectResolved: true,
    });
  });

  it("preserves records even when another child wins nearest resolution after pick rounding", () => {
    const restored = decodeSketchSourceRecordStore(
      encodeSketchSourceRecordStore(source()),
    );
    const result = resolveSketchConstructionPick(restored, {
      sourceId: restored.id,
      childId: "z",
      recordIndex: 1,
    });
    expect(result.selection.childId).toBe("z");
    expect(restored.children[0].records![1][1]).toBe(1 + 2 ** -40);
    expect(result.primitive).toEqual({
      kind: "point",
      position: [10, 1, 0],
      objectResolved: true,
    });
  });

  it("preserves first-child ties across save/reopen and explicit child replacement", () => {
    const original = {
      ...source(),
      children: [
        {
          id: "z",
          kind: "line" as const,
          records: [[1 - 2 ** -26, 0, 0] as const],
        },
        {
          id: "a",
          kind: "line" as const,
          records: [[1 + 2 ** -26, 0, 0] as const],
        },
      ],
    };
    const replaced = spliceSketchSourceChildren(original, 1, 1, [
      original.children[1],
    ]);
    const restored = decodeSketchSourceRecordStore(
      encodeSketchSourceRecordStore(replaced),
    );
    expect(
      resolveSketchConstructionPick(restored, {
        sourceId: restored.id,
        childId: "a",
        recordIndex: 0,
      }).primitive,
    ).toEqual({
      kind: "point",
      position: [11 - 2 ** -26, 0, 0],
      objectResolved: true,
    });
  });

  it("replaces complete child records in place without retaining stale middle/center records", () => {
    const original = source();
    const replacement = {
      id: "z",
      kind: "arc" as const,
      records: [[4, 5, 0] as const],
    };
    const changed = spliceSketchSourceChildren(original, 0, 1, [replacement]);
    expect(changed.children[0]).toEqual(replacement);
    expect(changed.children.slice(1)).toEqual(original.children.slice(1));
    expect(original).toEqual(source());
    expect(() =>
      resolveSketchConstructionPick(changed, {
        sourceId: changed.id,
        childId: "z",
        recordIndex: 1,
      }),
    ).toThrow(/record/i);
    (replacement.records as unknown[]).push([999, 999, 0]);
    expect(changed.children[0].records).toHaveLength(1);
  });

  it("inserts and deletes in owner order and leaves earlier snapshots usable for history", () => {
    const original = source();
    const inserted = spliceSketchSourceChildren(original, 1, 0, [
      { id: "new", kind: "line", records: [[9, 8, 0]] },
    ]);
    expect(inserted.children.map((child) => child.id)).toEqual([
      "z",
      "new",
      "a",
      "",
      "empty",
      "ellipse",
    ]);
    const removed = spliceSketchSourceChildren(inserted, 0, 2, []);
    expect(removed.children.map((child) => child.id)).toEqual([
      "a",
      "",
      "empty",
      "ellipse",
    ]);
    expect(original).toEqual(source());
    expect(inserted.children[0]).not.toBe(original.children[0]);
  });

  it("fails an invalid replacement atomically", () => {
    const original = source();
    expect(() =>
      spliceSketchSourceChildren(original, 0, 1, [original.children[1]]),
    ).toThrow(/duplicate/i);
    expect(() =>
      spliceSketchSourceChildren(original, 0, 1, [
        { id: "new", kind: "line", records: [[NaN, 0, 0]] },
      ]),
    ).toThrow(/finite/i);
    expect(original).toEqual(source());
  });

  it.each([
    [-1, 0],
    [0.5, 0],
    [6, 0],
    [0, -1],
    [0, 0.5],
    [4, 2],
    [NaN, 0],
    [0, Infinity],
  ])("rejects invalid splice bounds %s/%s", (index, count) => {
    expect(() =>
      spliceSketchSourceChildren(source(), index, count, []),
    ).toThrow(/range/i);
  });

  it.each([
    { version: 2 },
    { id: 1 },
    { frame: [[1, 0, 0, 0]] },
    {
      frame: [
        [1, 0, 0, Infinity],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
      ],
    },
    { children: [{ id: "child", kind: "group", records: [] }] },
    { children: [{ id: "child", kind: "arc", records: [[1, 2]] }] },
    { children: [{ id: "child", kind: "arc", records: [["1", 2, 3]] }] },
    { children: [{ id: "child", kind: "arc", records: null }] },
    {
      children: [
        { id: "child", kind: "arc", records: [] },
        { id: "child", kind: "line", records: [] },
      ],
    },
  ])("rejects malformed canonical records: %j", (patch) => {
    expect(() =>
      copySketchSourceRecordStore({ ...source(), ...patch }),
    ).toThrow();
  });

  it("rejects sparse child, record, coordinate and frame arrays", () => {
    for (const mutate of [
      (s: any) => {
        delete s.children[0];
      },
      (s: any) => {
        delete s.children[0].records[0];
      },
      (s: any) => {
        delete s.children[0].records[0][0];
      },
      (s: any) => {
        delete s.frame[0];
      },
      (s: any) => {
        delete s.frame[0][0];
      },
    ]) {
      const original = source();
      mutate(original);
      expect(() => copySketchSourceRecordStore(original)).toThrow();
    }
  });

  it("rejects unknown fields instead of silently discarding future curve definitions", () => {
    expect(() =>
      copySketchSourceRecordStore({ ...source(), constraints: [] }),
    ).toThrow(/field/i);
    expect(() =>
      copySketchSourceRecordStore({
        ...source(),
        children: [{ ...source().children[0], poles: [] }],
      }),
    ).toThrow(/field/i);
  });

  it("rejects malformed encoded numeric bytes, including nonfinite f64", () => {
    for (const bits of [
      "0",
      "GG".repeat(24),
      "000000000000f07f" + "0".repeat(32),
      "0".repeat(46),
    ]) {
      const encoded = encodeSketchSourceRecordStore(source());
      encoded.children[0].recordsBits = bits;
      expect(() => decodeSketchSourceRecordStore(encoded)).toThrow();
    }
    const encoded = encodeSketchSourceRecordStore(source());
    encoded.frameBits = encoded.frameBits.slice(2);
    expect(() => decodeSketchSourceRecordStore(encoded)).toThrow();
  });

  it("requires the encoded version, child kind, identity and explicit collection state", () => {
    const encoded = encodeSketchSourceRecordStore(source());
    for (const patch of [
      { version: 2 },
      { id: null },
      { frameBits: null },
      { extra: true },
    ]) {
      expect(() =>
        decodeSketchSourceRecordStore({ ...encoded, ...patch }),
      ).toThrow();
    }
    for (const patch of [
      { kind: "group" },
      { id: 1 },
      { recordsBits: undefined },
      { recordsBits: 1 },
      { poles: [] },
    ]) {
      expect(() =>
        decodeSketchSourceRecordStore({
          ...encoded,
          children: [{ ...encoded.children[0], ...patch }],
        }),
      ).toThrow();
    }
  });

  it("enforces aggregate record and child budgets, including encoded input and atomic replacement", () => {
    const records = Array.from(
      { length: SKETCH_SOURCE_LIMITS.records },
      () => [1, 2, 0] as const,
    );
    const atLimit = {
      ...source(),
      children: [{ id: "spline", kind: "spline" as const, records }],
    };
    expect(
      copySketchSourceRecordStore(atLimit).children[0].records,
    ).toHaveLength(records.length);
    const overflow = {
      ...atLimit,
      children: [
        ...atLimit.children,
        { id: "extra", kind: "line" as const, records: [[1, 2, 0] as const] },
      ],
    };
    expect(() => copySketchSourceRecordStore(overflow)).toThrow(/budget/i);
    expect(() =>
      spliceSketchSourceChildren(atLimit, 1, 0, [overflow.children[1]]),
    ).toThrow(/budget/i);
    const encoded = encodeSketchSourceRecordStore(atLimit);
    encoded.children.push({
      id: "extra",
      kind: "line",
      recordsBits: "0".repeat(48),
    });
    expect(() => decodeSketchSourceRecordStore(encoded)).toThrow(/budget/i);
    const children = Array.from(
      { length: SKETCH_SOURCE_LIMITS.children + 1 },
      (_, index) => ({ id: String(index), kind: "line", records: [] }),
    );
    expect(() =>
      copySketchSourceRecordStore({ ...source(), children }),
    ).toThrow(/budget/i);
  });
});
