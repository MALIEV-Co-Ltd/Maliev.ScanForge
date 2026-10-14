import { expect, it } from "vitest";
import native from "./fixtures/alignment-segmentation-scores-native.json";
import preparation from "./fixtures/alignment-segmentation-preparation-flags-native.json";
import orphan from "./fixtures/alignment-segmentation-orphan-native.json";
import { prepareNativeSegmentationSession } from "../src/scan-native-segmentation-session";

it("matches original compaction while retaining cached bounds and buckets", () => {
  const session = prepareNativeSegmentationSession({
    vertices: Float32Array.from(orphan.inputPositions.flat()),
    normals: Float32Array.from(orphan.inputNormals.flat()),
    triangles: Uint32Array.from(orphan.inputTriangles.flat()),
  });
  expect(Array.from(session.vertices)).toEqual(orphan.positions.flat());
  expect(Array.from(session.normals)).toEqual(orphan.normals.flat());
  expect(Array.from(session.scores)).toEqual(orphan.nativeScores);
  expect(Array.from(session.classify(0.5).faceFlags)).toEqual(
    orphan.nativeFaceFlags,
  );
  expect(Array.from(session.sourceVertexIds)).toEqual([1, 2, 3]);
});

it("retains original score-worker processing flags rather than adjacency flags", () => {
  const session = prepareNativeSegmentationSession({
    vertices: Float32Array.from(preparation.positions.flat()),
    normals: Float32Array.from(preparation.normals.flat()),
    triangles: Uint32Array.from(preparation.triangles.flat()),
  });
  expect(Array.from(session.scores)).toEqual(preparation.nativeScores);
  expect(Array.from(session.classify(0.5).faceFlags)).toEqual(
    preparation.nativeFaceFlags,
  );
});

it.each(native.cases)(
  "joins native preparation and region labels for $angles",
  (sample) => {
    const session = prepareNativeSegmentationSession(
      {
        vertices: Float32Array.from(sample.positions.flat()),
        triangles: Uint32Array.from(sample.triangles.flat()),
        normals: Float32Array.from(sample.normals.flat()),
      },
      { capDegrees: sample.capDegrees },
    );
    const result = session.classify(sample.threshold);
    expect(Array.from(result.labels)).toEqual(sample.nativeLabels);
    expect(
      Array.from(result.regionOffsets.slice(1), (end, i) =>
        Array.from(result.traversal.slice(result.regionOffsets[i], end)),
      ),
    ).toEqual(sample.nativeRegions);
    const scores = session.scores,
      neighbors = session.neighbors;
    session.classify(0);
    session.classify(1);
    expect(session.scores).toBe(scores);
    expect(session.neighbors).toBe(neighbors);
    expect(Array.from(session.classify(sample.threshold).labels)).toEqual(
      sample.nativeLabels,
    );
  },
);
it("compacts unflagged orphan vertices while owning input copies", () => {
  const vertices = new Float32Array([9, 9, 9, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([1, 2, 3]);
  const session = prepareNativeSegmentationSession({ vertices, triangles });
  expect(Array.from(session.sourceVertexIds)).toEqual([1, 2, 3]);
  expect(Array.from(session.triangles)).toEqual([0, 1, 2]);
  vertices.fill(0);
  triangles.fill(0);
  expect(Array.from(session.vertices)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(Array.from(session.triangles)).toEqual([0, 1, 2]);
});
it("handles an empty mesh and rejects cancelled preparation", () => {
  const mesh = { vertices: new Float32Array(), triangles: new Uint32Array() };
  expect(
    prepareNativeSegmentationSession(mesh).classify(0.5).labels.length,
  ).toBe(0);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareNativeSegmentationSession(
      { vertices: new Float32Array(3), triangles: new Uint32Array() },
      { signal: controller.signal },
    ),
  ).toThrow("cancelled");
});
