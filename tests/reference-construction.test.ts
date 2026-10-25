import { describe, expect, it } from "vitest";
import {
  copyReferenceConstruction,
  decodeReferenceConstruction,
  encodeReferenceConstruction,
} from "../src/reference-construction";

const a = { id: "", constructionOrderKey: "01".repeat(16) };
const b = { id: "__proto__", constructionOrderKey: "02".repeat(16) };
const record = (entityId = b.id, coordinates = [-0, 2 ** -149, 16777216]) => ({
  entityId,
  storage: "native-pick-record-f32",
  coordinates,
});
const definitions = [
  {
    version: 1,
    kind: "point",
    mode: "coordinates",
    sources: [a, b],
    position: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
  },
  ...["center", "pair", "threePlanes"].map((mode) => ({
    version: 1,
    kind: "point",
    mode,
    sources: [a, b],
  })),
  {
    version: 1,
    kind: "line",
    mode: "endpoints",
    sources: [a],
    records: [record()],
    start: [-0, 1, 2],
    end: [-0, 1, 2],
  },
  ...["pair", "average"].map((mode) => ({
    version: 1,
    kind: "line",
    mode,
    sources: [a, b],
    records: [record(), record(a.id), record()],
  })),
];

describe("versioned reference construction storage", () => {
  it.each(definitions)(
    "copies and losslessly JSON-round-trips $kind/$mode",
    (input) => {
      const canonical = copyReferenceConstruction(input);
      expect(canonical).toEqual(input);
      expect(
        decodeReferenceConstruction(
          JSON.parse(JSON.stringify(encodeReferenceConstruction(canonical))),
        ),
      ).toEqual(input);
    },
  );

  it("retains record order, duplicates and identities absent from the common source set", () => {
    const input = {
      version: 1,
      kind: "line",
      mode: "pair",
      sources: [a],
      records: [record(b.id), record(a.id), record(b.id)],
    };
    const copy = copyReferenceConstruction(input);
    expect(copy).toEqual(input);
    expect(copy).not.toBe(input);
    expect(copy.sources).not.toBe(input.sources);
    expect(copy.sources[0]).not.toBe(input.sources[0]);
    if (copy.kind !== "line") throw new Error("Expected line");
    expect(copy.records).not.toBe(input.records);
    expect(copy.records[0]).not.toBe(input.records[0]);
    expect(copy.records[0].coordinates).not.toBe(input.records[0].coordinates);
    input.records[0].coordinates[0] = 9;
    input.sources[0] = b;
    expect(copy.records[0].coordinates[0]).toBe(-0);
    expect(copy.sources[0]).toEqual(a);
  });

  it("stores Float32 records as XYZ little-endian bits rather than JSON numbers", () => {
    const encoded = encodeReferenceConstruction(
      copyReferenceConstruction({
        version: 1,
        kind: "line",
        mode: "average",
        sources: [],
        records: [record()],
      }),
    );
    expect(encoded).toEqual({
      version: 1,
      kind: "line",
      mode: "average",
      sources: [],
      records: [
        {
          entityId: b.id,
          storage: "native-pick-record-f32",
          bits: "00000080010000000000804b",
        },
      ],
    });
  });

  it("stores Float64 coordinates without quantization or signed-zero loss", () => {
    const encoded = encodeReferenceConstruction(
      copyReferenceConstruction({
        version: 1,
        kind: "point",
        mode: "coordinates",
        sources: [],
        position: [-0, 1, 2],
      }),
    );
    expect(encoded).toEqual({
      version: 1,
      kind: "point",
      mode: "coordinates",
      sources: [],
      positionBits: "0000000000000080000000000000f03f0000000000000040",
    });
  });

  it.each([0, 1, 2, 3, 4])(
    "preserves %i common sources without enforcing authoring cardinality",
    (count) => {
      const sources = Array.from({ length: count }, (_, i) => ({
        id: String(i),
        constructionOrderKey: (i + 1).toString(16).padStart(32, "0"),
      }));
      for (const mode of ["center", "pair", "threePlanes"]) {
        const input = { version: 1, kind: "point", mode, sources };
        expect(copyReferenceConstruction(input)).toEqual(input);
      }
      for (const mode of ["pair", "average"]) {
        const input = {
          version: 1,
          kind: "line",
          mode,
          sources,
          records: Array.from({ length: count }, () => record()),
        };
        expect(copyReferenceConstruction(input)).toEqual(input);
      }
    },
  );

  it("retains exact arbitrary UTF-16 IDs without scene lookup", () => {
    const sources = [
      "",
      "e\u0301",
      "é",
      "\ud800",
      "\ufffd",
      "a".repeat(250),
    ].map((id, i) => ({
      id,
      constructionOrderKey: (i + 1).toString(16).padStart(32, "0"),
    }));
    const input = { version: 1, kind: "point", mode: "pair", sources };
    expect(
      decodeReferenceConstruction(
        JSON.parse(
          JSON.stringify(
            encodeReferenceConstruction(copyReferenceConstruction(input)),
          ),
        ),
      ),
    ).toEqual(input);
  });

  it("distinguishes source-only and record-only edits with identical coordinate values", () => {
    const base = {
      version: 1,
      kind: "line",
      mode: "endpoints",
      sources: [a],
      records: [record(a.id)],
      start: [0, 0, 0],
      end: [1, 0, 0],
    };
    const encode = (value: unknown) =>
      JSON.stringify(
        encodeReferenceConstruction(copyReferenceConstruction(value)),
      );
    expect(encode(base)).not.toBe(encode({ ...base, sources: [b] }));
    expect(encode(base)).not.toBe(encode({ ...base, records: [record(b.id)] }));
  });

  it.each([
    null,
    {},
    { ...definitions[0], version: 2 },
    { ...definitions[0], kind: "mesh" },
    { ...definitions[0], mode: "picked" },
    { ...definitions[0], length: 4 },
    { ...definitions[0], completionWord: 256 },
    { ...definitions[0], sources: [b, a] },
    { ...definitions[0], sources: [a, a] },
    { ...definitions[0], sources: [a, { ...b, id: a.id }] },
    {
      ...definitions[0],
      sources: [a, { ...b, constructionOrderKey: a.constructionOrderKey }],
    },
    {
      ...definitions[0],
      sources: [{ ...a, constructionOrderKey: "F".repeat(32) }],
    },
    { ...definitions[0], sources: [{ ...a, extra: true }] },
    { ...definitions[0], sources: new Array(1) },
    { ...definitions[0], position: [0, Infinity, 0] },
    { ...definitions[0], position: new Array(3) },
    { ...definitions[4], records: new Array(1) },
    { ...definitions[4], records: [record(b.id, [0.1, 0, 0])] },
    { ...definitions[4], records: [record(b.id, [Number.MIN_VALUE, 0, 0])] },
    { ...definitions[4], records: [record(b.id, [Infinity, 0, 0])] },
    { ...definitions[4], records: [{ ...record(), storage: "world" }] },
    { ...definitions[4], records: [{ ...record(), space: "world" }] },
  ])("rejects malformed or ambiguous canonical storage %#", (value) => {
    expect(() => copyReferenceConstruction(value)).toThrow(
      /reference|construction/i,
    );
  });

  it.each([
    null,
    {},
    { version: 2, kind: "point", mode: "center", sources: [] },
    {
      version: 1,
      kind: "point",
      mode: "coordinates",
      sources: [],
      positionBits: "0".repeat(47),
    },
    {
      version: 1,
      kind: "point",
      mode: "coordinates",
      sources: [],
      positionBits: "000000000000f07f" + "0".repeat(32),
    },
    {
      version: 1,
      kind: "point",
      mode: "coordinates",
      sources: [],
      positionBits: "0".repeat(48),
      position: [0, 0, 0],
    },
    ...[
      "0".repeat(23),
      "G".repeat(24),
      "0000807f" + "0".repeat(16),
      "0000c07f" + "0".repeat(16),
    ].map((bits) => ({
      version: 1,
      kind: "line",
      mode: "pair",
      sources: [],
      records: [{ entityId: "", storage: "native-pick-record-f32", bits }],
    })),
  ])("rejects malformed persisted encoding %#", (value) => {
    expect(() => decodeReferenceConstruction(value)).toThrow(
      /reference|construction/i,
    );
  });
});
