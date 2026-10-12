import { expect, it } from "vitest";
import { compactReductionMesh } from "../src/scan-reduction-final";
import type { ReductionFace } from "../src/scan-reduction-validity";
import fixture from "./fixtures/reduction-final.json";

it.each(fixture.cases)(
  "matches original final compaction coordinate bits and indices %#",
  (capture) => {
    const bytes = Uint8Array.from(
      capture.sourceHex.match(/../g) ?? [],
      (pair) => parseInt(pair, 16),
    );
    const coordinates = new Float64Array(bytes.buffer);
    const before = bytes.slice();
    const faceBefore = JSON.stringify(capture.faces);
    const result = compactReductionMesh(
      coordinates,
      capture.faces as ReductionFace[],
    );
    expect(
      Array.from(new Uint8Array(result.vertices.buffer), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(capture.outputHex);
    expect(Array.from(result.triangles)).toEqual(capture.triangles);
    expect(result.vertices.length / 3).toBe(capture.vertexCount);
    expect(result.triangles.length / 3).toBe(capture.faceCount);
    expect(bytes).toEqual(before);
    expect(JSON.stringify(capture.faces)).toBe(faceBefore);
    expect(capture.guardsIntact && capture.onlyEndPointersChanged).toBe(true);
  },
);
