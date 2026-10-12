import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";

it("keeps an open scan facet selectable from both sides after geometry and display updates", () => {
  const scene = new THREE.Scene();
  const viewport = Object.create(Viewport.prototype) as Viewport;
  Object.assign(viewport, {
    selectedId: null,
    objects: new Map(),
    scene,
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    wireframe: false,
    clipping: false,
    invalidate: vi.fn(),
  });
  const scan: Entity = {
    id: "open-scan",
    name: "Open scan",
    kind: "mesh",
    positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
    color: "#aeb5b8",
    visible: true,
    opacity: 1,
  };
  try {
    for (const entity of [
      scan,
      { ...scan, positions: [...scan.positions], opacity: 0.5 },
    ]) {
      viewport.setEntities([entity], null);
      scene.updateMatrixWorld(true);
      const mesh = scene.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;
      expect(mesh.material.side).toBe(THREE.DoubleSide);
      for (const side of [-1, 1]) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(0, 0, side),
          new THREE.Vector3(0, 0, -side),
        );
        expect(ray.intersectObject(mesh)).toHaveLength(1);
      }
    }
  } finally {
    viewport.setEntities([], null);
  }
});
