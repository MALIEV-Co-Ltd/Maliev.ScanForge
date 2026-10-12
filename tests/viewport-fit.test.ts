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
  it("fits the empty origin using a default scale instead of the previous mesh", () => {
    const { view, camera, target } = fixture();
    Object.assign(view, { bounds: new THREE.Box3(), extent: 1000000 });
    camera.near = 10000;
    camera.far = 10001;
    view.fitView();
    expect(target.toArray()).toEqual([0, 0, 0]);
    expect(camera.position.length()).toBeGreaterThan(100);
    expect(camera.position.length()).toBeLessThan(300);
    expect(camera.near).toBe(0.01);
    expect(camera.far).toBe(10000);
    for (const point of [
      new THREE.Vector3(),
      new THREE.Vector3(50, 0, 0),
      new THREE.Vector3(0, 50, 0),
      new THREE.Vector3(0, 0, 50),
    ])
      expect(Math.abs(point.project(camera).z)).toBeLessThan(1);
  });
  it("restores the world up axis when leaving a sketch-normal camera view", () => {
    const { view, camera } = fixture();
    camera.up.set(0, 1, 0);
    view.setView("iso");
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
  });
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

it("fits only the selected triangles and falls back to the object for an empty mask", () => {
  const { view, target, imported } = fixture();
  const item = (view as any).objects.get("imported");
  item.positions = [
    0, 0, 0, 2, 0, 0, 0, 2, 0, 100, 100, 0, 102, 100, 0, 100, 102, 0,
  ];
  view.fitView("imported", new Uint8Array([1, 0]));
  expect(target.toArray()).toEqual([1, 1, 0]);
  view.fitView("imported", new Uint8Array(2));
  expect(target.toArray()).toEqual(imported.position.toArray());
});
