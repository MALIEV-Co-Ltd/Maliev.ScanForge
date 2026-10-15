import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { InteractiveMirrorController } from "../src/interactive-mirror-controller";
import { nativeInteractiveMirrorDirection } from "../src/interactive-mirror-view";
const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function fixture() {
  const view = Object.create(Viewport.prototype) as any;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.computeBoundingBox();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(2, -4, 3);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  Object.assign(view, {
    objects: new Map([["scan", { mesh }]]),
    camera,
    controls: { target: new THREE.Vector3() },
    bounds: geometry.boundingBox!.clone(),
    container: { clientWidth: 800, clientHeight: 600 },
    scene: new THREE.Scene(),
    invalidate: vi.fn(),
    advanceViewTransition: vi.fn(),
  });
  return {
    view,
    mesh,
    dispose: () => {
      geometry.dispose();
      mesh.material.dispose();
    },
  };
}
it("forwards the recovered view direction and mesh poses, including camera updates, without rebuilding source geometry", () => {
  const { view, mesh, dispose } = fixture();
  const update = vi
    .spyOn(InteractiveMirrorController.prototype, "update")
    .mockImplementation(() => {});
  const backend = { entityIds: ["scan"], source: vi.fn(), prepare: vi.fn() };
  try {
    view.installInteractiveMirror(backend);
    view.setInteractivePreview({
      targets: [{ entityId: "scan", matrix: pose }],
      mirror: true,
      mirrorPlane: 2,
    });
    const frame = view.interactiveViewFrame();
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        plane: 2,
        poses: [{ entityId: "scan", matrix: pose }],
        settings: expect.objectContaining({
          direction: nativeInteractiveMirrorDirection(
            frame.matrix,
            frame.anchor,
          ),
        }),
      }),
    );
    const geometry = mesh.geometry;
    view.camera.position.set(-4, 2, 1);
    view.camera.lookAt(0, 0, 0);
    view.updateInteractiveMirror();
    const next = view.interactiveViewFrame();
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          direction: nativeInteractiveMirrorDirection(next.matrix, next.anchor),
        }),
      }),
    );
    expect(mesh.geometry).toBe(geometry);
    expect(view.inspectAgentView().interactiveMirror).toMatchObject({
      active: false,
      pending: false,
    });
    view.setInteractivePreview(null);
    expect(update).toHaveBeenLastCalledWith(null);
    view.installInteractiveMirror(null);
    expect(view.interactiveMirror).toBeUndefined();
  } finally {
    update.mockRestore();
    dispose();
  }
});
it("rejects mirror enablement without a borrowed session backend before changing author display matrices", () => {
  const { view, mesh, dispose } = fixture();
  try {
    expect(() =>
      view.setInteractivePreview({
        targets: [
          { entityId: "scan", matrix: pose.map((v, i) => (i === 3 ? 42 : v)) },
        ],
        mirror: true,
      }),
    ).toThrow(/backend/i);
    expect(mesh.matrixAutoUpdate).toBe(true);
    expect(mesh.matrix.elements[12]).toBe(0);
  } finally {
    dispose();
  }
});

it("keeps reflected scans inside the render depth range without changing native alignment bounds", () => {
  const { view, dispose } = fixture();
  const update = vi
    .spyOn(InteractiveMirrorController.prototype, "update")
    .mockImplementation(() => {});
  try {
    view.camera.position.set(20010, 0, 0);
    view.controls.target.set(20000, 0, 0);
    view.camera.lookAt(view.controls.target);
    view.camera.updateMatrixWorld();
    view.installInteractiveMirror({
      entityIds: ["scan"],
      source: vi.fn(),
      prepare: vi.fn(),
    });
    view.setInteractivePreview({
      targets: [
        { entityId: "scan", matrix: pose.map((v, i) => (i === 3 ? 20000 : v)) },
      ],
      bounds: [{ min: [20000, 0, 0], max: [20001, 1, 0] }],
      mirror: true,
      mirrorPlane: 1,
    });
    const reflected = new THREE.Vector3(-20000.5, 0.5, 0).project(view.camera);
    expect(reflected.z).toBeGreaterThanOrEqual(-1);
    expect(reflected.z).toBeLessThanOrEqual(1);
    expect(view.bounds.min.toArray()).toEqual([20000, 0, 0]);
    expect(view.bounds.max.toArray()).toEqual([20001, 1, 0]);
    view.setInteractivePreview(null);
    expect(view.interactiveMirrorClipBounds).toBeUndefined();
  } finally {
    view.installInteractiveMirror(null);
    update.mockRestore();
    dispose();
  }
});
