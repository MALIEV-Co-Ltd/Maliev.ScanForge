import { expect, it } from "vitest";
import { analyzeIndexedMesh, analyzeMesh } from "../src/mesh-processing";

it("shows why matching expanded coordinates cannot establish original vertex identity", () => {
  // Two separate indexed faces have coincident edge coordinates but distinct IDs.
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 4, 3, 5]);
  const positions = Float32Array.from(
    Array.from(indices).flatMap((id) =>
      Array.from(vertices.slice(id * 3, id * 3 + 3)),
    ),
  );
  const retained = analyzeIndexedMesh(Float64Array.from(vertices), indices);
  const welded = analyzeMesh(positions);
  const expand = (topology: typeof retained) =>
    Array.from(topology.triangles).flatMap((id) =>
      Array.from(topology.vertices.slice(id * 3, id * 3 + 3)),
    );
  expect(expand(retained)).toEqual(Array.from(positions));
  expect(expand(welded)).toEqual(Array.from(positions));
  expect(retained.components).toHaveLength(2);
  expect(welded.components).toHaveLength(1);
});
