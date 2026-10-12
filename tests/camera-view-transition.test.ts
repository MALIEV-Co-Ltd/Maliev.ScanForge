import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  adjacentViewPose,
  applyViewTransition,
  cameraOrientation,
  standardViewUp,
} from "../src/camera-gizmo";
import { Viewport } from "../src/viewport";

afterEach(() => vi.unstubAllGlobals());
function fixture(reduced = false) {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50);
  const target = new THREE.Vector3(10, 20, 30);
  camera.position.copy(target).add(new THREE.Vector3(80, -90, 70));
  camera.up.set(0, 0, 1);
  camera.lookAt(target);
  camera.zoom = 2;
  const view = Object.create(Viewport.prototype) as Viewport;
  Object.assign(view, {
    camera,
    controls: { target, update: () => camera.updateMatrixWorld() },
    invalidate: vi.fn(),
  });
  return { view, camera, target };
}
describe("CAD view orientation and transitions", () => {
  it("removes arbitrary roll when selecting Top and Bottom from a rolled camera", () => {
    const { view, camera, target } = fixture(true);
    camera.up.set(1, 2, 3).normalize();
    camera.lookAt(target);
    for (const [face, z, y] of [
      ["top", 1, 1],
      ["bottom", -1, -1],
    ] as const) {
      view.setView(face);
      expect(camera.position.clone().sub(target).normalize().toArray()).toEqual(
        [0, 0, z],
      );
      expect(camera.up.toArray()).toEqual([0, y, 0]);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(
        camera.quaternion.clone().invert(),
      );
      expect(x.x).toBeCloseTo(1);
      expect(x.y).toBeCloseTo(0);
    }
  });
  it("animates an orbit without jumping or changing center, distance or zoom", () => {
    const { view, camera, target } = fixture();
    const before = camera.quaternion.clone();
    const distance = camera.position.distanceTo(target);
    view.setView("top");
    expect(camera.quaternion.equals(before)).toBe(true);
    const transition = (
      view as unknown as { viewTransition: { start: number } }
    ).viewTransition;
    view.advanceViewTransition(transition.start + 160);
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.1);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 10);
    expect(camera.zoom).toBe(2);
    view.advanceViewTransition(transition.start + 320);
    expect(
      camera.quaternion.angleTo(
        cameraOrientation(
          new THREE.Vector3(0, 0, 1),
          standardViewUp(new THREE.Vector3(0, 0, 1)),
        ),
      ),
    ).toBeLessThan(1e-7);
    expect(target.toArray()).toEqual([10, 20, 30]);
  });
  it("retargets an unfinished transition from the currently displayed pose", () => {
    const { view, camera } = fixture();
    view.setView("top");
    const first = (view as unknown as { viewTransition: { start: number } })
      .viewTransition;
    view.advanceViewTransition(first.start + 100);
    const current = camera.quaternion.clone();
    view.setView("front");
    expect(camera.quaternion.equals(current)).toBe(true);
    const second = (view as unknown as { viewTransition: { start: number } })
      .viewTransition;
    view.advanceViewTransition(second.start + 320);
    expect(
      camera.quaternion.angleTo(
        cameraOrientation(
          new THREE.Vector3(0, -1, 0),
          new THREE.Vector3(0, 0, 1),
        ),
      ),
    ).toBeLessThan(1e-7);
  });
  it("chooses adjacent views in screen space even after a quarter-turn roll", () => {
    const q = cameraOrientation(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
    );
    const right = adjacentViewPose(q, "right");
    expect(
      right.direction.distanceTo(new THREE.Vector3(0, -1, 0)),
    ).toBeLessThan(1e-7);
    expect(right.up.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-7);
    const up = adjacentViewPose(q, "up");
    expect(up.direction.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(
      1e-7,
    );
    expect(up.up.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-7);
  });
  it("keeps opposite-face transitions away from the orbit center", () => {
    const camera = new THREE.OrthographicCamera();
    const target = new THREE.Vector3(100, 200, 300);
    const from = cameraOrientation(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
    );
    const to = cameraOrientation(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    );
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      applyViewTransition(camera, target, from, to, 50, progress);
      expect(camera.position.distanceTo(target)).toBeCloseTo(50, 10);
      expect(
        new THREE.Vector3(0, 0, -1)
          .applyQuaternion(camera.quaternion)
          .distanceTo(target.clone().sub(camera.position).normalize()),
      ).toBeLessThan(1e-7);
    }
  });
});
