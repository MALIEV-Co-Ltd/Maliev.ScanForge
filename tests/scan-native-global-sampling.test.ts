import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-spatial-sample-native.json";
import {
  NativeGlobalRandom,
  nativeGlobalSpatialSamples,
} from "../src/scan-native-global-sampling";
interface Case {
  name: string;
  counts: number[];
  flags: number[];
  initial?: number[][];
  budget: number;
  clockInputs: number[];
  total: number;
  selections: number[][];
}
it.each(fixture.cases as Case[])(
  "matches original spatial sampling: $name",
  (c) => {
    let first = 0,
      clocks = 0;
    const cells = c.counts.map((count, i) => {
      const points = Array.from({ length: count }, (_, j) => first + j);
      first += count;
      return { points, flags: c.flags[i], selected: c.initial?.[i] };
    });
    const result = nativeGlobalSpatialSamples(
      cells,
      c.budget,
      () => c.clockInputs[clocks++],
    );
    expect(result).toEqual({ total: c.total, selections: c.selections });
    expect(clocks).toBe(c.clockInputs.length);
  },
);
it.each(fixture.randomCases)(
  "matches original CRT sequence for seed $seed",
  (c) => {
    const random = new NativeGlobalRandom(c.seed);
    expect(c.raw.map(() => random.next())).toEqual(c.raw);
  },
);
it.each(fixture.randomCases)(
  "matches original scaled random helper for seed $seed",
  (c) => {
    const random = new NativeGlobalRandom(c.seed);
    expect(c.maximum.map((max) => random.scaled(max))).toEqual(c.scaled);
  },
);
it("rejects invalid private sampling inputs", () => {
  expect(() => nativeGlobalSpatialSamples([], 0, () => 1)).toThrow();
  expect(() =>
    nativeGlobalSpatialSamples([{ points: [-1], flags: 1 }], 1, () => 1),
  ).toThrow();
  expect(() =>
    nativeGlobalSpatialSamples([{ points: [0, 1], flags: 1 }], 1, () => NaN),
  ).toThrow();
});
