import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";

it("discards stale selection slots on geometry changes instead of uploading NaN vertices", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const triangleSelection = new THREE.Group();
  Object.assign(view, { triangleSelection, invalidate: vi.fn() });
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  view.setTriangleSelection(positions, new Uint8Array([1, 1]));
  expect(triangleSelection.children).toHaveLength(0);
  view.setTriangleSelection(positions, new Uint8Array([1]));
  expect(triangleSelection.children).toHaveLength(1);
  const mesh = triangleSelection.children[0] as THREE.Mesh;
  expect(
    Array.from(mesh.geometry.getAttribute("position").array).every(
      Number.isFinite,
    ),
  ).toBe(true);
  view.setTriangleSelection(positions, new Uint8Array([1, 1]));
  expect(triangleSelection.children).toHaveLength(0);
});
