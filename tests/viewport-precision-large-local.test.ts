/// <reference types="node" />
import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { cacheScanRenderData } from "../src/scan-render-data";
import type { Entity } from "../src/types";
it.skipIf(!process.env.SCANFORGE_M2_LARGE_VIEWPORT)(
  "builds a large precise viewport mesh under the job limit",
  () => {
    const count = 400000,
      positions = new Array<number>(count * 9),
      x = 100000000;
    for (let i = 0; i < count; i++) {
      const a = x + (i % 1000) * 8,
        b = Math.floor(i / 1000) * 8,
        j = i * 9;
      positions[j] = a;
      positions[j + 1] = b;
      positions[j + 2] = 0;
      positions[j + 3] = a + 4;
      positions[j + 4] = b;
      positions[j + 5] = 0;
      positions[j + 6] = a + 4;
      positions[j + 7] = b + 4;
      positions[j + 8] = 0;
    }
    cacheScanRenderData(positions, {
      bounds: [x, 0, 0, x + 7996, 3196, 0],
      radius: 5000,
      normals: new Float32Array(positions.length),
    });
    const entity: Entity = {
      id: "large",
      kind: "mesh",
      name: "large",
      positions,
      color: "#abcdef",
      visible: true,
      opacity: 1,
      meshSelection: { hidden: [], saved: [] },
    };
    const view = Object.create(Viewport.prototype) as Viewport,
      scene = new THREE.Scene();
    Object.assign(view, {
      selectedId: null,
      objects: new Map(),
      scene,
      camera: new THREE.OrthographicCamera(),
      bounds: new THREE.Box3(),
      grid: new THREE.Object3D(),
      triangleSelection: new THREE.Group(),
      invalidate: vi.fn(),
      theme: "dark",
      raycaster: new THREE.Raycaster(),
      clippingPlane: new THREE.Plane(),
    });
    try {
      view.setEntities([entity], entity.id);
      const mesh = scene.children.find(
        (o) => o instanceof THREE.Mesh,
      ) as THREE.Mesh;
      const attr = mesh.geometry.getAttribute("position");
      expect(attr.getX(1) - attr.getX(0)).toBe(4);
      expect((view as any).bounds.min.x).toBe(x);
      expect(positions[3]).toBe(x + 4);
    } finally {
      view.setEntities([], null);
    }
  },
);
