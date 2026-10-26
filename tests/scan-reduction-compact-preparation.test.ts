import { expect, it } from "vitest";
import { prepareCompactReduction } from "../src/scan-reduction-compact-preparation";
import { prepareReductionMesh } from "../src/scan-reduction-preparation";
import { weldMeshPositions } from "../src/mesh-weld";
import { reductionGrid } from "./helpers/reduction-grid";
import fixture from "./fixtures/reduction-preparation.json";
const hex = (a: ArrayLike<number>) =>
  Array.from(new Uint8Array(Float64Array.from(a).buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
it.each(fixture.cases)(
  "matches compact preparation to retained native bytes %#",
  (capture) => {
    const bytes = Uint8Array.from(
      capture.sourceHex.match(/../g) ?? [],
      (pair) => parseInt(pair, 16),
    );
    const points = new Float64Array(bytes.buffer),
      triangles = new Uint32Array(capture.triangles);
    const before = bytes.slice(),
      state = prepareCompactReduction(points, triangles);
    try {
      expect(new Uint8Array(state.points.buffer)).toEqual(bytes);
      for (let id = 0; id < capture.vertices.length; id++) {
        const v = capture.vertices[id];
        expect(hex(state.quadrics.subarray(id * 10, id * 10 + 10))).toBe(
          v.quadricHex,
        );
        expect(state.offsets[id]).toBe(v.offset);
        expect(state.counts[id]).toBe(v.count);
        expect(Boolean(state.boundary[id])).toBe(v.boundary);
      }
      for (let id = 0; id < capture.faces.length; id++) {
        expect(hex(state.normals.subarray(id * 3, id * 3 + 3))).toBe(
          capture.faces[id].normalHex,
        );
        expect(hex(state.errors.subarray(id * 3, id * 3 + 3))).toBe(
          capture.faces[id].errorsHex,
        );
        expect(state.best[id]).toBe(capture.faces[id].bestEdge);
      }
      expect(
        Array.from({ length: state.references.length }, (_, i) => {
          const value = state.references.get(i);
          return { face: Math.floor(value / 3), corner: value % 3 };
        }),
      ).toEqual(capture.references);
      expect(hex([state.minimum])).toBe(capture.minimumHex);
      expect(bytes).toEqual(before);
      expect(Array.from(triangles)).toEqual(capture.triangles);
    } finally {
      state.dispose();
    }
  },
);
it.each([1, 3])(
  "unwinds admission when preparation checkpoint %i cancels",
  (cancelAt) => {
    const points = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const triangles = new Uint32Array([0, 1, 2]);
    let calls = 0;
    expect(() =>
      prepareCompactReduction(points, triangles, () => {
        if (++calls === cancelAt)
          throw new DOMException("cancelled", "AbortError");
      }),
    ).toThrow("cancelled");
    expect(Array.from(triangles)).toEqual([0, 1, 2]);
  },
);

it("retains complete preparation bytes and reference order on a deterministic connected grid", () => {
  const input = weldMeshPositions(reductionGrid(16, 13), 0.000001);
  const expected = prepareReductionMesh(input.vertices, input.triangles);
  const actual = prepareCompactReduction(input.vertices, input.triangles);
  try {
    expect(hex(actual.quadrics)).toBe(
      hex(expected.vertices.flatMap((vertex) => Array.from(vertex.quadric))),
    );
    expect(hex(actual.normals)).toBe(
      hex(expected.faces.flatMap((face) => face.normal)),
    );
    expect(hex(actual.errors)).toBe(
      hex(expected.faces.flatMap((face) => face.errors)),
    );
    expect(Array.from(actual.best)).toEqual(
      expected.faces.map((face) => face.bestEdge),
    );
    expect(Array.from(actual.offsets)).toEqual(
      expected.vertices.map((vertex) => vertex.offset),
    );
    expect(Array.from(actual.counts)).toEqual(
      expected.vertices.map((vertex) => vertex.count),
    );
    expect(Array.from(actual.boundary)).toEqual(
      expected.vertices.map((vertex) => Number(vertex.boundary)),
    );
    expect(
      Array.from({ length: actual.references.length }, (_, index) =>
        actual.references.get(index),
      ),
    ).toEqual(
      expected.references.map(
        (reference) => reference.face * 3 + reference.corner,
      ),
    );
    expect(hex([actual.minimum])).toBe(hex([expected.minimum]));
  } finally {
    actual.dispose();
  }
});
