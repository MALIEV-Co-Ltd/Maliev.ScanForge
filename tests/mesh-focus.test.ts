import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";

it("keeps active meshes neutral, dims other meshes, and restores colors after deselection", () => {
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
  const a: Entity = {
    id: "a",
    name: "A",
    kind: "mesh",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    visible: true,
    color: "#a6a6a6",
    opacity: 0.7,
  };
  const b = { ...a, id: "b", color: "#cc8844" };
  const material = (id: string) =>
    (
      scene.children.find(
        (mesh) => mesh.userData.entityId === id,
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    ).material;
  try {
    view.setEntities([a, b], a.id);
    expect(material("a").color.getHexString()).toBe("a6a6a6");
    expect(material("a").emissive.getHex()).toBe(0);
    expect(material("a").opacity).toBe(0.7);
    expect(material("b").color.r).toBeCloseTo(
      new THREE.Color(b.color).r * 0.12,
    );
    view.setEntities([a, b], b.id);
    expect(material("b").color.getHexString()).toBe("cc8844");
    expect(material("a").color.r).toBeCloseTo(
      new THREE.Color(a.color).r * 0.12,
    );
    view.setDeviation(b.id, [0, 0, 0], 0.05);
    expect(material("b").color.getHexString()).toBe("ffffff");
    expect(material("b").emissive.getHex()).toBe(0);
    view.setDeviation(b.id, null, 0.05);
    expect(material("b").color.getHexString()).toBe("cc8844");
    view.setEntities([a, b], null);
    expect(material("a").color.getHexString()).toBe("a6a6a6");
    expect(material("b").color.getHexString()).toBe("cc8844");
    expect(a.color).toBe("#a6a6a6");
  } finally {
    view.setEntities([], null);
  }
});
