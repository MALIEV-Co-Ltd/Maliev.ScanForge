import { expect, it } from "vitest";
import {
  prepareNativeAlignmentSource,
  prepareNativeAlignmentSelectedSource,
} from "../src/scan-native-alignment-source";
import { partitionNativeAlignmentVertices } from "../src/scan-native-alignment-partition";
import captures from "../docs/evidence/landmark-refinement-preparation-native.json";

it.each(captures.cases)(
  "preserves native selected source order and values for $name",
  (capture) => {
    const count = capture.flags.length;
    const mesh = {
      vertices: Float32Array.from(
        { length: count * 3 },
        (_v, i) => (i % 7) - 0.125,
      ),
      triangles: Uint32Array.from(capture.triangles.flat()),
      flags: Uint32Array.from(capture.vertices),
      normals: Float32Array.from({ length: count * 3 }, (_v, i) =>
        i % 5 === 0 ? -0 : ((i % 3) + 0.25) * 3,
      ),
    };
    const before = mesh.flags.slice();
    const reference = prepareNativeAlignmentSource(mesh, 1, {
      selectionOnly: true,
    });
    const selected = prepareNativeAlignmentSelectedSource(mesh);
    expect(selected.vertices).toEqual(
      reference.vertices.filter((vertex) => (vertex.flags & 5) === 4),
    );
    for (const lanes of [1, 2, 4, 16]) {
      expect(
        partitionNativeAlignmentVertices([selected.vertices], lanes).map(
          (lane) => lane.vertices,
        ),
      ).toEqual(
        partitionNativeAlignmentVertices([reference.vertices], lanes).map(
          (lane) => lane.vertices,
        ),
      );
    }
    expect(mesh.flags).toEqual(before);
  },
);
it("preserves fallback normals and validates inactive records", () => {
  const mesh = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2]),
    flags: new Uint32Array([4, 5, 0]),
  };
  const reference = prepareNativeAlignmentSource(mesh, 1, {
    selectionOnly: true,
  });
  expect(prepareNativeAlignmentSelectedSource(mesh).vertices).toEqual([
    reference.vertices[0],
  ]);
  expect(() =>
    prepareNativeAlignmentSelectedSource({
      ...mesh,
      vertices: [0, 0, 0, NaN, 0, 0, 0, 1, 0],
    }),
  ).toThrow("finite Float32");
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    prepareNativeAlignmentSelectedSource(mesh, { signal: controller.signal }),
  ).toThrow("cancelled");
});
