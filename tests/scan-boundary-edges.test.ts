import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { createScanBoundaryEdges } from "../src/scan-boundary-edges";
import { Viewport } from "../src/viewport";
it("renders closed rims as dark line segments with a muted casing and no mesh faces", () => {
  const group = createScanBoundaryEdges([
    { points: [0, 0, 0, 1, 0, 0, 1, 1, 0], closed: true },
  ]);
  expect(group.children).toHaveLength(2);
  for (const child of group.children as any[]) {
    expect(child.type).toBe("LineSegments2");
    expect(child.geometry.getAttribute("instanceStart").count).toBe(3);
    expect(child.material.depthTest).toBe(true);
  }
  expect((group.children[1] as any).material.color.getHexString()).toBe(
    "172126",
  );
});
it("leaves open chains open and avoids duplicate closing edges", () => {
  const path = [0, 0, 0, 1, 0, 0, 1, 1, 0];
  expect(
    (
      createScanBoundaryEdges([{ points: path, closed: false }])
        .children[0] as any
    ).geometry.getAttribute("instanceStart").count,
  ).toBe(2);
  expect(
    (
      createScanBoundaryEdges([{ points: [...path, 0, 0, 0], closed: true }])
        .children[0] as any
    ).geometry.getAttribute("instanceStart").count,
  ).toBe(3);
});
it("clears and disposes stale edge overlays without modifying the triangle selection", () => {
  const view = Object.create(Viewport.prototype) as any;
  const triangleSelection = new THREE.Group();
  const marker = new THREE.Mesh();
  triangleSelection.add(marker);
  Object.assign(view, {
    boundaryEdges: new THREE.Group(),
    triangleSelection,
    objects: new Map(),
    invalidate: vi.fn(),
  });
  view.setBoundaryEdges([{ points: [0, 0, 0, 1, 0, 0], closed: false }]);
  const first = view.boundaryEdges.children[0];
  const disposed = vi.spyOn(first.geometry, "dispose");
  view.setBoundaryEdges([]);
  expect(disposed).toHaveBeenCalledOnce();
  expect(view.boundaryEdges.children).toHaveLength(0);
  expect(triangleSelection.children).toEqual([marker]);
});
