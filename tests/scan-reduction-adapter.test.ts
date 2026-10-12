import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import {
  reduceIndexedScanMesh,
  admitReductionRecords,
} from "../src/scan-reduction-adapter";
import { reduceScanMesh } from "../src/scan-tools-reduction";
import fixture from "./fixtures/reduction-adapter.json";

const expand = (points: ArrayLike<number>, triangles: ArrayLike<number>) =>
  Float32Array.from(
    Array.from(triangles).flatMap((id) => [
      points[id * 3],
      points[id * 3 + 1],
      points[id * 3 + 2],
    ]),
  );

it.each(fixture.cases)(
  "production reduction matches original indexed-source loop $label target $target",
  (capture) => {
    const input = expand(capture.points, capture.triangles);
    const before = input.slice();
    const topology = analyzeMesh(input);
    expect(Array.from(topology.vertices)).toEqual(capture.points);
    expect(Array.from(topology.triangles)).toEqual(capture.triangles);
    const outputBytes = Uint8Array.from(
      capture.outputHex.match(/../g)!,
      (pair) => parseInt(pair, 16),
    );
    const expected = expand(
      new Float64Array(outputBytes.buffer),
      capture.outputTriangles,
    );
    const progress: number[] = [];
    const result = reduceScanMesh(input, {
      mode: "triangles",
      targetTriangles: capture.target,
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(new Uint8Array(result.positions.buffer)).toEqual(
      new Uint8Array(expected.buffer),
    );
    expect(
      new Uint8Array(reduceIndexedScanMesh(topology, capture.target).buffer),
    ).toEqual(new Uint8Array(expected.buffer));
    if (capture.target === input.length / 18) {
      expect(
        reduceScanMesh(input, { mode: "percentage", percentage: 50 }).positions,
      ).toEqual(expected);
    }
    expect(input).toEqual(before);
    expect(progress.at(-1)).toBe(1);
    expect(
      progress.every((value, index) => !index || value >= progress[index - 1]),
    ).toBe(true);
  },
);

it("retains source for the native caller's below-four target and cancellation", () => {
  const capture = fixture.cases[0];
  const input = expand(capture.points, capture.triangles);
  expect(
    reduceScanMesh(input, { mode: "triangles", targetTriangles: 3 }).positions,
  ).toEqual(input);
  const controller = new AbortController();
  expect(() =>
    reduceScanMesh(input, {
      mode: "triangles",
      targetTriangles: 36,
      signal: controller.signal,
      onProgress: (_, stage) => {
        if (stage === "Exporting reduced mesh") controller.abort();
      },
    }),
  ).toThrow("cancelled");
  expect(input).toEqual(expand(capture.points, capture.triangles));
});

it("admits bounded working records and rejects oversized reductions before allocation", () => {
  expect(() => admitReductionRecords(10_201, 20_000)).not.toThrow();
  expect(() => admitReductionRecords(100_000, 200_000)).toThrow(
    "working-memory",
  );
});

it("keeps the native below-four shortcut independent of large-mesh admission", () => {
  const source = new Float32Array(40_000 * 9);
  const stages: string[] = [];
  const result = reduceScanMesh(source, {
    mode: "triangles",
    targetTriangles: 3,
    onProgress: (_, stage) => stages.push(stage),
  });
  expect(result.positions.length).toBe(source.length);
  expect(result.positions.every((value) => value === 0)).toBe(true);
  expect(stages).toEqual(["Polygon reduction complete"]);
});
