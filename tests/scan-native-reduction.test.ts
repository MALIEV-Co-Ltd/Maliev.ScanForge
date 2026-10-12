import { expect, it } from "vitest";
import { nativeReductionMesh } from "../src/scan-native-reduction";
import fixture from "./fixtures/reduction-whole.json";

it.each(fixture.cases)(
  "matches complete native reduction $label target $target",
  (capture) => {
    const before = JSON.stringify([capture.points, capture.triangles]);
    const progress: number[] = [];
    const result = nativeReductionMesh(
      capture.points,
      capture.triangles,
      capture.target,
      { onProgress: (fraction) => progress.push(fraction) },
    );
    const hex = Array.from(new Uint8Array(result.vertices.buffer), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(hex).toBe(capture.outputHex);
    expect(Array.from(result.triangles)).toEqual(capture.outputTriangles);
    expect(result.triangles.length / 3).toBe(capture.outputCount);
    expect(capture.guardsIntact).toBe(true);
    expect(JSON.stringify([capture.points, capture.triangles])).toBe(before);
    expect(progress.at(-1)).toBe(1);
    expect(
      progress.every(
        (fraction, index) =>
          fraction >= 0 &&
          fraction <= 1 &&
          (!index || fraction >= progress[index - 1]),
      ),
    ).toBe(true);
  },
);

it.each([
  "Preparing native reduction",
  "Collapsing native mesh edges",
  "Compacting reduced mesh",
])(
  "cancels at %s without publishing a result or modifying source",
  (cancelAt) => {
    const capture = fixture.cases[0];
    const before = JSON.stringify([capture.points, capture.triangles]);
    const controller = new AbortController();
    const stages: string[] = [];
    expect(() =>
      nativeReductionMesh(capture.points, capture.triangles, capture.target, {
        signal: controller.signal,
        onProgress: (_, stage) => {
          stages.push(stage);
          if (stage === cancelAt) controller.abort();
        },
      }),
    ).toThrow("cancelled");
    expect(stages).not.toContain("Polygon reduction completed");
    expect(JSON.stringify([capture.points, capture.triangles])).toBe(before);
  },
);

it("rejects invalid buffers and targets before preparation", () => {
  expect(() => nativeReductionMesh([0], [], 0)).toThrow("complete");
  expect(() => nativeReductionMesh([0, 0, 0], [0], 0)).toThrow("complete");
  expect(() => nativeReductionMesh([0, 0, NaN], [], 0)).toThrow("finite");
  expect(() => nativeReductionMesh([0, 0, 0], [0, 1, 0], 0)).toThrow("index");
  expect(() => nativeReductionMesh([], [], 1)).toThrow("target");
  expect(() => nativeReductionMesh([], [], -1)).toThrow("target");
  expect(() => nativeReductionMesh([], [], 0.5)).toThrow("target");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    nativeReductionMesh([], [], 0, { signal: controller.signal }),
  ).toThrow("cancelled");
  expect(nativeReductionMesh([], [], 0)).toEqual({
    vertices: new Float64Array(),
    triangles: new Uint32Array(),
  });
});
