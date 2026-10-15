import { expect, it } from "vitest";
import capture from "../docs/evidence/landmark-joined-copy-native.json";
import { prepareNativeLandmarkTarget } from "../src/native-landmark-target";

const bits = (values: Float32Array) =>
  Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString(
    "hex",
  );

it.each(capture.cases)("matches original joined target $name", (row) => {
  const targets = row.inputs.map((input) => ({
    vertices: Float32Array.from(input.vertices),
    triangles: Uint32Array.from(input.triangles),
    normals: Float32Array.from(input.normals),
  }));
  const before = targets.map((target) => ({
    vertices: bits(target.vertices),
    normals: bits(target.normals),
    triangles: Array.from(target.triangles),
  }));
  const joined = prepareNativeLandmarkTarget(targets);
  expect(Array.from(joined.vertices)).toEqual(row.afterNormals.vertices);
  expect(Array.from(joined.triangles)).toEqual(row.afterNormals.triangles);
  expect(bits(joined.normals)).toBe(row.afterNormals.normalBits);
  expect(
    targets.map((target) => ({
      vertices: bits(target.vertices),
      normals: bits(target.normals),
      triangles: Array.from(target.triangles),
    })),
  ).toEqual(before);
});

it("retains coincident vertices in separate target objects", () => {
  const mesh = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const joined = prepareNativeLandmarkTarget([mesh, mesh]);
  expect(joined.vertices.length).toBe(18);
  expect(Array.from(joined.triangles)).toEqual([0, 1, 2, 3, 4, 5]);
});

it("cancels before target copying", () => {
  expect(() =>
    prepareNativeLandmarkTarget([], { signal: AbortSignal.abort() }),
  ).toThrow("cancelled");
});
