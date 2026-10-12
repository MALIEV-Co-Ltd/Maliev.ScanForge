import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { updateSurfaceOrbit } from "../src/camera-navigation";

function fixture(orthographic = false) {
  const camera = orthographic
    ? new THREE.OrthographicCamera(-5, 5, 5, -5, 0.01, 100)
    : new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const target = new THREE.Vector3();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(8, 8, 2),
    new THREE.MeshStandardMaterial(),
  );
  mesh.updateMatrixWorld();
  const view = Object.create(Viewport.prototype) as any;
  const controls = {
    target,
    enabled: true,
    noRotate: false,
    mouseButtons: {},
    update: vi.fn(),
    rotateSpeed: 1,
    zoomSpeed: 1,
    panSpeed: 1,
  };
  Object.assign(view, {
    camera,
    controls,
    raycaster: new THREE.Raycaster(),
    objects: new Map([["mesh", { mesh }]]),
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 200,
          height: 200,
        }),
      },
    },
    beginSketchDrag: vi.fn(() => false),
    cancelViewTransition: vi.fn(),
    invalidate: vi.fn(),
    pointer: null,
  });
  return { view, camera, target, controls, mesh };
}

const down = (overrides = {}) => ({
  button: 1,
  pointerId: 7,
  pointerType: "mouse",
  clientX: 140,
  clientY: 100,
  ctrlKey: false,
  shiftKey: false,
  ...overrides,
});

it.each([false, true])(
  "picks the visible mesh at middle-down without a camera jump (ortho: %s)",
  (ortho) => {
    const { view, camera, target, mesh } = fixture(ortho);
    const position = camera.position.clone(),
      orientation = camera.quaternion.clone();
    view.pointerDown(down());
    const pivot = view.mouseOrbitPivot.clone();
    expect(pivot.x).toBeGreaterThan(1);
    expect(pivot.z).toBeCloseTo(1);
    expect(view.mouseOrbitPointer).toBe(7);
    expect(camera.position.equals(position)).toBe(true);
    expect(camera.quaternion.equals(orientation)).toBe(true);
    expect(target.toArray()).toEqual([0, 0, 0]);
    view.navigationCursor = { clientX: 20, clientY: 20 };
    expect(view.mouseOrbitPivot.equals(pivot)).toBe(true);
    view.pointerUp({ pointerId: 7 });
    expect(view.mouseOrbitPointer).toBeUndefined();
    mesh.visible = false;
    view.pointerDown(down({ pointerId: 8 }));
    expect(view.mouseOrbitPivot.equals(pivot)).toBe(true);
  },
);

it.each([{ ctrlKey: true }, { shiftKey: true }, { metaKey: true }])(
  "does not establish a rotation gesture for modified middle-drag %o",
  (modifiers) => {
    const { view } = fixture();
    view.pointerDown(down(modifiers));
    expect(view.mouseOrbitPointer).toBeUndefined();
  },
);

it("ignores clipped surfaces when choosing the pivot", () => {
  const { view, mesh } = fixture();
  mesh.material.clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -100),
  ];
  view.pointerDown(down());
  expect(view.mouseOrbitPivot).toBeUndefined();
});

it.each([false, true])(
  "keeps an off-centre surface under the cursor across successive rotations (ortho: %s)",
  (ortho) => {
    const { camera, target } = fixture(ortho);
    const pivot = new THREE.Vector3(2, 1, 1);
    const before = pivot.clone().project(camera),
      distance = camera.position.distanceTo(pivot);
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0.08,
    );
    for (let i = 0; i < 20; i++) {
      updateSurfaceOrbit(camera, target, pivot, () => {
        camera.position.sub(target).applyQuaternion(rotation).add(target);
        camera.up.applyQuaternion(rotation);
        camera.lookAt(target);
        camera.updateMatrixWorld();
      });
      expect(pivot.clone().project(camera).distanceTo(before)).toBeLessThan(
        1e-10,
      );
      expect(camera.position.distanceTo(pivot)).toBeCloseTo(distance, 10);
    }
  },
);

it("flushes pending orbit movement on release and then stops using the pivot", () => {
  const { view, controls } = fixture();
  view.pointerDown(down());
  view.endMouseOrbit();
  expect(controls.update).toHaveBeenCalledTimes(1);
  expect(view.mouseOrbitPointer).toBeUndefined();
  view.endMouseOrbit();
  expect(controls.update).toHaveBeenCalledTimes(1);
});
