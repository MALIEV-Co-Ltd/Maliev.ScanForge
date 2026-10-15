import { describe, expect, it } from "vitest";
import fixture from "./fixtures/global-fine-crt-native.json";
import { nativeFiniteFma } from "../src/scan-native-fma";
import {
  nativeGlobalSine,
  nativeGlobalCosine,
} from "../src/scan-native-global-trig";
import { nativeGlobalAtan2 } from "../src/scan-native-global-atan";
function value(hex: string) {
  return Buffer.from(hex, "hex").readDoubleLE();
}
function bits(n: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(n);
  return buffer.toString("hex");
}
describe("original CRT finite fused arithmetic", () => {
  for (const [i, trial] of fixture.fma.entries())
    it(`matches fused result ${i}`, () => {
      expect(
        bits(
          nativeFiniteFma(
            value(trial.args[0]),
            value(trial.args[1]),
            value(trial.args[2]),
          ),
        ),
      ).toBe(trial.value);
    });
});
describe("original finite alignment atan2", () => {
  for (const [i, trial] of fixture.atan2.entries())
    it(`matches atan2 ${i}`, () => {
      expect(
        bits(nativeGlobalAtan2(value(trial.args[0]), value(trial.args[1]))),
      ).toBe(trial.value);
    });
});
describe("original bounded alignment trigonometry", () => {
  for (const [i, trial] of fixture.trig.entries())
    it(`matches sine and cosine ${i}`, () => {
      expect(bits(nativeGlobalSine(value(trial.angle)))).toBe(trial.sin);
      expect(bits(nativeGlobalCosine(value(trial.angle)))).toBe(trial.cos);
    });
});

it("rejects inputs outside the verified private numeric domains", () => {
  expect(() => nativeFiniteFma(Infinity, 1, 0)).toThrow();
  expect(() => nativeGlobalAtan2(NaN, 1)).toThrow();
  expect(() => nativeGlobalSine(Math.PI)).toThrow();
  expect(() => nativeGlobalCosine(Infinity)).toThrow();
});
