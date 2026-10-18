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
    mouseButtons: {} as Partial<
      Record<"LEFT" | "MIDDLE" | "RIGHT", THREE.MOUSE>
    >,
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
    navigationDepthPoint: vi.fn(),
    navigationPivot: { active: () => false, point: new THREE.Vector3() },
    pivotMarker: { hidden: true, style: {} },
    container: { clientWidth: 200, clientHeight: 200 },
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
  "captures a stable surface pivot for ordinary left-drag (ortho: %s)",
  (ortho) => {
    const { view, camera, target, controls } = fixture(ortho);
    const before = camera.position.clone();
    view.pointerDown(down({ button: 0 }));
    expect(view.mouseOrbitPointer).toBe(7);
    expect(view.mouseOrbitPivot.x).toBeGreaterThan(1);
    expect(camera.position.equals(before)).toBe(true);
    expect(target.toArray()).toEqual([0, 0, 0]);
    view.navigationCursor = { clientX: 20, clientY: 20 };
    const pivot = view.mouseOrbitPivot.clone();
    const screen = pivot.clone().project(camera);
    controls.update.mockImplementation(() => {
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        0.2,
      );
      camera.position.sub(target).applyQuaternion(rotation).add(target);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    });
    view.updateControls();
    expect(camera.position.equals(before)).toBe(false);
    expect(pivot.clone().project(camera).distanceTo(screen)).toBeLessThan(
      1e-10,
    );
    expect(view.mouseOrbitPivot.equals(pivot)).toBe(true);
    view.pointerUp({ pointerId: 7 });
    expect(view.mouseOrbitPointer).toBeUndefined();
  },
);

it("uses the view-center surface for left-drag starting in empty space", () => {
  const { view, mesh } = fixture();
  mesh.scale.setScalar(0.3);
  view.pointerDown(down({ button: 0, clientX: 199, clientY: 1 }));
  expect(view.mouseOrbitPivot.x).toBeCloseTo(0);
  expect(view.mouseOrbitPivot.y).toBeCloseTo(0);
  expect(view.mouseOrbitPivot.z).toBeCloseTo(0.3);
});

it("starts camera gestures without a full mesh scan while the surface index is unavailable", () => {
  const { view, mesh } = fixture();
  const surface = new THREE.Vector3(1, 0, 1);
  view.navigationDepthPoint.mockReturnValue(surface);
  mesh.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(30_000), 1));
  const query = vi
    .spyOn(view.raycaster, "intersectObjects")
    .mockReturnValue([
      { point: new THREE.Vector3(1, 0, 1), object: mesh },
    ] as any);
  view.pointerDown(down());
  expect(query).not.toHaveBeenCalled();
  expect(view.mouseOrbitPointer).toBe(7);
  expect(view.navigationDepthPoint).toHaveBeenCalledOnce();
  expect(view.mouseOrbitPivot.toArray()).toEqual(surface.toArray());
  // Readiness restores exact surface pivots on the next gesture.
  mesh.geometry.boundsTree = {} as any;
  view.pointerDown(down({ pointerId: 8 }));
  expect(query).toHaveBeenCalledOnce();
  expect(view.mouseOrbitPivot.toArray()).toEqual([1, 0, 1]);
});

it.each([false, true])(
  "MCP surface rotation uses the same picked pivot (ortho: %s)",
  (ortho) => {
    const { view, camera, target } = fixture(ortho);
    view.bounds = new THREE.Box3();
    const surface = view.navigationSurfacePoint(
      false,
      new THREE.Vector2(0.4, 0),
    );
    expect(surface).toBeDefined();
    const before = surface.clone().project(camera);
    view.controlAgentView({
      action: "rotate",
      direction: "left",
      degrees: 25,
      x: 0.7,
      y: 0.5,
    });
    expect(surface.clone().project(camera).distanceTo(before)).toBeLessThan(
      1e-10,
    );
    expect(target.length()).toBeGreaterThan(0);
  },
);

it("avoids linear point-cloud navigation queries without changing ordinary point picking", () => {
  const { view, mesh } = fixture();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(90_000), 3),
  );
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial());
  view.objects.set("cloud", { mesh, pointCloud: cloud });
  const query = vi.spyOn(view.raycaster, "intersectObjects");
  view.pointerDown(down());
  expect(query).not.toHaveBeenCalled();
  expect(view.mouseOrbitPointer).toBe(7);
  geometry.dispose();
  cloud.material.dispose();
});

