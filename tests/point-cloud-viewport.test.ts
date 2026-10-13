import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";

it("renders points without triangles, updates visibility and clipping, and disposes GPU resources", () => {
  const scene = new THREE.Scene();
  const view = Object.create(Viewport.prototype) as Viewport;
  Object.assign(view, {
    selectedId: null,
    objects: new Map(),
    scene,
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    invalidate: vi.fn(),
    theme: "dark",
    raycaster: new THREE.Raycaster(),
    clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  });
  const cloud: Entity = {
    id: "cloud",
    name: "scan.asc",
    kind: "pointcloud",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1]),
    visible: true,
    opacity: 1,
    color: "#abcdef",
  };
  try {
    view.setEntities([cloud], cloud.id);
    const mesh = scene.children[0] as THREE.Mesh;
    const points = mesh.children[0] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >;
    expect(points.isPoints).toBe(true);
    expect(points.geometry.getAttribute("position").count).toBe(4);
    expect(mesh.geometry.drawRange.count).toBe(0);
    expect(points.userData.entityId).toBe(cloud.id);
    Object.assign(view, { clipping: true });
    view.setEntities([{ ...cloud, visible: false, opacity: 0.4 }], null);
    expect(mesh.visible).toBe(false);
    expect(points.material.opacity).toBe(0.4);
    expect(points.material.clippingPlanes).toHaveLength(1);
    const geometryDisposed = vi.spyOn(points.geometry, "dispose"),
      materialDisposed = vi.spyOn(points.material, "dispose");
    view.setEntities(
      [{ ...cloud, positions: new Float32Array([0, 0, 1]) }],
      null,
    );
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalledOnce();
  } finally {
    view.setEntities([], null);
  }
  expect(scene.children).toHaveLength(0);
});
