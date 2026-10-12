import { expect, it } from "vitest";
import { prepareReductionMesh } from "../src/scan-reduction-preparation";
import fixture from "./fixtures/reduction-preparation.json";
const hex = (values: ArrayLike<number>) =>
  Array.from(new Uint8Array(Float64Array.from(values).buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

it.each(fixture.cases)(
  "matches complete original preparation %#",
  (capture) => {
    const bytes = Uint8Array.from(
      capture.sourceHex.match(/../g) ?? [],
      (pair) => parseInt(pair, 16),
    );
    const coordinates = new Float64Array(bytes.buffer);
    const before = bytes.slice();
    const triangles = new Uint32Array(capture.triangles);
    const result = prepareReductionMesh(coordinates, triangles);
    for (let id = 0; id < result.vertices.length; id++) {
      const actual = result.vertices[id],
        expected = capture.vertices[id];
      expect(hex(actual.quadric)).toBe(expected.quadricHex);
      expect({
        offset: actual.offset,
        count: actual.count,
        boundary: actual.boundary,
      }).toEqual({
        offset: expected.offset,
        count: expected.count,
        boundary: expected.boundary,
      });
    }
    for (let id = 0; id < result.faces.length; id++) {
      const actual = result.faces[id],
        expected = capture.faces[id];
      expect(hex(actual.normal)).toBe(expected.normalHex);
      expect(hex(actual.errors)).toBe(expected.errorsHex);
      expect(actual.bestEdge).toBe(expected.bestEdge);
    }
    expect(result.references).toEqual(capture.references);
    expect(hex([result.minimum])).toBe(capture.minimumHex);
    expect(bytes).toEqual(before);
    expect(Array.from(triangles)).toEqual(capture.triangles);
    expect(capture.guardsIntact).toBe(true);
  },
);
