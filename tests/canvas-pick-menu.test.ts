import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CanvasPickMenu, uniquePickChoices } from "../src/canvas-pick-menu";
import { Viewport } from "../src/viewport";
import { createOriginGeometry } from "../src/origin";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function rayFixture() {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const meshes = [
    "Front scan",
    "Rear scan",
    "Off pointer",
    "Invisible scan",
  ].map((name, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(5, 5, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    mesh.name = name;
    mesh.userData.entityId = String(i);
    mesh.position.set(i === 2 ? 8 : 0, 0, 30 - i * 10);
    mesh.visible = i !== 3;
    mesh.updateMatrixWorld();
    return mesh;
  });
  const view = Object.create(Viewport.prototype) as Viewport;
  const onSelect = vi.fn(),
    onPick = vi.fn();
  Object.assign(view, {
    camera,
    objects: new Map(meshes.map((mesh) => [mesh.userData.entityId, { mesh }])),
    raycaster: new THREE.Raycaster(),
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 400,
          height: 400,
        }),
      },
    },
    onSelect,
    onPick,
  });
  return { view, meshes, onSelect, onPick };
}
it("lists intersected objects through occluders once, in depth order, excluding other locations and invisible objects", () => {
  const { view, meshes, onSelect, onPick } = rayFixture();
  const choices = uniquePickChoices(
    view.selectionChoicesAt({ clientX: 200, clientY: 200 }),
  );
  expect(choices.map((choice) => choice.label)).toEqual([
    "Front scan",
    "Rear scan",
  ]);
  choices[1].choose();
  expect(onSelect).toHaveBeenCalledWith("1");
  expect(onPick.mock.calls[0][1]).toBe("1");
  expect(view.selectionChoicesAt({ clientX: 0, clientY: 0 })).toEqual([]);
  Object.assign(view, {
    clipping: true,
    clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -25),
  });
  expect(
    uniquePickChoices(
      view.selectionChoicesAt({ clientX: 200, clientY: 200 }),
    ).map((choice) => choice.label),
  ).toEqual(["Front scan"]);
  meshes.forEach((mesh) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});
it("offers overlapping origin planes and chooses a rear plane without selecting scan geometry", () => {
  const { view, meshes, onSelect } = rayFixture();
  const camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 1000);
  camera.position.set(60, -60, 60);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const origin = createOriginGeometry();
  origin.updateMatrixWorld(true);
  const onOriginPlane = vi.fn();
  Object.assign(view, {
    camera,
    originGeometry: origin,
    originPicking: true,
    onOriginPlane,
  });
  const choices = uniquePickChoices(
    view.selectionChoicesAt({ clientX: 200, clientY: 200 }),
  );
  expect(choices.map((choice) => choice.id).sort()).toEqual([
    "OXY",
    "OXZ",
    "OYZ",
  ]);
  choices.find((choice) => choice.id === "OYZ")!.choose();
  expect(onOriginPlane).toHaveBeenCalledWith("OYZ");
  expect(onSelect).not.toHaveBeenCalled();
  meshes.forEach((mesh) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  origin.traverse((child) => {
    const object = child as THREE.Mesh;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material?.dispose());
  });
});
it("cancels release, drag and disposal before doing a hold raycast", () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const choices = vi.fn(() => []);
  const menu = new CanvasPickMenu({} as HTMLElement, vi.fn(), vi.fn());
  menu.begin(100, 100, choices);
  vi.advanceTimersByTime(200);
  menu.cancelHold();
  vi.advanceTimersByTime(500);
  expect(choices).not.toHaveBeenCalled();
  menu.begin(100, 100, choices);
  menu.move(105, 100);
  vi.advanceTimersByTime(500);
  expect(choices).not.toHaveBeenCalled();
  menu.begin(100, 100, choices);
  menu.dispose();
  vi.advanceTimersByTime(500);
  expect(choices).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("checks the actual cursor position after the hold threshold and keeps blank space empty", () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const choices = vi.fn(() => []),
    opened = vi.fn();
  const menu = new CanvasPickMenu({} as HTMLElement, opened, vi.fn());
  menu.begin(100, 100, choices);
  vi.advanceTimersByTime(449);
  expect(choices).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(choices).toHaveBeenCalledOnce();
  expect(opened).not.toHaveBeenCalled();
  menu.dispose();
});
