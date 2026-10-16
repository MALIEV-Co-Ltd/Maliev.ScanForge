import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-target-choice-native.json";
import {
  nativeGlobalTargetChoice,
  type RawGlobalTarget,
  type EvaluatedGlobalTarget,
} from "../src/scan-native-global-target";
const maximum = Math.fround(3.4028234663852886e38);
const bits = (values: readonly number[]) =>
  Buffer.from(Float64Array.from(values).buffer).toString("hex");
interface Case {
  name: string;
  raw: {
    point: number[];
    normal: number[];
    flags: number;
    labelWord: number;
  } | null;
  evaluators: {
    distance: number;
    point?: number[];
    normal?: number[];
    edgeFlags?: number;
    neighbours?: number;
    miss?: boolean;
  }[];
  sourceLabelWord?: number;
  mask?: number;
  outputBits: string;
  normalBits: string;
}
it.each(fixture.cases as Case[])(
  "matches original target choice and boundary fallback: $name",
  (c) => {
    const raw: RawGlobalTarget | undefined = c.raw
      ? {
          ...c.raw,
          point: c.raw.point.map(Math.fround),
          normal: c.raw.normal.map(Math.fround),
        }
      : undefined;
    const candidates: EvaluatedGlobalTarget[] = c.evaluators.map((e) => ({
      point: e.point ?? [8, 7, 6],
      normal: (e.normal ?? [0.1, 0.2, 0.3]).map(Math.fround),
      signedDistance: e.distance,
      edgeFlags: e.edgeFlags ?? 0,
      neighbours: e.neighbours ?? 7,
      found: !e.miss,
    }));
    const result = nativeGlobalTargetChoice(
      [0, 0, 0],
      raw,
      candidates,
      c.sourceLabelWord ?? 0,
      c.mask ?? 0,
    );
    expect(bits(result?.point ?? [maximum, 0, 0])).toBe(c.outputBits);
    expect(bits(result?.normal ?? [91, 92, 93])).toBe(c.normalBits);
  },
);
it("retains supplied record identities and does not mutate raw or evaluator carriers", () => {
  const raw: RawGlobalTarget = {
    point: [1, 2, 3],
    normal: [0, 0, 1],
    flags: 0,
    labelWord: 0,
  };
  const candidate: EvaluatedGlobalTarget = {
    point: [3, 2, 1],
    normal: [0, 1, 0],
    signedDistance: 1,
    edgeFlags: 0,
    neighbours: 0,
    found: true,
  };
  const before = structuredClone([raw, candidate]);
  expect(nativeGlobalTargetChoice([0, 0, 0], raw, [candidate])).toBe(candidate);
  expect(nativeGlobalTargetChoice([0, 0, 0], raw, [])).toBe(raw);
  expect([raw, candidate]).toEqual(before);
});
