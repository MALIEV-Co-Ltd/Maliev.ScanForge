import { expect, it } from "vitest";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";

it("rejects a non-manifold source edge touched close to its corner", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]);
  const cutter = new Float32Array([0.0004, 0, 0, 0.4, 0.3, 0, 0.2, 0.15, 1]);
  expect(() =>
    refineFiniteCutterMesh(vertices, triangles, cutter, {
      preciseCoordinates: true,
    }),
  ).toThrow(/non.manifold/i);
});
