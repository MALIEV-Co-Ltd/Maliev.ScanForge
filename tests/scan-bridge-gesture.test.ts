import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";

function viewport() {
  const view = Object.create(Viewport.prototype) as any;
  const canvas = {
    style: {},
    dataset: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  };
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  Object.assign(view, {
    scene: new THREE.Scene(),
    renderer: { domElement: canvas },
    camera,
    bridgePreview: new THREE.Group(),
    objects: new Map(),
    controls: { enabled: true },
    raycaster: new THREE.Raycaster(),
    invalidate: vi.fn(),
    cancelViewTransition: vi.fn(),
  });
  return view;
}
const rim = { closed: true, points: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0] };
const event = (x: number, y: number, pointerId = 1) => ({
  clientX: x,
  clientY: y,
  pointerId,
  button: 0,
  buttons: 1,
  isPrimary: true,
  preventDefault: vi.fn(),
  stopImmediatePropagation: vi.fn(),
});

it("rejects clipped-away attachment edges and clips the facet preview like its source", () => {
  const view = viewport(),
    onGesture = vi.fn();
  const material = new THREE.MeshStandardMaterial({
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)],
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  view.selectedId = "source";
  view.objects.set("source", { mesh });
  view.setScanBridge({ boundary: rim, onGesture });
  expect(view.beginBridgeDrag(event(100, 150))).toBe(false);
  view.setBridgePreview(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0]));
  expect(view.bridgePreview.children[0].material.clippingPlanes).toEqual(
    material.clippingPlanes,
  );
  view.setBridgePreview();
  mesh.geometry.dispose();
  material.dispose();
});
it("captures an edge drag, previews the snapped opposite edge, and commits once on release", () => {
  const view = viewport(),
    onGesture = vi.fn();
  expect(typeof view.setScanBridge).toBe("function");
  view.setScanBridge({ boundary: rim, onGesture });
  view.pointerDown(event(100, 150));
  view.pointerMove(event(100, 50));
  expect(onGesture).toHaveBeenLastCalledWith("preview", 0, 2);
  view.pointerUp(event(100, 50));
  expect(onGesture).toHaveBeenLastCalledWith("commit", 0, 2);
  expect(view.controls.enabled).toBe(true);
  expect(view.renderer.domElement.releasePointerCapture).toHaveBeenCalledWith(
    1,
  );
});
it("cancels without commit when released off the rim or the tool closes", () => {
  const view = viewport(),
    onGesture = vi.fn();
  expect(typeof view.setScanBridge).toBe("function");
  view.setScanBridge({ boundary: rim, onGesture });
  view.pointerDown(event(100, 150));
  view.pointerUp(event(100, 100));
  expect(onGesture).toHaveBeenLastCalledWith("cancel", 0, null);
  view.pointerDown(event(100, 150));
  view.setScanBridge(null);
  expect(onGesture.mock.calls.some(([phase]) => phase === "commit")).toBe(
    false,
  );
  expect(view.controls.enabled).toBe(true);
});
it("does not attach a bridge to a boundary hidden behind another surface", () => {
  const view = viewport(),
    onGesture = vi.fn();
  expect(typeof view.setScanBridge).toBe("function");
  const blocker = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial(),
  );
  blocker.position.z = 1;
  blocker.updateMatrixWorld();
  view.objects.set("blocker", { mesh: blocker });
  view.setScanBridge({ boundary: rim, onGesture });
  expect(view.beginBridgeDrag(event(100, 150))).toBe(false);
  expect(onGesture).not.toHaveBeenCalled();
  blocker.geometry.dispose();
  blocker.material.dispose();
});
