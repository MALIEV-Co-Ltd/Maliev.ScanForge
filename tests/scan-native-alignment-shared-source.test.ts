import { expect, it } from "vitest";
import native from "./fixtures/alignment-shared-source.json";
import { createNativeAlignmentSamplingState } from "../src/scan-native-alignment-sample";
import {
  prepareNativeAlignmentSource,
  prepareNativeAlignmentSources,
} from "../src/scan-native-alignment-source";

it("matches original sampling pool lifetime across four source meshes", () => {
  const samplingState = createNativeAlignmentSamplingState();
  for (const sample of native.samples) {
    const result = prepareNativeAlignmentSource(
      {
        vertices: sample.points.flat(),
        triangles: sample.triangles,
        flags: sample.flags,
      },
      sample.budget,
      { samplingState },
    );
    expect(result.sampling.flags).toEqual(sample.resultFlags);
    expect(result.sampling.levelCounts).toEqual(sample.levelCounts);
    expect(result.sampling.nodes).toBe(sample.nodes);
  }
});

it("preserves final native source flags after all meshes share the pool", () => {
  const results = prepareNativeAlignmentSources(
    native.samples.map((sample) => ({
      vertices: sample.points.flat(),
      triangles: sample.triangles,
      flags: sample.flags,
    })),
    native.samples[0].budget,
  );
  for (let index = 0; index < results.length; index++)
    expect(results[index].vertices.map((vertex) => vertex.flags)).toEqual(
      native.samples[index].finalFlags,
    );
});
