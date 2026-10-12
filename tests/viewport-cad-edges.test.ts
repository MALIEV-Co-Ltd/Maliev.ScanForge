import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";

it("renders only supplied CAD topology, respects clipping/visibility, and releases edge resources", () => {
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
    flatShading: true,
    clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  });
  const cad: Entity = {
    id: "cad",
    name: "CAD",
    kind: "cad",
    kernelId: "shape",
    brep: "exact",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    edgePositions: [0, 0, 0, 1, 0, 0],
    visible: true,
    color: "#aeb5b8",
    opacity: 1,
  };
  try {
    view.setEntities([cad], cad.id);
    const mesh = scene.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    const edges = mesh.children[0] as THREE.LineSegments<
      THREE.BufferGeometry,
      THREE.LineBasicMaterial
    >;
    expect(edges.geometry.getAttribute("position").count).toBe(2);
    expect(edges.material.depthTest).toBe(true);
    expect(edges.material.color.getHexString()).toBe("20282c");
    expect(mesh.material.polygonOffset).toBe(true);
    Object.assign(view, { clipping: true });
    view.setEntities([{ ...cad, visible: false, opacity: 0.4 }], null);
    expect(mesh.visible).toBe(false);
    expect(edges.material.opacity).toBe(0.4);
    expect(edges.material.clippingPlanes).toEqual(mesh.material.clippingPlanes);
    expect(edges.material.clippingPlanes).toHaveLength(1);
    const geometryDisposed = vi.spyOn(edges.geometry, "dispose"),
      materialDisposed = vi.spyOn(edges.material, "dispose");
    view.setEntities([{ ...cad, edgePositions: [0, 0, 0, 0, 1, 0] }], null);
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalledOnce();
    view.setEntities([{ ...cad, kind: "mesh", kernelId: undefined }], null);
    expect(mesh.children).toHaveLength(0);
    expect(mesh.material.polygonOffset).toBe(false);
  } finally {
    view.setEntities([], null);
  }
});
