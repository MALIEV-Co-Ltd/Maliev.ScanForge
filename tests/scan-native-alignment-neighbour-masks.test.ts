import { expect, it, vi } from "vitest";
import native from "./fixtures/alignment-adjacency-global.json";
import { nativeBuildAlignmentNeighbourMasks } from "../src/scan-native-alignment-adjacency";

it.each(native.cases)("matches original boundary pointer flags: $name", (c) => {
  const expected = new Uint8Array(c.triangles.length / 3);
  c.neighbors.forEach((other, slot) => {
    if (other >= 0) expected[Math.floor(slot / 3)] |= 1 << (slot % 3);
  });
  expect(
    nativeBuildAlignmentNeighbourMasks(
      Float32Array.from(c.vertices.flat()),
      Uint32Array.from(c.triangles),
    ),
  ).toEqual(expected);
});

it("does not allocate full neighbor, edge or triangle-flag arrays for query masks", () => {
  const I32 = Int32Array,
    U8 = Uint8Array;
  const ints: number[] = [],
    bytes: number[] = [];
  class TrackedInt32 extends I32 {
    constructor(size: number) {
      super(size);
      ints.push(size);
    }
  }
  class TrackedUint8 extends U8 {
    constructor(size: number) {
      super(size);
      bytes.push(size);
    }
  }
  const faces = 37;
  const indices = Uint32Array.from({ length: faces * 3 }, (_, i) => i % 3);
  try {
    vi.stubGlobal("Int32Array", TrackedInt32);
    vi.stubGlobal("Uint8Array", TrackedUint8);
    const result = nativeBuildAlignmentNeighbourMasks(
      Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      indices,
    );
    expect(result.length).toBe(faces);
    expect(ints).not.toContain(indices.length);
    expect(bytes).not.toContain(indices.length);
    expect(bytes.filter((n) => n === faces)).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("cancels before allocating the per-face output and rejects invalid geometry", () => {
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    nativeBuildAlignmentNeighbourMasks(
      Float32Array.of(0, 0, 0),
      { length: 3000000 },
      { signal: abort.signal },
    ),
  ).toThrow(/cancelled/);
  expect(() =>
    nativeBuildAlignmentNeighbourMasks(new Float32Array(), new Uint32Array()),
  ).toThrow();
  expect(() =>
    nativeBuildAlignmentNeighbourMasks(
      Float32Array.of(0, 0, NaN),
      Uint32Array.of(0, 0, 0),
    ),
  ).toThrow();
  expect(() =>
    nativeBuildAlignmentNeighbourMasks(
      Float32Array.of(0, 0, 0),
      Uint32Array.of(0, 1, 0),
    ),
  ).toThrow();
});
