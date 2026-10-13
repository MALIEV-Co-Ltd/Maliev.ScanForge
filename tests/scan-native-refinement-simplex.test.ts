import { expect, it } from "vitest";
import { nativeRefinementSimplex } from "../src/scan-native-refinement-simplex";
import fixture from "./fixtures/alignment-six-optimizer-native.json";

function bits(values: readonly number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(fixture.cases)(
  "matches complete native optimizer trace and result: $name",
  (capture) => {
    const trace: { parametersBits: string; errorBits: string }[] = [];
    const result = nativeRefinementSimplex(
      capture.initial,
      (values) => {
        let error = 0;
        if (capture.kind === "constant") error = 1;
        else if (capture.kind === "linear")
          for (const value of values) error += value;
        else
          for (let id = 0; id < values.length; id++) {
            const difference = values[id] - capture.target[id];
            error +=
              difference *
              difference *
              (capture.kind === "anisotropic" ? id + 1 : 1);
          }
        trace.push({ parametersBits: bits(values), errorBits: bits([error]) });
        return error;
      },
      { budget: capture.budget, step: capture.step },
    );
    expect(trace).toEqual(
      capture.trace.map(({ parametersBits, errorBits }) => ({
        parametersBits,
        errorBits,
      })),
    );
    expect(bits(result.parameters)).toBe(capture.parametersBits);
    expect(bits([result.error])).toBe(capture.errorBits);
    expect(result.iterations).toBe(capture.iterations);
    expect(result.converged).toBe(capture.converged);
  },
);
it("protects inputs and search state from callback mutation", () => {
  const initial = [10, 11, 9, 1.5, 1.6, 1.7];
  const before = initial.slice();
  const pure = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value * value, 0);
  const expected = nativeRefinementSimplex(initial, pure, { budget: 12 });
  const actual = nativeRefinementSimplex(
    initial,
    (values) => {
      const value = pure(values);
      (values as number[]).fill(123);
      return value;
    },
    { budget: 12 },
  );
  expect(actual).toEqual(expected);
  expect(initial).toEqual(before);
});
it("honors cancellation and rejects nonfinite objectives or invalid inputs", () => {
  const initial = [10, 10, 10, 1, 1, 1];
  expect(() => nativeRefinementSimplex(initial, () => Infinity)).toThrow(
    "finite",
  );
  expect(() =>
    nativeRefinementSimplex(initial, () => 0, { signal: AbortSignal.abort() }),
  ).toThrow("cancelled");
  expect(() => nativeRefinementSimplex([1], () => 0)).toThrow("six-parameter");
  expect(() =>
    nativeRefinementSimplex(initial, () => 0, { budget: -1 }),
  ).toThrow("six-parameter");
});
