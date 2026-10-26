import { expect, it } from "vitest";
import { GridBits } from "../src/scan-reconstruction-grid";
import { samplePointReconstructionGrid } from "../src/scan-reconstruction-point-grid";

const start = [-2, -2, -2];
const dims = [7, 7, 7];
const noop = () => {};
function oracle(points: readonly number[], spacing = 1) {
  const bits = new Uint8Array(dims[0] * dims[1] * dims[2]);
  let represented = 0;
  for (let i = 0; i < points.length; i += 3) {
    let found = false;
    for (let z = 0; z < dims[2]; z++)
      for (let y = 0; y < dims[1]; y++)
        for (let x = 0; x < dims[0]; x++) {
          const d2 =
            (start[0] + x * spacing - points[i]) ** 2 +
            (start[1] + y * spacing - points[i + 1]) ** 2 +
            (start[2] + z * spacing - points[i + 2]) ** 2;
          if (d2 <= 0.75 * spacing * spacing) {
            bits[x + y * dims[0] + z * dims[0] * dims[1]] = 1;
            found = true;
          }
        }
    represented += Number(found);
  }
  return { bits, represented };
}
function unpack(bits: GridBits) {
  return Uint8Array.from({ length: bits.length }, (_, i) => bits.get(i));
}

it.each([
  [0, 0, 0],
  [0.5, 0.5, 0.5, 1.2, -0.3, 0.1],
  [0, 0, 0, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 1.25, 1.75, 0.25],
])(
  "matches a brute lattice oracle for %j without triangle grouping",
  (...points) => {
    const input = Float32Array.from(points);
    const before = input.slice();
    const actual = samplePointReconstructionGrid([input], start, dims, 1, noop);
    const expected = oracle(Array.from(input));
    expect(unpack(actual.occupancy)).toEqual(expected.bits);
    expect(actual.processedPoints).toBe(input.length / 3);
    expect(actual.representedPoints).toBe(expected.represented);
    expect(actual.shellPoints).toBe(
      expected.bits.reduce((sum, bit) => sum + bit, 0),
    );
    expect(actual.distanceTests).toBe(actual.candidates);
    expect(input).toEqual(before);
  },
);

it("includes all eight exact half-cell corners and preserves duplicate/permutation coverage", () => {
  const a = [0.5, 0.5, 0.5],
    b = [1, 1, 1];
  const first = samplePointReconstructionGrid(
    [[...a, ...b, ...a]],
    start,
    dims,
    1,
    noop,
  );
  const second = samplePointReconstructionGrid(
    [[...b], [...a, ...a]],
    start,
    dims,
    1,
    noop,
  );
  expect(first.occupancy.get(2 + 2 * 7 + 2 * 49)).toBe(1);
  expect(first.shellPoints).toBe(8);
  expect(first.processedPoints).toBe(3);
  expect(first.representedPoints).toBe(3);
  expect(unpack(second.occupancy)).toEqual(unpack(first.occupancy));
  expect(second.representedPoints).toBe(first.representedPoints);
  expect(second.processedPoints).toBe(first.processedPoints);
});

it.each([0.1, 1.25, 2])(
  "matches the independent oracle for irregular samples at spacing %s",
  (spacing) => {
    let seed = 9143;
    const points = Array.from({ length: 96 }, (_, i) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return start[i % 3] + (seed / 2 ** 32) * 6 * spacing;
    });
    const expected = oracle(points, spacing);
    const actual = samplePointReconstructionGrid(
      [points],
      start,
      dims,
      spacing,
      noop,
    );
    expect(unpack(actual.occupancy)).toEqual(expected.bits);
    expect(actual.representedPoints).toBe(expected.represented);
    expect(actual.processedPoints).toBe(32);
  },
);

it("reuses prior scratch and counts representation even when every point sample is already occupied", () => {
  const occupancy = new GridBits(343);
  occupancy.set(2 + 2 * 7 + 2 * 49);
  const prior = {
    occupancy,
    shellPoints: 1,
    distanceTests: 10,
    candidates: 20,
  };
  const result = samplePointReconstructionGrid(
    [[0, 0, 0, 0, 0, 0]],
    start,
    dims,
    1,
    noop,
    prior,
  );
  expect(result.occupancy).toBe(occupancy);
  expect(result.shellPoints).toBe(1);
  expect(result.processedPoints).toBe(2);
  expect(result.representedPoints).toBe(2);
  expect(result.distanceTests).toBe(12);
  expect(result.candidates).toBe(22);
  expect(prior.candidates).toBe(20);
});

it("enforces the shared candidate budget", () => {
  expect(() =>
    samplePointReconstructionGrid([[0, 0, 0]], start, dims, 1, noop, {
      occupancy: new GridBits(343),
      shellPoints: 0,
      distanceTests: 0,
      candidates: 500_000_000,
    }),
  ).toThrow(/work limit|sampling/i);
});

it.each([
  [1, 2],
  [NaN, 0, 0],
  [Infinity, 0, 0],
  [1e40, 0, 0],
])("rejects invalid point records %j", (...points) => {
  expect(() =>
    samplePointReconstructionGrid([points], start, dims, 1, noop),
  ).toThrow(/point|finite|coordinate/i);
});

it("rejects invalid metadata and oversized grids before allocation", () => {
  for (const spacing of [0, -1, NaN, Infinity, 1e-200, 1e200])
    expect(() =>
      samplePointReconstructionGrid([[0, 0, 0]], start, dims, spacing, noop),
    ).toThrow(/resolution/i);
  for (const dimensions of [
    [1e9, 2, 2],
    [0, 7, 7],
    [1.5, 7, 7],
    [7, 7],
    [NaN, 7, 7],
  ])
    expect(() =>
      samplePointReconstructionGrid([[0, 0, 0]], start, dimensions, 1, noop),
    ).toThrow(/grid|dimension/i);
  expect(() =>
    samplePointReconstructionGrid([[0, 0, 0]], [NaN, 0, 0], dims, 1, noop),
  ).toThrow(/origin|start/i);
  expect(() =>
    samplePointReconstructionGrid([[0, 0, 0]], start, dims, 1, noop, {
      occupancy: new GridBits(8),
      shellPoints: 0,
      distanceTests: 0,
      candidates: 0,
    }),
  ).toThrow(/prior|grid/i);
});

it("rejects oversized coordinate work before reading point data", () => {
  const points = new Proxy<number[]>([], {
    get(_target, key) {
      if (key === "length") return 500_000_001;
      throw Error("Coordinates must not be read");
    },
  });
  expect(() =>
    samplePointReconstructionGrid([points], start, dims, 1, noop),
  ).toThrow(/500 million/);
});

it("reports unrepresented points rather than silently counting them as covered", () => {
  const result = samplePointReconstructionGrid(
    [[100, 100, 100]],
    start,
    dims,
    1,
    noop,
  );
  expect(result.processedPoints).toBe(1);
  expect(result.representedPoints).toBe(0);
  expect(result.shellPoints).toBe(0);
});

it("allows progress callbacks to cancel validation and sampling", () => {
  const points = new Float32Array(3 * 4096);
  for (const cancelAt of ["Validating", "Sampling"]) {
    expect(() =>
      samplePointReconstructionGrid([points], start, dims, 1, (_f, stage) => {
        if (stage.includes(cancelAt))
          throw new DOMException("Cancelled", "AbortError");
      }),
    ).toThrow(/Cancelled/);
  }
});
