import { expect, it } from "vitest";
import {
  updateReductionFaces,
  type ReductionWorkingFace,
} from "../src/scan-reduction-update";
import type { ReductionVertex } from "../src/scan-reduction-candidate";
import type { ReductionReference } from "../src/scan-reduction-validity";
import type { Vec3 } from "../src/types";
import fixture from "./fixtures/reduction-update.json";
import { compactReductionMesh } from "../src/scan-reduction-final";

it.each(fixture.cases)(
  "matches original ordered adjacency update %#",
  (capture) => {
    const faces = structuredClone(capture.faces) as ReductionWorkingFace[];
    const mask = new Uint32Array(capture.mask);
    const appended: ReductionReference[] = [];
    const before = JSON.stringify([capture.vertices, capture.references]);
    const deleted = updateReductionFaces(
      capture.retained,
      capture.vertices.map((vertex): ReductionVertex => ({
        ...vertex,
        point: vertex.point as Vec3,
      })),
      faces,
      capture.references,
      mask,
      appended,
      capture.initialDeleted,
    );
    expect(deleted).toBe(capture.deletedCount);
    expect(appended).toEqual(capture.appended);
    for (let index = 0; index < faces.length; index++) {
      const face = faces[index],
        expected = capture.output[index];
      const errorBytes = new Uint8Array(new Float64Array(face.errors).buffer);
      expect(
        Array.from(errorBytes, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      ).toBe(expected.errorsHex);
      expect({
        vertices: face.vertices,
        bestEdge: face.bestEdge,
        deleted: face.deleted,
        dirty: face.dirty,
        normal: face.normal,
      }).toEqual({
        vertices: expected.vertices,
        bestEdge: expected.bestEdge,
        deleted: expected.deleted,
        dirty: expected.dirty,
        normal: expected.normal,
      });
    }
    expect(Array.from(mask)).toEqual(capture.mask);
    expect(JSON.stringify([capture.vertices, capture.references])).toBe(before);
    expect(capture.guardsIntact && capture.verticesAndMaskUnchanged).toBe(true);
    const compacted = compactReductionMesh(
      capture.vertices.flatMap((vertex) => vertex.point),
      faces,
    );
    const compactedBytes = new Uint8Array(compacted.vertices.buffer);
    expect(
      Array.from(compactedBytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(capture.finalHex);
    expect(Array.from(compacted.triangles)).toEqual(capture.finalTriangles);
  },
);

it("appending into the same reference vector does not revisit successor entries", () => {
  const capture = fixture.cases.find((item) => item.appended.length > 0)!;
  const references = structuredClone(capture.references);
  const faces = structuredClone(capture.faces) as ReductionWorkingFace[];
  const vertices = capture.vertices.map((vertex): ReductionVertex => ({
    ...vertex,
    point: vertex.point as Vec3,
  }));
  const deleted = updateReductionFaces(
    capture.retained,
    vertices,
    faces,
    references,
    new Uint32Array(capture.mask),
    references,
    capture.initialDeleted,
  );
  expect(references).toEqual([...capture.references, ...capture.appended]);
  expect(deleted).toBe(capture.deletedCount);
});
