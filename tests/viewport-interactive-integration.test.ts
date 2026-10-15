import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import type { InteractiveAlignmentState } from "../src/interactive-alignment-session";
const pose = (x: number) => [1, 0, 0, x, 0, 1, 0, 0, 0, 0, 1, 0];
it("ends a captured gizmo gesture without submitting an extra movement on mouse-up", () => {
  const view = Object.create(Viewport.prototype) as any;
  const drag = { move: vi.fn(), end: vi.fn() };
  Object.assign(view, {
    interactivePointer: 3,
    interactiveDrag: drag,
    releaseInteractivePointer: vi.fn(),
  });
  const event = {
    pointerId: 3,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
  view.pointerUp(event);
  expect(drag.move).not.toHaveBeenCalled();
  expect(drag.end).toHaveBeenCalledOnce();
  expect(view.releaseInteractivePointer).toHaveBeenCalledOnce();
});
it("only releases cursor and capture owned by Interactive alignment", () => {
  const view = Object.create(Viewport.prototype) as any;
  const canvas = {
    style: { cursor: "crosshair" },
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  };
  view.renderer = { domElement: canvas };
  view.releaseInteractivePointer();
  expect(canvas.style.cursor).toBe("crosshair");
  expect(canvas.releasePointerCapture).not.toHaveBeenCalled();
  view.interactivePointer = 7;
  view.interactiveCursor = true;
  view.releaseInteractivePointer();
  expect(canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
  expect(canvas.style.cursor).toBe("");
  expect(view.interactivePointer).toBeUndefined();
  expect(view.interactiveCursor).toBe(false);
});
it("publishes a pose to canvas and agent picking without rebuilding geometry, and restores bounds on cancel", () => {
  const view = Object.create(Viewport.prototype) as any;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.userData.entityId = "scan";
  mesh.position.x = 2;
  mesh.updateMatrixWorld();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  Object.assign(view, {
    objects: new Map([["scan", { mesh }]]),
    camera,
    bounds: new THREE.Box3(
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(3, 1, 0),
    ),
    controls: { target: new THREE.Vector3() },
    container: { clientWidth: 800, clientHeight: 600 },
    invalidate: vi.fn(),
    advanceViewTransition: vi.fn(),
  });
  try {
    view.setInteractivePreview({
      targets: [{ entityId: "scan", matrix: pose(0) }],
    } as unknown as InteractiveAlignmentState);
    expect(view.pickAgentView(0.55, 0.45, 1).hits[0]?.entityId).toBe("scan");
    expect(view.inspectAgentView().bounds).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 0],
    });
    expect(view.interactiveViewFrame().matrix).toHaveLength(12);
    const drag = view.interactiveDragInput({
      handle: 4,
      from: [0.5, 0.5],
      to: [0.6, 0.5],
      pivot: [0, 0, 0],
      strength: 100,
    });
    expect(drag.mode).toBe(4);
    expect(drag.delta[0]).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++)
      view.setInteractivePreview({
        targets: [{ entityId: "scan", matrix: pose(0) }],
      } as unknown as InteractiveAlignmentState);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.geometry.getAttribute("position").array).toBe(positions);
    view.setInteractivePreview(null);
    expect(mesh.matrixAutoUpdate).toBe(true);
    expect(mesh.matrix.elements[12]).toBe(2);
    expect(view.inspectAgentView().bounds).toEqual({
      min: [2, 0, 0],
      max: [3, 1, 0],
    });
  } finally {
    geometry.dispose();
    mesh.material.dispose();
  }
});
it("restores exact cached cloud bounds instead of expanding them from transformed box corners on cancel", () => {
  const view = Object.create(Viewport.prototype) as any;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeRotationZ(Math.PI / 4);
  mesh.updateMatrixWorld();
  const original = new THREE.Box3().setFromPoints(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ].map((p) => p.applyMatrix4(mesh.matrix)),
  );
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  camera.position.z = 2;
  camera.updateMatrixWorld();
  Object.assign(view, {
    objects: new Map([["cloud", { mesh }]]),
    bounds: original.clone(),
    camera,
    invalidate: vi.fn(),
  });
  try {
    view.setInteractivePreview({
      targets: [{ entityId: "cloud", matrix: pose(0) }],
    });
    view.setInteractivePreview(null);
    expect(view.bounds).toEqual(original);
  } finally {
    geometry.dispose();
    mesh.material.dispose();
  }
});

it("uses measured target bounds instead of rotating their local boxes and preserves static cloud bounds", () => {
  const view = Object.create(Viewport.prototype) as any;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.computeBoundingBox();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData.entityId = "scan";
  const cloud = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  cloud.userData.entityId = "cloud";
  cloud.rotation.z = Math.PI / 4;
  cloud.updateMatrixWorld();
  const cloudBounds = new THREE.Box3(
    new THREE.Vector3(-0.7071068, 0, 0),
    new THREE.Vector3(0.7071068, 0.7071068, 0),
  );
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  camera.position.z = 2;
  camera.updateMatrixWorld();
  Object.assign(view, {
    objects: new Map([
      ["scan", { mesh }],
      ["cloud", { mesh: cloud, worldBounds: cloudBounds }],
    ]),
    bounds: new THREE.Box3(),
    camera,
    invalidate: vi.fn(),
  });
  try {
    view.setInteractivePreview({
      targets: [{ entityId: "scan", matrix: pose(2) }],
      bounds: [{ min: [2, 0, 0], max: [3, 1, 0] }],
    });
    expect(view.bounds.min.toArray()).toEqual([-0.7071068, 0, 0]);
    expect(view.bounds.max.toArray()).toEqual([3, 1, 0]);
  } finally {
    geometry.dispose();
    mesh.material.dispose();
    cloud.material.dispose();
  }
});
