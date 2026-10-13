import { expect, it } from "vitest";
import {
  nativeRefineAlignmentParameters,
  nativeRefineAlignmentMatrix,
  nativeAlignmentParameters,
} from "../src/scan-native-alignment-refinement";
import type { Vec3 } from "../src/types";
import fixture from "./fixtures/alignment-paired-native.json";
import matrices from "./fixtures/alignment-refinement-matrix-native.json";

function bits(values: readonly number[]) {
  const buffer = new ArrayBuffer(values.length * 8);
  const view = new DataView(buffer);
  values.forEach((value, id) => view.setFloat64(id * 8, value, true));
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
it.each(matrices.cases)(
  "matches the complete original matrix refinement wrapper: $name",
  (capture) => {
    const before = JSON.stringify(capture);
    const parameters = nativeAlignmentParameters(capture.initial);
    expect(bits(parameters.slice(0, 4))).toBe(capture.quaternionBits);
    const result = nativeRefineAlignmentMatrix(
      capture.initial,
      capture.source as Vec3[],
      capture.target as Vec3[],
      {
        tolerance: capture.tolerance,
        budget: capture.budget,
      },
    );
    expect(bits(result.matrix)).toBe(capture.matrixBits);
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it.each(fixture.cases)(
  "matches the original paired callback and optimizer: $name",
  (capture) => {
    const before = JSON.stringify(capture);
    const trace: typeof capture.trace = [];
    const result = nativeRefineAlignmentParameters(
      capture.initial,
      capture.source as Vec3[],
      capture.target as Vec3[],
      {
        tolerance: capture.tolerance,
        budget: capture.budget,
        onEvaluation: (parameters, error) =>
          trace.push({
            parametersBits: bits(parameters),
            errorBits: bits([error]),
          }),
      },
    );
    expect(trace).toEqual(capture.trace);
    expect(trace[0].errorBits).toBe(capture.initialErrorBits);
    expect(result.status).toBe(capture.status);
    expect(bits(result.parameters)).toBe(capture.outputBits);
    expect(bits([result.error])).toBe(capture.errorBits);
    expect(JSON.stringify(capture)).toBe(before);
  },
);
it("protects search parameters from trace observer mutation", () => {
  const capture = fixture.cases[0];
  const result = nativeRefineAlignmentParameters(
    capture.initial,
    capture.source as Vec3[],
    capture.target as Vec3[],
    {
      budget: capture.budget,
      onEvaluation: (parameters) => (parameters as number[]).fill(100),
    },
  );
  expect(bits(result.parameters)).toBe(capture.outputBits);
});
it("checks cancellation between paired evaluations", () => {
  const capture = fixture.cases[0];
  const controller = new AbortController();
  let calls = 0;
  expect(() =>
    nativeRefineAlignmentParameters(
      capture.initial,
      capture.source as Vec3[],
      capture.target as Vec3[],
      {
        signal: controller.signal,
        onEvaluation: () => {
          if (++calls === 5) controller.abort();
        },
      },
    ),
  ).toThrow("cancelled");
  expect(calls).toBe(5);
});
it("rejects mismatched or nonrepresentable point inputs", () => {
  const capture = fixture.cases[0];
  expect(() =>
    nativeRefineAlignmentParameters(capture.initial, [], [[0, 0, 0]]),
  ).toThrow("paired");
  const source = capture.source.map((point) => point.slice()) as Vec3[];
  source[0][0] = 1e100;
  expect(() =>
    nativeRefineAlignmentParameters(
      capture.initial,
      source,
      capture.target as Vec3[],
    ),
  ).toThrow("Float32");
});
