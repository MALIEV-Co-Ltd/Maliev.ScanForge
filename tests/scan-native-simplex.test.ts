import { expect, it } from "vitest";
import { nativeAlignmentSimplex } from "../src/scan-native-simplex";
import fixture from "./fixtures/alignment-simplex-native.json";

function bits(values: readonly number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(fixture.cases)(
  "matches every native simplex evaluation and result: $name",
  (capture) => {
    const trace: string[] = [];
    const before = capture.initial.slice();
    const result = nativeAlignmentSimplex(
      capture.initial,
      (parameters) => {
        trace.push(bits(parameters));
        let error = 0;
        parameters.forEach((value, axis) => {
          const delta = value - capture.target[axis];
          error +=
            capture.metric === "square"
              ? delta * delta
              : capture.metric === "absolute"
                ? Math.abs(delta)
                : 0;
        });
        return error;
      },
      capture.tolerance,
      capture.budget,
      capture.step,
    );
    expect(trace).toEqual(capture.trace);
    expect(result.status).toBe(capture.status);
    expect(bits(result.parameters)).toBe(capture.outputBits);
    expect(bits([result.error])).toBe(capture.errorBits);
    expect(capture.initial).toEqual(before);
  },
);
it("honors cancellation before evaluating an objective", () => {
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeAlignmentSimplex(
      [0],
      () => {
        throw new Error("must not run");
      },
      1e-4,
      1000,
      0.005,
      controller.signal,
    ),
  ).toThrow("cancelled");
});
it("rejects non-finite input and objective results", () => {
  expect(() => nativeAlignmentSimplex([NaN], () => 0)).toThrow("parameters");
  expect(() => nativeAlignmentSimplex([0], () => NaN)).toThrow("finite");
});
