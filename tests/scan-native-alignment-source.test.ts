import { expect, it } from "vitest";
import native from "./fixtures/alignment-prepared-source.json";
import { prepareNativeAlignmentSource } from "../src/scan-native-alignment-source";

it.each(native.samples)(
  "matches original source normals and sampling: $name",
  (sample) => {
    const result = prepareNativeAlignmentSource(
      {
        vertices: sample.points.flat(),
        triangles: sample.triangles,
        flags: sample.flags,
      },
      sample.budget,
      { selectionOnly: sample.selectionOnly },
    );
    expect(
      Array.from(new Uint8Array(result.normals.buffer), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(sample.normalBits);
    expect(result.vertices.map((vertex) => vertex.flags)).toEqual(
      sample.resultFlags,
    );
    expect(result.sampling.levelCounts).toEqual(sample.levelCounts);
    expect(result.sampling.nodes).toBe(sample.nodes);
  },
);

it("uses supplied vertex normals without changing their magnitudes or mutating the source", () => {
  const normals = new Float32Array([2, 0, 0, 0, 3, 0, 0, 0, -4]);
  const result = prepareNativeAlignmentSource(
    {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      triangles: [0, 1, 2],
      normals,
      flags: [4, 4, 4],
    },
    1,
    { selectionOnly: true },
  );
  expect(result.normals).toEqual(normals);
  expect(result.normals).not.toBe(normals);
  expect(result.vertices.map((v) => v.normal)).toEqual([
    [2, 0, 0],
    [0, 3, 0],
    [0, 0, -4],
  ]);
  expect(normals).toEqual(new Float32Array([2, 0, 0, 0, 3, 0, 0, 0, -4]));
});
it("rejects malformed supplied normal buffers", () => {
  for (const normals of [[1], [NaN, 0, 0], [Number.MAX_VALUE, 0, 0]])
    expect(() =>
      prepareNativeAlignmentSource(
        { vertices: [0, 0, 0], triangles: [], normals },
        1,
      ),
    ).toThrow();
});
