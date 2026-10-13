import { expect, it } from "vitest";
import native from "./fixtures/alignment-controller-thread.json";
import { nativeRefineAlignmentMeshes } from "../src/scan-native-alignment-surface-controller";

it.each(native.cases)(
  "matches original refinement thread and output matrix: $name",
  (sample) => {
    const expected = sample.search;
    const result = nativeRefineAlignmentMeshes(
      [
        {
          vertices: expected.sourcePoints.flat(),
          triangles: expected.sourceTriangles,
          flags: expected.sourcePoints.map(() => 4),
        },
      ],
      { vertices: sample.vertices.flat(), triangles: sample.triangles },
      0,
      {
        selectionOnly: true,
        initialRadius: expected.initialRadius,
        step: expected.step,
      },
    );
    expect(result.parameters).toEqual(expected.parameters);
    expect(result.accepted).toBe(expected.accepted);
    expect(result.best).toBe(expected.best);
    expect(result.initialError).toBe(expected.initialError);
    expect(result.flags).toEqual([expected.flags]);
    expect(result.matrix).toEqual(expected.matrix);
  },
);
