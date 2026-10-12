import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { NavigationPivot } from "../src/navigation-pivot";
import { navigateCamera } from "../src/camera-navigation";
import { Viewport } from "../src/viewport";

const scene = new THREE.Box3(
  new THREE.Vector3(-40, -20, 0),
  new THREE.Vector3(40, 20, 60),
);
const selection = new THREE.Box3(
  new THREE.Vector3(10, 20, 30),
  new THREE.Vector3(30, 40, 50),
);

it("shows the pivot marker at the projected object center only during navigation", () => {
  const view = Object.create(Viewport.prototype);
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.01, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
  mesh.position.set(20, 10, 0);
  const pivot = new NavigationPivot();
  const marker = { hidden: true, style: { left: "", top: "" } };
  Object.assign(view, {
    camera,
    bounds: scene,
    selectedId: "scan",
    objects: new Map([["scan", { mesh }]]),
    controls: { target: new THREE.Vector3(), update: vi.fn() },
    navigationPivot: pivot,
    pivotMarker: marker,
    container: { clientWidth: 1000, clientHeight: 500 },
    cancelViewTransition: vi.fn(),
    invalidate: vi.fn(),
  });
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  try {
    view.navigate({ translation: [0, 0, 0], rotation: [0, 0, 1] }, 0.05);
    expect(pivot.point.toArray()).toEqual([20, 10, 0]);
    const projected = pivot.point.clone().project(camera);
    expect(view.updateNavigationPivotMarker(110)).toBe(true);
    expect(marker.hidden).toBe(false);
    expect(parseFloat(marker.style.left)).toBeCloseTo((projected.x + 1) * 500);
    expect(parseFloat(marker.style.top)).toBeCloseTo((1 - projected.y) * 250);
    expect(view.updateNavigationPivotMarker(450)).toBe(false);
    expect(marker.hidden).toBe(true);
    // A hidden selected object must not determine the next gesture's center.
    mesh.visible = false;
    clock.mockReturnValue(500);
    view.navigate({ translation: [0, 0, 0], rotation: [0, 0, 1] }, 0.05);
    expect(pivot.point.toArray()).toEqual([0, 0, 0]);
  } finally {
    clock.mockRestore();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
});

it("uses the selected object's center, otherwise the scene center or origin", () => {
  const pivot = new NavigationPivot();
  expect(pivot.update(0, scene, selection).toArray()).toEqual([20, 30, 40]);
  expect(pivot.update(400, scene).toArray()).toEqual([0, 0, 30]);
  expect(pivot.update(800, new THREE.Box3()).toArray()).toEqual([0, 0, 0]);
});

it("keeps the pivot fixed throughout a gesture and releases it after rest", () => {
  const pivot = new NavigationPivot();
  pivot.update(0, scene, selection);
  expect(pivot.update(300, scene).toArray()).toEqual([20, 30, 40]);
  expect(pivot.active(649)).toBe(true);
  expect(pivot.active(650)).toBe(false);
  expect(pivot.update(650, scene).toArray()).toEqual([0, 0, 30]);
});

it.each([false, true])(
  "orbits around the fixed scene center after panning (%s orthographic)",
  (orthographic) => {
    const camera = orthographic
      ? new THREE.OrthographicCamera(-5, 5, 5, -5)
      : new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const target = new THREE.Vector3();
    const pivot = new THREE.Vector3();
    navigateCamera(
      camera,
      target,
      { translation: [1, 0, 0], rotation: [0, 0, 0] },
      0.05,
      pivot,
    );
    const before = camera.position.clone();
    const targetBefore = target.clone();
    const orbit = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -0.07,
    );
    navigateCamera(
      camera,
      target,
      { translation: [0, 0, 0], rotation: [0, 0, 1] },
      0.05,
      pivot,
    );
    expect(
      camera.position.distanceTo(before.applyQuaternion(orbit)),
    ).toBeLessThan(1e-10);
    expect(target.distanceTo(targetBefore.applyQuaternion(orbit))).toBeLessThan(
      1e-10,
    );
    expect(camera.position.distanceTo(target)).toBeCloseTo(10);
    expect(pivot.toArray()).toEqual([0, 0, 0]);
  },
);

it("simultaneously pans and orbits about a nonzero object pivot without moving it", () => {
  const camera = new THREE.PerspectiveCamera();
  const pivot = new THREE.Vector3(20, 30, 40);
  const target = pivot.clone();
  camera.position.copy(pivot).add(new THREE.Vector3(0, 0, 10));
  camera.lookAt(target);
  const orbit = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -0.07,
  );
  navigateCamera(
    camera,
    target,
    { translation: [1, 0, 0], rotation: [1, 0, 0] },
    0.05,
    pivot,
  );
  expect(
    camera.position.distanceTo(
      new THREE.Vector3(-0.4, 0, 10).applyQuaternion(orbit).add(pivot),
    ),
  ).toBeLessThan(1e-10);
  expect(
    target.distanceTo(
      new THREE.Vector3(-0.4, 0, 0).applyQuaternion(orbit).add(pivot),
    ),
  ).toBeLessThan(1e-10);
  expect(pivot.toArray()).toEqual([20, 30, 40]);
});

