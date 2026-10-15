import { expect, it } from "vitest";
import captures from "../docs/evidence/landmark-refinement-preparation-native.json";
import {
  prepareNativeLandmarkRegion,
  parseLandmarkSeedVertices,
} from "../src/native-landmark-region";

it.each(captures.cases)("matches original seeded region $name", (capture) => {
  const before = JSON.stringify(capture);
  const result = prepareNativeLandmarkRegion(
    capture.flags.length,
    capture.triangles.flat(),
    capture.seeds,
    capture.flags,
    capture.faces,
  );
  expect(Array.from(result.vertices)).toEqual(capture.vertices);
  expect(Array.from(result.faceFlags)).toEqual(capture.faceFlags);
  expect(result.count).toBe(capture.count);
  expect(result.passes).toBe(capture.passes);
  expect(result.visitedFaceReferences).toBeLessThanOrEqual(
    capture.triangles.length * 3,
  );
  expect(JSON.stringify(capture)).toBe(before);
});
it("rejects invalid seeds and cancels before allocating topology", () => {
  expect(parseLandmarkSeedVertices("0, 2 7")).toEqual(
    new Uint32Array([0, 2, 7]),
  );
  expect(parseLandmarkSeedVertices(" ")).toBeUndefined();
  expect(() => parseLandmarkSeedVertices("2.5")).toThrow("unsigned");
  expect(() => prepareNativeLandmarkRegion(20_000_000, [], [])).toThrow(
    "256 MiB",
  );
  expect(() => prepareNativeLandmarkRegion(3, [0, 1, 2], [3])).toThrow("seed");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareNativeLandmarkRegion(
      3,
      [0, 1, 2],
      [0],
      undefined,
      undefined,
      controller.signal,
    ),
  ).toThrow("cancelled");
});
