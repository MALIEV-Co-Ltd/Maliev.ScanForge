import { describe, expect, it } from "vitest";
import { prepareFieldSymmetryMasks } from "../src/field-symmetry-masks";
import { deriveTriangleSymmetryTopology } from "../src/field-symmetry-topology";

const topology = {
  faceStatus: new Int8Array([0, 1, 2, -1]),
  mappedFaceCount: 4,
};
const partners = new Int32Array([1, 0, 2, 4, 3, -1]);
const positiveSide = { bits: new Uint8Array([0b010010]), bitCount: 6 };

describe("curvature-stage symmetry masks", () => {
  it.each([1, 2])(
    "builds face and changed unmasked vertex bits in mode %s",
    (mode) => {
      const result = prepareFieldSymmetryMasks(
        topology,
        partners,
        positiveSide,
        {
          mode,
          requireComplete: true,
        },
      );
      expect(result.enabled).toBe(true);
      expect(result.faces).toEqual({ bits: new Uint8Array([1]), bitCount: 4 });
      expect(result.vertices).toEqual({
        bits: new Uint8Array([9]),
        bitCount: 6,
      });
      expect(result.maskedFaceCount).toBe(1);
      expect(positiveSide.bits[0]).toBe(18);
    },
  );

  it("clears faces but preserves the prior vertex mask when the complete gate fails", () => {
    const previous = { bits: new Uint8Array([5]), bitCount: 3 };
    for (const mappedFaceCount of [3, 5]) {
      const result = prepareFieldSymmetryMasks(
        { ...topology, mappedFaceCount },
        partners,
        positiveSide,
        { mode: 1, requireComplete: true, previousVertices: previous },
      );
      expect(result.enabled).toBe(false);
      expect(result.faces.bits).toEqual(new Uint8Array([0]));
      expect(result.maskedFaceCount).toBe(0);
      expect(result.vertices).toEqual(previous);
      expect(result.vertices.bits).not.toBe(previous.bits);
    }
  });

  it("allows incomplete mappings when the complete requirement is disabled", () => {
    const result = prepareFieldSymmetryMasks(
      { ...topology, mappedFaceCount: 0 },
      partners,
      positiveSide,
      { mode: 2, requireComplete: false },
    );
    expect(result.enabled).toBe(true);
    expect(result.vertices.bits[0]).toBe(9);
  });

  it.each([-1, 0, 3, 2147483647])(
    "skips masks outside the two enabled modes: %s",
    (mode) => {
      const result = prepareFieldSymmetryMasks(
        topology,
        partners,
        positiveSide,
        {
          mode,
          requireComplete: false,
        },
      );
      expect(result.enabled).toBe(false);
      expect(result.vertices.bitCount).toBe(0);
      expect(result.faces.bits[0]).toBe(0);
    },
  );

  it("uses geometry-derived face status and paired vertices across byte boundaries", () => {
    const triangles = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const mapping = new Int32Array([3, 4, 5, 0, 1, 2, 6, 8, 7]);
    const side = { bits: new Uint8Array([0b00111000, 1]), bitCount: 9 };
    const cache = deriveTriangleSymmetryTopology(triangles, mapping, side);
    const result = prepareFieldSymmetryMasks(cache, mapping, side, {
      mode: 1,
      requireComplete: true,
    });
    expect(cache.mappedFaceCount).toBe(3);
    expect(result.faces.bits[0]).toBe(1);
    expect(result.vertices.bits).toEqual(new Uint8Array([0b10000111, 0]));
    expect(result.maskedFaceCount).toBe(1);
  });

  it("treats vertices beyond a bounded side mask as unmasked and owns output storage", () => {
    const previous = { bits: new Uint8Array([255, 255]), bitCount: 12 };
    const result = prepareFieldSymmetryMasks(
      topology,
      partners,
      { bits: new Uint8Array([2]), bitCount: 2 },
      { mode: 1, requireComplete: true, previousVertices: previous },
    );
    expect(result.vertices.bits[0]).toBe(25);
    expect(result.vertices.bitCount).toBe(6);
    expect(previous.bits).toEqual(new Uint8Array([255, 255]));
  });

  it("accepts empty geometry and rejects malformed state", () => {
    const empty = prepareFieldSymmetryMasks(
      { faceStatus: new Int8Array(), mappedFaceCount: 0 },
      new Int32Array(),
      { bits: new Uint8Array(), bitCount: 0 },
      { mode: 1, requireComplete: true },
    );
    expect(empty.enabled).toBe(true);
    expect(empty.maskedFaceCount).toBe(0);
    const options = { mode: 1, requireComplete: true };
    expect(() =>
      prepareFieldSymmetryMasks(
        topology,
        new Int32Array([2]),
        positiveSide,
        options,
      ),
    ).toThrow();
    expect(() =>
      prepareFieldSymmetryMasks(
        topology,
        partners,
        { bits: new Uint8Array(), bitCount: 1 },
        options,
      ),
    ).toThrow();
    expect(() =>
      prepareFieldSymmetryMasks(
        { ...topology, mappedFaceCount: -1 },
        partners,
        positiveSide,
        options,
      ),
    ).toThrow();
    expect(() =>
      prepareFieldSymmetryMasks(topology, partners, positiveSide, {
        ...options,
        mode: 1.5,
      }),
    ).toThrow();
    expect(() =>
      prepareFieldSymmetryMasks(
        { ...topology, faceStatus: new Int8Array([3]) },
        partners,
        positiveSide,
        options,
      ),
    ).toThrow();
  });
});
