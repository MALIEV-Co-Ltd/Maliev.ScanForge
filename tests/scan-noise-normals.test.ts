import { expect, it } from "vitest";
import { noiseNormals } from "../src/scan-native-noise";
import capture from "./fixtures/noise-normal-kernel.json";

it.each(capture.cases)(
  "matches original normal construction bytes for $label",
  ({ vertices, triangles, nativeNormals, nativeNormalBits }) => {
    const topology = {
      vertices: new Float64Array(vertices),
      triangles: new Uint32Array(triangles),
    };
    const result = noiseNormals(topology);
    expect(Array.from(result)).toEqual(nativeNormals);
    expect(
      Array.from(new Uint8Array(result.buffer), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(nativeNormalBits);
    expect(Array.from(topology.vertices)).toEqual(vertices);
    expect(Array.from(topology.triangles)).toEqual(triangles);
  },
);

it("rejects cancellation before computing or changing source geometry", () => {
  const source = capture.cases[0];
  const topology = {
    vertices: new Float64Array(source.vertices),
    triangles: new Uint32Array(source.triangles),
  };
  const controller = new AbortController();
  controller.abort();
  expect(() => noiseNormals(topology, { signal: controller.signal })).toThrow(
    "cancelled",
  );
  expect(Array.from(topology.vertices)).toEqual(source.vertices);
});
