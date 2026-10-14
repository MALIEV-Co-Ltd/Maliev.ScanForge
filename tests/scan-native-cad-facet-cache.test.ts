import { expect, it } from "vitest";
import native from "./fixtures/alignment-cad-facet-cache-native.json";
import { nativeAlignmentFaceCache } from "../src/scan-native-alignment-face-cache";
import { prepareNativeAlignmentSurface } from "../src/scan-native-alignment-surface";

const bits = (values: Float32Array) =>
  Array.from(
    new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

it.each(native.cases)(
  "matches original populated CAD facet refresh: case $case attributes $flag",
  (sample) => {
    const vertices = Float32Array.from(sample.coordinates);
    const triangles = Uint32Array.from(sample.triangles);
    const result = nativeAlignmentFaceCache(vertices, triangles);
    expect(bits(result.normals)).toBe(sample.faceNormalBits);
    expect(Array.from(result.degenerate)).toEqual(sample.degenerate);
    const prepared = prepareNativeAlignmentSurface(vertices, triangles);
    expect(prepared).toBeDefined();
    expect(bits(prepared!.surface.normals)).toBe(sample.faceNormalBits);
    expect(Array.from(prepared!.degenerate)).toEqual(sample.degenerate);
    expect(Array.from(vertices)).toEqual(sample.coordinates);
    expect(Array.from(triangles)).toEqual(sample.triangles);
  },
);
