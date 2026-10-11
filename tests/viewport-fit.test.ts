import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";

function fixture(aspect = 1) {
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 100000);
  camera.position.set(100, -100, 80);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3();
  const imported = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 40));
  imported.position.set(10000, 20000, 30000);
  const bounds = new THREE.Box3(
    new THREE.Vector3(-500, -500, -500),
    new THREE.Vector3(11000, 21000, 31000),
  );
  const view = Object.create(Viewport.prototype) as Viewport;
  const update = () => {
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };
  Object.assign(view, {
    camera,
    bounds,
    extent: bounds.getSize(new THREE.Vector3()).length(),
    objects: new Map([["imported", { mesh: imported }]]),
    controls: { target, update },
    invalidate: vi.fn(),
  });
  return { view, camera, target, imported, bounds };
}

describe("import camera fit", () => {
  it.each([0.4, 1, 2.5])(
    "frames the imported object instead of existing objects at aspect %s",
    (aspect) => {
      const { view, camera, target, imported } = fixture(aspect);
      const direction = camera.position.clone().normalize();
      view.fitView("imported");
      expect(target.toArray()).toEqual(imported.position.toArray());
      expect(
        camera.position.clone().sub(target).normalize().distanceTo(direction),
      ).toBeLessThan(1e-10);
      const box = new THREE.Box3().setFromObject(imported);
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const projected = new THREE.Vector3(x, y, z).project(camera);
            expect(Math.abs(projected.x)).toBeLessThan(1);
            expect(Math.abs(projected.y)).toBeLessThan(1);
            expect(Math.abs(projected.z)).toBeLessThan(1);
          }
      expect(camera.position.distanceTo(target)).toBeLessThan(300);
    },
  );
  it("retains whole-scene manual fit and ignores missing import targets", () => {
    const { view, camera, target, bounds } = fixture();
    const before = camera.position.clone();
    view.fitView("missing");
    expect(camera.position.equals(before)).toBe(true);
    view.fitView();
    expect(target.equals(bounds.getCenter(new THREE.Vector3()))).toBe(true);
  });
});
