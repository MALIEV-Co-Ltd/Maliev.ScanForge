import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import {
  cacheScanRenderData,
  prepareScanRenderData,
} from "../src/scan-render-data";
import type { Entity } from "../src/types";

it("uses transferred normals/bounds directly and focuses every selected object", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene();
  Object.assign(view, {
    selectedId: null,
    objects: new Map(),
    scene,
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    invalidate: vi.fn(),
    theme: "dark",
  });
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const data = prepareScanRenderData(positions);
  cacheScanRenderData(positions, data);
  const entities: Entity[] = ["a", "b", "c"].map((id) => ({
    id,
    name: id,
    kind: "mesh",
    positions,
    color: "#aeb5b8",
    visible: true,
    opacity: 1,
  }));
  try {
    view.setEntities(entities, "b", ["a", "b"]);
    const meshes = scene.children as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >[];
    expect(meshes[0].geometry.getAttribute("position").array).toBe(positions);
    expect(meshes[0].geometry.getAttribute("normal").array).toBe(data.normals);
    expect(meshes[0].geometry.boundingBox?.max.toArray()).toEqual([1, 1, 0]);
    expect(
      meshes.map((mesh) => mesh.material.userData.normalsInactive),
    ).toEqual([false, false, true]);
  } finally {
    view.setEntities([], null);
  }
});
