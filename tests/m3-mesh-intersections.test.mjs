import { expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, BufferAttribute, Vector3 } from "three";
import { MeshBVH, ExtendedTriangle } from "three-mesh-bvh";
import {
  invalidTriangleIntersection,
  verifyIntersectionControls,
  verifyMeshIntersections,
} from "./m3-mesh-intersections.mjs";
it("calibrates disjoint, shared-feature, transverse and coplanar cases", () =>
  expect(verifyIntersectionControls()).toBe(8));
it("checks closed triangulated surfaces without treating shared edges as intersections", () => {
  const geometry = new BoxGeometry(2, 2, 2).toNonIndexed();
  expect(
    verifyMeshIntersections(new MeshBVH(geometry, { targetLeafSize: 4 }))
      .invalidIntersections,
  ).toBe(0);
});
it("detects a crossing pair in exhaustive self-BVH traversal", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        0, 0, 0, 2, 0, 0, 0, 2, 0, 0.5, 0.5, -1, 0.5, 0.5, 1, 1, 0.5, 0,
      ]),
      3,
    ),
  );
  expect(
    verifyMeshIntersections(new MeshBVH(geometry, { targetLeafSize: 4 }))
      .invalidIntersections,
  ).toBe(1);
});

it("rejects coplanar T-junction contact beyond a shared vertex", () => {
  const tri = (p) => new ExtendedTriangle(...p.map((v) => new Vector3(...v)));
  expect(
    invalidTriangleIntersection(
      tri([
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
      ]),
      tri([
        [0, 0, 0],
        [1, 0, 0],
        [1, -1, 0],
      ]),
    ),
  ).toBe(true);
});
