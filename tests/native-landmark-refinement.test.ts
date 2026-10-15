import { expect, it } from "vitest";
import captures from "../docs/evidence/landmark-joint-controller-native.json";
import { refineNativeLandmarkAfterCoarse } from "../src/native-landmark-refinement";

const decode = (hex: string) =>
  new Float32Array(
    Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)).buffer,
  );
const bits = (array: Float32Array) =>
  Array.from(new Uint8Array(array.buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
it.each(captures.cases)(
  "assembles original coarse/refinement output for $name",
  async (capture) => {
    const { search } = capture,
      { joint } = search;
    const source = {
      vertices: Float32Array.from(joint.originalPoints.flat()),
      triangles: Uint32Array.from(search.sourceTriangles),
      normals: decode(joint.originalNormalBits),
    };
    const before = bits(source.vertices);
    const result = await refineNativeLandmarkAfterCoarse(
      source,
      [
        {
          vertices: Float32Array.from(capture.targetVertices.flat()),
          triangles: Uint32Array.from(capture.targetTriangles),
        },
      ],
      joint.coarse,
      Uint32Array.from({ length: source.vertices.length / 3 }, (_, id) => id),
      { initialRadius: search.initialRadius, parallel: false, workerCount: 1 },
    );
    expect(result.refinement.matrix).toEqual(search.matrix);
    expect(result.refinement.parameters).toEqual(search.parameters);
    expect(result.refinement.initialError).toBe(search.initialError);
    expect(result.refinement.best).toBe(search.best);
    expect(result.diagnostics.refinementApplied).toBe(joint.applyDelta);
    expect(bits(result.indexedMesh.vertices)).toBe(joint.finalPointBits);
    expect(bits(result.indexedMesh.normals)).toBe(joint.finalNormalBits);
    expect(bits(source.vertices)).toBe(before);
    expect(result.indexedMesh.triangles).toEqual(source.triangles);
    const generated = await refineNativeLandmarkAfterCoarse(
      { vertices: source.vertices, triangles: source.triangles },
      [
        {
          vertices: Float32Array.from(capture.targetVertices.flat()),
          triangles: Uint32Array.from(capture.targetTriangles),
        },
      ],
      joint.coarse,
      Uint32Array.from({ length: source.vertices.length / 3 }, (_, id) => id),
      { initialRadius: search.initialRadius, parallel: false, workerCount: 1 },
    );
    expect(bits(generated.indexedMesh.vertices)).toBe(joint.finalPointBits);
    expect(bits(generated.indexedMesh.normals)).toBe(joint.finalNormalBits);
  },
);
it("rejects cancellation before region construction", async () => {
  await expect(
    refineNativeLandmarkAfterCoarse(
      { vertices: [], triangles: [] },
      [],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
      [],
      { signal: AbortSignal.abort() },
    ),
  ).rejects.toThrow("cancelled");
});
