import { expect, it } from "vitest";
import captures from "../docs/evidence/landmark-joint-controller-native.json";
import transitions from "../docs/evidence/landmark-refinement-state-native.json";
import regions from "../docs/evidence/landmark-refinement-preparation-native.json";
import { nativeDatumIsIdentity } from "../src/scan-native-datum-apply";
import {
  refineNativeLandmarkAfterCoarse,
  nativeLandmarkFaceSelection,
} from "../src/native-landmark-refinement";

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
    expect(result.indexedMesh.triangles).toBe(source.triangles);
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
it("retains grown selected faces for an identity delta and clears them only on application", () => {
  const flags = new Uint8Array([0, 1, 4, 128, 132, 255]);
  expect(nativeLandmarkFaceSelection(flags, false)).toEqual(
    new Uint8Array([0, 0, 1, 0, 1, 1]),
  );
  expect(nativeLandmarkFaceSelection(flags, true)).toEqual(new Uint8Array(6));
  expect(flags).toEqual(new Uint8Array([0, 1, 4, 128, 132, 255]));
});
it("matches selected face counts in all 712 original refinement tail transitions", () => {
  for (const row of transitions.cases) {
    const region = regions.cases.find((item) => item.name === row.region)!;
    const matrix = transitions.matrices.find(
      (item) => item.name === row.matrix,
    )!.values;
    const applied = !nativeDatumIsIdentity(matrix, Number.EPSILON);
    expect(applied).toBe(!!row.appliedMatrices.length);
    const selection = nativeLandmarkFaceSelection(
      Uint8Array.from(region.faceFlags),
      applied,
    );
    expect(selection.reduce((sum, flag) => sum + flag, 0)).toBe(
      row.selectedFaces,
    );
  }
});
