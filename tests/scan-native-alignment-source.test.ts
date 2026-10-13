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
