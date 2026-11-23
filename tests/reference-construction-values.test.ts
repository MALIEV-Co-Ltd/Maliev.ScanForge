import { describe, expect, it } from "vitest";
import {
  copyReferenceGeometry,
  decodeReferenceGeometry,
  encodeReferenceGeometry,
  referenceLineEnd,
} from "../src/reference-construction-values";

describe("precise semantic reference values", () => {
  it("detaches point coordinates without converting them to Float32", () => {
    const input = {
      kind: "point",
      position: [-0, 1 + 2 ** -40, Number.MIN_VALUE],
    };
    const copy = copyReferenceGeometry(input);
    expect(copy).toEqual(input);
    expect(copy).not.toBe(input);
    if (copy.kind !== "point") throw new Error("Expected point");
    expect(copy.position).not.toBe(input.position);
    input.position[1] = 7;
    expect(copy.position[1]).toBe(1 + 2 ** -40);
  });

  it("retains stored line direction and length without normalizing them", () => {
    const input = Object.freeze({
      kind: "line",
      start: Object.freeze([-0, 2, 3]),
      direction: Object.freeze([2, -3, 0]),
      length: 4,
    });
    const copy = copyReferenceGeometry(input);
    expect(copy).toEqual(input);
    if (copy.kind !== "line") throw new Error("Expected line");
    expect(copy.start).not.toBe(input.start);
    expect(copy.direction).not.toBe(input.direction);
    expect(referenceLineEnd(copy)).toEqual([8, -10, 3]);
  });

  it("retains the native constructor's zero line and negative zero length", () => {
    const line = copyReferenceGeometry({
      kind: "line",
      start: [0, 0, 0],
      direction: [0, 0, 0],
      length: -0,
    });
    expect(line).toEqual({
      kind: "line",
      start: [0, 0, 0],
      direction: [0, 0, 0],
      length: -0,
    });
  });

  it.each([
    null,
    {},
    { kind: "mesh", position: [0, 0, 0] },
    { kind: "point", position: [0, 0] },
    { kind: "point", position: [0, 0, 0, 1] },
    { kind: "point", position: [0, "1", 0] },
    { kind: "point", position: [0, NaN, 0] },
    { kind: "point", position: [0, Infinity, 0] },
    { kind: "point", position: new Array(3) },
    { kind: "line", start: [0, 0, 0], direction: [1, 0, 0], length: -1 },
    { kind: "line", start: [0, 0, 0], direction: [1, 0, 0], length: Infinity },
    { kind: "line", start: [0, 0, 0], direction: [1, 0, 0] },
  ])("rejects malformed canonical geometry %#", (input) => {
    expect(() => copyReferenceGeometry(input)).toThrow(/reference/i);
  });

  it("rejects a finite line whose reconstructed endpoint overflows", () => {
    expect(() =>
      copyReferenceGeometry({
        kind: "line",
        start: [Number.MAX_VALUE, 0, 0],
        direction: [1, 0, 0],
        length: Number.MAX_VALUE,
      }),
    ).toThrow(/overflow/i);
  });

  it.each([
    { kind: "point", position: [-0, Number.MIN_VALUE, Number.MAX_VALUE] },
    {
      kind: "line",
      start: [-0, 1 + 2 ** -40, 3],
      direction: [0, -0, 2],
      length: Number.MIN_VALUE,
    },
    { kind: "line", start: [0, 0, 0], direction: [0, 0, 0], length: -0 },
  ])("survives a JSON round trip with identical Float64 values %#", (input) => {
    const canonical = copyReferenceGeometry(input);
    const encoded = encodeReferenceGeometry(canonical);
    expect(
      decodeReferenceGeometry(JSON.parse(JSON.stringify(encoded))),
    ).toEqual(canonical);
  });

  it("defines point bits as XYZ Float64 little-endian bytes", () => {
    expect(
      encodeReferenceGeometry({ kind: "point", position: [-0, 1, 2] }),
    ).toEqual({
      version: 1,
      kind: "point",
      bits: "0000000000000080000000000000f03f0000000000000040",
    });
  });

  it.each([
    null,
    { version: 2, kind: "point", bits: "0".repeat(48) },
    { version: 1, kind: "mesh", bits: "0".repeat(48) },
    { version: 1, kind: "point", bits: "0".repeat(47) },
    { version: 1, kind: "point", bits: "z".repeat(48) },
    { version: 1, kind: "line", bits: "0".repeat(48) },
    { version: 1, kind: "point", bits: "000000000000f07f" + "0".repeat(32) },
    { version: 1, kind: "point", bits: "000000000000f87f" + "0".repeat(32) },
    { version: 1, kind: "line", bits: "0".repeat(96) + "000000000000f0bf" },
  ])("rejects invalid or non-finite persisted values %#", (input) => {
    expect(() => decodeReferenceGeometry(input)).toThrow(/reference/i);
  });
});