it.each([{ ctrlKey: true }, { shiftKey: true }, { metaKey: true }])(
  "leaves modified left-drag pan and zoom alone %o",
  (modifiers) => {
    const { view } = fixture();
    view.pointerDown(down({ button: 0, ...modifiers }));
    expect(view.mouseOrbitPointer).toBeUndefined();
  },
);

it("does not capture an orbit pivot for left-drag mesh selection", () => {
  const { view } = fixture();
  view.brushing = true;
  view.pointerDown(down({ button: 0 }));
  expect(view.mouseOrbitPointer).toBeUndefined();
});

it("hides the SpaceMouse marker during mouse orbit, even if its gesture is still active", () => {
  const { view } = fixture();
  view.navigationPivot = { active: () => true, point: new THREE.Vector3() };
  view.pivotMarker = { hidden: false, style: {} };
  view.container = { clientWidth: 200, clientHeight: 200 };
  view.pointerDown(down({ button: 0 }));
  view.updateNavigationPivotMarker(0);
  expect(view.pivotMarker.hidden).toBe(true);
});

it.each([false, true])(
  "shows the actual middle-button pivot and hides it on release (ortho: %s)",
  (ortho) => {
    const { view } = fixture(ortho);
    view.pointerDown(down());
    view.updateNavigationPivotMarker(0);
    expect(view.pivotMarker.hidden).toBe(false);
    expect(parseFloat(view.pivotMarker.style.left)).toBeCloseTo(140);
    expect(parseFloat(view.pivotMarker.style.top)).toBeCloseTo(100);
    expect(view.orbitCenterState(0)).toMatchObject({
      source: "mouse",
      point: view.mouseOrbitPivot.toArray(),
      markerVisible: true,
    });
    view.navigationCursor = { clientX: 20, clientY: 30 };
    view.updateNavigationPivotMarker(0);
    expect(parseFloat(view.pivotMarker.style.left)).toBeCloseTo(140);
    view.pointerUp({ pointerId: 7 });
    view.updateNavigationPivotMarker(0);
    expect(view.pivotMarker.hidden).toBe(true);
    expect(view.orbitCenterState(0)).toMatchObject({
      source: null,
      point: null,
      markerVisible: false,
    });
  },
);

it("marks the actual target fallback, and hides an off-screen pivot", () => {
  const { view, mesh } = fixture();
  mesh.visible = false;
  view.pointerDown(down());
  view.updateNavigationPivotMarker(0);
  expect(view.pivotMarker.hidden).toBe(false);
  expect(view.orbitCenterState(0).point).toEqual([0, 0, 0]);
  view.mouseOrbitPivot = new THREE.Vector3(100, 0, 0);
  view.updateNavigationPivotMarker(0);
  expect(view.pivotMarker.hidden).toBe(true);
});

it("hides the middle-button marker on pointer cancellation", () => {
  const { view } = fixture();
  Object.assign(view, {
    cancelBridgeDrag: vi.fn(),
    releaseInteractivePointer: vi.fn(),
    cancelSketchDrag: vi.fn(),
    paintTrail: { setAttribute: vi.fn() },
    selectionOverlay: { hidden: false },
  });
  view.pointerDown(down());
  view.updateNavigationPivotMarker(0);
  expect(view.pivotMarker.hidden).toBe(false);
  view.pointerCancel();
  view.updateNavigationPivotMarker(0);
  expect(view.pivotMarker.hidden).toBe(true);
  expect(view.mouseOrbitButton).toBeUndefined();
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

it.each([false, true])(
  "right-button pan initializes mesh-edit sensitivity without an orbit pivot (ortho: %s)",
  (ortho) => {
    const { view, controls } = fixture(ortho);
    view.brushing = true;
    view.pointerDown(down({ button: 2 }));
    expect(controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.PAN);
    expect(controls.panSpeed).not.toBe(1);
    expect(view.mouseOrbitPointer).toBeUndefined();
    expect(view.rightPanPointer).toEqual({
      id: 7,
      x: 140,
      y: 100,
      moved: false,
    });
  },
);
