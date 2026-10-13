import { describe, expect, it, vi } from "vitest";
import native from "./fixtures/alignment-surface-search.json";
import { createNativeAlignmentSurfaceQuery } from "../src/scan-native-alignment-mesh-query";
import { nativeRefineAlignmentSurface } from "../src/scan-native-alignment-surface-search";

describe.each([false, true])(
  "captured CRT trigonometry: %s",
  (capturedTrig) => {
    it.each(native.samples)(
      "matches complete mesh-query search: $name",
      (sample) => {
        const sine = new Map<number, number>(),
          cosine = new Map<number, number>();
        for (const step of sample.trace)
          step.angles.forEach((angle, i) => {
            sine.set(angle, step.sine[i]);
            cosine.set(angle, step.cosine[i]);
          });
        const sinMock = capturedTrig
          ? vi
              .spyOn(Math, "sin")
              .mockImplementation((angle) => sine.get(angle)!)
          : undefined;
        const cosMock = capturedTrig
          ? vi
              .spyOn(Math, "cos")
              .mockImplementation((angle) => cosine.get(angle)!)
          : undefined;
        try {
          const query = createNativeAlignmentSurfaceQuery({
            root: {
              bounds: [-3, -3, -3, 3, 3, 3],
              center: [0, 0, 0],
              mode: 0,
              triangles: [0],
              children: {},
            },
            points: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
            triangleBounds: new Float32Array([0, 0, 0, 2, 2, 0]),
            normals: new Float32Array([0, 0, 1]),
            neighbors: new Uint8Array(sample.neighbors ? [1, 1, 1] : [0, 0, 0]),
          });
          const trace: {
            parameters: readonly number[];
            error: number;
            best: number;
          }[] = [];
          const result = nativeRefineAlignmentSurface(
            sample.initial,
            [
              sample.points.map((point) => ({
                point,
                normal: sample.normal,
                flags: 4,
              })),
            ],
            query,
            {
              initialRadius: sample.initialRadius,
              budget: sample.budget,
              step: sample.step,
              onEvaluation: (parameters, error, best) =>
                trace.push({ parameters, error, best }),
            },
          );
          expect(trace.length).toBe(sample.trace.length);
          const tolerance = capturedTrig ? 0 : 1e-20;
          trace.forEach((step, i) => {
            const expected = sample.trace[i];
            expect(step.parameters, `evaluation ${i}`).toEqual(
              expected.parameters,
            );
            expect(
              Math.abs(step.error - expected.error),
              `error ${i}`,
            ).toBeLessThanOrEqual(tolerance);
            expect(
              Math.abs(step.best - expected.best),
              `best ${i}`,
            ).toBeLessThanOrEqual(tolerance);
          });
          expect(result).toMatchObject({
            parameters: sample.parameters,
            iterations: sample.iterations,
            converged: sample.converged,
            initialError: sample.initialError,
            flags: [sample.flags],
          });
          expect(Math.abs(result.error - sample.error)).toBeLessThanOrEqual(
            tolerance,
          );
          expect(Math.abs(result.best - sample.best)).toBeLessThanOrEqual(
            tolerance,
          );
        } finally {
          sinMock?.mockRestore();
          cosMock?.mockRestore();
        }
      },
    );
  },
);
