import { expect, it } from "vitest";
import native from "./fixtures/alignment-objective.json";
import { createNativeAlignmentObjective } from "../src/scan-native-alignment-objective";
import { createNativeAlignmentSurfaceQuery } from "../src/scan-native-alignment-mesh-query";

it.each(native.samples)(
  "matches original callback sequence: $name",
  (sample) => {
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
    const vertices = sample.points.map((point) => ({
      point,
      normal: sample.normal,
      flags: 4,
    }));
    const evaluate = createNativeAlignmentObjective([vertices], query, {
      radius: sample.radius,
    });
    for (const step of sample.steps) {
      const result = evaluate(step.parameters, {
        initializing: step.initializing,
      });
      expect(result.error).toBe(step.error);
      expect(result.best).toBe(step.best);
      expect(result.sign).toBe(step.sign);
      expect(result.workers[0].flags).toEqual(step.flags);
      expect(result.workers[0].error).toBe(step.workerError);
      expect(result.workers[0].minimum).toBe(step.minimum);
      expect(result.workers[0].maximum).toBe(step.maximum);
    }
    expect(vertices.map((vertex) => vertex.flags)).toEqual([4, 4, 4]);
  },
);