function cursorFixture() {
  const view = Object.create(Viewport.prototype);
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.01, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(40, 40, 10),
    new THREE.MeshStandardMaterial(),
  );
  const pivot = new NavigationPivot();
  const triangles = new THREE.Group();
  const selection = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  selection.position.set(-10, 0, 0);
  triangles.add(selection);
  Object.assign(view, {
    camera,
    bounds: scene,
    selectedId: "scan",
    objects: new Map([["scan", { mesh }]]),
    triangleSelection: triangles,
    raycaster: new THREE.Raycaster(),
    navigationCursor: { clientX: 600, clientY: 250 },
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 1000,
          bottom: 500,
          width: 1000,
          height: 500,
        }),
      },
    },
    controls: { target: new THREE.Vector3(), update: vi.fn() },
    navigationPivot: pivot,
    cancelViewTransition: vi.fn(),
    invalidate: vi.fn(),
    holdMenu: undefined,
    originPicking: false,
    pointer: null,
    paintOverlay: { style: {} },
  });
  return {
    view,
    pivot,
    mesh,
    triangles,
    dispose: () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      selection.geometry.dispose();
      (selection.material as THREE.Material).dispose();
    },
  };
}

it("uses the cursor surface ahead of selected facets and raycasts only at gesture start", () => {
  const { view, pivot, dispose } = cursorFixture();
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const raycast = vi.spyOn(view.raycaster, "intersectObjects");
  try {
    const motion = { translation: [0, 0, 0], rotation: [0, 0, 1] };
    view.navigate(motion, 0.05);
    expect(pivot.point.x).toBeCloseTo(10);
    expect(pivot.point.z).toBeCloseTo(5);
    const fixed = pivot.point.clone();
    view.navigationCursor = { clientX: 400, clientY: 250 };
    clock.mockReturnValue(200);
    view.navigate(motion, 0.05);
    expect(pivot.point.equals(fixed)).toBe(true);
    expect(raycast).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(600);
    view.navigate(motion, 0.05);
    expect(raycast).toHaveBeenCalledTimes(2);
    expect(pivot.point.equals(fixed)).toBe(false);
  } finally {
    clock.mockRestore();
    dispose();
  }
});

it("falls back to selected facets, object, visible scene, then origin after cursor leave", () => {
  const { view, pivot, mesh, triangles, dispose } = cursorFixture();
  const other = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4));
  other.position.set(30, 10, 0);
  view.objects.set("other", { mesh: other });
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const motion = { translation: [0, 0, 0], rotation: [0, 0, 1] };
  try {
    view.navigationCursor = undefined;
    view.navigate(motion, 0.05);
    expect(pivot.point.toArray()).toEqual([-10, 0, 0]);
    triangles.clear();
    clock.mockReturnValue(400);
    view.navigate(motion, 0.05);
    expect(pivot.point.toArray()).toEqual([0, 0, 0]);
    mesh.visible = false;
    clock.mockReturnValue(800);
    view.navigate(motion, 0.05);
    expect(pivot.point.toArray()).toEqual([30, 10, 0]);
    other.visible = false;
    clock.mockReturnValue(1200);
    view.navigate(motion, 0.05);
    expect(pivot.point.toArray()).toEqual([0, 0, 0]);
  } finally {
    clock.mockRestore();
    dispose();
    other.geometry.dispose();
    (other.material as THREE.Material).dispose();
  }
});

it("does not use hidden, clipped, or off-canvas cursor hits", () => {
  const { view, mesh, dispose } = cursorFixture();
  try {
    mesh.visible = false;
    expect(view.navigationSurfacePoint()).toBeUndefined();
    mesh.visible = true;
    mesh.material.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
    ];
    expect(view.navigationSurfacePoint()).toBeUndefined();
    mesh.material.clippingPlanes = [];
    expect(view.navigationSurfacePoint()?.x).toBeCloseTo(10);
    view.navigationCursor.clientX = -1;
    expect(view.navigationSurfacePoint()).toBeUndefined();
  } finally {
    dispose();
  }
});

it("copies cursor points and ignores non-finite pivot candidates", () => {
  const pivot = new NavigationPivot();
  const surface = new THREE.Vector3(1, 2, 3);
  pivot.update(0, scene, selection, surface);
  surface.set(4, 5, 6);
  expect(pivot.point.toArray()).toEqual([1, 2, 3]);
  expect(
    pivot.update(400, scene, selection, new THREE.Vector3(NaN, 0, 0)).toArray(),
  ).toEqual([20, 30, 40]);
});
