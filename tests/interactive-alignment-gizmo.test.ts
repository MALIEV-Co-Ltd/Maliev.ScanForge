import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { InteractiveAlignmentGizmo } from "../src/interactive-alignment-gizmo";
import type { InteractiveAlignmentState } from "../src/interactive-alignment-session";
const state = { pivot: [0, 0, 0] } as InteractiveAlignmentState;
it("uses the native handle IDs, world planes and axes without authored geometry", () => {
  const gizmo = new InteractiveAlignmentGizmo();
  expect(
    [
      ...new Set(gizmo.group.children.map((c) => c.userData.interactiveHandle)),
    ].sort((a, b) => a - b),
  ).toEqual([1, 2, 3, 4, 5, 6, 10, 11, 12]);
  gizmo.show(state);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  gizmo.update(camera, 800);
  expect(gizmo.group.scale.x).toBeCloseTo(0.425);
  const handle = gizmo.group.children
    .filter((c) => c.userData.interactiveHandle === 4)
    .at(-1)!;
  const point = handle.position
    .clone()
    .applyMatrix4(gizmo.group.matrixWorld)
    .project(camera);
  expect(gizmo.pick(camera, [(point.x + 1) / 2, (1 - point.y) / 2])).toBe(4);
  gizmo.show(null);
  expect(gizmo.pick(camera, [0.5, 0.5])).toBeUndefined();
  gizmo.dispose();
});
it("keeps display buffers stable across pose frames and disposes each once", () => {
  const gizmo = new InteractiveAlignmentGizmo();
  const resources = gizmo.group.children.map((c) => c as THREE.Mesh);
  const disposed = resources.flatMap((m) => [
    vi.spyOn(m.geometry, "dispose"),
    vi.spyOn(m.material as THREE.Material, "dispose"),
  ]);
  for (let i = 0; i < 60; i++) gizmo.show({ ...state, pivot: [i, 0, 0] });
  expect(gizmo.group.children).toEqual(resources);
  expect(disposed.every((s) => s.mock.calls.length === 0)).toBe(true);
  gizmo.dispose();
  gizmo.dispose();
  expect(disposed.every((s) => s.mock.calls.length === 1)).toBe(true);
});
