import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { InteractivePosePreview } from "../src/viewport-interactive-preview";
import { pickCamera } from "../src/viewport-agent";
it("updates GPU poses without replacing geometry and restores the exact original transform on cancel", () => {
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
  mesh.position.set(2, 0, 0);
  mesh.updateMatrixWorld();
  const original = mesh.matrix.clone();
  const changed = vi.fn();
  const preview = new InteractivePosePreview(
    new Map([["scan", mesh]]),
    changed,
  );
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  for (let i = 0; i < 100; i++)
    preview.show([
      { entityId: "scan", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] },
    ]);
  expect(mesh.geometry).toBe(geometry);
  expect(mesh.geometry.getAttribute("position").array).toBe(positions);
  expect(mesh.matrixAutoUpdate).toBe(false);
  expect(pickCamera(camera, [mesh], 0.55, 0.45, 1).hits[0]?.entityId).toBe(
    "scan",
  );
  preview.clear();
  expect(mesh.matrix.elements).toEqual(original.elements);
  expect(mesh.matrixAutoUpdate).toBe(true);
  expect(changed).toHaveBeenCalledTimes(101);
  geometry.dispose();
  mesh.material.dispose();
});
it("validates the entire target set before touching any display object", () => {
  const mesh = new THREE.Mesh();
  const preview = new InteractivePosePreview(
    new Map([["scan", mesh]]),
    () => {},
  );
  expect(() =>
    preview.show([
      { entityId: "scan", matrix: [1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 1, 0] },
      { entityId: "missing", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] },
    ]),
  ).toThrow();
  expect(mesh.matrixAutoUpdate).toBe(true);
  expect(mesh.matrix.elements[12]).toBe(0);
});
