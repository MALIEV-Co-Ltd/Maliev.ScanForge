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
    view.setEntities(
      [{ ...cloud, meshSelection: { hidden: [1, 3], saved: [] } }],
      cloud.id,
    );
    const visiblePoints = mesh.children[0] as THREE.Points;
    expect(Array.from(visiblePoints.geometry.getIndex()!.array)).toEqual([
      0, 2,
    ]);
    const triangleSelection = new THREE.Group();
    Object.assign(view, { triangleSelection });
    view.setTriangleSelection(cloud.positions, new Uint8Array([0, 0, 1, 0]));
    expect(triangleSelection.children[0]).toBeInstanceOf(THREE.Points);
    expect(
      Array.from(
        (triangleSelection.children[0] as THREE.Points).geometry.getAttribute(
          "position",
        ).array,
      ),
    ).toEqual([0, 1, 0]);
    view.setEntities([cloud], cloud.id);
    const restoredPoints = mesh.children[0] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >;
    expect(restoredPoints.geometry.getIndex()).toBeNull();
    Object.assign(view, { clipping: true });
    view.setEntities([{ ...cloud, visible: false, opacity: 0.4 }], null);
    expect(mesh.visible).toBe(false);
    expect(restoredPoints.material.opacity).toBe(0.4);
    expect(restoredPoints.material.clippingPlanes).toHaveLength(1);
    const geometryDisposed = vi.spyOn(restoredPoints.geometry, "dispose"),
      materialDisposed = vi.spyOn(restoredPoints.material, "dispose");
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
