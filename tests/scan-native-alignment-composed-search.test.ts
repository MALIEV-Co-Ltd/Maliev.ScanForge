import { describe, expect, it, vi } from "vitest";
import native from "./fixtures/alignment-composed-search.json";
import { prepareNativeAlignmentSource } from "../src/scan-native-alignment-source";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";
import { nativeRefineAlignmentSurface } from "../src/scan-native-alignment-surface-search";

describe.each([false, true])("native CRT replay: %s", (capturedTrig) => {
  it.each(native.cases)(
    "matches prepared native source and target refinement: $name",
    (sample) => {
      const expected = sample.search;
      const source = prepareNativeAlignmentSource(
        {
          vertices: expected.sourcePoints.flat(),
          triangles: expected.sourceTriangles,
          flags: expected.sourcePoints.map(() => 4),
        },
        0,
        { selectionOnly: true },
      );
      expect(
        Array.from(new Uint8Array(source.normals.buffer), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      ).toBe(expected.sourceNormalBits);
      const target = prepareNativeAlignmentSurface(
        sample.vertices.flat(),
        sample.triangles,
      )!;
      const sine = new Map<number, number>(),
        cosine = new Map<number, number>();
      for (const step of expected.trace)
        step.angles.forEach((angle, index) => {
          sine.set(angle, step.sine[index]);
          cosine.set(angle, step.cosine[index]);
        });
      const originalSin = Math.sin,
        originalCos = Math.cos;
      const sinMock = capturedTrig
        ? vi
            .spyOn(Math, "sin")
            .mockImplementation(
              (angle) => sine.get(angle) ?? originalSin(angle),
            )
        : undefined;
      const cosMock = capturedTrig
        ? vi
            .spyOn(Math, "cos")
            .mockImplementation(
              (angle) => cosine.get(angle) ?? originalCos(angle),
            )
        : undefined;
      const trace: {
        parameters: readonly number[];
        error: number;
        best: number;
      }[] = [];
      try {
        const result = nativeRefineAlignmentSurface(
          expected.initial,
          [source.vertices],
          target.query,
          {
            initialRadius: expected.initialRadius,
            budget: expected.budget,
            step: expected.step,
            onEvaluation: (parameters, error, best) =>
              trace.push({ parameters, error, best }),
          },
        );
        expect(trace.length).toBe(expected.trace.length);
        trace.forEach((step, index) =>
          expect(step, `evaluation ${index}`).toEqual({
            parameters: expected.trace[index].parameters,
            error: expected.trace[index].error,
            best: expected.trace[index].best,
          }),
        );
        expect(result).toMatchObject({
          parameters: expected.parameters,
          error: expected.error,
          best: expected.best,
          initialError: expected.initialError,
          iterations: expected.iterations,
          converged: expected.converged,
          flags: [expected.flags],
        });
      } finally {
        sinMock?.mockRestore();
        cosMock?.mockRestore();
      }
    },
  );
});
