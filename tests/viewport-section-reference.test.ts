import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
it("renders actual and projected references separately and releases both on exit", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const section = new THREE.Group();
  Object.assign(view, { section, invalidate: vi.fn() });
  view.setSectionLines([0, 0, 10, 1, 1, 10], "#eeeeee", [0, 0, 0, 1, 1, 0]);
  expect(section.children).toHaveLength(2);
  const lines = section.children as THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >[];
  expect(lines.map((line) => line.material.color.getHexString())).toEqual([
    "eeeeee",
    "888888",
  ]);
  const releases = lines.map((line) => [
    vi.spyOn(line.geometry, "dispose"),
    vi.spyOn(line.material, "dispose"),
  ]);
  view.setSectionLines([]);
  expect(section.children).toHaveLength(0);
  for (const pair of releases)
    for (const release of pair) expect(release).toHaveBeenCalledOnce();
});
